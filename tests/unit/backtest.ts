// Walk-forward backtest: every candidate sees only snapshots observed at or before each evaluation time.
import { history as historyV2 } from './baseline/history-v2.ts';
import { forecast as forecastV2 } from './baseline/forecast-v2.ts';
import { history } from '../../src/history.ts';
import { forecast, type Heuristics } from '../../src/forecast.ts';
import { simulate, type World, type EvalPoint, type Simulation } from './sim.ts';

export const CANDIDATES = ['v2', 'v3', 'v3_break', 'v3_sustained', 'v3_rolling_first', 'v3_14_first', 'v3_both', 'weekday_28', 'median_weeks'] as const;
export type Candidate = typeof CANDIDATES[number];
export const SEGMENTS = ['all', 'monday', 'reset', 'weekend', 'break', 'change'] as const;
export type Segment = typeof SEGMENTS[number];
const HEURISTICS: Record<string, Partial<Heuristics>> = {
 v3: { sustainedChange: false, completedBreakExclusion: false },
 v3_break: { sustainedChange: false, completedBreakExclusion: true },
 v3_sustained: { sustainedChange: true, completedBreakExclusion: false },
 v3_both: { sustainedChange: true, completedBreakExclusion: true },
};
const DAY = 86400000;
export const MATERIAL = 0.1; // an underprediction is material when the projection is >10% below the realized cycle total
export interface Sample { scenario: string; seed: number; day: number; at: string; segments: Segment[]; truth: number; prediction: Record<Candidate, number | null>; selected: string | null; resetKey: string }

function candidates(sim: Simulation, point: EvalPoint) {
 const upto = sim.snapshots.slice(0, point.index + 1);
 const out = {} as Record<Candidate, number | null>; let selected: string | null = null;
 const old = forecastV2(historyV2(upto), point.at);
 out.v2 = old.status === 'qualified' ? Number(old.estimates.find(e => e.method === old.selectedMethod)!.projectedUsageAtReset) : null;
 const h = history(upto);
 for (const [name, heuristics] of Object.entries(HEURISTICS)) {
  const f = forecast(h, point.at, 24, { heuristics });
  out[name as Candidate] = f.status === 'qualified' ? Number(f.estimates.find(e => e.method === f.selectedMethod)!.projectedUsageAtReset) : null;
  if (name === 'v3') selected = f.selectedMethod;
 }
 // Selection-order experiments reuse the break-exclusion estimates and only change which one is picked.
 const fb = forecast(h, point.at, 24, { heuristics: HEURISTICS.v3_break });
 const pick = (order: string[]) => { const m = order.find(x => fb.estimates.some(e => e.method === x && e.status === 'qualified')); return m ? Number(fb.estimates.find(e => e.method === m)!.projectedUsageAtReset) : null; };
 out.v3_rolling_first = pick(['rolling_7_day', 'history_28_day', 'history_14_day', 'history_7_day', 'cycle_to_date', 'observed_window']);
 out.v3_14_first = pick(['history_14_day', 'history_28_day', 'rolling_7_day', 'history_7_day', 'cycle_to_date', 'observed_window']);
 const latest = upto.at(-1)!, usage = Number(latest.usage), horizon = Date.parse(latest.resetAt!) - Date.parse(latest.observedAt);
 // Candidate outside the product: per-weekday rates over the last 28 complete UTC days (observed day rows only).
 const dayStart = Math.floor(Date.parse(point.at) / DAY) * DAY;
 const rows = h.evidence.days.filter(d => Date.parse(d.day) >= dayStart - 28 * DAY && Date.parse(d.day) < dayStart && d.observedMilliseconds > 0);
 const byWeekday = Array.from({ length: 7 }, () => ({ c: 0, ms: 0, n: 0 }));
 for (const d of rows) { const w = new Date(d.day).getUTCDay(); byWeekday[w].c += Number(d.netChange); byWeekday[w].ms += d.observedMilliseconds; byWeekday[w].n++; }
 if (byWeekday.every(b => b.n >= 3 && b.ms > 0)) {
  let add = 0; const end = Date.parse(latest.resetAt!);
  for (let t = Date.parse(latest.observedAt); t < end;) {
   const next = Math.min(end, (Math.floor(t / DAY) + 1) * DAY), w = new Date(t).getUTCDay();
   add += byWeekday[w].c / byWeekday[w].ms * (next - t); t = next;
  }
  out.weekday_28 = usage + add;
 } else out.weekday_28 = null;
 // Median of the last four complete seven-day blocks (to show why a median under-forecasts a cumulative total).
 const blocks = [0, 1, 2, 3].map(k => {
  const from = dayStart - (k + 1) * 7 * DAY, to = dayStart - k * 7 * DAY;
  const iv = h.evidence.intervals.filter(i => Date.parse(i.from) >= from && Date.parse(i.to) <= to);
  const ms = iv.reduce((a, i) => a + Date.parse(i.to) - Date.parse(i.from), 0);
  return ms >= 6 * DAY ? iv.reduce((a, i) => a + Number(i.netChange), 0) / ms : null;
 });
 if (blocks.every(b => b !== null)) { const s = [...blocks as number[]].sort((a, b) => a - b); out.median_weeks = usage + (s[1] + s[2]) / 2 * horizon; }
 else out.median_weeks = null;
 return { out, selected };
}

