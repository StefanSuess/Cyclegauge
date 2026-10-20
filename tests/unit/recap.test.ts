import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history } from '../../src/history.ts';
import { view } from '../../src/view.ts';
import { RECAP_KEY, RECAP_LINK_TEXT, RECAP_TITLE, computeRecap, nextRecapState, readRecap, recapText, recapVisibility, type Recap, type StoredRecap } from '../../src/extension/recap.ts';
import { present } from '../../src/extension/presentation.ts';
import { recapSection } from '../../src/extension/recap-presentation.ts';
import { buildDomModel } from '../../src/extension/dashboard-shell.ts';
import type { StoredResults } from '../../src/extension/results-summary.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

const R0 = '2030-06-01T00:00:00.000Z', R1 = '2030-07-01T00:00:00.000Z', R2 = '2030-08-01T00:00:00.000Z', RQ = '2030-05-01T00:00:00.000Z';
const at = (when: string, usage: string, reset: string, extra: object = {}) => snapshot(when, usage, { resetAt: reset, resetText: reset, ...extra });
const NO_RESULTS: StoredResults = { status: 'ok', entries: [] };
// cycle before (resets 06-01), previous cycle (resets 07-01), current cycle (resets 08-01); a snapshot from the cycle before the first gives it a start
const cycleBefore = () => [at('2030-04-20T00:00:00.000Z', '100', RQ), at('2030-05-01T06:00:00.000Z', '20', R0), at('2030-05-15T00:00:00.000Z', '200', R0), at('2030-05-31T20:00:00.000Z', '500', R0)];
const previousCycle = () => [at('2030-06-01T06:00:00.000Z', '30', R1), at('2030-06-10T00:00:00.000Z', '300', R1), at('2030-06-10T12:00:00.000Z', '400', R1), at('2030-06-30T20:00:00.000Z', '900', R1)];
const current = () => [at('2030-07-01T06:00:00.000Z', '10', R2)];
const recapOf = (snaps: ReturnType<typeof snapshot>[], results = NO_RESULTS, link = true) => computeRecap(history(snaps), results, link);

test('the full recap names each figure with its basis and carries the Open VSX text', () => {
 const r = recapOf([...cycleBefore(), ...previousCycle(), ...current()])!;
 assert.equal(r.cycle, R2);
 assert.equal(r.period, 'Cycle that ended 1 Jul 2030 (UTC). Figures come from the account updates Bobert observed; it is not a bill.');
 assert.deepEqual(r.lines, [
  'Credits used: 900 of 1000 reported credits, as of 30 Jun 2030, 20:00 UTC.',
  'Lasted until the reset: yes. Usage below the reported limit was observed within 6 hours before the reset.',
  'Use compared with the cycle before: average 30.167597 credits per day over the observed part of the cycle, against 16.216216 in the cycle before, higher by 13.951381. This is an observation only; the cause is open.',
  'Exclusions you saved in that cycle: none counted.',
  'Busiest observed day (partial observation): 10 Jun 2030 (UTC), 100 credits in 12 h 0 min of observed updates.',
  RECAP_LINK_TEXT]);
 assert.equal(recapText(r), [RECAP_TITLE, r.period, ...r.lines].join('\n'));
 assert.equal(recapOf([...cycleBefore(), ...previousCycle(), ...current()], NO_RESULTS, false)!.lines.includes(RECAP_LINK_TEXT), false, 'the link text can be switched off');
 assert.ok(!/synthetic-private-account|partition|\/|\\/.test(recapText({ ...r, lines: r.lines.slice(0, -1) })), 'no identifier or path');
});

test('lasted until the reset: no when the limit was reached, yes only within six hours, otherwise unknown', () => {
 const lasted = (prev: ReturnType<typeof snapshot>[]) => recapOf([...cycleBefore(), ...prev, ...current()])!.lines[1];
 assert.match(lasted([...previousCycle().slice(0, 3), at('2030-06-20T00:00:00.000Z', '1000', R1), at('2030-06-30T20:00:00.000Z', '1200', R1)].sort((a, b) => a.observedAt < b.observedAt ? -1 : 1)), /^Lasted until the reset: no\. Usage at or above the reported limit was observed on 20 Jun 2030 \(UTC\)\.$/);
 assert.match(lasted([...previousCycle().slice(0, 3), at('2030-06-30T17:59:59.000Z', '900', R1)]), /^Lasted until the reset: unknown\. No update below the reported limit was observed within 6 hours/);
 assert.match(lasted([...previousCycle().slice(0, 3), at('2030-06-30T18:00:00.000Z', '900', R1)]), /^Lasted until the reset: yes\./);
 // Usage exactly at the limit is "at or above".
 assert.match(lasted([...previousCycle().slice(0, 3), at('2030-06-30T20:00:00.000Z', '1000', R1)]), /^Lasted until the reset: no\./);
});

