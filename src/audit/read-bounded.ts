import { lstat, open, constants } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
export type Id = number | bigint;
// mtimeMs and mtimeNs are optional so that injected test doubles stay small; they are compared (strict mode) only when both sides carry them.
export interface Times { mtimeMs?: number; mtimeNs?: Id }
export interface ReadHandle { // injected; the only reads are bounded positional reads from one verified handle
 stat(): Promise<{ isFile(): boolean; size: number; dev: Id; ino: Id; nlink?: number } & Times>;
 read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
 close(): Promise<void>;
}
export interface ReadFs {
 lstat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; dev: Id; ino: Id; nlink?: number } & Times>;
 open(path: string, flags: number): Promise<ReadHandle>;
}
export const nodeFs: ReadFs = {
 lstat: async path => { const s = await lstat(path, { bigint: true }); return { isFile: () => s.isFile(), isDirectory: () => s.isDirectory(), isSymbolicLink: () => s.isSymbolicLink(), size: Number(s.size), dev: s.dev, ino: s.ino, mtimeMs: Number(s.mtimeMs), mtimeNs: s.mtimeNs, nlink: Number(s.nlink) }; },
 open: async (path, flags) => {
  const fh = await open(path, flags);
  return {
   stat: async () => { const s = await fh.stat({ bigint: true }); return { isFile: () => s.isFile(), size: Number(s.size), dev: s.dev, ino: s.ino, mtimeMs: Number(s.mtimeMs), mtimeNs: s.mtimeNs, nlink: Number(s.nlink) }; },
   read: async (buffer, offset, length, position) => ({ bytesRead: (await fh.read(buffer, offset, length, position)).bytesRead }),
   close: () => fh.close(),
  };
 },
};
const same = (a: Id, b: Id) => String(a) === String(b);
const relOk = (rel: string) => rel !== '' && !/[\\\u0000-\u001f\u007f]/.test(rel) && rel.split('/').every(s => s !== '' && s !== '.' && s !== '..');
// The root and every ancestor directory of rel must be real directories (no symlinks) on the root's device; Node lacks openat, so
// this is checked before opening and again after reading. Returns the root's stat, or undefined when the chain is not safe.
export async function chainOk(fs: ReadFs, root: string, rel: string) {
 const segs = rel.split('/').slice(0, -1);
 const r = await fs.lstat(root);
 if (r.isSymbolicLink() || !r.isDirectory()) return undefined;
 let cur = root;
 for (const seg of segs) { cur = join(cur, seg); const d = await fs.lstat(cur); if (d.isSymbolicLink() || !d.isDirectory() || !same(d.dev, r.dev)) return undefined; }
 return r;
}
/**
 * The shared reader retains the legacy whole/tail behavior; guarded prefix reads support a staged first read.
 * Legacy modes: `whole` reads a file of at most maxBytes (a larger file is `oversized`), `tail` reads only the last
 * `window` bytes of a file of any size (starting at a line boundary: a partial first line is dropped). `strict` (the session reader)
 * additionally requires the file on the root's device, repeats fstat/lstat and the ancestry check after the read and reports any difference
 * as `changed`; it also honours an abort signal. Without `strict` and `signal` the behaviour is exactly that of the audit's ignore-file reader.
 */
