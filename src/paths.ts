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
// profile: the editor's per-extension storage or the per-user application data default. On Windows
// those rely on the user profile's own permissions; any other location may be shared and is verified.
export function prepareStorage(path: string, source: string, profile = false): string {
 const dest = resolve(path), root = resolve(source);
 // A chosen location must be outside the source root; the default may sit beside the logs, never among them or around the source.
 // macOS filesystems are case-insensitive by default, so compare lower-cased there (comparison only).
 const k = (x: string) => process.platform === 'darwin' ? x.toLowerCase() : x, d = k(dest), r = k(root);
 if (inside(r, d) || inside(d, join(r, 'logs')) || (!profile && inside(d, r))) throw new Error('UNSAFE_STORAGE');
 try {
  noSymlinks(dest);
  for (let p = dest;; p = dirname(p)) {
   if (existsSync(join(p, '.git')) || /^(kiro-cli|\.kiro)$/i.test(p.split(/[\\/]/).at(-1)!)) throw new Error('UNSAFE_STORAGE');
   if (p === dirname(p)) break;
  }
  if (process.platform === 'win32') {
   if (profile) mkdirSync(dest, { recursive: true }); else windowsStorageAccess(dest, true);
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
