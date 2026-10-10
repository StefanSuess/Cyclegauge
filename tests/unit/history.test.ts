import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history } from '../../src/history.ts';
import { scaleRatio } from '../../src/decimal.ts';
import { syntheticSnapshot } from './synthetic.ts';

test('daily history includes complete and partial observed net changes, never interpolates across days', () => {
 const h = history([
  syntheticSnapshot('2030-06-01T00:00:00Z', '0'), syntheticSnapshot('2030-06-01T12:00:00Z', '0.1'),
  syntheticSnapshot('2030-06-02T00:00:00Z', '0.3'), syntheticSnapshot('2030-06-02T12:00:00Z', '0.6'),
  syntheticSnapshot('2030-06-04T12:00:00Z', '10.6')]);
 assert.deepEqual(h.days.map(d => [d.day, d.netChange, d.complete]), [['2030-06-01','0.3',true],['2030-06-02','0.3',false],['2030-06-03',null,false],['2030-06-04',null,false]]);
 assert.equal(h.intervals.at(-1)?.netChange, '10'); assert.equal(h.intervals.at(-1)?.status, 'observation_gap');
 assert.equal(h.coverage.completeUtcDays, 1); assert.equal(h.coverage.unknownUtcDays, 2);
 assert.equal(h.cycleStartAt, null); assert.ok(h.coverage.initialPeriodUnknown);
 assert.ok(!JSON.stringify(h).includes('synthetic-private')); assert.ok(!JSON.stringify(h).includes('partition'));
});
test('cycle start needs chronological prior reset evidence; no cross-cycle subtraction', () => {
 const old = syntheticSnapshot('2030-05-31T20:00:00Z', '999', {resetAt:'2030-06-01T00:00:00.000Z'});
 const first = syntheticSnapshot('2030-06-01T02:00:00Z', '1');
 const h = history([first, old, syntheticSnapshot('2030-06-02T02:00:00Z', '3')]);
 assert.equal(h.cycleStartAt, '2030-06-01T00:00:00.000Z'); assert.equal(h.points.length, 2); assert.equal(h.intervals[0].netChange, '2');
 const early = history([old, syntheticSnapshot('2030-05-31T22:00:00Z', '1')]);
 assert.equal(early.cycleStartAt, null); assert.ok(early.reasons.includes('ambiguous_cycle_start'));
});
test('usage adjustments, changing limits and historical conflicts are explicit barriers', () => {
 const a = syntheticSnapshot('2030-06-01T00:00:00Z', '10');
 const b = syntheticSnapshot('2030-06-02T00:00:00Z', '9');
 assert.equal(history([a,b]).intervals[0].status, 'usage_adjustment');
 assert.equal(history([a, {...b, usage:'11',limit:'2000'}]).intervals[0].status, 'limit_change');
 const h = history([a,{...a,usage:'12'},b]);
 assert.equal(h.points[0].conflicting, true); assert.equal(h.intervals[0].status,'conflicting_snapshots');
 assert.equal(h.points[0].usage,null);
});
test('account isolation, unknown resets, missing usage and regressed resets fail safely', () => {
 const a = syntheticSnapshot('2030-06-01T00:00:00Z', '0');
 const b = syntheticSnapshot('2030-06-02T00:00:00Z', '1');
 assert.equal(history([a,{...b,partition:'synthetic-other'}]).status,'multiple_accounts');
 assert.equal(history([{...a,associated:false}]).status,'unknown_account');
 assert.equal(history([{...a,resetAt:null}]).status,'reset_unknown');
 assert.equal(history([a,{...b,resetAt:'2030-06-30T00:00:00.000Z'}]).status,'reset_regressed');
 assert.equal(history([a,{...b,usage:null}]).intervals[0].status,'missing_billing');
});
test('UTC grouping uses instants, preserves decimals and handles timezone/DST day boundaries', () => {
 const h = history([syntheticSnapshot('2030-03-30T23:00:00+01:00','0.00000001',{resetAt:'2030-04-01T00:00:00Z'}),
  syntheticSnapshot('2030-03-31T01:00:00+02:00','0.00000003',{resetAt:'2030-04-01T00:00:00Z'})]);
 assert.equal(h.intervals[0].netChange,'0.00000002'); assert.equal(h.days[0].day,'2030-03-30'); assert.equal(h.days[0].complete,false);
 assert.equal(scaleRatio('10000000000000000.0000001', 3n, 2n), '15000000000000000');
 assert.equal(scaleRatio('1',1n,3n),'0.333333');
});
