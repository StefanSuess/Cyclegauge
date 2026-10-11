import { lstatSync, mkdirSync } from 'node:fs';
// Storage permission checks, moved verbatim out of paths.ts and store.ts (behaviour-neutral).
// Windows has no enforcement yet: its guard refuses every operation, so storage stays fail-closed
// until a separately approved Windows ACL guard replaces it.
export interface StorageGuard {
 createDirectory(path: string): void;
 verifyDirectory(path: string): void;
 verifyFile(path: string): void;
 verifySidecar(path: string): void;
}
export class PosixGuard implements StorageGuard {
 private readonly stat: typeof lstatSync;
 constructor(stat: typeof lstatSync = lstatSync) { this.stat = stat; }
 createDirectory(path: string): void { mkdirSync(path, { recursive: true, mode: 0o700 }); }
 verifyDirectory(path: string): void {
  const stat = this.stat(path);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid!()) throw new Error('UNSAFE_STORAGE');
 }
 verifyFile(path: string): void {
  const s = this.stat(path);
  if (!s.isFile() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600 || s.uid !== process.getuid!()) throw new Error('UNSAFE_STORAGE');
 }
 verifySidecar(path: string): void {
  try {
   const s = this.stat(path);
   // Another window's SQLite deletes its journal at the end of a transaction. A path that resolved a
   // moment ago can report zero links: it is gone, exactly like ENOENT, and nothing can be read through it.
   if (s.nlink === 0) return;
   if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid!() || (s.mode & 0o077)) throw new Error('UNSAFE_STORAGE');
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('UNSAFE_STORAGE'); }
 }
}
export class UnsupportedGuard implements StorageGuard {
 createDirectory(_path: string): never { throw new Error('STORAGE_PERMISSIONS_UNSUPPORTED'); }
 verifyDirectory(_path: string): never { throw new Error('STORAGE_PERMISSIONS_UNSUPPORTED'); }
 verifyFile(_path: string): never { throw new Error('STORAGE_PERMISSIONS_UNSUPPORTED'); }
 verifySidecar(_path: string): never { throw new Error('STORAGE_PERMISSIONS_UNSUPPORTED'); }
}
export type GuardKind = 'posix' | 'unsupported';
export const guardKind = (platform: NodeJS.Platform): GuardKind => (platform === 'win32' ? 'unsupported' : 'posix');
export function guardFor(platform: NodeJS.Platform = process.platform): StorageGuard {
 return guardKind(platform) === 'unsupported' ? new UnsupportedGuard() : new PosixGuard();
}
