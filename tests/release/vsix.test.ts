import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVsix } from '../../scripts/release/build-vsix.ts';
import { ALLOWLIST, comparePayload, parseArgs, verifyVsix } from '../../scripts/release/verify-vsix.ts';
import { readZip, writeZip } from '../../scripts/release/zip.ts';

const dir = mkdtempSync(join(tmpdir(), 'synthetic-release-'));
const build = async (name: string, preRelease = false) => { const file = join(dir, name); await buildVsix(file, preRelease); return readFileSync(file); };
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a pre-release build holds exactly the allowlisted entries and passes verification', async () => {
 const archive = await build('a.vsix', true);
 const result = verifyVsix(archive, { expectPreRelease: true });
 assert.deepEqual(result.problems, []);
 assert.equal(result.ok, true);
 assert.deepEqual(readZip(archive).map(e => e.name).sort(), [...ALLOWLIST].sort());
 assert.equal(result.version, JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
});

test('a stable build is not flagged pre-release and fails the pre-release expectation', async () => {
 const archive = await build('stable.vsix');
 assert.deepEqual(verifyVsix(archive).problems, []);
 assert.deepEqual(verifyVsix(archive, { expectPreRelease: true }).problems, ['VSIXMANIFEST_NOT_PRERELEASE']);
});

test('two independent builds of the same tree have identical payload hashes', async () => {
 const first = verifyVsix(await build('one.vsix', true));
 const second = verifyVsix(await build('two.vsix', true));
 assert.deepEqual(comparePayload(first.files, second.files), []);
 const tampered = second.files.map(f => f.name === 'extension/dist/extension.cjs' ? { ...f, sha256: '0'.repeat(64) } : f);
 assert.deepEqual(comparePayload(first.files, tampered), ['extension/dist/extension.cjs']);
});

test('the verifier rejects extra entries, missing entries, leaked paths and workspace-writable roots', async () => {
 const entries = readZip(await build('base.vsix', true));
 const pack = (edit: (e: { name: string; data: Buffer }[]) => { name: string; data: Buffer }[]) =>
  verifyVsix(writeZip(edit(entries.map(e => ({ name: e.name, data: e.data })))), { expectPreRelease: true });
 assert.ok(pack(e => [...e, { name: 'extension/src/store.ts', data: Buffer.from('x') }]).problems.includes('UNEXPECTED_ENTRY'));
 assert.ok(pack(e => e.filter(x => x.name !== 'extension/LICENSE.txt')).problems.includes('MISSING_ENTRY:extension/LICENSE.txt'));
 assert.ok(pack(e => e.map(x => x.name === 'extension/dist/extension.cjs' ? { ...x, data: Buffer.concat([x.data, Buffer.from('\n// /Users/synthetic-user/project/\n')]) } : x)).problems.includes('BUNDLE_HOME_PATH'));
 const unscoped = pack(e => e.map(x => {
  if (x.name !== 'extension/package.json') return x;
  const m = JSON.parse(x.data.toString('utf8'));
  delete m.contributes.configuration.properties['cyclegauge.storageRoot'].scope;
  return { ...x, data: Buffer.from(JSON.stringify(m)) };
 }));
 assert.ok(unscoped.problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.equal(verifyVsix(Buffer.from('not a zip')).ok, false);
});

test('the verifier rejects a wrong publisher and the legacy extension ID', async () => {
 const entries = readZip(await build('id.vsix', true));
 const withPublisher = (publisher: string) => verifyVsix(writeZip(entries.map(e => {
  if (e.name !== 'extension/package.json') return { name: e.name, data: e.data };
  const m = JSON.parse(e.data.toString('utf8')); m.publisher = publisher;
  return { name: e.name, data: Buffer.from(JSON.stringify(m)) };
 })), { expectPreRelease: true });
 assert.ok(withPublisher('someone-else').problems.includes('MANIFEST_EXTENSION_ID'));
 assert.ok(withPublisher('easykirogauge').problems.includes('MANIFEST_EXTENSION_ID'));
 assert.equal(withPublisher('StefanSuess').problems.includes('MANIFEST_EXTENSION_ID'), false);
});

test('argument parsing is strict', () => {
 assert.deepEqual(parseArgs(['a.vsix', '--pre-release']), { file: 'a.vsix', out: undefined, compare: undefined, preRelease: true });
 assert.equal(parseArgs([]), undefined);
 assert.equal(parseArgs(['a.vsix', 'b.vsix']), undefined);
 assert.equal(parseArgs(['a.vsix', '--out']), undefined);
 assert.equal(parseArgs(['a.vsix', '--unknown']), undefined);
});

test('rejected entry names never leave the verifier result', () => {
 const name = 'extension/synthetic-private-account/synthetic-private-workspace.log';
 const result = verifyVsix(writeZip([{ name, data: Buffer.from('synthetic-content') }]));
 assert.equal(result.ok, false);
 assert.ok(result.problems.includes('UNEXPECTED_ENTRY'));
 assert.deepEqual(result.files, []);
 assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
});

test('rejected entry names are absent from CLI diagnostics and output manifests', () => {
 const archive = join(dir, 'synthetic-rejected.vsix');
 const manifest = join(dir, 'synthetic-rejected.json');
 writeFileSync(archive, writeZip([{ name: 'extension/synthetic-private-account.log', data: Buffer.from('synthetic-content') }]));
 const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/release/verify-vsix.ts', import.meta.url)), archive, '--out', manifest], { encoding: 'utf8' });
 assert.equal(run.status, 1);
 assert.ok(run.stdout.includes('PROBLEM UNEXPECTED_ENTRY'));
 assert.equal(`${run.stdout}${run.stderr}`.includes('synthetic-private'), false);
 const output = readFileSync(manifest, 'utf8');
 assert.equal(output.includes('synthetic-private'), false);
 assert.deepEqual(JSON.parse(output).files, []);
});
