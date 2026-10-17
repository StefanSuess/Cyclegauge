import assert from 'node:assert/strict';
import test from 'node:test';
import { view } from '../../src/view.ts';
import { decideBudgetNotice, readBudgetState, type BudgetInput } from '../../src/extension/budget-warning.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

const RESET = '2030-07-01T00:00:00.000Z';
const NOW = '2030-06-08T00:00:00Z';
// Eight daily synthetic updates, 2030-06-01 .. 2030-06-08, usage = day index * rate (or a constant), reset 2030-07-01.
const series = (usage: (i: number) => string, limit: string) => Array.from({ length: 8 }, (_, i) => snapshot(`2030-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`, usage(i), { limit }));
const rate = (r: number, limit: string, now = NOW) => view(series(i => String(i * r), limit), now);
const flat = (usage: string, limit: string, now = NOW) => view(series(() => usage, limit), now);
const decide = (v: ReturnType<typeof view>, extra: Partial<BudgetInput> = {}) => decideBudgetNotice({ view: v, eligible: v.forecast.status === 'qualified' && v.status === 'observed', now: NOW, state: undefined, enabled: true, percent: 80, ...extra });

test('forecast: a qualified fresh forecast that reaches the limit before the reset', () => {
 const n = decide(rate(10, '100'))!; // usage 70 of 100, 10 a day: empty on 11 Jun
 assert.equal(n.kind, 'forecast');
 assert.equal(n.text, 'At this pace your Kiro credits run out on 11 Jun 2030, 20 days before the reset. If you continue at this pace: about 200 credits over the limit ≈ $8.00 by the reset, at $0.04 per credit (price list reviewed 10 Oct 2026; modelled, not an invoice; whether overage applies depends on your plan and settings).');
 assert.deepEqual(n.state, { cycle: RESET, done: ['forecast'] });
 assert.equal(decide(rate(10, '100'), { eligible: false }), null); // an ineligible forecast says nothing about exhaustion
 assert.equal(decide(rate(10, '1000')), null); // enough capacity: nothing
 assert.equal(decide(rate(0, '100')), null);
});

test('percent: usage reaches the configured share of the reported limit', () => {
 const n = decide(flat('85', '100'))!;
 assert.equal(n.kind, 'percent');
 assert.equal(n.text, 'You have used 85% of your reported Kiro credits (85 of 100); the reset is in 23 days.');
 assert.deepEqual(n.state, { cycle: RESET, done: ['percent'] });
 assert.equal(decide(flat('79', '100')), null);
 assert.equal(decide(flat('80', '100'))!.kind, 'percent'); // exactly at the share
 assert.equal(decide(flat('50', '100'), { percent: 50 })!.kind, 'percent');
 assert.equal(decide(flat('50', '100'), { percent: 51 }), null);
 assert.equal(decide(flat('99.9', '100'))!.text.startsWith('You have used 99% '), true); // never rounds up to a claim of more than used
 assert.equal(decide(flat('85', '100'), { eligible: false })!.kind, 'percent'); // fresh observation is enough for percent
});

test('limit: usage at or above the reported limit, with the projected cost when a price is validated', () => {
 const n = decide(rate(10, '70'))!;
 assert.equal(n.kind, 'limit');
 assert.equal(n.text, 'You have reached the reported Kiro credit limit (70 of 70); the reset is in 23 days. If you continue at this pace: about 230 credits over the limit ≈ $9.20 by the reset, at $0.04 per credit (price list reviewed 10 Oct 2026; modelled, not an invoice; whether overage applies depends on your plan and settings).');
 assert.deepEqual(n.state, { cycle: RESET, done: ['limit', 'percent'] });
 const noCost = decide(flat('100', '100'))!; // zero observed rate: nothing projected over the limit
 assert.equal(noCost.kind, 'limit');
 assert.equal(noCost.text, 'You have reached the reported Kiro credit limit (100 of 100); the reset is in 23 days.');
 assert.equal(decide(flat('120', '100'))!.kind, 'limit'); // above the limit is also reached
 assert.equal(decide(flat('120', '100'), { eligible: false })!.kind, 'limit');
});

test('each kind fires once per billing cycle and a new cycle starts again', () => {
 const v = rate(10, '100');
 const first = decide(v)!;
 assert.equal(decide(v, { state: first.state }), null);
 // A new observed reset instant is a new cycle, whatever was stored.
 const next = view(series(i => String(i * 10), '100').map(s => ({ ...s, resetAt: '2030-07-02T00:00:00.000Z' })), NOW);
 const again = decide(next, { state: first.state })!;
 assert.equal(again.kind, 'forecast');
 assert.deepEqual(again.state, { cycle: '2030-07-02T00:00:00.000Z', done: ['forecast'] });
 const limit = decide(flat('100', '100'))!;
 assert.equal(decide(flat('100', '100'), { state: limit.state }), null);
});

test('only the most severe due notice is shown and the others are marked done', () => {
 // 70 of 85 is 82 percent and empty before the reset: forecast and percent are both due.
 const both = decide(rate(10, '85'))!;
 assert.equal(both.kind, 'forecast');
 assert.deepEqual(both.state.done, ['forecast', 'percent']);
 assert.equal(decide(rate(10, '85'), { state: both.state }), null);
 // An earlier percent notice does not block the more severe forecast.
 const later = decide(rate(10, '85'), { state: { cycle: RESET, done: ['percent'] } })!;
 assert.equal(later.kind, 'forecast');
 assert.deepEqual(later.state.done, ['forecast', 'percent']);
 // A less severe kind never follows a more severe one in the same cycle.
 assert.equal(decide(flat('85', '100'), { state: { cycle: RESET, done: ['forecast'] } }), null);
 assert.equal(decide(flat('85', '100'), { state: { cycle: RESET, done: ['limit'] } }), null);
 assert.equal(decide(rate(10, '70'), { state: { cycle: RESET, done: ['forecast'] } })!.kind, 'limit');
});

