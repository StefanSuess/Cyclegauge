import type { AuditResult, Category, Finding } from '../audit/audit.ts';
import { CATEGORY_ORDER } from '../audit/audit.ts';
import { escapeHtml } from './labels.ts';

// Paths come from the user's workspace and are untrusted text: escape markup, and make control and invisible/bidi
// formatting characters visible instead of letting them reorder or hide what the user reads.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
const text = (s: string) => escapeHtml(s.replace(HIDDEN, c => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}}`));
const LABELS: Record<Category, string> = {
 secret: 'Secrets and credentials', database: 'Databases and dumps', archive: 'Archives', log: 'Logs', data: 'Large data files',
 build: 'Build output', dependency: 'Dependencies', large: 'Other large files',
};
const UNAVAILABLE: Record<string, string> = {
 root_invalid: 'The folder is not a usable local directory.',
 root_symlink: 'The folder is a symbolic link, which is not followed.',
 root_unreadable: 'The folder could not be read.',
};
const REASONS: Record<string, string> = {
 entry_limit: 'Too many files: the scan stopped at its entry limit.',
 depth_limit: 'Some deeply nested folders were not entered.',
 time_limit: 'The scan stopped at its time limit.',
 cancelled: 'The audit was cancelled.',
 evaluation_time_limit: 'Checking against ignore files stopped at the time limit, so remaining paths show as unknown.',
 ignore_file_limit: 'There are more ignore files than can be read, so some were not checked.',
 ignore_rule_limit: 'The ignore files contain more rules than can be checked, so some were not used.',
};
const IGNORE_TEXT = (r: AuditResult) =>
 r.ignore === 'evaluated' ? `Checked against workspace ignore files (${r.counts.ignoreFiles} found${r.counts.ignoreFilesUnavailable > 0 ? `, ${r.counts.ignoreFilesUnavailable} could not be read` : ''})`
 : r.ignore === 'disabled' ? 'Workspace ignore files are disabled (kiroAgent.agentIgnoreFiles is empty)'
 : 'Could not read the Agent Ignore Files setting — coverage unknown';
const NOT_LISTED = 'A .kiroignore file exists, but Agent Ignore Files (kiroAgent.agentIgnoreFiles) does not list it, so Kiro IDE does not use it. Add &quot;.kiroignore&quot; to that setting.';
export function formatSize(bytes: number): string {
 if (bytes < 1024) return `${bytes} B`;
 const units = ['KiB', 'MiB', 'GiB', 'TiB'];
 let v = bytes / 1024, i = 0;
 while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
 return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}
const row = (f: Finding) =>
 `<tr><td>${text(f.path)}${f.isDir ? '/' : ''}</td><td>${f.size === undefined ? 'Unknown' : formatSize(f.size)}</td><td>${f.coverage === 'not_covered' ? 'Not covered by workspace ignore files' : 'Unknown'}</td><td>${f.suggestion === '' ? 'No safe suggestion' : `<code>${text(f.suggestion)}</code>`}</td></tr>`;
const group = (category: Category, findings: Finding[]) => {
 const rows = findings.filter(f => f.category === category);
 return rows.length === 0 ? '' : `<h3>${LABELS[category]} (${rows.length})</h3><table><thead><tr><th scope="col">Path</th><th scope="col">Size</th><th scope="col">Coverage</th><th scope="col">Suggestion</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
};
export function presentAudit(result: AuditResult): string {
 const c = result.counts;
 const status = result.status === 'unavailable'
  ? `<p><strong>Unavailable.</strong> ${escapeHtml(UNAVAILABLE[result.code ?? ''] ?? 'The folder could not be audited.')}</p>`
  : result.status === 'complete' ? '<p><strong>Complete.</strong></p>'
  : `<p><strong>Partial.</strong> Results may be incomplete.</p><ul>${result.reasons.map(r => `<li>${text(REASONS[r] ?? r.replaceAll('_', ' '))}</li>`).join('')}</ul>`;
 const summary = result.status === 'unavailable' ? '' : `<p>${c.files} files and ${c.dirs} folders scanned; ${c.ignored} ignored, ${c.unknown} with unknown coverage, ${c.symlinks} symbolic links skipped, ${c.unreadable} unreadable. ${result.findings.length + result.omitted} findings.</p>`;
 const findings = result.status === 'unavailable' ? '' : result.findings.length === 0 && result.omitted === 0 ? '<p>No findings.</p>'
  : CATEGORY_ORDER.map(cat => group(cat, result.findings)).join('') + (result.omitted > 0 ? `<p>${result.omitted} more findings are not listed.</p>` : '');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workspace audit</title><style>
body{font-family:var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);padding:1em 1.5em;line-height:1.5}
table{border-collapse:collapse;width:100%;margin-bottom:1em}th,td{text-align:left;padding:.25em .6em;border-bottom:1px solid var(--vscode-panel-border,#8884);vertical-align:top;overflow-wrap:anywhere}
code{font-family:var(--vscode-editor-font-family,monospace)}
</style></head><body><h1>Workspace audit</h1>${status}${summary}
<p>${escapeHtml(IGNORE_TEXT(result))}</p>${result.kiroignoreNotListed ? `<p>${NOT_LISTED}</p>` : ''}
<p>Not covered means no workspace ignore file excludes it. Global ignore files were not checked. Being in the workspace does not mean Kiro read the file or used credits.</p>
${findings}
<h2>How to use</h2>
<p>Run <strong>Cyclegauge: Audit Kiro Workspace</strong> again and choose <strong>Copy suggestions</strong>; review the lines, then add them to <code>.kiroignore</code> (and make sure <code>.kiroignore</code> is listed in Agent Ignore Files). Ignoring files can stop Kiro from using them when you need them.</p>
</body></html>`;
}
