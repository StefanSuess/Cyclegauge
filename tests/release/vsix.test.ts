import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVsix } from '../../scripts/release/build-vsix.ts';
import { isPlainVersion, isPreReleaseVersion } from '../../scripts/release/channel.ts';
import { ALLOWLIST, comparePayload, parseArgs, verifyVsix } from '../../scripts/release/verify-vsix.ts';
import { readZip, writeZip } from '../../scripts/release/zip.ts';

const dir = mkdtempSync(join(tmpdir(), 'synthetic-release-'));
const build = async (name: string, expectPreRelease?: boolean) => { const file = join(dir, name); await buildVsix(file, expectPreRelease); return readFileSync(file); };
const packageVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
/** Re-labels a built VSIX with another version and flag state by editing its manifests (no network, no rebuild). */
const relabel = (archive: Buffer, version: string, flagged: boolean) => writeZip(readZip(archive).map(e => {
 let data = e.data;
 if (e.name === 'extension/package.json') { const m = JSON.parse(data.toString('utf8')); m.version = version; m.preview = isPlainVersion(version) ? isPreReleaseVersion(version) : flagged; data = Buffer.from(JSON.stringify(m)); }
 if (e.name === 'extension.vsixmanifest') {
  const text = data.toString('utf8').replaceAll(`Version="${packageVersion}"`, `Version="${version}"`);
  // vsce writes the PreRelease property only on a pre-release build, so a stable base needs it added to be flagged.
  const flag = /Microsoft\.VisualStudio\.Code\.PreRelease" Value="(?:true|false)/;
  data = Buffer.from(flag.test(text) ? text.replace(flag, `Microsoft.VisualStudio.Code.PreRelease" Value="${flagged}`)
   : flagged ? text.replace('</Properties>', '<Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true" /></Properties>') : text);
 }
 return { name: e.name, data };
}));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a pre-release build holds exactly the allowlisted entries and passes verification', async () => {
 const archive = await build('a.vsix', isPreReleaseVersion(packageVersion));
 const result = verifyVsix(archive);
 assert.equal(result.channel, isPreReleaseVersion(packageVersion) ? 'pre-release' : 'stable');
 assert.equal(result.preRelease, isPreReleaseVersion(packageVersion));
 assert.deepEqual(result.problems, []);
 assert.equal(result.ok, true);
 assert.deepEqual(readZip(archive).map(e => e.name).sort(), [...ALLOWLIST].sort());
 assert.equal(result.version, JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);
});

test('the build derives the pre-release flag from the version and rejects a disagreeing flag', async () => {
 assert.deepEqual(verifyVsix(await build('derived.vsix')).problems, []);
 await assert.rejects(build('wrong.vsix', !isPreReleaseVersion(packageVersion)), /^Error: CHANNEL_MISMATCH$/);
});

test('verification requires the pre-release flag to match the channel of the VSIX version, both ways', async () => {
 const base = await build('channel.vsix');
 // Odd minor without the flag, even minor with the flag: both fail closed with one fixed code.
 assert.deepEqual(verifyVsix(relabel(base, '0.13.0', false)).problems, ['VSIXMANIFEST_CHANNEL_MISMATCH']);
 assert.deepEqual(verifyVsix(relabel(base, '1.0.0', true)).problems, ['VSIXMANIFEST_CHANNEL_MISMATCH']);
 assert.deepEqual(verifyVsix(relabel(base, '0.10.2', true)).problems, ['VSIXMANIFEST_CHANNEL_MISMATCH']);
 // Matching states verify.
 for (const [version, flagged, channel] of [['1.0.0', false, 'stable'], ['0.10.2', false, 'stable'], ['0.13.0', true, 'pre-release']] as const) {
  const result = verifyVsix(relabel(base, version, flagged));
  assert.deepEqual(result.problems, [], version);
  assert.equal(result.channel, channel);
  assert.equal(result.version, version);
 }
 // The marketplace Preview badge must follow the channel as well.
 const withPreview = (version: string, flagged: boolean, preview: boolean) => verifyVsix(writeZip(readZip(relabel(base, version, flagged)).map(e => {
  if (e.name !== 'extension/package.json') return { name: e.name, data: e.data };
  const m = JSON.parse(e.data.toString('utf8')); m.preview = preview;
  return { name: e.name, data: Buffer.from(JSON.stringify(m)) };
 })));
 assert.deepEqual(withPreview('1.0.0', false, true).problems, ['MANIFEST_PREVIEW']);
 assert.deepEqual(withPreview('0.13.0', true, false).problems, ['MANIFEST_PREVIEW']);
 assert.deepEqual(withPreview('1.0.0', false, false).problems, []);
 // A non-plain manifest version cannot verify, and a leading zero never reaches the channel check (no throw).
 for (const bad of ['0.09.0', '1.0.0-beta.1']) assert.ok(verifyVsix(relabel(base, bad, true)).problems.includes('MANIFEST_VERSION'), bad);
 assert.equal(verifyVsix(relabel(base, '0.09.0', true)).channel, 'unknown');
});

test('two independent builds of the same tree have identical payload hashes', async () => {
 const first = verifyVsix(await build('one.vsix'));
 const second = verifyVsix(await build('two.vsix'));
 assert.deepEqual(comparePayload(first.files, second.files), []);
 const tampered = second.files.map(f => f.name === 'extension/dist/extension.cjs' ? { ...f, sha256: '0'.repeat(64) } : f);
 assert.deepEqual(comparePayload(first.files, tampered), ['extension/dist/extension.cjs']);
});

test('the verifier rejects extra entries, missing entries, leaked paths and workspace-writable roots', async () => {
 const entries = readZip(await build('base.vsix'));
 const pack = (edit: (e: { name: string; data: Buffer }[]) => { name: string; data: Buffer }[]) =>
  verifyVsix(writeZip(edit(entries.map(e => ({ name: e.name, data: e.data })))));
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
 // The automatic configuration review must stay a user-only setting that is off by default; a workspace scope or an on default fails closed.
 const review = 'cyclegauge.configReviewAutomatically';
 for (const scope of ['window', 'resource', 'machine', undefined]) assert.ok(edited(p => { p[review].scope = scope; }).problems.includes('MANIFEST_SETTING_SCOPE'), String(scope));
 for (const value of ['onOpen', 'onOpenAndChanges', true]) assert.ok(edited(p => { p[review].default = value; }).problems.includes('MANIFEST_SETTING_TYPE'), String(value));
 assert.ok(edited(p => { p[review].enum = [...p[review].enum, 'always']; }).problems.includes('MANIFEST_SETTING_TYPE'));
 assert.ok(edited(p => { delete p[review]; }).problems.includes('MANIFEST_SETTING_PROPERTIES'));
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
 const entries = readZip(await build('id.vsix'));
 const withPublisher = (publisher: string) => verifyVsix(writeZip(entries.map(e => {
  if (e.name !== 'extension/package.json') return { name: e.name, data: e.data };
  const m = JSON.parse(e.data.toString('utf8')); m.publisher = publisher;
  return { name: e.name, data: Buffer.from(JSON.stringify(m)) };
 })));
 assert.ok(withPublisher('someone-else').problems.includes('MANIFEST_EXTENSION_ID'));
 assert.equal(withPublisher('StefanSuess').problems.includes('MANIFEST_EXTENSION_ID'), false);
});

test('argument parsing is strict', () => {
 assert.deepEqual(parseArgs(['a.vsix', '--out', 'm.json']), { file: 'a.vsix', out: 'm.json', compare: undefined });
 assert.equal(parseArgs(['a.vsix', '--pre-release']), undefined, 'the channel is derived, not passed');
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
