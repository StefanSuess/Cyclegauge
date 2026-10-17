import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentAudit, formatSize } from '../../src/extension/audit-presentation.ts';
import type { AuditResult, Finding } from '../../src/audit/audit.ts';

const counts = { files: 12, dirs: 3, ignored: 2, ignoreFiles: 2, ignoreFilesUnavailable: 0, symlinks: 1, unreadable: 0, unknown: 1 };
const finding = (over: Partial<Finding> = {}): Finding => ({ path: 'synthetic.pem', isDir: false, category: 'secret', coverage: 'not_covered', suggestion: '/synthetic.pem', size: 10, ...over });
const noSize = (f: Finding): Finding => { delete f.size; return f; };
const result = (over: Partial<AuditResult> = {}): AuditResult => ({ status: 'complete', ignore: 'evaluated', findings: [finding()], omitted: 0, counts, reasons: [], ...over });

test('document has the strict policy, no scripts and no links', () => {
 const html = presentAudit(result());
 assert.match(html, /^<!doctype html>/);
 assert.ok(html.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`));
 assert.ok(!/<script/i.test(html)); assert.ok(!/href|src=|<a[ >]|<img|<iframe|<link|\son\w+=/i.test(html));
 assert.match(html, /<title>Workspace audit<\/title>/); assert.match(html, /<h1>Workspace audit<\/h1>/);
 assert.ok(html.includes('Not covered means no workspace ignore file excludes it. Global ignore files were not checked. Being in the workspace does not mean Kiro read the file or used credits.'));
 assert.ok(html.includes('Run <strong>Cyclegauge: Audit Kiro Workspace</strong> again and choose <strong>Copy suggestions</strong>'));
 assert.ok(html.includes('Ignoring files can stop Kiro from using them when you need them.')); assert.ok(html.includes('make sure <code>.kiroignore</code> is listed in Agent Ignore Files'));
});
test('summary, findings table, coverage wording and suggestion code', () => {
 const html = presentAudit(result({ findings: [finding(), finding({ path: 'dist', isDir: true, category: 'build', size: 2048, suggestion: '/dist/', coverage: 'unknown' }), noSize(finding({ path: 'node_modules', isDir: true, category: 'dependency', suggestion: '/node_modules/' }))], omitted: 4 }));
 assert.ok(html.includes('12 files and 3 folders scanned; 2 ignored, 1 with unknown coverage, 1 symbolic links skipped, 0 unreadable. 7 findings.'));
 assert.ok(html.includes('<h3>Secrets and credentials (1)</h3>')); assert.ok(html.includes('<h3>Build output (1)</h3>')); assert.ok(html.includes('<h3>Dependencies (1)</h3>'));
 assert.ok(html.includes('<td>dist/</td><td>2.0 KiB</td><td>Unknown</td><td><code>/dist/</code></td>'));
 assert.ok(html.includes('<td>synthetic.pem</td><td>10 B</td><td>Not covered by workspace ignore files</td><td><code>/synthetic.pem</code></td>'));
 assert.ok(html.includes('<td>node_modules/</td><td>Unknown</td>')); assert.ok(html.includes('4 more findings are not listed.'));
 assert.ok(presentAudit(result({ findings: [] })).includes('No findings.')); assert.ok(!presentAudit(result({ findings: [] })).includes('<table'));
});
test('ignore status wording for each mode', () => {
 assert.ok(presentAudit(result()).includes('Checked against workspace ignore files (2 found)'));
 assert.ok(presentAudit(result({ counts: { ...counts, ignoreFiles: 1, ignoreFilesUnavailable: 2 } })).includes('(1 found, 2 could not be read)'));
 assert.ok(presentAudit(result({ ignore: 'disabled' })).includes('Workspace ignore files are disabled (kiroAgent.agentIgnoreFiles is empty)'));
 assert.ok(presentAudit(result({ ignore: 'setting_unknown' })).includes('Could not read the Agent Ignore Files setting — coverage unknown'));
});
test('status messages: complete, partial reasons and each unavailable code', () => {
 assert.ok(presentAudit(result()).includes('<strong>Complete.</strong>'));
 const partial = presentAudit(result({ status: 'partial', reasons: ['entry_limit', 'evaluation_time_limit', 'ignore_file_limit', 'depth_limit', 'time_limit', 'cancelled', 'synthetic_new_reason'] }));
 assert.ok(partial.includes('<strong>Partial.</strong>')); for (const text of ['entry limit', 'time limit, so remaining paths show as unknown', 'more ignore files than can be read', 'deeply nested', 'cancelled', 'synthetic new reason']) assert.ok(partial.includes(text), text);
 for (const [code, text] of [['root_invalid', 'not a usable local directory'], ['root_symlink', 'symbolic link'], ['root_unreadable', 'could not be read']] as const) {
  const html = presentAudit(result({ status: 'unavailable', code, findings: [] })); assert.ok(html.includes('<strong>Unavailable.</strong>')); assert.ok(html.includes(text), code); assert.ok(!html.includes('<table')); assert.ok(!html.includes('files and'));
 }
 assert.ok(presentAudit(result({ status: 'unavailable', findings: [] })).includes('could not be audited'));
});
test('paths are escaped and control or bidi characters are made visible', () => {
 const nasty = '<img src=x onerror=1>&"\'\n\u0000\u007f\u200b\u200f\u202e\u2066\u2069\ufeffend';
 const html = presentAudit(result({ findings: [finding({ path: nasty, suggestion: `/${nasty}` })] }));
 assert.ok(html.includes('&lt;img src=x onerror=1&gt;&amp;&quot;&#39;'));
 assert.ok(!html.includes('<img')); assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(html));
 for (const code of ['000A', '0000', '007F', '200B', '200F', '202E', '2066', '2069', 'FEFF']) assert.ok(html.includes(`\\u{${code}}`), code);
 assert.ok(html.includes('<td>&lt;img') && html.includes('<code>/&lt;img'));
});
test('sizes are human readable', () => {
 assert.equal(formatSize(0), '0 B'); assert.equal(formatSize(1023), '1023 B'); assert.equal(formatSize(1024), '1.0 KiB'); assert.equal(formatSize(5 * 1024 * 1024), '5.0 MiB');
 assert.equal(formatSize(150 * 1024), '150 KiB'); assert.equal(formatSize(3 * 1024 ** 3), '3.0 GiB'); assert.equal(formatSize(2048 * 1024 ** 4), '2048 TiB');
});
test('format, separator and tag characters are made visible too', () => {
 const nasty = `synthetic\u061cmark\u2028sep\u2029par\u00adsoft${String.fromCodePoint(0xe0041)}tag`;
 const html = presentAudit(result({ findings: [finding({ path: nasty, suggestion: '' })] }));
 for (const code of ['061C', '2028', '2029', '00AD', 'E0041']) assert.ok(html.includes(`\\u{${code}}`), code);
 assert.ok(!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(html.replace(/[\n]/g, '')));
});
test('findings without a safe suggestion say so instead of showing a rule', () => {
 const html = presentAudit(result({ findings: [finding({ suggestion: '' })] }));
 assert.ok(html.includes('<td>No safe suggestion</td>')); assert.ok(!html.includes('<code></code>'));
});
test('a .kiroignore the setting does not list is explained, and only then', () => {
 const note = 'A .kiroignore file exists, but Agent Ignore Files (kiroAgent.agentIgnoreFiles) does not list it, so Kiro IDE does not use it. Add &quot;.kiroignore&quot; to that setting.';
 assert.ok(presentAudit(result({ kiroignoreNotListed: true })).includes(note)); assert.ok(!presentAudit(result()).includes('does not list it'));
 assert.ok(presentAudit(result({ status: 'partial', reasons: ['ignore_rule_limit'] })).includes('more rules than can be checked'));
});
