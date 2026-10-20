import { compare, scaleRatio, subtract } from '../decimal.ts';
import { DAY_MS, type AccountHistory } from '../history.ts';
import type { Finding } from '../audit/audit.ts';
import { auditSizeTotal, formatBytes } from './audit-model.ts';
import { date, updated } from './labels.ts';

// "Your Bobert summary": exclusions the user saved, counted per observed billing cycle, and the observed use trend. Pure and free of
// editor APIs. The only persisted value is `bobert.results.v1`: at most two entries of bounded numbers keyed by a billing reset time.
// No path, name, identifier or partition key is ever part of it. A value of any other shape is "unknown": shown as such, never overwritten.
export const RESULTS_KEY = 'bobert.results.v1';
export const MAX_CYCLES = 2;
export const MAX_BYTES = Number.MAX_SAFE_INTEGER;
export const MAX_COUNT = 1_000_000_000;
export interface ExclusionAggregate { bytes: number; bytesLowerBound: boolean; items: number; secrets: number }
export interface ResultsEntry extends ExclusionAggregate { cycle: string }
export type ResultsStore = ResultsEntry[];
/** What the renderer is given: the validated entries, or `unknown` when the stored value could not be trusted. */
export interface StoredResults { status: 'ok' | 'unknown'; entries: ResultsEntry[] }

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** Fixed-format cycle key (a billing reset time as `YYYY-MM-DDTHH:mm:ss.sssZ`), or null for anything else. */
export function cycleKey(value: unknown): string | null {
 if (typeof value !== 'string' || value.length > 40 || !TIMESTAMP.test(value)) return null;
 const ms = Date.parse(value);
 if (!Number.isFinite(ms)) return null;
 const iso = new Date(ms).toISOString();
 return ISO.test(iso) ? iso : null;
}
/** The cycle exclusions are counted under: the latest observed billing reset, only while it is still in the future. */
export function observedCycleKey(h: AccountHistory, now: string): string | null {
 if (h.status !== 'available') return null;
 const key = cycleKey(h.cycleResetAt), nowMs = Date.parse(now);
 return key !== null && Number.isFinite(nowMs) && Date.parse(key) > nowMs ? key : null;
}

const isSafeCount = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const FIELDS = ['cycle', 'bytes', 'bytesLowerBound', 'items', 'secrets'];
/** An own-data-property object with exactly these keys, copied into a null-prototype record; anything else (getters, extra keys, arrays) is undefined. */
export function plain(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
 if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
 const proto = Object.getPrototypeOf(value);
 if (proto !== Object.prototype && proto !== null) return undefined;
 const keys = Reflect.ownKeys(value);
 if (keys.length !== fields.length || !keys.every(k => typeof k === 'string' && fields.includes(k))) return undefined;
 const out: Record<string, unknown> = Object.create(null);
 for (const k of fields) {
  const d = Object.getOwnPropertyDescriptor(value, k);
  if (!d || !('value' in d)) return undefined; // data properties only; a getter is never run
  out[k] = d.value;
 }
 return out;
}
const aggregateOf = (o: Record<string, unknown>): ExclusionAggregate | undefined =>
 isSafeCount(o.bytes, MAX_BYTES) && typeof o.bytesLowerBound === 'boolean' && isSafeCount(o.items, MAX_COUNT) && isSafeCount(o.secrets, MAX_COUNT) && o.secrets <= o.items
  ? { bytes: o.bytes, bytesLowerBound: o.bytesLowerBound, items: o.items, secrets: o.secrets } : undefined;

/** Strict validator of one aggregate (own data properties only, exact keys). */
export function validAggregate(value: unknown): ExclusionAggregate | undefined {
 const o = plain(value, FIELDS.slice(1));
 return o ? aggregateOf(o) : undefined;
}
/**
 * Strict validator of the stored value. No value is an empty store; anything that is not an ascending array of at most two
 * well-formed entries with distinct fixed-format cycles is `unknown` (never repaired, so the caller must not overwrite it).
 */
