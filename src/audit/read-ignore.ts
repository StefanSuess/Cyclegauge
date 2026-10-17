import { lstat, open, constants } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
export const READ_LIMITS = { maxBytes: 65_536, maxFiles: 200 }; // maxFiles is enforced by the caller
type Id = number | bigint;
export interface ReadHandle { // injected; the only reads are bounded positional reads from one verified handle
 stat(): Promise<{ isFile(): boolean; size: number; dev: Id; ino: Id }>;
 read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
 close(): Promise<void>;
}
export interface ReadFs {
 lstat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; dev: Id; ino: Id }>;
 open(path: string, flags: number): Promise<ReadHandle>;
}
export type ReadIgnoreResult = { text: string } | { code: 'not_allowed' | 'unsafe' | 'oversized' | 'unreadable' };
const nodeFs: ReadFs = {
 lstat: async path => { const s = await lstat(path, { bigint: true }); return { isFile: () => s.isFile(), isDirectory: () => s.isDirectory(), isSymbolicLink: () => s.isSymbolicLink(), size: Number(s.size), dev: s.dev, ino: s.ino }; },
 open: async (path, flags) => {
  const fh = await open(path, flags);
  return {
   stat: async () => { const s = await fh.stat({ bigint: true }); return { isFile: () => s.isFile(), size: Number(s.size), dev: s.dev, ino: s.ino }; },
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
// this is checked before opening and again after reading.
async function chainOk(fs: ReadFs, root: string, rel: string): Promise<boolean> {
 const segs = rel.split('/').slice(0, -1);
 const r = await fs.lstat(root);
 if (r.isSymbolicLink() || !r.isDirectory()) return false;
 let cur = root;
 for (const seg of segs) { cur = join(cur, seg); const d = await fs.lstat(cur); if (d.isSymbolicLink() || !d.isDirectory() || !same(d.dev, r.dev)) return false; }
 return true;
}
export async function readIgnoreFile(root: string, rel: string, names: string[], options: { fs?: ReadFs } = {}): Promise<ReadIgnoreResult> {
 if (typeof root !== 'string' || typeof rel !== 'string' || !isAbsolute(root) || !relOk(rel) || !names.includes(rel.slice(rel.lastIndexOf('/') + 1))) return { code: 'not_allowed' };
 const fs = options.fs ?? nodeFs, max = READ_LIMITS.maxBytes;
 let handle: ReadHandle | undefined;
 try {
  const abs = join(root, ...rel.split('/'));
  if (!await chainOk(fs, root, rel)) return { code: 'unsafe' };
  const st = await fs.lstat(abs);
  if (st.isSymbolicLink() || !st.isFile()) return { code: 'unsafe' };
  if (st.size > max) return { code: 'oversized' };
  handle = await fs.open(abs, constants.O_RDONLY | ((constants.O_NOFOLLOW as number | undefined) ?? 0) | ((constants.O_NONBLOCK as number | undefined) ?? 0));
  const fst = await handle.stat();
  if (!fst.isFile() || !same(fst.dev, st.dev) || !same(fst.ino, st.ino)) return { code: 'unsafe' };
  if (fst.size > max) return { code: 'oversized' };
  const buf = new Uint8Array(max + 1); let total = 0;
  while (total < max + 1) { const { bytesRead } = await handle.read(buf, total, max + 1 - total, total); if (!bytesRead) break; total += bytesRead; }
  if (total > max) return { code: 'oversized' };
  if (!await chainOk(fs, root, rel)) return { code: 'unsafe' };
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf.subarray(0, total));
  return { text: text.startsWith('﻿') ? text.slice(1) : text };
 } catch { return { code: 'unreadable' }; }
 finally { if (handle) { try { await handle.close(); } catch { /* ignore */ } } }
}
