import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkWorkspace, DEFAULT_LIMITS, type WalkFs, type WalkResult } from '../../src/audit/walk.ts';
const temp = async () => { const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-audit-')); const root = join(base, 'synthetic-root'); await mkdir(root); return { base, root }; };
const put = async (root: string, rel: string, text = '') => { const p = join(root, ...rel.split('/')); await mkdir(join(p, '..'), { recursive: true }); await writeFile(p, text); };
const paths = (r: WalkResult) => r.files.map(f => f.path);
type Node = { dir?: string[]; file?: number; link?: true; special?: true; dev?: number; ino?: number };
// Fake in-memory tree keyed by '/'-separated path relative to '/synthetic-root'; records every call.
const fake = (tree: Record<string, Node>, fail: Record<string, string> = {}) => {
 const calls: string[] = [];
 const key = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '').replace(/^\/synthetic-root\/?/, '');
 const kind = (n: Node) => ({ isFile: () => n.file !== undefined, isDirectory: () => n.dir !== undefined, isSymbolicLink: () => !!n.link });
 const guard = (k: string) => { if (fail[k]) throw Object.assign(new Error('synthetic-failure'), { code: fail[k] }); };
 const fs: WalkFs = {
  async lstat(p) { calls.push('lstat'); const k = key(p); guard(k); const n = tree[k]; if (!n) throw Object.assign(new Error('x'), { code: 'ENOENT' }); return { ...kind(n), size: n.file ?? 0, dev: n.dev ?? 1, ino: n.ino ?? Object.keys(tree).indexOf(k) + 1 }; },
  async readdir(p) { calls.push('readdir'); const k = key(p); guard(k); const n = tree[k]; if (!n?.dir) throw Object.assign(new Error('x'), { code: 'ENOENT' }); return n.dir.map(name => ({ name, ...kind(tree[k ? `${k}/${name}` : name]!) })); },
 };
 return { fs, calls, key };
};
const fresh = () => structuredClone(sample);
const sample: Record<string, Node> = { '': { dir: ['synthetic-b', 'synthetic-a.txt', 'synthetic-c'] }, 'synthetic-a.txt': { file: 3 }, 'synthetic-b': { dir: ['synthetic-d.txt'] }, 'synthetic-b/synthetic-d.txt': { file: 5 }, 'synthetic-c': { dir: [] } };
test('walks nested files breadth-first with sizes, relative paths and counts', async () => {
 const t = await temp();
 await put(t.root, 'synthetic-z.txt', 'zz'); await put(t.root, 'synthetic-a/synthetic-deep/synthetic-n.txt', 'nnnn'); await put(t.root, 'synthetic-a/synthetic-m.txt', 'm'); await mkdir(join(t.root, 'synthetic-empty'));
 const r = await walkWorkspace(t.root);
 assert.equal(r.status, 'complete'); assert.deepEqual(r.reasons, []); assert.equal(r.code, undefined);
 assert.deepEqual(r.files, [{ path: 'synthetic-z.txt', size: 2 }, { path: 'synthetic-a/synthetic-m.txt', size: 1 }, { path: 'synthetic-a/synthetic-deep/synthetic-n.txt', size: 4 }]);
 assert.deepEqual(r.counts, { files: 3, dirs: 3, symlinks: 0, special: 0, unreadable: 0 }); assert.deepEqual(r.pruned, []);
 assert.deepEqual(await walkWorkspace(t.root), r); assert.equal(DEFAULT_LIMITS.maxEntries, 50_000);
 await rm(t.base, { recursive: true });
});
test('prunes sensitive and vendor directories at any depth, case-insensitively', async () => {
 const t = await temp();
 for (const d of ['.git', 'Node_Modules', '.KIRO', '.ssh', '.gnupg', '.aws', '.hg', '.svn']) await put(t.root, `${d}/synthetic-hidden.txt`);
 await put(t.root, 'synthetic-pkg/node_modules/synthetic-hidden.txt'); await put(t.root, 'synthetic-pkg/synthetic-ok.txt', 'ok'); await put(t.root, '.gitignore', 'x');
 const r = await walkWorkspace(t.root);
 assert.equal(r.status, 'complete'); assert.deepEqual(paths(r), ['.gitignore', 'synthetic-pkg/synthetic-ok.txt']);
 assert.deepEqual(r.pruned, ['.KIRO', '.aws', '.git', '.gnupg', '.hg', '.ssh', '.svn', 'Node_Modules', 'synthetic-pkg/node_modules']);
 assert.equal(r.counts.dirs, 1); await rm(t.base, { recursive: true });
});
test('does not list or follow symlinks and junctions', async () => {
 const t = await temp(); const outside = join(t.base, 'synthetic-outside'); await put(outside, 'synthetic-secret.txt', 'outside'); await put(t.root, 'synthetic-real.txt', 'r');
 await symlink(join(outside, 'synthetic-secret.txt'), join(t.root, 'synthetic-file-link'));
 await symlink(outside, join(t.root, 'synthetic-dir-link'), process.platform === 'win32' ? 'junction' : 'dir');
 const r = await walkWorkspace(t.root);
 assert.equal(r.status, 'complete'); assert.deepEqual(paths(r), ['synthetic-real.txt']); assert.equal(r.counts.symlinks, 2); assert.equal(r.counts.dirs, 0);
 assert.ok(!JSON.stringify(r).includes('secret')); await rm(t.base, { recursive: true });
});
test('counts entries that are neither file, directory nor symlink as special', async () => {
 const { fs } = fake({ '': { dir: ['synthetic-pipe', 'synthetic-a.txt'] }, 'synthetic-pipe': { special: true }, 'synthetic-a.txt': { file: 1 } });
 const r = await walkWorkspace('/synthetic-root', { fs });
 assert.equal(r.status, 'complete'); assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.special, 1);
});
test('reports unavailable for invalid, symlink, missing and unreadable roots', async () => {
 const t = await temp(); await put(t.base, 'synthetic-file.txt', 'f'); await symlink(t.root, join(t.base, 'synthetic-root-link'), process.platform === 'win32' ? 'junction' : 'dir');
 const code = async (p: string) => { const r = await walkWorkspace(p); assert.equal(r.status, 'unavailable'); assert.deepEqual(r.files, []); assert.deepEqual(r.reasons, []); return r.code; };
 assert.equal(await code(join(t.base, 'synthetic-file.txt')), 'root_invalid'); assert.equal(await code('synthetic-relative'), 'root_invalid');
 assert.equal(await code(join(t.base, 'synthetic-root-link')), 'root_symlink'); assert.equal(await code(join(t.base, 'synthetic-missing')), 'root_unreadable');
 const { fs } = fake(sample, { '': 'EACCES' }); assert.equal((await walkWorkspace('/synthetic-root', { fs })).code, 'root_unreadable');
 await rm(t.base, { recursive: true });
});
test('stops at the entry limit and returns a partial result', async () => {
 const { fs } = fake(sample);
 const r = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: 2 } });
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['entry_limit']); assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.files, 1);
 const exact = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: 4 } }); assert.equal(exact.status, 'complete'); assert.equal(exact.files.length, 2);
});
test('does not enter directories deeper than maxDepth', async () => {
 const t = await temp(); await put(t.root, 'synthetic-top.txt'); await put(t.root, 'synthetic-a/synthetic-mid.txt'); await put(t.root, 'synthetic-a/synthetic-b/synthetic-low.txt');
 const r = await walkWorkspace(t.root, { limits: { maxDepth: 1 } });
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['depth_limit']); assert.deepEqual(paths(r), ['synthetic-top.txt', 'synthetic-a/synthetic-mid.txt']);
 const zero = await walkWorkspace(t.root, { limits: { maxDepth: 0 } }); assert.deepEqual(paths(zero), ['synthetic-top.txt']); assert.deepEqual(zero.reasons, ['depth_limit']);
 assert.equal((await walkWorkspace(t.root, { limits: { maxDepth: 2 } })).status, 'complete'); await rm(t.base, { recursive: true });
});
test('stops when the injected clock exceeds the time budget', async () => {
 const { fs } = fake(sample); let tick = 0;
 const r = await walkWorkspace('/synthetic-root', { fs, limits: { timeBudgetMs: 1 }, now: () => tick++ * 10 });
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['time_limit']); assert.ok(r.files.length < 2);
});
test('stops on cancellation, before and during the walk', async () => {
 const { fs } = fake(sample); const before = new AbortController(); before.abort();
 const r0 = await walkWorkspace('/synthetic-root', { fs, signal: before.signal }); assert.equal(r0.status, 'partial'); assert.deepEqual(r0.reasons, ['cancelled']); assert.deepEqual(r0.files, []);
 const mid = new AbortController(); let n = 0; const counted = { ...fs, async lstat(p: string) { const s = await fs.lstat(p); if (++n === 4) mid.abort(); return s; } };
 const r1 = await walkWorkspace('/synthetic-root', { fs: counted, signal: mid.signal, limits: { yieldEvery: 1 } });
 assert.equal(r1.status, 'partial'); assert.deepEqual(r1.reasons, ['cancelled']); assert.equal(r1.files.length, 1);
});
test('counts unreadable entries and continues without leaking errors or paths', async () => {
 const { fs } = fake(sample, { 'synthetic-b': 'EACCES', 'synthetic-a.txt': 'ENOENT' });
 const r = await walkWorkspace('/synthetic-root', { fs });
 assert.equal(r.status, 'complete'); assert.deepEqual(r.files, []); assert.equal(r.counts.unreadable, 2); assert.equal(r.counts.dirs, 1);
 assert.ok(!JSON.stringify(r).includes('EACCES')); assert.ok(!JSON.stringify(r).includes('synthetic-failure'));
 const ok = await walkWorkspace('/synthetic-root', { fs: fake(sample, { 'synthetic-c': 'EACCES' }).fs }); assert.deepEqual(paths(ok), ['synthetic-a.txt', 'synthetic-b/synthetic-d.txt']); assert.equal(ok.counts.unreadable, 1);
});
test('only ever calls lstat and readdir on the injected filesystem', async () => {
 const { fs, calls } = fake(sample); const seen = new Set<string>();
 const proxy = new Proxy(fs, { get(target, prop) { seen.add(String(prop)); return Reflect.get(target, prop); } });
 const r = await walkWorkspace('/synthetic-root', { fs: proxy }); assert.equal(r.status, 'complete');
 assert.deepEqual([...seen].sort(), ['lstat', 'readdir']); assert.ok(calls.every(c => c === 'lstat' || c === 'readdir')); assert.ok(calls.length > 0);
});
test('yields to the event loop only when yieldEvery is reached', async () => {
 const { fs } = fake(sample); let ran = false; setImmediate(() => { ran = true; });
 const r = await walkWorkspace('/synthetic-root', { fs, limits: { yieldEvery: 1 } });
 assert.equal(ran, true); assert.equal(r.status, 'complete'); assert.equal(r.files.length, 2);
 let late = false; setImmediate(() => { late = true; });
 await walkWorkspace('/synthetic-root', { fs, limits: { yieldEvery: 1_000_000 } }); assert.equal(late, false); await new Promise(r => setImmediate(r));
});
test('stops when the time budget expires after the first directory', async () => {
 const f = fake(sample); let clock = 0; const fs: WalkFs = { lstat: f.fs.lstat, async readdir(p) { const l = await f.fs.readdir(p); clock += 100; return l; } };
 const r = await walkWorkspace('/synthetic-root', { fs, limits: { timeBudgetMs: 50 }, now: () => clock });
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['time_limit']); assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.dirs, 0);
});
test('counts pruned directories toward the entry limit', async () => {
 const tree: Record<string, Node> = { '': { dir: ['.git', 'node_modules', 'synthetic-a.txt'] }, '.git': { dir: [] }, node_modules: { dir: [] }, 'synthetic-a.txt': { file: 1 } };
 const r = await walkWorkspace('/synthetic-root', { fs: fake(tree).fs, limits: { maxEntries: 1 } });
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['entry_limit']); assert.deepEqual(r.pruned, ['.git']); assert.deepEqual(r.files, []);
 assert.equal((await walkWorkspace('/synthetic-root', { fs: fake(tree).fs, limits: { maxEntries: 3 } })).status, 'complete');
});
test('ignores non-finite and negative limit overrides', async () => {
 const { fs } = fake(sample);
 const r = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: Infinity, maxDepth: -1, timeBudgetMs: NaN, yieldEvery: 0 } });
 assert.equal(r.status, 'complete'); assert.equal(r.files.length, 2);
 const neg = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: -5, yieldEvery: -1 } }); assert.deepEqual(neg, r);
 const zero = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: 0 } }); assert.equal(zero.status, 'partial'); assert.deepEqual(zero.reasons, ['entry_limit']);
});
test('does not descend when the queue-time lstat reports a symlink for a listed directory', async () => {
 const f = fake(sample); const fs: WalkFs = { ...f.fs, async lstat(p) { const st = await f.fs.lstat(p); return f.key(p) === 'synthetic-b' ? { ...st, isDirectory: () => false, isSymbolicLink: () => true } : st; } };
 const r = await walkWorkspace('/synthetic-root', { fs });
 assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.symlinks, 1); assert.equal(r.counts.dirs, 1);
});
test('discards a directory whose inode changes between queueing and readdir', async () => {
 const tree = fresh(); const f = fake(tree); let first = true;
 const fs: WalkFs = { ...f.fs, async lstat(p) { const st = await f.fs.lstat(p); if (f.key(p) === 'synthetic-b' && first) { first = false; tree['synthetic-b']!.ino = 999; } return st; } };
 const r = await walkWorkspace('/synthetic-root', { fs });
 assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.unreadable, 1); assert.equal(r.counts.dirs, 1);
});
test('discards a listing when the post-readdir lstat no longer matches', async () => {
 const tree = fresh(); const f = fake(tree);
 const fs: WalkFs = { ...f.fs, async readdir(p) { const l = await f.fs.readdir(p); if (f.key(p) === 'synthetic-b') tree['synthetic-b']!.ino = 999; return l; } };
 const r = await walkWorkspace('/synthetic-root', { fs });
 assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.unreadable, 1); assert.equal(r.counts.dirs, 1);
 const swapped = fresh(); const g = fake(swapped);
 const fs2: WalkFs = { ...g.fs, async readdir(p) { const l = await g.fs.readdir(p); if (g.key(p) === 'synthetic-b') swapped['synthetic-b'] = { link: true }; return l; } };
 assert.deepEqual(paths(await walkWorkspace('/synthetic-root', { fs: fs2 })), ['synthetic-a.txt']);
});
test('discards a directory swapped while its entries are being processed', async () => {
 const tree = fresh(); tree['synthetic-b']!.dir = ['synthetic-d.txt', 'synthetic-e']; tree['synthetic-b/synthetic-e'] = { dir: ['synthetic-f.txt'] }; tree['synthetic-b/synthetic-e/synthetic-f.txt'] = { file: 7 };
 const f = fake(tree);
 const fs: WalkFs = { ...f.fs, async lstat(p) { const st = await f.fs.lstat(p); if (f.key(p) === 'synthetic-b/synthetic-d.txt') tree['synthetic-b']!.ino = 999; return st; } };
 const r = await walkWorkspace('/synthetic-root', { fs });
 assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.unreadable, 1); assert.equal(r.counts.dirs, 1); assert.equal(r.counts.files, 1);
});
test('does not cross onto a different device', async () => {
 const tree = fresh(); tree['synthetic-b']!.dev = 2;
 const r = await walkWorkspace('/synthetic-root', { fs: fake(tree).fs });
 assert.deepEqual(paths(r), ['synthetic-a.txt']); assert.equal(r.counts.unreadable, 1); assert.equal(r.counts.dirs, 1);
});
test('source imports only lstat and readdir from node:fs/promises', async () => {
 const src = await readFile(fileURLToPath(new URL('../../src/audit/walk.ts', import.meta.url)), 'utf8');
 assert.deepEqual(src.split('\n').filter(l => /node:fs/.test(l)), ["import { lstat, readdir } from 'node:fs/promises';"]);
 assert.ok(!/from 'node:fs'/.test(src)); assert.ok(!/\b(open|readFile|readFileSync|createReadStream|writeFile|console)\b/.test(src));
});
test('result contains no absolute paths', async () => {
 const t = await temp(); await put(t.root, 'synthetic-a/synthetic-b.txt', 'b'); await put(t.root, 'node_modules/synthetic-c.txt');
 const r = await walkWorkspace(t.root); const all = [...paths(r), ...r.pruned];
 assert.ok(all.length > 0); for (const p of all) { assert.ok(!p.startsWith(t.root)); assert.ok(!p.startsWith('/')); assert.ok(!/^[A-Za-z]:/.test(p)); assert.ok(!p.includes('\\')); }
 assert.ok(!JSON.stringify(r).includes(t.base)); await rm(t.base, { recursive: true });
});
test('reports the one directory whose listing was halted part-way', async () => {
 const { fs } = fake(sample);
 const root = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: 2 } });
 assert.equal(root.status, 'partial'); assert.equal(root.incomplete, '');
 const nested = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: 3 } });
 assert.equal(nested.status, 'partial'); assert.deepEqual(nested.reasons, ['entry_limit']); assert.equal(nested.incomplete, 'synthetic-b');
 const done = await walkWorkspace('/synthetic-root', { fs, limits: { maxEntries: 4 } });
 assert.equal(done.status, 'complete'); assert.equal('incomplete' in done, false);
 const mid = new AbortController(); let n = 0; const counted = { ...fs, async lstat(p: string) { const s = await fs.lstat(p); if (++n === 4) mid.abort(); return s; } };
 const cancelled = await walkWorkspace('/synthetic-root', { fs: counted, signal: mid.signal, limits: { yieldEvery: 1 } });
 assert.deepEqual(cancelled.reasons, ['cancelled']); assert.equal(typeof cancelled.incomplete, 'string');
});
test('does not report incomplete for unavailable roots or limits that skip whole directories', async () => {
 const { fs } = fake(sample);
 const before = new AbortController(); before.abort();
 assert.equal('incomplete' in await walkWorkspace('/synthetic-root', { fs, signal: before.signal }), false);
 const t = await temp(); await put(t.root, 'synthetic-a/synthetic-b/synthetic-low.txt');
 const deep = await walkWorkspace(t.root, { limits: { maxDepth: 1 } }); assert.equal(deep.status, 'partial'); assert.equal('incomplete' in deep, false);
 assert.equal('incomplete' in await walkWorkspace(join(t.base, 'synthetic-missing')), false); await rm(t.base, { recursive: true });
});
test('lists symlink entries by relative path without following them and counts them toward the entry limit', async () => {
 const t = await temp(); const outside = join(t.base, 'synthetic-outside'); await put(outside, 'synthetic-secret.txt', 'outside'); await put(t.root, 'synthetic-real.txt', 'r'); await put(t.root, 'synthetic-sub/synthetic-x.txt', 'x');
 await symlink(join(outside, 'synthetic-secret.txt'), join(t.root, 'synthetic-file-link')); await symlink(outside, join(t.root, 'synthetic-sub', 'synthetic-dir-link'), process.platform === 'win32' ? 'junction' : 'dir');
 const r = await walkWorkspace(t.root);
 assert.deepEqual(r.links, ['synthetic-file-link', 'synthetic-sub/synthetic-dir-link']); assert.equal(r.counts.symlinks, 2); assert.ok(!JSON.stringify(r.links).includes(t.base)); assert.deepEqual(paths(r), ['synthetic-real.txt', 'synthetic-sub/synthetic-x.txt']);
 const tree: Record<string, Node> = { '': { dir: ['synthetic-a', 'synthetic-b', 'synthetic-c'] }, 'synthetic-a': { link: true }, 'synthetic-b': { link: true }, 'synthetic-c': { file: 1 } };
 const limited = await walkWorkspace('/synthetic-root', { fs: fake(tree).fs, limits: { maxEntries: 2 } });
 assert.equal(limited.status, 'partial'); assert.deepEqual(limited.reasons, ['entry_limit']); assert.deepEqual(limited.links, ['synthetic-a', 'synthetic-b']); assert.deepEqual(limited.files, []); assert.equal(limited.incomplete, '');
 assert.equal((await walkWorkspace('/synthetic-root', { fs: fake(tree).fs, limits: { maxEntries: 3 } })).status, 'complete');
 const f = fake(sample); const fs: WalkFs = { ...f.fs, async lstat(p) { const st = await f.fs.lstat(p); return f.key(p) === 'synthetic-b' ? { ...st, isDirectory: () => false, isSymbolicLink: () => true } : st; } };
 assert.deepEqual((await walkWorkspace('/synthetic-root', { fs })).links, ['synthetic-b']);
 assert.deepEqual((await walkWorkspace(join(t.base, 'synthetic-missing'))).links, []); await rm(t.base, { recursive: true });
});
test('lists unreadable, type-changed and special entries by relative path and counts them toward the entry limit', async () => {
 const failing = await walkWorkspace('/synthetic-root', { fs: fake(sample, { 'synthetic-b': 'EACCES', 'synthetic-a.txt': 'ENOENT' }).fs });
 assert.deepEqual(failing.odd, ['synthetic-a.txt', 'synthetic-b']); assert.equal(failing.counts.unreadable, 2);
 const pipe: Record<string, Node> = { '': { dir: ['synthetic-pipe', 'synthetic-a.txt', 'synthetic-z'] }, 'synthetic-pipe': { special: true }, 'synthetic-a.txt': { file: 1 }, 'synthetic-z': { special: true } };
 const all = await walkWorkspace('/synthetic-root', { fs: fake(pipe).fs }); assert.deepEqual(all.odd, ['synthetic-pipe', 'synthetic-z']); assert.equal(all.counts.special, 2);
 const limited = await walkWorkspace('/synthetic-root', { fs: fake(pipe).fs, limits: { maxEntries: 2 } });
 assert.equal(limited.status, 'partial'); assert.deepEqual(limited.reasons, ['entry_limit']); assert.deepEqual(limited.odd, ['synthetic-pipe']); assert.deepEqual(paths(limited), ['synthetic-a.txt']);
 const f = fake(sample); const retyped: WalkFs = { ...f.fs, async lstat(p) { const st = await f.fs.lstat(p); return f.key(p) === 'synthetic-a.txt' ? { ...st, isFile: () => false } : st; } };
 assert.deepEqual((await walkWorkspace('/synthetic-root', { fs: retyped })).odd, ['synthetic-a.txt']);
 const dev = fresh(); dev['synthetic-b']!.dev = 2; assert.deepEqual((await walkWorkspace('/synthetic-root', { fs: fake(dev).fs })).odd, ['synthetic-b']);
 assert.deepEqual((await walkWorkspace('/synthetic-root', { fs: fake(sample).fs })).odd, []);
});
