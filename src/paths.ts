import { lstatSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join, sep, posix, win32 } from 'node:path';
import { homedir } from 'node:os';
import { guardFor } from './guard.ts';
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

// --- platform-neutral, pure helpers (the platform, environment and home are always injected) -----

type Env = Readonly<Record<string, string | undefined>>;
const pathApi = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix);
const WIN_DRIVE = /^[A-Za-z]:[\\/]/;
const WIN_UNC = /^(?:\\\\|\/\/)(?![?.][\\/])[^\\/]+[\\/][^\\/]+/;
/** UNC paths and `\\?\UNC\...`. Mapped drive letters cannot be recognised from the string alone. */
export function isWindowsNetworkPath(path: string): boolean {
 return WIN_UNC.test(path) || /^\\\\\?\\UNC\\/i.test(path);
}
/** An environment path is used only when it is non-empty, untrimmed and absolute for that platform. */
function envPath(platform: NodeJS.Platform, value: string | undefined): string | undefined {
 if (typeof value !== 'string' || value === '' || value.trim() !== value) return undefined;
 if (platform === 'win32') return WIN_DRIVE.test(value) || isWindowsNetworkPath(value) ? value : undefined;
 return value.startsWith('/') ? value : undefined;
}
export function defaultSourceFor(platform: NodeJS.Platform, env: Env, home: string): string {
 const api = pathApi(platform);
 if (platform === 'darwin') return api.join(home, 'Library', 'Application Support', 'Kiro');
 if (platform === 'win32') return api.join(envPath(platform, env.APPDATA) ?? api.join(home, 'AppData', 'Roaming'), 'Kiro');
 return api.join(envPath(platform, env.XDG_CONFIG_HOME) ?? api.join(home, '.config'), 'Kiro');
}
export function defaultStorageFor(platform: NodeJS.Platform, env: Env, home: string): string {
 const api = pathApi(platform);
 if (platform === 'darwin') return api.join(home, 'Library', 'Application Support', 'EasyKiroGauge');
 if (platform === 'win32') {
  const local = envPath(platform, env.LOCALAPPDATA);
  return api.join(local !== undefined && !isWindowsNetworkPath(local) ? local : api.join(home, 'AppData', 'Local'), 'EasyKiroGauge');
 }
 return api.join(envPath(platform, env.XDG_DATA_HOME) ?? api.join(home, '.local', 'share'), 'EasyKiroGauge');
}
/**
 * The extension's log directory is `<root>/logs/<run>/<window>/exthost/<extension id>`. Returns the
 * IDE data root only for exactly that shape; anything else (including `..`) yields undefined.
 */
export function rootFromLogUri(fsPath: string, platform: NodeJS.Platform = process.platform): string | undefined {
 const api = pathApi(platform);
 if (typeof fsPath !== 'string' || fsPath === '' || /[\u0000-\u001f\u007f]/.test(fsPath)) return undefined;
 if (platform === 'win32' ? !WIN_DRIVE.test(fsPath) : !fsPath.startsWith('/')) return undefined;
 const split = platform === 'win32' ? /[\\/]+/ : /\/+/;
 if (fsPath.split(split).includes('..')) return undefined;
 let normal = api.normalize(fsPath);
 while (normal.length > api.parse(normal).root.length && normal.endsWith(api.sep)) normal = normal.slice(0, -1);
 const segments = normal.split(api.sep);
 const n = segments.length;
 if (n < 6 || segments[n - 2] !== 'exthost' || segments[n - 5] !== 'logs' || segments.slice(n - 5).some(s => s === '')) return undefined;
 let root = normal;
 for (let i = 0; i < 5; i++) root = api.dirname(root);
 return root === api.parse(root).root ? undefined : root;
}
export type DiscoveryMethod = 'configured' | 'log_uri' | 'platform_default';
export function resolveSourceRoot(o: { configured?: string; logUri?: string; platform?: NodeJS.Platform; env?: Env; home?: string }): { root: string; method: DiscoveryMethod } {
 const platform = o.platform ?? process.platform;
 if (o.configured && o.configured.trim() !== '') return { root: o.configured, method: 'configured' };
 const fromLog = o.logUri ? rootFromLogUri(o.logUri, platform) : undefined;
 if (fromLog) return { root: fromLog, method: 'log_uri' };
 return { root: defaultSourceFor(platform, o.env ?? process.env, o.home ?? homedir()), method: 'platform_default' };
}
/** Equivalence of two already-canonical paths: case-insensitive on Windows only, extended prefix ignored. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
 if (platform !== 'win32') return a === b;
 const clean = (p: string) => win32.normalize(p.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\(?=[A-Za-z]:)/, '')).toLowerCase();
 return clean(a) === clean(b);
}

export function prepareStorage(path: string, source: string, platform: NodeJS.Platform = process.platform): string {
 const dest = resolve(path), root = resolve(source);
 if (inside(dest, root) || inside(root, dest)) throw new Error('UNSAFE_STORAGE');
 try {
  if (platform === 'win32' && isWindowsNetworkPath(path)) throw new Error('UNSAFE_STORAGE');
  noSymlinks(dest);
  for (let p = dest;; p = dirname(p)) {
   if (existsSync(join(p, '.git')) || /^(Kiro|kiro-cli|\.kiro)$/i.test(p.split(/[\\/]/).at(-1)!)) throw new Error('UNSAFE_STORAGE');
   if (p === dirname(p)) break;
  }
  // Windows ACL enforcement has not been established: its guard fails closed before anything is created.
  const guard = guardFor(platform);
  guard.createDirectory(dest); noSymlinks(dest);
  guard.verifyDirectory(dest);
  return dest;
 } catch { throw new Error('UNSAFE_STORAGE'); }
}
export function defaultSource(): string { return defaultSourceFor(process.platform, process.env, homedir()); }
export function defaultStorage(): string { return defaultStorageFor(process.platform, process.env, homedir()); }
