import assert from 'node:assert/strict';
import test from 'node:test';
import { view } from '../../src/view.ts';
import { advisorProfile, classifyAdvice, noAnswers, planHint } from '../../src/cost/advisor.ts';
import { reviewedCatalog } from '../../src/cost/catalog.ts';
import { estimateSavings, type SavingsEstimate } from '../../src/cost/estimate.ts';
import { NO_INSIGHTS, planInsights, previousCycleUsage } from '../../src/cost/plan-hints.ts';
import { calculateCosts } from '../../src/extension/cost-inputs.ts';
import { syntheticSnapshot as snap } from './synthetic.ts';
import type { StoredSnapshot } from '../../src/store.ts';

const R0 = '2030-01-01T00:00:00.000Z', R1 = '2030-02-01T00:00:00.000Z', R2 = '2030-03-01T00:00:00.000Z';
const NOW = '2030-02-23T06:30:00Z';
// Three invented billing cycles on a 2000-credit account: the first ends at 200, the second (the "last" cycle) at `last`, the third is current at 20 a day.
const cycles = (last = 600, limit = '2000', withFirst = true): StoredSnapshot[] => [
 ...(withFirst ? [snap('2029-12-30T00:00:00Z', '100', { limit, resetAt: R0 }), snap('2029-12-31T00:00:00Z', '200', { limit, resetAt: R0 })] : []),
 snap('2030-01-01T06:00:00Z', '20', { limit, resetAt: R1 }), snap('2030-01-15T00:00:00Z', String(Math.round(last / 2)), { limit, resetAt: R1 }), snap('2030-01-31T12:00:00Z', String(last), { limit, resetAt: R1 }),
 ...Array.from({ length: 23 }, (_, d) => snap(`2030-02-${String(d + 1).padStart(2, '0')}T06:00:00Z`, String(d * 20), { limit, resetAt: R2 })),
];
/** The production path: hint from the limit, the advisor profile, the 1-month horizon and its estimate. */
function pipeline(snapshots: StoredSnapshot[], now = NOW) {
 const o = view(snapshots, now);
 const hint = planHint(o.baseLimit, reviewedCatalog);
 const built = advisorProfile({ limit: o.baseLimit, usage: o.usage, asOf: o.forecast.asOf ?? null, resetAt: o.forecast.resetAt ?? null }, noAnswers, hint);
 const horizons = built.profile ? calculateCosts({ mode: 'personalized', profile: built.profile, monthlyCredits: '0', beforeReset: undefined, demandMode: 'forecast' }, o.forecast, o.history, now) : [];
 const estimate = horizons.length ? estimateSavings(horizons[0]!.result, built.context, classifyAdvice(horizons[0]!.result, built.context), 1) : null;
 return { o, estimate, planSource: built.context.planSource };
}

test('the previous cycle usage comes from stored history only when its start and every interval are backed', () => {
 // Observed 600 over 30.5 days, last seen 12 hours before the reset: plus 600 x 0.5 / 30.5 = 9.836065..., rounded up.
 assert.equal(previousCycleUsage(view(cycles(), NOW).history, '2000'), '609.836066');
 assert.equal(previousCycleUsage(view(cycles(1234), NOW).history, '2000'), '1254.229509');
 // Seen an hour before the reset, the allowance is small: 600 x (1/24) / 30.958333 = 0.807537..., rounded up.
 const late = cycles(); late[4] = snap('2030-01-31T23:00:00Z', '600', { limit: '2000', resetAt: R1 });
 assert.equal(previousCycleUsage(view(late, NOW).history, '2000'), '600.807538');
 assert.equal(previousCycleUsage(view(cycles(), NOW).history, '1000'), null); // another limit
 assert.equal(previousCycleUsage(view(cycles(600, '2000', false), NOW).history, '2000'), null); // only two observed cycles: the last one's start is not backed
 // The last observation of the cycle is more than a day before its reset: usage seen so far is only a lower bound.
 const early = cycles(); early[4] = snap('2030-01-30T00:00:00Z', '600', { limit: '2000', resetAt: R1 });
 assert.equal(previousCycleUsage(view(early, NOW).history, '2000'), null);
 // A conflicting duplicate observation breaks the chain.
 const broken = cycles(); broken.push(snap('2030-01-15T00:00:00Z', '999', { limit: '2000', resetAt: R1 }));
 assert.equal(previousCycleUsage(view(broken, NOW).history, '2000'), null);
 assert.equal(previousCycleUsage(view([], NOW).history, '2000'), null);
 // A limit change between the previous and the current cycle leaves no comparable previous cycle.
 const changed = cycles().map(x => x.resetAt === R2 ? { ...x, limit: '3000' } : x);
 assert.equal(previousCycleUsage(view(changed, NOW).history, '3000'), null);
 assert.equal(previousCycleUsage(view(changed, NOW).history, '2000'), null);
});
test('the allowance for the last unobserved hours can flip the right-sizing result', () => {
 const fits = (last: number) => { const p = pipeline(cycles(last)); return planInsights({ view: p.o, estimate: p.estimate, planSource: p.planSource, plan: 'pro_plus', now: NOW }).rightsize; };
 assert.notEqual(fits(980), null); // 980 + 16.07 = 996.07 of 1000
 assert.equal(fits(985), null); // 985 observed would fit on its own; 985 + 16.15 = 1001.15 does not
});

