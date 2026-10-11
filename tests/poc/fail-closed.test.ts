import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Milestone 6 stop condition: until Security Checkpoint SC1 is signed and Task 5 lands, the
// production code must keep refusing to create Windows storage.
test('production storage preparation still fails closed when the platform is win32', () => {
 const base = mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-failclosed-'));
 const dest = join(base, 'gauge'), source = join(base, 'source');
 const code = `Object.defineProperty(process, 'platform', { value: 'win32' });
  const { prepareStorage } = await import(${JSON.stringify(pathToFileURL(resolve('src/paths.ts')).href)});
  try { prepareStorage(${JSON.stringify(dest)}, ${JSON.stringify(source)}); console.log('NO_THROW'); } catch (e) { console.log(e.message); }`;
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { encoding: 'utf8' });
 assert.equal(r.status, 0);
 assert.notEqual(r.stdout.trim(), 'NO_THROW');
 assert.equal(r.stdout.trim(), 'STORAGE_PERMISSIONS_UNSUPPORTED');
 assert.equal(existsSync(dest), false, 'no directory may be created');
 rmSync(base, { recursive: true });
});

test('proof-of-concept code is not reachable from production sources', () => {
 const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
 });
 for (const file of walk('src')) {
  const text = readFileSync(file, 'utf8');
  assert.ok(!/scripts\/poc|win-acl/.test(text), file);
 }
});
