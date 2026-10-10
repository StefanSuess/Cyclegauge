import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoLeak, renderMarkdown, runEvidence, sanitize, type Report } from '../../scripts/poc/win-acl/poc.ts';
import { ToolError } from '../../scripts/poc/win-acl/tools.ts';

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const rejected = (fn: () => unknown, code: string) => assert.throws(fn, (e: unknown) => e instanceof ToolError && e.code === code);

test('report values must be short fixed tokens', () => {
 assert.deepEqual(sanitize({ a: 'ACL_OK', b: 3, c: true, d: ['0:ACL_NOT_PROTECTED'], e: { f: 'v24.13.0' } }), { a: 'ACL_OK', b: 3, c: true, d: ['0:ACL_NOT_PROTECTED'], e: { f: 'v24.13.0' } });
 for (const bad of ['C:\\Users\\synthetic', '/home/synthetic', SID, 'has space', 'a'.repeat(65), 'line\nbreak', '']) {
  if (bad === '') { assert.equal(sanitize(bad), ''); continue; }
  rejected(() => sanitize({ value: bad }), 'REPORT_VALUE_REJECTED');
 }
 rejected(() => sanitize({ ['C:\\key']: 1 }), 'REPORT_VALUE_REJECTED');
});

test('leak guard rejects private values, drive paths and account SIDs', () => {
 assertNoLeak('{"administrators_group_listed":true,"current_user":1}', ['admin', 'user', 'S-1-5-21-1111111111-2222222222-3333333333-1001']);
 rejected(() => assertNoLeak(`{"x":"${SID}"}`, [SID]), 'REPORT_LEAK_GUARD');
 rejected(() => assertNoLeak('{"x":"synthetic-person"}', ['synthetic-person']), 'REPORT_LEAK_GUARD');
 rejected(() => assertNoLeak('{"x":"C:\\\\Users\\\\x"}', []), 'REPORT_LEAK_GUARD');
 rejected(() => assertNoLeak('{"x":"S-1-5-21-1"}', []), 'REPORT_LEAK_GUARD');
 rejected(() => assertNoLeak('{"p":"C:\\\\Synthetic\\\\Root"}', ['C:\\Synthetic\\Root']), 'REPORT_LEAK_GUARD');
});

test('markdown summary lists items without detail leakage', () => {
 const report: Report = { schema: 'x', environment: { platform: 'win32' }, items: { '1_x': { status: 'established', code: 'OK', data: { a: 1 } } } };
 const md = renderMarkdown(report);
 assert.ok(md.includes('| 1_x | established | OK |'));
});

test('evidence run refuses to start anywhere but Windows', { skip: process.platform === 'win32' }, async () => {
 await assert.rejects(runEvidence(), (e: unknown) => e instanceof ToolError && e.code === 'POC_NOT_WINDOWS');
});