test('use compared with the cycle before is not observed, not comparable or exact', () => {
 const trend = (snaps: ReturnType<typeof snapshot>[]) => recapOf(snaps)!.lines[2];
 // Only two cycles with a known start: the cycle before is missing entirely.
 assert.equal(trend([at('2030-05-20T00:00:00.000Z', '100', R0), ...previousCycle(), ...current()]), 'Use compared with the cycle before: not observed. The cycle before was not seen from its start.');
 // A counter decrease in the older cycle is a quality barrier for the whole comparison.
 assert.match(trend([...cycleBefore().slice(0, 2), at('2030-05-15T00:00:00.000Z', '5', R0), at('2030-05-31T20:00:00.000Z', '500', R0), ...previousCycle(), ...current()]), /^Use compared with the cycle before: not comparable because the retained account updates contain a quality barrier/);
 // Same observed length (29 d 20 h) in both cycles: exact rates, then equal, higher and lower.
 const before = (last: string) => [at('2030-04-20T00:00:00.000Z', '100', RQ), at('2030-05-01T06:00:00.000Z', '30', R0), at('2030-05-30T20:00:00.000Z', last, R0)];
 assert.match(trend([...before('900'), ...previousCycle(), ...current()]), /average 30\.167597 credits per day over the observed part of the cycle, against 30\.167597 in the cycle before, unchanged\. This is an observation only/);
 assert.match(trend([...before('950'), ...previousCycle(), ...current()]), /against 31\.843575 in the cycle before, lower by 1\.675978\./);
 assert.match(trend([...before('600'), ...previousCycle(), ...current()]), /against 20\.111731 in the cycle before, higher by 10\.055866\./);
});

test('exclusions saved in that cycle come from the stored per-cycle values and every unreadable case is named', () => {
 const snaps = [...cycleBefore(), ...previousCycle(), ...current()];
 const line = (results: StoredResults) => recapOf(snaps, results)!.lines[3];
 assert.equal(line({ status: 'ok', entries: [{ cycle: R1, bytes: 2048, bytesLowerBound: false, items: 3, secrets: 1 }] }), 'Exclusions you saved in that cycle: 3 items (1 possible secret), about 2 KiB.');
 assert.equal(line({ status: 'ok', entries: [{ cycle: R1, bytes: 0, bytesLowerBound: true, items: 1, secrets: 0 }] }), 'Exclusions you saved in that cycle: 1 item (0 possible secrets), size unknown.');
 assert.equal(line({ status: 'ok', entries: [{ cycle: R2, bytes: 5, bytesLowerBound: false, items: 1, secrets: 0 }] }), 'Exclusions you saved in that cycle: none counted.', 'another cycle is not counted');
 assert.equal(line({ status: 'unknown', entries: [] }), 'Exclusions you saved in that cycle: not available because the saved summary could not be read.');
});

test('busiest observed day is a partial observation, with a not-observed case', () => {
 // Resets at 08:00 UTC, so the first update after the start crosses midnight and no interval lies within one UTC day.
 const [S0, S1, S2] = ['2030-06-01T08:00:00.000Z', '2030-07-01T08:00:00.000Z', '2030-08-01T08:00:00.000Z'];
 const sparse = [at('2030-05-20T00:00:00.000Z', '100', S0), at('2030-06-02T07:00:00.000Z', '30', S1), at('2030-06-12T00:00:00.000Z', '300', S1), at('2030-07-01T03:00:00.000Z', '900', S1), at('2030-07-01T09:00:00.000Z', '10', S2)];
 const r = recapOf(sparse)!;
 assert.equal(r.lines[4], 'Busiest observed day (partial observation): not observed. No day with observed use was recorded in same-day updates.');
 assert.ok(r.lines[1].startsWith('Lasted until the reset: yes'), 'an update three hours before the reset');
 assert.match(r.lines[2], /not observed\. The cycle before was not seen from its start\./);
});

