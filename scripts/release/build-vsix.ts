// Builds a VSIX from the working tree in a throw-away staging directory, so nothing in the
// repository (dist/, existing artifacts) is touched. Works the same on every OS.
//
//   node scripts/release/build-vsix.ts <output.vsix>
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../is-main.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function buildVsix(output: string): Promise<void> {
 const stage = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-vsix-stage-')));
 try {
  for (const file of ['package.json', 'README.md', '.vscodeignore']) copyFileSync(join(root, file), join(stage, file));
  mkdirSync(join(stage, 'dist'));
  const { build } = await import('esbuild');
  await build({
   entryPoints: ['src/extension/extension.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24',
   external: ['vscode'], outfile: join(stage, 'dist', 'extension.cjs'), absWorkingDir: root, logLevel: 'silent', legalComments: 'none',
  });
  const require = createRequire(join(root, 'package.json'));
  const vscePackage = require.resolve('@vscode/vsce/package.json');
  const bin = JSON.parse(readFileSync(vscePackage, 'utf8')).bin as Record<string, string>;
  const entry = join(dirname(vscePackage), bin.vsce);
  const run = spawnSync(process.execPath, [entry, 'package', '--no-dependencies', '--allow-missing-repository', '--out', resolve(output)],
   { cwd: stage, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL' });
  if (run.status !== 0) throw new Error('VSCE_PACKAGE_FAILED');
 } finally { try { rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* a locked temp file must not turn a good build into a failure */ } }
}

if (isMain(import.meta.url)) {
 const out = process.argv[2];
 if (!out) { console.log('USAGE'); process.exitCode = 2; }
 else buildVsix(out).then(() => console.log('VSIX_BUILT'), () => { console.log('VSIX_BUILD_FAILED'); process.exitCode = 1; });
}
