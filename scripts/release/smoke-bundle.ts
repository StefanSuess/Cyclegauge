// Bundle smoke test (Milestone 6, Task 9): loads the SHIPPED dist/extension.cjs (from a .vsix or a
// bare file) with a stub `vscode` module against an invented log root, then checks activation,
// status text, the detail view, the diagnostics command and deactivation.
//
//   node scripts/release/smoke-bundle.ts <file.vsix|extension.cjs> [--simulate no-sqlite|no-reviver|no-watcher]
//
// This is NOT native Kiro verification: no real IDE, extension host or account data is involved.
// Every environment variable that locates user data is redirected into the temp directory first.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMain } from '../is-main.ts';
import { readZip } from './zip.ts';
import { createSyntheticRoot, SYNTHETIC_ACCOUNT } from './synthetic-root.ts';

export type Simulation = 'none' | 'no-sqlite' | 'no-reviver' | 'no-watcher';
export interface SmokeResult { ok: boolean; checks: Record<string, boolean>; failures: string[] }

interface Disposable { dispose(): void }
function stubVscode(sim: Simulation, settings: Record<string, string>, log: { status: string[]; html: string[]; messages: string[]; commands: Map<string, () => unknown> }) {
 const disposable: Disposable = { dispose() {} };
 return {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { One: 1 },
  ThemeColor: class { id: string; constructor(id: string) { this.id = id; } },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  RelativePattern: class { base: unknown; pattern: string; constructor(base: unknown, pattern: string) { this.base = base; this.pattern = pattern; } },
  env: { appName: 'Kiro' },
  window: {
   createStatusBarItem() {
    const item = { name: '', command: '', tooltip: '', backgroundColor: undefined as unknown, _text: '',
     get text() { return this._text; }, set text(v: string) { this._text = v; log.status.push(v); }, show() {}, hide() {}, dispose() {} };
    return item;
   },
   createWebviewPanel() {
    let html = '';
    return { webview: { get html() { return html; }, set html(v: string) { html = v; log.html.push(v); } }, reveal() {}, dispose() {}, onDidDispose: () => disposable };
   },
   showQuickPick: async () => undefined, showInputBox: async () => undefined,
   showInformationMessage: async (m: string) => { log.messages.push(m); }, showWarningMessage: async (m: string) => { log.messages.push(m); },
  },
  workspace: {
   getConfiguration: () => ({ get: (key: string) => settings[key] ?? '' }),
   createFileSystemWatcher() {
    if (sim === 'no-watcher') throw new Error('SYNTHETIC_WATCHER_UNAVAILABLE');
    return { onDidCreate: () => disposable, onDidChange: () => disposable, onDidDelete: () => disposable, dispose() {} };
   },
  },
  commands: { registerCommand(id: string, fn: () => unknown) { log.commands.set(id, fn); return { dispose() { log.commands.delete(id); } }; } },
 };
}

export function bundleSource(file: string): string {
 const bytes = readFileSync(file);
 if (!file.endsWith('.vsix')) return bytes.toString('utf8');
 const entry = readZip(bytes).find(e => e.name === 'extension/dist/extension.cjs');
 if (!entry) throw new Error('BUNDLE_MISSING');
 return entry.data.toString('utf8');
}

