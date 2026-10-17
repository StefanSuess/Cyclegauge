import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditTree, dismissHash, escapeText, findingKey, formatSize, countFindings, countsText, kiroignoreAppend, relativeTime, revealTarget, visibleFindings, KIROIGNORE_HEADER, WHY, type AuditNode } from '../../src/extension/audit-model.ts';
import type { AuditResult, Finding } from '../../src/audit/audit.ts';

const counts = { files: 12, dirs: 3, ignored: 2, ignoreFiles: 2, ignoreFilesUnavailable: 0, symlinks: 1, unreadable: 0, unknown: 1 };
const finding = (over: Partial<Finding> = {}): Finding => ({ path: 'synthetic.pem', isDir: false, category: 'secret', coverage: 'not_covered', suggestion: '/synthetic.pem', size: 10, ...over });
const result = (over: Partial<AuditResult> = {}): AuditResult => ({ status: 'complete', ignore: 'evaluated', findings: [finding()], omitted: 0, counts, reasons: [], ...over });
const hashFn = (category: string, path: string) => dismissHash('synthetic-salt', category, path);
const tree = (r: AuditResult, dismissed: string[] = [], accepted: string[] = [], name = 'synthetic-folder') => auditTree(r, name, dismissed, hashFn, new Set(accepted));
const flat = (nodes: AuditNode[]): AuditNode[] => nodes.flatMap(n => [n, ...flat(n.children ?? [])]);
const mixed = () => result({ findings: [
 finding(), finding({ path: 'dist', isDir: true, category: 'build', size: 2048, suggestion: '/dist/', coverage: 'unknown' }),
 finding({ path: 'node_modules', isDir: true, category: 'dependency', suggestion: '/node_modules/' }), finding({ path: 'b.sql', category: 'database', size: 4096, suggestion: '/b.sql' }),
].map((f, i) => i === 2 ? (delete f.size, f) : f) });