test('right-sizing: a smaller plan fits the forecast and the last completed cycle', () => {
 const { o, estimate, planSource } = pipeline(cycles());
 assert.equal(planSource, 'hint');
 assert.equal(estimate?.outcome, 'saving');
 const insights = planInsights({ view: o, estimate, planSource, plan: 'pro_plus', now: NOW });
 assert.equal(insights.larger, null); // 20 a day never reaches the limit
 assert.deepEqual({ ...insights.rightsize!, unusedCredits: undefined }, { current: 'pro_plus', plan: 'pro', saving: '20', unusedCredits: undefined, hint: true });
 const unused = Number(insights.rightsize!.unusedCredits);
 assert.ok(unused > 1400 && unused < 1600, String(unused)); // 2000 minus the projected usage at the reset
 // Confirmed by the user: no hint prefix flag.
 assert.equal(planInsights({ view: o, estimate, planSource: 'confirmed', plan: 'pro_plus', now: NOW }).rightsize!.hint, false);
});

test('right-sizing needs the last cycle to fit too, and a previous cycle at all', () => {
 const fits = (last: number, withFirst = true) => { const p = pipeline(cycles(last, '2000', withFirst)); return planInsights({ view: p.o, estimate: p.estimate, planSource: p.planSource, plan: 'pro_plus', now: NOW }); };
 assert.notEqual(fits(900).rightsize, null);
 assert.equal(fits(1001).rightsize, null);
 assert.equal(fits(1800).rightsize, null);
 assert.equal(fits(600, false).rightsize, null); // no completed cycle with backed usage
 assert.equal(planInsights({ view: view(cycles().slice(5), NOW), estimate: pipeline(cycles().slice(5)).estimate, planSource: 'hint', plan: 'pro_plus', now: NOW }).rightsize, null); // first cycle ever observed
});

test('unusable estimates, unknown plans, provisional or stale forecasts give nothing', () => {
 const { o, estimate, planSource } = pipeline(cycles());
 const base = { view: o, estimate, planSource, plan: 'pro_plus' as const, now: NOW };
 assert.notEqual(planInsights(base).rightsize, null); // control
 assert.deepEqual(planInsights({ ...base, estimate: null }), NO_INSIGHTS);
 assert.deepEqual(planInsights({ ...base, planSource: 'unknown' }), NO_INSIGHTS);
 for (const change of [{ tier: 'insufficient' }, { tier: 'comparison_only' }, { outcome: 'no_cheaper' }, { outcome: 'costs_only' }, { outcome: 'none' }, { baselinePlan: null }, { conditions: [...estimate!.conditions, 'free_plan_terms_unverified'] }, { preferredChanges: true }] as Partial<SavingsEstimate>[])
  assert.deepEqual(planInsights({ ...base, estimate: { ...estimate!, ...change } }), NO_INSIGHTS, JSON.stringify(change));
 assert.deepEqual(planInsights({ ...base, estimate: { ...estimate!, base: { ...estimate!.base!, saving: '0' } } }), NO_INSIGHTS);
 assert.deepEqual(planInsights({ ...base, estimate: { ...estimate!, base: { ...estimate!.base!, best: { ...estimate!.base!.best!, keep: true } } } }), NO_INSIGHTS);
 assert.deepEqual(planInsights({ ...base, view: view(cycles(), '2030-02-25T06:30:00Z') }), NO_INSIGHTS); // stale
 const provisional = view(cycles().slice(-5), '2030-02-23T06:30:00Z');
 assert.deepEqual(planInsights({ ...base, view: provisional }), NO_INSIGHTS);
 const flagged = cycles().map(s => ({ ...s, flags: ['unsupported_extra_credits'] }));
 assert.deepEqual(planInsights({ ...base, view: view(flagged, NOW) }), NO_INSIGHTS);
});

