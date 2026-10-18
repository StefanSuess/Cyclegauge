import { lstat, open, constants } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
export const READ_LIMITS = { maxBytes: 65_536, maxFiles: 200 }; // maxFiles is enforced by the caller
type Id = number | bigint;
// mtimeMs and mtimeNs are optional so that injected test doubles stay small; they are compared (strict mode) only when both sides carry them.
interface Times { mtimeMs?: number; mtimeNs?: Id }
export interface ReadHandle { // injected; the only reads are bounded positional reads from one verified handle
 stat(): Promise<{ isFile(): boolean; size: number; dev: Id; ino: Id } & Times>;
 read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
 close(): Promise<void>;
}
export interface ReadFs {
 lstat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; dev: Id; ino: Id } & Times>;
 open(path: string, flags: number): Promise<ReadHandle>;
}
export type ReadIgnoreResult = { text: string } | { code: 'not_allowed' | 'unsafe' | 'oversized' | 'unreadable' };
export const nodeFs: ReadFs = {
 lstat: async path => { const s = await lstat(path, { bigint: true }); return { isFile: () => s.isFile(), isDirectory: () => s.isDirectory(), isSymbolicLink: () => s.isSymbolicLink(), size: Number(s.size), dev: s.dev, ino: s.ino, mtimeMs: Number(s.mtimeMs), mtimeNs: s.mtimeNs }; },
 open: async (path, flags) => {
  const fh = await open(path, flags);
  return {
   stat: async () => { const s = await fh.stat({ bigint: true }); return { isFile: () => s.isFile(), size: Number(s.size), dev: s.dev, ino: s.ino, mtimeMs: Number(s.mtimeMs), mtimeNs: s.mtimeNs }; },
   read: async (buffer, offset, length, position) => ({ bytesRead: (await fh.read(buffer, offset, length, position)).bytesRead }),
   close: () => fh.close(),
  };
 },
};
const same = (a: Id, b: Id) => String(a) === String(b);
export function validIgnoreNames(names: unknown): string[] | undefined {
 if (!Array.isArray(names)) return undefined;
 const out: string[] = [];
 for (const n of names as unknown[]) {
  if (typeof n !== 'string' || n === '' || n === '.' || n === '..' || n.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(n)) continue;
  if (!out.includes(n)) out.push(n);
 }
 return out;
}
const relOk = (rel: string) => rel !== '' && !/[\\\u0000-\u001f\u007f]/.test(rel) && rel.split('/').every(s => s !== '' && s !== '.' && s !== '..');
// The root and every ancestor directory of rel must be real directories (no symlinks) on the root's device; Node lacks openat, so
// this is checked before opening and again after reading. Returns the root's stat, or undefined when the chain is not safe.
async function chain(fs: ReadFs, root: string, rel: string) {
 const segs = rel.split('/').slice(0, -1);
 const r = await fs.lstat(root);
 if (r.isSymbolicLink() || !r.isDirectory()) return undefined;
 let cur = root;
 for (const seg of segs) { cur = join(cur, seg); const d = await fs.lstat(cur); if (d.isSymbolicLink() || !d.isDirectory() || !same(d.dev, r.dev)) return undefined; }
 return r;
}
/**
 * The one bounded reader. Two modes: `whole` reads a file of at most maxBytes (a larger file is `oversized`), `tail` reads only the last
 * `window` bytes of a file of any size (starting at a line boundary: a partial first line is dropped). `strict` (the session reader)
 * additionally requires the file on the root's device, repeats fstat/lstat and the ancestry check after the read and reports any difference
 * as `changed`; it also honours an abort signal. Without `strict` and `signal` the behaviour is exactly that of the audit's ignore-file reader.
 */
