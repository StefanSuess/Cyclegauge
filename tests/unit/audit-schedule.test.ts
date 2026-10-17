import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, auditDue, daysBetween, isDate, utcDate } from '../../src/extension/audit-schedule.ts';

const base = { today: '2030-03-31', reminderDays: 30, automatic: false } as const;

test('never audited is due for the one-time prompt, even with automatic on', () => {
 assert.equal(auditDue({ ...base }), 'first');
 assert.equal(auditDue({ ...base, automatic: true }), 'first');
});
test('a snooze, never-remind, or zero days silences every state', () => {
 assert.equal(auditDue({ ...base, snoozeUntil: '2030-04-01' }), 'none');
 assert.equal(auditDue({ ...base, snoozeUntil: '2030-03-31' }), 'first'); // today >= snoozeUntil
 assert.equal(auditDue({ ...base, snoozeUntil: '2030-03-30' }), 'first');
 assert.equal(auditDue({ ...base, neverRemind: true }), 'none');
 assert.equal(auditDue({ ...base, neverRemind: true, last: '2020-01-01', automatic: true }), 'none');
 assert.equal(auditDue({ ...base, reminderDays: 0 }), 'none');
 assert.equal(auditDue({ ...base, reminderDays: 0, last: '2020-01-01', automatic: true }), 'none');
 assert.equal(auditDue({ ...base, last: '2020-01-01', snoozeUntil: '2030-04-01', automatic: true }), 'none');
 for (const reminderDays of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(auditDue({ ...base, reminderDays }), 'none');
});
test('an audit is due exactly reminderDays later, not one day earlier', () => {
 assert.equal(auditDue({ ...base, last: '2030-03-02' }), 'none'); // 29 days
 assert.equal(auditDue({ ...base, last: '2030-03-01' }), 'remind'); // 30 days
 assert.equal(auditDue({ ...base, last: '2029-01-01' }), 'remind');
 assert.equal(auditDue({ ...base, last: '2030-03-01', automatic: true }), 'auto');
 // Automatic modes re-run an audit that is at least one UTC day old, independent of the reminder period.
 assert.equal(auditDue({ ...base, last: '2030-03-02', automatic: true }), 'auto');
 assert.equal(auditDue({ ...base, last: '2030-03-30', automatic: true }), 'auto');
 assert.equal(auditDue({ ...base, last: '2030-03-31', automatic: true }), 'none');
 assert.equal(auditDue({ ...base, last: '2030-04-15', automatic: true }), 'none');
 assert.equal(auditDue({ ...base, last: '2030-03-31' }), 'none');
 assert.equal(auditDue({ ...base, last: '2030-04-15' }), 'none'); // a last date in the future (clock change) is not due
 assert.equal(auditDue({ ...base, last: '2030-03-30', reminderDays: 1 }), 'remind');
});
test('invalid dates are treated as absent', () => {
 for (const bad of ['', 'synthetic', '2030-02-30', '2030-13-01', '2030-1-1', '20300301', 2030, null, {}, '2030-03-01T00:00:00Z', ' 2030-03-01']) {
  assert.equal(auditDue({ ...base, last: bad }), 'first', String(bad));
  assert.equal(auditDue({ ...base, last: '2030-01-01', snoozeUntil: bad }), 'remind', String(bad));
 }
 assert.equal(auditDue({ ...base, neverRemind: 'true' }), 'first');
 assert.equal(auditDue({ ...base, neverRemind: 1 }), 'first');
 assert.equal(auditDue({ ...base, today: 'synthetic' }), 'none');
});
test('date helpers cross month, year and leap-year boundaries', () => {
 assert.equal(addDays('2030-01-31', 1), '2030-02-01');
 assert.equal(addDays('2030-12-31', 1), '2031-01-01');
 assert.equal(addDays('2028-02-28', 1), '2028-02-29');
 assert.equal(addDays('2029-02-28', 1), '2029-03-01');
 assert.equal(addDays('2030-03-01', -1), '2030-02-28');
 assert.equal(addDays('2030-03-01', 30), '2030-03-31');
 assert.equal(addDays('2030-03-01', 1.5), undefined);
 assert.equal(addDays('synthetic', 1), undefined);
 assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
 assert.equal(daysBetween('2029-02-28', '2029-03-01'), 1);
 assert.equal(daysBetween('2029-12-31', '2030-01-01'), 1);
 assert.equal(daysBetween('2030-03-31', '2030-03-01'), -30);
 assert.equal(daysBetween('2030-01-01', '2031-01-01'), 365);
 assert.equal(daysBetween('2028-01-01', '2029-01-01'), 366);
 assert.equal(daysBetween('x', '2030-01-01'), undefined);
 // UTC dates have no DST: 25-hour and 23-hour local days still count as one day.
 assert.equal(daysBetween('2030-03-30', '2030-03-31'), 1);
 assert.equal(daysBetween('2030-10-26', '2030-10-27'), 1);
});
test('isDate and utcDate accept only real calendar days', () => {
 assert.equal(isDate('2028-02-29'), true);
 assert.equal(isDate('2029-02-29'), false);
 assert.equal(isDate('0050-01-01'), false); // two-digit years are not remapped
 assert.equal(utcDate(new Date('2030-03-31T23:59:59.999Z')), '2030-03-31');
 assert.equal(utcDate(new Date('2030-04-01T00:00:00+02:00')), '2030-03-31');
});
