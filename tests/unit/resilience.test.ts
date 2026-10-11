import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, open as openFile, readdir, realpath, rename, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from '../../src/collector.ts';
import { readLog } from '../../src/source.ts';
import { Store } from '../../src/store.ts';
import { view } from '../../src/view.ts';

// Milestone 6 Task 8: rotation, replacement, truncation, partial writes, several windows and several
// processes. Everything is synthetic. Windows storage stays refused, so these tests are skipped
// there (they would only reproduce the fail-closed baseline failures).
// Cleanup always runs, also when an assertion fails: temp directories and open stores are tracked.
const cleanups: (() => Promise<void>)[] = [];
const test = (name: string, fn: () => Promise<void>, timeout = 60_000) =>
 baseTest(name, { skip: process.platform === 'win32', timeout }, async () => {
  try { await fn(); } finally { for (const c of cleanups.splice(0).reverse()) await c(); }
 });
const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

const line = (usage: string, minute: number, user = 'synthetic-account-a') =>
 `2030-06-29 18:${String(minute).padStart(2, '0')}:00.000 [info] synthetic-envelope ${JSON.stringify({
  commandName: 'GetUsageLimitsCommand', output: { userInfo: { userId: user }, nextDateReset: '2030-07-01T00:00:00Z',
   usageBreakdownList: [{ resourceType: 'CREDIT', currentUsageWithPrecision: Number(usage), usageLimitWithPrecision: 100 }] },
  metadata: { httpStatusCode: 200 } })}`;
async function fixture(windows = 1) {
 const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-resilience-'));
 cleanups.push(async () => { await rm(base, { recursive: true, force: true }); });
 const root = join(base, 'Kiro');
 const dirs: string[] = [];
 for (let i = 1; i <= windows; i++) {
  const dir = join(root, 'logs', 'synthetic-run', `synthetic-window-${i}`, 'exthost', 'kiro.kiroAgent');
  await mkdir(dir, { recursive: true });
  dirs.push(dir);
 }
 return { base, root, dir: dirs[0], dirs, file: join(dirs[0], 'q-client.log'), storage: join(base, 'gauge') };
}
const done = async (f: { base: string }, ...stores: Store[]) => { for (const s of stores) s.close(); await rm(f.base, { recursive: true, force: true }); };
const openStore = (f: { storage: string; root: string }) => {
 const store = new Store(f.storage, f.root);
 cleanups.push(async () => { try { store.close(); } catch { /* already closed */ } });
 return store;
};

test('logrotate-style rotation neither re-imports old observations nor loses new ones', async () => {
 const f = await fixture(); const store = openStore(f);
 await writeFile(f.file, line('1', 0) + '\n' + line('2', 10) + '\n');
 assert.equal((await collect(f.root, store, 'UTC')).imported, 2);
 await rename(f.file, f.file + '.1');
 await writeFile(f.file, line('3', 20) + '\n');
 let r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 1); assert.equal(r.duplicates, 2); assert.equal(store.snapshots().length, 3);
 await rename(f.file + '.1', f.file + '.2'); await rename(f.file, f.file + '.1');
 await writeFile(f.file, line('4', 30) + '\n');
 r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 1); assert.equal(r.duplicates, 3); assert.equal(store.snapshots().length, 4);
 assert.ok(!('source_unavailable' in r.codes) && !('unsafe_source' in r.codes));
 await done(f, store);
});

test('replacing the file by rename keeps content-based deduplication and flags the identity change', async () => {
 const f = await fixture(); const store = openStore(f);
 await writeFile(f.file, line('1', 0) + '\n');
 assert.equal((await collect(f.root, store, 'UTC')).imported, 1);
 await writeFile(f.file + '.tmp', line('1', 0) + '\n');
 await rename(f.file + '.tmp', f.file);
 const r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 0); assert.equal(r.duplicates, 1);
 assert.equal(store.snapshots().length, 1);
 await done(f, store);
});

test('truncation to zero and regrowth reports a change and imports only what is new', async () => {
 const f = await fixture(); const store = openStore(f);
 await writeFile(f.file, line('1', 0) + '\n' + line('2', 10) + '\n');
 assert.equal((await collect(f.root, store, 'UTC')).imported, 2);
 await truncate(f.file, 0);
 let r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 0);
 assert.equal(store.snapshots().length, 2, 'truncation never deletes or zeroes stored observations');
 await writeFile(f.file, line('3', 20) + '\n');
 r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 1); assert.equal(store.snapshots().length, 3);
 await done(f, store);
});

