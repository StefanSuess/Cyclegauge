import type * as vscode from 'vscode';
import { createConfigReviewer, CONFIG_MAX_ROOTS, type ConfigReview } from '../audit/config-review.ts';
import { evaluateConfigRules } from '../audit/config-rules.ts';
import { configPreview, configTree, type ConfigNode, type RefusedConfigRoot } from './config-model.ts';
import { commandId } from './identity.ts';

type FolderCheck = (folder: vscode.WorkspaceFolder) => { chosen: string; resolved: string } | { reason: string };
interface Options { reviewer?: ReturnType<typeof createConfigReviewer> }
export interface ConfigReviewLink { nodes(): ConfigNode[] }
// The manual review owns its result, cancellation and refresh. Merely registering it never resolves or reads a folder.
// The editor is injected so native command wiring can be tested with a minimal editor and synthetic roots.
export function registerConfigReview(context: vscode.ExtensionContext, editor: typeof vscode, folderCheck: FolderCheck, refresh: () => void, options: Options = {}): ConfigReviewLink {
 const reviewer = options.reviewer ?? createConfigReviewer();
 let nodes = configTree(), disposed = false, running = false, abort: AbortController | undefined;
 let current: ConfigReview | undefined, generation = 0;
 const signature = () => (editor.workspace.workspaceFolders ?? []).map(f=>[f.uri.scheme,f.uri.fsPath,f.name].join('\0')).join('\n');
 const run = async (): Promise<void> => {
  if (disposed || running) return;
  running = true;
  const controller = new AbortController(); abort = controller;
  try {
   const before = signature(), roots: string[] = [], names: string[] = [], refused: RefusedConfigRoot[] = [], seen = new Set<string>();
   if (!editor.workspace.isTrusted) {
    current = { ...evaluateConfigRules([]), roots:[], status:'unavailable',bytesRead:0,notChecked:{untrusted:1} };
    nodes = configTree(current); refresh(); return;
   }
   for (const folder of editor.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') { refused.push({name:folder.name,code:'root_not_local'}); continue; }
    const checked = folderCheck(folder);
    if ('reason' in checked) { refused.push({name:folder.name,code:'root_refused',reason:checked.reason}); continue; }
    const key = process.platform === 'darwin' || process.platform === 'win32' ? checked.resolved.toLowerCase() : checked.resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    if (roots.length >= CONFIG_MAX_ROOTS) { refused.push({name:folder.name,code:'limit_roots'}); continue; }
    roots.push(checked.resolved); names.push(folder.name);
   }
   const result = roots.length ? await reviewer.review(roots, {signal:controller.signal}) : { ...evaluateConfigRules([]),roots:[],status:'unavailable' as const,bytesRead:0,notChecked: refused.length ? {} : {root_not_local:1} };
   if (disposed || controller.signal.aborted || !editor.workspace.isTrusted || signature() !== before) return;
   if (refused.length && result.status === 'complete') result.status = 'partial';
   current = result; nodes = configTree(result,names,new Date().toISOString(),new Date(),refused,++generation); refresh();
   try { await editor.commands.executeCommand(commandId('auditView.focus')); } catch { /* the section remains available */ }
  } catch {
   if (disposed || controller.signal.aborted) return;
   current = { ...evaluateConfigRules([]),roots:[],status:'unavailable',bytesRead:0,notChecked:{folder_unreadable:1} };
   nodes = configTree(current); refresh();
  } finally { running = false; if (abort === controller) abort = undefined; }
 };
 const preview = async (arg: unknown): Promise<void> => {
  if (disposed || !current || !editor.workspace.isTrusted || typeof arg !== 'string') return;
  const find = (list: ConfigNode[]): ConfigNode | undefined => {
   for (const node of list) { if (node.id === arg) return node; const child = node.children && find(node.children); if (child) return child; }
   return undefined;
  };
  const node = find(nodes);
  if (!node?.finding || node.action !== 'previewKiroConfig') return;
  const content = configPreview(current,node.finding);
  if (!content) return;
  try { const document = await editor.workspace.openTextDocument({content,language:'plaintext'}); await editor.window.showTextDocument(document); }
  catch { /* no exception text leaves the preview */ }
 };
 context.subscriptions.push(editor.commands.registerCommand(commandId('reviewKiroConfig'),run),editor.commands.registerCommand(commandId('config.preview'),preview),{dispose(){disposed=true;abort?.abort();current=undefined;nodes=configTree();}});
 return {nodes:()=>nodes};
}
