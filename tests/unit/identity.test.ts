import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isPreReleaseVersion } from '../../scripts/release/channel.ts';
import { AUDIT_SETTING_KEYS, BUDGET_SETTING_KEYS, CONFIG_REVIEW_SETTING_KEYS, LINKS, PANEL_VIEW_TYPE, REPORT_PROBLEM_ACTION, REPORT_PROBLEM_URL, SESSION_HINT_SETTING_KEYS, SETTING_KEYS, SUPPORT_SETTING_KEYS, commandId, isKiroEditor, readAuditAutomatically, readBudgetWarningPercent, readBudgetWarnings, readReminderDays, readSessionHints, readSetting, readSupportPrompts, registerCommand } from '../../src/extension/identity.ts';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const stub = (log: string[]) => (id: string) => { log.push(id); return { dispose() {} }; };

test('manifest identity and commands use the Cyclegauge names', () => {
 assert.equal(manifest.name, 'cyclegauge');
 assert.equal(manifest.displayName, 'Cyclegauge: Kiro Credit Tracker');
 const commands: string[] = manifest.contributes.commands.map((c: any) => c.command);
 assert.ok(commands.length > 0 && commands.every(c => c.startsWith('cyclegauge.')));
 for (const suffix of ['showUsage', 'costAdvisor']) assert.ok(commands.includes(commandId(suffix)));
 for (const c of manifest.contributes.menus['editor/title']) { assert.ok(commands.includes(c.command)); assert.equal(c.when, `activeWebviewPanelId == ${PANEL_VIEW_TYPE}`); }
});

test('the getting-started walkthrough has actionable steps, completion events and a distinct alt text per packaged image', () => {
 const titles = Object.fromEntries(manifest.contributes.commands.map((c: any) => [c.command, c.title]));
 assert.equal(titles[commandId('gettingStarted')], 'Cyclegauge: Get Started');
 const [walkthrough, ...rest] = manifest.contributes.walkthroughs;
 assert.equal(rest.length, 0); assert.equal(walkthrough.id, commandId('gettingStarted')); assert.equal(walkthrough.title, 'Get started with Cyclegauge');
 const steps: any[] = walkthrough.steps;
 assert.deepEqual(steps.map(s => s.title), ['See your Kiro credits', "Find files Kiro doesn't need", 'Find ways to use fewer credits', 'Get warned before credits run out', 'Nudges from your latest Kiro session']);
 // The editor requires media on every step and only the icon is packaged; each step names what it is about instead of repeating "Cyclegauge icon".
 for (const step of steps) { assert.ok(step.id && step.description); assert.deepEqual(step.media, { image: manifest.icon, altText: step.media.altText }); assert.equal(step.media.image, 'assets/branding/cyclegauge-icon-256.png'); assert.ok(step.media.altText); }
 assert.equal(new Set(steps.map(s => s.media.altText)).size, steps.length); assert.ok(!steps.some(s => /Cyclegauge icon/i.test(s.media.altText)));
 assert.match(steps[0].description, /\(command:cyclegauge\.showUsage\)/); assert.deepEqual(steps[0].completionEvents, ['onCommand:cyclegauge.showUsage']);
 assert.match(steps[1].description, /\(command:cyclegauge\.auditWorkspace\)/); assert.deepEqual(steps[1].completionEvents, ['onCommand:cyclegauge.auditWorkspace']);
 assert.match(steps[1].description, /\[Run the workspace audit\]/);
 assert.match(steps[2].description, /\(command:cyclegauge\.costAdvisor\).*\(command:cyclegauge\.reviewKiroConfig\)/s); assert.deepEqual(steps[2].completionEvents, ['onCommand:cyclegauge.costAdvisor', 'onCommand:cyclegauge.reviewKiroConfig']);
 assert.match(steps[3].description, /\(command:workbench\.action\.openSettings\?/);
 assert.ok(!steps.some(s => /When the forecast appears/.test(s.title)), 'the forecast note is part of the first step');
 assert.equal(steps[4].description.split('\n')[0], "Cyclegauge can tell you when your newest Kiro session is nearly full or set to a pricier model. It reads only the newest session's model, context level and time, on your computer. Nothing is stored or sent. Turn it off any time. Seen on macOS; not yet verified on Windows or Linux.");
 assert.match(steps[4].description, /\(command:workbench\.action\.openSettings\?%5B%22cyclegauge\.sessionHints%22%5D\)/);
 // Only Cyclegauge commands, the editor's settings opener and the one fixed privacy document are linked.
 for (const step of steps) for (const [, target] of step.description.matchAll(/\]\(([^)]*)\)/g)) assert.match(target, /^(command:(cyclegauge\.[A-Za-z.]+|workbench\.action\.openSettings\?%5B%22cyclegauge\.(budgetWarnings|sessionHints)%22%5D)|https:\/\/github\.com\/StefanSuess\/Cyclegauge\/blob\/HEAD\/docs\/privacy-and-storage\.md)$/);
 for (const step of steps) for (const id of step.completionEvents ?? []) assert.ok(id === 'onStepSelected' || id.startsWith('onCommand:cyclegauge.'), id);
});

