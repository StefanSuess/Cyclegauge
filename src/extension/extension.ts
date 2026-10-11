import * as vscode from 'vscode';
import { defaultStorage, hostLogUri, resolveSourceRoot } from '../paths.ts';
import { diagnostics } from '../diagnostics.ts';
import {planNames} from './cost-inputs.ts';
import {PLAN_IDS} from '../cost/types.ts';
import { startExtension, type ExtensionUi } from './controller.ts';

let stop: (() => void) | undefined;
export async function activate(context: vscode.ExtensionContext): Promise<void> {
 // Right alignment/priority is controllable; native Kiro item ordering is not a stable API.
 const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
 item.name = 'EasyKiroGauge credit budget';
 item.command = 'easykirogauge.showUsage';
 item.text = '$(sync~spin) Kiro: Collecting data';
 item.show();
 let panel: vscode.WebviewPanel | undefined;
 let detail = '';
 const disposables: vscode.Disposable[] = [item];
 const config = vscode.workspace.getConfiguration('easykirogauge');
 // Discovery order: explicit setting, the running IDE's own log directory, then the platform default.
 const discovered = resolveSourceRoot({ configured: config.get<string>('sourceRoot') || undefined, logUri: hostLogUri(vscode.env.appName, context.logUri?.fsPath) });
 const source = discovered.root;
 const configuredStorage = config.get<string>('storageRoot');
 const storage = configuredStorage && configuredStorage.trim() !== '' ? configuredStorage : defaultStorage();
 const timezone = config.get<string>('sourceTimezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
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
   panel = vscode.window.createWebviewPanel('easykirogauge.usage', 'Your credit budget', vscode.ViewColumn.One, { enableScripts: false, enableCommandUris: false, localResourceRoots: [] });
   panel.webview.html = html;
   disposables.push(panel.onDidDispose(() => { panel = undefined; }));
  },
  costInput: {
   async pick(title,items) {const selected=await vscode.window.showQuickPick(items.map(i=>({label:i.label,description:i.description,id:i.id})),{title,ignoreFocusOut:true});return selected?.id;},
   async input(title,value,validateInput) {return vscode.window.showInputBox({title,value,validateInput,ignoreFocusOut:true});},
   async plans(title,selected) {const values=await vscode.window.showQuickPick(PLAN_IDS.map(id=>({label:planNames[id],id,picked:selected.includes(id)})),{title,canPickMany:true,ignoreFocusOut:true});return values?.map(i=>i.id);}
  },
  onCostCommand(id,fn) {
   const command={advisor:'costAdvisor'}[id];
   disposables.push(vscode.commands.registerCommand('easykirogauge.'+command,fn));
  },
  onClick(fn) { disposables.push(vscode.commands.registerCommand('easykirogauge.showUsage', fn)); },
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
 disposables.push(vscode.commands.registerCommand('easykirogauge.showDiagnostics', async () => {
  try {
   const report = await diagnostics({ root: source, method: discovered.method });
   void vscode.window.showInformationMessage(`EasyKiroGauge diagnostics: ${JSON.stringify(report)}`);
  } catch { void vscode.window.showWarningMessage('EasyKiroGauge diagnostics unavailable'); }
 }));
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
