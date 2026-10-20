import { walkWorkspace, DEFAULT_LIMITS, type WalkFs, type WalkLimits } from './walk.ts';
import { evaluate, parseIgnore, type Coverage, type IgnoreSource } from './ignore.ts';
import { readIgnoreFile, validIgnoreNames, READ_LIMITS, type ReadFs } from './read-ignore.ts';
// Orchestrates one audit: bounded metadata walk, safe reads of the workspace ignore files named by the setting, coverage
// evaluation and findings. Pure Node; results hold only root-relative paths, sizes, fixed codes and counts.
export type Category = 'secret' | 'database' | 'archive' | 'log' | 'data' | 'build' | 'dependency' | 'large';
export interface Finding { path: string; isDir: boolean; category: Category; size?: number; coverage: 'not_covered' | 'unknown'; suggestion: string }
export interface AuditResult {
 status: 'complete' | 'partial' | 'unavailable';
 code?: 'root_invalid' | 'root_symlink' | 'root_unreadable';
 ignore: 'evaluated' | 'disabled' | 'setting_unknown'; // setting_unknown: value missing/invalid, so every coverage is unknown
 findings: Finding[]; omitted: number; // findings beyond MAX_FINDINGS are counted, not listed
 // files/dirs/symlinks/unreadable come from the walk; ignored/unknown count walked files and pruned directories by coverage.
 counts: { files: number; dirs: number; ignored: number; ignoreFiles: number; ignoreFilesUnavailable: number; symlinks: number; unreadable: number; unknown: number };
 reasons: string[]; // walker reasons plus 'evaluation_time_limit' | 'ignore_file_limit' | 'ignore_rule_limit'
 kiroignoreNotListed?: true; // a .kiroignore file exists but kiroAgent.agentIgnoreFiles does not list it
}
export const MAX_FINDINGS = 200;
export const MAX_TOTAL_RULES = 20_000; // across all ignore files; sources beyond it are unavailable
const YIELD_MS = 30;
export const CATEGORY_ORDER: Category[] = ['secret', 'database', 'archive', 'log', 'data', 'build', 'dependency', 'large'];
const KIB = 1024, MIB = 1024 * KIB;
// Name patterns are our own, informed by public name-based lists: eth0izzle/shhgit (MIT), github-linguist/linguist
// vendor.yml (MIT) and github/gitignore (CC0). Only names, paths and sizes are matched; contents are never read.
const BUILD_DIRS = new Set(['dist', 'build', 'out', 'target', '.next', '.nuxt', 'coverage', '.turbo', '.cache', '__pycache__', '.venv', 'venv',
 '.gradle', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.parcel-cache', '.svelte-kit', '.angular', '.output', '.vercel', '.dart_tool', '.expo',
 'deriveddata', 'storybook-static', 'elm-stuff', '.stack-work']);
const ENV_EXAMPLES = new Set(['.env.example', '.env.sample', '.env.template']);
const SECRET_NAMES = new Set(['.env', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'credentials.json', 'credentials.xml',
 '.git-credentials', '.netrc', '_netrc', '.pgpass', '.htpasswd', '.dockercfg', '.s3cfg', 'sftp-config.json', '.ftpconfig', '.remote-sync.json',
 '.history', '.bash_history', '.zsh_history', '.mysql_history', '.psql_history', '.irb_history']);
const SECRET_EXTS = ['.pem', '.key', '.p12', '.pfx', '.pkcs12', '.keystore', '.jks', '.ppk', '.kdbx', '.kdb', '.keychain', '.psafe3', '.kwallet',
 '.ovpn', '.tfstate', '.tfstate.backup'];
const SSH_KEY = /_(rsa|dsa|ecdsa|ed25519)$/; // private halves only: the public key ends in .pub
const SECRET_PATHS = ['.vscode/sftp.json', '.idea/webservers.xml', '.docker/config.json']; // .aws is pruned and reported as a folder
// Pruned by the walk (never entered) and reported as one folder: secret stores and dependency folders.
const SECRET_DIRS = new Set(['.ssh', '.gnupg', '.aws']);
const DEPENDENCY_DIRS = new Set(['node_modules', 'bower_components', 'jspm_packages', '.terraform', '.pnpm-store']);
const DATABASE_EXTS = ['.sql', '.sqldump', '.dump', '.sqlite', '.sqlite3', '.db', '.bak', '.mdf', '.sdf'];
const ARCHIVE_EXTS = ['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'];
const DATA_EXTS = ['.csv', '.tsv', '.jsonl', '.ndjson', '.parquet', '.pcap', '.pcapng', '.npy', '.npz', '.pkl', '.h5', '.hdf5', '.feather', '.arrow'];
/**
 * One glob for the optional file watcher, built from the same lists: a new entry with one of these names may change the audit.
 * Size-only findings ("other large files") and a few path-only rules are not watched; the next full check still finds them.
 */
