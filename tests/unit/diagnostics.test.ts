import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { snapshotFacts, buildDiagnostics, formatDiagnostics, DIAGNOSTICS_HEADER, STATUSES, FORECAST_TIERS, storeStateFor, type DiagnosticsInput } from '../../src/diagnostics.ts';
import { startExtension } from '../../src/extension/controller.ts';
import { STORE_VERSION } from '../../src/store.ts';
import { view } from '../../src/view.ts';
import { syntheticSnapshot } from './synthetic.ts';

const line = '2026-10-10 10:00:00.000 [info] synthetic-envelope ' + JSON.stringify({ commandName: 'GetUsageLimitsCommand', input: {}, output: { userInfo: { userId: 'synthetic-account' }, nextDateReset: '2026-11-01T00:00:00.000Z', usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS', currentUsageWithPrecision: 4.35, usageLimitWithPrecision: 50, nextDateReset: '2026-11-01T00:00:00.000Z', bonuses: [], overageCredits: [] }] }, metadata: { httpStatusCode: 200 } }) + '\n';
const fields = (text: string) => Object.fromEntries(text.split('\n').slice(1).filter(Boolean).map(l => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)]));
const forbidden = (text: string) => {
 for (const marker of ['4.35', '45.65', 'synthetic-', 'SYNTHETIC', 'Europe/Berlin', '/', '\\']) assert.ok(!text.includes(marker), marker);
 assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text)); assert.ok(!/\d{2}:\d{2}:\d{2}/.test(text));
};
async function fixture(prefix: string) {
 const base = await realpath(await mkdtemp(join(tmpdir(), prefix))); const root = join(base, 'source');
 const dir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent'); await mkdir(dir, { recursive: true });
 await writeFile(join(dir, 'q-client.log'), line);
 return { base, root };
}

test('hostile input is replaced by fixed placeholders or dropped', () => {
 const hostile: DiagnosticsInput = {
  version: '1.0.0 SYNTHETIC_SECRET', surface: 'SYNTHETIC_SURFACE', editor: '/Users/synthetic-user/Kiro', editorVersion: '1.2 3 synthetic-token', platform: '/synthetic/path', arch: 'x 64',
  node: 'v24.0.0 synthetic-private', electron: 'synthetic-electron\n', sqlite: 'synthetic-yes', store: 'synthetic-store', storage: '/synthetic/storage', source: 'C:\\synthetic\\source',
  timezone: 'Europe/Berlin', gauge: 'SYNTHETIC', status: 'synthetic-unknown-status 4.35', forecast: '45.65', snapshots: '4.35', accounts: -1, observedAgeMs: 'synthetic', discoveredLogs: 1.5, audit: 'yes',
  importCodes: { 'a/b': 3, '2026-10-10T10:00:00Z': 1, bad_value: 4.35, text_value: 'synthetic-sentinel', '': 1, other: 7, good_code: 2, UPPER: 1, [`${'x'.repeat(41)}`]: 1 }
 };
 const text = formatDiagnostics(buildDiagnostics(hostile));
 forbidden(text); assert.ok(!text.includes('Kiro'));
 const f = fields(text);
 assert.equal(f.cyclegauge, 'other'); assert.equal(f.surface, 'extension'); assert.equal(f.editor, 'other'); assert.equal(f.editor_version, 'other'); assert.equal(f.platform, 'other'); assert.equal(f.arch, 'other');
 assert.equal(f.node, 'other'); assert.equal(f.electron, 'other'); assert.equal(f.sqlite, 'unknown'); assert.equal(f.store, 'other'); assert.equal(f.storage, 'unknown'); assert.equal(f.source, 'unknown'); assert.equal(f.timezone, 'unknown');
 assert.equal(f.gauge, 'other'); assert.equal(f.status, 'other'); assert.equal(f.forecast, 'other'); assert.equal(f.snapshots, 'unavailable'); assert.equal(f.accounts, 'unavailable'); assert.equal(f.freshness, 'other');
 assert.equal(f.discovered_logs, 'unavailable'); assert.equal(f.audit, 'unavailable');
 assert.equal(f.import_codes, 'good_code=2, other=8');
});

