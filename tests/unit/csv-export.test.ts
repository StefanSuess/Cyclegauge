import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_HEADER, MAX_CSV_ROWS, buildCsv } from '../../src/extension/csv-export.ts';
import { history } from '../../src/history.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

const lines = (csv: string) => csv.split('\r\n');
const ok = (r: ReturnType<typeof buildCsv>) => { assert.equal(r.ok, true); return (r as Extract<typeof r, { ok: true }>).csv; };

test('header, UTF-8 text, CRLF rows and exact decimals with the stored offset and UTC time', () => {
 const csv = ok(buildCsv([
  snapshot('2030-06-01T10:00:00.000Z', '12.50', { observedText: '2030-06-01T12:00:00+02:00', usage: '12.5', limit: '1000' }),
  snapshot('2030-06-02T10:00:00.000Z', '0.1234567890123456789', { observedText: '2030-06-02T10:00:00Z', usage: '0.1234567890123456789', limit: '1000.000001' }),
 ]));
 assert.deepEqual(lines(csv), [
  CSV_HEADER.join(','),
  '2030-06-01T12:00:00+02:00,2030-06-01T10:00:00.000Z,12.5,1000,2030-07-01T00:00:00.000Z,none,no',
  '2030-06-02T10:00:00Z,2030-06-02T10:00:00.000Z,0.1234567890123456789,1000.000001,2030-07-01T00:00:00.000Z,none,no',
  '']);
 assert.equal(csv.charCodeAt(0), 'o'.charCodeAt(0), 'no byte order mark');
 assert.match(csv, /^observed_at_source,observed_at_utc,credits_used,credit_limit,reset_at_utc,flags,conflict\r\n/);
});

test('rows come out in time order whatever the input order, and unknown values are never zero', () => {
 const csv = ok(buildCsv([
  snapshot('2030-06-03T00:00:00.000Z', '3', { usage: null, flags: ['missing_usage'] }),
  snapshot('2030-06-01T00:00:00.000Z', '1', { limit: null, resetAt: null, resetText: null, flags: ['missing_limit', 'missing_reset'] }),
 ]));
 const rows = lines(csv).slice(1, -1);
 assert.deepEqual(rows, [
  '2030-06-01T00:00:00.000Z,2030-06-01T00:00:00.000Z,1,unknown,unknown,missing_limit;missing_reset,no',
  '2030-06-03T00:00:00.000Z,2030-06-03T00:00:00.000Z,unknown,1000,2030-07-01T00:00:00.000Z,missing_usage,no']);
});

test('offset-free source times carry the assumed_source_timezone flag and no zone name', () => {
 const csv = ok(buildCsv([snapshot('2030-06-01T10:00:00.000Z', '5', { observedText: '2030-06-01 12:00:00', sourceTimezone: 'Synthetic/Zone', flags: ['assumed_source_timezone', 'reduced_precision'] })]));
 assert.equal(lines(csv)[1], '2030-06-01 12:00:00,2030-06-01T10:00:00.000Z,5,1000,2030-07-01T00:00:00.000Z,assumed_source_timezone;reduced_precision,no');
 assert.ok(!csv.includes('Synthetic/Zone'));
});

test('same-time conflicting snapshots are all exported with a conflict flag, identical duplicates once', () => {
 const csv = ok(buildCsv([
  snapshot('2030-06-01T10:00:00.000Z', '5'), snapshot('2030-06-01T10:00:00.000Z', '5'),
  snapshot('2030-06-02T10:00:00.000Z', '6'), snapshot('2030-06-02T10:00:00.000Z', '7'),
 ]));
 assert.deepEqual(lines(csv).slice(1, -1).map(l => l.split(',').slice(2).join(',')), [
  '5,1000,2030-07-01T00:00:00.000Z,none,no', '6,1000,2030-07-01T00:00:00.000Z,none,yes', '7,1000,2030-07-01T00:00:00.000Z,none,yes']);
});

test('free text, formulas and identifiers can never reach a cell', () => {
 const hostile = ['=cmd|calc', '+1', '-1', '@SUM(A1)', '1,2', '1\n2', '"quoted"', 'synthetic-private-account', '\t=1'];
 const csv = ok(buildCsv(hostile.map((v, i) => snapshot(`2030-06-0${i + 1}T00:00:00.000Z`, '1', { usage: v, limit: v, observedText: v, resetAt: v, resetText: v, flags: [v, 'assumed_source_timezone'] }))));
 for (const row of lines(csv).slice(1, -1)) {
  const cells = row.split(',');
  assert.equal(cells.length, 7, row);
  assert.deepEqual([cells[0], cells[2], cells[3], cells[4], cells[5]], ['unknown', 'unknown', 'unknown', 'unknown', 'assumed_source_timezone']);
 }
 assert.ok(!/synthetic-private-account|partition/.test(csv));
 for (const cellText of lines(csv).flatMap(l => l.split(','))) assert.ok(!/^[=+@\t\r-]/.test(cellText) || cellText === '', cellText);
});

