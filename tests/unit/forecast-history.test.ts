import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast } from '../../src/forecast.ts';
import { history } from '../../src/history.ts';
import { buildDemand } from '../../src/cost/demand.ts';
import { profile } from './cost-synthetic.ts';
import { history as historyV2 } from './baseline/history-v2.ts';
import { forecast as forecastV2 } from './baseline/forecast-v2.ts';
import { syntheticSnapshot } from './synthetic.ts';
import type { StoredSnapshot } from '../../src/store.ts';

const DAY = 86400000;
const AUG = '2030-08-01T00:00:00.000Z', JUL = '2030-07-01T00:00:00.000Z';
interface Work { date: string; credits: number }
/** Weekday sessions at 09:00 and 17:00 UTC on the given dates; the counter accrues between them and never otherwise. */
function sessions(dates: string[], credits: number, resetAt = AUG, startUsage = 0): StoredSnapshot[] {
 let usage = startUsage; const out: StoredSnapshot[] = [];
 for (const date of dates) {
  out.push(syntheticSnapshot(`${date}T09:00:00Z`, String(usage), { resetAt }));
  usage += credits;
  out.push(syntheticSnapshot(`${date}T17:00:00Z`, String(usage), { resetAt }));
 }
 return out;
}
const weekdays = (from: string, to: string) => { // inclusive UTC dates, weekdays only
 const dates: string[] = [];
 for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) { const w = new Date(t).getUTCDay(); if (w >= 1 && w <= 5) dates.push(new Date(t).toISOString().slice(0, 10)); }
 return dates;
};
const monday = (date: string, usage: string, resetAt = AUG) => syntheticSnapshot(`${date}T09:00:00Z`, usage, { resetAt });
const run = (s: StoredSnapshot[], now = s.at(-1)!.observedAt, heuristics = {}) => forecast(history(s), now, 24, { heuristics });
const method = (r: ReturnType<typeof run>, m: string) => r.estimates.find(e => e.method === m)!;

// Five working weeks, 100 credits per weekday, then Monday 09:00 with the weekend unobserved.
const fiveWeeks = () => [...sessions(weekdays('2030-06-03', '2030-07-05'), 100), monday('2030-07-08', '2500')];

test('Monday morning: zero-net weekend no longer blocks forecasting; baseline v2 is unavailable', () => {
 const s = fiveWeeks();
 assert.equal(forecastV2(historyV2(s), s.at(-1)!.observedAt).status, 'unavailable');
 const r = run(s);
 assert.equal(r.schemaVersion, 3); assert.equal(r.policy.version, 3);
 assert.equal(r.status, 'qualified'); assert.equal(r.tier, 'regular'); assert.equal(r.selectedMethod, 'history_28_day');
 const e = method(r, 'history_28_day');
 assert.equal(e.evidenceCredits, '2000'); assert.equal(e.evidenceMilliseconds, 28 * DAY);
 assert.equal(e.ratePerDay, '71.428571');
 assert.equal(e.projectedUsageAtReset, '4187.5');
 assert.ok(r.assumptions.includes('zero_net_change_not_proof_of_inactivity'));
 assert.ok(r.assumptions.includes('unobserved_periods_not_zero'));
 assert.equal(method(r, 'history_14_day').ratePerDay, '71.428571');
});

test('missing snapshots are unknown, never zero: sparse evidence is unavailable instead of a low rate', () => {
 const r = run(sessions(weekdays('2030-06-17', '2030-06-21'), 100));
 for (const m of ['history_7_day', 'history_14_day', 'history_28_day', 'history_84_day']) assert.equal(method(r, m).status, 'unavailable');
 // Observed days with a long unobserved hole: exposure counts only the observed time.
 const hole = [...sessions(weekdays('2030-06-03', '2030-06-07'), 100), ...sessions(weekdays('2030-07-01', '2030-07-05'), 100, AUG, 500), monday('2030-07-08', '1000')];
 const h = run(hole);
 assert.notEqual(method(h, 'history_28_day').status, 'qualified');
});

test('first day after a billing reset is qualified from prior-cycle evidence and nothing is subtracted across the reset', () => {
 const june = sessions(weekdays('2030-06-03', '2030-06-28'), 100, JUL);
 const s = [...june, monday('2030-07-01', '3', AUG)];
 assert.equal(forecastV2(historyV2(s), s.at(-1)!.observedAt).status, 'unavailable');
 const r = run(s);
 assert.equal(r.status, 'qualified'); assert.equal(r.selectedMethod, 'history_28_day');
 const e = method(r, 'history_28_day');
 // 20 weekdays (2000 credits) over 25 d 8 h of observed June time; the unobserved final weekend is neither zero nor subtracted.
 assert.equal(e.cyclesUsed, 1);
 assert.equal(e.evidenceCredits, '2000');
 assert.equal(e.evidenceMilliseconds, 25 * DAY + 8 * 3600000);
 assert.equal(e.ratePerDay, '78.947368');
 assert.equal(r.currentCycleUsage, '3');
});