test('a clean report has the header and exactly the allowlisted fields', () => {
 const text = formatDiagnostics(buildDiagnostics({ surface: 'extension', editor: 'Synthetic Editor-1.2', editorVersion: '1.99.0', platform: 'darwin', arch: 'arm64', node: '24.13.0', electron: '39.0.0-beta.1', sqlite: true, store: 'ok',
  storage: 'default', source: 'chosen', timezone: 'device', gauge: 'running', status: 'observed', forecast: 'provisional', snapshots: 3, accounts: 1, observedAgeMs: 5_400_000, importCodes: { no_source_logs: 1, source_changed: 2 }, discoveredLogs: 4, audit: true }));
 assert.ok(text.startsWith(DIAGNOSTICS_HEADER + '\n')); assert.ok(text.endsWith('\n'));
 assert.deepEqual(Object.keys(fields(text)), ['cyclegauge', 'surface', 'editor', 'editor_version', 'platform', 'arch', 'node', 'electron', 'sqlite', 'store_version', 'store', 'storage', 'source', 'timezone', 'gauge', 'status', 'forecast', 'snapshots', 'accounts', 'unassociated', 'freshness', 'import_codes', 'discovered_logs', 'audit', 'rejected_messages']);
 assert.deepEqual(fields(text), { cyclegauge: fields(text).cyclegauge, surface: 'extension', editor: 'Synthetic Editor-1.2', editor_version: '1.99.0', platform: 'darwin', arch: 'arm64', node: '24.13.0', electron: '39.0.0-beta.1', sqlite: 'available',
  store_version: String(STORE_VERSION), store: 'ok', storage: 'default', source: 'chosen', timezone: 'device', gauge: 'running', status: 'observed', forecast: 'provisional', snapshots: '3', accounts: '1', unassociated: 'unavailable', freshness: '1-24h',
  import_codes: 'no_source_logs=1, source_changed=2', discovered_logs: '4', audit: 'available', rejected_messages: '0' });
 assert.match(fields(text).cyclegauge, /^\d+\.\d+\.\d+/);
 for (const [age, label] of [[null, 'none'], [0, '<1h'], [-5, '<1h'], [3_599_999, '<1h'], [3_600_000, '1-24h'], [86_400_000, '1-24h'], [86_400_001, '>24h']] as const) assert.equal(fields(formatDiagnostics(buildDiagnostics({ observedAgeMs: age }))).freshness, label);
 assert.equal(fields(formatDiagnostics(buildDiagnostics({}))).import_codes, 'none');
 assert.equal(fields(formatDiagnostics(buildDiagnostics({ rejectedMessages: 7 }))).rejected_messages, '7');
 assert.equal(fields(formatDiagnostics(buildDiagnostics({ rejectedMessages: 'synthetic-private' }))).rejected_messages, 'unavailable');
});

test('accounts count only associated partitions and unassociated snapshots are counted separately', () => {
 const facts = snapshotFacts([syntheticSnapshot('2030-05-01T00:00:00.000Z', '1'), syntheticSnapshot('2030-05-02T00:00:00.000Z', '2'),
  syntheticSnapshot('2030-05-03T00:00:00.000Z', '3', { partition: 'synthetic-private-second', associated: false }), syntheticSnapshot('2030-05-04T00:00:00.000Z', '4', { partition: 'synthetic-private-third', associated: false })]);
 assert.deepEqual(facts, { snapshots: 4, accounts: 1, unassociated: 2, latestMs: Date.parse('2030-05-04T00:00:00.000Z') });
 assert.deepEqual(snapshotFacts([]), { snapshots: 0, accounts: 0, unassociated: 0, latestMs: undefined });
 assert.equal(snapshotFacts([syntheticSnapshot('synthetic-not-a-date', '1')]).latestMs, undefined);
 const f = fields(formatDiagnostics(buildDiagnostics({ ...facts, observedAgeMs: 0 })));
 assert.equal(f.snapshots, '4'); assert.equal(f.accounts, '1'); assert.equal(f.unassociated, '2');
 const cli = fields(formatDiagnostics(buildDiagnostics({ surface: 'cli', collection: 'synthetic-bad' }))); assert.equal(cli.collection, 'other');
 assert.ok(!('collection' in fields(formatDiagnostics(buildDiagnostics({ surface: 'extension', collection: 'ok' })))));
 assert.equal(fields(formatDiagnostics(buildDiagnostics({ surface: 'cli' }))).collection, 'not_run');
});