test('only current settings are declared under the Cyclegauge prefix', () => {
 const props = manifest.contributes.configuration.properties;
 assert.deepEqual(Object.keys(props).sort(), [...SETTING_KEYS, ...AUDIT_SETTING_KEYS, ...CONFIG_REVIEW_SETTING_KEYS, ...SUPPORT_SETTING_KEYS, ...BUDGET_SETTING_KEYS, ...SESSION_HINT_SETTING_KEYS].map(k => `cyclegauge.${k}`).sort());
 for (const k of SETTING_KEYS) {
  assert.ok(props[`cyclegauge.${k}`] && !props[`cyclegauge.${k}`].deprecationMessage, k);
  assert.equal(props[`cyclegauge.${k}`].scope, 'machine');
 }
 for (const k of [...AUDIT_SETTING_KEYS, ...CONFIG_REVIEW_SETTING_KEYS, ...SUPPORT_SETTING_KEYS, ...BUDGET_SETTING_KEYS, ...SESSION_HINT_SETTING_KEYS]) {
  assert.ok(props[`cyclegauge.${k}`] && !props[`cyclegauge.${k}`].deprecationMessage, k);
  assert.equal(props[`cyclegauge.${k}`].scope, 'application');
 }
 const { auditReminderDays: days, auditAutomatically: automatic } = Object.fromEntries(AUDIT_SETTING_KEYS.map(k => [k, props[`cyclegauge.${k}`]]));
 assert.deepEqual([days.type, days.default, days.minimum, days.maximum], ['number', 30, 0, 365]);
 assert.deepEqual([automatic.type, automatic.default, automatic.enum], ['string', 'off', ['off', 'onOpen', 'onOpenAndChanges']]);
 const prompts = props['cyclegauge.supportPrompts'];
 assert.deepEqual([prompts.type, prompts.default, prompts.scope], ['boolean', true, 'application']);
 for (const part of ['rate or support', 'automatic Steering and Hooks review', 'walkthrough', 'shareable cycle recap', 'does not affect budget notices, session hints or audit reminders']) assert.ok(prompts.description.includes(part), part);
 assert.ok(!/\bstar\b/i.test(prompts.description));
 // User-facing settings come first; the testing and storage overrides come last. Raw values and the legacy true are not in the visible text.
 const order = Object.entries(props).sort((a: any, b: any) => a[1].order - b[1].order).map(([k]) => k.replace('cyclegauge.', ''));
 assert.deepEqual(order, ['budgetWarnings', 'budgetWarningPercent', 'sessionHints', 'auditReminderDays', 'auditAutomatically', 'configReviewAutomatically', 'supportPrompts', 'sourceRoot', 'storageRoot', 'sourceTimezone']);
 assert.equal(new Set(Object.values(props).map((p: any) => p.order)).size, Object.keys(props).length);
 for (const k of ['auditAutomatically', 'configReviewAutomatically']) {
  assert.deepEqual(props[`cyclegauge.${k}`].enumItemLabels, ['Off', 'On open', 'On open and on changes'], k);
  assert.equal(props[`cyclegauge.${k}`].enumDescriptions.length, 3, k);
  assert.ok(!/onOpen|onOpenAndChanges|earlier value/.test(props[`cyclegauge.${k}`].enumDescriptions.join(' ') + props[`cyclegauge.${k}`].description), k);
 }
 assert.match(props['cyclegauge.budgetWarnings'].description, /right-sizing/);
 const review = props['cyclegauge.configReviewAutomatically'];
 assert.deepEqual([review.type, review.default, review.enum, review.scope], ['string', 'off', ['off', 'onOpen', 'onOpenAndChanges'], 'application']);
 const hints = props['cyclegauge.sessionHints'];
 assert.deepEqual([hints.type, hints.default, hints.scope], ['boolean', true, 'application']);
 assert.match(hints.description, /macOS/); assert.match(hints.description, /nothing stored or sent/);
 const { budgetWarnings: budget, budgetWarningPercent: percent } = Object.fromEntries(BUDGET_SETTING_KEYS.map(k => [k, props[`cyclegauge.${k}`]]));
 assert.deepEqual([budget.type, budget.default, budget.scope], ['boolean', true, 'application']);
 assert.deepEqual([percent.type, percent.default, percent.minimum, percent.maximum, percent.scope], ['number', 80, 0, 100, 'application']);
});