export type BoundedMode = { kind: 'whole'; maxBytes: number } | { kind: 'tail'; window: number };
export type BoundedCode = 'not_allowed' | 'unsafe' | 'oversized' | 'unreadable' | 'changed' | 'aborted';
export interface BoundedOptions { fs?: ReadFs; names?: readonly string[]; strict?: boolean; signal?: AbortSignal }
export type BoundedResult = { bytes: Uint8Array; wipe(): void } | { code: BoundedCode };
const ABORT = Symbol('abort');
export async function readBounded(root: string, rel: string, mode: BoundedMode, options: BoundedOptions = {}): Promise<BoundedResult> {
 if (typeof root !== 'string' || typeof rel !== 'string' || !isAbsolute(root) || !relOk(rel) || (options.names !== undefined && !options.names.includes(rel.slice(rel.lastIndexOf('/') + 1)))) return { code: 'not_allowed' };
 const fs = options.fs ?? nodeFs, strict = options.strict === true, signal = options.signal, whole = mode.kind === 'whole';
 const max = mode.kind === 'whole' ? mode.maxBytes : mode.window;
 if (!Number.isSafeInteger(max) || max < 1) return { code: 'not_allowed' };
 let handle: ReadHandle | undefined, buf: Uint8Array | undefined, done = false, aborted = false, cleanup = () => {};
 try {
  const abs = join(root, ...rel.split('/'));
  // `go` runs one step; with a signal, an abort ends the wait at once and the handle is closed in `finally`.
  let go = <T>(p: Promise<T>): Promise<T> => p;
  if (signal) {
   if (signal.aborted) throw ABORT;
   const aborted = new Promise<never>((_, reject) => { const on = () => reject(ABORT); signal.addEventListener('abort', on, { once: true }); cleanup = () => signal.removeEventListener('abort', on); });
   aborted.catch(() => undefined);
   go = p => Promise.race([p, aborted]);
  }
  const r0 = await go(chain(fs, root, rel));
  if (!r0) return { code: 'unsafe' };
  const st = await go(fs.lstat(abs));
  if (st.isSymbolicLink() || !st.isFile()) return { code: 'unsafe' };
  if (strict && !same(st.dev, r0.dev)) return { code: 'unsafe' };
  if (whole && st.size > max) return { code: 'oversized' };
  const opening = fs.open(abs, constants.O_RDONLY | ((constants.O_NOFOLLOW as number | undefined) ?? 0) | ((constants.O_NONBLOCK as number | undefined) ?? 0));
  // An abort while the open is pending abandons the wait, but a handle that arrives later is still closed.
  try { handle = await go(opening); } catch (e) { if (e === ABORT) opening.then(h => h.close()).catch(() => undefined); throw e; }
  const fst = await go(handle.stat());
  if (!fst.isFile() || !same(fst.dev, st.dev) || !same(fst.ino, st.ino)) return { code: 'unsafe' };
  if (strict && !same(fst.dev, r0.dev)) return { code: 'unsafe' };
  if (whole && fst.size > max) return { code: 'oversized' };
  // whole: one byte more than allowed, so that growth is noticed; tail: the window plus the byte before it (to see whether the first line is complete).
  const larger = !whole && fst.size > max;
  const start = whole ? 0 : larger ? fst.size - max - 1 : 0, length = whole ? max + 1 : larger ? max + 1 : fst.size;
  buf = new Uint8Array(length); let total = 0;
  while (total < length) { const { bytesRead } = await go(handle.read(buf, total, length - total, start + total)); if (!bytesRead) break; total += bytesRead; }
  if (whole && total > max) return { code: 'oversized' };
  if (strict) {
   if (!await go(chain(fs, root, rel))) return { code: 'changed' };
   const fst2 = await go(handle.stat()), st2 = await go(fs.lstat(abs));
   const stable = (a: { size: number; dev: Id; ino: Id } & Times, b: { size: number; dev: Id; ino: Id } & Times) => a.size === b.size && same(a.dev, b.dev) && same(a.ino, b.ino)
    && (a.mtimeNs === undefined || b.mtimeNs === undefined || same(a.mtimeNs, b.mtimeNs)) && (a.mtimeMs === undefined || b.mtimeMs === undefined || a.mtimeMs === b.mtimeMs);
   if (st2.isSymbolicLink() || !st2.isFile() || !stable(fst, fst2) || !stable(st2, fst) || total !== (whole ? fst.size : length)) return { code: 'changed' };
   if (signal?.aborted) throw ABORT;
  } else if (!await chain(fs, root, rel)) return { code: 'unsafe' };
  const data = buf.subarray(0, total), held = buf;
  let bytes = data;
  if (!whole && larger) { // drop a partial first line: the extra byte before the window tells whether the window starts at a line boundary
   if (data[0] === 0x0a) bytes = data.subarray(1);
   else { const nl = data.indexOf(0x0a); bytes = nl < 0 ? data.subarray(data.length) : data.subarray(nl + 1); }
  }
  done = true;
  return { bytes, wipe: () => held.fill(0) };
 } catch (e) { aborted = e === ABORT; return { code: aborted ? 'aborted' : 'unreadable' }; }
 finally {
  cleanup();
  const held = buf, wipe = () => { if (!done) held?.fill(0); };
  if (handle) {
   // Close first, so that a read finishing during the close cannot leave bytes behind a finished wipe. On abort the close is started but not awaited
   // (a close waiting for a hung read must not delay the abort); the handle is closed exactly once and the wipe follows the close.
   const closing = Promise.resolve().then(() => handle!.close()).catch(() => undefined);
   if (aborted) void closing.finally(wipe); else { await closing; wipe(); }
  } else wipe();
 }
}
export async function readIgnoreFile(root: string, rel: string, names: string[], options: { fs?: ReadFs } = {}): Promise<ReadIgnoreResult> {
 const r = await readBounded(root, rel, { kind: 'whole', maxBytes: READ_LIMITS.maxBytes }, { fs: options.fs, names });
 if ('code' in r) return { code: r.code as 'not_allowed' | 'unsafe' | 'oversized' | 'unreadable' };
 try {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(r.bytes);
  return { text: text.startsWith('﻿') ? text.slice(1) : text };
 } catch { return { code: 'unreadable' }; }
}
