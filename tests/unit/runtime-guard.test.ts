import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Store, STORE_VERSION } from '../../src/store.ts';
import { startExtension } from '../../src/extension/controller.ts';
import { present } from '../../src/extension/presentation.ts';
import { view } from '../../src/view.ts';

async function setup() {
 const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-runtime-guard-')); const root = join(base, 'source');
 await mkdir(root, { recursive: true });
 return { base, root, storage: join(base, 'gauge'), db: join(base, 'gauge', 'usage.sqlite') };
}
const exists = (path: string) => access(path).then(() => true, () => false);
const UPDATE_NEEDED = '$(warning) Kiro: update needed';
const RUNTIME_TEXT = 'This Kiro version does not provide the SQLite support Cyclegauge needs. Update Kiro to use the credit gauge; the workspace audit still works.';
const NEWER_TEXT = 'Your Cyclegauge data was written by a newer Cyclegauge version. Update Cyclegauge; the data is left unchanged.';

test('a runtime without usable node:sqlite is refused as RUNTIME_UNSUPPORTED before anything is created', async () => {
 const loaders: Array<[string, () => unknown]> = [
  ['undefined module', () => undefined],
  ['throwing loader', () => { throw new Error('synthetic-loader-failure'); }],
  ['module without DatabaseSync', () => ({})],
  ['DatabaseSync that is not a constructor', () => ({ DatabaseSync: 'synthetic' })],
 ];
 for (const [label, sqlite] of loaders) {
  const f = await setup();
  assert.throws(() => new Store(f.storage, f.root, false, { sqlite }), /^Error: RUNTIME_UNSUPPORTED$/, label);
  assert.equal(await exists(f.storage), false, label);
  await rm(f.base, { recursive: true });
 }
});

test('the default loader reads process.getBuiltinModule lazily and a missing function is unsupported', async () => {
 const original = process.getBuiltinModule;
 const f = await setup();
 try {
  (process as { getBuiltinModule?: unknown }).getBuiltinModule = undefined;
  assert.throws(() => new Store(f.storage, f.root), /^Error: RUNTIME_UNSUPPORTED$/);
  (process as { getBuiltinModule?: unknown }).getBuiltinModule = () => undefined;
  assert.throws(() => new Store(f.storage, f.root), /^Error: RUNTIME_UNSUPPORTED$/);
  assert.equal(await exists(f.storage), false);
 } finally { process.getBuiltinModule = original; }
 new Store(f.storage, f.root).close();
 assert.equal(await exists(f.db), true);
 await rm(f.base, { recursive: true });
});

test('an injected loader is used on a supported runtime and storage checks still run', async () => {
 const f = await setup(); let calls = 0;
 new Store(f.storage, f.root, false, { sqlite: () => { calls++; return { DatabaseSync }; } }).close();
 assert.equal(calls, 1); assert.equal(await exists(f.db), true);
 await rm(f.base, { recursive: true });
});

