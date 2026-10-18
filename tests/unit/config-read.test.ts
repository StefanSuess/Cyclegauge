import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink, link, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigBudget, listConfigFiles, readSteeringFile, readHookFile, statAgents, configFs, configPathAllowed, type ConfigFs } from '../../src/audit/config-read.ts';
import { readBounded } from '../../src/audit/read-bounded.ts';
import { readIgnoreFile } from '../../src/audit/read-ignore.ts';
const temp = async () => { const root = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'synthetic-config-'))); await mkdir(join(root, '.kiro/steering'), { recursive: true }); await mkdir(join(root, '.kiro/hooks')); return root; };
const put = (root: string, rel: string, text: string | Uint8Array) => writeFile(join(root, rel), text);
const remove = (root: string) => rm(root, { recursive: true, force: true });
const budget = () => createConfigBudget();
const steering = '.kiro/steering/synthetic-steering.md', hooks = '.kiro/hooks/synthetic-hook.json';

test('shared allow gate rejects before any filesystem operation and preserves ignore behavior', async () => {
 const root = await temp(); let calls = 0;
 const fs = { ...configFs, lstat: async (p: string) => { calls++; return configFs.lstat(p); }, open: async (p: string, flags: number) => { calls++; return configFs.open(p, flags); } };
 assert.deepEqual(await readBounded(root, steering, { mode: 'prefix', maxBytes: 5, allow: () => false }, { fs }), { code: 'not_allowed' }); assert.equal(calls, 0);
 await put(root, '.kiroignore', '\ufeffsynthetic-*\n'); assert.deepEqual(await readIgnoreFile(root, '.kiroignore', ['.kiroignore']), { text: 'synthetic-*\n' });
 await put(root, '.kiroignore', new Uint8Array([255])); assert.deepEqual(await readIgnoreFile(root, '.kiroignore', ['.kiroignore']), { code: 'unreadable' });
 for (const [rel, names, code] of [['.kiroignore', [], 'not_allowed'], ['.kiroignore', ['.kiroignore'], 'oversized'], ['synthetic-missing', ['synthetic-missing'], 'unreadable']] as [string, string[], string][]) {
  if (code === 'oversized') await put(root, '.kiroignore', 'x'.repeat(65537)); assert.deepEqual(await readIgnoreFile(root, rel, names), { code });
 }
 await remove(root);
});
test('steering requests five bytes only without opener and no more than 2 KiB with opener', async () => {
 const root = await temp(); const requests: number[] = [];
 const fs: ConfigFs = { ...configFs, open: async (p, flags) => { const h = await configFs.open(p, flags); return { ...h, read: async (b,o,l,p) => { requests.push(l); return h.read(b,o,l,p); } }; } };
 await put(root, steering, 'synthetic-body'.repeat(1000));
 const r = await readSteeringFile(root, steering, budget(), { fs }); assert.ok('entry' in r && r.entry.mode === 'always'); assert.deepEqual(requests, [5]);
 requests.length = 0; await put(root, steering, '---\ninclusion: manual\n---\n' + 'SYNTHETIC-INJECT-IGNORE-PREVIOUS'.repeat(200));
 const b = budget(), r2 = await readSteeringFile(root, steering, b, { fs }); assert.ok('entry' in r2 && r2.entry.mode === 'manual'); assert.equal(requests[0], 5); assert.ok(requests.reduce((a,n)=>a+n,0) <= 2048); assert.equal(b.bytesRead, 2048); assert.ok(!JSON.stringify(r2).includes('SYNTHETIC'));
 await remove(root);
});
test('metadata-only AGENTS and allowlisted paths; invalid names touch nothing', async () => {
 const root = await temp(); await put(root, 'AGENTS.md', 'SYNTHETIC-INJECT-IGNORE-PREVIOUS');
 let opens = 0; const fs: ConfigFs = { ...configFs, open: async (p,f) => { opens++; return configFs.open(p,f); } };
 assert.deepEqual(await statAgents(root, { fs }), { size: 32 }); assert.equal(opens, 0);
 for (const rel of ['../AGENTS.md', '.kiro/steering/sub/synthetic.md', '.kiro/hooks/synthetic\u202e.json', '.kiro/steering/synthetic\\bad.md', '.kiro/hooks/synthetic.md']) assert.equal(configPathAllowed(rel, 'hooks'), false);
 assert.equal(configPathAllowed('.kiro/hooks/synthetic.JSON', 'hooks'), true);
 await symlink(join(root, 'AGENTS.md'), join(root, 'synthetic-link')); await rm(join(root, 'AGENTS.md')); await symlink(join(root, 'synthetic-link'), join(root, 'AGENTS.md'));
 assert.deepEqual(await statAgents(root), { code: 'link_not_followed' }); await remove(root);
});
test('listing is sorted, capped, nonrecursive and always closes at 501 entries', async () => {
 const root = await temp(); let closes = 0, reads = 0;
 const fs: ConfigFs = { ...configFs, opendir: async () => ({ read: async () => ++reads <= 600 ? { name: `synthetic-${String(600-reads).padStart(3,'0')}.md`, isDirectory: () => false } : null, close: async () => { closes++; } }) };
 assert.deepEqual(await listConfigFiles(root, 'steering', { fs }), { code: 'too_many_entries' }); assert.equal(reads, 501); assert.equal(closes, 1);
 for (let i = 0; i < 102; i++) await put(root, `.kiro/steering/synthetic-${String(102-i).padStart(3,'0')}.md`, 'synthetic');
 await mkdir(join(root, '.kiro/steering/synthetic-nested')); await put(root, '.kiro/steering/synthetic\u202e.md', 'synthetic');
 const r = await listConfigFiles(root, 'steering'); assert.ok('files' in r); assert.equal(r.files.length, 100); assert.equal(r.omitted, 2); assert.equal(r.unsafe, 1); assert.equal(r.nested, 1); assert.equal(r.files[0], '.kiro/steering/synthetic-001.md');
 await remove(root);
});
test('only ENOENT means absent on every ancestor; listing swaps and failures close safely', async () => {
 const root = await temp();
 for (const part of ['.kiro', '.kiro/steering', '.kiro/hooks']) for (const code of ['ENOENT', 'EACCES', 'EIO']) {
  const fs: ConfigFs = { ...configFs, lstat: async p => { if (p === join(root, part)) throw Object.assign(new Error('SYNTHETIC-INJECT'), { code }); return configFs.lstat(p); } };
  assert.deepEqual(await listConfigFiles(root, part.endsWith('hooks') ? 'hooks' : 'steering', { fs }), code === 'ENOENT' ? { absent: true } : { code: 'folder_unreadable' });
 }
 let closes = 0; const fs: ConfigFs = { ...configFs, opendir: async () => ({ read: async () => { throw new Error('SYNTHETIC-INJECT'); }, close: async () => { closes++; } }) };
 assert.deepEqual(await listConfigFiles(root, 'steering', { fs }), { code: 'folder_unreadable' }); assert.equal(closes, 1);
 let stats = 0; const swapped: ConfigFs = { ...configFs, lstat: async p => { const s = await configFs.lstat(p); return p === join(root, '.kiro/steering') && ++stats > 1 ? { ...s, ino: 99999999 } : s; } };
 assert.deepEqual(await listConfigFiles(root, 'steering', { fs: swapped }), { code: 'folder_unreadable' }); await remove(root);
});
test('symlinked ancestors/files and hard-linked hooks are refused', async () => {
 const root = await temp(); await put(root, hooks, '{"version":"v1","hooks":[]}');
 await link(join(root, hooks), join(root, '.kiro/hooks/synthetic-hard.json')); assert.deepEqual(await readHookFile(root, hooks, budget()), { code: 'file_unsafe' });
 await put(root, steering, 'synthetic'); await symlink(join(root, steering), join(root, '.kiro/steering/synthetic-link.md'));
 assert.deepEqual(await readSteeringFile(root, '.kiro/steering/synthetic-link.md', budget()), { code: 'file_unsafe' });
 for (const rel of ['.kiro/steering', '.kiro/hooks', '.kiro']) {
  await rm(join(root, rel), { recursive: true }); await symlink(root, join(root, rel));
  assert.deepEqual(await listConfigFiles(root, rel.endsWith('hooks') ? 'hooks' : 'steering'), { code: 'file_unsafe' }); await rm(join(root, rel));
 }
 await remove(root);
});
test('hook size, shared byte budget, time and cancellation stop reads', async () => {
 const root = await temp(); await put(root, hooks, 'x'.repeat(65537)); assert.deepEqual(await readHookFile(root, hooks, budget()), { code: 'file_too_large' });
 await put(root, hooks, '{"version":"v1","hooks":[]}'); const b = budget(); b.bytesRead = b.maxBytes - 1;
 assert.deepEqual(await readHookFile(root, hooks, b), { code: 'limit_bytes' });
 const c = new AbortController(); c.abort(); let calls = 0; const fs: ConfigFs = { ...configFs, lstat: async p => { calls++; return configFs.lstat(p); } };
 assert.deepEqual(await readHookFile(root, hooks, budget(), { fs, signal: c.signal }), { code: 'cancelled' }); assert.equal(calls, 0);
 const expired = createConfigBudget({ now: () => 0 }); assert.deepEqual(await readHookFile(root, hooks, expired, { now: () => 3001 }), { code: 'time_limit' });
 await remove(root);
});
test('config modules contain no dynamic regex, logging or bound catch; no write API exists', async () => {
 for (const name of ['config-read', 'config-parse']) { const s = await readFile(new URL(`../../src/audit/${name}.ts`, import.meta.url), 'utf8'); assert.ok(!/RegExp\s*\(|console\.|(?<!\.)catch\s*\(/.test(s)); }
 assert.equal('write' in configFs, false);
});

test('special entries, opened type changes, growth and hard-link changes are refused', async () => {
 const root = await temp(); await put(root, hooks, '{"version":"v1","hooks":[]}');
 for (const change of ['special', 'opened-type', 'growth', 'links', 'ancestor-swap']) {
  let opens = 0, stats = 0, swapped = false;
  const fs: ConfigFs = { ...configFs,
   lstat: async p => { const s = await configFs.lstat(p); if (p === join(root, hooks) && change === 'special') return { ...s, isFile: () => false }; if (p === join(root, '.kiro') && change === 'ancestor-swap' && swapped) return { ...s, ino: 999999 }; return s; },
   open: async (p,f) => { opens++; const h = await configFs.open(p,f); return { ...h, read: async (b,o,l,p) => { const r = await h.read(b,o,l,p); swapped = true; return r; }, stat: async () => { const s = await h.stat(); stats++; return { ...s, ...(change === 'opened-type' ? { isFile: () => false } : {}), ...(change === 'growth' && stats > 1 ? { size: s.size + 1 } : {}), ...(change === 'links' && stats > 1 ? { nlink: 2 } : {}) }; } }; },
  };
  assert.deepEqual(await readHookFile(root, hooks, budget(), { fs }), { code: 'file_unsafe' }, change);
  if (change === 'special') assert.equal(opens, 0);
 }
 await remove(root);
});
test('file absence differs from unreadable and rejected paths perform zero operations', async () => {
 const root = await temp(); let calls = 0;
 const fs: ConfigFs = { ...configFs, lstat: async p => { calls++; if (p === join(root, hooks)) throw Object.assign(new Error('SYNTHETIC-INJECT'), { code: 'EIO' }); return configFs.lstat(p); } };
 assert.deepEqual(await readHookFile(root, '.kiro/hooks/sub/synthetic.json', budget(), { fs }), { code: 'not_allowed' }); assert.equal(calls, 0);
 assert.deepEqual(await readHookFile(root, hooks, budget(), { fs }), { code: 'file_unreadable' });
 assert.deepEqual(await readHookFile(root, hooks, budget()), { absent: true });
 assert.deepEqual(await statAgents(root), { absent: true }); await remove(root);
});
test('one 3.6 MiB budget and one equality scope apply across roots and hook files', async () => {
 const a = await temp(), b = await temp(); const body = '{"version":"v1","hooks":[{"name":"synthetic-hook","trigger":"PostFileSave","matcher":"synthetic-same","action":{"type":"agent"}}]}';
 await put(a, hooks, body.padEnd(65536, ' ')); await put(b, hooks, body.padEnd(65536, ' '));
 const shared = budget(); let first: number | undefined;
 for (let i = 0; i < 57; i++) { const r = await readHookFile(i % 2 ? a : b, hooks, shared); assert.ok('hooks' in r); if (i === 0) first = r.hooks[0]!.matcherKey; else assert.equal(r.hooks[0]!.matcherKey, first); }
 assert.equal(shared.bytesRead, 57 * 65536); assert.deepEqual(await readHookFile(b, hooks, shared), { code: 'limit_bytes' });
 await put(b, hooks, body.replace('synthetic-same', 'synthetic-different')); const other = await readHookFile(b, hooks, shared); assert.ok('hooks' in other); assert.notEqual(other.hooks[0]!.matcherKey, first);
 await remove(a); await remove(b);
});
test('short reads charge actual bytes and short steering still requests exactly five bytes initially', async () => {
 const root = await temp(); await put(root, steering, 'abc'); const lengths: number[] = [];
 const short: ConfigFs = { ...configFs, open: async (p,f) => { const h = await configFs.open(p,f); return { ...h, read: async (b,o,l,p) => { lengths.push(l); return h.read(b,o,Math.min(l, 1),p); } }; } };
 const shared = budget(); const r = await readSteeringFile(root, steering, shared, { fs: short }); assert.ok('entry' in r && r.entry.mode === 'always'); assert.equal(lengths[0], 5); assert.equal(shared.bytesRead, 3);
 await remove(root);
});
test('run-local matcher equality retains SHA256 digests rather than matcher text', async () => {
 const shared = budget(), sentinel = 'SYNTHETIC-INJECT-IGNORE-PREVIOUS';
 assert.deepEqual([shared.matcherKey(sentinel), shared.matcherKey(sentinel), shared.matcherKey('synthetic-other')], [0, 0, 1]);
 assert.notEqual(shared.matcherKey('synthetic-\ud800'), shared.matcherKey('synthetic-\ud801'));
 const source = await readFile(new URL('../../src/audit/config-read.ts', import.meta.url), 'utf8');
 const closure = source.slice(source.indexOf('export function createConfigBudget'), source.indexOf('const UNSAFE'));
 assert.ok(/import \{ createHash \} from 'node:crypto'/.test(source));
 assert.ok(/const digest = createHash\('sha256'\)\.update\(value, 'utf16le'\)\.digest\('hex'\)/.test(closure));
 assert.deepEqual([...closure.matchAll(/keys\.(?:has|get|set)\(([^,)]+)/g)].map(m => m[1]), ['digest', 'digest', 'digest']);
});
