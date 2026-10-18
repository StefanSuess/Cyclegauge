import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AUDIT_SETTING_KEYS, BUDGET_SETTING_KEYS, LINKS, PANEL_VIEW_TYPE, SETTING_KEYS, SUPPORT_SETTING_KEYS, commandId, isKiroEditor, readAuditAutomatically, readBudgetWarningPercent, readBudgetWarnings, readReminderDays, readSetting, readSupportPrompts, registerCommand } from '../../src/extension/identity.ts';

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

test('the getting-started walkthrough is declared with the packaged icon on every step', () => {
 const titles = Object.fromEntries(manifest.contributes.commands.map((c: any) => [c.command, c.title]));
 assert.equal(titles[commandId('gettingStarted')], 'Cyclegauge: Get Started');
 const [walkthrough, ...rest] = manifest.contributes.walkthroughs;
 assert.equal(rest.length, 0); assert.equal(walkthrough.id, commandId('gettingStarted')); assert.equal(walkthrough.title, 'Get started with Cyclegauge');
 const steps: any[] = walkthrough.steps;
 assert.deepEqual(steps.map(s => s.title), ['See your Kiro credits', "Find files Kiro doesn't need", 'Get warned before credits run out', 'When the forecast appears']);
 for (const step of steps) { assert.ok(step.id && step.description); assert.deepEqual(step.media, { image: manifest.icon, altText: step.media.altText }); assert.equal(step.media.image, 'assets/branding/cyclegauge-icon-256.png'); assert.ok(step.media.altText); }
 assert.match(steps[0].description, /\(command:cyclegauge\.showUsage\)/);
 assert.match(steps[1].description, /\(command:cyclegauge\.auditWorkspace\)/); assert.deepEqual(steps[1].completionEvents, ['onCommand:cyclegauge.auditWorkspace']);
 assert.match(steps[2].description, /\(command:workbench\.action\.openSettings\?/);
 assert.match(steps[3].description, /about 2 days and 3 updates.*7 days and 8 updates/);
 // Only Cyclegauge commands and the editor's settings opener are linked; no web links.
 for (const step of steps) for (const [, target] of step.description.matchAll(/\]\(([^)]*)\)/g)) assert.match(target, /^command:(cyclegauge\.[A-Za-z.]+|workbench\.action\.openSettings\?%5B%22cyclegauge\.budget%22%5D)$/);
});

test('only current settings are declared under the Cyclegauge prefix', () => {
 const props = manifest.contributes.configuration.properties;
 assert.deepEqual(Object.keys(props).sort(), [...SETTING_KEYS, ...AUDIT_SETTING_KEYS, ...SUPPORT_SETTING_KEYS, ...BUDGET_SETTING_KEYS].map(k => `cyclegauge.${k}`).sort());
 for (const k of SETTING_KEYS) {
  assert.ok(props[`cyclegauge.${k}`] && !props[`cyclegauge.${k}`].deprecationMessage, k);
  assert.equal(props[`cyclegauge.${k}`].scope, 'machine');
 }
 for (const k of [...AUDIT_SETTING_KEYS, ...SUPPORT_SETTING_KEYS, ...BUDGET_SETTING_KEYS]) {
  assert.ok(props[`cyclegauge.${k}`] && !props[`cyclegauge.${k}`].deprecationMessage, k);
  assert.equal(props[`cyclegauge.${k}`].scope, 'application');
 }
 const { auditReminderDays: days, auditAutomatically: automatic } = Object.fromEntries(AUDIT_SETTING_KEYS.map(k => [k, props[`cyclegauge.${k}`]]));
 assert.deepEqual([days.type, days.default, days.minimum, days.maximum], ['number', 30, 0, 365]);
 assert.deepEqual([automatic.type, automatic.default, automatic.enum], ['string', 'off', ['off', 'onOpen', 'onOpenAndChanges']]);
 const prompts = props['cyclegauge.supportPrompts'];
 assert.deepEqual([prompts.type, prompts.default, prompts.scope, prompts.description], ['boolean', true, 'application', "Occasionally ask whether you'd rate, star or support Cyclegauge, and add the Open VSX link text to the shareable cycle recap."]);
 const { budgetWarnings: budget, budgetWarningPercent: percent } = Object.fromEntries(BUDGET_SETTING_KEYS.map(k => [k, props[`cyclegauge.${k}`]]));
 assert.deepEqual([budget.type, budget.default, budget.scope], ['boolean', true, 'application']);
 assert.deepEqual([percent.type, percent.default, percent.minimum, percent.maximum, percent.scope], ['number', 80, 0, 100, 'application']);
});

test('the share and support commands are declared; the support reset is visible in the palette', () => {
 const titles = Object.fromEntries(manifest.contributes.commands.map((c: any) => [c.command, c.title]));
 assert.equal(titles[commandId('share')], 'Cyclegauge: Share Cyclegauge');
 assert.equal(titles[commandId('support.reset')], 'Cyclegauge: Reset Support Prompts and Summary');
 const hidden = manifest.contributes.menus.commandPalette.filter((c: any) => c.when === 'false').map((c: any) => c.command);
 assert.ok(!hidden.includes(commandId('support.reset'))); assert.ok(!hidden.includes(commandId('share')));
});

