#!/usr/bin/env node
// Synthetic-only demo. Never reads or changes an existing Kiro profile.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoParentDir } from './base.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
 console.log('Usage: pnpm demo:setup [--open] [--kiro <IDE executable>] [--vsix <candidate.vsix>]\nChecks fresh synthetic usage; --open launches an isolated Kiro window. Default: build the current checkout.');
 process.exit(0);
}
let open = false, candidate, kiro;
for (let i = 0; i < args.length; i++) {
 if (args[i] === '--open' && !open) open = true;
 else if (args[i] === '--vsix' && candidate === undefined && args[i + 1] && !args[i + 1].startsWith('--')) candidate = resolve(args[++i]);
 else if (args[i] === '--kiro' && kiro === undefined && args[i + 1] && !args[i + 1].startsWith('--')) kiro = resolve(args[++i]);
 else { console.log('USAGE: pnpm demo:setup [--open] [--kiro <IDE executable>] [--vsix <candidate.vsix>]'); process.exit(2); }
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 13)) {
 console.log('NODE_REQUIRED: install Node.js 24.13 or newer.'); process.exit(1);
}
// Native realpath: the collector rejects a source spelled through a Windows 8.3 short-name alias.
// macOS: a long $TMPDIR pushes Kiro's IPC socket past the 103-character limit, so demoParentDir falls back to /tmp.
const base = realpathSync.native(mkdtempSync(join(demoParentDir(), 'synthetic-cyclegauge-demo-')));
const source = join(base, 'source'), storage = join(base, 'storage');
const home = join(base, 'home'), userData = join(base, 'user-data'), extensions = join(base, 'extensions');
const workspace = join(base, 'workspace');
for (const dir of [home, extensions, workspace, join(userData, 'User')]) mkdirSync(dir, { recursive: true, mode: 0o700 });
function run(command, argv, code, options = {}) {
 const result = spawnSync(command, argv, { cwd: root, encoding: 'utf8', timeout: 240_000, ...options });
 if (result.status !== 0) throw new Error(code);
 return result.stdout;
}
try {
 const logs = join(source, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 mkdirSync(logs, { recursive: true, mode: 0o700 });
 const anchor = new Date(Math.floor(Date.now() / 1000) * 1000);
 const lines = [];
 for (let offset = 35; offset >= 0; offset--) {
  const at = new Date(anchor.getTime() - offset * 86_400_000);
  const reset = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)).toISOString();
  const envelope = { commandName: 'GetUsageLimitsCommand', input: {}, output: {
   userInfo: { userId: 'synthetic-acceptance-account' }, nextDateReset: reset,
   usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS',
    currentUsageWithPrecision: 20 * (at.getUTCDate() - 1) + 10, usageLimitWithPrecision: 5000,
    nextDateReset: reset, bonuses: [], overageCredits: [] }],
  }, metadata: { httpStatusCode: 200 } };
  lines.push(`${at.toISOString()} [info] synthetic-envelope ${JSON.stringify(envelope)}\n`);
 }
 writeFileSync(join(logs, 'q-client.log'), lines.join(''), { mode: 0o600 });
 writeFileSync(join(base, 'synthetic-anchor.txt'), anchor.toISOString() + '\n', { mode: 0o600 });
 const cliArgs = ['--disable-warning=ExperimentalWarning', 'src/cli.ts', '--source-root', source, '--store-dir', join(base, 'preflight-store'), '--source-timezone', 'UTC', '--json'];
 const first = JSON.parse(run(process.execPath, cliArgs, 'COLLECTOR_FAILED'));
 if (first.import.imported !== 36 || first.observation.status !== 'observed' || first.observation.baseLimit !== '5000' || first.observation.forecast.status !== 'qualified' || first.observation.forecast.tier !== 'regular') throw new Error('INGESTION_CHECK_FAILED');
 const second = JSON.parse(run(process.execPath, cliArgs, 'REIMPORT_FAILED'));
 if (second.import.imported !== 0 || second.import.duplicates !== 36) throw new Error('DEDUPLICATION_CHECK_FAILED');
 console.log('Synthetic ingestion PASS (36 records); repeat import PASS.');
 console.log(`Expected usage: ${first.observation.usage}; reported limit: 5000; remaining: ${first.observation.remainingBaseCredits} credits.`);
 console.log(`Forecast: ${first.observation.forecast.tier} (${first.observation.forecast.status}).`);
 const { buildVsix } = await import('../release/build-vsix.ts');
 const { verifyVsix } = await import('../release/verify-vsix.ts');
 const vsix = candidate ?? join(base, 'synthetic-demo.vsix');
 if (!candidate) await buildVsix(vsix, true);
 const verified = verifyVsix(readFileSync(vsix));
 if (!verified.ok) throw new Error('PACKAGE_CHECK_FAILED');
 console.log(`VSIX content verification PASS; version ${verified.version} (${candidate ? 'supplied candidate' : 'current checkout'}).`);
 copyFileSync(vsix, join(base, 'install-this.vsix'));
 writeFileSync(join(userData, 'User', 'settings.json'), JSON.stringify({
  'cyclegauge.sourceRoot': source, 'cyclegauge.storageRoot': storage, 'cyclegauge.sourceTimezone': 'UTC',
  'window.title': 'SYNTHETIC DEMO - not real usage', 'workbench.startupEditor': 'none',
  'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
 }, null, 2), { mode: 0o600 });
 writeFileSync(join(workspace, 'README.txt'), 'SYNTHETIC DEMO — invented usage, not your account.\nOpen Cyclegauge: Show Account Credits from the Command Palette.\nSee docs/synthetic-demo.md in the project for the checklist.\n', { mode: 0o600 });
 const launch = join(base, 'open-demo.mjs');
 copyFileSync(join(root, 'scripts/demo/open.mjs'), launch);
 console.log(`Demo folder: ${base}\nReopen: node "${launch}"\nInstall in the DEMO window: ${join(base, 'install-this.vsix')}\nChecklist: docs/synthetic-demo.md\nClose the demo window before deleting its folder. Run setup again for fresh data.`);
 if (open) {
  run(process.execPath, [launch, ...(kiro ? [kiro] : [])], 'ISOLATED_LAUNCH_FAILED', { stdio: 'inherit' });
 }
} catch (error) {
 console.log(`DEMO_SETUP_FAILED: ${error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'CHECK_FAILED'}`);
 console.log(`Incomplete synthetic demo folder: ${base}`);
 process.exitCode = 1;
}
