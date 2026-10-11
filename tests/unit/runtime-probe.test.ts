import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { probeRuntime } from '../../src/runtime.ts';
import { Store } from '../../src/store.ts';

test('probes pass on the running Node', () => {
 assert.deepEqual(probeRuntime(), { sqlite: true, reviverSource: true, ok: true });
});

test('a missing or throwing builtin loader and a reviver without source text are reported separately', () => {
 assert.deepEqual(probeRuntime({ builtin: () => undefined }), { sqlite: false, reviverSource: true, ok: false });
 assert.deepEqual(probeRuntime({ builtin: () => { throw new Error('SYNTHETIC_PRIVATE'); } }), { sqlite: false, reviverSource: true, ok: false });
 assert.deepEqual(probeRuntime({ builtin: () => ({ DatabaseSync: 1 }) }), { sqlite: false, reviverSource: true, ok: false });
 const noContext = ((text: string, reviver: (k: string, v: unknown) => unknown) => JSON.parse(text, (k, v) => reviver(k, v))) as unknown as typeof JSON.parse;
 assert.deepEqual(probeRuntime({ parse: noContext }), { sqlite: true, reviverSource: false, ok: false });
 const throwing = (() => { throw new Error('SYNTHETIC_PRIVATE'); }) as unknown as typeof JSON.parse;
 assert.equal(probeRuntime({ parse: throwing }).reviverSource, false);
});

test('opening a store without SQLite fails with a fixed code before touching the file system', () => {
 const base = mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-probe-'));
 const dest = join(base, 'gauge');
 assert.throws(() => new Store(dest, join(base, 'source'), { builtin: () => undefined }), /^Error: RUNTIME_UNSUPPORTED$/);
 assert.equal(existsSync(dest), false);
 rmSync(base, { recursive: true });
});

test('CLI reports RUNTIME_UNSUPPORTED instead of crashing when node:sqlite is disabled', () => {
 const base = mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-probe-'));
 mkdirSync(join(base, 'source'));
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--no-experimental-sqlite', resolve('src/cli.ts'),
  '--source-root', join(base, 'source'), '--store-dir', join(base, 'gauge')], { encoding: 'utf8' });
 assert.equal(r.status, 1);
 assert.equal(r.stdout.trim(), 'RUNTIME_UNSUPPORTED');
 assert.equal(r.stderr, '');
 assert.equal(existsSync(join(base, 'gauge')), false);
 rmSync(base, { recursive: true });
});