const syntheticLine = '2026-10-10 10:00:00.000 [info] synthetic-envelope ' + JSON.stringify({ commandName: 'GetUsageLimitsCommand', input: {}, output: { userInfo: { userId: 'synthetic-account' }, nextDateReset: '2026-11-01T00:00:00.000Z', usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS', currentUsageWithPrecision: 4.35, usageLimitWithPrecision: 50, nextDateReset: '2026-11-01T00:00:00.000Z', bonuses: [], overageCredits: [] }] }, metadata: { httpStatusCode: 200 } }) + '\n';
async function run(f: Awaited<ReturnType<typeof setup>>) {
 let text = '', tooltip = '', html = '', clicked: (() => void) | undefined;
 const ui = { setStatus(value: string, detail: string, meta?: { tooltip: string }) { text = value; html = detail; tooltip = meta?.tooltip ?? ''; }, showDetails(value: string) { html = value; }, onClick(fn: () => void) { clicked = fn; }, onChange() {}, everyMinute() {}, dispose() {} };
 const extension = await startExtension(ui, { source: f.root, storage: f.storage, timezone: 'UTC', now: () => '2026-10-10T09:00:00.000Z' });
 clicked?.(); extension.dispose();
 return { text, tooltip, html };
}

test('the controller shows update needed and the matching explanation on an unsupported runtime', async () => {
 const f = await setup(); const original = process.getBuiltinModule;
 try {
  process.getBuiltinModule = (() => undefined) as typeof process.getBuiltinModule;
  const r = await run(f);
  assert.equal(r.text, UPDATE_NEEDED); assert.equal(r.tooltip, RUNTIME_TEXT); assert.ok(r.html.includes(RUNTIME_TEXT)); assert.ok(!r.html.includes(NEWER_TEXT));
  assert.ok(!r.html.includes('Waiting for usable local account updates.'));
 } finally { process.getBuiltinModule = original; await rm(f.base, { recursive: true }); }
});

test('the controller shows update needed and the matching explanation for a newer store, leaving it unchanged', async () => {
 const f = await setup(); new Store(f.storage, f.root).close();
 const db = new DatabaseSync(f.db); db.exec(`UPDATE meta SET version=${STORE_VERSION + 1}`); db.close();
 try {
  const r = await run(f);
  assert.equal(r.text, UPDATE_NEEDED); assert.equal(r.tooltip, NEWER_TEXT); assert.ok(r.html.includes(NEWER_TEXT)); assert.ok(!r.html.includes(RUNTIME_TEXT));
  const check = new DatabaseSync(f.db); assert.equal((check.prepare('SELECT version FROM meta').get() as { version: number }).version, STORE_VERSION + 1); check.close();
 } finally { await rm(f.base, { recursive: true }); }
});

test('a generic failure keeps the old text', async () => {
 const f = await setup(); await writeFile(join(f.root, 'synthetic-file'), syntheticLine);
 try {
  await mkdir(f.storage, { recursive: true }); await writeFile(join(f.storage, 'device.key'), 'x', { mode: 0o600 });
  const r = await run(f);
  assert.notEqual(r.text, UPDATE_NEEDED); assert.ok(r.html.includes('Waiting for usable local account updates.'));
  assert.ok(!r.html.includes(RUNTIME_TEXT) && !r.html.includes(NEWER_TEXT));
 } finally { await rm(f.base, { recursive: true }); }
});

test('presentation maps only the two fixed codes and ignores other diagnostics', () => {
 const o = view([], '2026-10-10T09:00:00.000Z');
 for (const [code, text] of [['runtime_unsupported', RUNTIME_TEXT], ['storage_newer', NEWER_TEXT]]) {
  const p = present(o, [code]);
  assert.equal(p.text, UPDATE_NEEDED); assert.equal(p.tooltip, text); assert.equal(p.warning, true); assert.ok(p.html.includes(text));
 }
 const generic = present(o, ['unavailable']);
 assert.notEqual(generic.text, UPDATE_NEEDED); assert.ok(generic.html.includes('Waiting for usable local account updates.'));
});

test('CLI prints only the fixed RUNTIME_UNSUPPORTED code on an unsupported runtime', async () => {
 const f = await setup();
 // A preload hides node:sqlite from process.getBuiltinModule in the child only; no production hook is involved.
 const preload = join(f.base, 'synthetic-preload.mjs');
 await writeFile(preload, "const original = process.getBuiltinModule; process.getBuiltinModule = id => id === 'node:sqlite' ? undefined : original(id);\n");
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', pathToFileURL(preload).href, resolve('src/cli.ts'), '--source-root', f.root, '--store-dir', f.storage, '--source-timezone', 'UTC'], { encoding: 'utf8' });
 assert.equal(r.status, 1); assert.equal(r.stdout.trim(), 'RUNTIME_UNSUPPORTED'); assert.equal(r.stderr, '');
 assert.equal(await exists(f.storage), false);
 await rm(f.base, { recursive: true });
});