// The next larger plan beside a projected overage: list-price facts only, no estimate involved.
const overageView = (now = '2030-06-08T00:00:00Z', flags: string[] = []) => view(Array.from({ length: 8 }, (_, i) => snap(`2030-06-0${i + 1}T00:00:00Z`, String(i * 50), { limit: '1000', flags })), now);
const compareArgs = (over: Partial<Parameters<typeof planInsights>[0]> = {}) => ({ view: overageView(), estimate: null, planSource: 'hint' as const, plan: 'pro' as const, now: '2030-06-08T00:00:00Z', ...over });
test('next larger plan: the fee and credit differences from the reviewed price list, with a hint flag for an inferred plan', () => {
 assert.equal(overageView().forecast.tier, 'regular');
 const reviewedOn = reviewedCatalog.verifiedOn;
 assert.deepEqual(planInsights(compareArgs()).larger, { current: 'pro', next: 'pro_plus', feeDiff: '20', creditDiff: '1000', hint: true, reviewedOn });
 assert.equal(planInsights(compareArgs({ planSource: 'confirmed' })).larger!.hint, false);
 assert.deepEqual(planInsights(compareArgs({ plan: 'free' })).larger, { current: 'free', next: 'pro', feeDiff: '20', creditDiff: '950', hint: true, reviewedOn });
 assert.deepEqual(planInsights(compareArgs({ plan: 'pro_plus' })).larger, { current: 'pro_plus', next: 'pro_max', feeDiff: '60', creditDiff: '3000', hint: true, reviewedOn });
 assert.deepEqual(planInsights(compareArgs({ plan: 'pro_max' })).larger, { current: 'pro_max', next: 'power', feeDiff: '100', creditDiff: '5000', hint: true, reviewedOn });
 // It needs no estimate and no regular forecast: it sits next to the projected-overage line, which a provisional forecast also shows.
 const provisional = view(Array.from({ length: 4 }, (_, i) => snap(`2030-06-0${i + 1}T00:00:00Z`, String(i * 150), { limit: '1000' })), '2030-06-04T00:00:00Z');
 assert.equal(provisional.forecast.tier, 'provisional');
 assert.notEqual(planInsights(compareArgs({ view: provisional, now: '2030-06-04T00:00:00Z' })).larger, null);
});

test('next larger plan: nothing for Power, an unknown plan, no overage, extra credits, stale data or an invalid or hypothetical price list', () => {
 assert.notEqual(planInsights(compareArgs()).larger, null); // control
 assert.equal(planInsights(compareArgs({ plan: 'power' })).larger, null);
 assert.equal(planInsights(compareArgs({ plan: null })).larger, null);
 assert.equal(planInsights(compareArgs({ planSource: 'unknown' })).larger, null);
 const under = view(Array.from({ length: 8 }, (_, i) => snap(`2030-06-0${i + 1}T00:00:00Z`, String(i * 10), { limit: '1000' })), '2030-06-08T00:00:00Z');
 assert.equal(planInsights(compareArgs({ view: under })).larger, null);
 assert.equal(planInsights(compareArgs({ view: overageView('2030-06-08T00:00:00Z', ['unsupported_extra_credits']) })).larger, null);
 assert.equal(planInsights(compareArgs({ view: overageView('2030-06-10T00:00:00Z'), now: '2030-06-10T00:00:00Z' })).larger, null); // stale
 const edit = (change: (c: any) => void) => { const c = structuredClone(reviewedCatalog) as any; change(c); return c; };
 assert.equal(planInsights(compareArgs({ catalog: edit(c => { c.evidence = 'hypothetical'; }) })).larger, null);
 assert.equal(planInsights(compareArgs({ catalog: edit(c => { c.schemaVersion = 2; }) })).larger, null);
 assert.equal(planInsights(compareArgs({ catalog: edit(c => { c.plans[2].fee = 'x'; }) })).larger, null);
 assert.equal(planInsights(compareArgs({ catalog: edit(c => { c.plans[2].fee = '10'; }) })).larger, null); // a larger plan that is not dearer is not shown as such
 assert.equal(planInsights(compareArgs({ catalog: edit(c => { c.plans[2].credits = '500'; }) })).larger, null);
 assert.equal(planInsights(compareArgs({ now: '2020-01-01T00:00:00Z' })).larger, null); // before the price list was verified
 assert.deepEqual(planInsights(compareArgs({ catalog: undefined })).larger, planInsights(compareArgs()).larger); // no catalog given: the reviewed one
});
