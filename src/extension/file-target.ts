import { lstatSync, realpathSync, statSync } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { defaultSource, inside } from '../paths.ts';

// Vscode-free guards for the two files Bobert may write on request (the recap image and the CSV export). The editor's save dialog picks the
// target; this module decides whether that target may be written and writes it atomically. It returns fixed codes only, never a path.
export type TargetCode = 'invalid_target' | 'forbidden_target' | 'not_regular' | 'write_failed';
export type CheckedTarget = { ok: true; dir: string; name: string; path: string } | { ok: false; code: TargetCode };
const MAX_PATH = 4096;
/** Directory names Kiro uses for its own data (same names as the storage guard) and credential folders; a target below such a folder is refused wherever it is. */
const KIRO_FOLDER_NAME = /^(kiro-cli|\.kiro|\.aws|\.ssh|\.gnupg)$/i;
/** Windows device names are refused as a file name, with or without an extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\s*(\..*)?$/i;

/** macOS and Windows file systems are case-insensitive by default, so comparisons there fold case (comparison only). */
const fold = (p: string, platform: NodeJS.Platform): string => platform === 'darwin' || platform === 'win32' ? p.toLowerCase() : p;
export function foldedInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
 return inside(fold(child, platform), fold(parent, platform));
}
/** Device and inode of an existing path, or null (also where the file system reports no usable inode). */
function identity(path: string): string | null {
 try { const s = statSync(path, { bigint: true }); return s.ino === 0n ? null : `${s.dev}:${s.ino}`; } catch { return null; }
}
/** A path with its symlinks resolved as far as it exists: the deepest existing ancestor is resolved natively and the rest is appended. */
export function realish(path: string): string {
 const rest: string[] = [];
 for (let p = resolve(path);;) {
  try { return join(realpathSync.native(p), ...rest.reverse()); } catch { /* not resolvable here; try the parent */ }
  const parent = dirname(p);
  if (parent === p) return resolve(path);
  rest.push(basename(p)); p = parent;
 }
}
/** Every folder a write must stay out of: the given roots (Bobert storage, configured Kiro source) and Kiro's default data folders. */
export function protectedRoots(extra: readonly string[]): string[] {
 // defaultSource() is the per-platform Kiro data folder: ~/Library/Application Support/Kiro, %APPDATA%\Kiro, or $XDG_CONFIG_HOME|~/.config/Kiro.
 return [...new Set([...extra, defaultSource(), join(homedir(), '.kiro')].filter(p => typeof p === 'string' && p !== '' && isAbsolute(p)))];
}

/**
 * Checks a chosen target: absolute, a final name directly below an existing directory, real location (parent resolved, final name checked)
 * outside every protected root and outside any Kiro-named folder, and not an existing symlink or non-regular file.
 */
export function checkTarget(target: string, protectedPaths: readonly string[], platform: NodeJS.Platform = process.platform): CheckedTarget {
 const fail = (code: TargetCode): CheckedTarget => ({ ok: false, code });
 if (typeof target !== 'string' || target === '' || target.length > MAX_PATH || target.includes('\0') || !isAbsolute(target)) return fail('invalid_target');
 const name = basename(target);
 if (name === '' || name === '.' || name === '..' || name.length > 255 || target.endsWith(sep)) return fail('invalid_target');
 // ':' would address an alternate data stream on NTFS; device names and trailing dots or spaces are special on Windows.
 if (name.includes(':') || (platform === 'win32' && (RESERVED_NAME.test(name) || /[. ]$/.test(name)))) return fail('invalid_target');
 let dir: string;
 try { dir = realpathSync.native(dirname(target)); if (!statSync(dir).isDirectory()) return fail('invalid_target'); } catch { return fail('invalid_target'); }
 const path = join(dir, name);
 // Identity first: the same folder reached through another spelling (case, short names, bind mounts) has the same device and inode.
 const ancestors = new Set<string>();
 for (let p = dir;; p = dirname(p)) { const id = identity(p); if (id) ancestors.add(id); if (dirname(p) === p) break; }
 for (const root of protectedPaths) {
  for (const form of new Set([resolve(root), realish(root)])) {
   if (foldedInside(path, form, platform) || foldedInside(dir, form, platform)) return fail('forbidden_target');
   const id = identity(form);
   if (id && ancestors.has(id)) return fail('forbidden_target');
  }
 }
 if (path.split(sep).some(part => KIRO_FOLDER_NAME.test(part))) return fail('forbidden_target');
 try {
  const stat = lstatSync(path); // lstat: a symlink (even a dangling one) is never followed
  if (!stat.isFile()) return fail('not_regular');
 } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return fail('not_regular'); }
 return { ok: true, dir, name, path };
}

/**
 * Writes `data` to a new temporary file created exclusively in the checked folder, then renames it over the target. The target is checked
 * again just before the rename and the temporary file is removed on every failure. Returns a fixed code; never throws.
 */
export async function writeAtomically(target: Extract<CheckedTarget, { ok: true }>, data: Uint8Array | string, protectedPaths: readonly string[], platform: NodeJS.Platform = process.platform): Promise<'saved' | TargetCode> {
 const temp = join(target.dir, `.bobert-${randomBytes(8).toString('hex')}.tmp`);
 let created = false;
 try {
  const handle = await open(temp, 'wx', 0o600);
  created = true;
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  const again = checkTarget(target.path, protectedPaths, platform); // the folder or the name may have changed since the dialog
  if (!again.ok) throw new Error(again.code);
  await rename(temp, again.path);
  created = false;
  return 'saved';
 } catch (e) {
  if (created) { try { await unlink(temp); } catch { /* nothing more can be done */ } }
  const code = (e as Error)?.message;
  return code === 'forbidden_target' || code === 'not_regular' || code === 'invalid_target' ? code : 'write_failed';
 }
}

/** Default folder offered by the save dialog: Downloads when it exists, otherwise the home folder. Never a workspace. */
export function defaultFolder(home = homedir()): string {
 const downloads = join(home, 'Downloads');
 try { if (statSync(downloads).isDirectory()) return downloads; } catch { /* falls back to the home folder */ }
 return home;
}