test('only one associated account is exported; every other case gets a fixed refusal', () => {
 assert.deepEqual(buildCsv([]), { ok: false, code: 'no_history' });
 assert.deepEqual(buildCsv([snapshot('2030-06-01T00:00:00.000Z', '1'), snapshot('2030-06-02T00:00:00.000Z', '2', { partition: 'synthetic-other-account' })]), { ok: false, code: 'multiple_accounts' });
 assert.deepEqual(buildCsv([snapshot('2030-06-01T00:00:00.000Z', '1', { associated: false })]), { ok: false, code: 'multiple_accounts' });
 assert.deepEqual(buildCsv([snapshot('not-a-time', '1')]), { ok: false, code: 'unavailable' });
 // A latest conflict or an unknown reset still exports: the rows say so.
 ok(buildCsv([snapshot('2030-06-01T00:00:00.000Z', '1'), snapshot('2030-06-01T00:00:00.000Z', '2')]));
 ok(buildCsv([snapshot('2030-06-01T00:00:00.000Z', '1', { resetAt: null, resetText: null })]));
});

test('a very large history is refused with a fixed code instead of building a huge file', () => {
 const many = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, i) => snapshot(new Date(Date.UTC(2030, 0, 1) + i * 1000).toISOString(), String(i)));
 assert.deepEqual(buildCsv(many), { ok: false, code: 'unavailable' });
});

test('the conflict flag follows the history rule exactly: any differing billing field except the assumed-timezone flag', () => {
 const group = (when: string, a: object, b: object) => [snapshot(when, '5', a), snapshot(when, '5', b)];
 const cases: [string, object, object, boolean][] = [
  ['usage', { usage: '5' }, { usage: '6' }, true], ['limit', { limit: '1000' }, { limit: '2000' }, true], ['reset', { resetAt: '2030-07-01T00:00:00.000Z' }, { resetAt: '2030-07-02T00:00:00.000Z', resetText: '2030-07-02T00:00:00Z' }, true],
  ['overages', { overages: '1' }, { overages: '2' }, true], ['overage cap', { overageCap: '1' }, { overageCap: '2' }, true], ['quality flag', { flags: [] }, { flags: ['reduced_precision'] }, true],
  ['timezone flag only', { flags: [] }, { flags: ['assumed_source_timezone'], observedText: '2030-06-01 00:00:00', sourceTimezone: 'UTC' }, false],
  ['different source text, same fields', { observedText: '2030-06-01T00:00:00Z' }, { observedText: '2030-06-01T02:00:00+02:00' }, false],
  ['identical', {}, {}, false],
 ];
 for (const [name, a, b, conflict] of cases) {
  // The instant under test comes first, then an ordinary later one in the same cycle, so history() still reports its points.
  const snaps = [...group('2030-06-01T00:00:00.000Z', a, b), snapshot('2030-06-02T00:00:00.000Z', '9', { resetAt: (a as { resetAt?: string }).resetAt ?? '2030-07-01T00:00:00.000Z' })];
  const rows = lines(ok(buildCsv(snaps))).slice(1, -1);
  const flagged = rows.filter(r => r.endsWith(',yes')).length;
  assert.equal(flagged > 0, conflict, name);
  const h = history(snaps);
  if (h.status === 'available') {
   const first = h.points.find(p => p.observedAt === '2030-06-01T00:00:00.000Z');
   if (first) assert.equal(first.conflicting, conflict, `history agrees: ${name}`);
  }
 }
 // A conflicting latest instant is history()'s own refusal status, and the export marks those rows.
 const latest = group('2030-06-03T00:00:00.000Z', { usage: '1' }, { usage: '2' });
 assert.equal(history(latest).status, 'conflicting_snapshots');
 assert.equal(lines(ok(buildCsv(latest))).slice(1, -1).every(r => r.endsWith(',yes')), true);
 const resetLatest = group('2030-06-03T00:00:00.000Z', {}, { resetAt: '2030-07-02T00:00:00.000Z', resetText: '2030-07-02T00:00:00Z' });
 assert.equal(history(resetLatest).status, 'conflicting_snapshots');
 assert.equal(lines(ok(buildCsv(resetLatest))).slice(1, -1).every(r => r.endsWith(',yes')), true);
});
