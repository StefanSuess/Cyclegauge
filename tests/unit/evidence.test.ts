import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history, DAY_MS } from '../../src/history.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

const RESET_JULY = '2030-07-01T00:00:00.000Z';
const RESET_JUNE = '2030-06-01T00:00:00.000Z';
const at = (text: string) => text.endsWith('Z') ? text : `${text}Z`;
const snap = (time: string, usage: string, changes = {}) => snapshot(at(time), usage, { resetAt: RESET_JULY, ...changes });

test('evidence pools same-cycle intervals across a reset without subtracting counters', () => {
 const cycleA = [snapshot('2030-05-30T09:00:00Z','100',{resetAt:RESET_JUNE}), snapshot('2030-05-30T17:00:00Z','130',{resetAt:RESET_JUNE})];
 const cycleB = [snapshot('2030-06-01T09:00:00Z','5',{resetAt:RESET_JULY}), snapshot('2030-06-01T17:00:00Z','25',{resetAt:RESET_JULY})];
 const h = history([...cycleA, ...cycleB]);
 assert.equal(h.status, 'available');
 assert.equal(h.evidence.cycles.length, 2);
 assert.equal(h.evidence.cycles[0].resetAt, RESET_JUNE);
 assert.equal(h.evidence.cycles[1].startAt, RESET_JUNE);
 // Nothing is subtracted across the reset: the tail of cycle A and head of cycle B stay unknown (the 9 h head is covered by its evidence-backed start).
 const nets = h.evidence.intervals.map(i => [i.from, i.to, i.netChange]);
 assert.deepEqual(nets, [
  ['2030-05-30T09:00:00.000Z','2030-05-30T17:00:00.000Z','30'],
  ['2030-06-01T00:00:00.000Z','2030-06-01T09:00:00.000Z','5'],
  ['2030-06-01T09:00:00.000Z','2030-06-01T17:00:00.000Z','20'],
 ]);
});

test('zero-net overnight and weekend intervals are observed zero net change, split by UTC day', () => {
 const s = [snap('2030-06-07T09:00:00','10'), snap('2030-06-07T17:00:00','30'), snap('2030-06-10T09:00:00','30'), snap('2030-06-10T17:00:00','50')];
 const h = history(s);
 const days = Object.fromEntries(h.evidence.days.map(d => [d.day, d]));
 assert.equal(days['2030-06-07'].netChange, '20');
 assert.equal(days['2030-06-07'].zeroNetMilliseconds, 7*3600000);
 assert.equal(days['2030-06-08'].netChange, '0');
 assert.equal(days['2030-06-08'].zeroNetMilliseconds, DAY_MS);
 assert.equal(days['2030-06-09'].zeroNetMilliseconds, DAY_MS);
 assert.equal(days['2030-06-10'].netChange, '20');
 assert.ok(h.evidence.intervals.some(i => i.kind === 'zero_net'));
 assert.equal(h.evidence.spans.length, 0);
});

test('positive intervals crossing midnight stay unattributed spans with a known total', () => {
 const h = history([snap('2030-06-07T17:00:00','30'), snap('2030-06-10T09:00:00','60')]);
 assert.deepEqual(h.evidence.spans, [{from:'2030-06-07T17:00:00.000Z',to:'2030-06-10T09:00:00.000Z',netChange:'30'}]);
 assert.ok(h.evidence.days.every(d => d.netChange === '0' && d.observedMilliseconds === 0));
});

test('reduced-precision endpoints are never split as zero-net exposure', () => {
 const h = history([snap('2030-06-07T17:00:00','30',{flags:['reduced_precision']}), snap('2030-06-10T09:00:00','30')]);
 assert.equal(h.evidence.intervals.length, 0);
 assert.ok(h.evidence.exclusions.some(e => e.code === 'reduced_precision_zero_net'));
});

test('conflicts, counter decreases and missing billing are local exclusions; limit changes stop the regime', () => {
 const s = [snap('2030-06-01T09:00:00','0'), snap('2030-06-01T17:00:00','10'), snap('2030-06-02T09:00:00','10',{limit:'2000'}), snap('2030-06-02T17:00:00','20',{limit:'2000'}),
  snap('2030-06-03T09:00:00','15',{limit:'2000'}), snap('2030-06-03T17:00:00','25',{limit:'2000'}), snap('2030-06-04T09:00:00','25',{limit:'2000'})];
 const h = history(s);
 assert.equal(h.evidence.stoppedBy, 'limit_change');
 assert.equal(h.evidence.cycles[0].snapshotCount, 5);
 assert.ok(h.evidence.exclusions.some(e => e.code === 'usage_adjustment' && e.count === 1));
 assert.ok(h.evidence.intervals.every(i => Date.parse(i.from) >= Date.parse('2030-06-02T09:00:00Z')));
});

test('evidence is limited to the trailing 85 UTC days and to one account', () => {
 const old = snap('2030-03-01T09:00:00','1');
 const h = history([old, snap('2030-06-10T09:00:00','10'), snap('2030-06-10T17:00:00','20')]);
 assert.equal(h.evidence.observations.length, 2);
 const mixed = history([snap('2030-06-10T09:00:00','10'), snapshot('2030-06-10T17:00:00Z','20',{partition:'synthetic-other'})]);
 assert.equal(mixed.status, 'multiple_accounts');
 assert.equal(mixed.evidence.intervals.length, 0);
});

test('gap rule: an unchanged counter over a long gap is comparable, a positive long gap remains a barrier', () => {
 const zero = history([snap('2030-06-07T17:00:00','30'), snap('2030-06-10T09:00:00','30')]);
 assert.equal(zero.intervals[0].status, 'comparable');
 assert.equal(zero.coverage.gaps.length, 0);
 const positive = history([snap('2030-06-07T17:00:00','30'), snap('2030-06-10T09:00:00','31')]);
 assert.equal(positive.intervals[0].status, 'observation_gap');
});
