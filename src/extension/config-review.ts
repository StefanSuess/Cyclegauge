import type * as vscode from 'vscode';
import { isAbsolute, relative, sep } from 'node:path';
import { createConfigReviewer, CONFIG_MAX_ROOTS, type ConfigReview } from '../audit/config-review.ts';
import { evaluateConfigRules, type ConfigFinding } from '../audit/config-rules.ts';
import { configPreview, configTree, type ConfigNode, type RefusedConfigRoot } from './config-model.ts';
import { CONFIG_WATCH_GLOB, createConfigScheduler, createNoticeState, noticeDecision, offerDue, readConfigReviewMode, watchShape, type ReviewOrigin, type RunOutcome, type RunTrigger } from './config-schedule.ts';
import { ID_PREFIX, commandId, readSupportPrompts } from './identity.ts';

type FolderCheck = (folder: vscode.WorkspaceFolder) => { chosen: string; resolved: string } | { reason: string };
/** What the review may know about the support prompt: whether one is open or was closed recently, and that the offer is showing. */
export interface SupportGate { promptOpen(): boolean; lastPromptAt(): number | undefined; offerOpen(open: boolean): void }
interface Timers { now(): number; set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
interface Options { reviewer?: ReturnType<typeof createConfigReviewer>; support?: SupportGate; timers?: Timers; platform?: NodeJS.Platform }
export interface ConfigReviewLink { nodes(): ConfigNode[]; run(): Promise<void> }
/**
 * Starts the manual review next to a manual (user-initiated) workspace audit: exactly the run `cyclegauge.reviewKiroConfig` performs, with the same guards,
 * bounded reads and manual-run semantics. Not awaited and never throwing, so neither the audit nor the review can block or hide the other's result.
 */
export function startManualReview(link: Pick<ConfigReviewLink, 'run'>): void {
 try { void Promise.resolve(link.run()).catch(() => undefined); } catch { /* the audit result never depends on the review */ }
}
// The approved boolean (design question 11): set when the enable offer is shown, so it appears once ever. It holds no data.
export const CONFIG_OFFER_KEY = 'cyclegauge.configReview.offered.v1';
export const CONFIG_OFFER_TEXT = 'Check Kiro Steering and Hooks automatically in trusted workspaces you open, and when those files change?';
export const CONFIG_NOTICE_TEXT = 'Cyclegauge found things to review in your Kiro Steering and Hooks.';
const SETTING = 'configReviewAutomatically';
const defaultTimers: Timers = { now: Date.now, set(fn, ms) { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clear(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); } };
// The review owns its result, cancellation and refresh, and never touches audit state. Registering it resolves or reads no folder
// unless the user turned on cyclegauge.configReviewAutomatically; then it has its own scheduler and narrow watcher (design 4.1).
// The editor is injected so native command wiring can be tested with a minimal editor and synthetic roots.
export function registerConfigReview(context: vscode.ExtensionContext, editor: typeof vscode, folderCheck: FolderCheck, refresh: () => void, options: Options = {}): ConfigReviewLink {
 const reviewer = options.reviewer ?? createConfigReviewer(), timers = options.timers ?? defaultTimers;
 const platform = options.platform ?? process.platform, ci = platform === 'darwin' || platform === 'win32';
 let nodes = configTree(), disposed = false, running = false, abort: AbortController | undefined;
 let current: ConfigReview | undefined, generation = 0;
 // Automatic mode, in memory only: the in-flight automatic run, the watcher generation, dirty roots (by index) and notice state.
 let auto: { controller: AbortController; promise: Promise<RunOutcome> } | undefined, watchGeneration = 0, watchKey = '', openDone = false, offering = false, seeded = false, resync = false;
 let watchers: vscode.Disposable[] = [];
 let drawn: { result: ConfigReview; names: string[]; refused: RefusedConfigRoot[]; checkedAt: string; automatic: boolean } | undefined;
 const dirty = new Set<number>(), notice = createNoticeState(), known = new Set<string>(), fresh = new Set<string>();
 const signature = () => (editor.workspace.workspaceFolders ?? []).map(f=>[f.uri.scheme,f.uri.fsPath,f.name].join('\0')).join('\n');
 const mode = () => { try { return readConfigReviewMode(editor.workspace.getConfiguration(ID_PREFIX).inspect<unknown>(SETTING)); } catch { return 'off' as const; } };
 const resolveRoots = () => {
  const roots: string[] = [], names: string[] = [], refused: RefusedConfigRoot[] = [], folders: vscode.WorkspaceFolder[] = [], seen = new Set<string>();
  for (const folder of editor.workspace.workspaceFolders ?? []) {
   if (folder.uri.scheme !== 'file') { refused.push({name:folder.name,code:'root_not_local'}); continue; }
   const checked = folderCheck(folder);
   if ('reason' in checked) { refused.push({name:folder.name,code:'root_refused',reason:checked.reason}); continue; }
   const key = ci ? checked.resolved.toLowerCase() : checked.resolved;
   if (seen.has(key)) continue;
   seen.add(key);
   if (roots.length >= CONFIG_MAX_ROOTS) { refused.push({name:folder.name,code:'limit_roots'}); continue; }
   roots.push(checked.resolved); names.push(folder.name); folders.push(folder);
  }
  return { roots, names, refused, folders };
 };
 const draw = (): void => {
  if (!drawn || disposed) return;
  const { result, names, refused, checkedAt, automatic } = drawn;
  // "New this session": instances first seen after this window's first review. The keys stay in memory.
  const marked = new Set<number>();
  result.findings.forEach((f: ConfigFinding, i) => {
   const key = [f.id, names[f.root] ?? '', f.rel, f.hook ?? ''].join('\0');
   if (!known.has(key)) { known.add(key); if (seeded) fresh.add(key); }
   if (fresh.has(key)) marked.add(i);
  });
  seeded = true;
  nodes = configTree(result,names,checkedAt,new Date(timers.now()),refused,++generation,{automatic,paused:scheduler.paused,fresh:marked}); refresh();
 };
 const failed = (): void => { current = { ...evaluateConfigRules([]),roots:[],status:'unavailable',bytesRead:0,notChecked:{folder_unreadable:1} }; drawn = undefined; nodes = configTree(current); refresh(); };
 // One review. Automatic runs re-check the setting, trust and every root's folder guard before any read, and discard a result
 // whose answers changed meanwhile. 'ran' means the reader was called (it counts toward the cap even when discarded).
 const collect = async (origin: ReviewOrigin, controller: AbortController): Promise<RunOutcome> => {
  const before = signature(), startGeneration = watchGeneration;
  const stillValid = () => !disposed && !controller.signal.aborted && editor.workspace.isTrusted && signature() === before
   && (origin === 'manual' || (mode() !== 'off' && watchGeneration === startGeneration));
  if (!editor.workspace.isTrusted) {
   if (origin !== 'manual') return 'skipped';
   current = { ...evaluateConfigRules([]), roots:[], status:'unavailable',bytesRead:0,notChecked:{untrusted:1} };
   drawn = undefined; nodes = configTree(current); refresh(); return 'ran';
  }
  const { roots, names, refused } = resolveRoots();
  if (origin === 'watch' && mode() === 'onOpenAndChanges' && roots.join('\n') !== watchKey) { resync = true; return 'skipped'; } // a root's guard answer changed: rebuild, read nothing
  if (origin !== 'manual' && (!roots.length || mode() === 'off' || (origin === 'watch' && mode() !== 'onOpenAndChanges'))) return 'skipped';
  const result = roots.length ? await reviewer.review(roots, {signal:controller.signal}) : { ...evaluateConfigRules([]),roots:[],status:'unavailable' as const,bytesRead:0,notChecked: refused.length ? {} : {root_not_local:1} };
  if (!stillValid()) return roots.length ? 'ran' : 'skipped';
  if (refused.length && result.status === 'complete') result.status = 'partial';
  if (origin === 'open') openDone = true; // only a drawn result is the window's open run; a discarded one still counts toward the cap
  current = result; drawn = { result, names, refused, checkedAt: new Date(timers.now()).toISOString(), automatic: origin !== 'manual' }; draw();
  // Fixed text only: no count, file name or hook name.
  if (noticeDecision(notice, result.findings.map(f => f.id), origin, timers.now())) {
   void Promise.resolve(editor.window.showInformationMessage(CONFIG_NOTICE_TEXT, 'Show'))
    .then(choice => choice === 'Show' && !disposed ? editor.commands.executeCommand(commandId('auditView.focus')) : undefined).catch(() => undefined);
  }
  return 'ran';
 };
 const autoRun = async (trigger: RunTrigger): Promise<RunOutcome> => {
  if (disposed) return 'skipped';
  if (running) return 'deferred'; // a manual run is in progress; it wins
  if (trigger === 'watch' && !dirty.size) return 'skipped';
  dirty.clear();
  const controller = new AbortController();
  const promise = collect(trigger, controller).catch((): RunOutcome => { if (!disposed && !controller.signal.aborted) failed(); return 'ran'; });
  auto = { controller, promise };
  try { return await promise; }
  finally { if (auto?.controller === controller) auto = undefined; if (resync && !disposed) { resync = false; sync(); } }
 };
 const scheduler = createConfigScheduler({ now: () => timers.now(), setTimer: (fn, ms) => timers.set(fn, ms), clearTimer: h => timers.clear(h), run: autoRun, onPause: draw });
 // Setting, folders or trust changed: cancel pending runs, abort and discard an in-flight one, rebuild the watchers.
 const sync = (): void => {
  if (disposed) return;
  watchGeneration++;
  for (const w of watchers) { try { w.dispose(); } catch { /* already gone */ } }
  watchers = []; watchKey = ''; dirty.clear(); scheduler.cancel(); auto?.controller.abort();
  const m = mode();
  if (m === 'off' || !editor.workspace.isTrusted) return;
  if (!openDone) scheduler.open();
  if (m !== 'onOpenAndChanges' || !editor.workspace.createFileSystemWatcher) return;
  const { roots, folders } = resolveRoots();
  watchKey = roots.join('\n');
  const gen = watchGeneration;
  folders.forEach((folder, index) => {
   // The handler makes no filesystem call and keeps no path: a shape test on the root-relative name, then a per-root flag.
   const onEvent = (uri: vscode.Uri): void => {
    try {
     if (disposed || gen !== watchGeneration || uri.scheme !== 'file') return;
     const rel = relative(folder.uri.fsPath, uri.fsPath);
     if (rel === '' || isAbsolute(rel) || rel.split(sep).includes('..') || !watchShape(rel.split(sep).join('/'), ci)) return;
     dirty.add(index); scheduler.event();
    } catch { /* a missed event leaves the last result; the manual command stays available */ }
   };
   try {
    const w = editor.workspace.createFileSystemWatcher(new editor.RelativePattern(folder, CONFIG_WATCH_GLOB), false, false, false);
    watchers.push(w, w.onDidCreate(onEvent), w.onDidChange(onEvent), w.onDidDelete(onEvent));
   } catch { /* this root is not watched */ }
  });
 };
 // The one-time offer after a manual run: the global setting only, never with support prompts off or near a support prompt.
 const offer = async (): Promise<void> => {
  if (disposed || offering || !editor.workspace.isTrusted) return;
  offering = true;
  try {
   const config = editor.workspace.getConfiguration(ID_PREFIX);
   const due = offerDue({ supportPrompts: readSupportPrompts((prefix, key) => editor.workspace.getConfiguration(prefix).get<unknown>(key)), globalValue: config.inspect<unknown>(SETTING)?.globalValue,
    offered: context.globalState.get<unknown>(CONFIG_OFFER_KEY), supportOpen: options.support?.promptOpen() ?? false, lastSupportAt: options.support?.lastPromptAt(), now: timers.now() });
   if (!due) return;
   // Reserved synchronously, before any await, so the support prompt (which reserves the same way) never shows alongside it.
   options.support?.offerOpen(true);
   try {
    try { await context.globalState.update(CONFIG_OFFER_KEY, true); } catch { return; } // an offer whose mark cannot be saved is not shown
    if (disposed) return;
    const choice = await editor.window.showInformationMessage(CONFIG_OFFER_TEXT, 'Turn on', 'Not now');
    if (choice === 'Turn on' && !disposed) await config.update(SETTING, 'onOpenAndChanges', editor.ConfigurationTarget.Global);
   } finally { options.support?.offerOpen(false); }
  } catch { /* fixed and silent */ } finally { offering = false; }
 };
 const run = async (): Promise<void> => {
  if (disposed || running) return;
  running = true;
  let shown = false;
  // A manual run wins: an automatic run is aborted and awaited, pending triggers and dirty flags are cleared, and it never counts toward the cap.
  const pending = auto; pending?.controller.abort();
  scheduler.cancel(); dirty.clear();
  const controller = new AbortController(); abort = controller;
  try {
   if (pending) await pending.promise;
   if (disposed) return;
   shown = await collect('manual', controller) === 'ran' && !controller.signal.aborted && !disposed;
   if (shown) try { await editor.commands.executeCommand(commandId('auditView.focus')); } catch { /* the section remains available */ }
  } catch {
   if (disposed || controller.signal.aborted) return;
   failed();
  } finally { running = false; if (abort === controller) abort = undefined; }
  if (shown) void offer();
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
 const registrations: vscode.Disposable[] = [];
 try {
  registrations.push(editor.commands.registerCommand(commandId('reviewKiroConfig'),run));
  registrations.push(editor.commands.registerCommand(commandId('config.preview'),preview));
  const ws = editor.workspace;
  if (ws.onDidChangeConfiguration) registrations.push(ws.onDidChangeConfiguration(event => { try { if (event.affectsConfiguration(`${ID_PREFIX}.${SETTING}`)) sync(); } catch { /* the watchers stay as they were */ } }));
  if (ws.onDidChangeWorkspaceFolders) registrations.push(ws.onDidChangeWorkspaceFolders(() => sync()));
  if (ws.onDidGrantWorkspaceTrust) registrations.push(ws.onDidGrantWorkspaceTrust(() => sync()));
  context.subscriptions.push(...registrations,{dispose(){
   disposed=true; abort?.abort(); auto?.controller.abort(); scheduler.dispose(); watchGeneration++;
   for (const w of watchers) { try { w.dispose(); } catch { /* already gone */ } }
   watchers=[]; dirty.clear(); current=undefined; drawn=undefined; nodes=configTree();
  }});
 } catch {
  for (const registration of registrations) { try { registration.dispose(); } catch { /* best-effort rollback */ } }
  scheduler.dispose();
  throw new Error('Configuration review registration failed.');
 }
 try { sync(); } catch { /* automatic mode stays off; the manual command works */ }
 return {nodes:()=>nodes,run};
}