test('a record written in two parts is imported once, after it is complete', async () => {
 const f = await fixture(); const store = openStore(f);
 const second = line('2', 10);
 await writeFile(f.file, line('1', 0) + '\n' + second.slice(0, 60));
 let r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 1); assert.equal(r.codes.partial_record, 1);
 await appendFile(f.file, second.slice(60));
 r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 0, 'still unterminated, so still deferred'); assert.equal(r.codes.partial_record, 1);
 await appendFile(f.file, '\n');
 r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 1); assert.ok(!('partial_record' in r.codes));
 assert.equal(store.snapshots().length, 2);
 await done(f, store);
});

// Characterisation of the CURRENT checkpoint semantics, kept apart so that a deliberate redesign of
// change detection only has to touch this one test. `source_changed` is raised whenever the stored
// fingerprint (identity, birth time and whole-file digest) or a smaller size differs.
test('current checkpoint semantics: identity change and truncation raise source_changed, an unchanged file does not', async () => {
 const f = await fixture(); const store = openStore(f);
 await writeFile(f.file, line('1', 0) + '\n');
 let r = await collect(f.root, store, 'UTC');
 assert.ok(!('source_changed' in r.codes));
 r = await collect(f.root, store, 'UTC');
 assert.ok(!('source_changed' in r.codes), 'unchanged file');
 await writeFile(f.file + '.tmp', line('1', 0) + '\n'); await rename(f.file + '.tmp', f.file);
 r = await collect(f.root, store, 'UTC');
 assert.equal(r.codes.source_changed, 1, 'replacement with identical content');
 await truncate(f.file, 0);
 r = await collect(f.root, store, 'UTC');
 assert.equal(r.codes.source_changed, 1, 'truncation');
});

test('CRLF line endings import the same observations as LF', async () => {
 const f = await fixture(); const store = openStore(f);
 await writeFile(f.file, line('1', 0) + '\r\n' + line('2', 10) + '\r\n');
 const first = await collect(f.root, store, 'UTC');
 assert.equal(first.imported, 2); assert.deepEqual(first.codes, {}, 'no malformed or partial record from the carriage returns');
 await writeFile(f.file, line('1', 0) + '\n' + line('2', 10) + '\n');
 const r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 0); assert.equal(r.duplicates, 2);
 await done(f, store);
});

test('a file removed between discovery and reading is an unavailable source, not an error or zero', async () => {
 const f = await fixture();
 const r = await readLog(join(f.dir, 'q-client.log'), 'UTC');
 assert.deepEqual(r, { records: [], codes: { source_unavailable: 1 } });
 await done(f);
});

test('a source that disappears keeps stored observations and never invents zero usage', async () => {
 const f = await fixture(); const store = openStore(f);
 await writeFile(f.file, line('7.5', 0) + '\n');
 assert.equal((await collect(f.root, store, 'UTC')).imported, 1);
 await rm(join(f.root, 'logs'), { recursive: true });
 const r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 0); assert.equal(r.codes.source_unavailable, 1);
 assert.equal(store.snapshots().length, 1);
 const observed = view(store.snapshots(), '2030-06-29T18:30:00Z');
 assert.equal(observed.usage, '7.5');
 await done(f, store);
});

test('unusual entries named like logs are rejected without being opened or blocking', async () => {
 const f = await fixture();
 await mkdir(join(f.dir, 'q-client.log.1'));
 const fifo = join(f.dir, 'q-client.log.2');
 const made = spawnSync('mkfifo', [fifo]).status === 0;
 await writeFile(f.file, line('1', 0) + '\n');
 const store = openStore(f);
 const r = await collect(f.root, store, 'UTC');
 assert.equal(r.imported, 1);
 assert.equal(r.codes.unsafe_source, made ? 2 : 1);
 await done(f, store);
});

