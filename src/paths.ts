import { lstatSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join, sep, posix, win32 } from 'node:path';
import { homedir } from 'node:os';
import { guardFor } from './guard.ts';
export function inside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
 // Default macOS and Windows volumes are case-insensitive; folding case only ever rejects more.
 // On Windows the extended-length prefixes are dropped so `\\?\C:\x` and `C:\x` compare equal.
 const plain = (p: string) => (platform === 'win32' ? p.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\(?=[A-Za-z]:)/, '') : p);
 const fold = (p: string) => (platform === 'darwin' || platform === 'win32' ? plain(p).toLowerCase() : p);
 const api = pathApi(platform);
 const r = api.relative(fold(api.resolve(parent)), fold(api.resolve(child))); return r === '' || (r !== '..' && !r.startsWith('..' + api.sep) && !api.isAbsolute(r));
}
export function noSymlinks(path: string): void {
 let p = resolve(path);
 for (;;) {
  // One lstat per component (it also catches dangling links); a component another window removes
  // between a probe and this call is simply absent, not an error.
  try { if (lstatSync(p).isSymbolicLink()) throw new Error('UNSAFE_PATH'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const next = dirname(p); if (p === next) break; p = next;
 }
}

// --- platform-neutral, pure helpers (the platform, environment and home are always injected) -----

type Env = Readonly<Record<string, string | undefined>>;
/** The home directory is resolved lazily: os.homedir() can throw, and only fallbacks need it (as in 0.5.1). */
type Home = string | (() => string);
const homeOf = (home: Home) => (typeof home === 'function' ? home() : home);
const pathApi = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix);
const WIN_DRIVE = /^[A-Za-z]:[\\/]/;
/**
 * Anything that starts with two separators is a UNC share or a device-namespace path (`\\?\UNC\`,
 * `//?/UNC/`, `\\.\...`), with the single exception of the extended form of a local drive
 * (`\\?\C:\...`). Mapped drive letters cannot be recognised from the string alone.
 */
export function isWindowsNetworkPath(path: string): boolean {
 return /^[\\/]{2}/.test(path) && !/^[\\/]{2}\?[\\/][A-Za-z]:[\\/]/.test(path);
}
/** An environment path is used only when it is non-empty, untrimmed and absolute for that platform. */
function envPath(platform: NodeJS.Platform, value: string | undefined): string | undefined {
 if (typeof value !== 'string' || value === '' || value.trim() !== value) return undefined;
 if (platform === 'win32') return WIN_DRIVE.test(value) || isWindowsNetworkPath(value) ? value : undefined;
 return value.startsWith('/') ? value : undefined;
}
export function defaultSourceFor(platform: NodeJS.Platform, env: Env, home: Home): string {
 const api = pathApi(platform);
 if (platform === 'darwin') return api.join(homeOf(home), 'Library', 'Application Support', 'Kiro');
 if (platform === 'win32') return api.join(envPath(platform, env.APPDATA) ?? api.join(homeOf(home), 'AppData', 'Roaming'), 'Kiro');
 return api.join(envPath(platform, env.XDG_CONFIG_HOME) ?? api.join(homeOf(home), '.config'), 'Kiro');
}
export function defaultStorageFor(platform: NodeJS.Platform, env: Env, home: Home): string {
 const api = pathApi(platform);
 if (platform === 'darwin') return api.join(homeOf(home), 'Library', 'Application Support', 'EasyKiroGauge');
 if (platform === 'win32') {
  const local = envPath(platform, env.LOCALAPPDATA);
  return api.join(local !== undefined && !isWindowsNetworkPath(local) ? local : api.join(homeOf(home), 'AppData', 'Local'), 'EasyKiroGauge');
 }
 return api.join(envPath(platform, env.XDG_DATA_HOME) ?? api.join(homeOf(home), '.local', 'share'), 'EasyKiroGauge');
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
/**
 * The log directory identifies the IDE data root only when the host really is Kiro; in VS Code or
 * another fork the same shape would point at that editor's data. The app name is a host-provided
 * label, matched case-insensitively.
 */
export function hostLogUri(appName: string | undefined, logUri: string | undefined): string | undefined {
 return typeof appName === 'string' && /\bkiro\b/i.test(appName) ? logUri : undefined;
}
export type DiscoveryMethod = 'configured' | 'log_uri' | 'platform_default';
export function resolveSourceRoot(o: { configured?: string; logUri?: string; platform?: NodeJS.Platform; env?: Env; home?: Home }): { root: string; method: DiscoveryMethod } {
 const platform = o.platform ?? process.platform;
 // A configured value that is empty, padded or relative is ignored rather than anchored to the host's cwd.
 if (envPath(platform, o.configured) !== undefined) return { root: o.configured!, method: 'configured' };
 const fromLog = o.logUri ? rootFromLogUri(o.logUri, platform) : undefined;
 if (fromLog) return { root: fromLog, method: 'log_uri' };
 return { root: defaultSourceFor(platform, o.env ?? process.env, o.home ?? (() => homedir())), method: 'platform_default' };
}
/** `NAME~1`-style short alias of a long file name (8.3 generation), e.g. RUNNER~1 or PROGRA~1. */
const SHORT_ALIAS = /^([^~.\\/:]{1,6})~\d+(\.[^.]{0,3})?$/;
/**
 * Equivalence of a canonical path (`a`, from realpath) and a caller-supplied path (`b`). Strict
 * everywhere except Windows, where it is case-insensitive, ignores the extended prefixes, and lets
 * a component of `b` be the 8.3 alias of the corresponding long component of `a`. The alias must
 * share its leading characters with the long name, so an unrelated name never matches.
 */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
 if (platform !== 'win32') return a === b;
 const clean = (p: string) => win32.normalize(p.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\(?=[A-Za-z]:)/, '')).toLowerCase();
 const left = clean(a).split('\\'), right = clean(b).split('\\');
 if (left.length !== right.length) return false;
 return left.every((part, i) => {
  if (part === right[i]) return true;
  const alias = SHORT_ALIAS.exec(right[i]);
  if (!alias) return false;
  // 8.3 generation drops spaces and dots and replaces + , ; = [ ] with underscores.
  const squeezed = part.replace(/[ .]/g, '').replace(/[+,;=[\]]/g, '_');
  const prefix = alias[1].replace(/[ .]/g, '');
  return prefix.length > 0 && squeezed.startsWith(prefix);
 });
}

