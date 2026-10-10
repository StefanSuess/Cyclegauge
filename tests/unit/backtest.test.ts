import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN, HELD_OUT } from './sim.ts';
import { backtest, metrics, inSegment, type Sample } from './backtest.ts';
import { DEFAULT_HEURISTICS } from '../../src/forecast.ts';

// The shipped default must be the candidate the report calls v3_break.
const SHIPPED = 'v3_break' as const;
const designSamples = backtest(Object.values(DESIGN).map(make => make(1)));
const heldOutSamples = backtest(Object.values(HELD_OUT).map(make => make(101)));

test('shipped heuristic defaults match the backtested candidate', () => {
 assert.deepEqual(DEFAULT_HEURISTICS, { sustainedChange: false, completedBreakExclusion: true });
});

for (const [label, samples] of [['design', designSamples], ['held-out', heldOutSamples]] as const) {
 test(`${label}: availability is never below the v2 baseline, in any scenario or segment`, () => {
  assert.ok(samples.length > 300);
  for (const name of new Set(samples.map(s => s.scenario))) {
   const m = metrics(samples.filter(s => s.scenario === name), SHIPPED);
   assert.ok(m.availability >= metrics(samples.filter(s => s.scenario === name), 'v2').availability, name);
  }
  for (const segment of ['all', 'monday', 'reset', 'weekend', 'break', 'change'] as const) {
   const subset = inSegment(samples, segment);
   if (subset.length) assert.ok(metrics(subset, SHIPPED).availability >= metrics(subset, 'v2').availability, segment);
  }
 });
 test(`${label}: Monday, weekend and reset forecasts are available and more accurate than v2 on the same dates`, () => {
  for (const segment of ['monday', 'weekend', 'reset'] as const) {
   const subset = inSegment(samples, segment);
   if (!subset.length) continue; // e.g. no weekend sessions in the held-out shapes
   const m = metrics(subset, SHIPPED);
   assert.ok(m.availability > 0.9, `${segment} availability ${m.availability}`);
   assert.ok(m.comparableN === 0 || m.newError! < m.oldError!, `${segment} error`);
  }
 });
 test(`${label}: steady and bursty comparable-date error and material underprediction are not worse than v2`, () => {
  for (const name of ['steady_weekdays', 'bursty', 'four_day_week', 'alternating_weeks', 'weekend_light']) {
   const subset = samples.filter((s: Sample) => s.scenario === name);
   if (!subset.length) continue;
   const m = metrics(subset, SHIPPED);
   assert.ok(m.newError! <= m.oldError!, `${name} error`);
   assert.ok(m.materialUnder! <= m.oldMaterialUnder! + 1e-9, `${name} material underprediction`);
  }
 });
 test(`${label}: day-to-day projection stability on Monday mornings is better than v2`, () => {
  // Overall stability is reported, not asserted: v2 is only available on a biased subset of days.
  const m = metrics(inSegment(samples, 'monday'), SHIPPED);
  assert.ok(m.oldStability === null || m.stability! < m.oldStability, `stability ${m.stability} vs ${m.oldStability}`);
 });
}

test('the break heuristic does not hide a genuine long-term decrease relative to no exclusion', () => {
 for (const samples of [designSamples, heldOutSamples]) {
  for (const name of ['sustained_decrease', 'sparse_decrease', 'break_then_decrease']) {
   const subset = samples.filter(s => s.scenario === name);
   if (!subset.length) continue;
   const without = metrics(subset, 'v3'), withBreak = metrics(subset, 'v3_break');
   assert.ok(withBreak.newError! <= without.newError! + 0.005, `${name}: ${withBreak.newError} vs ${without.newError}`);
  }
 }
});

test('qualified forecast on the first day after a reset when at least 24 days of prior exposure exist', () => {
 const day0 = designSamples.filter(s => s.scenario === 'steady_weekdays' && s.day >= 40 && new Date(s.at).getUTCDate() <= 3);
 assert.ok(day0.length >= 3);
 assert.ok(day0.every(s => s.prediction[SHIPPED] !== null));
});
