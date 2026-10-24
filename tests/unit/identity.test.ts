import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PANEL_VIEW_TYPE, SETTING_KEYS, commandId, readSetting, registerCommand } from '../../src/extension/identity.ts';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const stub = (log: string[]) => (id: string) => { log.push(id); return { dispose() {} }; };

test('manifest identity and commands use the Cyclegauge names', () => {
 assert.equal(manifest.name, 'cyclegauge');
 assert.equal(manifest.displayName, 'Cyclegauge for Kiro IDE');
 const commands: string[] = manifest.contributes.commands.map((c: any) => c.command);
 assert.ok(commands.length > 0 && commands.every(c => c.startsWith('cyclegauge.')));
 for (const suffix of ['showUsage', 'costAdvisor']) assert.ok(commands.includes(commandId(suffix)));
 for (const c of manifest.contributes.menus['editor/title']) { assert.ok(commands.includes(c.command)); assert.equal(c.when, `activeWebviewPanelId == ${PANEL_VIEW_TYPE}`); }
});

test('only current settings are declared under the Cyclegauge prefix', () => {
 const props = manifest.contributes.configuration.properties;
 assert.deepEqual(Object.keys(props).sort(), SETTING_KEYS.map(k => `cyclegauge.${k}`).sort());
 for (const k of SETTING_KEYS) {
  assert.ok(props[`cyclegauge.${k}`] && !props[`cyclegauge.${k}`].deprecationMessage, k);
  assert.equal(props[`cyclegauge.${k}`].scope, 'machine');
 }
});

test('the intended Open VSX ID is StefanSuess.cyclegauge', () => {
 assert.equal(`${manifest.publisher}.${manifest.name}`, 'StefanSuess.cyclegauge');
});

test('commands register only their current ID', () => {
 const log: string[] = [];
 const disposable = registerCommand(stub(log), 'showUsage', () => {});
 assert.deepEqual(log, [commandId('showUsage')]);
 assert.equal(typeof disposable.dispose, 'function');
});

test('settings resolve from the current prefix and empty means platform default', () => {
 const get = (values: Record<string, string>) => (p: string, k: string) => values[`${p}.${k}`];
 assert.equal(readSetting(get({ 'cyclegauge.sourceRoot': 'synthetic-root' }), 'sourceRoot'), 'synthetic-root');
 assert.equal(readSetting(get({ 'cyclegauge.sourceRoot': '' }), 'sourceRoot'), '');
});

test('default storage folder uses the Cyclegauge name on each supported path', async () => {
 const paths = await readFile(new URL('../../src/paths.ts', import.meta.url), 'utf8');
 assert.equal((paths.match(/'Cyclegauge'/g) ?? []).length, 3);
});

test('extension entry point starts Cyclegauge without installation gates', async () => {
 const source = await readFile(new URL('../../src/extension/extension.ts', import.meta.url), 'utf8');
 assert.match(source, /export async function activate\(context: vscode\.ExtensionContext\): Promise<void> \{\s*await runCyclegauge\(context\);/);
 assert.ok(!source.includes('getExtension('));
});

test('VSIX allowlist ships exactly manifest, readme, license, changelog, bundle and icon', async () => {
 const ignore = (await readFile(new URL('../../.vscodeignore', import.meta.url), 'utf8')).split('\n').map(l => l.trim()).filter(Boolean);
 assert.deepEqual(ignore, ['**', '!package.json', '!README.md', '!LICENSE', '!CHANGELOG.md', '!dist/extension.cjs', '!assets/branding/cyclegauge-icon-256.png']);
 assert.equal(manifest.license, 'MIT');
 assert.notEqual(manifest.preview, true); // 0.8.0 is a stable (even-minor) release
 for (const key of Object.keys(manifest.contributes.configuration.properties)) assert.equal(manifest.contributes.configuration.properties[key].scope, 'machine', key);
 assert.equal(manifest.icon, 'assets/branding/cyclegauge-icon-256.png');
 assert.ok((await readFile(new URL(`../../${manifest.icon}`, import.meta.url))).length > 0);
 assert.match(await readFile(new URL('../../LICENSE', import.meta.url), 'utf8'), /MIT License/);
});
