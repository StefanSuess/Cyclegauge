import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatFingerprint, readLog } from '../../src/source.ts';

const line = '2030-06-29 18:00:00.000 [info] synthetic {"commandName":"GetUsageLimitsCommand","output":{"usageBreakdownList":[{"resourceType":"CREDIT","currentUsageWithPrecision":1.5,"usageLimitWithPrecision":100}],"nextDateReset":"2030-07-01T00:00:00Z"},"metadata":{"httpStatusCode":200}}\n';

test('fingerprint keeps the 0.5.1 text format for ordinary identities', () => {
 assert.equal(formatFingerprint(16777230n, 123456n, 1760000000123.456, 'abc'), '16777230:123456:1760000000123.456:abc');
 assert.equal(formatFingerprint(1n, 2n, 3, 'd'), `${1}:${2}:${3}:d`);
});

test('identities above 2^53 are kept exact', () => {
 const ino = 2n ** 60n + 12345n;
 assert.notEqual(BigInt(Number(ino)), ino, 'precondition: a Number cannot hold this value');
 assert.equal(formatFingerprint(7n, ino, 1.5, 'h'), `7:${ino}:1.5:h`);
});

test('a real file produces exactly the fingerprint 0.5.1 would have produced', async () => {
 const base = mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-identity-'));
 const file = join(base, 'q-client.log');
 writeFileSync(file, line);
 const st = statSync(file), id = statSync(file, { bigint: true });
 const r = await readLog(file, 'UTC');
 assert.equal(r.records.length, 1);
 const digest = createHash('sha256').update(line).digest('hex');
 assert.equal(r.fingerprint, `${id.dev}:${id.ino}:${st.birthtimeMs}:${digest}`);
 assert.match(r.fingerprint!, /^\d+:\d+:\d+(\.\d+)?:[a-f0-9]{64}$/);
 rmSync(base, { recursive: true });
});
