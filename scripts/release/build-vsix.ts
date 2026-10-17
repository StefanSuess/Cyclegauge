// Builds a VSIX from the working tree in a throw-away staging directory, so nothing in the
// repository (dist/, existing artifacts) is touched. Works the same on every OS.
//
//   node scripts/release/build-vsix.ts <output.vsix> [--pre-release]
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../is-main.ts';
import { buildExtension } from '../build-extension.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGED = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', '.vscodeignore', 'assets/branding/cyclegauge-icon-256.png'];

/**
 * Classify VSCE failures without leaking arbitrary child-process output.
 * VSCE may print package metadata, paths or other untrusted content.
 * Only stable, allowlisted diagnostic codes may reach CI logs.
 */
export function classifyVsceFailure(result: {
 status: number | null;
 signal?: string | null;
 error?: Error;
 stdout?: string | null;
 stderr?: string | null;
}): string {
 if (result.signal) return 'VSCE_TERMINATED';
 if (result.error) return 'VSCE_SPAWN_FAILED';
 const output = (result.stdout || '') + '\n' + (result.stderr || '');
 if (/@types\/vscode/i.test(output) && /(?:engines?\.?vscode|version|incompatib|not supported)/i.test(output)) {
  return 'VSCE_TYPES_ENGINE_MISMATCH';
 }
 return 'VSCE_PACKAGE_FAILED';
}

export async function buildVsix(output: string, preRelease = false): Promise<void> {
 const stage = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-vsix-stage-')));
 try {
  for (const file of STAGED) {
   mkdirSync(dirname(join(stage, file)), { recursive: true });
   copyFileSync(join(root, file), join(stage, file));
  }
  mkdirSync(join(stage, 'dist'));
  await buildExtension(join(stage, 'dist', 'extension.cjs'));
  const require = createRequire(join(root, 'package.json'));
  const vscePackage = require.resolve('@vscode/vsce/package.json');
  const bin = JSON.parse(readFileSync(vscePackage, 'utf8')).bin as Record<string, string>;
  const entry = join(dirname(vscePackage), bin.vsce);
  const args = [entry, 'package', '--no-dependencies', '--allow-missing-repository', ...(preRelease ? ['--pre-release'] : []), '--out', resolve(output)];
  const run = spawnSync(process.execPath, args, { cwd: stage, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' });
  if (run.status !== 0 || run.error) throw new Error(classifyVsceFailure(run));
 } finally { try { rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* a locked temp file must not turn a good build into a failure */ } }
}

if (isMain(import.meta.url)) {
 const args = process.argv.slice(2);
 const flags = args.filter(a => a.startsWith('--'));
 const out = args.find(a => !a.startsWith('--'));
 if (!out || flags.some(f => f !== '--pre-release')) { console.log('USAGE'); process.exitCode = 2; }
 else buildVsix(out, flags.length > 0).then(() => console.log('VSIX_BUILT'), (err: unknown) => {
  const codes = new Set(['VSCE_SPAWN_FAILED', 'VSCE_TERMINATED', 'VSCE_TYPES_ENGINE_MISMATCH', 'VSCE_PACKAGE_FAILED']);
  const diagnostic = err instanceof Error && codes.has(err.message) ? err.message : 'BUILD_FAILED';
  console.log(`VSIX_BUILD_FAILED ${diagnostic}`);
  process.exitCode = 1;
 });
}
