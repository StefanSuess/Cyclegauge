import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history } from '../../src/history.ts';
import { view } from '../../src/view.ts';
import { present } from '../../src/extension/presentation.ts';
import { NO_INSIGHTS } from '../../src/cost/plan-hints.ts';
import type { Finding } from '../../src/audit/audit.ts';
import { MAX_BYTES, MAX_COUNT, RESULTS_KEY, aggregateFindings, cycleKey, observedCycleKey, observedTrend, readResults, record, resultsText, validAggregate, type ExclusionAggregate, type ResultsEntry, type StoredResults } from '../../src/extension/results-summary.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

const C1 = '2030-08-01T00:00:00.000Z', C2 = '2030-09-01T00:00:00.000Z', C3 = '2030-10-01T00:00:00.000Z';
const agg = (over: Partial<ExclusionAggregate> = {}): ExclusionAggregate => ({ bytes: 2048, bytesLowerBound: false, items: 3, secrets: 1, ...over });
const entry = (cycle: string, over: Partial<ResultsEntry> = {}): ResultsEntry => ({ cycle, ...agg(), ...over });
const unknown = { status: 'unknown', entries: [] };

test('the key is fixed and nothing else is stored under it', () => {
 assert.equal(RESULTS_KEY, 'cyclegauge.results.v1');
});

test('cycle keys are fixed-format ISO times derived from a billing reset', () => {
 assert.equal(cycleKey('2030-08-01T00:00:00Z'), C1);
 assert.equal(cycleKey('2030-08-01T02:00:00+02:00'), C1);
 for (const bad of [undefined, null, 5, {}, [], '', 'synthetic-cycle', '2030', 'x'.repeat(100), '+275760-09-13T00:00:00.000Z', '2030-13-45T00:00:00Z']) assert.equal(cycleKey(bad), null);
});

test('the observed cycle needs an available history and a reset still in the future', () => {
 const h = history([snapshot('2030-07-10T00:00:00Z', '10', { resetAt: C1 })]);
 assert.equal(observedCycleKey(h, '2030-07-11T00:00:00Z'), C1);
 assert.equal(observedCycleKey(h, C1), null);
 assert.equal(observedCycleKey(h, '2031-01-01T00:00:00Z'), null);
 assert.equal(observedCycleKey(h, 'not-a-time'), null);
 assert.equal(observedCycleKey(history([]), '2030-07-11T00:00:00Z'), null);
 assert.equal(observedCycleKey(history([snapshot('2030-07-10T00:00:00Z', '10', { resetAt: null, resetText: null })]), '2030-07-11T00:00:00Z'), null);
});

test('the validator accepts only a short ascending array of exact well-formed entries', () => {
 assert.deepEqual(readResults(undefined), { status: 'ok', entries: [] });
 assert.deepEqual(readResults([]), { status: 'ok', entries: [] });
 assert.deepEqual(readResults([entry(C1), entry(C2, { bytesLowerBound: true, bytes: 0 })]), { status: 'ok', entries: [entry(C1), entry(C2, { bytesLowerBound: true, bytes: 0 })] });
 assert.deepEqual(readResults(structuredClone([entry(C1)])).entries, [entry(C1)]);
});

