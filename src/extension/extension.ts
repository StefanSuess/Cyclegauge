import * as vscode from 'vscode';
import { runAudit, snippet, type AuditResult } from '../audit/audit.ts';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { defaultSource, defaultStorage } from '../paths.ts';
import { refusal } from './audit-root.ts';
import { presentAudit } from './audit-presentation.ts';
import { startExtension, type ExtensionUi } from './controller.ts';
import { AUDIT_VIEW_TYPE, PANEL_VIEW_TYPE, commandId, readSetting, registerCommand } from './identity.ts';

let stop: (() => void) | undefined;
export async function activate(context: vscode.ExtensionContext): Promise<void> {
 await runCyclegauge(context);
}
// Runs only when the user invokes the command; nothing is written, persisted, logged or sent.
function registerAudit(context: vscode.ExtensionContext): void {
 const configured = (key: Parameters<typeof readSetting>[1]) => readSetting((prefix, name) => vscode.workspace.getConfiguration(prefix).get<string>(name), key);
 let panel: vscode.WebviewPanel | undefined, running = false;
 // Every spelling of a path that exists: as given and with symlinks resolved.
 const forms = (p: string): string[] => { if (p === '') return []; try { const real = realpathSync.native(p); return real === p ? [p] : [p, real]; } catch { return [p]; } };
 const audit = async (): Promise<void> => {
  if (running) { await vscode.window.showInformationMessage('A workspace audit is already running.'); return; }
  running = true;
  try {
   let result: AuditResult | undefined;
   try { result = await auditOnce(); } finally { running = false; }
   // Prompted after the run is released, so an unanswered notification never blocks the next audit.
   if (!result || result.findings.length === 0) return;
   const choice = await vscode.window.showInformationMessage(`Workspace audit: ${result.findings.length + result.omitted} findings.`, 'Copy suggestions');
   if (choice === 'Copy suggestions') await vscode.env.clipboard.writeText(snippet(result.findings));
  } catch { try { await vscode.window.showErrorMessage('The workspace audit failed.'); } catch { /* nothing more to report */ } }
 };
 const auditOnce = async (): Promise<AuditResult | undefined> => {
  if (!vscode.workspace.isTrusted) { await vscode.window.showWarningMessage('Cyclegauge audits only trusted workspaces.'); return; }
  const folders = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file');
  if (folders.length === 0) { await vscode.window.showInformationMessage('Open a local folder to audit.'); return; }
  let folder: vscode.WorkspaceFolder | undefined = folders[0];
  if (folders.length > 1) {
   const picked = await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, folder: f })), { title: 'Folder to audit' });
   folder = picked?.folder;
  }
  if (!folder) return;
  const root = folder.uri.fsPath;
  let realRoot: string | undefined;
  try { realRoot = realpathSync.native(root); } catch { /* refused below */ }
  const reason = realRoot === undefined ? 'its real location could not be resolved'
   : refusal([root, realRoot], [defaultSource(), configured('sourceRoot')].flatMap(forms), [context.globalStorageUri.fsPath, defaultStorage(), configured('storageRoot')].flatMap(forms), forms(homedir()));
  if (reason) { await vscode.window.showWarningMessage(`This folder can't be audited: ${reason}.`); return; }
  const setting = vscode.workspace.getConfiguration('kiroAgent', folder.uri).get<unknown>('agentIgnoreFiles');
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Auditing workspace…', cancellable: true }, async (_progress, token) => {
   const abort = new AbortController();
   token.onCancellationRequested(() => abort.abort());
   return runAudit(root, setting, { signal: abort.signal });
  });
  const html = presentAudit(result);
  if (panel) { panel.reveal(); panel.webview.html = html; }
  else {
   const created = vscode.window.createWebviewPanel(AUDIT_VIEW_TYPE, 'Workspace audit', vscode.ViewColumn.One, { enableScripts: false, enableCommandUris: false, localResourceRoots: [] });
   created.webview.html = html; created.onDidDispose(() => { if (panel === created) panel = undefined; }); panel = created;
  }
  return result;
 };
 // Registered independently of the collector so that it survives a failing start.
 context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), 'auditWorkspace', audit), { dispose() { panel?.dispose(); } });
}
async function runCyclegauge(context: vscode.ExtensionContext): Promise<void> {
 try { registerAudit(context); } catch { /* The audit must never stop the gauge from starting. */ }
 // Right alignment/priority is controllable; native Kiro item ordering is not a stable API.
 const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
 item.name = 'Cyclegauge credit budget';
 item.command = commandId('showUsage');
 item.text = '$(sync~spin) Kiro: Collecting data';
 item.show();
 // The webview stays script-free and command-URI-free, so the Cost Advisor needs a native entry point that does not
 // rely only on the easy-to-overlook editor title bar button: a status bar item shown while the panel is open.
 const advisorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
 advisorItem.name = 'Cyclegauge Cost Advisor';
 advisorItem.text = '$(lightbulb) Cost Advisor';
 advisorItem.tooltip = 'Confirm your plan and compare costs';
 advisorItem.command = commandId('costAdvisor');
 let panel: vscode.WebviewPanel | undefined;
 let detail = '';
 const disposables: vscode.Disposable[] = [item, advisorItem];
 const setting = (key: Parameters<typeof readSetting>[1]) => readSetting((prefix, name) => vscode.workspace.getConfiguration(prefix).get<string>(name), key);
 const source = setting('sourceRoot') || defaultSource();
 // Like any extension: the editor's own per-extension storage folder unless a location is chosen.
 const chosenStorage = setting('storageRoot');
 const storage = chosenStorage || context.globalStorageUri.fsPath;
 const timezone = setting('sourceTimezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
 const register = (suffix: string, fn: () => unknown) => disposables.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), suffix, fn));
 const ui: ExtensionUi = {
  setStatus(text, html, meta) {
   item.text = text;
   item.tooltip = meta?.tooltip ?? 'Open your credit budget and forecast';
   item.backgroundColor = meta?.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
   detail = html;
   if (panel) panel.webview.html = detail;
  },
  showDetails(html) {
   if (panel) { panel.reveal(); panel.webview.html = html; advisorItem.show(); return; }
   panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, 'Your credit budget', vscode.ViewColumn.One, { enableScripts: false, enableCommandUris: false, localResourceRoots: [] });
   panel.webview.html = html;
   advisorItem.show();
   disposables.push(panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) advisorItem.show(); else advisorItem.hide(); }));
   disposables.push(panel.onDidDispose(() => { panel = undefined; advisorItem.hide(); }));
  },
  costInput: {
   async pick(title,items) {const selected=await vscode.window.showQuickPick(items.map(i=>({label:i.label,description:i.description,id:i.id})),{title,ignoreFocusOut:true});return selected?.id;},
   async input(title,value,validateInput) {return vscode.window.showInputBox({title,value,validateInput,ignoreFocusOut:true});}
  },
  onCostCommand(id,fn) {
   const command={advisor:'costAdvisor'}[id];
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
  const controller = await startExtension(ui, { source, storage, profileStorage: !chosenStorage, timezone });
  stop = controller.dispose;
  context.subscriptions.push({ dispose: controller.dispose });
 } catch {
  item.text = '$(warning) Kiro: unavailable';
  context.subscriptions.push(...disposables);
 }
}
export function deactivate(): void { stop?.(); stop = undefined; }