test('support prompts are on unless explicitly false; Kiro is recognised by name or scheme', () => {
 const get = (values: Record<string, unknown>) => (p: string, k: string) => values[`${p}.${k}`];
 assert.equal(readSupportPrompts(get({})), true);
 assert.equal(readSupportPrompts(get({ 'cyclegauge.supportPrompts': true })), true);
 assert.equal(readSupportPrompts(get({ 'cyclegauge.supportPrompts': false })), false);
 for (const other of ['false', 0, null, '']) assert.equal(readSupportPrompts(get({ 'cyclegauge.supportPrompts': other })), true, String(other));
 assert.equal(isKiroEditor('Kiro', 'vscode'), true); assert.equal(isKiroEditor('synthetic KIRO build', undefined), true); assert.equal(isKiroEditor('Visual Studio Code', 'kiro'), true);
 for (const [name, scheme] of [['Visual Studio Code', 'vscode'], [undefined, undefined], [5, null], ['Cursor', 'cursor']] as const) assert.equal(isKiroEditor(name, scheme), false, String(name));
});

test('the external links are fixed https constants without a query string', () => {
 assert.deepEqual(LINKS, { rate: 'https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', star: 'https://github.com/StefanSuess/Cyclegauge', support: 'https://ko-fi.com/stefansuess', kiro: 'https://kiro.dev' });
 for (const url of Object.values(LINKS)) assert.ok(url.startsWith('https://') && !/[?#]/.test(url), url);
});

test('the reset reminder command is declared with its palette title', () => {
 const reset = manifest.contributes.commands.find((c: any) => c.command === commandId('audit.resetReminder'));
 assert.equal(reset?.title, 'Cyclegauge: Reset workspace audit reminder');
});

test('audit reminder settings are read strictly: clamped numbers, known modes only', () => {
 const get = (values: Record<string, unknown>) => (p: string, k: string) => values[`${p}.${k}`];
 assert.equal(readReminderDays(get({})), 30);
 assert.equal(readReminderDays(get({ 'cyclegauge.auditReminderDays': 7 })), 7);
 assert.equal(readReminderDays(get({ 'cyclegauge.auditReminderDays': 0 })), 0);
 assert.equal(readReminderDays(get({ 'cyclegauge.auditReminderDays': 7.9 })), 7);
 assert.equal(readReminderDays(get({ 'cyclegauge.auditReminderDays': -3 })), 0);
 assert.equal(readReminderDays(get({ 'cyclegauge.auditReminderDays': 9999 })), 365);
 for (const bad of ['7', null, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) assert.equal(readReminderDays(get({ 'cyclegauge.auditReminderDays': bad })), 30, String(bad));
 assert.equal(readAuditAutomatically(get({})), 'off');
 assert.equal(readAuditAutomatically(get({ 'cyclegauge.auditAutomatically': true })), 'onOpen'); // the earlier boolean
 for (const mode of ['off', 'onOpen', 'onOpenAndChanges']) assert.equal(readAuditAutomatically(get({ 'cyclegauge.auditAutomatically': mode })), mode);
 for (const bad of ['true', 'OnOpen', 'onopenandchanges', 1, null, {}, false]) assert.equal(readAuditAutomatically(get({ 'cyclegauge.auditAutomatically': bad })), 'off', String(bad));
});

test('budget warning settings are read strictly: on unless explicitly false, whole percent 0..100 with the default for anything else', () => {
 const get = (values: Record<string, unknown>) => (p: string, k: string) => values[`${p}.${k}`];
 assert.equal(readBudgetWarnings(get({})), true);
 assert.equal(readBudgetWarnings(get({ 'cyclegauge.budgetWarnings': true })), true);
 assert.equal(readBudgetWarnings(get({ 'cyclegauge.budgetWarnings': false })), false);
 for (const other of ['false', 0, null, '']) assert.equal(readBudgetWarnings(get({ 'cyclegauge.budgetWarnings': other })), true, String(other));
 assert.equal(readBudgetWarningPercent(get({})), 80);
 for (const [value, expected] of [[0, 0], [1, 1], [50, 50], [79.9, 79], [100, 100], [-5, 0], [250, 100]] as const) assert.equal(readBudgetWarningPercent(get({ 'cyclegauge.budgetWarningPercent': value })), expected, String(value));
 for (const bad of ['50', null, Number.NaN, Number.POSITIVE_INFINITY, {}, true, undefined]) assert.equal(readBudgetWarningPercent(get({ 'cyclegauge.budgetWarningPercent': bad })), 80, String(bad));
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
 assert.match(source, /export async function activate\(context: vscode\.ExtensionContext\): Promise<void> \{\s*await runCyclegauge\(context\);\s*\}/);
 assert.ok(!source.includes('getExtension('));
});

test('VSIX allowlist ships exactly manifest, readme, license, changelog, bundle and icon', async () => {
 const ignore = (await readFile(new URL('../../.vscodeignore', import.meta.url), 'utf8')).split('\n').map(l => l.trim()).filter(Boolean);
 assert.deepEqual(ignore, ['**', '!package.json', '!README.md', '!LICENSE', '!CHANGELOG.md', '!dist/extension.cjs', '!assets/branding/cyclegauge-icon-256.png']);
 assert.equal(manifest.license, 'MIT');
 assert.equal(manifest.preview, true);
 for (const key of Object.keys(manifest.contributes.configuration.properties)) assert.equal(manifest.contributes.configuration.properties[key].scope, [...AUDIT_SETTING_KEYS, ...SUPPORT_SETTING_KEYS, ...BUDGET_SETTING_KEYS].some(k => key === `cyclegauge.${k}`) ? 'application' : 'machine', key);
 assert.equal(manifest.icon, 'assets/branding/cyclegauge-icon-256.png');
 assert.ok((await readFile(new URL(`../../${manifest.icon}`, import.meta.url))).length > 0);
 assert.match(await readFile(new URL('../../LICENSE', import.meta.url), 'utf8'), /MIT License/);
});