test('groups follow the category order, show counts and a short reason, and are expanded by the glue; only non-empty groups appear', () => {
 const nodes = tree(mixed());
 assert.deepEqual(nodes.filter(n => n.kind === 'group').map(n => n.label), ['Secrets and credentials (1)', 'Databases and dumps (1)', 'Build output (1)', 'Dependencies (1)']);
 assert.deepEqual(nodes.filter(n => n.kind === 'group').map(n => n.description), ['may contain passwords or keys', 'large, may contain real data', 'generated, rarely needed', 'third-party code, very large']);
 assert.deepEqual(nodes.map(n => n.kind), ['header', 'group', 'group', 'group', 'group']);
 const dist = flat(nodes).find(n => n.label === 'dist/')!;
 assert.equal(dist.description, 'Unclear'); assert.equal(dist.kind, 'finding'); assert.equal(dist.contextValue, 'finding-suggestible');
 assert.equal(flat(nodes).find(n => n.label === 'synthetic.pem')!.description, 'Kiro may read this');
 assert.equal(flat(nodes).find(n => n.label === 'node_modules/')!.description, 'Kiro may read this');
 const ids = flat(nodes).map(n => n.id); assert.equal(new Set(ids).size, ids.length);
 for (const n of flat(nodes)) { assert.ok(n.icon.length > 0); assert.ok(n.contextValue.length > 0); }
 assert.ok(nodes.every(n => n.kind !== 'group' || (n.children?.length ?? 0) > 0));
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
test('header summarizes: items Kiro may read with folder and time, a positive empty state, partial and unavailable', () => {
 const now = new Date(2030, 5, 15, 12, 0, 0), at = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
 const header = (r: AuditResult, dismissed: string[] = [], checked: string | undefined = at(0)) => auditTree(r, 'synthetic-folder', dismissed, hashFn, new Set(), checked, now)[0]!;
 const one = header(result());
 assert.equal(one.label, '1 item Kiro may read'); assert.equal(one.description, 'synthetic-folder · checked just now'); assert.equal(one.kind, 'header');
 assert.ok(one.tooltip!.startsWith('These files are in your workspace and not excluded by its ignore files.')); assert.ok(one.tooltip!.includes('Being listed does not mean Kiro has read them.'));
 assert.equal(header(mixed()).label, '3 items Kiro may read · 1 unclear');
 assert.equal(header(result({ omitted: 5 })).label, '1 item Kiro may read · 5 unclear');
 assert.equal(header(mixed(), [hashFn('secret', 'synthetic.pem')]).label, '2 items Kiro may read · 1 unclear');
 const zero = header(result({ findings: [] }), [], at(5));
 assert.equal(zero.label, 'No risky files found'); assert.equal(zero.icon, 'pass'); assert.equal(zero.description, 'synthetic-folder · checked 5 min ago');
 assert.equal(header(result(), [hashFn('secret', 'synthetic.pem')]).label, 'No risky files found');
 assert.ok(header(result(), [hashFn('secret', 'synthetic.pem')]).tooltip!.includes('Items you hid are not counted.'));
 assert.equal(header(result(), [], '').description, 'synthetic-folder');
 const partial = header(result({ status: 'partial', reasons: ['entry_limit', 'evaluation_time_limit', 'ignore_file_limit', 'ignore_rule_limit', 'depth_limit', 'time_limit', 'cancelled', 'synthetic_new_reason'] }));
 assert.equal(partial.description, 'synthetic-folder · checked just now · partial check'); assert.equal(partial.icon, 'warning');
 for (const text of ['entry limit', 'show as unknown', 'more ignore files than can be read', 'more rules than can be checked', 'deeply nested', 'time limit', 'cancelled', 'synthetic new reason']) assert.ok(partial.tooltip!.includes(text), text);
 assert.ok(partial.tooltip!.includes('12 files and 3 folders scanned; 2 ignored, 1 with unknown coverage, 1 symbolic links skipped, 0 unreadable.'));
 assert.ok(header(result({ status: 'partial' })).tooltip!.includes('- Some results may be missing.'));
 assert.ok(!header(result()).description!.includes('partial'));
 for (const [code, text] of [['root_invalid', 'not a usable local directory'], ['root_symlink', 'symbolic link'], ['root_unreadable', 'could not be read']] as const) {
  const nodes = tree(result({ status: 'unavailable', code, findings: [] })); assert.equal(nodes.length, 1); assert.equal(nodes[0]!.icon, 'warning'); assert.ok(nodes[0]!.label.includes(text), code);
 }
 assert.ok(tree(result({ status: 'unavailable', findings: [] }))[0]!.label.includes('could not be audited'));
});
test('counts separate items Kiro may read from unclear ones; all-unclear results say "to review"', () => {
 const header = (r: AuditResult) => tree(r)[0]!;
 const allUnknown = result({ ignore: 'setting_unknown', findings: [finding({ coverage: 'unknown' }), finding({ path: 'b.sql', category: 'database', coverage: 'unknown', suggestion: '/b.sql' })] });
 const h = header(allUnknown);
 assert.equal(h.label, '2 items to review'); assert.ok(!/Kiro may read/.test(h.label));
 assert.ok(h.tooltip!.startsWith('Cyclegauge could not tell whether these are excluded by the ignore files.')); assert.ok(!h.tooltip!.includes('not excluded by its ignore files'));
 assert.equal(header(result({ ignore: 'setting_unknown', findings: [finding({ coverage: 'unknown' })] })).label, '1 item to review');
 // Omitted findings have no known coverage, so they count as unclear.
 assert.equal(header(result({ findings: [finding({ coverage: 'unknown' })], omitted: 3 })).label, '4 items to review');
 assert.equal(header(result({ omitted: 3 })).label, '1 item Kiro may read · 3 unclear');
 assert.equal(header(mixed()).label, '3 items Kiro may read · 1 unclear');
 assert.ok(header(mixed()).tooltip!.startsWith('These files are in your workspace and not excluded by its ignore files.'));
 const zero = header(result({ findings: [] }));
 assert.equal(zero.label, 'No risky files found');
 assert.ok(zero.tooltip!.startsWith('No files matching these kinds by name or size were found. This does not prove there are no secrets.'));
 assert.deepEqual([countsText(0, 0), countsText(1, 0), countsText(2, 1), countsText(0, 1), countsText(0, 7)], ['No risky files found', '1 item Kiro may read', '2 items Kiro may read · 1 unclear', '1 item to review', '7 items to review']);
 assert.deepEqual(countFindings([finding(), finding({ coverage: 'unknown' })], 2), { items: 1, unclear: 3 });
});
test('the global-rules sentence lives only in the header tooltip', () => {
 const sentence = "Only this folder's ignore files were checked, not global ones.";
 for (const r of [result(), result({ findings: [] }), result({ status: 'partial' }), result({ ignore: 'disabled' }), result({ kiroignoreNotListed: true })]) {
  const nodes = flat(tree(r)), headers = nodes.filter(n => n.tooltip?.includes(sentence));
  assert.deepEqual(headers.map(n => n.id), ['header']);
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
 assert.deepEqual(infos(result({ ignore: 'disabled' })).map(n => n.label), ['Workspace ignore files are turned off']);
 assert.deepEqual(infos(result({ ignore: 'setting_unknown' })).map(n => n.label), ["Couldn't read the Agent Ignore Files setting"]);
 const note = infos(result({ kiroignoreNotListed: true })).find(n => n.action)!;
 assert.equal(note.label, ".kiroignore isn't active yet"); assert.equal(note.action, 'openIgnoreSetting'); assert.equal(note.description, 'open setting');
 assert.equal(note.tooltip, 'Kiro IDE only uses .kiroignore when it is listed in Agent Ignore Files. Click to open that setting.');
 assert.ok(!infos(result()).some(n => n.action));
});
test('no empty-state item: the header says so; omitted items get a footer', () => {
 assert.ok(!tree(result({ findings: [] })).some(n => n.label === 'No findings'));
 const nodes = tree(result({ omitted: 4 })); const footer = nodes.at(-1)!;
 assert.equal(footer.kind, 'footer'); assert.equal(footer.label, '4 more not shown'); assert.equal(nodes[0]!.label, '1 item Kiro may read · 4 unclear');
 assert.equal(tree(result({ findings: [], omitted: 4 }))[0]!.label, '4 items to review');
});
test('hidden findings are filtered, counted and can be shown again; excluded ones are marked', () => {
 const r = mixed(), pem = r.findings[0]!;
 const nodes = tree(r, [hashFn(pem.category, pem.path)]);
 assert.ok(!flat(nodes).some(n => n.label === 'synthetic.pem')); assert.ok(!nodes.some(n => n.id === 'secret'));
 const footer = nodes.at(-1)!; assert.equal(footer.label, '1 hidden by you'); assert.equal(footer.description, 'Show again'); assert.equal(footer.action, 'clearDismissed');
 assert.ok(!tree(r).some(n => n.action === 'clearDismissed'));
 assert.deepEqual(visibleFindings(r, [hashFn(pem.category, pem.path)], hashFn).map(f => f.path), ['dist', 'node_modules', 'b.sql']);
 const marked = flat(tree(r, [], [findingKey(pem)])); assert.equal(marked.find(n => n.label === 'synthetic.pem')!.description, 'Kiro may read this · rule prepared (unsaved)');
 assert.ok(marked.find(n => n.label === 'synthetic.pem')!.tooltip!.includes('The rule is prepared but not saved.'));
 assert.equal(marked.find(n => n.label === 'dist/')!.description, 'Unclear');
});
test('manifest wording: plain action titles, no "Ignore" for hiding, a Show command and the new welcome text', () => {
 const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
 const title = (id: string) => manifest.contributes.commands.find((c: { command: string }) => c.command === id)?.title;
 assert.equal(title('cyclegauge.audit.accept'), 'Exclude from Kiro'); assert.equal(title('cyclegauge.audit.dismiss'), 'Not a problem — hide');
 assert.equal(title('cyclegauge.audit.reveal'), 'Show in Explorer'); assert.equal(title('cyclegauge.audit.acceptAll'), 'Exclude all from Kiro');
 assert.equal(title('cyclegauge.audit.copy'), 'Copy .kiroignore lines'); assert.equal(title('cyclegauge.audit.clearDismissed'), 'Show hidden items again');
 assert.equal(title('cyclegauge.audit.show'), 'Cyclegauge: Show Workspace Audit');
 const icon = (id: string) => manifest.contributes.commands.find((c: { command: string }) => c.command === id)?.icon;
 assert.equal(icon('cyclegauge.audit.accept'), '$(eye-closed)'); assert.equal(icon('cyclegauge.audit.dismiss'), '$(close)');
 for (const id of ['accept', 'dismiss', 'acceptAll', 'clearDismissed']) assert.ok(!/\b(ignore|ignored|accept)\b/i.test(title(`cyclegauge.audit.${id}`)), id);
 assert.equal(manifest.contributes.viewsWelcome[0].contents, "Check which files in this workspace Kiro can read but probably doesn't need — like secrets, database dumps or build output.\n[Check workspace](command:cyclegauge.auditWorkspace)");
});
test('paths, folder names and tooltips make control, bidi, format and tag characters visible', () => {
 const nasty = `<b>&"'\n\u0000\u007f​‏‮⁦⁩﻿؜  ­${String.fromCodePoint(0xe0041)}end`;
 const nodes = tree(result({ findings: [finding({ path: nasty, suggestion: '/safe' })] }), [], [], nasty);
 const strings = flat(nodes).flatMap(n => [n.label, n.description ?? '', n.tooltip ?? '']).join('\n');
 assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(strings.replace(/\n/g, '')));
 for (const code of ['000A', '0000', '007F', '200B', '200F', '202E', '2066', '2069', 'FEFF', '061C', '2028', '2029', '00AD', 'E0041']) assert.ok(strings.includes(`\\u{${code}}`), code);
 assert.ok(nodes[0]!.description!.includes('<b>&"\'') && nodes[0]!.description!.includes('\\u{000A}'));
 assert.equal(escapeText('plain'), 'plain');
});
test('sizes are human readable', () => {
 assert.equal(formatSize(0), '0 B'); assert.equal(formatSize(1023), '1023 B'); assert.equal(formatSize(1024), '1.0 KiB'); assert.equal(formatSize(5 * 1024 * 1024), '5.0 MiB');
 assert.equal(formatSize(150 * 1024), '150 KiB'); assert.equal(formatSize(3 * 1024 ** 3), '3.0 GiB'); assert.equal(formatSize(2048 * 1024 ** 4), '2048 TiB');
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
