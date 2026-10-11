import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { diagnostics } from '../../src/diagnostics.ts';

const FIXED = /^[A-Za-z0-9_.+-]{1,32}$/;
const walk = (v: unknown, out: string[] = []): string[] => {
 if (typeof v === 'string') out.push(v);
 else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); walk(x, out); }
 return out;
};
function synthetic() {
 const base = mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-diag-private-'));
 const dir = join(base, 'source', 'logs', 'run', 'window', 'exthost', 'kiro.kiroAgent');
 mkdirSync(dir, { recursive: true });
 writeFileSync(join(dir, 'q-client.log'), 'SYNTHETIC_PRIVATE_CONTENT\n');
 writeFileSync(join(dir, 'q-client.log.1'), 'SYNTHETIC_PRIVATE_CONTENT\n');
 return { base, root: join(base, 'source') };
}

test('report contains only fixed tokens, counts and versions', async () => {
 const f = synthetic();
 const report = await diagnostics({ root: f.root, method: 'configured' });
 assert.equal(report.discovery, 'configured');
 assert.equal(report.sourceLogFiles, 2);
 assert.equal(report.runtime.ok, true);
 assert.equal(report.guard, process.platform === 'win32' ? 'unsupported' : 'posix');
 for (const s of walk(report)) assert.match(s, FIXED, s);
 const text = JSON.stringify(report);
 for (const secret of [f.base, 'synthetic-diag-private', 'SYNTHETIC_PRIVATE_CONTENT', 'kiro.kiroAgent']) assert.ok(!text.includes(secret));
 rmSync(f.base, { recursive: true });
});

test('an absent source is reported as zero files, not as an error or a path', async () => {
 const f = synthetic();
 const report = await diagnostics({ root: join(f.base, 'missing'), method: 'platform_default' });
 assert.equal(report.sourceLogFiles, 0);
 assert.deepEqual(report.sourceCodes, { source_unavailable: 1, no_source_logs: 1 });
 assert.equal(report.discovery, 'platform_default');
 assert.ok(!JSON.stringify(report).includes('synthetic-diag-private'));
 rmSync(f.base, { recursive: true });
});

test('version strings that are not plain version tokens are replaced', async () => {
 const f = synthetic();
 const report = await diagnostics({ root: f.root, method: 'configured', versions: { node: '/private/path/node', electron: '1.2.3' } });
 assert.equal(report.node, 'unknown');
 assert.equal(report.electron, '1.2.3');
 rmSync(f.base, { recursive: true });
});

test('CLI --diagnostics prints the same fixed report and creates no storage', () => {
 const f = synthetic();
 const store = join(f.base, 'gauge');
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', resolve('src/cli.ts'), '--diagnostics', '--source-root', f.root, '--store-dir', store], { encoding: 'utf8' });
 assert.equal(r.status, 0);
 assert.equal(r.stderr, '');
 const report = JSON.parse(r.stdout);
 assert.equal(report.discovery, 'configured');
 assert.equal(report.sourceLogFiles, 2);
 for (const s of walk(report)) assert.match(s, FIXED, s);
 assert.ok(!r.stdout.includes(f.base));
 assert.throws(() => realpathSync(store));
 rmSync(f.base, { recursive: true });
});
