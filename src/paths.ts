import { lstatSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';
export function inside(child: string, parent: string): boolean {
 const r = relative(resolve(parent), resolve(child)); return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r));
}
export function noSymlinks(path: string): void {
 let p = resolve(path);
 for (;;) {
  if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('UNSAFE_PATH');
  // lstat also catches dangling links.
  try { if (lstatSync(p).isSymbolicLink()) throw new Error('UNSAFE_PATH'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const next = dirname(p); if (p === next) break; p = next;
 }
}
export function prepareStorage(path: string, source: string): string {
 const dest = resolve(path), root = resolve(source);
 if (inside(dest, root) || inside(root, dest)) throw new Error('UNSAFE_STORAGE');
 try {
  noSymlinks(dest);
  for (let p = dest;; p = dirname(p)) {
   if (existsSync(join(p, '.git')) || /^(Kiro|kiro-cli|\.kiro)$/i.test(p.split(/[\\/]/).at(-1)!)) throw new Error('UNSAFE_STORAGE');
   if (p === dirname(p)) break;
  }
  // Windows ACL enforcement has not been established: fail closed.
  if (process.platform === 'win32') throw new Error('STORAGE_PERMISSIONS_UNSUPPORTED');
  mkdirSync(dest, { recursive: true, mode: 0o700 }); noSymlinks(dest);
  const stat = lstatSync(dest);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid!()) throw new Error('UNSAFE_STORAGE');
  return dest;
 } catch { throw new Error('UNSAFE_STORAGE'); }
}
export function defaultSource(): string {
 if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Kiro');
 if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Kiro');
 return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'Kiro');
}
export function defaultStorage(): string {
 if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cyclegauge');
 if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Cyclegauge');
 return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'Cyclegauge');
}