export const WATCH_GLOB = `**/{${[...new Set([
 ...SECRET_NAMES, '.env.*', ...SECRET_EXTS.map(e => `*${e}`), '*_rsa', '*_dsa', '*_ecdsa', '*_ed25519', 'sftp.json', 'WebServers.xml',
 ...[...DATABASE_EXTS, ...ARCHIVE_EXTS, '.log', ...DATA_EXTS].map(e => `*${e}`),
 ...SECRET_DIRS, '*.agilekeychain', ...DEPENDENCY_DIRS, 'Pods', ...BUILD_DIRS, 'DerivedData', 'cmake-build-*',
])].join(',')}}`;
const ends = (n: string, exts: string[]) => exts.some(e => n.endsWith(e));
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const parentOf = (p: string) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
function fileCategory(path: string, size: number): Category | undefined {
 const p = path.toLowerCase(), n = base(p);
 if (SECRET_NAMES.has(n) || (n.startsWith('.env.') && !ENV_EXAMPLES.has(n)) || ends(n, SECRET_EXTS) || SSH_KEY.test(n)
  || SECRET_PATHS.some(x => p === x || p.endsWith(`/${x}`))) return 'secret';
 if (size >= KIB && ends(n, DATABASE_EXTS)) return 'database';
 if (size >= 100 * KIB && ends(n, ARCHIVE_EXTS)) return 'archive';
 if (size >= 100 * KIB && n.endsWith('.log')) return 'log';
 if (size >= MIB && ends(n, DATA_EXTS)) return 'data';
 if (size >= 5 * MIB) return 'large';
 return undefined;
}
// Topmost ancestor directory (never the entry itself) that marks generated output or walked dependencies. `Pods` (CocoaPods)
// is matched in its exact spelling, because a lower-case `pods` folder is often real configuration.
// A 1Password `.agilekeychain` is a folder bundle, so it is reported as one secret folder.
function aggregateTop(path: string): { top: string; category: 'secret' | 'build' | 'dependency' } | undefined {
 const segs = path.split('/');
 // A secret bundle wins over any enclosing build or dependency folder, so it is never hidden by that aggregation.
 const bundle = segs.slice(0, -1).findIndex(seg => seg.toLowerCase().endsWith('.agilekeychain'));
 if (bundle >= 0) return { top: segs.slice(0, bundle + 1).join('/'), category: 'secret' };
 for (let i = 0; i < segs.length - 1; i++) {
  const seg = segs[i]!, lower = seg.toLowerCase(), top = segs.slice(0, i + 1).join('/');
  if (BUILD_DIRS.has(lower) || lower.startsWith('cmake-build-')) return { top, category: 'build' };
  if (seg === 'Pods') return { top, category: 'dependency' };
  if (lower === '.yarn' && i + 1 < segs.length - 1 && segs[i + 1]!.toLowerCase() === 'cache') return { top: segs.slice(0, i + 2).join('/'), category: 'dependency' };
 }
 return undefined;
}
// Names with control, format (including bidi and tag) or line/paragraph separator characters cannot be written safely into a
// one-rule-per-line file, so such findings get no suggestion at all.
const UNSAFE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
function suggestion(path: string, isDir: boolean): string {
 if (UNSAFE.test(path)) return '';
 let s = Array.from(path).map(c => /[\\*?[\]]/.test(c) ? `\\${c}` : c).join('');
 if (s.startsWith('!') || s.startsWith('#')) s = `\\${s}`;
 if (s.endsWith(' ')) s = `${s.slice(0, -1)}\\ `;
 return `/${s}${isDir ? '/' : ''}`;
}
// A suggestion must ignore its own path (and, for a folder, what is below it) and nothing else that was seen.
// Drops a suggestion that would also, or possibly (unknown, e.g. a case-only sibling), ignore another path.
function overreaches(f: Finding, others: { path: string; lower: string; kinds: boolean[] }[]): boolean {
 const parsed = parseIgnore(f.suggestion);
 if (!parsed || parsed.skipped > 0 || parsed.rules.length !== 1) return true;
 const sources: IgnoreSource[] = [{ dir: '', file: 'suggestion', parsed }], head = f.path.toLowerCase();
 for (const o of others) {
  if (o.path === f.path || (f.isDir && o.path.startsWith(`${f.path}/`)) || !o.lower.startsWith(head)) continue;
  if (o.kinds.some(k => evaluate(o.path, k, sources).status !== 'not_covered')) return true;
 }
 return false;
}
export function snippet(findings: Finding[]): string {
 return ['# Suggested by Bobert - review before adding', ...[...new Set(findings.map(f => f.suggestion).filter(x => x !== ''))].sort()].join('\n');
}
interface Cand { path: string; isDir: boolean; size?: number; category?: Category; counted: boolean }
const finite = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min;
export async function runAudit(root: string, agentIgnoreFiles: unknown, options: { signal?: AbortSignal; now?: () => number; walkFs?: WalkFs; readFs?: ReadFs; limits?: Partial<WalkLimits>; caseInsensitive?: boolean } = {}): Promise<AuditResult> {
 const { signal } = options, now = options.now ?? Date.now, started = now();
 const budget = finite(options.limits?.timeBudgetMs, 0) ? options.limits.timeBudgetMs : DEFAULT_LIMITS.timeBudgetMs;
 const yieldEvery = finite(options.limits?.yieldEvery, 1) ? Math.floor(options.limits.yieldEvery) : DEFAULT_LIMITS.yieldEvery;
 const ci = options.caseInsensitive ?? (process.platform === 'darwin' || process.platform === 'win32'), fold = (x: string) => ci ? x.toLowerCase() : x;
 const valid = validIgnoreNames(agentIgnoreFiles);
 // Any entry that cannot be used as a plain file name means the setting cannot be interpreted: nothing is claimed.
 const names = valid && (agentIgnoreFiles as unknown[]).every(x => typeof x === 'string' && valid.includes(x)) ? valid : undefined;
 const ignore: AuditResult['ignore'] = !names ? 'setting_unknown' : names.length === 0 ? 'disabled' : 'evaluated';
 const counts: AuditResult['counts'] = { files: 0, dirs: 0, ignored: 0, ignoreFiles: 0, ignoreFilesUnavailable: 0, symlinks: 0, unreadable: 0, unknown: 0 };
 const walk = await walkWorkspace(root, { ...(options.limits ? { limits: options.limits } : {}), ...(signal ? { signal } : {}), ...(options.walkFs ? { fs: options.walkFs } : {}), now });
 if (walk.status === 'unavailable') return { status: 'unavailable', ...(walk.code ? { code: walk.code } : {}), ignore, findings: [], omitted: 0, counts, reasons: [] };
 counts.files = walk.counts.files; counts.dirs = walk.counts.dirs; counts.symlinks = walk.counts.symlinks; counts.unreadable = walk.counts.unreadable;
 const reasons: string[] = [...walk.reasons];
 const note = (r: string) => { if (!reasons.includes(r)) reasons.push(r); };
 const overBudget = () => now() - started > budget;
 const sources: IgnoreSource[] = [];
 const evaluating = !!names && names.length > 0;
 const unavailable = (file: string) => { counts.ignoreFilesUnavailable++; sources.push({ dir: parentOf(file), file, unavailable: true }); };
 if (names && evaluating) {
  const listed = new Set(names.map(fold));
  const found = walk.files.map(f => f.path).filter(p => names.includes(base(p)));
  let rules = 0;
  for (let i = 0; i < found.length; i++) {
   const rel = found[i]!, dir = parentOf(rel);
   if (i >= READ_LIMITS.maxFiles) { note('ignore_file_limit'); unavailable(rel); continue; }
   if (signal?.aborted) { note('cancelled'); break; }
   if (overBudget()) { note('evaluation_time_limit'); unavailable(rel); continue; }
   const read = await readIgnoreFile(root, rel, names, options.readFs ? { fs: options.readFs } : {});
   const parsed = 'text' in read ? parseIgnore(read.text) : undefined;
   if (parsed && rules + parsed.rules.length > MAX_TOTAL_RULES) { note('ignore_rule_limit'); unavailable(rel); continue; }
   if (parsed) { rules += parsed.rules.length; counts.ignoreFiles++; sources.push({ dir, file: rel, parsed }); } else unavailable(rel);
  }
  // Entries Kiro could treat as an ignore file but whose content is never read (symlinks, unreadable or special entries, and,
  // on case-insensitive systems, files differing only in letter case): that directory's coverage is unknown.
  for (const e of [...walk.links, ...walk.odd]) if (listed.has(fold(base(e)))) unavailable(e);
  if (ci) for (const f of walk.files) if (listed.has(fold(base(f.path))) && !names.includes(base(f.path))) unavailable(f.path);
  // A listing that was cut short may have hidden an ignore file in that directory.
  if (walk.incomplete !== undefined) sources.push({ dir: walk.incomplete, file: walk.incomplete, unavailable: true });
 }
 // Candidates: every walked file and pruned directory (for counts), plus one synthetic directory per build or dependency folder.
 const builds = new Map<string, { size?: number; category: 'secret' | 'build' | 'dependency' }>(), cands: Cand[] = [];
 for (const f of walk.files) {
  const agg = aggregateTop(f.path);
  if (agg !== undefined) {
   // The folder is reported once, but a secret inside it is never hidden by that aggregation.
   builds.set(agg.top, { size: (builds.get(agg.top)?.size ?? 0) + f.size, category: agg.category });
   cands.push({ path: f.path, isDir: false, size: f.size, ...(fileCategory(f.path, f.size) === 'secret' ? { category: 'secret' as const } : {}), counted: true }); continue;
  }
  const category = fileCategory(f.path, f.size);
  cands.push({ path: f.path, isDir: false, size: f.size, ...(category ? { category } : {}), counted: true });
 }
 for (const p of walk.pruned) {
  const n = base(p).toLowerCase();
  // A secret store is reported wherever it is; a dependency folder inside build output is part of that folder.
  const agg = aggregateTop(p), inside = agg && agg.category !== 'secret' ? agg : undefined;
  const category = SECRET_DIRS.has(n) ? 'secret' as const : inside === undefined && DEPENDENCY_DIRS.has(n) ? 'dependency' as const : undefined;
  // A dependency folder folded into build output still makes that folder appear, even when no file inside it was walked.
  if (inside && DEPENDENCY_DIRS.has(n) && !builds.has(inside.top)) builds.set(inside.top, { category: inside.category });
  cands.push({ path: p, isDir: true, ...(category ? { category } : {}), counted: true });
 }
 for (const [path, { size, category }] of builds) cands.push({ path, isDir: true, ...(size !== undefined ? { size } : {}), category, counted: false });
 // Categorised candidates first, so that a time limit never costs a finding its coverage answer.
 const ordered = [...cands.filter(c => c.category), ...cands.filter(c => !c.category)];
 const findings: Finding[] = [];
 let processed = 0, exhausted = false, lastYield = now();
 for (const c of ordered) {
  if (signal?.aborted) { note('cancelled'); break; }
  const t = now();
  if (evaluating && !exhausted && t - started > budget) { exhausted = true; note('evaluation_time_limit'); }
  // Disabled: no ignore file applies, so nothing is evaluated and nothing can become unknown.
  const status: Coverage = !names || exhausted ? 'unknown' : !evaluating ? 'not_covered' : evaluate(c.path, c.isDir, sources).status;
  if (c.counted) { if (status === 'ignored') counts.ignored++; else if (status === 'unknown') counts.unknown++; }
  if (c.category && status !== 'ignored') findings.push({ path: c.path, isDir: c.isDir, category: c.category, ...(c.size !== undefined ? { size: c.size } : {}), coverage: status, suggestion: suggestion(c.path, c.isDir) });
  // Yield by count and by elapsed time, so a few expensive evaluations cannot starve the editor.
  if (++processed % yieldEvery === 0 || t - lastYield >= YIELD_MS) { await new Promise<void>(r => setImmediate(r)); lastYield = now(); }
 }
 findings.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
 const kept = findings.slice(0, MAX_FINDINGS);
 const others = [...walk.files.map(f => ({ path: f.path, kinds: [false] })), ...walk.pruned.map(p => ({ path: p, kinds: [true] })), ...walk.links.map(l => ({ path: l, kinds: [false, true] }))].map(o => ({ ...o, lower: o.path.toLowerCase() }));
 for (const f of kept) if (f.suggestion !== '' && overreaches(f, others)) f.suggestion = '';
 const notListed = ignore !== 'setting_unknown' && !names!.some(x => fold(x) === '.kiroignore') && walk.files.some(f => fold(base(f.path)) === '.kiroignore');
 return { status: reasons.length ? 'partial' : 'complete', ignore, findings: kept, omitted: findings.length - kept.length, counts, reasons, ...(notListed ? { kiroignoreNotListed: true as const } : {}) };
}
