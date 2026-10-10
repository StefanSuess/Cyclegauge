import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../../src/projection.ts';
import { subtract, allocation } from '../../src/decimal.ts';
export const line = (usage = '0.123456789012345678901', extra = '', stamp = '2030-06-29 18:00:00.000') => `${stamp} [info] synthetic-envelope {"commandName":"GetUsageLimitsCommand","output":{"userInfo":{"userId":"synthetic-account-a"},"nextDateReset":"2030-07-01T00:00:00Z","usageBreakdownList":[{"resourceType":"CREDIT","currentUsageWithPrecision":${usage},"usageLimitWithPrecision":100${extra}}]},"metadata":{"httpStatusCode":200}}`;
const parse = (s: string) => parseLine(s, 'Europe/Berlin');
test('preserves exact numeric tokens and projects no unknown values', () => {
 const r = parse(line(undefined, ',"prompt":"SYNTHETIC_PROMPT_DO_NOT_RETAIN"'));
 assert.equal(r.status, 'accepted'); assert.equal(r.snapshot?.usage, '0.123456789012345678901');
 assert.equal(r.snapshot?.observedAt, '2030-06-29T16:00:00.000Z');
 assert.equal(r.snapshot?.resetAt, '2030-07-01T00:00:00.000Z');
 assert.ok(!JSON.stringify(r.snapshot).includes('SYNTHETIC_PROMPT'));
});
test('decimal subtraction and allocation do not round binary floats', () => {
 assert.equal(subtract('100', '0.123456789012345678901'), '99.876543210987654321099');
 assert.equal(allocation('10', 3 * 86400000), '3.333333');
 assert.equal(subtract('1e-9', '0.0000000001'), '0.0000000009');
});
test('fallback, missing usage and unknown bonuses remain explicit', () => {
 const fallback = parse(line().replace(/"currentUsageWithPrecision":[^,]+/, '"currentUsage":12'));
 assert.equal(fallback.snapshot?.usage, '12'); assert.ok(fallback.snapshot?.flags.includes('reduced_precision'));
 assert.equal(parse(line().replace(/"currentUsageWithPrecision":[^,]+,/, '')).snapshot?.usage, null);
 assert.ok(parse(line('1', ',"bonuses":[{"syntheticUnknown":true}]')).snapshot?.flags.includes('unsupported_extra_credits'));
});
test('rejects failed/malformed/unsupported envelopes and invalid decimal values', () => {
 assert.equal(parse('synthetic malformed').status, 'ignored');
 assert.equal(parse(line().replace('200}', '500}')).status, 'failed_response');
 assert.equal(parse(line().replace('CREDIT', 'TOKEN')).status, 'unsupported_resource');
 assert.equal(parse(line('"0.3"')).status, 'invalid_billing');
 assert.equal(parse(line('-1')).status, 'invalid_billing');
 assert.equal(parse(line('1e99999')).status, 'invalid_billing');
 assert.equal(parse(line().slice(0, -1)).status, 'malformed_record');
});
test('handles reset mismatch, offset-aware timestamps, DST ambiguity and nonexistent times', () => {
 assert.ok(parse(line('1', ',"nextDateReset":"2030-08-01T00:00:00Z"')).snapshot?.flags.includes('conflicting_reset_metadata'));
 assert.equal(parse(line('1', '', '2030-06-29T18:00:00.000+02:00')).snapshot?.observedAt, '2030-06-29T16:00:00.000Z');
 assert.equal(parse(line('1', '', '2030-10-27 02:30:00.000')).status, 'ambiguous_timezone');
 assert.equal(parse(line('1', '', '2030-03-31 02:30:00.000')).status, 'invalid_timestamp');
 assert.equal(parse(line('1', '', '2030-02-30 12:00:00.000')).status, 'invalid_timestamp');
 assert.equal(parseLine(line(), undefined).status, 'source_timezone_required');
});
test('offset spelling is retained while UTC instant is normalized', () => {
 const r=parse(line('1','','2030-06-29T18:00:00.123+02:00').replace('2030-07-01T00:00:00Z','2030-07-01T02:00:00+02:00'));
 assert.equal(r.snapshot?.observedText,'2030-06-29T18:00:00.123+02:00');assert.equal(r.snapshot?.resetText,'2030-07-01T02:00:00+02:00');
 assert.equal(r.snapshot?.resetAt,'2030-07-01T00:00:00.000Z');
});
test('rejects malformed precision rather than silently falling back',()=>{
 assert.equal(parse(line('null',',"currentUsage":1')).status,'invalid_billing');
 assert.equal(parse(line('1').replace('"usageBreakdownList":[','"usageBreakdownList":null,"syntheticIgnored":[')).status,'unsupported_format');
 assert.equal(parse(line('1').replace('"httpStatusCode":200','"httpStatusCode":"200"')).status,'failed_response');
});