export function prepareStorage(path: string, source: string, platform: NodeJS.Platform = process.platform): string {
 const dest = resolve(path), root = resolve(source);
 if (inside(dest, root) || inside(root, dest)) throw new Error('UNSAFE_STORAGE');
 try {
  if (platform === 'win32' && (isWindowsNetworkPath(path) || isWindowsNetworkPath(dest))) throw new Error('UNSAFE_STORAGE');
  noSymlinks(dest);
  for (let p = dest;; p = dirname(p)) {
   if (existsSync(join(p, '.git')) || /^(Kiro|kiro-cli|\.kiro)$/i.test(p.split(/[\\/]/).at(-1)!)) throw new Error('UNSAFE_STORAGE');
   if (p === dirname(p)) break;
  }
  // Windows ACL enforcement has not been established: its guard fails closed before anything is created.
  const guard = guardFor(process.platform === 'win32' ? 'win32' : platform);
  guard.createDirectory(dest); noSymlinks(dest);
  guard.verifyDirectory(dest);
  return dest;
 } catch (e) {
  // The single allowlisted "unsupported by design" code stays distinguishable from an unsafe directory.
  throw new Error((e as Error)?.message === 'STORAGE_PERMISSIONS_UNSUPPORTED' ? 'STORAGE_PERMISSIONS_UNSUPPORTED' : 'UNSAFE_STORAGE');
 }
}
export function defaultSource(): string { return defaultSourceFor(process.platform, process.env, () => homedir()); }
export function defaultStorage(): string { return defaultStorageFor(process.platform, process.env, () => homedir()); }
