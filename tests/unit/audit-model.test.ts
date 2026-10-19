import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditTree, auditSizeTotal, checkedLabel, dismissHash, escapeText, excludeAnnotation, findingKey, findingsToast, formatBytes, formatSize, countFindings, countsText, kiroignoreAppend, relativeTime, revealTarget, sizePhrase, visibleFindings, KIROIGNORE_HEADER, NOTHING_CHANGES, PREPARED_DESCRIPTION, IGNORE_OFF_DESCRIPTION, IGNORE_ACTION_LABEL, IGNORE_USE_NOTE, ignoreNotEffective, unsavedFilesText, WHY } from '../../src/extension/audit-model.ts';
import { reviewTree, recheckText, type ViewNode } from '../../src/extension/config-model.ts';
import type { AuditResult, Finding } from '../../src/audit/audit.ts';

const counts = { files: 12, dirs: 3, ignored: 2, ignoreFiles: 2, ignoreFilesUnavailable: 0, symlinks: 1, unreadable: 0, unknown: 1 };
const finding = (over: Partial<Finding> = {}): Finding => ({ path: 'synthetic.pem', isDir: false, category: 'secret', coverage: 'not_covered', suggestion: '/synthetic.pem', size: 10, ...over });
const result = (over: Partial<AuditResult> = {}): AuditResult => ({ status: 'complete', ignore: 'evaluated', findings: [finding()], omitted: 0, counts, reasons: [], ...over });
const file = (path: string, size: number | undefined, isDir = false): Pick<Finding, 'coverage' | 'size' | 'path' | 'isDir'> => ({ path, isDir, coverage: 'not_covered', ...(size === undefined ? {} : { size }) });
const hashFn = (category: string, path: string) => dismissHash('synthetic-salt', category, path);
const NOW = new Date(2030, 5, 15, 12, 0, 0), OFF = { audit: 'off', config: 'off' } as const;
const at = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const parts = (r: AuditResult, dismissed: string[] = [], accepted: string[] = [], name = 'synthetic-folder', checked?: string) => auditTree(r, name, dismissed, hashFn, new Set(accepted), checked);
// The whole view as the user sees it: the status line, notes, the Exclude group with its categories, and the footers.
const tree = (r: AuditResult, dismissed: string[] = [], accepted: string[] = [], name = 'synthetic-folder', checked?: string) => reviewTree(parts(r, dismissed, accepted, name, checked), undefined, [], OFF, NOW);
const flat = (nodes: ViewNode[]): ViewNode[] => nodes.flatMap(n => [n, ...flat(n.children ?? [])]);
const exclude = (r: AuditResult, dismissed: string[] = []) => parts(r, dismissed).exclude;
const categories = (r: AuditResult, dismissed: string[] = []) => (exclude(r, dismissed)?.children ?? []).filter(n => n.kind === 'group');
const mixed = () => result({ findings: [
 finding(), finding({ path: 'dist', isDir: true, category: 'build', size: 2048, suggestion: '/dist/', coverage: 'unknown' }),
 finding({ path: 'node_modules', isDir: true, category: 'dependency', suggestion: '/node_modules/' }), finding({ path: 'b.sql', category: 'database', size: 4096, suggestion: '/b.sql' }),
].map((f, i) => i === 2 ? (delete f.size, f) : f) });