export type BoundedMode = { kind: 'whole'; maxBytes: number } | { kind: 'tail'; window: number } | { kind: 'prefix'; maxBytes: number };
export type BoundedCode = 'not_allowed' | 'unsafe' | 'oversized' | 'unreadable' | 'changed' | 'aborted';
export interface BoundedOptions { fs?: ReadFs; names?: readonly string[]; strict?: boolean; signal?: AbortSignal; allow?: (rel: string) => boolean; guarded?: boolean; singleLink?: boolean; initialBytes?: number; continueIf?: (bytes: Uint8Array) => boolean; consume?: (bytes: number) => boolean }
export type BoundedResult = { bytes: Uint8Array; wipe(): void; size?: number } | { code: BoundedCode };
const ABORT = Symbol('abort');
export async function readLegacyBounded(root: string, rel: string, mode: BoundedMode, options: BoundedOptions = {}): Promise<BoundedResult> {
 if (typeof root !== 'string' || typeof rel !== 'string' || !isAbsolute(root) || !relOk(rel) || (options.allow !== undefined && !options.allow(rel)) || (options.names !== undefined && !options.names.includes(rel.slice(rel.lastIndexOf('/') + 1)))) return { code: 'not_allowed' };
 const fs = options.fs ?? nodeFs, strict = options.strict === true, signal = options.signal, whole = mode.kind === 'whole', prefix = mode.kind === 'prefix', guarded = options.guarded === true;
 const max = mode.kind === 'tail' ? mode.window : mode.maxBytes;
 if (!Number.isSafeInteger(max) || max < 1) return { code: 'not_allowed' };
 let handle: ReadHandle | undefined, buf: Uint8Array | undefined, done = false, aborted = false, cleanup = () => {};
 try {
  const abs = join(root, ...rel.split('/'));
  // Legacy aborts race each step. Guarded configuration steps drain before aborting, keeping their run single-flight through cleanup.
  let go = <T>(p: Promise<T>): Promise<T> => p;
  if (signal) {
   if (signal.aborted) throw ABORT;
   if (guarded) go = async p => { const value = await p; if (signal.aborted) throw ABORT; return value; };
   else {
    const aborted = new Promise<never>((_, reject) => { const on = () => reject(ABORT); signal.addEventListener('abort', on, { once: true }); cleanup = () => signal.removeEventListener('abort', on); });
    aborted.catch(() => undefined);
    go = p => Promise.race([p, aborted]);
   }
  }
  const dirs = guarded ? await go(ancestorIds(fs, root, rel)) : undefined;
  if (guarded && !dirs) return { code: 'unsafe' };
  const r0 = await go(chainOk(fs, root, rel));
  if (!r0) return { code: 'unsafe' };
  const st = await go(fs.lstat(abs));
  if (st.isSymbolicLink() || !st.isFile()) return { code: 'unsafe' };
  if ((strict || guarded) && !same(st.dev, r0.dev)) return { code: 'unsafe' };
  if (options.singleLink && st.nlink !== 1) return { code: 'unsafe' };
  if (whole && st.size > max) return { code: 'oversized' };
  const opening = fs.open(abs, constants.O_RDONLY | ((constants.O_NOFOLLOW as number | undefined) ?? 0) | ((constants.O_NONBLOCK as number | undefined) ?? 0));
  // Guarded open first owns the arriving handle, so abort cleanup is awaited in finally. Legacy callers retain prompt abort.
  if (guarded) { handle = await opening; if (signal?.aborted) throw ABORT; }
  else try { handle = await go(opening); } catch (e) { if (e === ABORT) opening.then(h => h.close()).catch(() => undefined); throw e; }
  const fst = await go(handle.stat());
  if (!fst.isFile() || !same(fst.dev, st.dev) || !same(fst.ino, st.ino)) return { code: 'unsafe' };
  if (options.singleLink && fst.nlink !== 1) return { code: 'unsafe' };
  if ((strict || guarded) && !same(fst.dev, r0.dev)) return { code: 'unsafe' };
  if (whole && fst.size > max) return { code: 'oversized' };
  // Legacy whole: one extra byte detects growth. Guarded whole reads exactly the stat size and rechecks it; tail: the window plus the byte before it (to see whether the first line is complete).
  const larger = !whole && !prefix && fst.size > max;
  const start = whole || prefix ? 0 : larger ? fst.size - max - 1 : 0, length = prefix ? Math.max(Math.min(max, fst.size), Math.min(max, options.initialBytes ?? 0)) : whole ? guarded ? fst.size : max + 1 : larger ? max + 1 : fst.size;
  buf = new Uint8Array(length); let total = 0;
  let target = prefix && options.initialBytes !== undefined ? Math.min(length, options.initialBytes) : length;
  while (total < target) {
   const requested = target - total;
   if (options.consume && !options.consume(requested)) return { code: 'oversized' };
   const { bytesRead } = await go(handle.read(buf, total, requested, start + total));
   // Release the unused reservation after a short read; an abandoned pending read stays charged.
   options.consume?.(bytesRead - requested);
   if (!bytesRead) break; total += bytesRead;
   if (prefix && total >= fst.size) break;
   if (total === target && target < length && options.continueIf?.(buf.subarray(0, total))) target = length;
  }
  if (whole && total > max) return { code: 'oversized' };
  if (strict || guarded) {
   if (!await go(chainOk(fs, root, rel))) return { code: 'changed' };
   const fst2 = await go(handle.stat()), st2 = await go(fs.lstat(abs));
   const stable = (a: { size: number; dev: Id; ino: Id; nlink?: number } & Times, b: { size: number; dev: Id; ino: Id; nlink?: number } & Times) => a.size === b.size && same(a.dev, b.dev) && same(a.ino, b.ino)
    && (a.mtimeNs === undefined || b.mtimeNs === undefined || same(a.mtimeNs, b.mtimeNs)) && (a.mtimeMs === undefined || b.mtimeMs === undefined || a.mtimeMs === b.mtimeMs);
   if (guarded && (!dirs || !sameAncestors(dirs, await go(ancestorIds(fs, root, rel))))) return { code: 'changed' };
   if (options.singleLink && (fst2.nlink !== 1 || st2.nlink !== 1)) return { code: 'unsafe' };
   if (st2.isSymbolicLink() || !st2.isFile() || !stable(fst, fst2) || !stable(st2, fst) || total !== (prefix ? Math.min(target, fst.size) : whole ? fst.size : length)) return { code: 'changed' };
   if (signal?.aborted) throw ABORT;
  } else if (!await chainOk(fs, root, rel)) return { code: 'unsafe' };
  const data = buf.subarray(0, total), held = buf;
  let bytes = data;
  if (!whole && larger) { // drop a partial first line: the extra byte before the window tells whether the window starts at a line boundary
   if (data[0] === 0x0a) bytes = data.subarray(1);
   else { const nl = data.indexOf(0x0a); bytes = nl < 0 ? data.subarray(data.length) : data.subarray(nl + 1); }
  }
  done = true;
  return { bytes, wipe: () => held.fill(0), ...(guarded ? { size: fst.size } : {}) };
 } catch (e) { aborted = e === ABORT; return { code: aborted ? 'aborted' : 'unreadable' }; }
 finally {
  cleanup();
  const held = buf, wipe = () => { if (!done) held?.fill(0); };
  if (handle) {
   // Close before wiping. Guarded config aborts await all I/O and close; legacy aborts retain their deferred cleanup semantics.
   const closing = Promise.resolve().then(() => handle!.close()).catch(() => undefined);
   if (aborted && !guarded) void closing.finally(wipe); else { await closing; wipe(); }
  } else wipe();
 }
}

