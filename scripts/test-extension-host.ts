// Runs only a verified candidate payload against an isolated, wholly synthetic profile.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { build } from 'esbuild';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { readZip } from './release/zip.ts';
import { verifyVsix } from './release/verify-vsix.ts';

const VS_CODE_VERSION = '1.141.0';
const root = resolve(import.meta.dirname, '..');
let base: string | undefined;
try {
 const args = process.argv.slice(2);
 if (args.length !== 1) throw new Error('HOST_TEST_USAGE');
 const archive = readFileSync(resolve(args[0]));
 if (!verifyVsix(archive).ok) throw new Error('HOST_CANDIDATE_INVALID');
 const sha256 = createHash('sha256').update(archive).digest('hex');
 if (process.env.EXPECTED_CANDIDATE_SHA256 && process.env.EXPECTED_CANDIDATE_SHA256 !== sha256) throw new Error('HOST_CANDIDATE_HASH_MISMATCH');
 // Native realpath: the collector rejects a source spelled through a Windows 8.3 short-name alias.
 base = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-host-')));
 const extension = join(base, 'extension'), profile = join(base, 'profile');
 for (const entry of readZip(archive)) {
  if (!entry.name.startsWith('extension/')) continue;
  const path = join(base, entry.name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, entry.data);
 }
 const source = join(base, 'synthetic source ü');
 const logs = join(source, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 mkdirSync(logs, { recursive: true });
 writeFileSync(join(logs, 'q-client.log'), '2030-01-01T00:00:00Z [info] synthetic '+JSON.stringify({ commandName: 'GetUsageLimitsCommand', output: { userInfo: { userId: 'synthetic-host-account' }, prompt: 'SYNTHETIC_CONTENT_SENTINEL', nextDateReset: '2030-02-01T00:00:00Z', usageBreakdownList: [{ resourceType: 'CREDIT', currentUsageWithPrecision: 1.25, usageLimitWithPrecision: 100 }] }, metadata: { httpStatusCode: 200 } })+'\n');
 mkdirSync(join(profile, 'User'), { recursive: true });
 writeFileSync(join(profile, 'User', 'settings.json'), JSON.stringify({
  'cyclegauge.sourceRoot': source, 'cyclegauge.sourceTimezone': 'UTC',
  'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false, 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false,
 }));
 const suite = join(base, 'suite.cjs');
 await build({ entryPoints: [join(root, 'tests/host/suite.ts')], outfile: suite, bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], logLevel: 'silent' });
 const executable = process.env.CYCLEGAUGE_TEST_KIRO_EXECUTABLE || await downloadAndUnzipVSCode({ version: VS_CODE_VERSION, cachePath: join(root, '.vscode-test') });
 const quiet = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
 for (const restart of ['0', '1']) {
  try {
   await runTests({ vscodeExecutablePath: executable, extensionDevelopmentPath: extension, extensionTestsPath: suite,
    launchArgs: ['--user-data-dir', profile, '--extensions-dir', join(base, 'extensions'), '--disable-extensions', '--disable-extension', 'kiro.kiroAgent', '--password-store=basic', '--disable-telemetry', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { CYCLEGAUGE_SYNTHETIC_TEST_ROOT: base, CYCLEGAUGE_SYNTHETIC_RESTART: restart }, stdout: quiet, stderr: quiet,
   });
  } finally {
   // Host logs can contain paths. Emit only the fixed phase and version/platform metadata.
   try {
    const report = JSON.parse(readFileSync(join(base, 'report.json'), 'utf8'));
    console.log(JSON.stringify({ host: process.env.CYCLEGAUGE_TEST_KIRO_EXECUTABLE ? 'kiro' : 'vscode', restart: restart === '1', sha256, ...report }));
   } catch { console.log('HOST_REPORT_UNAVAILABLE'); }
  }
 }
 console.log('HOST_TESTS_PASSED');
} catch { console.error('HOST_TESTS_FAILED'); process.exitCode = 1; }
// A host process can still hold profile handles; a raw cleanup error would print the temporary path.
finally { if (base) try { rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { console.error('HOST_CLEANUP_FAILED'); } }