test('one Exclude group holds the categories as sub-groups in category order, with counts and a short reason; only non-empty ones appear', () => {
 const nodes = tree(mixed());
 assert.deepEqual(nodes.map(n => n.kind), ['header', 'group']);
 const group = nodes[1]!;
 assert.equal(group.label, 'Exclude from Kiro (4)'); assert.equal(group.description, 'adds lines to .kiroignore'); assert.equal(group.contextValue, 'group-exclude'); assert.equal(group.expanded, false);
 assert.deepEqual(group.children!.map(n => n.kind), ['group', 'group', 'group', 'group'], 'no note row');
 assert.ok(!flat(nodes).some(n => n.label === NOTHING_CHANGES));
 const subs = categories(mixed());
 assert.deepEqual(subs.map(n => n.label), ['Secrets and credentials (1)', 'Databases and dumps (1)', 'Build output (1)', 'Dependencies (1)']);
 assert.deepEqual(subs.map(n => n.description), ['may contain passwords or keys', 'large, may contain real data', 'generated, rarely needed', 'third-party code, very large']);
 assert.ok(subs.every(n => n.contextValue === 'group' && n.expanded === false));
 const dist = flat(nodes).find(n => n.label === 'dist/')!;
 assert.equal(dist.description, 'Unclear'); assert.equal(dist.kind, 'finding'); assert.equal(dist.contextValue, 'finding-suggestible');
 assert.equal(flat(nodes).find(n => n.label === 'synthetic.pem')!.description, 'Kiro may read this');
 assert.equal(flat(nodes).find(n => n.label === 'node_modules/')!.description, 'Kiro may read this');
 const ids = flat(nodes).map(n => n.id); assert.equal(new Set(ids).size, ids.length);
 for (const n of flat(nodes)) { assert.ok(n.icon.length > 0); assert.ok(n.contextValue.length > 0); }
 assert.ok(flat(nodes).every(n => n.kind !== 'group' || (n.children?.length ?? 0) > 0));
 assert.equal(exclude(result({ findings: [] })), undefined, 'no Exclude group without findings');
 // A group of findings none of which has a safe rule offers no group action.
 assert.equal(exclude(result({ findings: [finding({ suggestion: '' })] }))!.contextValue, 'group-exclude-none');
});
test('items inside a category are sorted by size, largest first; unsized ones last; ids keep the position in the result', () => {
 const r = result({ findings: [
  finding({ path: 'synthetic-small.pem', size: 10 }), finding({ path: 'synthetic-unsized.pem', size: undefined }), finding({ path: 'synthetic-big.pem', size: 5000 }), finding({ path: 'synthetic-mid.pem', size: 900 }),
 ].map(f => f.size === undefined ? (delete f.size, f) : f) });
 const items = categories(r)[0]!.children!;
 assert.deepEqual(items.map(n => n.label), ['synthetic-big.pem', 'synthetic-mid.pem', 'synthetic-small.pem', 'synthetic-unsized.pem']);
 assert.deepEqual(items.map(n => n.id), ['finding:secret:2', 'finding:secret:3', 'finding:secret:0', 'finding:secret:1']);
});
test('every category has a short reason that fits the sidebar, and finding descriptions never carry the size', () => {
 const categories = ['secret', 'database', 'archive', 'log', 'data', 'build', 'dependency', 'large'] as const;
 assert.deepEqual(Object.keys(WHY).sort(), [...categories].sort());
 for (const category of categories) { assert.ok(WHY[category].length > 0 && WHY[category].length <= 40, category); assert.ok(!/jargon|covered/i.test(WHY[category])); }
 const r = result({ findings: categories.map(category => finding({ category, path: `synthetic-${category}`, size: 123456 })) });
 for (const n of flat(tree(r)).filter(x => x.kind === 'finding')) {
  assert.equal(n.description, 'Kiro may read this');
  assert.ok(!/\d|KiB|MiB|GiB|\bB\b/.test(n.description!), n.description);
  assert.ok(n.tooltip!.includes('Size: 121 KiB'), 'the size moved to the tooltip');
 }
});
test('tooltip explains category, status, size and the suggestion in plain text', () => {
 const n = flat(tree(result())).find(x => x.kind === 'finding')!;
 assert.deepEqual(n.tooltip!.split('\n'), ['synthetic.pem', 'Secrets and credentials: Files that commonly hold credentials or private keys.', 'No ignore file in this folder excludes it. Global ignore files were not checked.', 'Size: 10 B', 'Suggested rule: /synthetic.pem']);
 const none = flat(tree(result({ findings: [finding({ suggestion: '', size: undefined })] }))).find(x => x.kind === 'finding')!;
 assert.ok(none.tooltip!.includes('No safe rule could be suggested')); assert.ok(!none.tooltip!.includes('Size:')); assert.equal(none.contextValue, 'finding');
 const unclear = (r: Partial<AuditResult>) => flat(tree(result({ findings: [finding({ coverage: 'unknown' })], ...r }))).find(x => x.kind === 'finding')!;
 assert.ok(unclear({}).tooltip!.includes('Cyclegauge could not tell whether it is excluded: the ignore rules could not be fully checked.'));
 assert.ok(unclear({ ignore: 'setting_unknown' }).tooltip!.includes('excluded: the Agent Ignore Files setting could not be read.'));
 assert.ok(unclear({ reasons: ['evaluation_time_limit'] }).tooltip!.includes('stopped at the time limit'));
 assert.ok(unclear({ reasons: ['ignore_rule_limit'] }).tooltip!.includes('could not be used'));
 assert.equal(unclear({}).description, 'Unclear');
 for (const text of [...flat(tree(mixed())).map(x => `${x.label} ${x.description ?? ''} ${x.tooltip ?? ''}`)]) assert.ok(!/Not covered|\bIgnore\b|ignored by you|accepted/.test(text), text);
});
test('status line: time of the check, suggestions, size Kiro may read, folder in the tooltip; positive empty state, partial and unavailable', () => {
 const status = (r: AuditResult, dismissed: string[] = [], checked: string | undefined = at(0)) => tree(r, dismissed, [], 'synthetic-folder', checked)[0]!;
 const nowLocal = new Date(2030, 5, 15, 19, 42, 0), on = (r: AuditResult) => reviewTree(parts(r, [], [], 'synthetic-folder', nowLocal.toISOString()), undefined, [], OFF, new Date(2030, 5, 15, 20, 0, 0))[0]!;
 assert.equal(on(result()).label, 'Checked 19:42 · 1 suggestion'); assert.equal(on(result()).kind, 'header');
 const one = status(result());
 assert.equal(one.label, `Checked ${checkedLabel(at(0), NOW)} · 1 suggestion`); assert.equal(one.description, 'Kiro may read about 10 B');
 assert.ok(one.tooltip!.startsWith('Folder: synthetic-folder\nThese files are in your workspace and not excluded by its ignore files.')); assert.ok(one.tooltip!.includes('Being listed does not mean Kiro has read them.'));
 assert.ok(status(mixed()).label.endsWith('· 4 suggestions'));
 assert.ok(status(result({ omitted: 5 })).label.endsWith('· 6 suggestions'));
 assert.ok(status(mixed(), [hashFn('secret', 'synthetic.pem')]).label.endsWith('· 3 suggestions'));
 const zero = status(result({ findings: [] }), [], at(24 * 60 * 3));
 assert.equal(zero.label, 'Checked 3 days ago · nothing to suggest'); assert.equal(zero.icon, 'pass'); assert.equal(zero.description, undefined);
 assert.equal(status(result(), [hashFn('secret', 'synthetic.pem')]).label.split(' · ')[1], 'nothing to suggest');
 assert.ok(status(result(), [hashFn('secret', 'synthetic.pem')]).tooltip!.includes('Items you hid are not counted.'));
 assert.equal(status(result(), [], '').label, '1 suggestion'); assert.equal(status(result(), [], '').description, 'Kiro may read about 10 B');
 const partial = status(result({ status: 'partial', reasons: ['entry_limit', 'evaluation_time_limit', 'ignore_file_limit', 'ignore_rule_limit', 'depth_limit', 'time_limit', 'cancelled', 'synthetic_new_reason'] }));
 assert.equal(partial.description, 'Kiro may read about 10 B · partial check'); assert.equal(partial.icon, 'warning');
 for (const text of ['entry limit', 'show as unknown', 'more ignore files than can be read', 'more rules than can be checked', 'deeply nested', 'time limit', 'cancelled', 'synthetic new reason']) assert.ok(partial.tooltip!.includes(text), text);
 assert.ok(partial.tooltip!.includes('12 files and 3 folders scanned; 2 ignored, 1 with unknown coverage, 1 symbolic links skipped, 0 unreadable.'));
 assert.ok(status(result({ status: 'partial' })).tooltip!.includes('- Some results may be missing.'));
 assert.ok(!status(result()).description!.includes('partial'));
 for (const [code, text] of [['root_invalid', 'not a usable local directory'], ['root_symlink', 'symbolic link'], ['root_unreadable', 'could not be read']] as const) {
  const nodes = tree(result({ status: 'unavailable', code, findings: [] })); assert.equal(nodes.length, 1); assert.equal(nodes[0]!.icon, 'warning'); assert.ok(nodes[0]!.label.includes(text), code);
 }
 assert.ok(tree(result({ status: 'unavailable', findings: [] }))[0]!.label.includes('could not be audited'));
});
test('the status line says when the checks run again, from the two automatic settings', () => {
 assert.equal(recheckText('off', 'off'), '');
 assert.equal(recheckText('onOpen', 'onOpen'), 'checks again on open');
 assert.equal(recheckText('onOpenAndChanges', 'onOpenAndChanges'), 'checks again on open and on changes');
 assert.equal(recheckText('onOpen', 'off'), 'some checks run again automatically'); assert.equal(recheckText('off', 'onOpenAndChanges'), 'some checks run again automatically');
 const line = (audit: 'off' | 'onOpen' | 'onOpenAndChanges', config: 'off' | 'onOpen' | 'onOpenAndChanges') => reviewTree(parts(result(), [], [], 'synthetic-folder', at(0)), undefined, [], { audit, config }, NOW)[0]!;
 assert.equal(line('onOpenAndChanges', 'onOpenAndChanges').description, 'Kiro may read about 10 B · checks again on open and on changes');
 assert.equal(line('off', 'off').description, 'Kiro may read about 10 B');
 // The empty view (nothing checked yet) stays empty so the view's welcome text shows.
 assert.deepEqual(reviewTree(undefined, undefined, [], { audit: 'onOpen', config: 'onOpen' }, NOW), []);
});
test('checkedLabel: the local time today, otherwise the relative wording', () => {
 const now = new Date(2030, 5, 15, 20, 0, 0);
 assert.equal(checkedLabel(new Date(2030, 5, 15, 9, 5, 0).toISOString(), now), '09:05'); assert.equal(checkedLabel(new Date(2030, 5, 14, 23, 59, 0).toISOString(), now), 'yesterday');
 assert.equal(checkedLabel(undefined, now), ''); assert.equal(checkedLabel('synthetic-not-a-time', now), ''); assert.equal(checkedLabel(new Date(2030, 5, 16, 20, 0, 0).toISOString(), now), '');
});
test('counts separate items Kiro may read from unclear ones; all-unclear results explain themselves in the status tooltip', () => {
 const status = (r: AuditResult) => tree(r)[0]!;
 const allUnknown = result({ ignore: 'setting_unknown', findings: [finding({ coverage: 'unknown' }), finding({ path: 'b.sql', category: 'database', coverage: 'unknown', suggestion: '/b.sql' })] });
 const h = status(allUnknown);
 assert.equal(parts(allUnknown).stats!.suggestions, 2); assert.ok(!/Kiro may read/.test(h.label)); assert.equal(h.description, undefined);
 assert.ok(h.tooltip!.includes('Cyclegauge could not tell whether these are excluded by the ignore files.')); assert.ok(!h.tooltip!.includes('not excluded by its ignore files'));
 // Omitted findings have no known coverage, so they count as unclear suggestions.
 assert.equal(parts(result({ findings: [finding({ coverage: 'unknown' })], omitted: 3 })).stats!.suggestions, 4);
 assert.equal(parts(result({ omitted: 3 })).stats!.suggestions, 4);
 assert.equal(parts(mixed()).stats!.suggestions, 4);
 assert.ok(status(mixed()).tooltip!.includes('These files are in your workspace and not excluded by its ignore files.'));
 const zero = status(result({ findings: [] }));
 assert.equal(zero.label, 'Nothing to suggest');
 assert.ok(zero.tooltip!.includes('No files matching these kinds by name or size were found. This does not prove there are no secrets.'));
 assert.deepEqual([countsText(0, 0), countsText(1, 0), countsText(2, 1), countsText(0, 1), countsText(0, 7)], ['No risky files found', '1 item Kiro may read', '2 items Kiro may read · 1 unclear', '1 item to review', '7 items to review']);
 assert.deepEqual(countFindings([finding(), finding({ coverage: 'unknown' })], 2), { items: 1, unclear: 3 });
});
test('the global-rules sentence lives only in the status tooltip', () => {
 const sentence = "Only this folder's ignore files were checked, not global ones.";
 for (const r of [result(), result({ findings: [] }), result({ status: 'partial' }), result({ ignore: 'disabled' }), result({ kiroignoreNotListed: true })]) {
  const nodes = flat(tree(r)), headers = nodes.filter(n => n.tooltip?.includes(sentence));
  assert.deepEqual(headers.map(n => n.id), ['status']);
  assert.ok(!nodes.some(n => n.label.includes('Global') || n.id === 'info:global'));
 }
 assert.ok(!tree(result({ status: 'unavailable', findings: [] }))[0]!.tooltip!.includes(sentence));
});
test('relativeTime: just now, minutes, today, yesterday and days, by local calendar day', () => {
 const now = new Date(2030, 5, 15, 12, 0, 0), ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
 assert.equal(relativeTime(ago(0), now), 'just now'); assert.equal(relativeTime(ago(59_000), now), 'just now');
 assert.equal(relativeTime(ago(60_000), now), '1 min ago'); assert.equal(relativeTime(ago(45 * 60_000), now), '45 min ago');
 assert.equal(relativeTime(new Date(2030, 5, 15, 9, 0, 0).toISOString(), now), 'today');
 assert.equal(relativeTime(new Date(2030, 5, 14, 23, 59, 0).toISOString(), now), 'yesterday');
 // Within the hour it stays in minutes even across midnight; an hour or more on the previous day is yesterday.
 const early = new Date(2030, 5, 15, 0, 10, 0);
 assert.equal(relativeTime(new Date(2030, 5, 14, 23, 50, 0).toISOString(), early), '20 min ago'); assert.equal(relativeTime(new Date(2030, 5, 14, 23, 10, 0).toISOString(), early), 'yesterday');
 assert.equal(relativeTime(new Date(2030, 5, 14, 23, 11, 0).toISOString(), early), '59 min ago');
 assert.equal(relativeTime(new Date(2030, 5, 14, 0, 1, 0).toISOString(), now), 'yesterday');
 assert.equal(relativeTime(new Date(2030, 5, 12, 12, 0, 0).toISOString(), now), '3 days ago');
 assert.equal(relativeTime(new Date(2030, 4, 15, 12, 0, 0).toISOString(), now), '31 days ago');
 // A future time (clock change) is shown as just now within a minute and is otherwise not shown at all.
 assert.equal(relativeTime(new Date(now.getTime() + 30_000).toISOString(), now), 'just now'); assert.equal(relativeTime(new Date(now.getTime() + 3_600_000).toISOString(), now), '');
 for (const bad of [undefined, '', 'synthetic-not-a-time']) assert.equal(relativeTime(bad, now), '');
 assert.equal(relativeTime(ago(0), new Date(Number.NaN)), '');
});
test('info items: ignore-mode notes and the .kiroignore action; no global note item', () => {
 const infos = (r: AuditResult) => tree(r).filter(n => n.kind === 'info');
 assert.deepEqual(infos(result()).map(n => n.label), []);
 assert.deepEqual(infos(result({ ignore: 'disabled' })).map(n => n.label), [], 'merged into the Exclude group while it has findings');
 assert.deepEqual(infos(result({ ignore: 'disabled', findings: [] })).map(n => n.label), ['Workspace ignore files are turned off']);
 assert.deepEqual(infos(result({ ignore: 'setting_unknown' })).map(n => n.label), ["Couldn't read the Agent Ignore Files setting"]);
 const note = infos(result({ kiroignoreNotListed: true, findings: [] })).find(n => n.action)!;
 assert.equal(note.label, ".kiroignore isn't active yet"); assert.equal(note.action, 'openIgnoreSetting'); assert.equal(note.description, 'open setting');
 assert.equal(note.tooltip, 'Kiro IDE only uses .kiroignore when it is listed in Agent Ignore Files. Click to open that setting.');
 assert.ok(!infos(result()).some(n => n.action));
});
test('no empty-state item: the status line says so; omitted items get a footer', () => {
 assert.ok(!tree(result({ findings: [] })).some(n => n.label === 'No findings'));
 assert.deepEqual(tree(result({ findings: [] })).map(n => n.id), ['status']);
 const nodes = tree(result({ omitted: 4 })); const footer = nodes.at(-1)!;
 assert.equal(footer.kind, 'footer'); assert.equal(footer.label, '4 more not shown'); assert.ok(nodes[0]!.label.endsWith('5 suggestions'));
 assert.ok(tree(result({ findings: [], omitted: 4 }))[0]!.label.endsWith('4 suggestions'));
});
test('hidden findings are filtered, counted and can be shown again; excluded ones are marked', () => {
 const r = mixed(), pem = r.findings[0]!;
 const nodes = tree(r, [hashFn(pem.category, pem.path)]);
 assert.ok(!flat(nodes).some(n => n.label === 'synthetic.pem')); assert.ok(!flat(nodes).some(n => n.id === 'secret'));
 const footer = nodes.at(-1)!; assert.equal(footer.label, '1 hidden by you'); assert.equal(footer.description, 'Show again'); assert.equal(footer.action, 'clearDismissed');
 assert.ok(!tree(r).some(n => n.action === 'clearDismissed'));
 assert.deepEqual(visibleFindings(r, [hashFn(pem.category, pem.path)], hashFn).map(f => f.path), ['dist', 'node_modules', 'b.sql']);
 const marked = flat(tree(r, [], [findingKey(pem)])); assert.equal(marked.find(n => n.label === 'synthetic.pem')!.description, 'Kiro may read this · rule prepared (unsaved)');
 assert.ok(marked.find(n => n.label === 'synthetic.pem')!.tooltip!.includes('The rule is prepared but not saved.'));
 assert.equal(marked.find(n => n.label === 'dist/')!.description, 'Unclear');
});
test('manifest wording: each apply button names its target verb, plain item actions, Run and Show commands and the gated welcome texts', () => {
 const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
 const title = (id: string) => manifest.contributes.commands.find((c: { command: string }) => c.command === id)?.title;
 const verbs: Record<string, string> = { 'audit.accept': 'Exclude from Kiro…', 'audit.acceptAll': 'Exclude from Kiro…', 'config.loadWhenNeeded': 'Load only when needed…', 'config.loadWhenNeededAll': 'Load only when needed…', 'config.runManually': 'Run only manually…', 'config.runManuallyAll': 'Run only manually…' };
 for (const [id, verb] of Object.entries(verbs)) assert.equal(title(`cyclegauge.${id}`), verb, id);
 assert.equal(title('cyclegauge.audit.dismiss'), 'Hide this item'); assert.equal(title('cyclegauge.audit.reveal'), 'Show file'); assert.equal(title('cyclegauge.config.open'), 'Show file');
 assert.equal(title('cyclegauge.config.disable'), 'Disable hook'); assert.equal(title('cyclegauge.config.preview'), 'Show suggestion');
 assert.equal(title('cyclegauge.audit.copy'), 'Copy .kiroignore lines'); assert.equal(title('cyclegauge.audit.clearDismissed'), 'Show hidden items again');
 assert.equal(title('cyclegauge.audit.show'), 'Cyclegauge: Show Workspace Audit Results'); assert.equal(title('cyclegauge.auditWorkspace'), 'Cyclegauge: Run Workspace Audit');
 assert.equal(manifest.contributes.views.explorer[0].name, 'Workspace Audit');
 const icon = (id: string) => manifest.contributes.commands.find((c: { command: string }) => c.command === id)?.icon;
 for (const id of Object.keys(verbs)) assert.equal(icon(`cyclegauge.${id}`), '$(diff)', id);
 assert.equal(icon('cyclegauge.audit.dismiss'), '$(eye-closed)'); assert.equal(icon('cyclegauge.config.preview'), '$(info)'); assert.equal(icon('cyclegauge.config.disable'), '$(circle-slash)');
 // The lightbulb belongs to the Cost Advisor alone.
 assert.deepEqual(manifest.contributes.commands.filter((c: { icon?: string }) => c.icon === '$(lightbulb)').map((c: { command: string }) => c.command), ['cyclegauge.costAdvisor']);
 for (const id of ['accept', 'dismiss', 'acceptAll', 'clearDismissed']) assert.ok(!/\b(ignore|ignored|accept)\b/i.test(title(`cyclegauge.audit.${id}`)), id);
 // The audit welcome needs a trusted folder; without a folder or in an untrusted one the view says what to do instead.
 const welcome = manifest.contributes.viewsWelcome as { view: string; contents: string; when: string }[];
 assert.ok(welcome.every(w => w.view === 'cyclegauge.auditView' && w.when));
 const byWhen = (when: string) => welcome.filter(w => w.when === when);
 assert.equal(byWhen('workspaceFolderCount > 0 && isWorkspaceTrusted').length, 1);
 assert.match(byWhen('workspaceFolderCount > 0 && isWorkspaceTrusted')[0]!.contents, /nothing changes until you save\.\n\[Run the workspace audit\]\(command:cyclegauge\.auditWorkspace\)$/);
 assert.match(byWhen('workspaceFolderCount == 0')[0]!.contents, /\[Open Folder\]\(command:workbench\.action\.files\.openFolder\)$/);
 assert.match(byWhen('workspaceFolderCount > 0 && !isWorkspaceTrusted')[0]!.contents, /\[Manage Workspace Trust\]\(command:workbench\.trust\.manage\)$/);
});
test('menus: the Exclude group carries the group verb and the copy action; its items have exactly the target-verb button, Hide this item and Show file', () => {
 const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
 const items = manifest.contributes.menus['view/item/context'] as { command: string; when: string; group: string }[];
 // Evaluates the item's `viewItem` condition for a context value, as the editor does.
 const matches = (when: string, context: string): boolean => { const eq = /viewItem == (\S+)$/.exec(when), re = /viewItem =~ \/(.*)\/$/.exec(when); return eq ? eq[1] === context : re ? new RegExp(re[1]!).test(context) : false; };
 const on = (context: string) => items.filter(i => matches(i.when, context));
 const inline = (context: string) => on(context).filter(i => i.group.startsWith('inline')).sort((a, b) => a.group.localeCompare(b.group)).map(i => i.command);
 assert.deepEqual(inline('group-exclude'), ['cyclegauge.audit.acceptAll']);
 assert.deepEqual(on('group-exclude').filter(i => !i.group.startsWith('inline')).map(i => i.command).sort(), ['cyclegauge.audit.acceptAll', 'cyclegauge.audit.copy']);
 assert.deepEqual(inline('finding-suggestible'), ['cyclegauge.audit.accept', 'cyclegauge.audit.dismiss', 'cyclegauge.audit.reveal']);
 assert.deepEqual(inline('finding'), ['cyclegauge.audit.dismiss', 'cyclegauge.audit.reveal'], 'a finding without a rule still has Hide this item and Show file');
 // The title bar has only the one check button (it also runs the Steering and Hooks review) and the overflow entry for hidden items.
 const titleBar = manifest.contributes.menus['view/title'] as { command: string; group: string }[];
 assert.deepEqual(titleBar.map(m => m.command), ['cyclegauge.auditWorkspace', 'cyclegauge.audit.clearDismissed']);
 assert.ok(!JSON.stringify(manifest.contributes.menus).includes('"navigation@2"'));
});
test('paths, folder names and tooltips make control, bidi, format and tag characters visible', () => {
 const nasty = `<b>&"'\n\u0000\u007f​‏‮⁦⁩﻿؜  ­${String.fromCodePoint(0xe0041)}end`;
 const nodes = tree(result({ findings: [finding({ path: nasty, suggestion: '/safe' })] }), [], [], nasty);
 const strings = flat(nodes).flatMap(n => [n.label, n.description ?? '', n.tooltip ?? '']).join('\n');
 assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(strings.replace(/\n/g, '')));
 for (const code of ['000A', '0000', '007F', '200B', '200F', '202E', '2066', '2069', 'FEFF', '061C', '2028', '2029', '00AD', 'E0041']) assert.ok(strings.includes(`\\u{${code}}`), code);
 assert.ok(nodes[0]!.tooltip!.includes('<b>&"\'') && nodes[0]!.tooltip!.includes('\\u{000A}'));
 assert.equal(escapeText('plain'), 'plain');
});
test('sizes are human readable', () => {
 assert.equal(formatSize(0), '0 B'); assert.equal(formatSize(1023), '1023 B'); assert.equal(formatSize(1024), '1.0 KiB'); assert.equal(formatSize(5 * 1024 * 1024), '5.0 MiB');
 assert.equal(formatSize(150 * 1024), '150 KiB'); assert.equal(formatSize(3 * 1024 ** 3), '3.0 GiB'); assert.equal(formatSize(2048 * 1024 ** 4), '2048 TiB');
});
test('status line shows the size Kiro may read after the suggestions and says what it is', () => {
 const head = (r: AuditResult, dismissed: string[] = []) => tree(r, dismissed, [], 'synthetic-folder', at(5))[0]!;
 const big = result({ findings: [finding({ path: 'synthetic-a.pem', size: 240.3 * 1024 * 1024 }), finding({ path: 'synthetic-b.log', category: 'log', size: 1024 })] });
 const h = head(big);
 assert.equal(h.label, `Checked ${checkedLabel(at(5), NOW)} · 2 suggestions`);
 assert.equal(h.description, 'Kiro may read about 240.3 MiB');
 assert.ok(h.tooltip!.includes('Total size of the files Kiro may read but probably doesn\'t need.'));
 assert.ok(!h.tooltip!.includes('lower bound'));
 // A counted folder with no size makes the total a lower bound.
 const lower = head(result({ findings: [finding({ path: 'synthetic-a.pem', size: 1024 }), finding({ path: 'synthetic-dep', isDir: true, category: 'dependency', size: undefined })] }));
 assert.equal(lower.description, 'Kiro may read at least 1 KiB');
 assert.ok(lower.tooltip!.includes('Some of them have no size, or the list is cut short, so the total is a lower bound.'));
 // Hidden findings are not in the total, and an empty or all-unknown result adds nothing.
 assert.equal(head(big, [hashFn('secret', 'synthetic-a.pem')]).description, 'Kiro may read about 1 KiB');
 assert.equal(head(result({ findings: [] })).description, undefined);
 assert.equal(head(result({ findings: [finding({ coverage: 'unknown', size: 5000 })] })).description, undefined);
});
test('size total: sums not_covered sizes of visible findings, a lower bound for unsized ones, excludes unknown coverage', () => {
 assert.deepEqual(auditSizeTotal([file('a', 1000), file('b', 24)]), { bytes: 1024, lowerBound: false });
 assert.deepEqual(auditSizeTotal([file('a', 1024), file('d', undefined, true)]), { bytes: 1024, lowerBound: true });
 assert.deepEqual(auditSizeTotal([file('d', undefined, true)]), { bytes: 0, lowerBound: true });
 assert.deepEqual(auditSizeTotal([]), { bytes: 0, lowerBound: false });
 assert.deepEqual(auditSizeTotal([{ ...file('u', 5000), coverage: 'unknown' }, { ...file('v', undefined), coverage: 'unknown' }]), { bytes: 0, lowerBound: false });
 // Hidden findings are removed before the total, so a hidden large file never counts.
 const hidden = result({ findings: [finding({ path: 'synthetic.pem', size: 4096 }), finding({ path: 'synthetic.db', category: 'database', size: 2048 })] });
 assert.deepEqual(auditSizeTotal(visibleFindings(hidden, [hashFn('secret', 'synthetic.pem')], hashFn)), { bytes: 2048, lowerBound: false });
 assert.deepEqual(auditSizeTotal(visibleFindings(hidden, [hashFn('secret', 'synthetic.pem'), hashFn('database', 'synthetic.db')], hashFn)), { bytes: 0, lowerBound: false });
});
test('size total does not count a finding twice: a secret inside a counted aggregate directory is skipped', () => {
 const dist = { ...file('dist', 9000), isDir: true };
 assert.deepEqual(auditSizeTotal([dist, file('dist/.env', 40)]), { bytes: 9000, lowerBound: false });
 const pods = { ...file('Pods', 7000), isDir: true };
 assert.deepEqual(auditSizeTotal([pods, file('Pods/x.pem', 12)]), { bytes: 7000, lowerBound: false });
 const bundle = { ...file('synthetic.agilekeychain', 5000), isDir: true };
 assert.deepEqual(auditSizeTotal([bundle, file('synthetic.agilekeychain/data.db', 300)]), { bytes: 5000, lowerBound: false });
 // A sibling whose name only starts with the same letters is a different path and still counts.
 assert.deepEqual(auditSizeTotal([dist, file('dist-old/x.pem', 12)]), { bytes: 9012, lowerBound: false });
 // A hidden aggregate is not in the visible list, so the child counts on its own.
 const hiddenParent = result({ findings: [finding({ path: 'dist', isDir: true, category: 'build', size: 9000 }), finding({ path: 'dist/.env', size: 40 })] });
 assert.deepEqual(auditSizeTotal(visibleFindings(hiddenParent, [hashFn('build', 'dist')], hashFn)), { bytes: 40, lowerBound: false });
 assert.deepEqual(auditSizeTotal(visibleFindings(hiddenParent, [], hashFn)), { bytes: 9000, lowerBound: false });
});
test('size total: omitted findings beyond the listed maximum make the total a lower bound', () => {
 assert.deepEqual(auditSizeTotal([file('a', 1024)], 5), { bytes: 1024, lowerBound: true });
 assert.deepEqual(auditSizeTotal([file('a', 1024)], 0), { bytes: 1024, lowerBound: false });
 const cut = result({ findings: [finding({ path: 'synthetic.pem', size: 2048 })], omitted: 5 });
 assert.equal(auditTree(cut, 'synthetic-folder', [], hashFn, new Set()).stats!.size, 'Kiro may read at least 2 KiB');
});
test('size phrase: about for an exact total, at least for a lower bound, nothing when no sized finding is counted', () => {
 const MIB = 1024 * 1024;
 assert.equal(sizePhrase({ bytes: 240.3 * MIB, lowerBound: false }), 'about 240.3 MiB');
 assert.equal(sizePhrase({ bytes: 240.3 * MIB, lowerBound: true }), 'at least 240.3 MiB');
 assert.equal(sizePhrase({ bytes: 0, lowerBound: false }), '');
 assert.equal(sizePhrase({ bytes: 0, lowerBound: true }), '');
});
test('byte formatter: 1024-based units, whole KiB, one decimal from MiB, unit boundaries roll over', () => {
 const KIB = 1024, MIB = KIB * KIB, GIB = MIB * KIB;
 assert.deepEqual([formatBytes(0), formatBytes(1), formatBytes(1023)], ['0 B', '1 B', '1023 B']);
 assert.deepEqual([formatBytes(KIB), formatBytes(512 * KIB), formatBytes(512.4 * KIB), formatBytes(512.6 * KIB)], ['1 KiB', '512 KiB', '512 KiB', '513 KiB']);
 assert.deepEqual([formatBytes(1023.4 * KIB), formatBytes(1023.6 * KIB), formatBytes(MIB - 1)], ['1023 KiB', '1.0 MiB', '1.0 MiB']);
 assert.deepEqual([formatBytes(MIB), formatBytes(240.3 * MIB), formatBytes(1023.9 * MIB), formatBytes(1024 * MIB)], ['1.0 MiB', '240.3 MiB', '1023.9 MiB', '1.0 GiB']);
 assert.deepEqual([formatBytes(1.2 * GIB), formatBytes(3 * GIB), formatBytes(2048 * GIB)], ['1.2 GiB', '3.0 GiB', '2048.0 GiB']);
});
test('kiroignoreAppend: new file, existing with and without trailing newline, header once, duplicates skipped, CRLF kept', () => {
 assert.equal(kiroignoreAppend(undefined, ['/a', '/b/']), `${KIROIGNORE_HEADER}\n/a\n/b/\n`);
 assert.equal(kiroignoreAppend('/old\n', ['/a']), `${KIROIGNORE_HEADER}\n/a\n`);
 assert.equal(kiroignoreAppend('/old', ['/a']), `\n${KIROIGNORE_HEADER}\n/a\n`);
 assert.equal(kiroignoreAppend('', ['/a']), `${KIROIGNORE_HEADER}\n/a\n`);
 assert.equal(kiroignoreAppend(`${KIROIGNORE_HEADER}\n/a\n`, ['/b']), '/b\n');
 assert.equal(kiroignoreAppend('/a\n/b\n', ['/a', '/b']), ''); assert.equal(kiroignoreAppend('/a\n', ['/a', '/c', '/c', '']), `${KIROIGNORE_HEADER}\n/c\n`);
 assert.equal(kiroignoreAppend(undefined, []), '');
 assert.equal(kiroignoreAppend('/old\r\n/a\r\n', ['/a', '/b']), `${KIROIGNORE_HEADER}\r\n/b\r\n`);
 assert.equal(kiroignoreAppend('/old\r\n/x', ['/b']), `\r\n${KIROIGNORE_HEADER}\r\n/b\r\n`);
 assert.equal(kiroignoreAppend('/a  \n', ['/a']), `${KIROIGNORE_HEADER}\n/a\n`); // only exact lines count as present
});
test('revealTarget: always reveals in the Explorer inside the root and refuses escapes', () => {
 const root = resolve('/', 'synthetic-root'); // resolve adds the drive letter on Windows, like revealTarget
 const f = (path: string) => ({ path });
 assert.deepEqual(revealTarget(root, f('logs/a.log')), { kind: 'reveal', path: join(root, 'logs', 'a.log') });
 assert.deepEqual(revealTarget(root, f('dist')), { kind: 'reveal', path: join(root, 'dist') });
 assert.equal(revealTarget(root, f('a..b/c.log')).kind, 'reveal');
 for (const path of ['../x.log', 'a/../../x.log', 'a/..', '..', '/etc/passwd', '', '.', 'a\0b']) assert.equal(revealTarget(root, f(path)).kind, 'refuse', path);
 assert.equal(revealTarget('', f('a')).kind, 'refuse');
 // Only '/' separates segments; on Windows a backslash or colon could mean a separator, a drive or a stream.
 for (const path of ['a\\..\\..\\x', 'a\\b', 'C:x', 'a/b:stream', '..\\x']) {
  assert.equal(revealTarget(root, f(path), 'win32').kind, 'refuse', path);
  // A POSIX backslash is an ordinary name character; only meaningful on a POSIX host, where join() treats it so too.
  if (process.platform !== 'win32') assert.equal(revealTarget(root, f(path), 'linux').kind, path.includes('..') && path.split('/').includes('..') ? 'refuse' : 'reveal', path);
 }
});
test('tree ids are opaque: no id contains a finding path or folder name', () => {
 const paths = ['synthetic-private/path.pem', 'synthetic-private-dir', 'synthetic-db.sql'];
 const r = result({ findings: [finding({ path: paths[0]! }), finding({ path: paths[1]!, isDir: true, category: 'build', suggestion: '/x/' }), finding({ path: paths[2]!, category: 'database' })] });
 const ids = flat(tree(r, [], [], 'synthetic-private-folder')).map(n => n.id);
 for (const id of ids) for (const p of [...paths, 'synthetic', 'private']) assert.ok(!id.includes(p), `${id} ${p}`);
 assert.deepEqual(ids.filter(i => i.startsWith('finding:')), ['finding:secret:0', 'finding:database:2', 'finding:build:1']);
 assert.ok(ids.includes('secret') && ids.includes('build') && ids.includes('database'));
 assert.equal(new Set(ids).size, ids.length);
 // The index is the position in the result, so dismissing one finding does not renumber the others.
 assert.deepEqual(flat(tree(r, [hashFn('secret', paths[0]!)])).map(n => n.id).filter(i => i.startsWith('finding:')), ['finding:database:2', 'finding:build:1']);
});
test('dismissHash is a stable salted hex digest that never contains the path', () => {
 const h = dismissHash('synthetic-salt', 'secret', 'synthetic-private/path.pem');
 assert.match(h, /^[0-9a-f]{64}$/); assert.equal(h, dismissHash('synthetic-salt', 'secret', 'synthetic-private/path.pem'));
 assert.notEqual(h, dismissHash('synthetic-other-salt', 'secret', 'synthetic-private/path.pem'));
 assert.notEqual(h, dismissHash('synthetic-salt', 'log', 'synthetic-private/path.pem')); assert.notEqual(h, dismissHash('synthetic-salt', 'secret', 'synthetic-private/other.pem'));
 assert.ok(!h.includes('synthetic'));
});