test('stale, future, elapsed, unavailable and ineligible observations give nothing', () => {
 assert.equal(decide(rate(10, '100', '2030-06-10T00:00:00Z'), { now: '2030-06-10T00:00:00Z' }), null); // stale
 assert.equal(decide(view([], NOW)), null);
 assert.equal(decide(rate(10, '100', '2030-07-02T00:00:00Z'), { now: '2030-07-02T00:00:00Z' }), null); // reset passed
 assert.equal(decide(rate(10, '100', '2030-06-07T00:00:00Z'), { now: '2030-06-07T00:00:00Z' }), null); // future observation
 const mixed = series(i => String(i * 10), '100'); mixed[2]!.partition = 'synthetic-other';
 assert.equal(decide(view(mixed, NOW)), null);
 const noLimit = view(series(() => '90', '100').map(s => ({ ...s, limit: null as unknown as string })), NOW);
 assert.equal(decide(noLimit), null);
 assert.equal(decide(flat('10', '0')), null); // a zero limit has no meaningful share
});

test('the percent setting 0 turns that notice off; the switch turns everything off', () => {
 assert.equal(decide(flat('85', '100'), { percent: 0 }), null);
 assert.equal(decide(rate(10, '100'), { percent: 0 })!.kind, 'forecast');
 assert.equal(decide(flat('100', '100'), { percent: 0 })!.kind, 'limit');
 assert.equal(decide(flat('100', '100'), { enabled: false }), null);
 assert.equal(decide(rate(10, '100'), { enabled: false }), null);
 for (const bad of [Number.NaN, 80.5, -1]) assert.equal(decide(flat('85', '100'), { percent: bad }), null, String(bad)); // the reader already normalises; anything else is off
});

test('stored state is read strictly: wrong shapes, other cycles and unknown kinds are empty', () => {
 for (const raw of [undefined, null, 5, 'x', [], {}, { cycle: RESET }, { cycle: RESET, done: 'limit' }, { cycle: 'other', done: ['limit'] }, { done: ['limit'] }]) assert.deepEqual(readBudgetState(raw, RESET), { cycle: RESET, done: [] }, JSON.stringify(raw));
 assert.deepEqual(readBudgetState({ cycle: RESET, done: ['percent', 'bogus', 7, 'limit', 'percent'] }, RESET), { cycle: RESET, done: ['limit', 'percent'] });
 assert.equal(decide(flat('85', '100'), { state: { cycle: RESET, done: 'percent' } })!.kind, 'percent'); // garbage does not suppress a notice
});

test('the stored state and the notices carry no identifiers or private values', () => {
 const n = decide(rate(10, '85'))!;
 assert.deepEqual(Object.keys(n.state).sort(), ['cycle', 'done']);
 assert.ok(!JSON.stringify([n.state, n.text]).includes('synthetic'));
});

test('a provisional forecast (too little history) gives no forecast notice and no projected cost', () => {
 const provisional = view(series(i => String(i * 10), '100').slice(0, 5), '2030-06-05T00:00:00Z'); // 5 updates over 4 days
 assert.equal(provisional.forecast.tier, 'provisional');
 const input = { now: '2030-06-05T00:00:00Z' };
 assert.equal(decide(provisional, input), null); // 40 of 100, empty on 10 Jun, but only an early estimate
 // Observed usage still counts: percent and limit notices need no forecast, and a limit notice carries no projected cost from a provisional rate.
 const nearly = view(series(i => String(i * 20), '100').slice(0, 5), '2030-06-05T00:00:00Z'); // 80 of 100
 assert.equal(decide(nearly, input)!.kind, 'percent');
 const reached = view(series(i => String(i * 25), '100').slice(0, 5), '2030-06-05T00:00:00Z'); // 100 of 100
 const n = decide(reached, input)!;
 assert.equal(n.kind, 'limit');
 assert.equal(n.text, 'You have reached the reported Kiro credit limit (100 of 100); the reset is in 26 days.');
});

test('accounts with unsupported extra credits get no notice of any kind', () => {
 const flagged = (v: ReturnType<typeof view>) => ({ ...v, flags: [...v.flags, 'unsupported_extra_credits'] });
 for (const v of [flat('85', '100'), flat('100', '100'), rate(10, '100'), rate(10, '70')]) {
  assert.notEqual(decide(v), null); // each would show a notice without the flag
  assert.equal(decide(flagged(v)), null);
 }
 const fromData = view(series(() => '100', '100').map(s => ({ ...s, flags: ['unsupported_extra_credits'] })), NOW);
 assert.equal(decide(fromData), null);
});

test('the displayed percent is computed exactly and can never be below the threshold that fired', () => {
 // 4.35 / 5 is exactly 87 percent; a floating-point division would give 86.99999999999999.
 const n = decide(flat('4.35', '5'), { percent: 87 })!;
 assert.equal(n.kind, 'percent');
 assert.ok(n.text.startsWith('You have used 87% of your reported Kiro credits (4 of 5);'), n.text);
 assert.equal(decide(flat('4.34', '5'), { percent: 87 }), null);
 for (const [usage, limit, percent] of [['0.7', '1', 70], ['2.9', '10', 29], ['5.8', '20', 29], ['1.15', '5', 23]] as const) {
  const m = decide(flat(usage, limit), { percent })!;
  assert.ok(m.text.startsWith(`You have used ${percent}% `), m.text);
 }
});
