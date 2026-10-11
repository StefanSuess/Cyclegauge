import * as vscode from 'vscode';
import { defaultSource, defaultStorage } from '../paths.ts';
import {planNames} from './cost-inputs.ts';
import {PLAN_IDS} from '../cost/types.ts';
import { startExtension, type ExtensionUi } from './controller.ts';
import { LEGACY_EXTENSION_ID, PANEL_VIEW_TYPE, commandId, readSetting, registerCommand } from './identity.ts';

let stop: (() => void) | undefined;
export async function activate(context: vscode.ExtensionContext): Promise<void> {
 // Right alignment/priority is controllable; native Kiro item ordering is not a stable API.
 const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
 item.name = 'Cyclegauge credit budget';
 item.command = commandId('showUsage');
 item.text = '$(sync~spin) Kiro: Collecting data';
 item.show();
 let panel: vscode.WebviewPanel | undefined;
 let detail = '';
 const disposables: vscode.Disposable[] = [item];
 const setting = (key: Parameters<typeof readSetting>[1]) => readSetting((prefix, name) => vscode.workspace.getConfiguration(prefix).get<string>(name), key);
 const source = setting('sourceRoot') || defaultSource();
 const storage = setting('storageRoot') || defaultStorage();
 const timezone = setting('sourceTimezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
 // A still-installed legacy extension owns the legacy command IDs and shares the same private storage folder.
 const legacyInstalled = vscode.extensions.getExtension(LEGACY_EXTENSION_ID) !== undefined;
 if (legacyInstalled) void vscode.window.showWarningMessage('Cyclegauge: the legacy EasyKiroGauge extension is still installed. Disable or uninstall it so only one extension uses the shared usage storage.');
 const register = (suffix: string, fn: () => unknown) => disposables.push(...registerCommand((id, f) => vscode.commands.registerCommand(id, f), suffix, fn, !legacyInstalled));
 const ui: ExtensionUi = {
  setStatus(text, html, meta) {
   item.text = text;
   item.tooltip = meta?.tooltip ?? 'Open your credit budget and forecast';
   item.backgroundColor = meta?.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
   detail = html;
   if (panel) panel.webview.html = detail;
  },
  showDetails(html) {
   if (panel) { panel.reveal(); panel.webview.html = html; return; }
   panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, 'Your credit budget', vscode.ViewColumn.One, { enableScripts: false, enableCommandUris: false, localResourceRoots: [] });
   panel.webview.html = html;
   disposables.push(panel.onDidDispose(() => { panel = undefined; }));
  },
  costInput: {
   async pick(title,items) {const selected=await vscode.window.showQuickPick(items.map(i=>({label:i.label,description:i.description,id:i.id})),{title,ignoreFocusOut:true});return selected?.id;},
   async input(title,value,validateInput) {return vscode.window.showInputBox({title,value,validateInput,ignoreFocusOut:true});},
   async plans(title,selected) {const values=await vscode.window.showQuickPick(PLAN_IDS.map(id=>({label:planNames[id],id,picked:selected.includes(id)})),{title,canPickMany:true,ignoreFocusOut:true});return values?.map(i=>i.id);}
  },
  onCostCommand(id,fn) {
   const command={configure:'configureCostOptimizer',edit:'editCostScenario',clear:'clearCostInputs'}[id];
   register(command,fn);
  },
  onClick(fn) { register('showUsage', fn); },
  onChange(fn) {
   try {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(source), 'logs/**/exthost/kiro.kiroAgent/q-client.log*'));
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const changed = () => { if (debounce) clearTimeout(debounce); debounce = setTimeout(fn, 750); };
    disposables.push(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed), { dispose() { if (debounce) clearTimeout(debounce); } });
   } catch { /* Minute polling remains active when native watching is unavailable. */ }
  },
  everyMinute(fn) { const timer = setInterval(fn, 60_000); disposables.push({ dispose() { clearInterval(timer); } }); },
  dispose() { panel?.dispose(); for (const d of disposables) d.dispose(); }
 };
 try {
  const controller = await startExtension(ui, { source, storage, timezone });
  stop = controller.dispose;
  context.subscriptions.push({ dispose: controller.dispose });
 } catch {
  item.text = '$(warning) Kiro: unavailable';
  context.subscriptions.push(...disposables);
 }
}
export function deactivate(): void { stop?.(); stop = undefined; }
