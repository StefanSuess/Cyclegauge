import { build } from 'esbuild';
import { resolve } from 'node:path';
import { isMain } from './is-main.ts';

const root = resolve(import.meta.dirname, '..');
export async function buildExtension(outfile: string): Promise<void> {
 await build({ entryPoints: ['src/extension/extension.ts'], absWorkingDir: root, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['vscode'], outfile, logLevel: 'silent', legalComments: 'none' });
}

if (isMain(import.meta.url)) {
 const output = process.argv[2];
 if (!output) { console.log('USAGE'); process.exitCode = 2; }
 else buildExtension(resolve(output)).catch(() => { console.log('BUILD_FAILED'); process.exitCode = 1; });
}
