import type { view } from '../view.ts';
import { compare, subtract, scaleRatio } from '../decimal.ts';
import { DAY_MS, MAX_GAP_MS } from '../history.ts';

/** Upper bound on plotted observed points. The text alternative lists exactly the plotted points. */
export const MAX_CHART_POINTS = 96;
/** Scenario multipliers of the selected observed rate; a declared assumption, never a confidence interval. */
export const LOWER_FACTOR = { numerator: 3n, denominator: 4n, label: '75%' } as const;
export const HIGHER_FACTOR = { numerator: 5n, denominator: 4n, label: '125%' } as const;
/** Lines beyond this multiple of the larger of the reported limit and observed usage are clipped, not plotted to scale. */
const RANGE_CAP = 2;

export interface ChartPoint { at: string; usage: string; limit: string; aboveLimit: boolean; change: string | null }
export interface ChartLimit { from: string; to: string; value: string }
export interface ChartUnknown { from: string; to: string; reason: string }
export interface ChartEvent { kind: string; at: string }
export interface ScenarioEnd { end: string; clipped: boolean; aboveLimit: boolean | null }
export interface ChartProjection {
 method: string; tier: 'provisional' | 'regular'; ratePerDay: string; windowFrom: string | null; windowTo: string | null;
 from: { at: string; usage: string }; central: ScenarioEnd; lower: ScenarioEnd; higher: ScenarioEnd;
}
export interface ChartModel {
 status: 'empty' | 'ready';
 axis: { startAt: string; endAt: string; startKnown: boolean };
 yMax: number;
 points: ChartPoint[]; totalPoints: number; omittedPoints: number;
 connectors: [number, number][]; unknown: ChartUnknown[]; events: ChartEvent[]; limits: ChartLimit[];
 asOf: string | null; resetAt: string | null; evaluatedAt: string | null;
 latest: { usage: string; limit: string; aboveLimit: boolean; difference: string } | null;
 projection: ChartProjection | null; projectionNote: string | null;
 budget: { from: { at: string; usage: string }; to: { at: string; usage: string }; perDay: string | null } | null; budgetNote: string | null;
 exhaustion: { day: string; conditional: true; approxAt: string | null } | null; exhaustionNote: string | null;
}
const plot = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; }; // Plot coordinates only; never displayed.
const add = (a: string, b: string) => subtract(a, subtract('0', b));
const iso = (ms: number) => new Date(ms).toISOString();
const EMPTY: ChartModel = { status: 'empty', axis: { startAt: '', endAt: '', startKnown: false }, yMax: 1, points: [], totalPoints: 0, omittedPoints: 0,
 connectors: [], unknown: [], events: [], limits: [], asOf: null, resetAt: null, evaluatedAt: null, latest: null, projection: null, projectionNote: null,
 budget: null, budgetNote: null, exhaustion: null, exhaustionNote: null };