// The guarded configuration API requires an explicit path gate; legacy consumers keep their existing API.
export interface ReadBoundedOptions { maxBytes: number; mode: 'whole' | 'prefix'; allow: (rel: string) => boolean; initialBytes?: number; continueIf?: (bytes: Uint8Array) => boolean; singleLink?: boolean; consume?: (bytes: number) => boolean }
export async function readBounded(root: string, rel: string, options: ReadBoundedOptions, io: { fs?: ReadFs; signal?: AbortSignal } = {}): Promise<BoundedResult> {
 if (typeof options.allow !== 'function' || (options.initialBytes !== undefined && (!Number.isSafeInteger(options.initialBytes) || options.initialBytes < 1 || options.initialBytes > options.maxBytes))) return { code: 'not_allowed' };
 return readLegacyBounded(root, rel, { kind: options.mode, maxBytes: options.maxBytes }, { ...io, ...options, guarded: true });
}
type Ancestor = { dev: Id; ino: Id };
async function ancestorIds(fs: ReadFs, root: string, rel: string): Promise<Ancestor[] | undefined> {
 const out: Ancestor[] = []; let cur = root;
 for (const seg of ['', ...rel.split('/').slice(0, -1)]) {
  if (seg) cur = join(cur, seg);
  const st = await fs.lstat(cur);
  if (!st.isDirectory() || st.isSymbolicLink() || (out.length > 0 && !same(st.dev, out[0]!.dev))) return undefined;
  out.push({ dev: st.dev, ino: st.ino });
 }
 return out;
}
const sameAncestors = (a: Ancestor[], b: Ancestor[] | undefined) => b !== undefined && a.length === b.length && a.every((v, i) => same(v.dev, b[i]!.dev) && same(v.ino, b[i]!.ino));
