import { lstatSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { windowsStorageAccess } from './windows-storage.ts';
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
  if (process.platform === 'win32') {
   if (windowsStorageVerified(dest)) windowsStorageAccess(dest, true); else mkdirSync(dest, { recursive: true });
   noSymlinks(dest);
   if (!lstatSync(dest).isDirectory()) throw new Error('UNSAFE_STORAGE');
   return dest;
  }
  mkdirSync(dest, { recursive: true, mode: 0o700 }); noSymlinks(dest);
  const stat = lstatSync(dest);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid!()) throw new Error('UNSAFE_STORAGE');
  return dest;
 } catch { throw new Error('UNSAFE_STORAGE'); }
}
// The default location sits in the user's profile, which Windows already restricts to that user,
// SYSTEM and administrators. A chosen location may be shared, so its DACL is verified instead.
export function windowsStorageVerified(path: string): boolean {
 return process.platform === 'win32' && relative(resolve(path), defaultStorage()) !== '';
}
export function defaultSource(): string {
 if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Kiro');
 if (process.platform === 'win32') return join(absoluteEnv('APPDATA') ?? join(homedir(), 'AppData', 'Roaming'), 'Kiro');
 return join(absoluteEnv('XDG_CONFIG_HOME') ?? join(homedir(), '.config'), 'Kiro');
}
export function defaultStorage(): string {
 if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cyclegauge');
 if (process.platform === 'win32') return join(absoluteEnv('LOCALAPPDATA') ?? join(homedir(), 'AppData', 'Local'), 'Cyclegauge');
 return join(absoluteEnv('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'), 'Cyclegauge');
}
function absoluteEnv(name: string): string | undefined {
 const value = process.env[name]; return value && isAbsolute(value) ? value : undefined;
}
