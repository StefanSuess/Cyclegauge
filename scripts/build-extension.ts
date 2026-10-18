import { build } from 'esbuild';
import { resolve } from 'node:path';
import { isMain } from './is-main.ts';

const root = resolve(import.meta.dirname, '..');
export async function buildExtension(outfile: string): Promise<void> {
 const webview = await build({ entryPoints: ['src/extension/dashboard-webview.ts'], absWorkingDir: root, bundle: true, platform: 'browser', format: 'iife', target: 'es2024', minify: true, legalComments: 'none', sourcemap: false, write: false, logLevel: 'silent' });
 const script = webview.outputFiles[0]?.text;
 if (!script || /sourceMappingURL/.test(script)) throw new Error('DASHBOARD_SCRIPT_BUILD_FAILED');
 await build({ entryPoints: ['src/extension/extension.ts'], absWorkingDir: root, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['vscode'], outfile, define: { __DASHBOARD_SCRIPT__: JSON.stringify(script) }, logLevel: 'silent', legalComments: 'none' });
}

if (isMain(import.meta.url)) {
 const output = process.argv[2];
 if (!output) { console.log('USAGE'); process.exitCode = 2; }
 else buildExtension(resolve(output)).catch(() => { console.log('BUILD_FAILED'); process.exitCode = 1; });
}