test('a single long positive interval cannot dominate a window', () => {
 const everyDay: string[] = [];
 for (let d = 17; d <= 28; d++) everyDay.push(`2030-06-${d}`);
 const s = [...sessions(everyDay, 50, AUG), syntheticSnapshot('2030-07-13T05:00:00Z', '700', { resetAt: AUG }), monday('2030-07-15', '700')];
 const r = run(s);
 assert.deepEqual(method(r, 'history_28_day').reasons, ['dependent_window']);
 assert.equal(method(r, 'history_28_day').status, 'unavailable');
});

test('completed break exclusion removes zero-net exposure only for a single completed run of five or more days', () => {
 const SEP = '2030-09-01T00:00:00.000Z';
 const work = weekdays('2030-05-06', '2030-08-02').filter(d => d < '2030-06-17' || d > '2030-06-21');
 const s = [...sessions(work, 100, SEP), monday('2030-08-05', '0', SEP)];
 const off = run(s.slice(0, -1), s.at(-2)!.observedAt, { completedBreakExclusion: false });
 const on = run(s.slice(0, -1), s.at(-2)!.observedAt, { completedBreakExclusion: true });
 const withBreak = method(off, 'history_84_day'), without = method(on, 'history_84_day');
 assert.equal(withBreak.status, 'qualified'); assert.equal(without.status, 'qualified');
 assert.equal(withBreak.excludedBreakMilliseconds, 0);
 assert.equal(without.excludedBreakMilliseconds, 9 * DAY);
 assert.ok(Number(without.ratePerDay) > Number(withBreak.ratePerDay));
 const soon = s.filter(p => p.observedAt < '2030-07-06');
 assert.ok(run(soon).qualifiers.includes('extended_zero_net_period_in_window'));
 assert.ok(!on.qualifiers.includes('extended_zero_net_period_in_window'));
 // Weekends are never excluded.
 const steady = run(fiveWeeks());
 assert.ok(steady.estimates.every(e => (e.excludedBreakMilliseconds ?? 0) === 0));
 assert.ok(!steady.qualifiers.includes('extended_zero_net_period_in_window'));
});

test('an ongoing break is not excluded and a heuristic never hides a sustained decrease', () => {
 const s = sessions(weekdays('2030-06-03', '2030-06-14'), 100);
 const r = run(s, '2030-06-15T09:00:00Z', { completedBreakExclusion: true });
 assert.ok(r.estimates.every(e => (e.excludedBreakMilliseconds ?? 0) === 0));
 // Weekly one-day usage creates repeated zero runs: that is a pattern of use, not a pause, so nothing is excluded.
 const weeklyDays = ['2030-06-03', '2030-06-10', '2030-06-17', '2030-06-24', '2030-07-01', '2030-07-08', '2030-07-15', '2030-07-22', '2030-07-29'];
 const sparse = run(sessions(weeklyDays, 100), '2030-07-29T17:00:00Z', { completedBreakExclusion: true });
 assert.ok(sparse.estimates.every(e => (e.excludedBreakMilliseconds ?? 0) === 0));
});

test('sustained-change qualifiers are reported while the heuristic switch controls selection', () => {
 const early = sessions(weekdays('2030-06-03', '2030-06-28'), 40), late = sessions(weekdays('2030-07-01', '2030-07-12'), 120, AUG, 800);
 const s = [...early, ...late, monday('2030-07-15', String(800 + 10 * 120))];
 const off = run(s), on = run(s, undefined, { sustainedChange: true });
 assert.ok(off.qualifiers.includes('recent_usage_higher'));
 assert.equal(off.selectedMethod, 'history_28_day');
 if (method(on, 'history_14_day').status === 'qualified') assert.equal(on.selectedMethod, 'history_14_day');
 assert.equal(on.policy.heuristics.sustainedChange, true);
});

test('history estimates are blocked together with the in-cycle ones', () => {
 const s = fiveWeeks();
 const r = run(s, '2030-07-10T09:00:00Z'); // 48 h later: stale
 assert.equal(r.status, 'unavailable');
 assert.equal(r.estimates.length, 7);
 assert.ok(r.estimates.every(e => e.status === 'unavailable' && e.evidenceCredits === null));
});

test('exact cost demand uses the selected pooled evidence and the longest qualified window for future cycles', () => {
 const s = fiveWeeks(), h = history(s), f = forecast(h, s.at(-1)!.observedAt);
 const p = profile({ confirmedAt: f.asOf!, resetAt: f.resetAt });
 const d = buildDemand(f, h, null, p, 3, f.asOf!);
 assert.equal(d.status, 'available');
 const base = d.scenarios[1];
 // 2000 credits over exactly 28 d: one full 31-day future cycle is 31 * 2000 / 28.
 assert.deepEqual(base.futureCycles[0].credits, { numerator: 15500n, denominator: 7n });
 assert.ok(base.assumptions.includes('long_history_future_rate'));
 const bad = structuredClone(f); (bad.estimates.find(e => e.method === 'history_28_day') as any).evidenceCredits = '9999';
 assert.equal(buildDemand(bad, h, null, p, 1, f.asOf!).status, 'unavailable');
});
