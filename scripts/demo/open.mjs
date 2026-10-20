// Copied into the generated demo folder: works without the original checkout.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = dirname(fileURLToPath(import.meta.url));
// Refuse to launch from the checkout or an incomplete profile: no fallback to real Kiro data.
let settings;
try { settings = JSON.parse(readFileSync(join(base, 'user-data', 'User', 'settings.json'), 'utf8')); } catch { /* fixed refusal below */ }
if (!existsSync(join(base, 'synthetic-anchor.txt')) || settings?.['bobert.sourceRoot'] !== join(base, 'source') ||
 settings?.['bobert.storageRoot'] !== join(base, 'storage') || settings?.['bobert.sourceTimezone'] !== 'UTC') {
 console.log('SYNTHETIC_PROFILE_REQUIRED: run pnpm demo:setup first.'); process.exit(1);
}
const candidates = process.platform === 'darwin' ? ['/Applications/Kiro.app/Contents/MacOS/Kiro']
 : process.platform === 'win32' ? [
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Kiro', 'Kiro.exe'),
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Kiro', 'Kiro.exe'),
 ] : ['/usr/share/kiro/kiro', '/opt/Kiro/kiro', '/opt/kiro/kiro'];
const executable = process.argv[2] ? resolve(process.argv[2]) : candidates.find(p => p && existsSync(p));
if (!executable || !existsSync(executable)) {
 console.log('KIRO_IDE_NOT_FOUND: run node open-demo.mjs "<path to Kiro IDE executable>".');
 process.exit(1);
}
const home = join(base, 'home');
const env = { ...process.env, BOBERT_SYNTHETIC_SOURCE: join(base, 'source'), HOME: home, USERPROFILE: home,
 APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
 XDG_CONFIG_HOME: home, XDG_DATA_HOME: home, XDG_STATE_HOME: home, XDG_CACHE_HOME: home };
delete env.VSCODE_IPC_HOOK_CLI;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--user-data-dir', join(base, 'user-data'), '--extensions-dir', join(base, 'extensions'),
 '--new-window', join(base, 'workspace')], { env, cwd: join(base, 'workspace'), detached: true, stdio: 'ignore' });
child.once('error', () => { console.log('KIRO_IDE_LAUNCH_FAILED'); process.exitCode = 1; });
child.once('spawn', () => {
 child.unref();
 console.log('Demo window launch requested. Install install-this.vsix there using Extensions: Install from VSIX.');
});