test('busiest observed day: the largest same-day net change wins and the earlier day wins a tie', () => {
 const day = (...rows: [string, string][]) => rows.map(([when, usage]) => at(when, usage, R1));
 const line = (prev: ReturnType<typeof snapshot>[]) => recapOf([...cycleBefore(), ...prev, ...current()])!.lines[4];
 // 06-01: 0 to 10 (6 h from the start), 06-05: 10 credits in 1.5 h; the span between is not spread over any day.
 const tie = day(['2030-06-01T06:00:00.000Z', '10'], ['2030-06-05T00:00:00.000Z', '100'], ['2030-06-05T01:30:00.000Z', '110'], ['2030-06-30T20:00:00.000Z', '300']);
 assert.equal(line(tie), 'Busiest observed day (partial observation): 1 Jun 2030 (UTC), 10 credits in 6 h 0 min of observed updates.');
 const larger = day(['2030-06-01T06:00:00.000Z', '10'], ['2030-06-05T00:00:00.000Z', '100'], ['2030-06-05T01:30:00.000Z', '110'], ['2030-06-08T00:00:00.000Z', '200'], ['2030-06-08T05:00:00.000Z', '250'], ['2030-06-30T20:00:00.000Z', '300']);
 assert.equal(line(larger), 'Busiest observed day (partial observation): 8 Jun 2030 (UTC), 50 credits in 5 h 0 min of observed updates.');
});

test('no recap without a previous cycle with an evidence-backed start, an unbroken counter chain and a known limit', () => {
 assert.equal(computeRecap(history([]), NO_RESULTS, true), null);
 assert.equal(recapOf([...previousCycle()]), null, 'one cycle only');
 assert.equal(recapOf([...previousCycle(), ...current()]), null, 'the previous cycle has no observed start');
 assert.equal(recapOf([at('2030-06-01T01:00:00.000Z', '5', R0), ...previousCycle(), ...current()]), null, 'the only earlier update was observed after its own reset time, so it proves no start');
 assert.equal(recapOf([...cycleBefore(), at('2030-06-01T06:00:00.000Z', '30', R1), at('2030-06-10T00:00:00.000Z', '10', R1), at('2030-06-30T20:00:00.000Z', '900', R1), ...current()]), null, 'a counter decrease breaks the chain');
 assert.equal(recapOf([...cycleBefore().map(s => ({ ...s, limit: '500' })), ...previousCycle(), ...current()]), null, 'a limit change before the previous cycle stops the evidence, so its start is not proven');
 assert.equal(recapOf([...cycleBefore(), ...previousCycle().map(s => ({ ...s, limit: null, flags: ['missing_limit'] })), ...current()]), null, 'unknown limit');
 assert.equal(recapOf([...cycleBefore(), ...previousCycle(), at('2030-07-01T06:00:00.000Z', '10', R2), at('2030-07-01T06:00:00.000Z', '11', R2)]), null, 'a conflicting latest observation makes the history unavailable');
 assert.equal(recapOf([snapshot('2030-06-01T00:00:00.000Z', '1', { partition: 'synthetic-a' }), snapshot('2030-06-02T00:00:00.000Z', '1', { partition: 'synthetic-b' })]), null);
});

test('the stored state validator accepts only the exact shape and treats everything else as unknown', () => {
 assert.equal(RECAP_KEY, 'bobert.recap.v1');
 assert.deepEqual(readRecap(undefined), { status: 'ok', value: null });
 assert.deepEqual(readRecap({ cycle: R2, state: 'shown' }), { status: 'ok', value: { cycle: R2, state: 'shown' } });
 assert.deepEqual(readRecap({ cycle: R2, state: 'dismissed' }), { status: 'ok', value: { cycle: R2, state: 'dismissed' } });
 const getter = Object.defineProperty({ state: 'shown' }, 'cycle', { enumerable: true, get() { throw new Error('getter must not run'); } });
 for (const bad of [null, 5, 'shown', [], {}, { cycle: R2 }, { state: 'shown' }, { cycle: R2, state: 'seen' }, { cycle: R2, state: 'shown', extra: 1 }, { cycle: 'synthetic', state: 'shown' }, { cycle: R2.replace('.000Z', 'Z'), state: 'shown' }, { cycle: 5, state: 'shown' },
  { v: 2, cycle: R2, state: 'shown' }, JSON.parse('{"__proto__":{"state":"shown"},"cycle":"x","state":"shown"}'), Object.create({ cycle: R2, state: 'shown' }), Object.assign(Object.create(null), { cycle: R2, state: 'shown', more: 1 }), getter, new Map(), [{ cycle: R2, state: 'shown' }]])
  assert.deepEqual(readRecap(bad), { status: 'unknown' });
});

