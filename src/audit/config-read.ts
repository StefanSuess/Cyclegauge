import { createHash } from 'node:crypto';
import { opendir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { nodeFs, readBounded, type ReadFs, type Id } from './read-bounded.ts';
import { hasFrontMatter, parseSteering, parseHooks, type SteeringConfig, type HookParseResult } from './config-parse.ts';
export const CONFIG_LIMITS = { entries: 500, files: 100, steeringBytes: 2048, hookBytes: 65536, runBytes: Math.floor(3.6 * 1024 * 1024), timeMs: 3000 };
export type ConfigKind = 'steering' | 'hooks';
export type ConfigReadCode = 'not_allowed' | 'folder_symlink' | 'file_unsafe' | 'link_not_followed' | 'folder_unreadable' | 'file_unreadable' | 'file_too_large' | 'too_many_entries' | 'limit_bytes' | 'time_limit' | 'cancelled';
type Failure = { code: ConfigReadCode };
type Absent = { absent: true };
type Stat = Awaited<ReturnType<ReadFs['lstat']>>;
export interface ConfigDirectory { read(): Promise<{ name: string; isDirectory(): boolean } | null>; close(): Promise<void> }
export interface ConfigFs extends ReadFs { opendir(path: string): Promise<ConfigDirectory> }
export const configFs: ConfigFs = { ...nodeFs, opendir: async path => { const d = await opendir(path); return { read: () => d.read(), close: () => d.close() }; } };
interface Io { fs?: ConfigFs; signal?: AbortSignal; now?: () => number; budget?: ConfigBudget }
export interface ConfigBudget { bytesRead: number; maxBytes: number; started: number; matcherKey(value: string): number }
// Share this object across every root in a run. Only matcher digests and ordinals are retained.
export function createConfigBudget(options: { now?: () => number } = {}): ConfigBudget {
 const keys = new Map<string, number>();
 return { bytesRead: 0, maxBytes: CONFIG_LIMITS.runBytes, started: (options.now ?? Date.now)(), matcherKey: value => { const digest = createHash('sha256').update(value, 'utf16le').digest('hex'); if (!keys.has(digest)) keys.set(digest, keys.size); return keys.get(digest)!; } };
}
// What a review saw of one file: its size, modification time (when the file system reports one) and a digest of the bytes the review read.
// An apply action compares it with a fresh read, so a file changed since the review is never edited. Digests and numbers only, never text.
export interface FileStamp { size: number; mtimeMs?: number; digest: string }
export const stampKey = (root: number, rel: string): string => `${root}\0${rel}`;
export const sameStamp = (a: FileStamp | undefined, b: FileStamp | undefined): boolean => a !== undefined && b !== undefined && a.size === b.size && a.digest === b.digest && (a.mtimeMs === undefined || b.mtimeMs === undefined || a.mtimeMs === b.mtimeMs);
const stampOf = (bytes: Uint8Array, size: number, mtimeMs: number | undefined): FileStamp => ({ size, ...(mtimeMs === undefined ? {} : { mtimeMs }), digest: createHash('sha256').update(bytes).digest('hex') });
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}/\\]/u;
const safeName = (name: string) => name !== '' && name !== '.' && name !== '..' && name.length <= 255 && !UNSAFE.test(name);
export function configPathAllowed(rel: string, kind: ConfigKind): boolean {
 if (typeof rel !== 'string') return false;
 const parts = rel.split('/');
 return parts.length === 3 && parts[0] === '.kiro' && parts[1] === kind && safeName(parts[2]!) && parts[2]!.toLowerCase().endsWith(kind === 'hooks' ? '.json' : '.md');
}
const same = (a: Id, b: Id) => String(a) === String(b);
const identity = (a: Stat, b: Stat) => same(a.dev, b.dev) && same(a.ino, b.ino);
// Inspect only the fixed errno. Neither exception text nor data-bearing values can leave this helper.
const absent = (reason: unknown) => typeof reason === 'object' && reason !== null && Object.hasOwn(reason, 'code') && (reason as { code?: unknown }).code === 'ENOENT';
async function attempt<T>(operation: () => Promise<T>, code: ConfigReadCode): Promise<{ value: T } | Failure | Absent> {
 return Promise.resolve().then(operation).then(value => ({ value }), reason => absent(reason) ? { absent: true as const } : { code });
}
const stop = (budget: ConfigBudget | undefined, io: Io): Failure | undefined => io.signal?.aborted ? { code: 'cancelled' } : budget && (io.now ?? Date.now)() - budget.started > CONFIG_LIMITS.timeMs ? { code: 'time_limit' } : undefined;
// Test each ancestor separately: permission/I/O failure is never mistaken for absence.
async function directories(root: string, rel: string, io: Io): Promise<{ dirs: Stat[] } | Failure | Absent> {
 if (typeof root !== 'string' || !isAbsolute(root)) return { code: 'not_allowed' };
 const fs = io.fs ?? configFs, dirs: Stat[] = []; let path = root;
 for (const part of ['', ...rel.split('/').slice(0, -1)]) {
  const halted = stop(io.budget, io); if (halted) return halted;
  if (part) path = join(path, part);
  const r = await attempt(() => fs.lstat(path), 'folder_unreadable'); if (!('value' in r)) return r;
  const st = r.value;
  if (st.isSymbolicLink()) return { code: 'folder_symlink' };
  if (!st.isDirectory() || (dirs.length > 0 && !same(st.dev, dirs[0]!.dev))) return { code: 'file_unsafe' };
  dirs.push(st);
 }
 return { dirs };
}
export async function listConfigFiles(root: string, kind: ConfigKind, io: Io = {}): Promise<{ files: string[]; omitted: number; unsafe: number; nested: number } | Failure | Absent> {
 if (kind !== 'steering' && kind !== 'hooks') return { code: 'not_allowed' };
 const rel = `.kiro/${kind}/synthetic-placeholder`, before = await directories(root, rel, io);
 if (!('dirs' in before)) return before;
 const fs = io.fs ?? configFs, opened = await attempt(() => fs.opendir(join(root, '.kiro', kind)), 'folder_unreadable');
 if (!('value' in opened)) return opened;
 const dir = opened.value, names: string[] = []; let unsafe = 0, nested = 0;
 try {
  for (let count = 0; ; count++) {
   const halted = stop(io.budget, io); if (halted) return halted;
   const r = await attempt(() => dir.read(), 'folder_unreadable'); if (!('value' in r)) return { code: 'folder_unreadable' };
   const entry = r.value; if (entry === null) break;
   if (count === CONFIG_LIMITS.entries) return { code: 'too_many_entries' };
   if (!safeName(entry.name)) { unsafe++; continue; }
   if (entry.isDirectory()) { nested++; continue; }
   if (entry.name.toLowerCase().endsWith(kind === 'hooks' ? '.json' : '.md')) names.push(entry.name);
  }
  const after = await directories(root, rel, io);
  if (!('dirs' in after) || after.dirs.length !== before.dirs.length || !after.dirs.every((d, i) => identity(d, before.dirs[i]!))) return { code: 'folder_unreadable' };
  names.sort();
  return { files: names.slice(0, CONFIG_LIMITS.files).map(name => `.kiro/${kind}/${name}`), omitted: Math.max(0, names.length - CONFIG_LIMITS.files), unsafe, nested };
 } catch { return { code: 'folder_unreadable' }; }
 finally { await dir.close().catch(() => undefined); }
}
async function fileStat(root: string, rel: string, io: Io): Promise<{ size: number; mtimeMs?: number } | Failure | Absent> {
 const before = await directories(root, rel, io); if (!('dirs' in before)) return before;
 const fs = io.fs ?? configFs, r = await attempt(() => fs.lstat(join(root, ...rel.split('/'))), 'file_unreadable'); if (!('value' in r)) return r;
 const st = r.value;
 if (st.isSymbolicLink()) return { code: rel === 'AGENTS.md' ? 'link_not_followed' : 'file_unsafe' };
 if (!st.isFile() || !same(st.dev, before.dirs[0]!.dev)) return { code: 'file_unsafe' };
 const after = await directories(root, rel, io);
 if (!('dirs' in after) || after.dirs.length !== before.dirs.length || !after.dirs.every((d, i) => identity(d, before.dirs[i]!))) return { code: 'file_unreadable' };
 const halted = stop(io.budget, io); return halted ?? { size: st.size, ...(typeof st.mtimeMs === 'number' ? { mtimeMs: st.mtimeMs } : {}) };
}
export async function statAgents(root: string, io: Io = {}): Promise<{ size: number } | Failure | Absent> { const r = await fileStat(root, 'AGENTS.md', io); return 'size' in r ? { size: r.size } : r; }
async function readConfig(root: string, rel: string, kind: ConfigKind, budget: ConfigBudget, io: Io) {
 if (!configPathAllowed(rel, kind)) return { code: 'not_allowed' } as Failure;
 const halted = stop(budget, io); if (halted) return halted;
 const st = await fileStat(root, rel, { ...io, budget }); if (!('size' in st)) return st;
 const preRead = stop(budget, io); if (preRead) return preRead;
 if (kind === 'hooks' && st.size > CONFIG_LIMITS.hookBytes) return { code: 'file_too_large' } as Failure;
 if (kind === 'hooks' && budget.bytesRead + st.size > budget.maxBytes) return { code: 'limit_bytes' } as Failure;
 let limit: Failure | undefined;
 const consume = (n: number) => {
  if (n <= 0) { budget.bytesRead += n; return true; }
  limit = stop(budget, io);
  if (!limit && budget.bytesRead + n > budget.maxBytes) limit = { code: 'limit_bytes' };
  if (limit) return false;
  budget.bytesRead += n; return true;
 };
 const r = await readBounded(root, rel, { mode: kind === 'steering' ? 'prefix' : 'whole', maxBytes: kind === 'steering' ? CONFIG_LIMITS.steeringBytes : CONFIG_LIMITS.hookBytes, allow: path => configPathAllowed(path, kind), ...(kind === 'steering' ? { initialBytes: 5, continueIf: hasFrontMatter } : { singleLink: true }), consume }, { fs: io.fs ?? configFs, signal: io.signal });
 if (limit) return limit;
 const late = stop(budget, io); if (late) { if ('bytes' in r) r.wipe(); return late; }
 if ('code' in r) return { code: r.code === 'aborted' ? 'cancelled' : r.code === 'not_allowed' ? 'not_allowed' : r.code === 'unsafe' || r.code === 'changed' ? 'file_unsafe' : r.code === 'oversized' ? 'file_too_large' : 'file_unreadable' } as Failure;
 return { ...r, mtimeMs: st.mtimeMs };
}
export async function readSteeringFile(root: string, rel: string, budget: ConfigBudget, io: Io = {}): Promise<{ entry: SteeringConfig; stamp: FileStamp } | Failure | Absent> {
 const r = await readConfig(root, rel, 'steering', budget, io); if (!('bytes' in r)) return r;
 try { return { entry: parseSteering(r.bytes, r.size!), stamp: stampOf(r.bytes, r.size!, r.mtimeMs) }; } finally { r.wipe(); }
}
export async function readHookFile(root: string, rel: string, budget: ConfigBudget, io: Io = {}): Promise<(Exclude<HookParseResult, { code: string }> & { stamp: FileStamp }) | Extract<HookParseResult, { code: string }> | Failure | Absent> {
 const r = await readConfig(root, rel, 'hooks', budget, io); if (!('bytes' in r)) return r;
 try { const parsed = parseHooks(r.bytes, budget.matcherKey); return 'hooks' in parsed ? { ...parsed, stamp: stampOf(r.bytes, r.size!, r.mtimeMs) } : parsed; } finally { r.wipe(); }
}
/**
 * The same allowlisted, guarded read as the review, for an apply action: the approved Steering prefix (5 bytes, or up to 2 KiB behind a front-matter opener)
 * or the Hook JSON (up to 64 KiB). The caller must call `wipe()`; the bytes are used for one edit computation and dropped.
 */
export async function readConfigForEdit(root: string, rel: string, kind: ConfigKind, io: Io = {}): Promise<{ bytes: Uint8Array; size: number; stamp: FileStamp; wipe(): void } | Failure | Absent> {
 const r = await readConfig(root, rel, kind, createConfigBudget(io.now ? { now: io.now } : {}), io); if (!('bytes' in r)) return r;
 return { bytes: r.bytes, size: r.size!, stamp: stampOf(r.bytes, r.size!, r.mtimeMs), wipe: r.wipe };
}