test('the validator treats hostile, malformed, newer and oversize values as unknown', () => {
 const bad: unknown[] = [
  null, 0, 'x', true, {}, { v: 2, cycles: [] }, [null], [[]], ['x'], [entry(C1), entry(C2), entry(C3)], // three entries
  [entry(C2), entry(C1)], [entry(C1), entry(C1)], // not strictly ascending
  [{ ...entry(C1), extra: 1 }], [{ ...entry(C1), path: '/synthetic/path' }], [{ cycle: C1, bytes: 1, bytesLowerBound: false, items: 1 }], // extra and missing keys
  [entry('synthetic-cycle')], [entry('2030-08-01T00:00:00Z')], [entry(C1, { cycle: undefined as unknown as string })],
  [entry(C1, { bytes: -1 })], [entry(C1, { bytes: 1.5 })], [entry(C1, { bytes: NaN })], [entry(C1, { bytes: Infinity })], [entry(C1, { bytes: MAX_BYTES + 2 })],
  [entry(C1, { bytes: '5' as unknown as number })], [entry(C1, { items: MAX_COUNT + 1 })], [entry(C1, { items: -1 })], [entry(C1, { secrets: 4 })], // more secrets than items
  [entry(C1, { secrets: -1 })], [entry(C1, { bytesLowerBound: 1 as unknown as boolean })], [entry(C1, { bytesLowerBound: 'false' as unknown as boolean })],
  JSON.parse('[{"cycle":"2030-08-01T00:00:00.000Z","bytes":1,"bytesLowerBound":false,"items":1,"secrets":0,"__proto__":{"x":1}}]'),
  JSON.parse('[{"__proto__":{"cycle":"2030-08-01T00:00:00.000Z"},"bytes":1,"bytesLowerBound":false,"items":1,"secrets":0,"cycle":"2030-08-01T00:00:00.000Z"}]'),
  [Object.create(entry(C1))], [Object.assign(Object.create(null), { cycle: C1, bytes: 1, bytesLowerBound: false, items: 1, secrets: 0, constructor: 1 })],
  [new (class { cycle = C1; bytes = 1; bytesLowerBound = false; items = 1; secrets = 0; })()],
  Object.assign([entry(C1)], { extra: 1 }), new Array(2), Object.assign(new Array(1), { 0: undefined }),
 ];
 for (const value of bad) assert.deepEqual(readResults(value), unknown, JSON.stringify(value));
 let ran = false;
 const getter = { cycle: C1, bytes: 1, bytesLowerBound: false, items: 1, get secrets() { ran = true; return 0; } };
 assert.deepEqual(readResults([getter]), unknown); assert.equal(ran, false, 'a getter is never run');
 const huge = Array.from({ length: 100_000 }, () => entry(C1));
 assert.deepEqual(readResults(huge), unknown);
});

test('record adds under the cycle, saturates, and keeps only the two newest cycles', () => {
 let store = record([], C1, agg());
 assert.deepEqual(store, [entry(C1)]);
 store = record(store, C1, agg({ bytes: 10, items: 2, secrets: 0 }));
 assert.deepEqual(store, [entry(C1, { bytes: 2058, items: 5, secrets: 1 })]);
 const before = store;
 store = record(store, C2, agg({ bytesLowerBound: true }));
 assert.deepEqual(store.map(e => e.cycle), [C1, C2]); assert.equal(store[1]!.bytesLowerBound, true); assert.equal(store[0]!.bytesLowerBound, false);
 assert.deepEqual(before, [entry(C1, { bytes: 2058, items: 5, secrets: 1 })], 'the input store is not mutated');
 store = record(store, C3, agg());
 assert.deepEqual(store.map(e => e.cycle), [C2, C3]);
 assert.deepEqual(record(store, C1, agg()).map(e => e.cycle), [C2, C3], 'an older cycle than both kept ones is pruned at once');
 assert.deepEqual(readResults(store), { status: 'ok', entries: store }, 'what record produces always validates');
 const sat = record([entry(C1, { bytes: MAX_BYTES - 1, items: MAX_COUNT - 1, secrets: MAX_COUNT - 1 })], C1, agg({ bytes: 100, items: 100, secrets: 100 }));
 assert.deepEqual(sat, [entry(C1, { bytes: MAX_BYTES, bytesLowerBound: true, items: MAX_COUNT, secrets: MAX_COUNT })]);
 assert.deepEqual(readResults(sat).status, 'ok');
});

test('record refuses a malformed cycle or aggregate and returns the store unchanged', () => {
 const store = [entry(C1)];
 for (const cycle of ['', 'synthetic-cycle', '2030-08-01T00:00:00Z', C1 + ' ']) assert.equal(record(store, cycle, agg()), store);
 for (const bad of [{ ...agg(), extra: 1 }, agg({ bytes: -1 }), agg({ items: 1.5 }), agg({ secrets: 9 }), null, 'x'] as unknown[]) assert.equal(record(store, C2, bad as ExclusionAggregate), store);
 assert.equal(validAggregate({ ...agg(), cycle: C1 }), undefined);
});

