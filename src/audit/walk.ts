import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
export interface WalkLimits { maxEntries: number; maxDepth: number; timeBudgetMs: number; yieldEvery: number }
export const DEFAULT_LIMITS: WalkLimits = { maxEntries: 50_000, maxDepth: 24, timeBudgetMs: 10_000, yieldEvery: 500 };
type Kind = { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean };
type Id = number | bigint;
export interface WalkFs { // injected; deliberately has no way to read contents
 lstat(path: string): Promise<Kind & { size: number; dev: Id; ino: Id }>;
 readdir(path: string): Promise<(Kind & { name: string })[]>;
}
export interface WalkFile { path: string; size: number }
export type WalkReason = 'entry_limit' | 'depth_limit' | 'time_limit' | 'cancelled';
export interface WalkResult {
 status: 'complete' | 'partial' | 'unavailable';
 reasons: WalkReason[];
 code?: 'root_invalid' | 'root_symlink' | 'root_unreadable';
 files: WalkFile[];
 pruned: string[];
 counts: { files: number; dirs: number; symlinks: number; special: number; unreadable: number };
}
const PRUNE = new Set(['.git', '.hg', '.svn', 'node_modules', '.kiro', '.ssh', '.gnupg', '.aws']);
const nodeFs: WalkFs = {
 lstat: async path => { const s = await lstat(path, { bigint: true }); return { isFile: () => s.isFile(), isDirectory: () => s.isDirectory(), isSymbolicLink: () => s.isSymbolicLink(), size: Number(s.size), dev: s.dev, ino: s.ino }; },
 readdir: path => readdir(path, { withFileTypes: true }),
};
const byName = (a: { name: string }, b: { name: string }) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
const same = (a: Id, b: Id) => String(a) === String(b);
export async function walkWorkspace(root: string, options: { limits?: Partial<WalkLimits>; signal?: AbortSignal; fs?: WalkFs; now?: () => number } = {}): Promise<WalkResult> {
 const limits = { ...DEFAULT_LIMITS }; for (const [k, v] of Object.entries(options.limits ?? {})) if (typeof v === 'number' && Number.isFinite(v) && v >= (k === 'yieldEvery' ? 1 : 0)) (limits as Record<string, number>)[k] = v;
 const fs = options.fs ?? nodeFs, now = options.now ?? Date.now, signal = options.signal, yieldEvery = Math.floor(limits.yieldEvery);
 const files: WalkFile[] = [], pruned: string[] = [], reasons: WalkReason[] = [];
 const counts = { files: 0, dirs: 0, symlinks: 0, special: 0, unreadable: 0 };
 const result = (status: WalkResult['status'], code?: WalkResult['code']): WalkResult => ({ status, reasons, ...(code ? { code } : {}), files, pruned, counts });
 if (!isAbsolute(root)) return result('unavailable', 'root_invalid');
 let rootId: { dev: Id; ino: Id };
 try {
  const st = await fs.lstat(root);
  if (st.isSymbolicLink()) return result('unavailable', 'root_symlink');
  if (!st.isDirectory()) return result('unavailable', 'root_invalid');
  rootId = { dev: st.dev, ino: st.ino };
 } catch { return result('unavailable', 'root_unreadable'); }
 const note = (reason: WalkReason) => { if (!reasons.includes(reason)) reasons.push(reason); };
 const started = now();
 const stop = () => { if (signal?.aborted) note('cancelled'); else if (now() - started > limits.timeBudgetMs) note('time_limit'); else return false; return true; };
 // Residual: an ABA swap between the before/after checks (directory swapped and restored) cannot be fully excluded without openat/O_NOFOLLOW, which Node lacks.
 const intact = async (abs: string, id: { dev: Id; ino: Id }) => { try { const st = await fs.lstat(abs); return st.isDirectory() && !st.isSymbolicLink() && same(st.dev, id.dev) && same(st.ino, id.ino) && same(st.dev, rootId.dev); } catch { return false; } };
 const queue: { abs: string; rel: string; depth: number; dev: Id; ino: Id }[] = [{ abs: root, rel: '', depth: 0, ...rootId }];
 let entries = 0, ticks = 0, halted = false;
 for (let head = 0; head < queue.length && !halted; head++) {
  const dir = queue[head]!;
  if (stop()) break;
  let list;
  try {
   if (!await intact(dir.abs, dir)) throw new Error('changed');
   list = (await fs.readdir(dir.abs)).slice().sort(byName);
   if (!await intact(dir.abs, dir)) throw new Error('changed');
  } catch { if (head === 0) return result('unavailable', 'root_unreadable'); counts.unreadable++; continue; }
  // Buffer this directory's results; commit them only if the directory is still intact afterwards.
  const b = { queue: [] as typeof queue, files: [] as WalkFile[], pruned: [] as string[], symlinks: 0, special: 0, unreadable: 0 };
  let used = 0;
  for (const entry of list) {
   if (++ticks % yieldEvery === 0) { await new Promise<void>(r => setImmediate(r)); if (stop()) { halted = true; break; } }
   const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;
   if (entry.isSymbolicLink()) { b.symlinks++; continue; }
   if (entry.isDirectory()) {
    const skip = PRUNE.has(entry.name.toLowerCase());
    if (!skip && dir.depth + 1 > limits.maxDepth) { note('depth_limit'); continue; }
    if (entries + used >= limits.maxEntries) { note('entry_limit'); halted = true; break; }
    if (skip) { used++; b.pruned.push(rel); continue; }
    const abs = join(dir.abs, entry.name);
    try {
     const st = await fs.lstat(abs);
     if (st.isSymbolicLink()) { b.symlinks++; continue; }
     if (!st.isDirectory() || !same(st.dev, rootId.dev)) { b.unreadable++; continue; }
     used++; b.queue.push({ abs, rel, depth: dir.depth + 1, dev: st.dev, ino: st.ino });
    } catch { b.unreadable++; }
   } else if (entry.isFile()) {
    if (entries + used >= limits.maxEntries) { note('entry_limit'); halted = true; break; }
    try {
     const st = await fs.lstat(join(dir.abs, entry.name));
     if (!st.isFile()) { b.unreadable++; continue; }
     used++; b.files.push({ path: rel, size: st.size });
    } catch { b.unreadable++; }
   } else b.special++;
  }
  if (!await intact(dir.abs, dir)) { if (head === 0) return result('unavailable', 'root_unreadable'); counts.unreadable++; continue; }
  entries += used; queue.push(...b.queue); files.push(...b.files); pruned.push(...b.pruned);
  counts.files += b.files.length; counts.symlinks += b.symlinks; counts.special += b.special; counts.unreadable += b.unreadable;
  if (head > 0) counts.dirs++;
 }
 return result(reasons.length ? 'partial' : 'complete');
}
