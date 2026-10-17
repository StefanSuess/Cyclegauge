export interface IgnoreRule { negate: boolean; dirOnly: boolean; anchored: boolean; segs: Seg[]; line: number }
export interface ParsedIgnore { rules: IgnoreRule[]; skipped: number } // skipped = lines that could not be compiled
export const IGNORE_LIMITS = { maxRules: 2_000 };
// `file` is the root-relative path of the ignore file, reported as the deciding file in CoverageResult.
export type IgnoreSource = { dir: string; file: string; parsed: ParsedIgnore } | { dir: string; file: string; unavailable: true };
export type Coverage = 'ignored' | 'not_covered' | 'unknown';
export interface CoverageResult { status: Coverage; source?: { file: string; line: number } }
const MAX_LINE = 4_096;
export type Tok = { t: 'lit'; c: string } | { t: 'one' } | { t: 'star' } | { t: 'cls'; neg: boolean; r: [number, number][] };
export type Seg = 'globstar' | Tok[];
// Matching is segment-wise and regex-free: every pattern segment is a token list matched by the classic iterative `*`/`?`/class
// algorithm (backtracking only to the last star, O(n*m)); `**` segments are resolved by a DP over pattern-seg x path-seg (O(P*S)).
function tokenize(cs: string[]): Tok[] | undefined {
 const toks: Tok[] = [];
 for (let i = 0; i < cs.length;) {
  const c = cs[i]!;
  if (c === '\\') { const n = cs[i + 1]; if (n === undefined) return undefined; toks.push({ t: 'lit', c: n }); i += 2; }
  else if (c === '*') { while (cs[i] === '*') i++; toks.push({ t: 'star' }); }
  else if (c === '?') { toks.push({ t: 'one' }); i++; }
  else if (c === '[') {
   let j = i + 1, neg = false;
   if (cs[j] === '!' || cs[j] === '^') { neg = true; j++; }
   const start = j; let k = j; if (cs[k] === ']') k++;
   while (k < cs.length && cs[k] !== ']') { if (cs[k] === '\\') k++; k++; }
   if (k >= cs.length) return undefined; // unterminated class: uncompilable
   const body = cs.slice(start, k);
   if (body.join('').includes('[:')) return undefined; // POSIX classes are not supported
   const r: [number, number][] = [];
   for (let m = 0; m < body.length;) {
    let lo = body[m]!; if (lo === '\\') { m++; if (body[m] === undefined) return undefined; lo = body[m]!; }
    if (body[m + 1] === '-' && m + 2 < body.length) {
     let hi = body[m + 2]!, adv = 3; if (hi === '\\') { if (body[m + 3] === undefined) return undefined; hi = body[m + 3]!; adv = 4; }
     const a = lo.codePointAt(0)!, b = hi.codePointAt(0)!; if (b < a) return undefined;
     r.push([a, b]); m += adv;
    } else { const a = lo.codePointAt(0)!; r.push([a, a]); m++; }
   }
   toks.push({ t: 'cls', neg, r }); i = k + 1;
  } else { toks.push({ t: 'lit', c }); i++; }
 }
 return toks;
}
function compile(pat: string, anchored: boolean): Seg[] | undefined {
 const parts = anchored ? pat.split('/') : [pat], segs: Seg[] = [];
 for (const p of parts) {
  if (p === '') return undefined;
  if (anchored && p === '**') { segs.push('globstar'); continue; }
  const t = tokenize(Array.from(p)); if (!t) return undefined; segs.push(t);
 }
 return segs;
}
const variants = (ch: string) => { const l = ch.toLowerCase(), u = ch.toUpperCase(); return [ch, ...(Array.from(l).length === 1 ? [l] : []), ...(Array.from(u).length === 1 ? [u] : [])]; };
function one(t: Tok, ch: string, ci: boolean): boolean {
 if (t.t === 'lit') return ci ? t.c.toLowerCase() === ch.toLowerCase() : t.c === ch;
 if (t.t === 'one') return ch !== '/';
 if (t.t === 'star') return false;
 if (ch === '/') return false;
 const inCls = (x: string) => { const cp = x.codePointAt(0)!; return t.r.some(([lo, hi]) => cp >= lo && cp <= hi); };
 return (ci ? variants(ch) : [ch]).some(inCls) !== t.neg;
}
function segMatch(toks: Tok[], s: string[], ci: boolean): boolean {
 let ti = 0, si = 0, starT = -1, starS = 0;
 while (si < s.length) {
  const t = toks[ti];
  if (t && t.t === 'star') { starT = ti++; starS = si; continue; }
  if (t && one(t, s[si]!, ci)) { ti++; si++; continue; }
  if (starT >= 0) { ti = starT + 1; si = ++starS; continue; }
  return false;
 }
 while (toks[ti]?.t === 'star') ti++;
 return ti === toks.length;
}
function ruleMatches(r: IgnoreRule, rel: string, ci: boolean): boolean {
 const S = rel.split('/');
 if (!r.anchored) return segMatch(r.segs[0] as Tok[], Array.from(S[S.length - 1]!), ci);
 const P = r.segs, np = P.length, ns = S.length, chars = S.map(x => Array.from(x));
 let next: boolean[] = Array.from({ length: ns + 1 }, (_, j) => j === ns);
 for (let i = np - 1; i >= 0; i--) {
  const seg = P[i]!, cur: boolean[] = new Array<boolean>(ns + 1).fill(false);
  if (seg === 'globstar') { const trailing = i === np - 1; for (let j = ns; j >= 0; j--) cur[j] = trailing ? j < ns : next[j]! || (j < ns && cur[j + 1]!); }
  else for (let j = 0; j < ns; j++) cur[j] = next[j + 1]! && segMatch(seg, chars[j]!, ci);
  next = cur;
 }
 return next[0]!;
}
function trimEnd(raw: string): string {
 let s = raw;
 while (s.endsWith(' ')) { let b = 0; for (let k = s.length - 2; k >= 0 && s[k] === '\\'; k--) b++; if (b % 2 === 1) break; s = s.slice(0, -1); }
 return s;
}
export function parseIgnore(text: string): ParsedIgnore | undefined {
 const rules: IgnoreRule[] = []; let skipped = 0;
 const lines = text.replace(/^﻿/, '').split(/\r?\n/);
 for (let idx = 0; idx < lines.length; idx++) {
  let l = trimEnd(lines[idx]!);
  if (l === '' || l.startsWith('#')) continue;
  if (l.length > MAX_LINE) { skipped++; continue; }
  const negate = l.startsWith('!'); if (negate) l = l.slice(1);
  const dirOnly = l.endsWith('/'); if (dirOnly) l = l.slice(0, -1);
  const anchored = l.includes('/'); if (l.startsWith('/')) l = l.slice(1);
  const segs = l === '' ? undefined : compile(l, anchored);
  if (!segs) { skipped++; continue; }
  if (rules.length >= IGNORE_LIMITS.maxRules) return undefined;
  rules.push({ negate, dirOnly, anchored, segs, line: idx + 1 });
 }
 return { rules, skipped };
}
const depth = (dir: string) => dir === '' ? 0 : dir.split('/').length;
const isUnavailable = (s: IgnoreSource): s is Extract<IgnoreSource, { unavailable: true }> => 'unavailable' in s;
type Hit = { line: number; negate: boolean; file: string } | undefined;
function decide(list: Extract<IgnoreSource, { parsed: ParsedIgnore }>[], cand: string, candDir: boolean, ci: boolean): Hit {
 let hit: Hit;
 for (const s of list) {
  const rel = s.dir ? cand.slice(s.dir.length + 1) : cand;
  for (const r of s.parsed.rules) if ((!r.dirOnly || candDir) && ruleMatches(r, rel, ci)) hit = { line: r.line, negate: r.negate, file: s.file };
 }
 return hit;
}
// Evaluation walks the path's ancestors root-down, then the path itself (gitignore: an excluded parent directory cannot be
// re-included). For each candidate, sources whose dir is an ancestor-or-equal of the candidate's parent apply, ordered root to
// deepest, rules in file order, last match wins; patterns are matched segment-wise against the path relative to the source dir.
// Unknown rule: a candidate yields `unknown` (and evaluation stops there) when ANY applicable source is unavailable or was only
// partially compiled (parsed.skipped > 0), or when the ignored/not-ignored outcome differs between (a) sources of equal depth
// in given order vs reversed order, or (b) case-sensitive vs case-insensitive matching. Applicable sets only grow with depth,
// so deeper candidates are equally affected. An `ignored` decision made earlier by fully available, unambiguous sources is
// final (an excluded parent cannot be overridden below it). `ignored`/`not_covered` is never returned when an unavailable
// source, an uncompiled line, source order or letter case could change the answer.
export function evaluate(path: string, isDir: boolean, sources: IgnoreSource[]): CoverageResult {
 if (path === '') return { status: 'not_covered' };
 const segs = path.split('/'), n = segs.length;
 for (let k = 1; k <= n; k++) {
  const cand = segs.slice(0, k).join('/'), parent = segs.slice(0, k - 1).join('/'), candDir = k < n || isDir;
  const applicable = sources.filter(s => s.dir === '' || parent === s.dir || parent.startsWith(`${s.dir}/`));
  const list: Extract<IgnoreSource, { parsed: ParsedIgnore }>[] = [];
  for (const s of applicable) { if (isUnavailable(s) || s.parsed.skipped > 0) return { status: 'unknown' }; list.push(s); }
  const fwd = list.map((s, i) => [s, i] as const).sort((a, b) => depth(a[0].dir) - depth(b[0].dir) || a[1] - b[1]).map(x => x[0]);
  const rev = list.map((s, i) => [s, i] as const).sort((a, b) => depth(a[0].dir) - depth(b[0].dir) || b[1] - a[1]).map(x => x[0]);
  const hit = decide(fwd, cand, candDir, false), flag = (h: Hit) => !!h && !h.negate;
  if ([decide(rev, cand, candDir, false), decide(fwd, cand, candDir, true), decide(rev, cand, candDir, true)].some(h => flag(h) !== flag(hit))) return { status: 'unknown' };
  const source = hit ? { file: hit.file, line: hit.line } : undefined;
  if (hit && !hit.negate) return { status: 'ignored', source: source! };
  if (k === n) return source ? { status: 'not_covered', source } : { status: 'not_covered' };
 }
 return { status: 'not_covered' };
}
