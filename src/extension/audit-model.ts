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
// One short reason per group, kept to 40 characters so the sidebar does not truncate it.
export const WHY: Record<Category, string> = {
 secret: 'may contain passwords or keys', database: 'large, may contain real data', archive: 'large compressed files', log: 'large log files',
 data: 'large data files', build: 'generated, rarely needed', dependency: 'third-party code, very large', large: 'very large file',
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
export const NOT_LISTED = 'Kiro IDE only uses .kiroignore when it is listed in Agent Ignore Files. Click to open that setting.';
export const GLOBAL_RULES_NOTE = "Only this folder's ignore files were checked, not global ones.";
export const KIROIGNORE_HEADER = '# Suggested by Cyclegauge - review before saving';
export const MAX_DISMISSED = 2000;

export function formatSize(bytes: number): string {
 if (bytes < 1024) return `${bytes} B`;
 const units = ['KiB', 'MiB', 'GiB', 'TiB'];
 let v = bytes / 1024, i = 0;
 while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
 return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Total size for the audit: 1024-based B, KiB, MiB and GiB (the same units as the per-file tooltip), whole KiB and one decimal from MiB up. */
export function formatBytes(bytes: number): string {
 const KIB = 1024, MIB = KIB * KIB, GIB = MIB * KIB;
 if (bytes < KIB) return `${Math.floor(bytes)} B`;
 const kib = Math.round(bytes / KIB);
 if (kib < KIB) return `${kib} KiB`;
 const mib = Math.round(bytes / MIB * 10) / 10;
 if (mib < KIB) return `${mib.toFixed(1)} MiB`;
 return `${(bytes / GIB).toFixed(1)} GiB`;
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

/** Count wording shared by the sidebar, the messages and the dashboard card: `items` are known not excluded, `unclear` could not be established. `size` (e.g. "about 240.3 MB") goes after "Kiro may read". */
export function countsText(items: number, unclear: number, size = ''): string {
 const n = (k: number): string => `${k} ${k === 1 ? 'item' : 'items'}`;
 return items > 0 ? `${n(items)} Kiro may read${size ? ` (${size})` : ''}${unclear > 0 ? ` · ${unclear} unclear` : ''}` : unclear > 0 ? `${n(unclear)} to review` : 'No risky files found';
}
/** Items Kiro may read (coverage not_covered, listed) and unclear ones (coverage unknown, plus those beyond the listed maximum). */
export const countFindings = (findings: readonly Pick<Finding, 'coverage'>[], omitted: number): { items: number; unclear: number } =>
 ({ items: findings.filter(f => f.coverage === 'not_covered').length, unclear: findings.filter(f => f.coverage === 'unknown').length + omitted });

/**
 * Total size of the findings Kiro may read (coverage not_covered) that the caller passes, which should be the visible (not hidden) ones.
 * A finding inside another counted directory finding is skipped, because an aggregate (dist, Pods, a bundle) already includes its size.
 * `lowerBound` is true when a counted finding has no size (pruned folders) or the result omitted items beyond the listed maximum,
 * so `bytes` is then only a minimum.
 */
export const auditSizeTotal = (findings: readonly Pick<Finding, 'coverage' | 'size' | 'path' | 'isDir'>[], omitted = 0): { bytes: number; lowerBound: boolean } => {
 const counted = findings.filter(f => f.coverage === 'not_covered');
 const dirs = counted.filter(f => f.isDir).map(f => `${f.path}/`);
 let bytes = 0, lowerBound = omitted > 0;
 for (const f of counted) {
  if (dirs.some(d => f.path.startsWith(d))) continue;
  if (f.size === undefined) lowerBound = true; else bytes += f.size;
 }
 return { bytes, lowerBound };
};
/** "about 240.3 MiB" for an exact total, "at least 240.3 MiB" for a lower bound. '' when nothing sized is counted (bytes 0), so no "at least 0 B". */
export function sizePhrase(total: { bytes: number; lowerBound: boolean }): string {
 if (total.bytes === 0) return '';
 return `${total.lowerBound ? 'at least' : 'about'} ${formatBytes(total.bytes)}`;
}

/** What the credit dashboard may know about the audit: counts, times and a size total, never a path or folder name. */
export interface AuditSummary { state: 'never' | 'checked' | 'unavailable'; items?: number; unclear?: number; bytes?: number; lowerBound?: boolean; checkedAt?: string; lastDate?: string }

/**
 * Plain wording for how long ago `checkedAt` (an ISO time) was, by local calendar day: just now, N min ago, today, yesterday, N days ago.
 * An unreadable time or a time in the future gives ''.
 */
export function relativeTime(checkedAt: string | undefined, now: Date): string {
 const then = checkedAt === undefined ? NaN : Date.parse(checkedAt), nowMs = now.getTime();
 if (!Number.isFinite(then) || !Number.isFinite(nowMs) || then > nowMs + 60_000) return '';
 const minutes = Math.floor(Math.max(0, nowMs - then) / 60_000);
 if (minutes < 1) return 'just now';
 if (minutes < 60) return `${minutes} min ago`;
 const day = (ms: number): number => { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000; };
 const days = Math.round(day(nowMs) - day(then));
 if (days <= 0) return 'today';
 return days === 1 ? 'yesterday' : `${days} days ago`;
}

const STATUS_TEXT = { not_covered: 'Kiro may read this', unknown: 'Unclear' } as const;
const STATUS_MEANING = { not_covered: 'No ignore file in this folder excludes it. Global ignore files were not checked.' } as const;
// Why coverage could not be established, in plain words, from what the result itself says.
function unclearReason(result: AuditResult): string {
 if (result.ignore === 'setting_unknown') return 'the Agent Ignore Files setting could not be read';
 if (result.reasons.includes('evaluation_time_limit')) return 'checking the ignore files stopped at the time limit';
 if (result.reasons.includes('ignore_file_limit') || result.reasons.includes('ignore_rule_limit')) return 'some ignore files or rules could not be used';
 return 'the ignore rules could not be fully checked';
}

function findingNode(f: Finding, index: number, accepted: ReadonlySet<string>, reason: string): AuditNode {
 const key = findingKey(f), done = accepted.has(key);
 const label = escapeText(f.path) + (f.isDir ? '/' : '');
 const description = STATUS_TEXT[f.coverage] + (done ? ' · rule prepared (unsaved)' : '');
 const tooltip = [label, `${LABELS[f.category]}: ${EXPLANATIONS[f.category]}`,
  f.coverage === 'unknown' ? `Cyclegauge could not tell whether it is excluded: ${reason}.` : STATUS_MEANING[f.coverage],
  ...(f.size === undefined ? [] : [`Size: ${formatSize(f.size)}`]),
  f.suggestion === '' ? 'No safe rule could be suggested.' : `Suggested rule: ${escapeText(f.suggestion)}`, ...(done ? ['The rule is prepared but not saved.'] : [])].join('\n');
 return { id: `finding:${f.category}:${index}`, kind: 'finding', label, description, tooltip, icon: ICONS[f.category], contextValue: f.suggestion === '' ? 'finding' : 'finding-suggestible', finding: f };
}

/**
 * Builds the sidebar tree. `dismissedHashes` are the stored hashes, `hashFn` maps a finding to the same kind of hash and
 * `accepted` holds findingKey values of findings whose change is prepared but unsaved. `checkedAt` is the in-memory time of the run.
 */
export function auditTree(result: AuditResult, folderName: string, dismissedHashes: Iterable<string>, hashFn: (category: string, path: string) => string, accepted: ReadonlySet<string> = new Set(), checkedAt?: string, now: Date = new Date()): AuditNode[] {
 const dismissed = new Set(dismissedHashes);
 const nodes: AuditNode[] = [];
 const name = escapeText(folderName);
 if (result.status === 'unavailable') {
  const message = UNAVAILABLE[result.code ?? ''] ?? 'The folder could not be audited.';
  return [{ id: 'header', kind: 'header', label: message, description: name, tooltip: message, icon: 'warning', contextValue: 'header' }];
 }
 const reasons = result.reasons.map(r => REASONS[r] ?? r.replaceAll('_', ' '));
 const c = result.counts, partial = result.status === 'partial';
 // Ids are opaque (category and position in the result), so no path ever appears in one.
 const indexed = result.findings.map((f, i) => ({ f, i })).filter(x => !dismissed.has(hashFn(x.f.category, x.f.path)));
 const visible = indexed.map(x => x.f);
 const hidden = result.findings.length - visible.length;
 const { items, unclear } = countFindings(visible, result.omitted), total = items + unclear;
 const size = sizePhrase(auditSizeTotal(visible, result.omitted));
 const ago = relativeTime(checkedAt, now);
 const summary = `${c.files} files and ${c.dirs} folders scanned; ${c.ignored} ignored, ${c.unknown} with unknown coverage, ${c.symlinks} symbolic links skipped, ${c.unreadable} unreadable.`;
 nodes.push({
  id: 'header', kind: 'header', label: countsText(items, unclear),
  description: [name, ...(ago ? [`checked ${ago}`] : []), ...(partial ? ['partial check'] : []), ...(size ? [size] : [])].join(' · '),
  tooltip: [items > 0 ? 'These files are in your workspace and not excluded by its ignore files. Excluding the ones Kiro does not need keeps its context smaller and can save credits. Being listed does not mean Kiro has read them.'
    : unclear > 0 ? 'Cyclegauge could not tell whether these are excluded by the ignore files. Review them: excluding the ones Kiro does not need keeps its context smaller. Being listed does not mean Kiro has read them.'
    : `No files matching these kinds by name or size were found. This does not prove there are no secrets.${hidden > 0 ? ' Items you hid are not counted.' : ''}`, GLOBAL_RULES_NOTE,
   ...(size ? [`Total size of the files Kiro may read but probably doesn't need.${auditSizeTotal(visible, result.omitted).lowerBound ? ' Some of them have no size, or the list is cut short, so the total is a lower bound.' : ''}`] : []),
   ...(partial ? ['The check is partial, so results may be incomplete:', ...(reasons.length ? reasons.map(r => `- ${escapeText(r)}`) : ['- Some results may be missing.'])] : []), summary].join('\n'),
  icon: partial ? 'warning' : total > 0 ? 'eye' : 'pass', contextValue: 'header',
 });
 if (result.ignore === 'disabled') nodes.push({ id: 'info:disabled', kind: 'info', label: 'Workspace ignore files are turned off', tooltip: 'kiroAgent.agentIgnoreFiles is empty, so no workspace ignore file applies.', icon: 'info', contextValue: 'info' });
 if (result.ignore === 'setting_unknown') nodes.push({ id: 'info:setting_unknown', kind: 'info', label: "Couldn't read the Agent Ignore Files setting", description: 'Coverage unknown', tooltip: 'The kiroAgent.agentIgnoreFiles value could not be interpreted, so every coverage is unknown.', icon: 'info', contextValue: 'info' });
 if (result.kiroignoreNotListed) nodes.push({ id: 'info:not_listed', kind: 'info', label: ".kiroignore isn't active yet", description: 'open setting', tooltip: NOT_LISTED, icon: 'gear', contextValue: 'info-action', action: 'openIgnoreSetting' });
 const reason = unclearReason(result);
 for (const category of CATEGORY_ORDER) {
  const rows = indexed.filter(x => x.f.category === category);
  if (rows.length === 0) continue;
  nodes.push({ id: category, kind: 'group', label: `${LABELS[category]} (${rows.length})`, description: WHY[category], tooltip: EXPLANATIONS[category], icon: ICONS[category], contextValue: 'group', children: rows.map(x => findingNode(x.f, x.i, accepted, reason)) });
 }
 if (hidden > 0) nodes.push({ id: 'footer:dismissed', kind: 'footer', label: `${hidden} hidden by you`, description: 'Show again', tooltip: 'These items are hidden for this workspace. Select to show them again.', icon: 'eye-closed', contextValue: 'footer-action', action: 'clearDismissed' });
 if (result.omitted > 0) nodes.push({ id: 'footer:omitted', kind: 'footer', label: `${result.omitted} more not shown`, tooltip: 'Only the first 200 items are listed; the rest are counted.', icon: 'ellipsis', contextValue: 'footer' });
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
