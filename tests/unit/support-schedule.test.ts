import assert from 'node:assert/strict';
import test from 'node:test';
import { afterChoice, supportDue } from '../../src/extension/support-schedule.ts';

const base = { today: '2030-03-31', firstSeen: '2030-03-24', valueSeen: true, enabled: true, kiro: true } as const;

test('due exactly seven days after first use, not one day earlier', () => {
 assert.equal(supportDue({ ...base }), true);
 assert.equal(supportDue({ ...base, firstSeen: '2030-03-25' }), false); // 6 days
 assert.equal(supportDue({ ...base, firstSeen: '2030-03-31' }), false);
 assert.equal(supportDue({ ...base, firstSeen: '2020-01-01' }), true);
 assert.equal(supportDue({ ...base, firstSeen: '2030-04-15' }), false); // a first date in the future (clock change) is not due
});
test('value must have been seen, the setting on, the editor Kiro and the prompt not turned off', () => {
 assert.equal(supportDue({ ...base, valueSeen: false }), false);
 assert.equal(supportDue({ ...base, valueSeen: undefined }), false);
 assert.equal(supportDue({ ...base, valueSeen: 'yes' }), false);
 assert.equal(supportDue({ ...base, enabled: false }), false);
 assert.equal(supportDue({ ...base, kiro: false }), false);
 assert.equal(supportDue({ ...base, never: true }), false);
 assert.equal(supportDue({ ...base, never: true, next: '2020-01-01' }), false);
 assert.equal(supportDue({ ...base, never: 'true' }), true); // only an explicit true silences
});
test('the snooze date is respected: due on and after it, not before', () => {
 assert.equal(supportDue({ ...base, next: '2030-04-01' }), false);
 assert.equal(supportDue({ ...base, next: '2030-03-31' }), true);
 assert.equal(supportDue({ ...base, next: '2030-03-30' }), true);
});
test('invalid stored values count as absent, and a missing first-use date is never due', () => {
 assert.equal(supportDue({ ...base, next: 'synthetic-not-a-date' }), true);
 assert.equal(supportDue({ ...base, next: '2030-99-99' }), true);
 assert.equal(supportDue({ ...base, next: 20300401 }), true);
 for (const firstSeen of [undefined, 'synthetic-not-a-date', '2030-02-30', 5, null]) assert.equal(supportDue({ ...base, firstSeen }), false, String(firstSeen));
 assert.equal(supportDue({ ...base, today: 'synthetic-not-a-date' }), false);
});
test('Rate, Star and Support snooze for 120 days', () => {
 for (const choice of ['Rate', 'Star on GitHub', 'Support ☕']) assert.deepEqual(afterChoice(choice, '2030-03-31'), { next: '2030-07-29' }, choice);
});
test('Not now, a dismissed prompt and any unknown answer snooze for 60 days', () => {
 for (const choice of ['Not now', undefined, 'synthetic-other']) assert.deepEqual(afterChoice(choice, '2030-03-31'), { next: '2030-05-30' }, String(choice));
});
test("Don't ask again sets never and no date", () => {
 assert.deepEqual(afterChoice("Don't ask again", '2030-03-31'), { never: true });
});
test('a snooze set by a choice makes the prompt not due until it ends', () => {
 const next = afterChoice('Rate', '2030-03-31').next;
 assert.equal(supportDue({ ...base, next }), false);
 assert.equal(supportDue({ ...base, today: '2030-07-28', next }), false);
 assert.equal(supportDue({ ...base, today: '2030-07-29', next }), true);
});

test('value signals permit an earlier prompt while all global gates remain binding', () => {
 const early = { ...base, firstSeen: '2030-03-30', valueSeen: false };
 for (const signal of [{ auditSaved: true }, { detailDays: 3 }, { advisorUsed: true }]) {
  assert.equal(supportDue({ ...early, ...signal }), true);
  for (const gate of [{ enabled: false }, { kiro: false }, { never: true }, { next: '2030-04-01' }, { firstSeen: '2030-04-01' }]) assert.equal(supportDue({ ...early, ...signal, ...gate }), false);
 }
 assert.equal(supportDue({ ...early, firstSeen: early.today, auditSaved: true }), false);
 assert.equal(supportDue({ ...early, firstSeen: early.today, advisorUsed: true }), true);
 assert.equal(supportDue({ ...early, detailDays: 2 }), false);
 for (const signal of [{ auditSaved: 'true' }, { advisorUsed: 1 }, { detailDays: '3' }, { detailDays: Infinity }, { detailDays: 2.5 }]) assert.equal(supportDue({ ...early, ...signal }), false);
});