test('size and observation limits discard the file without importing a partial result', async () => {
 const f = await fixture(); const store = openStore(f);
 await writeFile(join(f.dir, 'q-client.log.1'), line('1', 0) + '\n');
 const big = await openFile(f.file, 'w'); await big.truncate(65 * 1024 * 1024); await big.close();
 let r = await collect(f.root, store, 'UTC');
 assert.equal(r.codes.oversized_source, 1); assert.equal(r.imported, 1);
 await writeFile(f.file, (line('1', 1) + '\n').repeat(10_001));
 r = await collect(f.root, store, 'UTC');
 assert.equal(r.codes.observation_limit, 1); assert.equal(store.snapshots().length, 1);
 await done(f, store);
});

test('several windows and several store connections converge on one deduplicated history', async () => {
 const f = await fixture(3);
 const stores = [openStore(f), openStore(f), openStore(f)];
 let expected = 0;
 for (let round = 0; round < 5; round++) {
  const fresh = line(String(round + 1), round * 5);
  expected++;
  // Every window writes the shared observation; one window also writes its own.
  for (const dir of f.dirs) await appendFile(join(dir, 'q-client.log'), fresh + '\n');
  await appendFile(join(f.dirs[round % 3], 'q-client.log'), line(String(round + 1.5), round * 5 + 2) + '\n');
  expected++;
  const results = await Promise.all(stores.map(s => collect(f.root, s, 'UTC')));
  for (const r of results) assert.ok(!('source_unavailable' in r.codes) && !('unsafe_source' in r.codes), JSON.stringify(r.codes));
  assert.equal(stores[0].snapshots().length, expected);
  assert.equal(stores[2].snapshots().length, expected);
 }
 await done(f, ...stores);
});

test('simultaneous processes creating and using one new store all succeed and import once', async () => {
 const f = await fixture(2);
 for (const dir of f.dirs) await writeFile(join(dir, 'q-client.log'), line('1', 0) + '\n' + line('2', 10) + '\n');
 const run = () => new Promise<{ status: number | null; out: string; err: string }>(done => {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, '--source-root', f.root,
   '--store-dir', f.storage, '--source-timezone', 'UTC', '--json', '--max-age-hours', '8000'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 45_000, killSignal: 'SIGKILL' });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  child.on('close', status => done({ status, out, err }));
 });
 const results = await Promise.all([run(), run(), run(), run()]);
 for (const r of results) { assert.equal(r.status, 0, r.out); assert.equal(r.err, ''); }
 const imported = results.reduce((n, r) => n + JSON.parse(r.out).import.imported, 0);
 assert.equal(imported, 2, 'each unique observation is imported exactly once across processes');
 const store = openStore(f);
 assert.equal(store.snapshots().length, 2);
 assert.deepEqual((await readdir(f.storage)).sort().filter(n => !/-(journal|wal|shm)$/.test(n)), ['device.key', 'usage.sqlite']);
 await done(f, store);
});

test('a key file another process is still writing is waited for, never replaced or rejected', async () => {
 const f = await fixture();
 await mkdir(f.storage, { mode: 0o700 });
 const keyPath = join(f.storage, 'device.key');
 await writeFile(keyPath, '', { mode: 0o600, flag: 'wx' });
 const key = Buffer.from('0123456789abcdef0123456789abcdef');
 const writer = spawn(process.execPath, ['-e',
  `const {writeFileSync}=require('node:fs');process.stdout.write('ready\\n');setTimeout(()=>writeFileSync(${JSON.stringify(keyPath)},Buffer.from(${JSON.stringify(key.toString())})),80);`],
  { stdio: ['ignore', 'pipe', 'inherit'] });
 await new Promise<void>(ok => writer.stdout.once('data', () => ok()));
 cleanups.push(async () => { writer.kill(); });
 const closed = new Promise<void>(ok => writer.on('close', () => ok()));
 const store = openStore(f);
 const { createHmac } = await import('node:crypto');
 assert.equal(store.token('kind', 'value'), createHmac('sha256', key).update('kind\0value').digest('hex'));
 await closed;
 await done(f, store);
});

test('a key file that never becomes complete is still rejected with the fixed code', async () => {
 const f = await fixture();
 await mkdir(f.storage, { mode: 0o700 });
 await writeFile(join(f.storage, 'device.key'), 'short', { mode: 0o600 });
 assert.throws(() => openStore(f), /^Error: STORAGE_UNAVAILABLE$/);
 await done(f);
});