const finding = (over: Partial<Finding>): Finding => ({ path: 'synthetic/a', isDir: false, category: 'log', coverage: 'not_covered', suggestion: '/synthetic/a', ...over });

test('accepted findings aggregate to bytes with a lower bound, an item count and a secret count', () => {
 assert.deepEqual(aggregateFindings([finding({ size: 100 }), finding({ path: 'synthetic/b', size: 50, category: 'secret' })]), { bytes: 150, bytesLowerBound: false, items: 2, secrets: 1 });
 // A pruned folder has no size: the total is a minimum, never presented as exact or zero.
 assert.deepEqual(aggregateFindings([finding({ path: 'synthetic/dist', isDir: true, category: 'build' }), finding({ path: 'synthetic/x', size: 7, category: 'secret' })]), { bytes: 7, bytesLowerBound: true, items: 2, secrets: 1 });
 assert.deepEqual(aggregateFindings([finding({ path: 'synthetic/dist', isDir: true, category: 'build' })]), { bytes: 0, bytesLowerBound: true, items: 1, secrets: 0 });
 // A file inside a counted folder is counted as an item but its size is already in the folder's.
 assert.deepEqual(aggregateFindings([finding({ path: 'synthetic/dist', isDir: true, category: 'build', size: 1000 }), finding({ path: 'synthetic/dist/a.log', size: 400 })]), { bytes: 1000, bytesLowerBound: false, items: 2, secrets: 0 });
 // Unclear findings and findings without a suggestion: only suggestions that were actually accepted count.
 assert.deepEqual(aggregateFindings([finding({ coverage: 'unknown', size: 5 }), finding({ path: 'synthetic/n', suggestion: '', size: 99 })]), { bytes: 5, bytesLowerBound: false, items: 1, secrets: 0 });
 assert.deepEqual(aggregateFindings([]), { bytes: 0, bytesLowerBound: false, items: 0, secrets: 0 });
 assert.deepEqual(aggregateFindings([finding({ size: Number.MAX_SAFE_INTEGER }), finding({ path: 'synthetic/b', size: 10 })]), { bytes: MAX_BYTES, bytesLowerBound: true, items: 2, secrets: 0 });
});

// Daily snapshots of one invented cycle (one far-off reset, so a long run stays inside one cycle).
const DAY = 86400000, START = Date.parse('2030-06-01T00:00:00Z'), RESET = '2031-01-01T00:00:00.000Z';
const at = (ms: number) => new Date(ms).toISOString();
const series = (usages: (string | null)[], changes: (i: number) => object = () => ({})) =>
 usages.map((u, i) => snapshot(at(START + i * DAY), u as string, { resetAt: RESET, ...changes(i) }));
const usage = (i: number) => String(i <= 31 ? 2 * i : 62 + 5 * (i - 31));
const days60 = Array.from({ length: 60 }, (_, i) => usage(i));

test('the observed trend compares per observed day over two 28-day windows with exact decimals', () => {
 const t = observedTrend(history(series(days60)));
 assert.deepEqual(t, { status: 'observed', asOf: at(START + 59 * DAY), recent: '5', earlier: '2', difference: '3' });
 // Exact decimals: nothing passes through a binary float.
 const tenths = Array.from({ length: 60 }, (_, i) => i <= 31 ? `${i}.1` : `${31 + (i - 31) * 3}.3`);
 // earlier: (31.1 - 3.1) / 28 = 1; recent: (115.3 - 31.1) / 28 = 3.007142857..., truncated to 6 places
 assert.deepEqual(observedTrend(history(series(tenths))), { status: 'observed', asOf: at(START + 59 * DAY), recent: '3.007142', earlier: '1', difference: '2.007142' });
 const big = Array.from({ length: 60 }, (_, i) => `123456789012345678901234567890.${String(i).padStart(2, '0')}`);
 const bt = observedTrend(history(series(big)));
 assert.equal(bt.status, 'observed'); assert.equal(bt.recent, '0.01'); assert.equal(bt.earlier, '0.01'); assert.equal(bt.difference, '0');
 const falling = observedTrend(history(series(Array.from({ length: 60 }, (_, i) => String(i <= 31 ? 5 * i : 155 + 2 * (i - 31))))));
 assert.equal(falling.recent, '2'); assert.equal(falling.earlier, '5'); assert.equal(falling.difference, '-3');
 const zero = observedTrend(history(series(Array.from({ length: 60 }, () => '10'))));
 assert.deepEqual([zero.status, zero.recent, zero.earlier, zero.difference], ['observed', '0', '0', '0']);
});