export function backtest(worlds: World[], warmupDays = 10): Sample[] {
 const samples: Sample[] = [];
 for (const world of worlds) {
  const sim = simulate(world), end = Date.parse(world.start) + world.days * DAY;
  for (const point of sim.evals) {
   if (point.day < warmupDays) continue;
   const resetAt = sim.snapshots[point.index].resetAt!;
   if (Date.parse(resetAt) > end) continue; // the cycle's truth is not observable yet
   const { out, selected } = candidates(sim, point);
   const segments: Segment[] = ['all'];
   if (point.weekday === 1) segments.push('monday');
   if (point.sinceReset <= 2) segments.push('reset');
   if (point.weekday === 6 || point.weekday === 0) segments.push('weekend');
   if (point.sinceBreak !== null && point.sinceBreak <= 21) segments.push('break');
   if (point.sinceChange !== null && point.sinceChange <= 28) segments.push('change');
   samples.push({ scenario: world.name, seed: world.seed, day: point.day, at: point.at, segments, truth: sim.truthAtReset(resetAt), prediction: out, selected, resetKey: resetAt });
  }
 }
 return samples;
}

export interface Metrics { n: number; availability: number; comparableN: number; oldError: number | null; newError: number | null; newOnlyN: number; newOnlyError: number | null;
 bias: number | null; oldBias: number | null; materialUnder: number | null; oldMaterialUnder: number | null;
 underShare: number | null; meanShortfall: number | null; oldUnderShare: number | null; oldMeanShortfall: number | null; stability: number | null; oldStability: number | null }
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const relError = (s: Sample, c: Candidate) => Math.abs(s.prediction[c]! - s.truth) / Math.max(s.truth, 1e-9);
const shortfall = (s: Sample, c: Candidate) => Math.max(0, (s.truth - s.prediction[c]!) / Math.max(s.truth, 1e-9));

export function metrics(samples: Sample[], candidate: Candidate, baseline: Candidate = 'v2'): Metrics {
 const available = samples.filter(s => s.prediction[candidate] !== null);
 const comparable = available.filter(s => s.prediction[baseline] !== null);
 const newOnly = available.filter(s => s.prediction[baseline] === null);
 const stability = (c: Candidate) => {
  const changes: number[] = [];
  const sorted = [...samples].sort((a, b) => a.scenario === b.scenario ? a.seed - b.seed || a.day - b.day : a.scenario < b.scenario ? -1 : 1);
  for (let i = 1; i < sorted.length; i++) {
   const a = sorted[i-1], b = sorted[i];
   if (a.scenario === b.scenario && a.seed === b.seed && a.resetKey === b.resetKey && a.prediction[c] !== null && b.prediction[c] !== null) changes.push(Math.abs(b.prediction[c]! - a.prediction[c]!) / Math.max(b.truth, 1e-9));
  }
  return mean(changes);
 };
 return { n: samples.length, availability: samples.length ? available.length / samples.length : 0, comparableN: comparable.length,
  oldError: mean(comparable.map(s => relError(s, baseline))), newError: mean(comparable.map(s => relError(s, candidate))),
  newOnlyN: newOnly.length, newOnlyError: mean(newOnly.map(s => relError(s, candidate))),
  bias: mean(comparable.map(s => (s.prediction[candidate]! - s.truth) / Math.max(s.truth, 1e-9))),
  oldBias: mean(comparable.map(s => (s.prediction[baseline]! - s.truth) / Math.max(s.truth, 1e-9))),
  materialUnder: comparable.length ? comparable.filter(s => shortfall(s, candidate) > MATERIAL).length / comparable.length : null,
  oldMaterialUnder: comparable.length ? comparable.filter(s => shortfall(s, baseline) > MATERIAL).length / comparable.length : null,
  underShare: comparable.length ? comparable.filter(s => s.prediction[candidate]! < s.truth).length / comparable.length : null,
  meanShortfall: mean(comparable.map(s => shortfall(s, candidate))),
  oldUnderShare: comparable.length ? comparable.filter(s => s.prediction[baseline]! < s.truth).length / comparable.length : null,
  oldMeanShortfall: mean(comparable.map(s => shortfall(s, baseline))),
  stability: stability(candidate), oldStability: stability(baseline) };
}
export const inSegment = (samples: Sample[], segment: Segment) => samples.filter(s => s.segments.includes(segment));
