import { test } from 'node:test';
import assert from 'node:assert/strict';
import { view } from '../../src/view.ts';
import type { StoredSnapshot } from '../../src/store.ts';
const snapshot = (changes: Partial<StoredSnapshot> = {}): StoredSnapshot => ({
 partition: 'synthetic-private-partition', associated: true, observedAt: '2030-06-29T16:00:00.000Z', observedText: '2030-06-29 18:00:00.000', sourceTimezone: 'Europe/Berlin',
 usage: '11.35', limit: '100', resetAt: '2030-07-01T00:00:00.000Z', resetText: '2030-07-01T00:00:00Z', overages: null, overageCap: null, flags: [], ingestedAt: '2030-06-29T16:01:00Z', ...changes });
const now = '2030-06-29T16:00:00Z';
test('displays observed balance and UTC 24-hour daily allocation with no private keys', () => {
 const r = view([snapshot()], now); assert.equal(r.status, 'observed'); assert.equal(r.remainingBaseCredits, '88.65'); assert.equal(r.availablePerDay, '66.4875');
 assert.ok(!JSON.stringify(r).includes('synthetic-private')); assert.equal(r.dailyConsumption, null);
});
test('staleness uses observation rather than ingestion time', () => {
 const r = view([snapshot({ ingestedAt: '2030-07-01T00:00:00Z' })], '2030-06-30T17:00:00Z');
 assert.equal(r.status, 'stale'); assert.equal(r.availablePerDay, null); assert.equal(r.usage, '11.35');
});
test('expired reset, future clock and missing values never invent credits', () => {
 assert.equal(view([snapshot()], '2030-07-01T00:00:00Z').remainingBaseCredits, null);
 assert.equal(view([snapshot()], '2030-06-29T15:00:00Z').status, 'future_observation');
 assert.equal(view([snapshot({ usage: null })], now).remainingBaseCredits, null);
 assert.equal(view([snapshot({ resetAt: null })], now).availablePerDay, null);
 assert.equal(view([], now).status, 'unavailable');
 assert.equal(view([snapshot({ usage: '101' })], now).remainingBaseCredits, '0');
});
test('conflicts, unknown association and multiple accounts remain unavailable', () => {
 assert.equal(view([snapshot(), snapshot({ usage: '12' })], now).status, 'conflicting_snapshots');
 assert.equal(view([snapshot({ associated: false })], now).status, 'unknown_account');
 assert.equal(view([snapshot(), snapshot({ partition: 'synthetic-account-b' })], now).status, 'multiple_accounts');
});
test('sorting, same-cycle decrease and cycle transition retain unknown daily consumption', () => {
 const old = snapshot({ usage: '12', observedAt: '2030-06-28T16:00:00.000Z' });
 assert.equal(view([snapshot(), old], now).interval.status, 'counter_decrease_not_reset');
 assert.equal(view([snapshot(), old], now).interval.netChange, '-0.65');
 const next = snapshot({ resetAt: '2030-08-01T00:00:00.000Z', observedAt: '2030-07-02T00:00:00.000Z', usage: '0.8' });
 const r = view([next, snapshot()], '2030-07-02T00:00:00Z');
 assert.equal(r.interval.status, 'cycle_change_observed'); assert.equal(r.interval.netChange, null); assert.equal(r.dailyConsumption, null);
 assert.equal(view([old, snapshot({ limit: '200' })], now).interval.status, 'plan_change');
 assert.equal(view([old, snapshot({ resetAt: '2030-06-30T00:00:00.000Z' })], now).interval.status, 'reset_regressed');
});
test('unsupported extras suppress total availability but keep base estimate distinct', () => {
 const r = view([snapshot({ flags: ['unsupported_extra_credits'] })], now);
 assert.equal(r.remainingBaseCredits, '88.65'); assert.equal(r.totalAvailableCredits, null); assert.ok(r.flags.includes('unsupported_extra_credits'));
});

test('billing-only view exposes history and qualified forecast without account/source keys', () => {
 const points=Array.from({length:8},(_,i)=>snapshot({observedAt:`2030-06-${String(i+1).padStart(2,'0')}T00:00:00.000Z`,usage:String(i*10),limit:'1000'}));
 const r=view(points,'2030-06-08T00:00:00Z');
 assert.equal(r.history.coverage.completeUtcDays,7);
 assert.equal(r.forecast.status,'qualified');assert.equal(r.forecast.selectedMethod,'rolling_7_day');
 assert.ok(!JSON.stringify(r).includes('partition'));assert.ok(!JSON.stringify(r).includes('synthetic-private'));
 const conflict=view([...points,{...points[7],usage:'71'}],'2030-06-08T00:00:00Z');
 assert.equal(conflict.forecast.status,'unavailable');
});