test('the trend is not observed without history, intervals or two windows of comparable coverage', () => {
 assert.equal(observedTrend(history([])).status, 'not_observed');
 assert.equal(observedTrend(history(series(['5']))).status, 'not_observed');
 assert.equal(observedTrend(history(series(days60.slice(0, 40)))).status, 'not_observed'); // the earlier window is mostly before the history
 assert.equal(observedTrend(history(series(days60.slice(0, 20)))).status, 'not_observed');
 const two = [snapshot('2030-06-01T00:00:00Z', '1', { partition: 'synthetic-a', resetAt: RESET }), snapshot('2030-06-02T00:00:00Z', '2', { partition: 'synthetic-b', resetAt: RESET })];
 assert.equal(observedTrend(history(two)).status, 'not_observed');
 assert.equal(observedTrend(history(series(days60).map(s => ({ ...s, associated: false })))).status, 'not_observed');
 // A long interval across the window edge is not prorated, so the earlier window loses its coverage.
 const edge = series(days60); edge.splice(20, 21); // one 22-day interval straddles the edge between the windows
 assert.equal(observedTrend(history(edge)).status, 'not_observed');
});

test('the trend needs 70 percent of each window, to the hour', () => {
 const end = START + 100 * DAY, boundary = end - 28 * DAY, HOUR = 3600000;
 const build = (leadHours: number) => {
  const times = [boundary - leadHours * HOUR, boundary];
  for (let t = boundary + DAY; t <= end; t += DAY) times.push(t);
  return times.map((t, i) => snapshot(at(t), String(i), { resetAt: '2032-01-01T00:00:00.000Z' }));
 };
 assert.equal(observedTrend(history(build(470))).status, 'not_observed'); // 470 h of 672 h is 69.9 %
 assert.equal(observedTrend(history(build(471))).status, 'observed'); // 471 h is 70.1 %
});

test('the trend falls back to not comparable for every quality barrier', () => {
 const adjusted = series(days60); adjusted[45] = { ...adjusted[45]!, usage: '1' }; // the counter goes back
 assert.equal(observedTrend(history(adjusted)).status, 'not_comparable');
 const limit = series(days60, i => i >= 30 ? { limit: '2000' } : {});
 assert.equal(observedTrend(history(limit)).status, 'not_comparable');
 const extra = series(days60, i => i === 20 ? { flags: ['unsupported_extra_credits'] } : {});
 assert.equal(observedTrend(history(extra)).status, 'not_comparable');
 const resetless = series(days60, i => i < 10 ? { resetAt: null, resetText: null } : {});
 assert.equal(observedTrend(history(resetless)).status, 'not_comparable');
 const conflict = series(days60); conflict.push({ ...conflict[30]!, usage: '999' });
 assert.equal(observedTrend(history(conflict)).status, 'not_comparable');
 const reduced = series(days60.map((_, i) => i < 40 ? '10' : days60[i]!), () => ({ flags: ['reduced_precision'] })); reduced.splice(20, 2); // an unchanged multi-day span at reduced precision
 assert.equal(observedTrend(history(reduced)).status, 'not_comparable');
 assert.equal(observedTrend(history(series(days60, i => i === 0 ? { limit: '10' } : {}))).status, 'not_comparable');
});

