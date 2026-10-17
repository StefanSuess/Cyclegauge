import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, truncate, rm, realpath, lstat, open, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAudit, snippet, MAX_FINDINGS, type AuditResult, type Finding } from '../../src/audit/audit.ts';
import { evaluate, parseIgnore } from '../../src/audit/ignore.ts';
import type { WalkFs } from '../../src/audit/walk.ts';
import type { ReadFs } from '../../src/audit/read-ignore.ts';

const KIB = 1024, MIB = 1024 * KIB, NAMES = ['.gitignore', '.kiroignore'], SENTINEL = 'SYNTHETIC_CONTENT_SENTINEL';
const temp = async () => { const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-audit-run-')); const root = join(base, 'synthetic-root'); await mkdir(root); return { base, root }; };
const put = async (root: string, rel: string, text = '', size?: number) => {
 const p = join(root, ...rel.split('/')); await mkdir(join(p, '..'), { recursive: true }); await writeFile(p, text); if (size !== undefined) await truncate(p, size);
};
const shape = (r: AuditResult) => r.findings.map(f => `${f.category}:${f.path}${f.isDir ? '/' : ''}:${f.coverage}`);
async function scenario(): Promise<{ base: string; root: string }> {
 const t = await temp();
 await put(t.root, '.kiroignore', `# ${SENTINEL}\n/synthetic-ignored.log\n*.dump\n`);
 await put(t.root, '.env', 'SYNTHETIC=1'); await put(t.root, '.env.example', 'SYNTHETIC=1');
 await put(t.root, 'synthetic-ignored.log', '', 200 * KIB); await put(t.root, 'synthetic-kept.log', '', 200 * KIB);
 await put(t.root, 'synthetic-big.bin', '', 5 * MIB); await put(t.root, 'synthetic-data.csv', '', MIB); await put(t.root, 'synthetic-small.sql', 'x');
 await put(t.root, 'synthetic-old.dump', '', 2 * KIB);
 await put(t.root, 'backup/.kiroignore', '*.sql\n!synthetic-keep.sql\n'); await put(t.root, 'backup/synthetic.sql', '', 2 * KIB); await put(t.root, 'backup/synthetic-keep.sql', '', 2 * KIB);
 await put(t.root, 'dist/synthetic-a.js', 'a'.repeat(10)); await put(t.root, 'dist/sub/synthetic-b.js', 'b'.repeat(20));
 await put(t.root, 'node_modules/synthetic-pkg/index.js', 'x'); await put(t.root, '.git/synthetic-config', 'x');
 return t;
}
// In-memory tree: `files` maps root-relative paths to sizes. Only lstat and readdir exist, like the real walker's fs.
function fakeWalk(files: Record<string, number>): WalkFs {
 const nodes = new Map<string, { size?: number; kids: Set<string> }>([['', { kids: new Set() }]]);
 for (const [p, size] of Object.entries(files)) {
  const segs = p.split('/');
  for (let i = 0; i < segs.length; i++) {
   const parent = segs.slice(0, i).join('/'), key = segs.slice(0, i + 1).join('/');
   nodes.get(parent)!.kids.add(segs[i]!);
   if (!nodes.has(key)) nodes.set(key, i === segs.length - 1 ? { size, kids: new Set() } : { kids: new Set() });
  }
 }
 const key = (p: string) => (process.platform === 'win32' ? p.replace(/\\/g, '/') : p).replace(/^[A-Za-z]:/, '').replace(/^\/synthetic-root\/?/, '');
 const kind = (k: string) => ({ isFile: () => nodes.get(k)!.size !== undefined, isDirectory: () => nodes.get(k)!.size === undefined, isSymbolicLink: () => false });
 const id = (k: string) => [...nodes.keys()].indexOf(k) + 1;
 return {
  async lstat(p) { const k = key(p), n = nodes.get(k); if (!n) throw new Error('synthetic-missing'); return { ...kind(k), size: n.size ?? 0, dev: 1, ino: id(k) }; },
  async readdir(p) { const k = key(p), n = nodes.get(k); if (!n || n.size !== undefined) throw new Error('synthetic-missing'); return [...n.kids].map(name => ({ name, ...kind(k ? `${k}/${name}` : name) })); },
 };
}
const realRead = (onOpen: () => void = () => {}): ReadFs => ({
 lstat: async p => { const s = await lstat(p, { bigint: true }); return { isFile: () => s.isFile(), isDirectory: () => s.isDirectory(), isSymbolicLink: () => s.isSymbolicLink(), size: Number(s.size), dev: s.dev, ino: s.ino }; },
 open: async (p, flags) => {
  onOpen(); const fh = await open(p, flags);
  return { stat: async () => { const s = await fh.stat({ bigint: true }); return { isFile: () => s.isFile(), size: Number(s.size), dev: s.dev, ino: s.ino }; }, read: async (b, o, l, pos) => ({ bytesRead: (await fh.read(b, o, l, pos)).bytesRead }), close: () => fh.close() };
 },
});

test('reports findings by category with coverage, build aggregation and ignored paths excluded', async () => {
 const t = await scenario(); const r = await runAudit(t.root, NAMES);
 assert.equal(r.status, 'complete'); assert.equal(r.ignore, 'evaluated'); assert.deepEqual(r.reasons, []); assert.equal(r.omitted, 0);
 assert.deepEqual(shape(r), ['secret:.env:not_covered', 'database:backup/synthetic-keep.sql:not_covered', 'log:synthetic-kept.log:not_covered', 'data:synthetic-data.csv:not_covered', 'build:dist/:not_covered', 'dependency:node_modules/:not_covered', 'large:synthetic-big.bin:not_covered']);
 const by = (p: string) => r.findings.find(f => f.path === p)!;
 assert.equal(by('dist').size, 30); assert.equal(by('dist').isDir, true); assert.equal(by('dist').suggestion, '/dist/');
 assert.equal('size' in by('node_modules'), false); assert.equal(by('synthetic-big.bin').size, 5 * MIB); assert.equal(by('.env').suggestion, '/.env');
 assert.equal(r.counts.ignored, 3); assert.equal(r.counts.ignoreFiles, 2); assert.equal(r.counts.ignoreFilesUnavailable, 0); assert.equal(r.counts.unknown, 0);
 assert.equal(r.counts.files, 14); assert.equal(r.counts.dirs, 3); assert.equal(r.counts.symlinks, 0);
 const text = JSON.stringify(r);
 assert.ok(!text.includes(t.base) && !text.includes(t.root) && !text.includes(SENTINEL) && !text.includes('synthetic-ignored') && !text.includes('"rules"'));
 await rm(t.base, { recursive: true });
});
test('disabled setting evaluates nothing and leaves every path not covered', async () => {
 const t = await scenario(); const r = await runAudit(t.root, []);
 assert.equal(r.ignore, 'disabled'); assert.equal(r.counts.ignoreFiles, 0); assert.equal(r.counts.ignored, 0); assert.equal(r.status, 'complete');
 assert.ok(r.findings.every(f => f.coverage === 'not_covered')); assert.ok(shape(r).includes('log:synthetic-ignored.log:not_covered'));
 assert.ok(shape(r).includes('database:backup/synthetic.sql:not_covered')); await rm(t.base, { recursive: true });
});
test('a missing or unusable setting makes every coverage unknown', async () => {
 const t = await scenario();
 for (const value of [undefined, 'x', [1], null, { a: 1 }, ['.kiroignore', 1], ['sub/.kiroignore'], ['']]) {
  const r = await runAudit(t.root, value);
  assert.equal(r.ignore, 'setting_unknown', JSON.stringify(value)); assert.equal(r.counts.ignoreFiles, 0); assert.equal(r.counts.ignored, 0);
  assert.ok(r.findings.length > 0 && r.findings.every(f => f.coverage === 'unknown'));
  assert.ok(shape(r).includes('log:synthetic-ignored.log:unknown')); assert.ok(r.counts.unknown > 0);
 }
 assert.equal((await runAudit(t.root, ['.kiroignore', '.kiroignore'])).ignore, 'evaluated'); await rm(t.base, { recursive: true });
});
test('an oversized or unreadable ignore file leaves its directory unknown only', async () => {
 const t = await scenario(); await put(t.root, 'backup/.kiroignore', `# ${SENTINEL}\n`.repeat(8_000));
 const r = await runAudit(t.root, NAMES);
 assert.equal(r.counts.ignoreFilesUnavailable, 1); assert.equal(r.counts.ignoreFiles, 1);
 assert.ok(shape(r).includes('database:backup/synthetic-keep.sql:unknown')); assert.ok(shape(r).includes('secret:.env:not_covered'));
 assert.ok(!shape(r).some(s => s.includes('synthetic-ignored')));
 assert.ok(!JSON.stringify(r).includes(SENTINEL));
 const unreadable: ReadFs = { ...realRead(), async open() { throw new Error('synthetic-denied'); } };
 const u = await runAudit(t.root, NAMES, { readFs: unreadable });
 assert.equal(u.counts.ignoreFilesUnavailable, 2); assert.ok(u.findings.every(f => f.coverage === 'unknown')); assert.ok(!JSON.stringify(u).includes('synthetic-denied'));
 await rm(t.base, { recursive: true });
});
test('an ignore file with too many rules is unavailable', async () => {
 const t = await temp(); await put(t.root, 'synthetic.pem', 'x'); await put(t.root, '.kiroignore', Array.from({ length: 2_001 }, (_, i) => `synthetic-${i}`).join('\n'));
 const r = await runAudit(t.root, NAMES); assert.equal(r.counts.ignoreFilesUnavailable, 1); assert.deepEqual(shape(r), ['secret:synthetic.pem:unknown']); await rm(t.base, { recursive: true });
});
test('ignore files beyond the read limit become unavailable and flag the audit partial', async () => {
 const t = await temp();
 for (let i = 0; i <= 200; i++) { const d = `synthetic-d${String(i).padStart(3, '0')}`; await put(t.root, `${d}/.kiroignore`, '# synthetic\n'); if (i === 0 || i === 200) await put(t.root, `${d}/synthetic.pem`, 'x'); }
 const r = await runAudit(t.root, NAMES);
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['ignore_file_limit']); assert.equal(r.counts.ignoreFiles, 200); assert.equal(r.counts.ignoreFilesUnavailable, 1);
 assert.ok(shape(r).includes('secret:synthetic-d000/synthetic.pem:not_covered')); assert.ok(shape(r).includes('secret:synthetic-d200/synthetic.pem:unknown'));
 await rm(t.base, { recursive: true });
});
test('a directory whose listing was halted makes its subtree unknown', async () => {
 const t = await temp(); for (const n of ['a.pem', 'b.pem', 'c.pem', 'zz.ignore']) await put(t.root, n, 'x'); await put(t.root, 'zz.ignore', 'a.pem\n');
 const r = await runAudit(t.root, ['zz.ignore'], { limits: { maxEntries: 2 } });
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['entry_limit']); assert.deepEqual(shape(r), ['secret:a.pem:unknown', 'secret:b.pem:unknown']);
 const nested = await runAudit(t.root, ['zz.ignore']); assert.equal(nested.status, 'complete'); assert.deepEqual(shape(nested), ['secret:b.pem:not_covered', 'secret:c.pem:not_covered']);
 await rm(t.base, { recursive: true });
});
test('evaluation stops at the time budget and reports the rest as unknown', async () => {
 const t = await scenario(); let clock = 0;
 const r = await runAudit(t.root, NAMES, { now: () => clock, limits: { timeBudgetMs: 500 }, readFs: realRead(() => { clock += 1_000; }) });
 assert.equal(r.status, 'partial'); assert.ok(r.reasons.includes('evaluation_time_limit'));
 assert.ok(r.findings.length > 0 && r.findings.every(f => f.coverage === 'unknown')); assert.ok(r.counts.unknown >= r.findings.length); assert.equal(r.counts.ignored, 0);
 let tick = 0; const early = await runAudit(t.root, NAMES, { now: () => (tick += 10), limits: { timeBudgetMs: 5 } });
 assert.ok(early.reasons.includes('time_limit')); assert.equal(early.status, 'partial');
 await rm(t.base, { recursive: true });
});
test('time passing between reads leaves later ignore files unavailable', async () => {
 const t = await scenario(); let clock = 0;
 const r = await runAudit(t.root, NAMES, { now: () => clock, limits: { timeBudgetMs: 500 }, readFs: realRead(() => { clock += 1_000; }) });
 assert.equal(r.counts.ignoreFiles, 1); assert.equal(r.counts.ignoreFilesUnavailable, 1); assert.deepEqual(r.reasons, ['evaluation_time_limit']); await rm(t.base, { recursive: true });
});
test('cancellation stops the audit with a partial result', async () => {
 const t = await scenario(); const before = new AbortController(); before.abort();
 const r0 = await runAudit(t.root, NAMES, { signal: before.signal }); assert.equal(r0.status, 'partial'); assert.deepEqual(r0.reasons, ['cancelled']); assert.deepEqual(r0.findings, []);
 const mid = new AbortController();
 const r1 = await runAudit(t.root, NAMES, { signal: mid.signal, readFs: realRead(() => mid.abort()) });
 assert.equal(r1.status, 'partial'); assert.ok(r1.reasons.includes('cancelled')); assert.deepEqual(r1.findings, []);
 const late = new AbortController(); let reads = 0;
 const r2 = await runAudit(t.root, NAMES, { signal: late.signal, readFs: realRead(() => { if (++reads === 2) late.abort(); }) });
 assert.deepEqual(r2.reasons, ['cancelled']); await rm(t.base, { recursive: true });
});
test('lists at most MAX_FINDINGS and counts the rest as omitted', async () => {
 const files: Record<string, number> = {}; for (let i = 0; i < 205; i++) files[`synthetic-${String(i).padStart(3, '0')}.pem`] = 1;
 files['synthetic.sql'] = 2 * KIB;
 const r = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk(files), readFs: realRead() });
 assert.equal(MAX_FINDINGS, 200); assert.equal(r.findings.length, 200); assert.equal(r.omitted, 6); assert.equal(r.findings[0]!.path, 'synthetic-000.pem'); assert.ok(r.findings.every(f => f.category === 'secret'));
});
test('categorises by name, case-insensitively, with size thresholds', async () => {
 const table: [string, number, string | undefined][] = [
  ['.env', 0, 'secret'], ['.ENV.local', 1, 'secret'], ['.env.example', 0, undefined], ['.env.SAMPLE', 0, undefined], ['.env.template', 0, undefined], ['a/Synthetic.PEM', 0, 'secret'], ['id_rsa', 0, 'secret'], ['ID_ED25519', 0, 'secret'],
  ['synthetic.key', 0, 'secret'], ['synthetic.p12', 0, 'secret'], ['synthetic.pfx', 0, 'secret'], ['synthetic.keystore', 0, 'secret'], ['credentials.json', 0, 'secret'], ['synthetic-credentials.json', 0, undefined],
  ['a.sql', KIB - 1, undefined], ['a.sql', KIB, 'database'], ['a.DUMP', KIB, 'database'], ['a.sqlite', KIB, 'database'], ['a.sqlite3', KIB, 'database'], ['a.db', KIB, 'database'], ['a.bak', KIB, 'database'],
  ['a.zip', 100 * KIB - 1, undefined], ['a.zip', 100 * KIB, 'archive'], ['a.tar.gz', 100 * KIB, 'archive'], ['a.tgz', 100 * KIB, 'archive'], ['a.7z', 100 * KIB, 'archive'], ['a.rar', 100 * KIB, 'archive'], ['a.bz2', 100 * KIB, 'archive'], ['a.xz', 100 * KIB, 'archive'], ['a.tar', 100 * KIB, 'archive'],
  ['a.log', 100 * KIB - 1, undefined], ['a.log', 100 * KIB, 'log'],
  ['a.csv', MIB - 1, undefined], ['a.csv', MIB, 'data'], ['a.tsv', MIB, 'data'], ['a.jsonl', MIB, 'data'], ['a.ndjson', MIB, 'data'], ['a.parquet', MIB, 'data'],
  ['a.bin', 5 * MIB - 1, undefined], ['a.bin', 5 * MIB, 'large'], ['a.zip', 5 * MIB, 'archive'], ['a.csv', 6 * MIB, 'data'], ['a.txt', 100, undefined],
 ];
 for (const [path, size, expected] of table) {
  const r = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk({ [path]: size }), readFs: realRead() });
  assert.deepEqual(r.findings.map(f => f.category), expected ? [expected] : [], `${path} ${size}`);
 }
});
// Extended name patterns (informed by public name-based lists, written as our own): one synthetic case per pattern plus near misses.
test('extended file name patterns classify by name, path and size only', async () => {
 const table: [string, number, string | undefined][] = [
  ...['id_dsa', 'id_ecdsa', 'synthetic_rsa', 'synthetic_dsa', 'synthetic_ecdsa', 'synthetic_ed25519', 'credentials.xml', '.git-credentials', '.netrc', '_netrc', '.pgpass', '.htpasswd',
   '.dockercfg', '.s3cfg', 'sftp-config.json', '.ftpconfig', '.remote-sync.json', '.history', '.bash_history', '.zsh_history', '.mysql_history', '.psql_history', '.irb_history',
   'synthetic.ppk', 'synthetic.jks', 'synthetic.pkcs12', 'synthetic.kdbx', 'synthetic.kdb', 'synthetic.keychain', 'synthetic.psafe3', 'synthetic.kwallet',
   'synthetic.ovpn', 'terraform.tfstate', 'terraform.tfstate.backup', 'config/master.key', '.vscode/sftp.json', '.idea/WebServers.xml', 'synthetic-sub/.docker/config.json']
   .map((p): [string, number, string] => [p, 1, 'secret']),
  ['synthetic_rsa.pub', 1, undefined], ['synthetic-rsa', 1, undefined], ['.vscode/settings.json', 1, undefined], ['synthetic-docker/config.json', 1, undefined],
  ['settings.py', 1, undefined], ['database.yml', 1, undefined], ['.npmrc', 1, undefined], ['terraform.tfvars', 1, undefined], ['synthetic.asc', 1, undefined],
  ...['synthetic.mdf', 'synthetic.sdf', 'synthetic.sqldump'].flatMap((p): [string, number, string | undefined][] => [[p, KIB, 'database'], [p, KIB - 1, undefined]]),
  ...['synthetic.pcap', 'synthetic.pcapng', 'synthetic.npy', 'synthetic.npz', 'synthetic.pkl', 'synthetic.h5', 'synthetic.hdf5', 'synthetic.feather', 'synthetic.arrow']
   .flatMap((p): [string, number, string | undefined][] => [[p, MIB, 'data'], [p, MIB - 1, undefined]]),
 ];
 for (const [path, size, expected] of table) {
  const r = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk({ [path]: size }), readFs: realRead() });
  assert.deepEqual(r.findings.map(f => f.category), expected ? [expected] : [], `${path} ${size}`);
 }
});
test('secret stores and dependency folders are reported once as folders; new build folders aggregate', async () => {
 const builds = ['.gradle', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.parcel-cache', '.svelte-kit', '.angular', '.output', '.vercel', '.dart_tool', '.expo',
  'DerivedData', 'storybook-static', 'elm-stuff', '.stack-work', 'cmake-build-debug'];
 const files: Record<string, number> = {
  '.ssh/synthetic.pem': 1, 'synthetic-sub/.gnupg/synthetic-ring': 1, '.aws/credentials.json': 1, 'synthetic.agilekeychain/data/default/synthetic.js': 1, 'dist/synthetic-2.agilekeychain/synthetic.js': 1,
  'bower_components/synthetic/index.js': 1, 'jspm_packages/synthetic.js': 1, '.terraform/synthetic-provider': 1, '.pnpm-store/synthetic': 1,
  'Pods/synthetic/x.m': 3, 'Pods/synthetic/y.m': 4, 'pods/synthetic-deploy.yaml': 1, '.yarn/cache/synthetic.zip': 2, '.yarn/releases/synthetic.cjs': 1,
  'bower_components/.env': 1, 'dist/bower_components/synthetic.js': 1, 'dist/.ssh/synthetic.pem': 1, 'Pods/.env': 1,
 };
 for (const b of builds) files[`${b}/synthetic.bin`] = 1;
 const r = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk(files), readFs: realRead() });
 const of = (c: string) => shape(r).filter(x => x.startsWith(`${c}:`));
 assert.deepEqual(of('secret'), ['secret:.aws/:not_covered', 'secret:.ssh/:not_covered', 'secret:Pods/.env:not_covered', 'secret:dist/.ssh/:not_covered', 'secret:dist/synthetic-2.agilekeychain/:not_covered',
  'secret:synthetic-sub/.gnupg/:not_covered', 'secret:synthetic.agilekeychain/:not_covered']);
 assert.deepEqual(of('dependency'), ['dependency:.pnpm-store/:not_covered', 'dependency:.terraform/:not_covered', 'dependency:.yarn/cache/:not_covered', 'dependency:Pods/:not_covered',
  'dependency:bower_components/:not_covered', 'dependency:jspm_packages/:not_covered']);
 assert.equal(r.findings.find(f => f.path === 'Pods')!.size, 8); assert.equal(r.findings.find(f => f.path === '.yarn/cache')!.size, 2);
 assert.deepEqual(of('build').map(x => x.slice('build:'.length, x.indexOf('/:'))).sort(), [...builds, 'dist'].sort());
 // dist holds no walked file of its own, but the dependency folder pruned inside it still makes it appear, without a size.
 assert.equal('size' in r.findings.find(f => f.path === 'dist')!, false);
 assert.ok(!r.findings.some(f => f.path.startsWith('pods') || f.path.startsWith('.yarn/releases')));
 // Pruned folders are never entered: a key, a credential file and an .env inside them are not listed one by one.
 for (const f of r.findings) assert.ok(!/^(dist\/)?(\.ssh|\.aws|bower_components)\//.test(f.path), f.path);
});
test('build output folders report once at the topmost matching ancestor', async () => {
 const names = ['dist', 'BUILD', 'out', 'target', '.next', '.nuxt', 'coverage', '.turbo', '.cache', '__pycache__', '.venv', 'venv'];
 const files: Record<string, number> = { 'dist/.env': 5, 'a/Build/b/dist/x.js': 7, 'a/Build/y.js': 1, 'synthetic-src/dist/q.js': 1, 'synthetic-src/dist/node_modules/p.js': 1, 'build': 5, 'synthetic-dist/z.js': 1 };
 for (const n of names) files[`synthetic-${n}/${n}/q.js`] = 3;
 const r = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk(files), readFs: realRead() });
 assert.deepEqual(shape(r).filter(s => s.startsWith('build:') && !s.includes('synthetic-')), ['build:a/Build/:not_covered', 'build:dist/:not_covered']);
 assert.equal(r.findings.find(f => f.path === 'a/Build')!.size, 8); assert.equal(r.findings.find(f => f.path === 'dist')!.size, 5);
 assert.equal(r.findings.find(f => f.path === 'synthetic-src/dist')!.size, 1);
 assert.deepEqual(shape(r).filter(s => s.startsWith('secret:')), ['secret:dist/.env:not_covered']); assert.ok(!r.findings.some(f => f.path.includes('node_modules')));
 assert.equal(r.findings.filter(f => f.path.startsWith('synthetic-') && f.category === 'build').length, names.length + 1);
 assert.equal(r.counts.files, Object.keys(files).length - 1); // the pruned node_modules is not entered
});
test('a build folder uses its own coverage', async () => {
 const t = await temp(); await put(t.root, 'dist/synthetic-a.js', 'a'); await put(t.root, 'build/synthetic-b.js', 'b'); await put(t.root, 'out/synthetic-c.js', 'c'); await put(t.root, '.kiroignore', '/dist/\n');
 await put(t.root, 'build/.kiroignore', '*.js\n');
 const r = await runAudit(t.root, NAMES);
 assert.deepEqual(shape(r), ['build:build/:not_covered', 'build:out/:not_covered']); assert.equal(r.counts.ignored, 2);
 const x = await runAudit(t.root, ['.gitignore']); assert.ok(shape(x).includes('build:dist/:not_covered')); await rm(t.base, { recursive: true });
});
test('suggestions are root-anchored, escaped, one line each, and match their own path', async () => {
 const files: Record<string, number> = {
  'synthetic*name.log': 200 * KIB, '#synthetic.pem': 1, '!synthetic.pem': 1, '.env.local ': 1, 'synthetic[1]?.pem': 1, 'synthetic dir/synthetic.pem': 1, 'dist/synthetic.js': 1,
 };
 if (process.platform !== 'win32') files['synthetic\\back.pem'] = 1;
 const r = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk(files), readFs: realRead() });
 const lines = snippet(r.findings).split('\n');
 assert.equal(lines[0], '# Suggested by Cyclegauge - review before adding');
 assert.equal(lines.length, 1 + r.findings.length); assert.deepEqual(lines.slice(1), [...lines.slice(1)].sort());
 const sug = (p: string) => r.findings.find(f => f.path === p)!.suggestion;
 assert.equal(sug('synthetic*name.log'), '/synthetic\\*name.log'); assert.equal(sug('#synthetic.pem'), '/\\#synthetic.pem'); assert.equal(sug('!synthetic.pem'), '/\\!synthetic.pem');
 assert.equal(sug('.env.local '), '/.env.local\\ '); assert.equal(sug('synthetic[1]?.pem'), '/synthetic\\[1\\]\\?.pem'); assert.equal(sug('dist'), '/dist/');
 for (const f of r.findings) {
  const parsed = parseIgnore(f.suggestion)!; assert.equal(parsed.skipped, 0, f.path); assert.equal(parsed.rules.length, 1, f.path);
  assert.equal(evaluate(f.path, f.isDir, [{ dir: '', file: 'synthetic', parsed }]).status, 'ignored', f.path);
 }
});
test('findings whose names contain control, format or separator characters get no suggestion', async () => {
 const odd = ['synthetic\nline.pem', 'synthetic\u202ebidi.pem', 'synthetic\u200bzero.pem', 'synthetic\u0085next.pem', 'synthetic\u2028sep.pem', 'synthetic\u2029par.pem', 'synthetic\u061cmark.pem', `synthetic${String.fromCodePoint(0xe0041)}tag.pem`, 'synthetic\u00adsoft.pem', 'synthetic\ufeffbom.pem', 'synthetic\ttab.pem'];
 const files: Record<string, number> = { 'synthetic-plain.pem': 1 }; for (const n of odd) files[n] = 1; files['synthetic-dir\u200f/x/dist/y.js'] = 1;
 const r = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk(files), readFs: realRead() });
 for (const n of odd) assert.equal(r.findings.find(f => f.path === n)!.suggestion, '', JSON.stringify(n));
 assert.equal(r.findings.find(f => f.path === 'synthetic-dir\u200f/x/dist')!.suggestion, ''); assert.equal(r.findings.find(f => f.path === 'synthetic-plain.pem')!.suggestion, '/synthetic-plain.pem');
 assert.equal(snippet(r.findings), '# Suggested by Cyclegauge - review before adding\n/synthetic-plain.pem');
});
test('a lookalike name next to a real folder never produces a rule that covers the folder', async () => {
 const t = await temp(); await put(t.root, 'src/synthetic.txt', 'x'); await put(t.root, 'sr\u200b', '', 5 * MIB);
 const r = await runAudit(t.root, NAMES); const f = r.findings.find(x => x.category === 'large')!;
 assert.equal(f.path, 'sr\u200b'); assert.equal(f.suggestion, ''); assert.ok(!snippet(r.findings).includes('/sr'));
 const parsed = parseIgnore(snippet(r.findings))!; assert.equal(evaluate('src/synthetic.txt', false, [{ dir: '', file: 'x', parsed }]).status, 'not_covered'); await rm(t.base, { recursive: true });
});
test('a suggestion that might also cover a case-only sibling is dropped', async () => {
 const walkFs = fakeWalk({ 'synthetic.pem': 1, 'Synthetic.pem': 1, 'synthetic-other.pem': 1 });
 const r = await runAudit('/synthetic-root', NAMES, { walkFs, readFs: realRead(), caseInsensitive: false });
 const by = (p: string) => r.findings.find(f => f.path === p)!;
 assert.equal(by('synthetic.pem').suggestion, ''); assert.equal(by('Synthetic.pem').suggestion, ''); assert.equal(by('synthetic-other.pem').suggestion, '/synthetic-other.pem');
});
test('snippet joins unique, sorted suggestions below a review comment', () => {
 const f = (suggestion: string): Finding => ({ path: 'p', isDir: false, category: 'log', coverage: 'not_covered', suggestion });
 assert.equal(snippet([f('/b.log'), f('/a.log'), f('/b.log')]), '# Suggested by Cyclegauge - review before adding\n/a.log\n/b.log');
 assert.equal(snippet([]), '# Suggested by Cyclegauge - review before adding');
});
test('unavailable roots return only a fixed code', async () => {
 const t = await temp(); await put(t.base, 'synthetic-file.txt', 'x');
 for (const [root, code] of [['synthetic-relative', 'root_invalid'], [join(t.base, 'synthetic-file.txt'), 'root_invalid'], [join(t.base, 'synthetic-missing'), 'root_unreadable']] as const) {
  const r = await runAudit(root, NAMES);
  assert.equal(r.status, 'unavailable'); assert.equal(r.code, code); assert.deepEqual(r.findings, []); assert.deepEqual(r.reasons, []); assert.equal(r.counts.files, 0); assert.equal(r.ignore, 'evaluated');
  assert.ok(!JSON.stringify(r).includes(t.base));
 }
 assert.equal((await runAudit('synthetic-relative', undefined)).ignore, 'setting_unknown'); await rm(t.base, { recursive: true });
});
test('only walker-produced paths are read, and only files named by the setting', async () => {
 const t = await scenario(); const opened: string[] = [];
 const fs: ReadFs = { ...realRead(), async open(p, flags) { opened.push(p); return realRead().open(p, flags); } };
 await runAudit(t.root, ['.kiroignore'], { readFs: fs });
 assert.deepEqual(opened.map(p => p.slice(t.root.length + 1).replace(/\\/g, '/')).sort(), ['.kiroignore', 'backup/.kiroignore']);
 opened.length = 0; await runAudit(t.root, [], { readFs: fs }); await runAudit(t.root, undefined, { readFs: fs }); assert.deepEqual(opened, []); await rm(t.base, { recursive: true });
});
test('audit sources never write, log or import more than the reviewed filesystem calls', async () => {
 const { readFile } = await import('node:fs/promises');
 const src = await readFile(new URL('../../src/audit/audit.ts', import.meta.url), 'utf8');
 assert.ok(!/node:fs|node:child_process|\bconsole\b|writeFile|\bfetch\b|node:net|node:http/.test(src));
});
test('a secret inside a build folder is reported in addition to the folder', async () => {
 const t = await temp(); await put(t.root, 'dist/.env', 'x'); await put(t.root, 'dist/synthetic.js', 'abc'); await put(t.root, 'build/.env.example', 'x'); await put(t.root, 'build/synthetic.pem', 'x'); await put(t.root, '.kiroignore', '/build/\n');
 const r = await runAudit(t.root, NAMES);
 assert.deepEqual(shape(r), ['secret:dist/.env:not_covered', 'build:dist/:not_covered']); assert.equal(r.findings.find(f => f.path === 'dist')!.size, 4);
 // Covered by an ignore rule on the folder, the secret is not reported either.
 assert.ok(!shape(r).some(s => s.includes('build/'))); await rm(t.base, { recursive: true });
 const f = await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk({ 'dist/.env': 1, 'dist/.ENV.local': 1, 'a/out/id_rsa': 1 }), readFs: realRead() });
 assert.deepEqual(shape(f), ['secret:a/out/id_rsa:not_covered', 'secret:dist/.ENV.local:not_covered', 'secret:dist/.env:not_covered', 'build:a/out/:not_covered', 'build:dist/:not_covered']);
});
test('a symlink named like an ignore file leaves its directory unknown without being read', async () => {
 const t = await temp(); await put(t.root, 'synthetic-outside/rules', 'secret.pem\n'); await put(t.root, 'synthetic-a/synthetic.pem', 'x'); await put(t.root, 'synthetic-b/synthetic.pem', 'x'); await put(t.root, 'synthetic.pem', 'x');
 await symlink(join(t.root, 'synthetic-outside', 'rules'), join(t.root, 'synthetic-a', '.kiroignore')); await symlink(join(t.root, 'synthetic-outside', 'rules'), join(t.root, 'synthetic-b', 'synthetic-other-link'));
 const opened: string[] = []; const fs: ReadFs = { ...realRead(), async open(p, flags) { opened.push(p); return realRead().open(p, flags); } };
 const r = await runAudit(t.root, NAMES, { readFs: fs });
 assert.deepEqual(shape(r), ['secret:synthetic-a/synthetic.pem:unknown', 'secret:synthetic-b/synthetic.pem:not_covered', 'secret:synthetic.pem:not_covered']);
 assert.equal(r.counts.ignoreFilesUnavailable, 1); assert.equal(r.counts.symlinks, 2); assert.deepEqual(opened, []);
 const off = await runAudit(t.root, []); assert.equal(off.counts.ignoreFilesUnavailable, 0); assert.ok(off.findings.every(f => f.coverage === 'not_covered'));
 const unk = await runAudit(t.root, undefined); assert.equal(unk.counts.ignoreFilesUnavailable, 0); await rm(t.base, { recursive: true });
});
test('evaluation yields on elapsed time as well as on count', async () => {
 const files: Record<string, number> = {}; for (let i = 0; i < 20; i++) files[`synthetic-${i}.pem`] = 1;
 const run = async (step: number) => {
  let clock = 0, ran = false; setImmediate(() => { ran = true; });
  await runAudit('/synthetic-root', NAMES, { walkFs: fakeWalk(files), readFs: realRead(), now: () => (clock += step), limits: { yieldEvery: 1_000_000, timeBudgetMs: 1e9 } });
  return ran;
 };
 assert.equal(await run(0), false); assert.equal(await run(1), false); assert.equal(await run(40), true);
});
test('ignore rules are capped across all sources', async () => {
 const t = await temp(); const rules = (n: number) => Array.from({ length: 2_000 }, (_, i) => `synthetic-${n}-${i}.tmp`).join('\n');
 for (let n = 0; n < 11; n++) { await put(t.root, `synthetic-d${String(n).padStart(2, '0')}/.kiroignore`, rules(n)); await put(t.root, `synthetic-d${String(n).padStart(2, '0')}/synthetic.pem`, 'x'); }
 const r = await runAudit(t.root, NAMES);
 assert.equal(r.status, 'partial'); assert.deepEqual(r.reasons, ['ignore_rule_limit']); assert.equal(r.counts.ignoreFiles, 10); assert.equal(r.counts.ignoreFilesUnavailable, 1);
 assert.ok(shape(r).includes('secret:synthetic-d09/synthetic.pem:not_covered')); assert.ok(shape(r).includes('secret:synthetic-d10/synthetic.pem:unknown')); await rm(t.base, { recursive: true });
});
test('disabled mode stays not covered even when the time budget is exhausted', async () => {
 // The clock jumps once the root listing is done, so the walk completes and only the evaluation phase is over budget.
 const run = async (setting: string[]) => {
  let clock = 0; const inner = fakeWalk({ 'synthetic.pem': 1, 'synthetic.key': 1 });
  const walkFs: WalkFs = { lstat: inner.lstat, async readdir(p) { const l = await inner.readdir(p); clock += 1_000; return l; } };
  return runAudit('/synthetic-root', setting, { walkFs, readFs: realRead(), now: () => clock, limits: { timeBudgetMs: 500 } });
 };
 const off = await run([]);
 assert.equal(off.ignore, 'disabled'); assert.equal(off.status, 'complete'); assert.deepEqual(shape(off), ['secret:synthetic.key:not_covered', 'secret:synthetic.pem:not_covered']); assert.equal(off.counts.unknown, 0);
 const on = await run(NAMES); assert.deepEqual(on.reasons, ['evaluation_time_limit']); assert.ok(on.findings.length === 2 && on.findings.every(f => f.coverage === 'unknown'));
});
test('entries that could be ignore files but are never read make their directory unknown', async () => {
 const tree = { 'synthetic-a/synthetic.pem': 1, 'synthetic-b/synthetic.pem': 1, 'synthetic-c/synthetic.pem': 1, 'synthetic-d/synthetic.pem': 1, 'synthetic-e/synthetic.pem': 1, 'synthetic-e/.KiroIgnore': 1, 'synthetic-f/synthetic.pem': 1, 'synthetic-f/.kiroignore': 1 };
 const walkFs = fakeWalk(tree);
 // Case-sensitive: only an exact name counts, and a differently cased file is an ordinary file.
 const cs = await runAudit('/synthetic-root', NAMES, { walkFs, readFs: realRead(), caseInsensitive: false });
 assert.ok(shape(cs).includes('secret:synthetic-e/synthetic.pem:not_covered')); assert.equal(cs.counts.ignoreFilesUnavailable, 1);
 const ci = await runAudit('/synthetic-root', NAMES, { walkFs, readFs: realRead(), caseInsensitive: true });
 assert.ok(shape(ci).includes('secret:synthetic-e/synthetic.pem:unknown')); assert.ok(shape(ci).includes('secret:synthetic-a/synthetic.pem:not_covered')); assert.equal(ci.counts.ignoreFilesUnavailable, 2);
 const t = await temp(); await put(t.root, 'synthetic-a/synthetic.pem', 'x'); await put(t.root, 'synthetic-b/synthetic.pem', 'x'); await put(t.root, 'synthetic-c/synthetic.pem', 'x'); await put(t.root, 'synthetic-d/synthetic.pem', 'x');
 await put(t.root, 'synthetic-outside/rules', 'x'); await symlink(join(t.root, 'synthetic-outside', 'rules'), join(t.root, 'synthetic-a', '.KIROIGNORE'));
 const links = await runAudit(t.root, NAMES, { caseInsensitive: true }); assert.ok(shape(links).includes('secret:synthetic-a/synthetic.pem:unknown')); assert.ok(shape(links).includes('secret:synthetic-b/synthetic.pem:not_covered'));
 const exact = await runAudit(t.root, NAMES, { caseInsensitive: false }); assert.ok(shape(exact).includes('secret:synthetic-a/synthetic.pem:not_covered'));
 // Special and unreadable entries: an injected filesystem reports them as odd.
 const base = fakeWalk({ 'synthetic-p/synthetic.pem': 1, 'synthetic-q/synthetic.pem': 1, 'synthetic-q/.kiroignore': 1, 'synthetic-r/synthetic.pem': 1, 'synthetic-r/other': 1 });
 const failing: WalkFs = { ...base, async lstat(p) { if (p.replace(/\\/g, '/').endsWith('synthetic-q/.kiroignore')) throw new Error('synthetic-denied'); return base.lstat(p); } };
 const odd = await runAudit('/synthetic-root', NAMES, { walkFs: failing, readFs: realRead(), caseInsensitive: false });
 assert.ok(shape(odd).includes('secret:synthetic-q/synthetic.pem:unknown')); assert.ok(shape(odd).includes('secret:synthetic-p/synthetic.pem:not_covered')); assert.ok(shape(odd).includes('secret:synthetic-r/synthetic.pem:not_covered'));
 assert.equal(odd.counts.ignoreFilesUnavailable, 1); assert.ok(!JSON.stringify(odd).includes('synthetic-denied'));
 const off = await runAudit('/synthetic-root', [], { walkFs: failing }); assert.equal(off.counts.ignoreFilesUnavailable, 0); await rm(t.base, { recursive: true });
});
test('flags a .kiroignore file that the setting does not list', async () => {
 const t = await temp(); await put(t.root, 'synthetic-a/.kiroignore', '*.pem\n'); await put(t.root, 'synthetic.pem', 'x');
 const unlisted = await runAudit(t.root, ['.gitignore'], { caseInsensitive: false });
 assert.equal(unlisted.kiroignoreNotListed, true); assert.equal(unlisted.ignore, 'evaluated'); assert.equal(unlisted.counts.ignoreFiles, 0);
 assert.equal((await runAudit(t.root, [], { caseInsensitive: false })).kiroignoreNotListed, true);
 assert.equal('kiroignoreNotListed' in await runAudit(t.root, ['.gitignore', '.kiroignore']), false); assert.equal('kiroignoreNotListed' in await runAudit(t.root, undefined), false);
 assert.equal('kiroignoreNotListed' in await runAudit(t.root, ['.KIROIGNORE'], { caseInsensitive: true }), false);
 await rm(t.base, { recursive: true }); const none = await temp(); await put(none.root, 'synthetic.pem', 'x'); assert.equal('kiroignoreNotListed' in await runAudit(none.root, ['.gitignore']), false); await rm(none.base, { recursive: true });
});
