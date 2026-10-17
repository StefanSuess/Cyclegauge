import * as vscode from 'vscode';
import { runAudit, snippet, type AuditResult, type Finding } from '../audit/audit.ts';
import { lstatSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { defaultSource, defaultStorage, inside } from '../paths.ts';
import { refusal } from './audit-root.ts';
import { MAX_DISMISSED, auditTree, dismissHash, findingKey, isHash, countFindings, countsText, kiroignoreAppend, revealTarget, visibleFindings, type AuditNode, type AuditSummary } from './audit-model.ts';
import { startExtension, type ExtensionUi } from './controller.ts';
import { buildDiagnostics, formatDiagnostics, runtimeFacts, type DiagnosticsInput } from '../diagnostics.ts';
import { ID_PREFIX, LINKS, NOT_KIRO_TEXT, PANEL_VIEW_TYPE, SHARE_TEXT, commandId, isKiroEditor, readAuditAutomatically, readReminderDays, readSetting, readSupportPrompts, registerCommand } from './identity.ts';
import { LATER_DAYS, addDays, auditDue, daysBetween, isDate, utcDate } from './audit-schedule.ts';
import { SNOOZE_DAYS, afterChoice, supportDue, type SupportChoice } from './support-schedule.ts';

let stop: (() => void) | undefined;
// What Copy Diagnostics may report: fixed states only. Kept outside runCyclegauge so the command also works after a failed start.
const gaugeState: { gauge: 'starting' | 'running' | 'failed_to_start'; diagnostics?: () => DiagnosticsInput; config?: Pick<DiagnosticsInput, 'storage' | 'source' | 'timezone'> } = { gauge: 'starting' };
export async function activate(context: vscode.ExtensionContext): Promise<void> {
 await runCyclegauge(context);
}
// Builds a reviewable plain-text report in memory, opens it as an unsaved document and copies it; Cyclegauge writes nothing to disk.
function registerDiagnostics(context: vscode.ExtensionContext): void {
 const copy = async (): Promise<void> => {
  try {
   const text = formatDiagnostics(buildDiagnostics({ ...gaugeState.config, ...gaugeState.diagnostics?.(), ...runtimeFacts(), surface: 'extension', gauge: gaugeState.gauge,
    editor: vscode.env.appName, editorVersion: vscode.version, audit: true }));
   const document = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
   await vscode.window.showTextDocument(document);
   await vscode.env.clipboard.writeText(text);
   // Not awaited: the notification resolves only when dismissed.
   void Promise.resolve(vscode.window.showInformationMessage('Diagnostics copied. Review them before pasting.')).catch(() => undefined);
  } catch { try { await vscode.window.showErrorMessage('Diagnostics could not be copied.'); } catch { /* nothing more to report */ } }
 };
 context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), 'copyDiagnostics', copy));
}
// The audit runs when the user invokes the command, or from the reminder: a prompt once per window when the workspace has never been
// audited or is due again (reminderDays), and, only if the user turned on cyclegauge.auditAutomatically in their own user settings, a silent
// re-run of the same audit when it is due. Cyclegauge itself writes no file and no setting: Accept only prepares an
// unsaved edit, and the only things persisted are, in the editor's per-workspace state, the salted-hash list of ignored findings
// and, for the reminder, the UTC date of the last audit, a snooze date and a "never remind" flag. No path is ever stored.
const DISMISSED_KEY = 'cyclegauge.audit.dismissed.v1';
const LAST_KEY = 'cyclegauge.audit.last.v1';
const SNOOZE_KEY = 'cyclegauge.audit.snoozeUntil.v1';
const NEVER_KEY = 'cyclegauge.audit.neverRemind.v1';
const REMINDER_DELAY_MS = 30_000;
interface Dismissed { salt: string; hashes: string[] }
// What the credit detail view may show about the audit: a counts-and-times summary, plus a hook that re-renders the view when it changes.
interface AuditLink { summary(): AuditSummary; onChange(fn: () => void): void }
function registerAudit(context: vscode.ExtensionContext, onFinding: () => void, onSaved: () => void): AuditLink {
 const configured = (key: Parameters<typeof readSetting>[1]) => readSetting((prefix, name) => vscode.workspace.getConfiguration(prefix).get<string>(name), key);
 let running = false, disposed = false, reminderAbort: AbortController | undefined, result: AuditResult | undefined, folderName = '', root = '', realRoot = '', roots: AuditNode[] = [];
 let checkedAt: string | undefined, refused = false, summaryChanged: () => void = () => undefined;
 let changed: vscode.EventEmitter<AuditNode | undefined> | undefined, viewReady = false;
 const accepted = new Set<string>();
 // A save must match the prepared edit, or contain every suggested line copied from the auto-save proposal. In memory only.
 let pendingSave: { path: string; text?: string; lines?: string[] } | undefined;
 if (vscode.workspace.onDidSaveTextDocument) context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
  try {
   if (!pendingSave || document.uri.scheme !== 'file' || document.uri.fsPath !== pendingSave.path) return;
   const text = document.getText();
   if (pendingSave.text !== undefined ? text !== pendingSave.text : !pendingSave.lines?.every(line => text.split(/\r?\n/).includes(line))) return;
   if (!lstatSync(pendingSave.path).isFile() || realpathSync.native(pendingSave.path) !== join(realRoot, '.kiroignore')) return;
   pendingSave = undefined;
   onSaved();
  } catch { /* a save signal never affects the audit */ }
 }));
 // Every spelling of a path that exists: as given and with symlinks resolved.
 const forms = (p: string): string[] => { if (p === '') return []; try { const real = realpathSync.native(p); return real === p ? [p] : [p, real]; } catch { return [p]; } };
 const notify = (text: string): void => { void Promise.resolve(vscode.window.showInformationMessage(text)).catch(() => undefined); };
 const readDismissed = (): Dismissed | undefined => {
  try {
   const v = context.workspaceState.get<{ salt?: unknown; hashes?: unknown }>(DISMISSED_KEY);
   if (v && typeof v.salt === 'string' && isHash(v.salt) && Array.isArray(v.hashes)) return { salt: v.salt, hashes: v.hashes.filter(isHash).slice(-MAX_DISMISSED) };
  } catch { /* treated as nothing ignored */ }
  return undefined;
 };
 const hasher = (d: Dismissed | undefined) => (category: string, path: string) => dismissHash(d?.salt ?? '', category, path);
 const render = (): void => {
  const d = readDismissed();
  roots = result ? auditTree(result, folderName, d?.hashes ?? [], hasher(d), accepted, checkedAt) : [];
  changed?.fire(undefined);
  summaryChanged();
  try { if (visible().length > 0) onFinding(); } catch { /* the support prompt never affects the audit */ }
 };
 const visible = (): Finding[] => { const d = readDismissed(); return result ? visibleFindings(result, d?.hashes ?? [], hasher(d)) : []; };
 // Reminder state lives in workspaceState; every access is fail-silent so a broken store never affects the audit or the gauge.
 const stored = (key: string): unknown => { try { return context.workspaceState.get<unknown>(key); } catch { return undefined; } };
 const store = async (key: string, value: unknown): Promise<void> => { try { await context.workspaceState.update(key, value); } catch { /* the reminder is best effort */ } };
 const recordAudit = async (o: AuditResult): Promise<void> => {
  if ((o.status === 'complete' || o.status === 'partial') && !o.reasons.includes('cancelled')) await store(LAST_KEY, utcDate(new Date()));
 };
 // One counting rule for every message: items the user has not hidden, plus those beyond the listed maximum.
 const counts = (o: AuditResult) => countFindings(visible(), o.omitted);
 const findingsMessage = (o: AuditResult): string => { const { items, unclear } = counts(o); return viewReady ? `${countsText(items, unclear)} — see the Kiro Workspace Audit view.` : `${countsText(items, unclear)}.`; };
 const summary = (): AuditSummary => {
  const last = stored(LAST_KEY), lastDate = typeof last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : undefined;
  if (refused || result?.status === 'unavailable') return { state: 'unavailable', lastDate };
  return result ? { state: 'checked', ...counts(result), checkedAt, lastDate } : { state: 'never', lastDate };
 };
 const audit = async (): Promise<void> => {
  if (running) { await vscode.window.showInformationMessage(reminderAbort ? 'An automatic workspace audit is running; try again shortly.' : 'A workspace audit is already running.'); return; }
  running = true;
  try {
   let outcome: AuditResult | undefined;
   try { outcome = await auditOnce(); } finally { running = false; }
   if (!outcome) return;
   if (viewReady) try { await vscode.commands.executeCommand(`${ID_PREFIX}.auditView.focus`); } catch { /* the list is still updated */ }
   if (outcome.status === 'unavailable') return;
   if (visible().length + outcome.omitted === 0) { notify(outcome.status === 'partial' ? 'No risky files found, but the check was partial.' : 'No risky files found.'); return; }
   const message = findingsMessage(outcome);
   if (viewReady) { notify(message); return; } // not awaited: the notification resolves only when dismissed, and it offers no buttons
   // The list is unavailable: offer the clipboard only. Prompted after the run is released, so it never blocks the next audit.
   if (await vscode.window.showInformationMessage(message, 'Copy suggestions') === 'Copy suggestions') await vscode.env.clipboard.writeText(snippet(visible().filter(f => f.suggestion !== '')));
  } catch { try { await vscode.window.showErrorMessage('The workspace audit failed.'); } catch { /* nothing more to report */ } }
 };
 // The folder as given and with symlinks resolved, or the fixed reason it must not be audited.
 const folderCheck = (folder: vscode.WorkspaceFolder): { chosen: string; resolved: string } | { reason: string } => {
  const chosen = folder.uri.fsPath;
  let resolved: string | undefined;
  try { resolved = realpathSync.native(chosen); } catch { /* refused below */ }
  const reason = resolved === undefined ? 'its real location could not be resolved'
   : refusal([chosen, resolved], [defaultSource(), configured('sourceRoot')].flatMap(forms), [context.globalStorageUri.fsPath, defaultStorage(), configured('storageRoot')].flatMap(forms), forms(homedir()));
  return reason || resolved === undefined ? { reason: reason ?? 'its real location could not be resolved' } : { chosen, resolved };
 };
 // `silent` is the opt-in automatic re-run: same guards and limits, but no messages, no picker and no progress notification.
 const auditOnce = async (silent = false, signal?: AbortSignal): Promise<AuditResult | undefined> => {
  if (!vscode.workspace.isTrusted) { refused = true; summaryChanged(); if (!silent) await vscode.window.showWarningMessage('Cyclegauge audits only trusted workspaces.'); return; }
  const folders = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file');
  if (folders.length === 0) { refused = true; summaryChanged(); if (!silent) await vscode.window.showInformationMessage('Open a local folder to audit.'); return; }
  let folder: vscode.WorkspaceFolder | undefined = folders[0];
  if (folders.length > 1) {
   if (silent) return;
   const picked = await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, folder: f })), { title: 'Folder to audit' });
   folder = picked?.folder;
  }
  if (!folder) return;
  const checked = folderCheck(folder);
  if ('reason' in checked) { refused = true; summaryChanged(); if (!silent) await vscode.window.showWarningMessage(`This folder can't be audited: ${checked.reason}.`); return; }
  const { chosen, resolved } = checked;
  const setting = vscode.workspace.getConfiguration('kiroAgent', folder.uri).get<unknown>('agentIgnoreFiles');
  const outcome = silent ? await runAudit(chosen, setting, { signal })
   : await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Auditing workspace…', cancellable: true }, async (_progress, token) => {
    const abort = new AbortController();
    token.onCancellationRequested(() => abort.abort());
    return runAudit(chosen, setting, { signal: abort.signal });
   });
  if (silent && disposed) return;
  result = outcome; folderName = folder.name; root = chosen; realRoot = resolved; accepted.clear(); pendingSave = undefined; checkedAt = new Date().toISOString(); refused = false;
  await recordAudit(outcome);
  render();
  return outcome;
 };
 // Registered independently of the collector so that it survives a failing start.
 context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), 'auditWorkspace', audit));
 // Item commands trust nothing the node carries: the finding is looked up again by category and path in the current result.
 const findingOf = (arg: unknown): Finding | undefined => {
  const n = arg as Partial<AuditNode> | undefined, f = n && typeof n === 'object' && n.kind === 'finding' ? n.finding : undefined;
  if (!result || !f || typeof f !== 'object' || typeof f.category !== 'string' || typeof f.path !== 'string') return undefined;
  const key = findingKey(f);
  return result.findings.find(x => findingKey(x) === key);
 };
 const safe = (fn: (arg?: unknown) => Promise<void>) => async (arg?: unknown): Promise<void> => {
  try { await fn(arg); } catch { try { await vscode.window.showErrorMessage('The audit action failed.'); } catch { /* nothing more to report */ } }
 };
 // Prepares the change as an unsaved edit (or an unsaved new file) for the user to review and save; nothing is written here.
 const prepare = async (findings: Finding[]): Promise<void> => {
  pendingSave = undefined;
  const lines = [...new Set(findings.map(f => f.suggestion).filter(x => x !== ''))].sort();
  if (lines.length === 0 || root === '') { notify('There is no safe suggestion to accept.'); return; }
  const path = join(root, '.kiroignore');
  let exists = false;
  try {
   if (!lstatSync(path).isFile()) { notify('The .kiroignore in this workspace is not a regular file, so no change was prepared.'); return; }
   exists = true;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { notify('The .kiroignore in this workspace could not be checked, so no change was prepared.'); return; } }
  // With auto save on, an edit to the real file could be written without the user reviewing it: show the lines in a new tab instead.
  const autoSave = exists ? vscode.workspace.getConfiguration('files', vscode.Uri.file(path)).get<string>('autoSave') : undefined;
  if (exists && autoSave !== 'off') {
   const proposal = await vscode.workspace.openTextDocument({ content: kiroignoreAppend(undefined, lines), language: 'ignore' });
   pendingSave = { path, lines };
   await vscode.window.showTextDocument(proposal);
   notify('Your editor saves files automatically, so the suggested lines are shown in a new tab. Copy them into .kiroignore and save.');
   for (const f of findings) if (f.suggestion !== '') accepted.add(findingKey(f));
   render();
   return;
  }
  const document = await vscode.workspace.openTextDocument(exists ? vscode.Uri.file(path) : vscode.Uri.file(path).with({ scheme: 'untitled' }));
  const current = document.getText();
  const text = kiroignoreAppend(exists || current !== '' ? current : undefined, lines);
  if (text === '') { await vscode.window.showTextDocument(document); notify('These lines are already in .kiroignore.'); return; }
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(current.length), text);
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error('EDIT_REJECTED');
  pendingSave = { path, text: current + text };
  await vscode.window.showTextDocument(document);
  for (const f of findings) if (f.suggestion !== '') accepted.add(findingKey(f));
  render();
 };
 const dismiss = async (arg?: unknown): Promise<void> => {
  const f = findingOf(arg);
  if (!f) return;
  const d = readDismissed() ?? { salt: randomBytes(32).toString('hex'), hashes: [] };
  const hash = dismissHash(d.salt, f.category, f.path);
  const hashes = d.hashes.includes(hash) ? d.hashes : [...d.hashes, hash];
  await context.workspaceState.update(DISMISSED_KEY, { salt: d.salt, hashes: hashes.slice(-MAX_DISMISSED) });
  render();
 };
 const reveal = async (arg?: unknown): Promise<void> => {
  const f = findingOf(arg);
  if (!f || root === '') return;
  const target = revealTarget(root, f);
  let allowed = target.kind === 'reveal';
  if (allowed) {
   // The audit never follows symlinks, but the tree may have changed since: the real location must still be inside the root.
   try { allowed = inside(realpathSync.native(target.path), realRoot); } catch { allowed = false; }
  }
  if (!allowed) { notify('This item cannot be shown. It may have been moved or removed.'); return; }
  // Only ever revealed in the Explorer, never opened in an editor tab.
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target.path));
 };
 const register = (suffix: string, fn: (arg?: unknown) => Promise<void>) => context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), suffix, safe(fn)));
 register('audit.accept', async arg => { const f = findingOf(arg); if (f) await prepare([f]); });
 register('audit.acceptAll', async () => { if (result) await prepare(visible()); else notify('Run the workspace audit first.'); });
 register('audit.dismiss', dismiss);
 // The credit view's "Show" button: the existing list if there is one, otherwise the audit itself (which then focuses the list).
 register('audit.show', async () => { if (result && viewReady) await vscode.commands.executeCommand(`${ID_PREFIX}.auditView.focus`); else await audit(); });
 register('audit.reveal', reveal);
 register('audit.copy', async () => {
  const findings = visible().filter(f => f.suggestion !== '');
  if (findings.length === 0) { notify('There are no suggestions to copy.'); return; }
  await vscode.env.clipboard.writeText(snippet(findings));
  notify('Suggestions copied. Review them before adding.');
 });
 register('audit.clearDismissed', async () => { await context.workspaceState.update(DISMISSED_KEY, undefined); render(); });
 // The only way back from "never remind": clears the snooze and the flag; the date of the last audit is kept.
 register('audit.resetReminder', async () => { await store(SNOOZE_KEY, undefined); await store(NEVER_KEY, undefined); notify('Audit reminder reset for this workspace.'); });
 // Once per window, shortly after activation. Every failure here is swallowed: it must never affect the gauge or the audit command.
 const checkReminder = async (): Promise<void> => {
  try {
   if (disposed || running || !vscode.workspace.isTrusted) return;
   const all = vscode.workspace.workspaceFolders ?? [];
   const folder = all.length === 1 && all[0]!.uri.scheme === 'file' ? all[0]! : undefined;
   if (!folder || 'reason' in folderCheck(folder)) return;
   // Application scope, read without a folder: only the user's own settings count, never a workspace's.
   const get = (prefix: string, key: string): unknown => vscode.workspace.getConfiguration(prefix).get<unknown>(key);
   const days = readReminderDays(get), automatic = readAuditAutomatically(get), today = utcDate(new Date());
   const last = stored(LAST_KEY), due = auditDue({ today, last, snoozeUntil: stored(SNOOZE_KEY), neverRemind: stored(NEVER_KEY), reminderDays: days, automatic });
   if (due === 'none') return;
   if (due === 'auto') {
    const abort = new AbortController();
    reminderAbort = abort; running = true;
    let outcome: AuditResult | undefined;
    try { outcome = await auditOnce(true, abort.signal); } finally { running = false; reminderAbort = undefined; }
    if (!outcome || disposed || visible().length === 0) return;
    const message = findingsMessage(outcome);
    if (viewReady) { if (await vscode.window.showInformationMessage(message, 'Show') === 'Show') await vscode.commands.executeCommand(`${ID_PREFIX}.auditView.focus`); }
    else if (await vscode.window.showInformationMessage(message, 'Copy suggestions') === 'Copy suggestions') await vscode.env.clipboard.writeText(snippet(visible().filter(f => f.suggestion !== '')));
    return;
   }
   let text = 'Cyclegauge can check this workspace for files that may end up in Kiro\'s context.', never = "Don't ask again";
   if (due === 'first') await store(SNOOZE_KEY, addDays(today, days)); // shown at most once per reminder period
   else { const ago = daysBetween(last as string, today); text = `This workspace was last audited ${ago} ${ago === 1 ? 'day' : 'days'} ago.`; never = "Don't remind me"; }
   const choice = await vscode.window.showInformationMessage(text, 'Run audit', 'Later', never);
   if (disposed) return;
   if (choice === 'Run audit') await audit();
   else if (choice === never) await store(NEVER_KEY, true);
   else await store(SNOOZE_KEY, addDays(today, due === 'first' ? days : LATER_DAYS)); // the first prompt waits a whole period
  } catch { /* fixed and silent */ }
 };
 const timer = setTimeout(() => checkReminder(), REMINDER_DELAY_MS);
 timer.unref?.();
 context.subscriptions.push({ dispose() { disposed = true; clearTimeout(timer); reminderAbort?.abort(); } });
 try {
  const emitter = new vscode.EventEmitter<AuditNode | undefined>();
  changed = emitter;
  const provider: vscode.TreeDataProvider<AuditNode> = {
   onDidChangeTreeData: emitter.event,
   getChildren: node => node ? node.children ?? [] : roots,
   getTreeItem(node) {
    const item = new vscode.TreeItem(node.label, node.kind === 'group' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.id = node.id; item.description = node.description; item.tooltip = node.tooltip; item.contextValue = node.contextValue;
    // An explicit icon and no resourceUri, so the editor adds no file decorations.
    item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.action === 'openIgnoreSetting') item.command = { command: 'workbench.action.openSettings', title: 'Open Agent Ignore Files setting', arguments: ['kiroAgent.agentIgnoreFiles'] };
    if (node.action === 'clearDismissed') item.command = { command: commandId('audit.clearDismissed'), title: 'Show hidden items again' };
    return item;
   },
  };
  context.subscriptions.push(emitter, vscode.window.registerTreeDataProvider(`${ID_PREFIX}.auditView`, provider));
  viewReady = true;
 } catch { /* Without the list, a finished audit falls back to a notification with a Copy suggestions button. */ }
 // The credit view is re-rendered only when what it shows (state, counts, time of the check) actually changed.
 const keyOf = (a: AuditSummary): string => [a.state, a.items, a.unclear, a.checkedAt].join('|');
 let shown = '';
 return { summary, onChange(fn) {
  try { shown = keyOf(summary()); } catch { /* the first change renders */ }
  summaryChanged = () => { try { const key = keyOf(summary()); if (key === shown) return; shown = key; fn(); } catch { /* the credit view never affects the audit */ } };
 } };
}
// Community prompts: a share command, one support prompt per window once the user has seen value, and a one-time note outside Kiro.
// State is bounded dates and flags in the editor's global state, never workspace data. Every failure is swallowed: nothing here may affect the gauge,
// the collector, the Store or the audit, and nothing is sent anywhere (links open only when the user clicks a button).
const SUPPORT_FIRST_KEY = 'cyclegauge.support.firstSeen.v1';
const SUPPORT_NEXT_KEY = 'cyclegauge.support.next.v1';
const SUPPORT_NEVER_KEY = 'cyclegauge.support.never.v1';
const SUPPORT_VALUE_KEY = 'cyclegauge.support.valueSeen.v1';
const SUPPORT_DETAIL_KEY = 'cyclegauge.support.detailDays.v1';
const SUPPORT_ADVISOR_KEY = 'cyclegauge.support.advisorUsed.v1';
const NOT_KIRO_KEY = 'cyclegauge.notKiro.shown.v1';
const SUPPORT_DELAY_MS = 180_000;
const inKiro = (): boolean => { try { return isKiroEditor(vscode.env.appName, vscode.env.uriScheme); } catch { return false; } };
interface SupportLink { valueSeen(): void; detailOpened(): void; advisorUsed(): void; auditSaved(): void; absent(): void }
function registerSupport(context: vscode.ExtensionContext): SupportLink {
 let disposed = false, seen = false, shown = false, checking = false;
 let strongTimer: ReturnType<typeof setTimeout> | undefined;
 let strongPending = false;
 // Explicit opt-in, isolated synthetic demo only. Never changes snoozes or the other prompt gates.
 const demoBase = join(homedir(), '..');
 const demo = basename(demoBase).startsWith('synthetic-cyclegauge-demo-') && inside(context.globalStorageUri.fsPath, join(demoBase, 'user-data')) && process.env.CYCLEGAUGE_SYNTHETIC_SOURCE === join(demoBase, 'source') && process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST === '1' && process.env.CYCLEGAUGE_SYNTHETIC_SOURCE === readSetting((prefix, key) => vscode.workspace.getConfiguration(prefix).get<string>(key), 'sourceRoot');
 const firstDate = () => demo ? addDays(utcDate(new Date()), -1) : stored(SUPPORT_FIRST_KEY);
 const stored = (key: string): unknown => { try { return context.globalState.get<unknown>(key); } catch { return undefined; } };
 // True only when the write succeeded: a prompt whose "shown" mark cannot be saved is not shown, so a failing state cannot repeat it every window.
 const store = async (key: string, value: unknown): Promise<boolean> => { try { await context.globalState.update(key, value); return true; } catch { return false; } };
 const open = (url: string): void => { try { void Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))).catch(() => undefined); } catch { /* nothing to open */ } };
 const get = (prefix: string, key: string): unknown => vscode.workspace.getConfiguration(prefix).get<unknown>(key);
 const register = (suffix: string, fn: () => Promise<void>) => context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), suffix, fn));
 // Registered first and independently of the collector: the detail view's Share link works even after a failed start.
 register('share', async () => {
  try {
   await vscode.env.clipboard.writeText(SHARE_TEXT);
   void Promise.resolve(vscode.window.showInformationMessage('Link copied — thanks for sharing!')).catch(() => undefined);
  } catch { try { await vscode.window.showErrorMessage('The link could not be copied.'); } catch { /* nothing more to report */ } }
 });
 // The only way back from "Don't ask again": clears the support state (the first-use date is recorded again on the next start).
 register('support.reset', async () => {
  for (const key of [SUPPORT_FIRST_KEY, SUPPORT_NEXT_KEY, SUPPORT_NEVER_KEY, SUPPORT_VALUE_KEY, SUPPORT_DETAIL_KEY, SUPPORT_ADVISOR_KEY]) await store(key, undefined);
  seen = false; strongPending = false; if (strongTimer) clearTimeout(strongTimer);
  void Promise.resolve(vscode.window.showInformationMessage('Support prompts reset.')).catch(() => undefined);
 });
 seen = stored(SUPPORT_VALUE_KEY) === true;
 const kiro = inKiro();
 const check = async (auditSaved = false): Promise<void> => {
  if (disposed || shown || checking) return;
  checking = true;
  try {
   const today = utcDate(new Date());
   if (!supportDue({ today, firstSeen: firstDate(), auditSaved, detailDays: detailDays().length, advisorUsed: stored(SUPPORT_ADVISOR_KEY), next: stored(SUPPORT_NEXT_KEY), never: stored(SUPPORT_NEVER_KEY), valueSeen: !strongPending && (seen || stored(SUPPORT_VALUE_KEY)), enabled: readSupportPrompts(get), kiro: inKiro() })) return;
   if (!(await store(SUPPORT_NEXT_KEY, addDays(today, SNOOZE_DAYS)))) return; // a prompt left open or closed with the window is not repeated for a while
   if (disposed) return;
   shown = true;
   const choice = await vscode.window.showInformationMessage('Is Cyclegauge useful to you? A rating or a star helps others find it.', 'Rate', 'Star on GitHub', 'Support ☕', 'Not now', "Don't ask again") as SupportChoice | undefined;
   if (disposed) return;
   if (choice === 'Rate') open(LINKS.rate); else if (choice === 'Star on GitHub') open(LINKS.star); else if (choice === 'Support ☕') open(LINKS.support);
   const after = afterChoice(choice, today);
   if (after.never) await store(SUPPORT_NEVER_KEY, true); else if (after.next) await store(SUPPORT_NEXT_KEY, after.next);
  } catch { /* fixed and silent */ } finally { checking = false; }
 };
 const detailDays = (): string[] => { const v = stored(SUPPORT_DETAIL_KEY); return Array.isArray(v) ? [...new Set(v.filter((day): day is string => isDate(day) && day <= utcDate(new Date())))].sort().slice(-3) : []; };
 if (kiro) {
  if (readSupportPrompts(get) && !isDate(stored(SUPPORT_FIRST_KEY))) void store(SUPPORT_FIRST_KEY, utcDate(new Date()));
  const timer = setTimeout(() => void check(), SUPPORT_DELAY_MS);
  timer.unref?.();
  context.subscriptions.push({ dispose() { disposed = true; clearTimeout(timer); if (strongTimer) clearTimeout(strongTimer); } });
 }
 let noted = false;
 return {
  detailOpened() {
   if (disposed || !kiro || !readSupportPrompts(get)) return;
   const days = detailDays(), today = utcDate(new Date());
   if (days.includes(today) || days.length === 3) { void check(); return; }
   void store(SUPPORT_DETAIL_KEY, [...days, today].sort().slice(-3)).then(ok => { if (ok) void check(); });
  },
  advisorUsed() {
   if (disposed || !kiro || !readSupportPrompts(get)) return;
   void store(SUPPORT_ADVISOR_KEY, true).then(ok => { if (ok) void check(); });
  },
  auditSaved() {
   if (disposed || !kiro || !readSupportPrompts(get)) return;
   strongPending = true;
   if (strongTimer) clearTimeout(strongTimer);
   strongTimer = setTimeout(() => { strongPending = false; void check(true); }, 60_000);
   strongTimer.unref?.();
  },
  valueSeen() { if (seen || !kiro || !readSupportPrompts(get)) return; seen = true; void store(SUPPORT_VALUE_KEY, true); },
  // Called when a refresh really found no Kiro logs outside Kiro without a chosen source (the controller decides that, so VS Code beside an installed Kiro never sees the note):
  // one friendly note, once ever.
  absent() {
   if (noted || kiro) return;
   noted = true;
   try {
    const testing = vscode.ExtensionMode !== undefined && context.extensionMode === vscode.ExtensionMode.Test;
    if (testing || stored(NOT_KIRO_KEY) === true) return;
    void (async () => {
     if (!(await store(NOT_KIRO_KEY, true))) return;
     if (await vscode.window.showInformationMessage(NOT_KIRO_TEXT, 'Learn about Kiro', 'Got it') === 'Learn about Kiro') open(LINKS.kiro);
    })().catch(() => undefined);
   } catch { /* fixed and silent */ }
  },
 };
}
async function runCyclegauge(context: vscode.ExtensionContext): Promise<void> {
 gaugeState.gauge = 'starting'; gaugeState.diagnostics = undefined; gaugeState.config = undefined;
 try { await startGauge(context); } catch (e) { gaugeState.gauge = 'failed_to_start'; throw e; }
}
async function startGauge(context: vscode.ExtensionContext): Promise<void> {
 let audit: AuditLink | undefined, support: SupportLink | undefined;
 try { support = registerSupport(context); } catch { /* Nor must the community prompts. */ }
 try { audit = registerAudit(context, () => support?.valueSeen(), () => support?.auditSaved()); } catch { /* The audit must never stop the gauge from starting. */ }
 try { registerDiagnostics(context); } catch { /* Neither must the diagnostics. */ }
 // Right alignment/priority is controllable; native Kiro item ordering is not a stable API.
 const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
 item.name = 'Cyclegauge credit budget';
 item.command = commandId('showUsage');
 item.text = '$(sync~spin) Kiro: Collecting data';
 item.show();
 // The webview stays script-free and its only command links are the Cost Advisor, the two audit commands and Share below, so the Cost Advisor needs a native
 // entry point that does not rely only on the easy-to-overlook editor title bar button: a status bar item shown while the panel is open.
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
   if (panel && panel.webview.html !== detail) panel.webview.html = detail; // identical HTML is not set again
  },
  showDetails(html) {
   if (panel) { panel.reveal(); if (panel.webview.html !== html) panel.webview.html = html; advisorItem.show(); return; }
   panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, 'Your credit budget', vscode.ViewColumn.One, { enableScripts: false, enableCommandUris: [commandId('costAdvisor'), commandId('auditWorkspace'), commandId('audit.show'), commandId('share')], localResourceRoots: [] });
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
  onClick(fn) { register('showUsage', () => { fn(); support?.detailOpened(); }); },
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
 gaugeState.config = { storage: chosenStorage ? 'chosen' : 'default', source: setting('sourceRoot') ? 'chosen' : 'default', timezone: setting('sourceTimezone') ? 'chosen' : 'device' };
 try {
  const controller = await startExtension(ui, { source, storage, profileStorage: !chosenStorage, timezone, auditSummary: audit?.summary, notKiro: !inKiro() && !setting('sourceRoot'), onAdvisorUsed: () => support?.advisorUsed(), onForecast: () => support?.valueSeen(), onAbsent: () => support?.absent() });
  audit?.onChange(controller.rerender);
  gaugeState.diagnostics = controller.diagnostics; gaugeState.gauge = 'running';
  stop = controller.dispose;
  context.subscriptions.push({ dispose: controller.dispose });
 } catch {
  gaugeState.gauge = 'failed_to_start';
  item.text = '$(warning) Kiro: unavailable';
  context.subscriptions.push(...disposables);
 }
}
export function deactivate(): void { stop?.(); stop = undefined; }