test('visibility: new once, shown until dismissed, hidden when unknown, dismissed or superseded by a newer cycle', () => {
 const recap: Recap = { cycle: R2, period: 'p', lines: ['l'] };
 const stored = (value: StoredRecap) => recapVisibility(recap, value);
 assert.equal(stored({ status: 'ok', value: null }), 'new');
 assert.equal(stored({ status: 'ok', value: { cycle: R1, state: 'dismissed' } }), 'new', 'an older cycle does not carry over');
 assert.equal(stored({ status: 'ok', value: { cycle: R2, state: 'shown' } }), 'shown');
 assert.equal(stored({ status: 'ok', value: { cycle: R2, state: 'dismissed' } }), 'hidden');
 assert.equal(stored({ status: 'ok', value: { cycle: '2030-09-01T00:00:00.000Z', state: 'shown' } }), 'hidden');
 assert.equal(stored({ status: 'unknown' }), 'hidden');
 assert.equal(recapVisibility(null, { status: 'ok', value: null }), 'hidden');
});

test('the next stored state never overwrites an unknown, dismissed or newer value', () => {
 assert.deepEqual(nextRecapState({ status: 'ok', value: null }, R2, 'shown'), { cycle: R2, state: 'shown' });
 assert.deepEqual(nextRecapState({ status: 'ok', value: { cycle: R1, state: 'dismissed' } }, R2, 'shown'), { cycle: R2, state: 'shown' });
 assert.deepEqual(nextRecapState({ status: 'ok', value: { cycle: R2, state: 'shown' } }, R2, 'dismissed'), { cycle: R2, state: 'dismissed' });
 assert.deepEqual(nextRecapState({ status: 'ok', value: null }, R2, 'dismissed'), { cycle: R2, state: 'dismissed' });
 assert.equal(nextRecapState({ status: 'ok', value: { cycle: R2, state: 'dismissed' } }, R2, 'shown'), null, 'a dismissal is never undone');
 assert.equal(nextRecapState({ status: 'ok', value: { cycle: R2, state: 'shown' } }, R2, 'shown'), null, 'no needless write');
 assert.equal(nextRecapState({ status: 'ok', value: { cycle: R2, state: 'shown' } }, R1, 'dismissed'), null, 'a newer stored cycle is kept');
 assert.equal(nextRecapState({ status: 'unknown' }, R2, 'shown'), null, 'an unknown value is never overwritten');
 assert.equal(nextRecapState({ status: 'ok', value: null }, 'synthetic-cycle', 'shown'), null);
});

test('the static card is script-free text with the buttons hidden, escapes everything and parses into the dashboard model', () => {
 const r: Recap = { cycle: R2, period: 'Period <b>&</b>', lines: ['Line "one" <script>alert(1)</script>', 'Line two'] };
 const html = recapSection(r);
 assert.match(html, /<h2 id="recap-title">Your Kiro cycle<\/h2>/);
 assert.match(html, /<ul id="recap-lines"><li>Line &quot;one&quot; &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/li><li>Line two<\/li><\/ul>/);
 assert.ok(!/<script|\sstyle=|\son\w+=|href=|src=/i.test(html));
 for (const id of ['recap-save', 'recap-copy', 'recap-dismiss']) assert.match(html, new RegExp(`<button type="button" id="${id}" hidden>`));
 assert.match(html, /<figure id="recap-preview" hidden><canvas id="recap-canvas" width="1200" height="630" role="img" aria-labelledby="recap-title" aria-describedby="recap-lines"><\/canvas>/);
 assert.match(html, /<p id="recap-status" role="status"><\/p>/);
 assert.match(html, /Save image…/); assert.match(html, /Copy text/); assert.match(html, /Dismiss/);
 buildDomModel(`<!doctype html><html lang="en"><body><main>${html}</main></body></html>`);
});

test('present() renders the card and the export section only when given, and stays script-free and style-free', () => {
 const observed = view([], '2030-01-01T00:00:00Z');
 const r: Recap = { cycle: R2, period: 'Period', lines: ['Line'] };
 const without = present(observed).html, withCard = present(observed, [], '', '', undefined, '2030-01-01T00:00:00Z', false, undefined, '', undefined, r).html;
 assert.ok(!without.includes('id="recap-card"'));
 assert.ok(withCard.includes('id="recap-card"'));
 // The export lives inside the collapsed Advanced details, without its own section or a privacy sentence.
 for (const html of [without, withCard]) { assert.ok(html.indexOf('id="advanced-details"') < html.indexOf('id="export-tools"')); assert.ok(html.indexOf('id="export-tools"') < html.indexOf('<footer')); assert.ok(!html.includes('id="export-heading"')); assert.ok(!/never writes to your workspace/.test(html)); assert.ok(!/<script|\sstyle=/.test(html)); buildDomModel(html); }
 assert.ok(withCard.indexOf('id="recap-card"') < withCard.indexOf('id="advanced-details"'));
});
