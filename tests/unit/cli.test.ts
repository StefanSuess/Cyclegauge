import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const run = (args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('src/cli.ts'), ...args], { encoding: 'utf8' });
test('CLI rejects invalid options without echoing sensitive arguments', () => {
 for (const args of [['--synthetic-secret'], ['--max-age-hours', '-1'], ['--source-timezone', 'SYNTHETIC_PRIVATE']]) {
  const r = run(args); assert.equal(r.status, 1); assert.equal(r.stdout.trim(), 'CONFIGURATION_INVALID'); assert.equal(r.stderr, '');
 }
});
test('CLI runs and restarts against synthetic sources with billing-only JSON output', async () => {
 const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-cli-')); const root = join(base, 'source');
 const dir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent'); await mkdir(dir, {recursive:true});
 await writeFile(join(dir, 'q-client.log'), '2030-06-29 18:00:00.000 [info] synthetic {"commandName":"GetUsageLimitsCommand","output":{"userInfo":{"userId":"synthetic-user-private"},"nextDateReset":"2030-07-01T00:00:00Z","usageBreakdownList":[{"resourceType":"CREDIT","currentUsageWithPrecision":11.35,"usageLimitWithPrecision":100,"prompt":"SYNTHETIC_DO_NOT_RETAIN"}]},"metadata":{"httpStatusCode":200}}\n');
 const args = ['--source-root', root, '--store-dir', join(base, 'gauge'), '--source-timezone', 'Europe/Berlin', '--json'];
 const first = run(args), second = run(args); assert.equal(first.status, 0); assert.equal(second.status, 0);
 const r = JSON.parse(second.stdout); assert.equal(r.import.duplicates, 1); assert.equal(r.observation.usage, '11.35');
 for (const marker of [base, 'synthetic-user', 'SYNTHETIC_DO_NOT_RETAIN', 'partition']) assert.ok(!second.stdout.includes(marker));
 assert.equal(second.stderr, ''); await rm(base, {recursive:true});
});
