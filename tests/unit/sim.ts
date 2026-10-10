// Wholly synthetic usage simulator for the Milestone 4C walk-forward backtest. No real Kiro data is involved.
import { syntheticSnapshot } from './synthetic.ts';
import type { StoredSnapshot } from '../../src/store.ts';

const DAY = 86400000;
export const rng = (seed: number) => () => { // mulberry32
 seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
 t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export interface DayPlan { credits: number; startHour: number; hours: number }
export interface World {
 name: string; days: number; start: string; seed: number;
 /** null = the IDE is not used that day, so there is no observation (and no usage). */
 plan(day: number, date: Date, random: () => number): DayPlan | null;
 /** Optional annotations used only to label backtest segments. */
 breakDays?: [number, number]; changeDay?: number;
}
export interface EvalPoint { index: number; at: string; day: number; weekday: number; sinceReset: number; sinceBreak: number | null; sinceChange: number | null }
export interface Simulation {
 world: World; snapshots: StoredSnapshot[]; evals: EvalPoint[];
 truthAtReset(resetAt: string): number;
}
const monthStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const nextMonth = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

export function simulate(world: World): Simulation {
 const random = rng(world.seed), t0 = Date.parse(world.start);
 const sessions: { start: number; end: number; credits: number; cumulative: number }[] = [];
 let total = 0;
 for (let day = 0; day < world.days; day++) {
  const date = new Date(t0 + day * DAY), plan = world.plan(day, date, random);
  if (!plan || plan.credits < 0) continue;
  const start = t0 + day * DAY + plan.startHour * 3600000;
  sessions.push({ start, end: start + plan.hours * 3600000, credits: plan.credits, cumulative: total });
  total += plan.credits;
 }
 const cumulative = (time: number) => {
  let lo = 0, hi = sessions.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (sessions[mid].start <= time) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  if (found < 0) return 0;
  const s = sessions[found];
  return s.cumulative + s.credits * Math.min(1, (time - s.start) / (s.end - s.start));
 };
 const cycleUsage = (time: number) => cumulative(time) - cumulative(monthStart(time));
 const snapshots: StoredSnapshot[] = [], evals: EvalPoint[] = [];
 let lastBreakEnd: number | null = null;
 for (const [i, s] of sessions.entries()) {
  const day = Math.floor((s.start - t0) / DAY);
  for (const time of [s.start, s.start + (s.end - s.start) / 2, s.end]) {
   snapshots.push(syntheticSnapshot(new Date(time).toISOString(), cycleUsage(time).toFixed(4), { limit: '100000', resetAt: new Date(nextMonth(time)).toISOString() }));
  }
  const date = new Date(s.start);
  evals.push({ index: snapshots.length - 3, at: new Date(s.start).toISOString(), day, weekday: date.getUTCDay(),
   sinceReset: Math.floor((s.start - monthStart(s.start)) / DAY),
   sinceBreak: world.breakDays && day >= world.breakDays[1] ? day - world.breakDays[1] : null,
   sinceChange: world.changeDay !== undefined && day >= world.changeDay ? day - world.changeDay : null });
  void i; void lastBreakEnd;
 }
 return { world, snapshots, evals, truthAtReset: (resetAt: string) => { const r = Date.parse(resetAt); return cumulative(r) - cumulative(monthStart(r - 1)); } };
}

const weekday = (d: Date) => d.getUTCDay();
const noise = (random: () => number, spread = 0.1) => 1 + (random() * 2 - 1) * spread;
const workday = (credits: number, startHour = 9): DayPlan => ({ credits, startHour, hours: 8 });
const weekdays = (rate: (day: number, random: () => number) => number) => (day: number, date: Date, random: () => number) => {
 const w = weekday(date); return w >= 1 && w <= 5 ? workday(rate(day, random)) : null;
};
const START = '2030-04-01T00:00:00Z'; // a Monday; five monthly cycles are simulated
const base = (name: string, plan: World['plan'], extra: Partial<World> = {}) => (seed: number): World => ({ name, days: 160, start: START, seed, plan, ...extra });

export const DESIGN = {
 steady_weekdays: base('steady_weekdays', weekdays((_, r) => 120 * noise(r))),
 weekend_light: base('weekend_light', (day, date, random) => { const w = weekday(date); if (w >= 1 && w <= 5) return workday(120 * noise(random)); if (w === 6 && random() < 0.6) return workday(30 * noise(random)); return null; }),
 weekend_heavy: base('weekend_heavy', (day, date, random) => { const w = weekday(date); return w === 0 || w === 6 ? workday(100 * noise(random)) : w >= 1 && w <= 5 && random() < 0.7 ? workday(40 * noise(random)) : null; }),
 extended_break: base('extended_break', (day, date, random) => { const w = weekday(date); return day >= 70 && day < 84 || w < 1 || w > 5 ? null : workday(120 * noise(random)); }, { breakDays: [70, 84] }),
 sustained_increase: base('sustained_increase', weekdays((d, r) => (d < 70 ? 80 : 160) * noise(r)), { changeDay: 70 }),
 sustained_decrease: base('sustained_decrease', weekdays((d, r) => (d < 70 ? 140 : 50) * noise(r)), { changeDay: 70 }),
 sparse_decrease: base('sparse_decrease', (day, date, random) => { const w = weekday(date); if (w < 1 || w > 5) return null; return day < 70 ? workday(140 * noise(random)) : w === 2 ? workday(140 * noise(random)) : null; }, { changeDay: 70 }),
 bursty: base('bursty', weekdays((_, r) => (r() < 0.2 ? 400 : 40) * noise(r))),
};
// Held-out shapes: never used to choose thresholds or heuristics.
export const HELD_OUT = {
 four_day_week: base('four_day_week', (day, date, random) => { const w = weekday(date); return w >= 1 && w <= 4 ? workday(150 * noise(random)) : null; }),
 alternating_weeks: base('alternating_weeks', (day, date, random) => { const w = weekday(date); return w >= 1 && w <= 5 ? workday((Math.floor(day / 7) % 2 === 0 ? 150 : 50) * noise(random)) : null; }),
 gradual_ramp: base('gradual_ramp', weekdays((d, r) => (60 + d * 0.9) * noise(r)), { changeDay: 20 }),
 biweekly_bursts: base('biweekly_bursts', weekdays((d, r) => (d % 14 === 4 ? 600 : 60) * noise(r))),
 midnight_crossing: base('midnight_crossing', (day, date, random) => { const w = weekday(date); return w >= 1 && w <= 5 ? { credits: 120 * noise(random), startHour: 21, hours: 6 } : null; }),
 break_then_decrease: base('break_then_decrease', (day, date, random) => { const w = weekday(date); if (w < 1 || w > 5 || day >= 60 && day < 75) return null; return workday((day < 75 ? 130 : 70) * noise(random)); }, { breakDays: [60, 75], changeDay: 75 }),
};
export type ScenarioName = keyof typeof DESIGN | keyof typeof HELD_OUT;