test('the annotation of the Exclude change carries a short why and the alternative; it holds no path', () => {
 const one = excludeAnnotation(1), many = excludeAnnotation(3);
 assert.equal(one.label, 'Exclude from Kiro'); assert.equal(many.label, 'Exclude from Kiro');
 assert.equal(one.description, "Adds 1 line to .kiroignore. Kiro may read this file into the agent's context; excluding it keeps requests smaller. Alternative: Hide this item. Nothing changes until you save.");
 assert.match(many.description, /^Adds 3 lines to \.kiroignore\. Kiro may read these files/); assert.ok(many.description.endsWith('Alternative: Hide this item. Nothing changes until you save.'));
 const group = exclude(mixed())!;
 assert.ok(group.tooltip!.includes('Alternative: Hide this item') && group.tooltip!.includes('Nothing changes until you save.'));
});

test('every group and sub-group starts collapsed and the status line stays visible', () => {
 const nodes = tree(mixed());
 assert.equal(nodes[0]!.kind, 'header');
 for (const n of flat(nodes).filter(x => x.children)) assert.equal(n.expanded, false, n.id);
});
test('ignore not effective: the Exclude group says so with a warning icon and a first action row; the separate rows are merged, never duplicated', () => {
 for (const over of [{ ignore: 'disabled' as const }, { kiroignoreNotListed: true as const }, { ignore: 'disabled' as const, kiroignoreNotListed: true as const }]) {
  const nodes = tree(result(over));
  const group = nodes.find(n => n.id === 'group:exclude')!;
  assert.equal(group.description, IGNORE_OFF_DESCRIPTION); assert.equal(group.description, "won't take effect yet — add .kiroignore to Agent Ignore Files"); assert.equal(group.icon, 'warning');
  assert.equal(group.expanded, false);
  const row = group.children![0]!;
  assert.deepEqual([row.id, row.kind, row.label, row.action, row.contextValue], ['action:ignore_setting', 'info', IGNORE_ACTION_LABEL, 'openIgnoreSetting', 'info-action']);
  assert.equal(IGNORE_ACTION_LABEL, 'Add .kiroignore to Agent Ignore Files…');
  assert.deepEqual(group.children!.slice(1).map(n => n.kind), ['group']);
  assert.ok(group.tooltip!.includes(NOTHING_CHANGES));
  assert.deepEqual(nodes.filter(n => n.kind === 'info').map(n => n.id), [], 'no top-level duplicate');
  assert.equal(flat(nodes).filter(n => n.action === 'openIgnoreSetting').length, 1);
 }
 assert.ok(ignoreNotEffective(result({ ignore: 'disabled' })) && ignoreNotEffective(result({ kiroignoreNotListed: true })) && !ignoreNotEffective(result()) && !ignoreNotEffective(result({ ignore: 'setting_unknown' })));
 // Effective ignore files: the normal description, icon and no action row.
 const normal = tree(result()).find(n => n.id === 'group:exclude')!;
 assert.equal(normal.description, 'adds lines to .kiroignore'); assert.equal(normal.icon, 'exclude'); assert.ok(!flat([normal]).some(n => n.action));
 // setting_unknown keeps its own top-level row.
 assert.deepEqual(tree(result({ ignore: 'setting_unknown' })).filter(n => n.kind === 'info').map(n => n.id), ['info:setting_unknown']);
});
test('a prepared, unsaved .kiroignore marks the accepted items "prepared — save the file to apply" with another icon; the status line counts the files', () => {
 const r = mixed(), key = findingKey(r.findings[0]!);
 const marked = (unsaved: boolean) => reviewTree(auditTree(r, 'synthetic-folder', [], hashFn, new Set([key]), undefined, unsaved), undefined, [], OFF, NOW, unsaved ? 1 : 0);
 const pem = (nodes: ViewNode[]) => flat(nodes).find(n => n.label === 'synthetic.pem')!;
 assert.equal(PREPARED_DESCRIPTION, 'prepared — save the file to apply');
 assert.equal(pem(marked(true)).description, PREPARED_DESCRIPTION); assert.equal(pem(marked(true)).icon, 'edit');
 assert.equal(flat(marked(true)).filter(n => n.description === PREPARED_DESCRIPTION).length, 1, 'only the accepted item');
 assert.ok(marked(true)[0]!.description!.includes('1 file with unsaved prepared changes'));
 assert.equal(pem(marked(false)).description, 'Kiro may read this · rule prepared (unsaved)'); assert.equal(pem(marked(false)).icon, 'key');
 assert.ok(!marked(false)[0]!.description?.includes('unsaved prepared'));
 assert.equal(unsavedFilesText(3), '3 files with unsaved prepared changes');
 assert.ok(IGNORE_USE_NOTE.includes('listed in Agent Ignore Files'));
});
test('the audit notification says files, size and unclear in plain words and names the view only when it exists', () => {
 assert.equal(findingsToast(3, 1, 'about 240 MiB', true), 'Found 3 files Kiro may read (about 240 MiB), 1 unclear. Open the Workspace Audit view.');
 assert.equal(findingsToast(1, 0, '', true), 'Found 1 file Kiro may read. Open the Workspace Audit view.');
 assert.equal(findingsToast(2, 0, 'at least 1.5 GiB', false), 'Found 2 files Kiro may read (at least 1.5 GiB).');
 assert.equal(findingsToast(0, 2, '', true), 'Found 2 files to review. Open the Workspace Audit view.');
 assert.equal(findingsToast(0, 0, '', false), 'No risky files found.');
 assert.ok(!/ items?\b|Kiro Workspace Audit|·|—/.test(findingsToast(3, 1, 'about 1.0 MiB', true)));
});
