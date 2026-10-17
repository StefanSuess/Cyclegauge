import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { auditTree, dismissHash, escapeText, findingKey, formatSize, kiroignoreAppend, revealTarget, visibleFindings, KIROIGNORE_HEADER, type AuditNode } from '../../src/extension/audit-model.ts';
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

test('groups follow the category order, show counts and are expanded by the glue; only non-empty groups appear', () => {
 const nodes = tree(mixed());
 assert.deepEqual(nodes.filter(n => n.kind === 'group').map(n => n.label), ['Secrets and credentials (1)', 'Databases and dumps (1)', 'Build output (1)', 'Dependencies (1)']);
 assert.deepEqual(nodes.map(n => n.kind), ['header', 'info', 'group', 'group', 'group', 'group']);
 const dist = flat(nodes).find(n => n.label === 'dist/')!;
 assert.equal(dist.description, 'Unknown · 2.0 KiB'); assert.equal(dist.kind, 'finding'); assert.equal(dist.contextValue, 'finding-suggestible');
 assert.equal(flat(nodes).find(n => n.label === 'synthetic.pem')!.description, 'Not covered · 10 B');
 assert.equal(flat(nodes).find(n => n.label === 'node_modules/')!.description, 'Not covered');
 const ids = flat(nodes).map(n => n.id); assert.equal(new Set(ids).size, ids.length);
 for (const n of flat(nodes)) { assert.ok(n.icon.length > 0); assert.ok(n.contextValue.length > 0); }
 assert.ok(nodes.every(n => n.kind !== 'group' || (n.children?.length ?? 0) > 0));
});
test('tooltip explains category, coverage and the suggestion in plain text', () => {
 const n = flat(tree(result())).find(x => x.kind === 'finding')!;
 assert.ok(n.tooltip!.includes('Secrets and credentials: Files that commonly hold credentials')); assert.ok(n.tooltip!.includes('Not covered: no workspace ignore file excludes it.'));
 assert.ok(n.tooltip!.includes('Suggestion: /synthetic.pem'));
 const none = flat(tree(result({ findings: [finding({ suggestion: '' })] }))).find(x => x.kind === 'finding')!;
 assert.ok(none.tooltip!.includes('No safe suggestion')); assert.equal(none.contextValue, 'finding');
 assert.ok(flat(tree(result({ findings: [finding({ coverage: 'unknown' })] }))).find(x => x.kind === 'finding')!.tooltip!.includes('Unknown: coverage could not be established'));
});
test('header shows folder and status; partial lists reasons in plain words; unavailable stops there', () => {
 const header = (r: AuditResult) => tree(r)[0]!;
 assert.equal(header(result()).label, 'Audited folder: synthetic-folder'); assert.equal(header(result()).description, 'Complete');
 const partial = header(result({ status: 'partial', reasons: ['entry_limit', 'evaluation_time_limit', 'ignore_file_limit', 'ignore_rule_limit', 'depth_limit', 'time_limit', 'cancelled', 'synthetic_new_reason'] }));
 assert.ok(partial.description!.startsWith('Partial: ')); for (const text of ['entry limit', 'show as unknown', 'more ignore files than can be read', 'more rules than can be checked', 'deeply nested', 'time limit', 'cancelled', 'synthetic new reason']) assert.ok(partial.description!.includes(text), text);
 assert.ok(partial.tooltip!.includes('12 files and 3 folders scanned; 2 ignored, 1 with unknown coverage, 1 symbolic links skipped, 0 unreadable. 1 findings.'));
 assert.equal(header(result({ status: 'partial' })).description, 'Partial: results may be incomplete.');
 for (const [code, text] of [['root_invalid', 'not a usable local directory'], ['root_symlink', 'symbolic link'], ['root_unreadable', 'could not be read']] as const) {
  const nodes = tree(result({ status: 'unavailable', code, findings: [] })); assert.equal(nodes.length, 1); assert.ok(nodes[0]!.description!.startsWith('Unavailable: ')); assert.ok(nodes[0]!.description!.includes(text), code);
 }
 assert.ok(tree(result({ status: 'unavailable', findings: [] }))[0]!.description!.includes('could not be audited'));
});
test('info items: global note always, ignore-mode notes and the .kiroignore action', () => {
 const infos = (r: AuditResult) => tree(r).filter(n => n.kind === 'info');
 assert.deepEqual(infos(result()).map(n => n.label), ['Global ignore files were not checked']);
 assert.deepEqual(infos(result({ ignore: 'disabled' })).map(n => n.label), ['Workspace ignore files are disabled', 'Global ignore files were not checked']);
 assert.deepEqual(infos(result({ ignore: 'setting_unknown' })).map(n => n.label), ['Could not read the Agent Ignore Files setting', 'Global ignore files were not checked']);
 const note = infos(result({ kiroignoreNotListed: true })).find(n => n.action)!;
 assert.equal(note.action, 'openIgnoreSetting'); assert.equal(note.description, 'Open Agent Ignore Files setting'); assert.ok(note.tooltip!.includes('does not list it'));
 assert.ok(!infos(result()).some(n => n.action));
});
test('no findings says so; omitted findings get a footer', () => {
 assert.ok(tree(result({ findings: [] })).some(n => n.label === 'No findings'));
 const nodes = tree(result({ omitted: 4 })); const footer = nodes.at(-1)!;
 assert.equal(footer.kind, 'footer'); assert.equal(footer.label, '4 more not shown'); assert.ok(!nodes.some(n => n.label === 'No findings'));
 assert.ok(!tree(result({ findings: [], omitted: 4 })).some(n => n.label === 'No findings'));
});
test('ignored findings are filtered, counted and can be shown again; accepted ones are marked', () => {
 const r = mixed(), pem = r.findings[0]!;
 const nodes = tree(r, [hashFn(pem.category, pem.path)]);
 assert.ok(!flat(nodes).some(n => n.label === 'synthetic.pem')); assert.ok(!nodes.some(n => n.id === 'secret'));
 const footer = nodes.at(-1)!; assert.equal(footer.label, '1 ignored by you'); assert.equal(footer.description, 'Show ignored again'); assert.equal(footer.action, 'clearDismissed');
 assert.ok(!tree(r).some(n => n.action === 'clearDismissed'));
 assert.ok(!tree(result(), [hashFn('secret', 'synthetic.pem')]).some(n => n.label === 'No findings'));
 assert.deepEqual(visibleFindings(r, [hashFn(pem.category, pem.path)], hashFn).map(f => f.path), ['dist', 'node_modules', 'b.sql']);
 const marked = flat(tree(r, [], [findingKey(pem)])); assert.equal(marked.find(n => n.label === 'synthetic.pem')!.description, 'Not covered · 10 B · accepted (unsaved)');
 assert.equal(marked.find(n => n.label === 'dist/')!.description, 'Unknown · 2.0 KiB');
});
test('paths, folder names and tooltips make control, bidi, format and tag characters visible', () => {
 const nasty = `<b>&"'\n\u0000\u007f​‏‮⁦⁩﻿؜  ­${String.fromCodePoint(0xe0041)}end`;
 const nodes = tree(result({ findings: [finding({ path: nasty, suggestion: '/safe' })] }), [], [], nasty);
 const strings = flat(nodes).flatMap(n => [n.label, n.description ?? '', n.tooltip ?? '']).join('\n');
 assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(strings.replace(/\n/g, '')));
 for (const code of ['000A', '0000', '007F', '200B', '200F', '202E', '2066', '2069', 'FEFF', '061C', '2028', '2029', '00AD', 'E0041']) assert.ok(strings.includes(`\\u{${code}}`), code);
 assert.ok(nodes[0]!.label.includes('<b>&"\''));
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
