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
 const extraSetting = pack(e => e.map(x => {
  if (x.name !== 'extension/package.json') return x;
  const m = JSON.parse(x.data.toString('utf8'));
  m.contributes.configuration.properties['cyclegauge.extraSetting'] = { type: 'string', default: '', scope: 'machine' };
  return { ...x, data: Buffer.from(JSON.stringify(m)) };
 }));
 assert.ok(extraSetting.problems.includes('MANIFEST_SETTING_PROPERTIES'));
 // The two audit reminder settings must keep exactly their application scope (the user's own settings, never a workspace's), type, default and range; anything else fails closed.
 const edited = (edit: (props: Record<string, any>) => void) => pack(e => e.map(x => {
  if (x.name !== 'extension/package.json') return x;
  const m = JSON.parse(x.data.toString('utf8'));
  edit(m.contributes.configuration.properties);
  return { ...x, data: Buffer.from(JSON.stringify(m)) };
 }));
 assert.deepEqual(edited(() => {}).problems, []);
 const days = 'cyclegauge.auditReminderDays', auto = 'cyclegauge.auditAutomatically';
 assert.ok(edited(p => { p[days].scope = 'machine'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { p[days].scope = 'resource'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { p[auto].scope = 'resource'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { p[auto].scope = 'window'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { delete p[auto].scope; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { p[days].type = 'string'; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[auto].type = 'boolean'; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[auto].default = 'onOpen'; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[auto].enum = [...p[auto].enum, 'always']; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { delete p[auto].enum; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[days].default = 31; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[auto].default = true; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[days].maximum = 9999; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { delete p[days].minimum; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { delete p[auto]; }).problems.includes('MANIFEST_SETTING_PROPERTIES'));
 assert.ok(edited(p => { p['cyclegauge.extraSetting'] = { type: 'boolean', default: false, scope: 'application' }; }).problems.includes('MANIFEST_SETTING_PROPERTIES'));
 // The community prompt setting is held to the same standard: application scope, boolean, default true, nothing else.
 const prompts = 'cyclegauge.supportPrompts';
 assert.ok(edited(p => { p[prompts].scope = 'machine'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { p[prompts].scope = 'resource'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { delete p[prompts].scope; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { p[prompts].type = 'string'; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[prompts].default = false; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[prompts].maximum = 1; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { delete p[prompts]; }).problems.includes('MANIFEST_SETTING_PROPERTIES'));
 // The budget warning settings are held to the same standard, including the percent range.
 const warnings = 'cyclegauge.budgetWarnings', percent = 'cyclegauge.budgetWarningPercent';
 for (const key of [warnings, percent]) {
  assert.ok(edited(p => { p[key].scope = 'machine'; }).problems.includes('MANIFEST_SETTING_SCOPE'), key);
  assert.ok(edited(p => { p[key].scope = 'resource'; }).problems.includes('MANIFEST_SETTING_SCOPE'), key);
  assert.ok(edited(p => { delete p[key].scope; }).problems.includes('MANIFEST_SETTING_SCOPE'), key);
  assert.ok(edited(p => { delete p[key]; }).problems.includes('MANIFEST_SETTING_PROPERTIES'), key);
 }
 // The session hints setting (a read of Kiro's session files, on by default) is pinned as well: application scope, boolean, default on.
 const hints = 'cyclegauge.sessionHints';
 assert.ok(edited(p => { p[hints].scope = 'machine'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { p[hints].scope = 'resource'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { delete p[hints].scope; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.ok(edited(p => { delete p[hints]; }).problems.includes('MANIFEST_SETTING_PROPERTIES'));
 assert.ok(edited(p => { p[hints].type = 'string'; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[hints].default = false; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[warnings].type = 'string'; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[warnings].default = false; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[warnings].maximum = 1; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[percent].type = 'string'; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[percent].default = 90; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[percent].minimum = 1; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { p[percent].maximum = 1000; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { delete p[percent].minimum; }).problems.includes('MANIFEST_SETTING_TYPE'));
 // The existing machine-scoped keys may not move to resource scope.
 assert.ok(edited(p => { p['cyclegauge.sourceRoot'].scope = 'resource'; }).problems.includes('MANIFEST_SETTING_SCOPE'));
 assert.equal(verifyVsix(Buffer.from('not a zip')).ok, false);
});

test('the verifier rejects a wrong publisher', async () => {
 const entries = readZip(await build('id.vsix', true));
 const withPublisher = (publisher: string) => verifyVsix(writeZip(entries.map(e => {
  if (e.name !== 'extension/package.json') return { name: e.name, data: e.data };
  const m = JSON.parse(e.data.toString('utf8')); m.publisher = publisher;
  return { name: e.name, data: Buffer.from(JSON.stringify(m)) };
 })), { expectPreRelease: true });
 assert.ok(withPublisher('someone-else').problems.includes('MANIFEST_EXTENSION_ID'));
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
