import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { present } from '../../src/extension/presentation.ts';
import { view } from '../../src/view.ts';

test('the unsupported-runtime code has its own plain-language explanation', () => {
 const p = present(view([], '2030-06-29T18:00:00Z'), ['runtime_unsupported']);
 assert.match(p.html, /lacks a feature Cyclegauge needs/);
 assert.ok(!/RUNTIME_UNSUPPORTED/.test(p.html));
});

test('controller shows the unsupported-runtime state, creates no storage and does not throw', () => {
 const base = mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-runtime-'));
 mkdirSync(join(base, 'source'));
 const code = `
  const { startExtension } = await import(${JSON.stringify(pathToFileURL(resolve('src/extension/controller.ts')).href)});
  let html = '';
  const ui = { setStatus(_t, d) { html = d; }, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
  const c = await startExtension(ui, { source: ${JSON.stringify(join(base, 'source'))}, storage: ${JSON.stringify(join(base, 'gauge'))}, timezone: 'UTC' });
  console.log(/lacks a feature Cyclegauge needs/.test(html) ? 'RUNTIME_STATE_SHOWN' : 'NOT_SHOWN');
  c.dispose();`;
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--no-experimental-sqlite', '--input-type=module', '-e', code], { encoding: 'utf8' });
 assert.equal(r.stdout.trim(), 'RUNTIME_STATE_SHOWN', r.stderr.slice(0, 200));
 assert.equal(existsSync(join(base, 'gauge')), false);
 rmSync(base, { recursive: true });
});