test('the share and support commands are declared; the support reset is visible in the palette', () => {
 const titles = Object.fromEntries(manifest.contributes.commands.map((c: any) => [c.command, c.title]));
 assert.equal(titles[commandId('share')], 'Cyclegauge: Copy Share Link');
 assert.equal(titles[commandId('support.reset')], 'Cyclegauge: Reset Reminders and Saved Summary');
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
 assert.deepEqual(LINKS, { rate: 'https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', star: 'https://github.com/StefanSuess/Cyclegauge', support: 'https://ko-fi.com/stefansuess', kiro: 'https://kiro.dev', tips: 'https://github.com/StefanSuess/Cyclegauge/blob/main/docs/credit-tips.md' });
 for (const url of Object.values(LINKS)) assert.ok(url.startsWith('https://') && !/[?#]/.test(url), url);
});

test('the report-a-problem address is one fixed https constant whose only query is the template', () => {
 assert.equal(REPORT_PROBLEM_URL, 'https://github.com/StefanSuess/Cyclegauge/issues/new?template=bug_report.yml');
 assert.deepEqual([...new URL(REPORT_PROBLEM_URL).searchParams.entries()], [['template', 'bug_report.yml']]);
 assert.equal(new URL(REPORT_PROBLEM_URL).hash, '');
 assert.equal(REPORT_PROBLEM_ACTION, 'Report a problem');
});

test('the reset reminder command is declared with its palette title', () => {
 const reset = manifest.contributes.commands.find((c: any) => c.command === commandId('audit.resetReminder'));
 assert.equal(reset?.title, 'Cyclegauge: Reset Workspace Audit Reminder');
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

test('session hints are on unless the user\'s own value is explicitly false; workspace and folder values are never consulted', () => {
 assert.equal(readSessionHints(undefined), true);
 assert.equal(readSessionHints({}), true);
 assert.equal(readSessionHints({ defaultValue: true }), true);
 assert.equal(readSessionHints({ globalValue: false, defaultValue: true }), false);
 assert.equal(readSessionHints({ globalValue: true, defaultValue: true }), true);
 for (const other of ['false', 0, null, '']) assert.equal(readSessionHints({ globalValue: other, defaultValue: true }), true, String(other));
 // a workspace value (even one that would switch the feature off or on) is not part of what is read
 assert.equal(readSessionHints({ globalValue: undefined, defaultValue: true, workspaceValue: false, workspaceFolderValue: false } as never), true);
 assert.equal(readSessionHints({ globalValue: false, defaultValue: true, workspaceValue: true, workspaceFolderValue: true } as never), false);
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
 assert.equal(manifest.preview === true, isPreReleaseVersion(manifest.version));
 for (const key of Object.keys(manifest.contributes.configuration.properties)) assert.equal(manifest.contributes.configuration.properties[key].scope, [...AUDIT_SETTING_KEYS, ...CONFIG_REVIEW_SETTING_KEYS, ...SUPPORT_SETTING_KEYS, ...BUDGET_SETTING_KEYS, ...SESSION_HINT_SETTING_KEYS].some(k => key === `cyclegauge.${k}`) ? 'application' : 'machine', key);
 assert.equal(manifest.icon, 'assets/branding/cyclegauge-icon-256.png');
 assert.ok((await readFile(new URL(`../../${manifest.icon}`, import.meta.url))).length > 0);
 assert.match(await readFile(new URL('../../LICENSE', import.meta.url), 'utf8'), /MIT License/);
});