export function readResults(value: unknown): StoredResults {
 if (value === undefined) return { status: 'ok', entries: [] };
 if (!Array.isArray(value) || value.length > MAX_CYCLES || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return { status: 'unknown', entries: [] };
 const entries: ResultsEntry[] = [];
 for (let i = 0; i < value.length; i++) {
  const d = Object.getOwnPropertyDescriptor(value, String(i));
  const o = d && 'value' in d ? plain(d.value, FIELDS) : undefined;
  const aggregate = o ? aggregateOf(o) : undefined;
  if (!o || !aggregate || typeof o.cycle !== 'string' || cycleKey(o.cycle) !== o.cycle || (entries.length && entries[entries.length - 1]!.cycle >= o.cycle)) return { status: 'unknown', entries: [] };
  entries.push({ cycle: o.cycle, ...aggregate });
 }
 return { status: 'ok', entries };
}

const sat = (a: number, b: number, max: number): number => Math.min(max, a + b);
/** Returns a new store with `aggregate` added under `cycle`, pruned to the two newest cycles. Invalid input leaves the store unchanged. */
export function record(store: ResultsStore, cycle: string, aggregate: ExclusionAggregate): ResultsStore {
 const key = cycleKey(cycle), add = validAggregate(aggregate);
 if (key === null || key !== cycle || !add) return store;
 const existing = store.find(e => e.cycle === key);
 const bytes = sat(existing?.bytes ?? 0, add.bytes, MAX_BYTES);
 const merged: ResultsEntry = {
  cycle: key, bytes,
  bytesLowerBound: (existing?.bytesLowerBound ?? false) || add.bytesLowerBound || bytes === MAX_BYTES,
  items: sat(existing?.items ?? 0, add.items, MAX_COUNT),
  secrets: Math.min(sat(existing?.secrets ?? 0, add.secrets, MAX_COUNT), sat(existing?.items ?? 0, add.items, MAX_COUNT)),
 };
 return [...store.filter(e => e.cycle !== key), merged].sort((a, b) => a.cycle < b.cycle ? -1 : 1).slice(-MAX_CYCLES);
}
/** Aggregate of the findings accepted for one saved Exclude edit: a size that is a lower bound when any size is unknown. */
export function aggregateFindings(findings: readonly Finding[]): ExclusionAggregate {
 const accepted = findings.filter(f => f.suggestion !== '');
 const total = auditSizeTotal(accepted.map(f => ({ coverage: 'not_covered' as const, path: f.path, isDir: f.isDir, ...(f.size !== undefined ? { size: f.size } : {}) })));
 const bytes = Number.isSafeInteger(total.bytes) && total.bytes >= 0 ? Math.min(total.bytes, MAX_BYTES) : MAX_BYTES;
 return { bytes, bytesLowerBound: total.lowerBound || bytes !== total.bytes,
  items: Math.min(accepted.length, MAX_COUNT), secrets: Math.min(accepted.filter(f => f.category === 'secret').length, MAX_COUNT) };
}

// Observed use trend: exact decimals from history().evidence.intervals only, which are comparable by construction. Intervals that
// straddle a window edge are left out rather than prorated; unobserved time is never counted as zero.
export const TREND_DAYS = 28;
const COVERAGE_PERCENT = 70;
export interface ObservedTrend {
 status: 'observed' | 'not_observed' | 'not_comparable'; asOf: string | null;
 recent: string | null; earlier: string | null; difference: string | null;
}
const none = (status: ObservedTrend['status']): ObservedTrend => ({ status, asOf: null, recent: null, earlier: null, difference: null });
const add = (a: string, b: string) => subtract(a, subtract('0', b));
function windowRate(h: AccountHistory, from: number, to: number): string | null {
 const inside = h.evidence.intervals.map(iv => ({ from: Date.parse(iv.from), to: Date.parse(iv.to), net: iv.netChange }))
  .filter(iv => Number.isFinite(iv.from) && Number.isFinite(iv.to) && iv.to > iv.from && iv.from >= from && iv.to <= to)
  .sort((a, b) => a.from - b.from);
 let covered = 0, edge = -Infinity, net = '0';
 for (const iv of inside) {
  if (iv.from < edge) return null; // evidence intervals never overlap; if they do, nothing is claimed
  covered += iv.to - iv.from; edge = iv.to;
  net = add(net, iv.net);
 }
 if (covered * 100 < (to - from) * COVERAGE_PERCENT) return null;
 return scaleRatio(net, BigInt(DAY_MS), BigInt(covered));
}
export function observedTrend(h: AccountHistory): ObservedTrend {
 if (h.status !== 'available') return none('not_observed');
 const e = h.evidence, last = e.observations.at(-1), end = last === undefined ? NaN : Date.parse(last);
 if (!Number.isFinite(end) || !e.intervals.length) return none('not_observed');
 // The same quality barriers the cycle comparison refuses: exclusions, a stop other than the 85-day range, an unknown or changed limit.
 if (e.exclusions.length || (e.stoppedBy && e.stoppedBy !== 'evidence_range') || e.cycles.some(c => !c.baseLimit || c.baseLimit !== e.cycles[0]!.baseLimit)) return none('not_comparable');
 const span = TREND_DAYS * DAY_MS;
 const recent = windowRate(h, end - span, end), earlier = windowRate(h, end - 2 * span, end - span);
 if (recent === null || earlier === null) return none('not_observed');
 return { status: 'observed', asOf: new Date(end).toISOString(), recent, earlier, difference: subtract(recent, earlier) };
}

const size = (e: ExclusionAggregate): string =>
 e.bytesLowerBound ? e.bytes > 0 ? `at least ${formatBytes(e.bytes)}` : 'size unknown' : `about ${formatBytes(e.bytes)}`;
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
/** The count, secret count and size of one saved-exclusion aggregate, as plain text. */
export const describeExclusions = (e: ExclusionAggregate): string => `${n(e.items, 'item', 'items')} (${n(e.secrets, 'possible secret', 'possible secrets')}), ${size(e)}`;
export interface ResultsText { heading: string; scope: string; exclusionsHeading: string; exclusions: string[]; notes: string[]; trendHeading: string; trend: string }
export const RESULTS_HEADING = 'Your Bobert summary';
/** All wording of the summary section, as plain text for the renderer to escape. */
export function resultsText(results: StoredResults, h: AccountHistory, now: string): ResultsText {
 const current = observedCycleKey(h, now), trend = observedTrend(h);
 const label = (e: ResultsEntry) => `${e.cycle === current ? 'This cycle' : 'Other cycle'}, resetting ${date(e.cycle, true)} (UTC)`;
 const exclusions = results.entries.map(e => `${label(e)}: ${describeExclusions(e)}.`);
 const notes: string[] = [];
 if (results.status === 'ok' && results.entries.length) notes.push('Counts what you saved, not what Kiro can read today; saving the same exclusion again counts it twice. "At least" and "size unknown" mean part of the size was not measured, not that it is zero.');
 if (current === null) notes.push('No billing cycle is observed right now, so exclusions saved now are not counted.');
 const rate = (v: string) => `${v} credits per day`;
 let text: string;
 if (trend.status === 'observed') {
  const d = compare(trend.difference!, '0'), delta = trend.difference!.replace(/^-/, '');
  text = `${rate(trend.recent!)} over the 28 days to ${updated(trend.asOf!)}, against ${rate(trend.earlier!)} in the 28 days before — ${d === 0 ? 'unchanged' : `${d > 0 ? 'higher' : 'lower'} by ${delta}`}. The cause is open.`;
 } else if (trend.status === 'not_comparable') text = 'Not comparable: a gap, an adjustment or a limit change in the history sits inside the 28-day windows.';
 else text = `Not enough history yet for a 28-day comparison. Each window needs about ${COVERAGE_PERCENT}% of its time covered by comparable account updates, so this fills in as you keep using Kiro.`;
 return {
  heading: RESULTS_HEADING,
  scope: 'The last two billing cycles with saved exclusions. These are observations, not proof that Bobert caused a change.',
  exclusionsHeading: 'Exclusions you saved',
  exclusions: results.status === 'unknown' ? ['The saved exclusion summary could not be read, so none are shown. Run "Bobert: Reset Reminders and Saved Summary" to clear it.']
   : exclusions.length ? exclusions : ['No exclusions saved yet. When you save a .kiroignore change from the Workspace audit, it is counted here.'],
  notes,
  trendHeading: 'Observed use trend', trend: text,
 };
}