export function chartModel(o: ReturnType<typeof view>): ChartModel {
 const h = o.history, f = o.forecast;
 if (h.status !== 'available') return { ...EMPTY, evaluatedAt: f.evaluatedAt };
 const intervalAt = (i: number) => h.intervals[i];
 // Displayable observations need a usage value and a reported limit; others stay unknown.
 const all = h.points.map((p, index) => ({ p, index })).filter(({ p }) => !p.conflicting && p.usage !== null && p.baseLimit !== null);
 if (!all.length) return { ...EMPTY, evaluatedAt: f.evaluatedAt };
 // A consecutive displayable pair is connectable only through comparable intervals no longer than the observation-gap limit.
 const joint = (a: number, b: number): { ok: boolean; reason: string } => {
  for (let i = a; i < b; i++) {
   const iv = intervalAt(i);
   if (iv.status !== 'comparable') return { ok: false, reason: iv.status };
   if (Date.parse(iv.to) - Date.parse(iv.from) > MAX_GAP_MS) return { ok: false, reason: 'gap_over_36_hours' };
  }
  return { ok: true, reason: '' };
 };
 const link = all.slice(1).map((d, k) => joint(all[k].index, d.index));
 const required = new Set<number>([0, all.length - 1]);
 const limitAbove = (k: number) => compare(all[k].p.usage!, all[k].p.baseLimit!) > 0;
 for (let k = 1; k < all.length; k++) {
  if (!link[k-1].ok || all[k].p.baseLimit !== all[k-1].p.baseLimit || limitAbove(k) !== limitAbove(k-1)) { required.add(k-1); required.add(k); }
 }
 let chosen: number[];
 let order = [...required].sort((a, b) => a - b);
 if (all.length <= MAX_CHART_POINTS) chosen = all.map((_, k) => k);
 else if (order.length >= MAX_CHART_POINTS) chosen = order.slice(-MAX_CHART_POINTS);
 else {
  const rest = all.map((_, k) => k).filter(k => !required.has(k)), slots = MAX_CHART_POINTS - order.length;
  const picked = Array.from({ length: slots }, (_, s) => rest[Math.floor((s + 0.5) * rest.length / slots)]);
  chosen = [...order, ...picked].sort((a, b) => a - b);
 }
 const points: ChartPoint[] = chosen.map(k => {
  const { p, index } = all[k];
  const previous = index > 0 ? h.intervals[index - 1] : null;
  return { at: p.observedAt, usage: p.usage!, limit: p.baseLimit!, aboveLimit: limitAbove(k),
   change: previous?.status === 'comparable' ? previous.netChange : null };
 });
 const connectors: [number, number][] = [];
 const unknown: ChartUnknown[] = [], events: ChartEvent[] = [];
 for (let c = 1; c < chosen.length; c++) {
  const a = chosen[c-1], b = chosen[c];
  let ok = true, reason = '';
  for (let k = a; k < b; k++) if (!link[k].ok) { ok = false; reason = reason || link[k].reason; }
  if (ok) connectors.push([c-1, c]);
  else if (b === a + 1) unknown.push({ from: points[c-1].at, to: points[c].at, reason });
  if (!ok) {
   // Barrier endpoints are always plotted, so a non-connectable span is a single consecutive displayable pair.
   if (b === a + 1 && ['usage_adjustment', 'limit_change', 'unsupported_extra_credits'].includes(reason)) events.push({ kind: reason, at: points[c].at });
  }
 }
 const first = points[0], last = points.at(-1)!;
 const startKnown = h.cycleStartAt !== null && Date.parse(h.cycleStartAt) <= Date.parse(first.at) && chosen[0] === 0;
 const startAt = startKnown ? h.cycleStartAt! : first.at;
 if (startKnown && Date.parse(startAt) < Date.parse(first.at)) unknown.unshift({ from: startAt, to: first.at, reason: 'before_first_observation' });
 const resetMs = h.cycleResetAt ? Date.parse(h.cycleResetAt) : NaN;
 const endMs = Number.isFinite(resetMs) && resetMs > Date.parse(last.at) ? resetMs : Date.parse(last.at) + DAY_MS;
 const limits: ChartLimit[] = [];
 for (let c = 0; c < points.length; c++) {
  if (c === 0 || points[c].limit !== points[c-1].limit) {
   if (limits.length) limits.at(-1)!.to = points[c].at;
   limits.push({ from: c === 0 ? startAt : points[c].at, to: iso(endMs), value: points[c].limit });
  }
 }
 const latest = { usage: last.usage, limit: last.limit, aboveLimit: last.aboveLimit, difference: last.aboveLimit ? subtract(last.usage, last.limit) : subtract(last.limit, last.usage) };

 // Projection layers exist only for a fresh, qualified forecast; otherwise only observed history is shown.
 const selected = f.estimates.find(e => e.method === f.selectedMethod && e.status === 'qualified');
 const stale = o.status === 'stale' || f.reasons.includes('stale');
 const eligible = !stale && o.status === 'observed' && f.status === 'qualified' && !!selected && f.asOf === last.at && selected.projectedUsageAtReset !== null && selected.ratePerDay !== null;
 let projection: ChartProjection | null = null, projectionNote: string | null = null;
 let budget: ChartModel['budget'] = null, budgetNote: string | null = null;
 let exhaustion: ChartModel['exhaustion'] = null, exhaustionNote: string | null = null;
 const scenarioEnd = (end: string): ScenarioEnd => ({ end, clipped: false, aboveLimit: compare(end, latest.limit) > 0 });
 if (eligible && selected) {
  const delta = subtract(selected.projectedUsageAtReset!, last.usage);
  projection = { method: selected.method, tier: selected.tier === 'provisional' ? 'provisional' : 'regular', ratePerDay: selected.ratePerDay!,
   windowFrom: selected.windowFrom, windowTo: selected.windowTo, from: { at: last.at, usage: last.usage },
   central: scenarioEnd(selected.projectedUsageAtReset!),
   lower: scenarioEnd(add(last.usage, scaleRatio(delta, LOWER_FACTOR.numerator, LOWER_FACTOR.denominator))),
   higher: scenarioEnd(add(last.usage, scaleRatio(delta, HIGHER_FACTOR.numerator, HIGHER_FACTOR.denominator))) };
  const remaining = subtract(latest.limit, last.usage);
  if (!latest.aboveLimit && compare(remaining, '0') > 0 && o.resetAt) {
   budget = { from: { at: last.at, usage: last.usage }, to: { at: o.resetAt, usage: latest.limit }, perDay: o.availablePerDay };
  } else budgetNote = 'no_remaining_capacity';
  if (selected.exhaustionStatus === 'conditional_before_reset' && selected.estimatedExhaustionDayUTC) {
   const rate = plot(selected.ratePerDay!), remainingNum = plot(remaining);
   const at = rate > 0 ? Date.parse(last.at) + remainingNum / rate * DAY_MS : NaN;
   exhaustion = { day: selected.estimatedExhaustionDayUTC, conditional: true, approxAt: Number.isFinite(at) && at <= endMs ? iso(at) : null };
  } else exhaustionNote = selected.exhaustionStatus;
 } else projectionNote = stale ? 'stale' : 'unavailable';

 // Axis range: the observed counter and the reported limit are always fully visible, including usage above the limit.
 let base = Math.max(...limits.map(l => plot(l.value)), ...points.map(p => plot(p.usage)), 0);
 if (base <= 0) base = 1;
 const cap = base * RANGE_CAP;
 let top = base;
 const lines = projection ? [projection.central, projection.lower, projection.higher] : [];
 for (const line of lines) { const v = plot(line.end); if (v <= cap) top = Math.max(top, v); }
 const yMax = top * 1.08;
 for (const line of lines) line.clipped = plot(line.end) > yMax;
 return { status: 'ready', axis: { startAt, endAt: iso(endMs), startKnown }, yMax, points, totalPoints: all.length, omittedPoints: all.length - points.length,
  connectors, unknown, events, limits, asOf: last.at, resetAt: h.cycleResetAt, evaluatedAt: f.evaluatedAt, latest, projection, projectionNote,
  budget, budgetNote, exhaustion, exhaustionNote };
}
