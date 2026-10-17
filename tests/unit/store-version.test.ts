import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store, STORE_VERSION, MIGRATIONS, MAX_IMPORT_ROWS, type Migration } from '../../src/store.ts';
async function setup() {
 const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-store-version-')); const root = join(base, 'source');
 await mkdir(root, { recursive: true });
 return { base, root, storage: join(base, 'gauge'), db: join(base, 'gauge', 'usage.sqlite') };
}
const raw = <T>(path: string, work: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(path); try { return work(db); } finally { db.close(); } };
const version = (path: string) => raw(path, db => (db.prepare('SELECT version FROM meta').get() as { version: number }).version);
const tables = (path: string) => raw(path, db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name));
const bodies = (path: string) => raw(path, db => db.prepare('SELECT body FROM imports ORDER BY id').all().map(r => r.body as string));
const seedSnapshot = (path: string) => raw(path, db => db.prepare('INSERT INTO snapshots VALUES (?, ?, ?, ?, ?, ?)').run('synthetic-key', 'synthetic-partition', 0, '2030-01-01T00:00:00Z', '{}', '2030-01-01T00:00:01Z'));
const cleanup = (f: { base: string }) => rm(f.base, { recursive: true });

test('ladder is consistent and a fresh store is created at the current version', async () => {
 assert.equal(STORE_VERSION, 1 + MIGRATIONS.length);
 const f = await setup(); new Store(f.storage, f.root).close();
 assert.equal(version(f.db), STORE_VERSION); assert.deepEqual(tables(f.db), ['imports', 'meta', 'snapshots', 'sources']);
 await cleanup(f);
});
test('an existing store at the current version opens and keeps its rows', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); seedSnapshot(f.db);
 const s = new Store(f.storage, f.root); s.close();
 assert.equal(raw(f.db, db => (db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n), 1); assert.equal(version(f.db), STORE_VERSION);
 await cleanup(f);
});
test('a store written by a newer version is refused as STORAGE_NEWER without any write', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); seedSnapshot(f.db);
 raw(f.db, db => db.exec(`UPDATE meta SET version=${STORE_VERSION + 1}`));
 const before = await readFile(f.db);
 assert.throws(() => new Store(f.storage, f.root), /^Error: STORAGE_NEWER$/);
 assert.deepEqual(await readFile(f.db), before); assert.equal(version(f.db), STORE_VERSION + 1);
 await cleanup(f);
});
test('a newer store lacking current tables is still refused without creating them', async () => {
 const f = await setup(); new Store(f.storage, f.root).close();
 raw(f.db, db => db.exec(`DROP TABLE imports; UPDATE meta SET version=${STORE_VERSION + 5}`));
 const before = await readFile(f.db);
 assert.throws(() => new Store(f.storage, f.root), /^Error: STORAGE_NEWER$/);
 assert.deepEqual(await readFile(f.db), before); assert.deepEqual(tables(f.db), ['meta', 'snapshots', 'sources']);
 await cleanup(f);
});
test('an injected ladder runs pending migrations in order once and updates the version', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); seedSnapshot(f.db);
 const calls: string[] = [];
 const ladder: Migration[] = [
  db => { calls.push('v1-to-v2'); db.exec('CREATE TABLE synthetic_a(x INTEGER)'); },
  db => { calls.push('v2-to-v3'); db.exec('CREATE TABLE synthetic_b(x INTEGER)'); },
 ];
 new Store(f.storage, f.root, false, { migrations: ladder }).close();
 assert.deepEqual(calls, ['v1-to-v2', 'v2-to-v3']); assert.equal(version(f.db), 3);
 assert.ok(tables(f.db).includes('synthetic_a') && tables(f.db).includes('synthetic_b'));
 new Store(f.storage, f.root, false, { migrations: ladder }).close();
 assert.deepEqual(calls, ['v1-to-v2', 'v2-to-v3']); assert.equal(raw(f.db, db => (db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n), 1);
 await cleanup(f);
});
test('a ladder starting midway runs only the pending steps', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); raw(f.db, db => db.exec('UPDATE meta SET version=2'));
 const calls: number[] = [];
 new Store(f.storage, f.root, false, { migrations: [() => calls.push(1), () => calls.push(2)] }).close();
 assert.deepEqual(calls, [2]); assert.equal(version(f.db), 3);
 await cleanup(f);
});
test('a failing migration rolls back and leaves version, tables and rows unchanged', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); seedSnapshot(f.db);
 const before = tables(f.db);
 const ladder: Migration[] = [db => { db.exec('CREATE TABLE synthetic_a(x INTEGER)'); }, () => { throw new Error('SYNTHETIC_SECRET_DO_NOT_PRINT'); }];
 assert.throws(() => new Store(f.storage, f.root, false, { migrations: ladder }), (e: Error) => e.message === 'STORAGE_UNAVAILABLE');
 assert.equal(version(f.db), 1); assert.deepEqual(tables(f.db), before);
 assert.equal(raw(f.db, db => (db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n), 1);
 await cleanup(f);
});
test('a missing or duplicated meta row is STORAGE_UNAVAILABLE and nothing is repaired', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); raw(f.db, db => db.exec('DELETE FROM meta'));
 let before = await readFile(f.db);
 assert.throws(() => new Store(f.storage, f.root), /^Error: STORAGE_UNAVAILABLE$/); assert.deepEqual(await readFile(f.db), before);
 raw(f.db, db => db.exec('INSERT INTO meta VALUES (1); INSERT INTO meta VALUES (1)')); before = await readFile(f.db);
 assert.throws(() => new Store(f.storage, f.root), /^Error: STORAGE_UNAVAILABLE$/); assert.deepEqual(await readFile(f.db), before);
 await cleanup(f);
});
test('an existing database without a meta table is STORAGE_UNAVAILABLE and nothing is created', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); raw(f.db, db => db.exec('DROP TABLE meta'));
 const before = await readFile(f.db);
 assert.throws(() => new Store(f.storage, f.root), /^Error: STORAGE_UNAVAILABLE$/); assert.deepEqual(await readFile(f.db), before);
 await cleanup(f);
});
test('import evidence refreshes the time of consecutive duplicates and records changes', async () => {
 const f = await setup(); const s = new Store(f.storage, f.root);
 s.evidence('2030-01-01T00:00:00Z', { synthetic_code: 1 }); s.evidence('2030-01-01T00:01:00Z', { synthetic_code: 1 });
 assert.deepEqual(bodies(f.db), ['{"synthetic_code":1}']);
 assert.equal(raw(f.db, db => (db.prepare('SELECT ingested FROM imports').get() as { ingested: string }).ingested), '2030-01-01T00:01:00Z');
 s.evidence('2030-01-01T00:02:00Z', { synthetic_code: 2 }); s.evidence('2030-01-01T00:03:00Z', { synthetic_code: 1 });
 assert.deepEqual(bodies(f.db), ['{"synthetic_code":1}', '{"synthetic_code":2}', '{"synthetic_code":1}']);
 s.close(); await cleanup(f);
});
test('import evidence keeps exactly the newest rows and never touches snapshots or sources', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); seedSnapshot(f.db);
 const s = new Store(f.storage, f.root, false, { maxImportRows: 5 }); s.checkpoint('synthetic-source', 'synthetic-fingerprint', 7);
 for (let i = 1; i <= 12; i++) s.transaction(() => s.evidence('2030-01-01T00:00:00Z', { synthetic_code: i }));
 assert.deepEqual(bodies(f.db), [8, 9, 10, 11, 12].map(i => `{"synthetic_code":${i}}`));
 assert.equal(raw(f.db, db => (db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n), 1);
 assert.equal(raw(f.db, db => (db.prepare('SELECT COUNT(*) AS n FROM sources').get() as { n: number }).n), 1);
 s.close(); await cleanup(f);
});
test('the default cap is MAX_IMPORT_ROWS', async () => {
 assert.equal(MAX_IMPORT_ROWS, 10_000);
 const f = await setup(); new Store(f.storage, f.root).close();
 raw(f.db, db => { db.exec('BEGIN'); const insert = db.prepare('INSERT INTO imports(ingested, body) VALUES (?, ?)'); for (let i = 0; i < MAX_IMPORT_ROWS; i++) insert.run('2030-01-01T00:00:00Z', `{"synthetic_code":${i}}`); db.exec('COMMIT'); });
 const s = new Store(f.storage, f.root); s.evidence('2030-01-02T00:00:00Z', { synthetic_new: 1 }); s.close();
 const rows = bodies(f.db); assert.equal(rows.length, MAX_IMPORT_ROWS); assert.equal(rows[0], '{"synthetic_code":1}'); assert.equal(rows.at(-1), '{"synthetic_new":1}');
 await cleanup(f);
});
test('CLI prints only the fixed STORAGE_NEWER code for a newer store', async () => {
 const f = await setup(); new Store(f.storage, f.root).close(); raw(f.db, db => db.exec(`UPDATE meta SET version=${STORE_VERSION + 1}`));
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('src/cli.ts'), '--source-root', f.root, '--store-dir', f.storage, '--source-timezone', 'UTC'], { encoding: 'utf8' });
 assert.equal(r.status, 1); assert.equal(r.stdout.trim(), 'STORAGE_NEWER'); assert.equal(r.stderr, '');
 await cleanup(f);
});