test('the CLI surface omits editor and gauge fields, and the status allowlist covers what view() produces', () => {
 const f = fields(formatDiagnostics(buildDiagnostics({ surface: 'cli', electron: undefined })));
 assert.equal(f.surface, 'cli'); assert.equal(f.editor, 'none'); assert.equal(f.editor_version, 'none'); assert.equal(f.electron, 'none'); assert.ok(!('gauge' in f));
 const now = '2030-06-01T00:00:00.000Z', recent = syntheticSnapshot('2030-05-31T23:00:00.000Z', '10');
 const produced = new Set([
  view([], now).status, view([recent, syntheticSnapshot('2030-05-31T22:00:00.000Z', '9', { partition: 'synthetic-other-account' })], now).status, view([syntheticSnapshot('2030-05-31T23:00:00.000Z', '10', { associated: false })], now).status,
  view([recent, syntheticSnapshot('2030-05-31T23:00:00.000Z', '11')], now).status, view([syntheticSnapshot('2030-06-02T00:00:00.000Z', '10')], now).status, view([syntheticSnapshot('2030-05-01T00:00:00.000Z', '10')], now).status,
  view([recent], now).status, view([syntheticSnapshot('2030-05-31T23:00:00.000Z', '10', { resetAt: '2030-05-31T23:30:00.000Z' })], now).status]);
 assert.deepEqual([...produced].sort(), [...STATUSES].sort());
 assert.deepEqual(['unavailable', 'provisional', 'regular'], [...FORECAST_TIERS]);
 assert.equal(storeStateFor(new Error('RUNTIME_UNSUPPORTED')), 'runtime_unsupported'); assert.equal(storeStateFor(new Error('STORAGE_NEWER')), 'storage_newer');
 assert.equal(storeStateFor(new Error('/synthetic/path')), 'unavailable'); assert.equal(storeStateFor('RUNTIME_UNSUPPORTED'), 'unavailable');
});

test('the controller reports fixed counts and status after a synthetic import', async () => {
 const { base, root } = await fixture('synthetic-diagnostics-controller-');
 const ui = { setStatus() {}, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  let now = '2026-10-10T08:30:00.000Z';
  const controller = await startExtension(ui, { source: root, storage: join(base, 'owned'), timezone: 'Europe/Berlin', now: () => now });
  const input = controller.diagnostics();
  assert.deepEqual({ ...input, observedAgeMs: undefined }, { store: 'ok', status: 'observed', forecast: 'unavailable', snapshots: 1, accounts: 1, unassociated: 0, observedAgeMs: undefined, importCodes: {} });
  const text = formatDiagnostics(buildDiagnostics({ ...input, surface: 'extension', gauge: 'running' }));
  assert.equal(fields(text).freshness, '<1h'); assert.equal(fields(text).status, 'observed'); assert.equal(fields(text).snapshots, '1'); assert.equal(fields(text).accounts, '1'); forbidden(text);
  now = '2026-10-12T09:00:00.000Z'; await controller.refresh();
  const later = formatDiagnostics(buildDiagnostics({ ...controller.diagnostics(), surface: 'extension' }));
  assert.equal(fields(later).status, 'stale'); assert.equal(fields(later).freshness, '>24h'); forbidden(later);
  controller.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});

test('the controller reports a fixed store code when the store cannot be opened', async () => {
 const { base, root } = await fixture('synthetic-diagnostics-failed-');
 await writeFile(join(base, 'not-a-directory'), 'x');
 const ui = { setStatus() {}, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  const controller = await startExtension(ui, { source: root, storage: join(base, 'not-a-directory'), timezone: 'UTC', now: () => '2026-10-10T09:00:00.000Z' });
  const f = fields(formatDiagnostics(buildDiagnostics({ ...controller.diagnostics(), surface: 'extension' })));
  assert.equal(f.store, 'unavailable'); assert.equal(f.status, 'unavailable'); assert.equal(f.snapshots, 'unavailable'); assert.equal(f.freshness, 'none');
  controller.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});

test('CLI --diagnostics prints only the fixed report and exits 0', async () => {
 const { base, root } = await fixture('synthetic-diagnostics-cli-');
 const run = (args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('src/cli.ts'), ...args], { encoding: 'utf8' });
 try {
  const r = run(['--source-root', root, '--store-dir', join(base, 'gauge'), '--source-timezone', 'Europe/Berlin', '--diagnostics']);
  assert.equal(r.status, 0); assert.equal(r.stderr, ''); assert.ok(r.stdout.startsWith(DIAGNOSTICS_HEADER + '\n'));
  const f = fields(r.stdout);
  assert.equal(f.surface, 'cli'); assert.equal(f.store, 'ok'); assert.equal(f.storage, 'chosen'); assert.equal(f.source, 'chosen'); assert.equal(f.timezone, 'chosen'); assert.equal(f.snapshots, '1'); assert.equal(f.accounts, '1'); assert.equal(f.unassociated, '0'); assert.equal(f.collection, 'ok');
  assert.match(f.status, /^(stale|observed|reset_elapsed)$/); assert.equal(f.import_codes, 'none'); assert.ok(!('gauge' in f));
  for (const marker of [base, root, 'synthetic-account', 'Europe/Berlin', '4.35', '45.65']) assert.ok(!r.stdout.includes(marker), marker);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(r.stdout));
  assert.ok(run(['--help']).stdout.includes('--diagnostics'));
  const bad = run(['--diagnostics', '--max-age-hours', '-1']); assert.equal(bad.status, 1); assert.equal(bad.stdout.trim(), 'CONFIGURATION_INVALID'); assert.equal(bad.stderr, '');
  await writeFile(join(base, 'not-a-directory'), 'x');
  const failed = run(['--source-root', root, '--store-dir', join(base, 'not-a-directory'), '--diagnostics']);
  assert.equal(failed.status, 0); assert.equal(fields(failed.stdout).store, 'unavailable'); assert.equal(failed.stderr, ''); assert.ok(!failed.stdout.includes(base));
 } finally { await rm(base, { recursive: true, force: true }); }
});

