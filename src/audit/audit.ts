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
const BUILD_DIRS = new Set(['dist', 'build', 'out', 'target', '.next', '.nuxt', 'coverage', '.turbo', '.cache', '__pycache__', '.venv', 'venv']);
const ENV_EXAMPLES = new Set(['.env.example', '.env.sample', '.env.template']);
const SECRET_NAMES = new Set(['.env', 'id_rsa', 'id_ed25519', 'credentials.json']);
const ends = (n: string, exts: string[]) => exts.some(e => n.endsWith(e));
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const parentOf = (p: string) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
function fileCategory(name: string, size: number): Category | undefined {
 const n = name.toLowerCase();
 if (SECRET_NAMES.has(n) || (n.startsWith('.env.') && !ENV_EXAMPLES.has(n)) || ends(n, ['.pem', '.key', '.p12', '.pfx', '.keystore'])) return 'secret';
 if (size >= KIB && ends(n, ['.sql', '.dump', '.sqlite', '.sqlite3', '.db', '.bak'])) return 'database';
 if (size >= 100 * KIB && ends(n, ['.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz'])) return 'archive';
 if (size >= 100 * KIB && n.endsWith('.log')) return 'log';
 if (size >= MIB && ends(n, ['.csv', '.tsv', '.jsonl', '.ndjson', '.parquet'])) return 'data';
 if (size >= 5 * MIB) return 'large';
 return undefined;
}
// Topmost ancestor directory (never the entry itself) whose name marks generated output.
function buildTop(path: string): string | undefined {
 const segs = path.split('/');
 for (let i = 0; i < segs.length - 1; i++) if (BUILD_DIRS.has(segs[i]!.toLowerCase())) return segs.slice(0, i + 1).join('/');
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
 return ['# Suggested by Cyclegauge — review before adding', ...[...new Set(findings.map(f => f.suggestion).filter(x => x !== ''))].sort()].join('\n');
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
 // Candidates: every walked file and pruned directory (for counts), plus one synthetic directory per build output folder.
 const builds = new Map<string, number>(), cands: Cand[] = [];
 for (const f of walk.files) {
  const top = buildTop(f.path);
  if (top !== undefined) {
   // The folder is reported once, but a secret inside it is never hidden by that aggregation.
   builds.set(top, (builds.get(top) ?? 0) + f.size);
   cands.push({ path: f.path, isDir: false, size: f.size, ...(fileCategory(base(f.path), f.size) === 'secret' ? { category: 'secret' as const } : {}), counted: true }); continue;
  }
  const category = fileCategory(base(f.path), f.size);
  cands.push({ path: f.path, isDir: false, size: f.size, ...(category ? { category } : {}), counted: true });
 }
 for (const p of walk.pruned) cands.push({ path: p, isDir: true, ...(buildTop(p) === undefined && base(p).toLowerCase() === 'node_modules' ? { category: 'dependency' as const } : {}), counted: true });
 for (const [path, size] of builds) cands.push({ path, isDir: true, size, category: 'build', counted: false });
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
