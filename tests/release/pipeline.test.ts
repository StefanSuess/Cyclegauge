import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVsix } from '../../scripts/release/build-vsix.ts';
import { smoke, type Simulation } from '../../scripts/release/smoke-bundle.ts';
import { verifyVsix } from '../../scripts/release/verify-vsix.ts';

// Packaging and bundle checks on the real build. They prove the shipped bundle loads and degrades
// safely against a stub host; they are not native Kiro verification.
const manifestPath = fileURLToPath(new URL('../../package.json', import.meta.url));
let dir = '', vsix = '';
before(async () => {
 dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-release-')));
 vsix = join(dir, 'candidate.vsix');
 await buildVsix(vsix);
}, { timeout: 240_000 });
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('the working tree packages into a VSIX that passes the content allowlist', () => {
 assert.ok(statSync(vsix).size > 10_000);
 const r = verifyVsix(readFileSync(vsix));
 assert.deepEqual(r.problems, []);
 assert.equal(r.version, JSON.parse(readFileSync(manifestPath, 'utf8')).version);
});

test('two builds of the same tree have identical payload hashes', { timeout: 240_000 }, async () => {
 const second = join(dir, 'second.vsix');
 await buildVsix(second);
 const a = verifyVsix(readFileSync(vsix)).files, b = verifyVsix(readFileSync(second)).files;
 const payload = (list: typeof a) => list.filter(f => f.name.startsWith('extension/')).map(f => `${f.name}:${f.sha256}`);
 assert.deepEqual(payload(a), payload(b));
});

for (const simulation of ['none', 'no-sqlite', 'no-reviver', 'no-watcher'] as Simulation[]) {
 test(`bundle smoke (${simulation}) passes against a stub host`, { timeout: 60_000 }, async () => {
  const r = await smoke(vsix, simulation);
  assert.deepEqual(r.failures, [], JSON.stringify(r.checks));
  assert.equal(r.checks.diagnostics_has_no_paths_or_markers, true);
  assert.equal(r.checks.detail_has_no_account_marker, true);
 });
}