test('CLI --diagnostics counts unassociated snapshots, reports an unset timezone and keeps store ok when collection fails', async () => {
 const { base, root } = await fixture('synthetic-diagnostics-cli-parts-');
 const run = (args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('src/cli.ts'), ...args], { encoding: 'utf8' });
 try {
  const second = join(root, 'logs', 'synthetic-run', 'synthetic-window-two', 'exthost', 'kiro.kiroAgent'); await mkdir(second, { recursive: true });
  await writeFile(join(second, 'q-client.log'), line.replace('"userInfo":{"userId":"synthetic-account"},', '').replace('10:00:00', '11:00:00'));
  const store = join(base, 'gauge');
  const r = run(['--source-root', root, '--store-dir', store, '--source-timezone', 'UTC', '--diagnostics']); const f = fields(r.stdout);
  assert.equal(r.status, 0); assert.equal(r.stderr, ''); assert.equal(f.timezone, 'chosen'); assert.equal(f.collection, 'ok'); assert.equal(f.snapshots, '2'); assert.equal(f.accounts, '1'); assert.equal(f.unassociated, '1');
  // A trigger in the synthetic store makes every later insert fail: the store still opens, but collection is unavailable.
  const db = new DatabaseSync(join(store, 'usage.sqlite'));
  try { db.exec("CREATE TRIGGER synthetic_block BEFORE INSERT ON sources BEGIN SELECT RAISE(ABORT, 'synthetic'); END"); } finally { db.close(); }
  await writeFile(join(second, 'q-client.log'), line.replace('10:00:00', '12:00:00'));
  const failed = run(['--source-root', root, '--store-dir', store, '--source-timezone', 'UTC', '--diagnostics']); const g = fields(failed.stdout);
  assert.equal(failed.status, 0); assert.equal(failed.stderr, ''); assert.equal(g.store, 'ok'); assert.equal(g.collection, 'unavailable'); assert.equal(g.import_codes, 'none'); assert.equal(g.snapshots, '2');
  assert.ok(!failed.stdout.includes(base)); assert.ok(!failed.stdout.includes('synthetic_block'));
  const missing = run(['--source-root', join(base, 'synthetic-missing'), '--store-dir', join(base, 'fresh'), '--diagnostics']);
  assert.equal(missing.status, 0); assert.equal(fields(missing.stdout).timezone, 'unset'); assert.equal(fields(missing.stdout).collection, 'ok'); assert.equal(fields(missing.stdout).import_codes, 'no_source_logs=1, source_unavailable=1');
 } finally { await rm(base, { recursive: true, force: true }); }
});
