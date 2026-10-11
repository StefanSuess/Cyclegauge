import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LEGACY_COMMAND_SUFFIXES, LEGACY_EXTENSION_ID, startUnlessLegacy, LEGACY_ID_PREFIX, PANEL_VIEW_TYPE, SETTING_KEYS, commandId, legacyCommandId, readSetting, registerCommand } from '../../src/extension/identity.ts';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const stub = (log: string[], failOn?: string) => (id: string) => { if (id === failOn) throw new Error('synthetic-conflict'); log.push(id); return { dispose() {} }; };

test('manifest identity uses the Cyclegauge names and no legacy command contributions', () => {
 assert.equal(manifest.name, 'cyclegauge');
 assert.equal(manifest.displayName, 'Cyclegauge for Kiro IDE');
 const commands: string[] = manifest.contributes.commands.map((c: any) => c.command);
 assert.ok(commands.length > 0 && commands.every(c => c.startsWith('cyclegauge.')));
 for (const s of LEGACY_COMMAND_SUFFIXES) assert.ok(commands.includes(commandId(s)), s);
 for (const c of manifest.contributes.menus['editor/title']) { assert.ok(commands.includes(c.command)); assert.equal(c.when, `activeWebviewPanelId == ${PANEL_VIEW_TYPE}`); }
});

test('settings are declared under both prefixes and the legacy keys are deprecated', () => {
 const props = manifest.contributes.configuration.properties;
 for (const k of SETTING_KEYS) {
  assert.ok(props[`cyclegauge.${k}`] && !props[`cyclegauge.${k}`].deprecationMessage, k);
  assert.ok(props[`${LEGACY_ID_PREFIX}.${k}`]?.deprecationMessage, k);
  assert.equal(props[`cyclegauge.${k}`].default, props[`${LEGACY_ID_PREFIX}.${k}`].default);
 }
 assert.equal(Object.keys(props).length, SETTING_KEYS.length * 2);
});

test('legacy aliases exist only for commands that shipped in v0.5.1', () => {
 const log: string[] = [];
 assert.equal(registerCommand(stub(log), 'showUsage', () => {}).length, 2);
 assert.deepEqual(log, [commandId('showUsage'), legacyCommandId('showUsage')]);
 const later: string[] = [];
 assert.equal(registerCommand(stub(later), 'costAdvisor', () => {}).length, 1);
 assert.deepEqual(later, [commandId('costAdvisor')]);
});

test('a failing or disabled alias never blocks the primary command', () => {
 const log: string[] = [];
 assert.equal(registerCommand(stub(log, legacyCommandId('showUsage')), 'showUsage', () => {}).length, 1);
 assert.deepEqual(log, [commandId('showUsage')]);
 const off: string[] = [];
 registerCommand(stub(off), 'editCostScenario', () => {}, false);
 assert.deepEqual(off, [commandId('editCostScenario')]);
});

test('new setting wins, legacy setting is the fallback, empty means platform default', () => {
 const get = (values: Record<string, string>) => (p: string, k: string) => values[`${p}.${k}`];
 assert.equal(readSetting(get({ 'cyclegauge.sourceRoot': 'synthetic-new', 'easykirogauge.sourceRoot': 'synthetic-old' }), 'sourceRoot'), 'synthetic-new');
 assert.equal(readSetting(get({ 'easykirogauge.sourceRoot': 'synthetic-old' }), 'sourceRoot'), 'synthetic-old');
 assert.equal(readSetting(get({ 'cyclegauge.sourceRoot': '' }), 'sourceRoot'), '');
});

test('default storage folder keeps its legacy name so existing history stays in place', async () => {
 const paths = await readFile(new URL('../../src/paths.ts', import.meta.url), 'utf8');
 assert.equal((paths.match(/'EasyKiroGauge'/g) ?? []).length, 3);
 assert.ok(!/'Cyclegauge'/.test(paths));
});

test('side-by-side: a detected legacy extension blocks all initialization and storage access', async () => {
 let started = 0;
 const blocked = await startUnlessLegacy(true, async () => { started += 1; return 'synthetic-controller'; });
 assert.deepEqual(blocked, { blocked: true });
 assert.equal(started, 0);
 const open = await startUnlessLegacy(false, async () => { started += 1; return 'synthetic-controller'; });
 assert.deepEqual(open, { blocked: false, value: 'synthetic-controller' });
 assert.equal(started, 1);
});

test('extension entry point gates everything behind the legacy check and keeps the legacy extension ID', async () => {
 const source = await readFile(new URL('../../src/extension/extension.ts', import.meta.url), 'utf8');
 assert.equal(LEGACY_EXTENSION_ID, 'easykirogauge.easykirogauge');
 assert.match(source, /getExtension\(LEGACY_EXTENSION_ID\)/);
 const activate = source.slice(source.indexOf('export async function activate'), source.indexOf('async function runCyclegauge'));
 assert.match(activate, /startUnlessLegacy\(legacyInstalled, \(\) => runCyclegauge\(context\)\)/);
 // Nothing that touches settings, storage or the collector may run before the gate.
 for (const forbidden of ['startExtension', 'defaultStorage', 'getConfiguration', 'createWebviewPanel']) assert.ok(!activate.includes(forbidden), forbidden);
 assert.ok(!source.slice(source.indexOf('function pauseForLegacy'), source.indexOf('export async function activate')).match(/startExtension|defaultStorage|getConfiguration/));
});

test('VSIX allowlist ships exactly manifest, readme, license, bundle and icon', async () => {
 const ignore = (await readFile(new URL('../../.vscodeignore', import.meta.url), 'utf8')).split('\n').map(l => l.trim()).filter(Boolean);
 assert.deepEqual(ignore, ['**', '!package.json', '!README.md', '!LICENSE', '!dist/extension.cjs', '!assets/branding/cyclegauge-icon-256.png']);
 assert.equal(manifest.license, 'MIT');
 assert.equal(manifest.icon, 'assets/branding/cyclegauge-icon-256.png');
 assert.ok((await readFile(new URL(`../../${manifest.icon}`, import.meta.url))).length > 0);
 assert.match(await readFile(new URL('../../LICENSE', import.meta.url), 'utf8'), /MIT License/);
});