export async function smoke(file: string, simulate: Simulation = 'none'): Promise<SmokeResult> {
 const work = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-smoke-')));
 const checks: Record<string, boolean> = {};
 const failures: string[] = [];
 const check = (name: string, value: boolean) => { checks[name] = value; if (!value) failures.push(name); };
 let live: { dispose(): void }[] = [];
 let extensionModule: { deactivate(): void } | undefined;
 const saved = { env: { ...process.env }, getBuiltin: (process as { getBuiltinModule?: unknown }).getBuiltinModule, parse: JSON.parse, load: (Module as unknown as { _load: unknown })._load };
 try {
  // Nothing may resolve to a real profile: user-data locations point into the temp directory.
  const home = join(work, 'home'); mkdirSync(home);
  for (const key of ['HOME', 'USERPROFILE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) process.env[key] = home;
  process.env.HOMEDRIVE = '';
  const root = join(work, 'ide-data'), owned = join(work, 'owned');
  createSyntheticRoot(root);
  const bundlePath = join(work, 'extension.cjs');
  writeFileSync(bundlePath, bundleSource(file));

  if (simulate === 'no-sqlite') {
   (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule = (id: string) =>
    id === 'node:sqlite' ? undefined : (saved.getBuiltin as (id: string) => unknown)(id);
  }
  if (simulate === 'no-reviver') {
   JSON.parse = ((text: string, reviver?: (k: string, v: unknown) => unknown) =>
    saved.parse(text, reviver ? (k: string, v: unknown) => reviver(k, v) : undefined)) as typeof JSON.parse;
  }
  const log = { status: [] as string[], html: [] as string[], messages: [] as string[], commands: new Map<string, () => unknown>() };
  const vscode = stubVscode(simulate, { storageRoot: owned }, log);
  const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  loader._load = function (request: string, ...rest: unknown[]) {
   return request === 'vscode' ? vscode : (saved.load as typeof loader._load).call(this, request, ...rest);
  };
  const extension = createRequireFor(bundlePath)(bundlePath) as { activate(c: unknown): Promise<void>; deactivate(): void };
  check('exports_activate_and_deactivate', typeof extension.activate === 'function' && typeof extension.deactivate === 'function');

  const subscriptions: Disposable[] = [];
  live = subscriptions;
  extensionModule = extension;
  await extension.activate({ subscriptions, logUri: { fsPath: join(root, 'logs', 'synthetic-run', 'synthetic-window-1', 'exthost', 'synthetic.extension') } });
  check('registers_usage_command', log.commands.has('easykirogauge.showUsage'));
  check('registers_diagnostics_command', log.commands.has('easykirogauge.showDiagnostics'));
  check('status_item_updated', log.status.length > 0);

  await log.commands.get('easykirogauge.showUsage')?.();
  const detail = log.html.at(-1) ?? '';
  const refused = process.platform === 'win32';
  if (simulate === 'no-sqlite' || simulate === 'no-reviver') {
   check('runtime_unsupported_state_shown', /lacks a feature EasyKiroGauge needs/.test(detail));
   check('no_budget_invented', !/Credits used<\/div><div class="value">\d/.test(detail));
  } else if (refused) {
   check('windows_storage_refused_state_shown', /not supported on this platform yet/.test(detail));
  } else {
   check('detail_view_shows_budget', /Your credit budget/.test(detail) && /Credits used/.test(detail));
   check('observed_usage_present', /Credits used<\/div><div class="value">\d+(?:\.\d+)? credits</.test(detail));
   if (process.env.EKG_SMOKE_DEBUG) console.log('status:', log.status.at(-1));
   check('status_text_has_no_error_label', !/unavailable/i.test(log.status.at(-1) ?? ''));
  }
  check('detail_has_no_account_marker', !detail.includes(SYNTHETIC_ACCOUNT));
  check('detail_has_no_paths', !detail.includes(work));

  await log.commands.get('easykirogauge.showDiagnostics')?.();
  const message = log.messages.at(-1) ?? '';
  const json = message.slice(message.indexOf('{'));
  let report: Record<string, unknown> = {};
  try { report = JSON.parse(json); } catch { /* checked below */ }
  check('diagnostics_is_fixed_report', report.schema === 'ekg-diagnostics.1');
  check('diagnostics_discovery_is_log_uri', report.discovery === 'log_uri');
  check('diagnostics_has_no_paths_or_markers', !message.includes(work) && !message.includes(SYNTHETIC_ACCOUNT) && !message.includes('kiro.kiroAgent'));

  for (const d of subscriptions) d.dispose();
  extension.deactivate();
  live = []; extensionModule = undefined;
  check('deactivates_cleanly', true);
 } catch {
  failures.push('exception');
 } finally {
  // Timers registered by the bundle must not outlive the temp directory, also after a failure.
  try { for (const d of live) d.dispose(); extensionModule?.deactivate(); } catch { /* best effort */ }
  (Module as unknown as { _load: unknown })._load = saved.load;
  JSON.parse = saved.parse;
  (process as { getBuiltinModule?: unknown }).getBuiltinModule = saved.getBuiltin;
  for (const key of Object.keys(process.env)) if (!(key in saved.env)) delete process.env[key];
  Object.assign(process.env, saved.env);
  rmSync(work, { recursive: true, force: true });
 }
 return { ok: failures.length === 0, checks, failures };
}
import { createRequire } from 'node:module';
const createRequireFor = (path: string) => createRequire(path);

const SIMULATIONS: readonly Simulation[] = ['none', 'no-sqlite', 'no-reviver', 'no-watcher'];
/** Strict: an unknown flag, a repeated option or a second file is a usage error, never a different run. */
export function parseArgs(argv: string[]): { file: string; simulate: Simulation } | undefined {
 let file: string | undefined, simulate: Simulation | undefined;
 for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--simulate') {
   const value = argv[++i];
   if (simulate !== undefined || !(SIMULATIONS as readonly string[]).includes(value)) return undefined;
   simulate = value as Simulation;
  } else if (a.startsWith('--') || file !== undefined) return undefined;
  else file = a;
 }
 return file === undefined ? undefined : { file, simulate: simulate ?? 'none' };
}

async function main(): Promise<number> {
 const args = parseArgs(process.argv.slice(2));
 if (!args) { console.log('USAGE'); return 2; }
 const { file, simulate } = args;
 const result = await smoke(file, simulate);
 console.log(`BUNDLE_SMOKE ${result.ok ? 'PASS' : 'FAIL'} simulate=${simulate} platform=${process.platform}`);
 for (const [name, ok] of Object.entries(result.checks)) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
 for (const f of result.failures) if (!(f in result.checks)) console.log(`  FAIL ${f}`);
 return result.ok ? 0 : 1;
}
if (isMain(import.meta.url)) process.exitCode = await main();