// Rendering through present(): static, script-free and escaped.
const NOW = at(START + 59 * DAY + 3600000);
const render = (results: StoredResults | undefined, snaps = series(days60)) =>
 present(view(snaps, NOW), [], '', '', undefined, NOW, false, NO_INSIGHTS, '', results).html;
const section = (html: string) => /<section id="results-summary"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

test('the summary section is headed, scoped, escaped and static', () => {
 const html = render({ status: 'ok', entries: [entry(C1, { bytes: 3 * 1024 * 1024, bytesLowerBound: true }), entry(C2, { bytes: 0, bytesLowerBound: true, items: 2, secrets: 0 })] });
 const s = section(html);
 assert.match(s, /<h2 id="results-summary-heading">Your Cyclegauge summary<\/h2>/);
 assert.match(s, /aria-labelledby="results-summary-heading"/);
 assert.match(s, /covers at most the two most recent billing cycles/);
 assert.match(s, /<h3>Exclusions you saved<\/h3>/);
 assert.match(s, /3 items \(1 possible secret\), at least 3\.0 MiB\./);
 assert.match(s, /2 items \(0 possible secrets\), size unknown\./);
 assert.match(s, /resetting 1 Aug 2030 \(UTC\)/);
 assert.match(s, /not what Kiro can read today/);
 assert.match(s, /&quot;at least&quot; or &quot;size unknown&quot; is only a minimum, never zero/);
 assert.match(s, /Other cycle, resetting 1 Aug 2030 \(UTC\)/); assert.ok(!/No billing cycle is observed right now/.test(s));
 assert.match(s, /<h3>Observed use trend<\/h3><p>Observed use: 5 credits per observed day over the 28 days to 2030-07-30T00:00:00\.000Z, against 2 credits per observed day in the 28 days before, higher by 3\. This is an observation only; the cause is open\.<\/p>/);
 assert.ok(!/<script|style=|\son\w+=/i.test(html));
 assert.ok(!/saved credits|you saved \d|plan change|changed your plan|reduced your/i.test(text(s)));
 assert.ok(html.indexOf('id="usage-context"') < html.indexOf('id="results-summary"'));
});

test('the summary labels the current cycle, the not observed trend and an empty or unreadable store', () => {
 const current = render({ status: 'ok', entries: [entry('2031-01-01T00:00:00.000Z')] });
 assert.match(section(current), /This cycle, resetting 1 Jan 2031 \(UTC\): 3 items \(1 possible secret\), about 2 KiB\./);
 assert.ok(!/No billing cycle is observed right now/.test(section(current)));
 const empty = section(render({ status: 'ok', entries: [] }, series(days60.slice(0, 10))));
 assert.match(empty, /No exclusions saved yet\./); assert.match(empty, /Observed use trend: not observed\. Each 28-day window needs at least 70% of its time covered/);
 const none = section(render({ status: 'ok', entries: [entry(C1)] }, []));
 assert.match(none, /Other cycle, resetting 1 Aug 2030 \(UTC\)/); assert.match(none, /No billing cycle is observed right now, so exclusions saved now are not counted\./);
 const bad = section(render({ status: 'unknown', entries: [] }));
 assert.match(bad, /could not be read, so none are shown/); assert.ok(!/not what Kiro can read today/.test(bad));
 const barrier = series(days60); barrier[45] = { ...barrier[45]!, usage: '1' };
 assert.match(section(render({ status: 'ok', entries: [] }, barrier)), /Observed use trend: not comparable because/);
});

test('no section without a results parameter, and hostile entries are escaped or omitted', () => {
 assert.equal(section(render(undefined)), '');
 assert.equal(present(view(series(days60), NOW), [], '', '', undefined, NOW).html.includes('id="results-summary"'), false);
 const hostile = { status: 'ok', entries: [{ ...entry(C1), cycle: '<b onload="x">' }] } as StoredResults;
 const html = render(hostile);
 assert.ok(!html.includes('<b onload'));
 assert.equal(section(html), '');
 const t = resultsText({ status: 'ok', entries: [] }, history(series(days60)), NOW);
 assert.equal(t.heading, 'Your Cyclegauge summary');
});
