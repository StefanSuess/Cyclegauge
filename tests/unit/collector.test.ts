import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from '../../src/collector.ts';
import { Store } from '../../src/store.ts';
const synthetic = (usage = '1.25', user = 'synthetic-account-a', stamp = '2030-06-29 18:00:00.000') => `${stamp} [info] synthetic-envelope {"commandName":"GetUsageLimitsCommand","output":{"userInfo":{"userId":"${user}"},"nextDateReset":"2030-07-01T00:00:00Z","usageBreakdownList":[{"resourceType":"CREDIT","currentUsageWithPrecision":${usage},"usageLimitWithPrecision":100}]},"metadata":{"httpStatusCode":200}}`;
export async function fixture() {
 const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-gauge-'));
 const root = join(base, 'synthetic source ü'); const dir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 await mkdir(dir, { recursive: true });
 return { base, root, dir, file: join(dir, 'q-client.log'), storage: join(base, 'gauge') };
}
test('imports persistently, deduplicates restarts and never changes source metadata', async () => {
 const f = await fixture(); await writeFile(f.file, synthetic() + '\n' + synthetic() + '\n');
 const before = await stat(f.file); const contents = await readFile(f.file);
 let store = new Store(f.storage, f.root);
 const r = await collect(f.root, store, 'Europe/Berlin', '2030-06-29T16:01:00Z');
 assert.equal(r.imported, 1); assert.equal(r.duplicates, 1); store.close();
 store = new Store(f.storage, f.root); assert.equal((await collect(f.root, store, 'Europe/Berlin')).imported, 0);
 assert.equal(store.snapshots().length, 1);
 assert.deepEqual(await readFile(f.file), contents); assert.equal((await stat(f.file)).mtimeMs, before.mtimeMs);
 assert.deepEqual(await readdir(f.dir), ['q-client.log']);
 const serialized = JSON.stringify(store.snapshots()); assert.ok(!serialized.includes('synthetic-account-a')); assert.ok(!serialized.includes(f.root));
 store.close(); await rm(f.base, { recursive: true });
});
test('defers partial records, rejects malformed and oversized lines, detects truncation/rotation', async () => {
 const f = await fixture(); let store = new Store(f.storage, f.root);
 await writeFile(f.file, synthetic() + '\n2030-06-29 [info] GetUsageLimitsCommand {invalid}\n' + synthetic('2'));
 let r = await collect(f.root, store, 'Europe/Berlin'); assert.equal(r.imported, 1); assert.equal(r.codes.partial_record, 1); assert.equal(r.codes.malformed_record, 1);
 await writeFile(f.file, synthetic('2') + '\n'); r = await collect(f.root, store, 'Europe/Berlin'); assert.equal(r.codes.source_changed, 1); assert.equal(r.imported, 1);
 await writeFile(join(f.dir, 'q-client.log.1'), synthetic() + '\n');
 await writeFile(f.file, 'x'.repeat(300000) + '\n' + synthetic('3') + '\n');
 r = await collect(f.root, store, 'Europe/Berlin'); assert.equal(r.imported, 1); assert.equal(r.codes.oversized_record, 1);
 assert.equal(store.snapshots().length, 3); store.close(); await rm(f.base, { recursive: true });
});
test('rejects symlink sources and storage, source overlap and repository storage', async () => {
 const f = await fixture(); await writeFile(join(f.base, 'synthetic-outside'), synthetic() + '\n'); await symlink(join(f.base, 'synthetic-outside'), f.file);
 const store = new Store(f.storage, f.root); const r = await collect(f.root, store, 'UTC'); assert.equal(r.imported, 0); assert.equal(r.codes.unsafe_source, 1); store.close();
 assert.throws(() => new Store(join(f.root, 'logs', 'gauge'), f.root), /UNSAFE_STORAGE/); assert.throws(() => new Store(join(f.root, '..'), f.root), /UNSAFE_STORAGE/);
 await symlink(f.storage, join(f.base, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => new Store(join(f.base, 'link'), f.root), /UNSAFE_STORAGE/);
 await mkdir(join(f.base, 'repo', '.git'), { recursive: true }); assert.throws(() => new Store(join(f.base, 'repo', 'data'), f.root), /UNSAFE_STORAGE/);
 await rm(f.base, { recursive: true });
});
test('ignores unrelated filenames and isolates two accounts and unknown identity', async () => {
 const f = await fixture(); await writeFile(f.file, [synthetic(), synthetic('2', 'synthetic-account-b'), synthetic('3', '')].join('\n') + '\n');
 await writeFile(join(f.dir, 'session.json'), synthetic('999') + '\n');
 const store = new Store(f.storage, f.root); await collect(f.root, store, 'UTC');
 assert.equal(store.snapshots().length, 3); assert.equal(new Set(store.snapshots().map(s => s.partition)).size, 3);
 assert.ok(store.snapshots().some(s => !s.associated)); store.close(); await rm(f.base, { recursive: true });
});
