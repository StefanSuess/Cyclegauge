import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import type { AuditResult, Category, Finding } from '../audit/audit.ts';
import { CATEGORY_ORDER } from '../audit/audit.ts';
import { inside } from '../paths.ts';

// Vscode-free model of the "Kiro Workspace Audit" sidebar. Paths come from the user's workspace and are untrusted text:
// control and invisible/bidi formatting characters are made visible instead of reordering or hiding what the user reads.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
export const escapeText = (s: string): string => s.replace(HIDDEN, c => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}}`);

export const LABELS: Record<Category, string> = {
 secret: 'Secrets and credentials', database: 'Databases and dumps', archive: 'Archives', log: 'Logs', data: 'Large data files',
 build: 'Build output', dependency: 'Dependencies', large: 'Other large files',
};
const EXPLANATIONS: Record<Category, string> = {
 secret: 'Files that commonly hold credentials or private keys.', database: 'Database files and dumps, which can hold private data.',
 archive: 'Large archives, which can hold many files.', log: 'Large log files, which can contain private details.', data: 'Large data files.',
 build: 'Generated build output.', dependency: 'Installed dependencies.', large: 'Very large files.',
};
// ThemeIcon ids.
const ICONS: Record<Category, string> = {
 secret: 'key', database: 'database', archive: 'archive', log: 'output', data: 'table', build: 'package', dependency: 'library', large: 'file-binary',
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
export const NOT_LISTED = 'A .kiroignore file exists, but Agent Ignore Files (kiroAgent.agentIgnoreFiles) does not list it, so Kiro IDE does not use it.';
export const KIROIGNORE_HEADER = '# Suggested by Cyclegauge - review before saving';
export const MAX_DISMISSED = 2000;

export function formatSize(bytes: number): string {
 if (bytes < 1024) return `${bytes} B`;
 const units = ['KiB', 'MiB', 'GiB', 'TiB'];
 let v = bytes / 1024, i = 0;
 while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
 return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export type NodeKind = 'header' | 'info' | 'group' | 'finding' | 'footer';
/** What activating (clicking) an info or footer node does; the extension glue maps it to a command. */
export type NodeAction = 'openIgnoreSetting' | 'clearDismissed';
export interface AuditNode {
 id: string; kind: NodeKind; label: string; description?: string; tooltip?: string; icon: string; contextValue: string;
 children?: AuditNode[]; finding?: Finding; action?: NodeAction;
}
/** In-memory identity of a finding within one result; never stored. */
export const findingKey = (f: Pick<Finding, 'category' | 'path'>): string => `${f.category}\0${f.path}`;
/** Salted SHA-256 of category and path: the only form in which an ignored finding is ever stored. */
export const dismissHash = (salt: string, category: string, path: string): string => createHash('sha256').update(`${salt}\0${category}\0${path}`).digest('hex');
export const isHash = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

const COVERAGE_TEXT = { not_covered: 'Not covered', unknown: 'Unknown' } as const;
const COVERAGE_MEANING = { not_covered: 'Not covered: no workspace ignore file excludes it.', unknown: 'Unknown: coverage could not be established, so it is not treated as covered or safe.' } as const;

function findingNode(f: Finding, index: number, accepted: ReadonlySet<string>): AuditNode {
 const key = findingKey(f), done = accepted.has(key);
 const label = escapeText(f.path) + (f.isDir ? '/' : '');
 const description = [COVERAGE_TEXT[f.coverage], ...(f.size === undefined ? [] : [formatSize(f.size)])].join(' · ') + (done ? ' · accepted (unsaved)' : '');
 const tooltip = [label, `${LABELS[f.category]}: ${EXPLANATIONS[f.category]}`, COVERAGE_MEANING[f.coverage],
  f.suggestion === '' ? 'No safe suggestion' : `Suggestion: ${escapeText(f.suggestion)}`, ...(done ? ['Accepted: the change is prepared but not saved.'] : [])].join('\n');
 return { id: `finding:${f.category}:${index}`, kind: 'finding', label, description, tooltip, icon: ICONS[f.category], contextValue: f.suggestion === '' ? 'finding' : 'finding-suggestible', finding: f };
}

/**
 * Builds the sidebar tree. `dismissedHashes` are the stored hashes, `hashFn` maps a finding to the same kind of hash and
 * `accepted` holds findingKey values of findings whose change is prepared but unsaved.
 */
export function auditTree(result: AuditResult, folderName: string, dismissedHashes: Iterable<string>, hashFn: (category: string, path: string) => string, accepted: ReadonlySet<string> = new Set()): AuditNode[] {
 const dismissed = new Set(dismissedHashes);
 const nodes: AuditNode[] = [];
 const name = escapeText(folderName);
 if (result.status === 'unavailable') {
  const message = UNAVAILABLE[result.code ?? ''] ?? 'The folder could not be audited.';
  return [{ id: 'header', kind: 'header', label: `Audited folder: ${name}`, description: `Unavailable: ${message}`, tooltip: message, icon: 'warning', contextValue: 'header' }];
 }
 const reasons = result.reasons.map(r => REASONS[r] ?? r.replaceAll('_', ' '));
 const c = result.counts, total = result.findings.length + result.omitted;
 const summary = `${c.files} files and ${c.dirs} folders scanned; ${c.ignored} ignored, ${c.unknown} with unknown coverage, ${c.symlinks} symbolic links skipped, ${c.unreadable} unreadable. ${total} findings.`;
 nodes.push({
  id: 'header', kind: 'header', label: `Audited folder: ${name}`,
  description: result.status === 'complete' ? 'Complete' : `Partial: ${reasons.length ? reasons.join(' ') : 'results may be incomplete.'}`,
  tooltip: [result.status === 'complete' ? 'Complete.' : 'Partial. Results may be incomplete.', ...reasons.map(r => `- ${escapeText(r)}`), summary].join('\n'),
  icon: result.status === 'complete' ? 'pass' : 'warning', contextValue: 'header',
 });
 if (result.ignore === 'disabled') nodes.push({ id: 'info:disabled', kind: 'info', label: 'Workspace ignore files are disabled', tooltip: 'kiroAgent.agentIgnoreFiles is empty, so no workspace ignore file applies.', icon: 'info', contextValue: 'info' });
 if (result.ignore === 'setting_unknown') nodes.push({ id: 'info:setting_unknown', kind: 'info', label: 'Could not read the Agent Ignore Files setting', description: 'Coverage unknown', tooltip: 'The kiroAgent.agentIgnoreFiles value could not be interpreted, so every coverage is unknown.', icon: 'info', contextValue: 'info' });
 nodes.push({ id: 'info:global', kind: 'info', label: 'Global ignore files were not checked', tooltip: 'Not covered means no workspace ignore file excludes it. Being in the workspace does not mean Kiro read the file or used credits.', icon: 'info', contextValue: 'info' });
 if (result.kiroignoreNotListed) nodes.push({ id: 'info:not_listed', kind: 'info', label: '.kiroignore is not listed in Agent Ignore Files', description: 'Open Agent Ignore Files setting', tooltip: `${NOT_LISTED} Select to open the setting; Cyclegauge never changes settings itself.`, icon: 'gear', contextValue: 'info-action', action: 'openIgnoreSetting' });
 // Ids are opaque (category and position in the result), so no path ever appears in one.
 const indexed = result.findings.map((f, i) => ({ f, i })).filter(x => !dismissed.has(hashFn(x.f.category, x.f.path)));
 const visible = indexed.map(x => x.f);
 const hidden = result.findings.length - visible.length;
 for (const category of CATEGORY_ORDER) {
  const rows = indexed.filter(x => x.f.category === category);
  if (rows.length === 0) continue;
  nodes.push({ id: category, kind: 'group', label: `${LABELS[category]} (${rows.length})`, tooltip: EXPLANATIONS[category], icon: ICONS[category], contextValue: 'group', children: rows.map(x => findingNode(x.f, x.i, accepted)) });
 }
 if (visible.length === 0 && hidden === 0 && result.omitted === 0) nodes.push({ id: 'info:none', kind: 'info', label: 'No findings', icon: 'check', contextValue: 'info' });
 if (hidden > 0) nodes.push({ id: 'footer:dismissed', kind: 'footer', label: `${hidden} ignored by you`, description: 'Show ignored again', tooltip: 'These findings are hidden for this workspace. Select to show them again.', icon: 'eye-closed', contextValue: 'footer-action', action: 'clearDismissed' });
 if (result.omitted > 0) nodes.push({ id: 'footer:omitted', kind: 'footer', label: `${result.omitted} more not shown`, tooltip: 'Only the first 200 findings are listed; the rest are counted.', icon: 'ellipsis', contextValue: 'footer' });
 return nodes;
}

/** Findings of a tree (or result) that are not dismissed, in display order. */
export function visibleFindings(result: AuditResult, dismissedHashes: Iterable<string>, hashFn: (category: string, path: string) => string): Finding[] {
 const dismissed = new Set(dismissedHashes);
 return result.findings.filter(f => !dismissed.has(hashFn(f.category, f.path)));
}

/**
 * Text to insert at the end of an existing .kiroignore (`existing` given), or the full text of a new file (`undefined`).
 * Lines already present are skipped, the header is written once and the file's line ending is kept. '' means nothing to add.
 */
export function kiroignoreAppend(existing: string | undefined, lines: string[]): string {
 const eol = existing?.includes('\r\n') ? '\r\n' : '\n';
 const present = new Set((existing ?? '').split(/\r?\n/));
 const add = [...new Set(lines.filter(l => l !== ''))].filter(l => !present.has(l));
 if (add.length === 0) return '';
 const header = present.has(KIROIGNORE_HEADER) ? [] : [KIROIGNORE_HEADER];
 const lead = existing !== undefined && existing !== '' && !existing.endsWith('\n') ? eol : '';
 return lead + [...header, ...add].join(eol) + eol;
}

export interface RevealTarget { kind: 'reveal' | 'refuse'; path: string }
/**
 * Where to show a finding in the Explorer. Never opens an editor tab. Refuses anything that could leave the audited root:
 * `..` segments, absolute paths and, on Windows, backslashes and drive or stream colons. Paths use `/` only.
 */
export function revealTarget(root: string, finding: Pick<Finding, 'path'>, platform: string = process.platform): RevealTarget {
 const refuse: RevealTarget = { kind: 'refuse', path: '' };
 if (root === '' || finding.path === '' || finding.path.includes('\0') || isAbsolute(finding.path) || (platform === 'win32' && /[\\:]/.test(finding.path))) return refuse;
 const segments = finding.path.split('/');
 if (segments.includes('..')) return refuse;
 const path = resolve(root, ...segments);
 if (path === resolve(root) || !inside(path, root)) return refuse;
 return { kind: 'reveal', path };
}
