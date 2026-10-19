import * as vscode from 'vscode';
import { WATCH_GLOB, runAudit, snippet, type AuditResult, type Finding } from '../audit/audit.ts';
import { PRUNE } from '../audit/walk.ts';
import { validIgnoreNames } from '../audit/read-ignore.ts';
import { lstatSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { defaultSource, defaultStorage, inside } from '../paths.ts';
import { folderCheck as checkFolder } from './audit-root.ts';
import { CONFIG_OFFER_KEY, registerConfigReview, startManualReview, type SupportGate } from './config-review.ts';
import { configSummary, reviewTree, type ConfigNode, type ViewNode } from './config-model.ts';
import { createPreparedFiles, preparedText } from './config-apply.ts';
import { readConfigReviewMode } from './config-schedule.ts';
import { IGNORE_USE_NOTE, MAX_DISMISSED, OPEN_SETTING, auditTree, auditSizeTotal, dismissHash, excludeAnnotation, findingKey, ignoreNotEffective, isHash, countFindings, countsText, kiroignoreAppend, revealTarget, visibleFindings, type AuditNode, type AuditParts, type AuditSummary } from './audit-model.ts';
import { startExtension, type ExtensionUi } from './controller.ts';
import { buildDiagnostics, formatDiagnostics, runtimeFacts, type DiagnosticsInput } from '../diagnostics.ts';
import { ID_PREFIX, LINKS, NOT_KIRO_TEXT, PANEL_VIEW_TYPE, REPORT_PROBLEM_ACTION, REPORT_PROBLEM_URL, SHARE_TEXT, commandId, isKiroEditor, readAuditAutomatically, readBudgetWarningPercent, readBudgetWarnings, readReminderDays, readSetting, readSupportPrompts, registerCommand } from './identity.ts';
import { decideBudgetNotice } from './budget-warning.ts';
import type { view } from '../view.ts';
import type { PlanInsights } from '../cost/plan-hints.ts';
import { LATER_DAYS, addDays, auditDue, daysBetween, isDate, utcDate } from './audit-schedule.ts';
import { SNOOZE_DAYS, afterChoice, supportDue, type SupportChoice } from './support-schedule.ts';
import { DashboardPanel, type DashboardActions } from './dashboard-panel.ts';
import { RECAP_KEY, nextRecapState, readRecap, type StoredRecap } from './recap.ts';
import { protectedRoots } from './file-target.ts';
import { exportCsv, saveRecapImage, type SaveDeps } from './recap-io.ts';
import { registerSessionHints, type SessionHintsLink } from './session-hints.ts';
import { RESULTS_KEY, aggregateFindings, readResults, record, type ExclusionAggregate, type StoredResults } from './results-summary.ts';

declare const __DASHBOARD_SCRIPT__: string;
let rejectedMessages = 0;
let sessionHints: SessionHintsLink | undefined;
// Shared at each native command registration, so links, title buttons and command-palette calls obey the same guard.
function guardDashboardCommand<T extends unknown[]>(fn: (...args: T) => unknown): (...args: T) => Promise<void> {
 let busy = false, last = -Infinity;
 return async (...args: T) => {
  const now = Date.now();
  if (busy || now - last < 2000) return;
  busy = true;
  try { await fn(...args); } finally { last = Date.now(); busy = false; }
 };
}

// The folder named `logs` above an extension log folder (or the folder itself when there is none); empty when unknown.
function logsRoot(path: string | undefined): string {
 if (typeof path !== 'string' || path === '') return '';
 for (let p = path; dirname(p) !== p; p = dirname(p)) if (basename(p) === 'logs') return p;
 return path;
}
let stop: (() => void) | undefined;
// What Copy Diagnostics may report: fixed states only. Kept outside runCyclegauge so the command also works after a failed start.
const gaugeState: { gauge: 'starting' | 'running' | 'failed_to_start'; diagnostics?: () => DiagnosticsInput; config?: Pick<DiagnosticsInput, 'storage' | 'source' | 'timezone'> } = { gauge: 'starting' };
export async function activate(context: vscode.ExtensionContext): Promise<void> {
 await runCyclegauge(context);
}
// Builds the reviewable plain-text report in memory (fixed codes, counts and versions only); one function serves Copy Diagnostics and Report a Problem.
function diagnosticsText(): string {
 return formatDiagnostics(buildDiagnostics({ ...gaugeState.config, ...gaugeState.diagnostics?.(), ...runtimeFacts(), surface: 'extension', gauge: gaugeState.gauge,
  editor: vscode.env.appName, editorVersion: vscode.version, audit: true, rejectedMessages, sessionHints: sessionHints?.code() ?? 'not_run', sessionHintNotices: sessionHints?.notices() ?? 0, sessionHintCapped: sessionHints?.capped() ?? 0 }));
}
// Opens the report as an unsaved document and copies it; Cyclegauge writes nothing to disk.
async function showAndCopyDiagnostics(): Promise<void> {
 const text = diagnosticsText();
 const document = await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' });
 await vscode.window.showTextDocument(document);
 await vscode.env.clipboard.writeText(text);
}
// Cyclegauge's own fixed-text error notification with a Report a problem button. Not awaited: the notification resolves only when dismissed.
// The diagnostics failure messages deliberately offer no button, so a failing report can never loop back into itself.
function showReportableError(text: string): void {
 try {
  void Promise.resolve(vscode.window.showErrorMessage(text, REPORT_PROBLEM_ACTION))
   .then(choice => choice === REPORT_PROBLEM_ACTION ? vscode.commands.executeCommand(commandId('reportProblem')) : undefined)
   .catch(() => undefined);
 } catch { /* nothing more to report */ }
}
function registerDiagnostics(context: vscode.ExtensionContext): void {
 const copy = async (): Promise<void> => {
  try {
   await showAndCopyDiagnostics();
   // Not awaited: the notification resolves only when dismissed.
   void Promise.resolve(vscode.window.showInformationMessage('Diagnostics copied. Review them before pasting.')).catch(() => undefined);
  } catch { try { await vscode.window.showErrorMessage('Diagnostics could not be copied.'); } catch { /* nothing more to report */ } }
 };
 // Same text as Copy Diagnostics, then the fixed bug-report form (one at a time with the shared cooldown, as the other footer commands). Nothing, not even a diagnostics value, is put in the address.
 const report = async (): Promise<void> => {
  try {
   await showAndCopyDiagnostics();
   void Promise.resolve(vscode.window.showInformationMessage('Diagnostics copied. Review them, then paste them into the form.')).catch(() => undefined);
   await vscode.env.openExternal(vscode.Uri.parse(REPORT_PROBLEM_URL));
  } catch { try { await vscode.window.showErrorMessage('The problem report could not be opened.'); } catch { /* nothing more to report */ } }
 };
 try { context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), 'copyDiagnostics', copy)); } catch { /* Neither registration may prevent the other. */ }
 try { context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), 'reportProblem', guardDashboardCommand(report))); } catch { /* A failing registration must not affect the rest of the extension. */ }
}
// The audit runs when the user invokes the command, or from the reminder: a prompt once per window when the workspace has never been
// audited or is due again (reminderDays), and, only if the user set cyclegauge.auditAutomatically in their own user settings, a silent
// re-run of the same audit when it is at least a day old (and, in onOpenAndChanges, after matching files appear). Cyclegauge itself writes no file and no setting: Accept only prepares an
// unsaved edit, and the only things persisted are, in the editor's per-workspace state, the salted-hash list of ignored findings
// and, for the reminder, the UTC date of the last audit, a snooze date and a "never remind" flag. No path is ever stored.
const DISMISSED_KEY = 'cyclegauge.audit.dismissed.v1';
const LAST_KEY = 'cyclegauge.audit.last.v1';
const SNOOZE_KEY = 'cyclegauge.audit.snoozeUntil.v1';
const NEVER_KEY = 'cyclegauge.audit.neverRemind.v1';
const REMINDER_DELAY_MS = 30_000;
const RECHECK_DELAY_MS = 1_000; // coalesces a burst of saves or setting changes into one re-check
const WATCH_DELAY_MS = 5_000; // a build or checkout creating many matching files leads to one re-check after it settles
const WATCH_MAX_WAIT_MS = 60_000;
const MAX_CREATED = 1_000; // created paths kept in memory between re-checks; beyond it only a previous result can attribute new secrets
interface Dismissed { salt: string; hashes: string[] }
// What the credit detail view may show about the audit: a counts-and-times summary, plus a hook that re-renders the view when it changes.
interface AuditLink { summary(): AuditSummary; onChange(fn: () => void): void }
function registerAudit(context: vscode.ExtensionContext, onFinding: () => void, onSaved: (accepted: ExclusionAggregate) => void, configGate?: SupportGate): AuditLink {
 const configured = (key: Parameters<typeof readSetting>[1]) => readSetting((prefix, name) => vscode.workspace.getConfiguration(prefix).get<string>(name), key);
 let running = false, disposed = false, reminderAbort: AbortController | undefined, result: AuditResult | undefined, folderName = '', root = '', realRoot = '', parts: AuditParts | undefined;
 let checkedAt: string | undefined, refused = false, summaryChanged: () => void = () => undefined, recheckTimer: ReturnType<typeof setTimeout> | undefined;
 let changed: vscode.EventEmitter<ViewNode | undefined> | undefined, viewReady = false;
 let userCancelled = false; // the user dismissed the folder picker or cancelled the progress notification of the current manual audit: no review then
 let configReview: ReturnType<typeof registerConfigReview> = { nodes: () => [], summary: () => configSummary(), run: async () => undefined }; // replaced when the review registers
 const accepted = new Set<string>();
 // Files in which Cyclegauge prepared an edit that is still unsaved (memory only): marks the items, counts in the status line and starts a re-check after a save.
 const prepared = createPreparedFiles(vscode);
 context.subscriptions.push({ dispose: () => prepared.dispose() });
 // A save must match the prepared edit, or contain every suggested line copied from the auto-save proposal. In memory only.
 let pendingSave: { path: string; text?: string; lines?: string[]; accepted: ExclusionAggregate } | undefined;
 if (vscode.workspace.onDidSaveTextDocument) context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
  try {
   if (!pendingSave || document.uri.scheme !== 'file' || document.uri.fsPath !== pendingSave.path) return;
   const text = document.getText();
   if (pendingSave.text !== undefined ? text !== pendingSave.text : !pendingSave.lines?.every(line => text.split(/\r?\n/).includes(line))) return;
   if (!lstatSync(pendingSave.path).isFile() || realpathSync.native(pendingSave.path) !== join(realRoot, '.kiroignore')) return;
   const accepted = pendingSave.accepted;
   pendingSave = undefined;
   onSaved(accepted);
  } catch { /* a save signal never affects the audit */ }
 }));
 const notify = (text: string): void => { void Promise.resolve(vscode.window.showInformationMessage(text)).catch(() => undefined); };
 const readDismissed = (): Dismissed | undefined => {
  try {
   const v = context.workspaceState.get<{ salt?: unknown; hashes?: unknown }>(DISMISSED_KEY);
   if (v && typeof v.salt === 'string' && isHash(v.salt) && Array.isArray(v.hashes)) return { salt: v.salt, hashes: v.hashes.filter(isHash).slice(-MAX_DISMISSED) };
  } catch { /* treated as nothing ignored */ }
  return undefined;
 };
 const hasher = (d: Dismissed | undefined) => (category: string, path: string) => dismissHash(d?.salt ?? '', category, path);
 const rebuild = (): void => {
  const d = readDismissed();
  parts = result ? auditTree(result, folderName, d?.hashes ?? [], hasher(d), accepted, checkedAt, root !== '' && prepared.has(join(root, '.kiroignore'))) : undefined;
  changed?.fire(undefined);
 };
 const render = (): void => {
  rebuild();
  summaryChanged();
  try { if (visible().length > 0) onFinding(); } catch { /* the support prompt never affects the audit */ }
 };
 // The prepared .kiroignore edit was saved, closed or reverted: its rules are no longer "prepared" (a save is re-checked by the ignore-file save handler below).
 const sameFile = (a: string, b: string): boolean => process.platform === 'darwin' || process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
 prepared.subscribe((path, event) => {
  try { if (event !== 'added' && root !== '' && sameFile(path, join(root, '.kiroignore'))) accepted.clear(); rebuild(); } catch { /* the marks are only a hint */ }
 });
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
  return result ? { state: 'checked', ...counts(result), ...auditSizeTotal(visible(), result.omitted), checkedAt, lastDate } : { state: 'never', lastDate };
 };
 const audit = async (): Promise<void> => {
  if (running) { await vscode.window.showInformationMessage(reminderAbort ? 'An automatic workspace audit is running; try again shortly.' : 'A workspace audit is already running.'); return; }
  running = true;
  try {
   let outcome: AuditResult | undefined;
   // A manual audit also runs the Steering and Hooks review (approved 2026-10-18), whatever the audit's outcome; the silent re-runs (auditOnce(true, ...)) never do.
   userCancelled = false;
   try { outcome = await auditOnce(); } finally { running = false; if (!userCancelled) startManualReview(configReview); }
   if (!outcome) return;
   if (viewReady) try { await vscode.commands.executeCommand(`${ID_PREFIX}.auditView.focus`); } catch { /* the list is still updated */ }
   if (outcome.status === 'unavailable') return;
   if (visible().length + outcome.omitted === 0) { notify(outcome.status === 'partial' ? 'No risky files found, but the check was partial.' : 'No risky files found.'); return; }
   const message = findingsMessage(outcome);
   if (viewReady) { notify(message); return; } // not awaited: the notification resolves only when dismissed, and it offers no buttons
   // The list is unavailable: offer the clipboard only. Prompted after the run is released, so it never blocks the next audit.
   if (await vscode.window.showInformationMessage(message, 'Copy suggestions') === 'Copy suggestions') await vscode.env.clipboard.writeText(snippet(visible().filter(f => f.suggestion !== '')));
  } catch { try { showReportableError('The workspace audit failed.'); } catch { /* nothing more to report */ } }
 };
 // The folder as given and with symlinks resolved, or the fixed reason it must not be audited.
 const folderCheck = (folder: vscode.WorkspaceFolder) => checkFolder(folder.uri.fsPath, [defaultSource(), configured('sourceRoot')], [context.globalStorageUri.fsPath, defaultStorage(), configured('storageRoot')]);
 // `silent` is the opt-in automatic re-run: same guards and limits, but no messages, no picker and no progress notification.
 // `recheckOf` pins a silent re-check to the folder already checked and keeps its prepared, unsaved Exclude edit.
 const auditOnce = async (silent = false, signal?: AbortSignal, recheckOf?: string): Promise<AuditResult | undefined> => {
  if (!vscode.workspace.isTrusted) { refused = true; summaryChanged(); if (!silent) await vscode.window.showWarningMessage('Cyclegauge audits only trusted workspaces.'); return; }
  const folders = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file');
  if (folders.length === 0) { refused = true; summaryChanged(); if (!silent) await vscode.window.showInformationMessage('Open a local folder to audit.'); return; }
  let folder: vscode.WorkspaceFolder | undefined = recheckOf === undefined ? folders[0] : folders.find(f => f.uri.fsPath === recheckOf);
  if (recheckOf === undefined && folders.length > 1) {
   if (silent) return;
   const picked = await vscode.window.showQuickPick(folders.map(f => ({ label: f.name, folder: f })), { title: 'Folder to audit' });
   folder = picked?.folder;
  }
  if (!folder) { userCancelled = !silent; return; }
  const checked = folderCheck(folder);
  if ('reason' in checked) { refused = true; summaryChanged(); if (!silent) await vscode.window.showWarningMessage(`This folder can't be audited: ${checked.reason}.`); return; }
  const { chosen, resolved } = checked;
  const setting = vscode.workspace.getConfiguration('kiroAgent', folder.uri).get<unknown>('agentIgnoreFiles');
  const outcome = silent ? await runAudit(chosen, setting, { signal })
   : await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Auditing workspace…', cancellable: true }, async (_progress, token) => {
    const abort = new AbortController();
    token.onCancellationRequested(() => { userCancelled = true; abort.abort(); });
    return runAudit(chosen, setting, { signal: abort.signal });
   });
  if (silent && disposed) return;
  if (recheckOf !== chosen || chosen !== root) { accepted.clear(); pendingSave = undefined; }
  result = outcome; folderName = folder.name; root = chosen; realRoot = resolved; checkedAt = new Date().toISOString(); refused = false;
  await recordAudit(outcome);
  render();
  return outcome;
 };
 // Registered independently of the collector so that it survives a failing start.
 context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), 'auditWorkspace', guardDashboardCommand(audit)));
 // Item commands trust nothing the node carries: the finding is looked up again by category and path in the current result.
 const findingOf = (arg: unknown): Finding | undefined => {
  const n = arg as Partial<AuditNode> | undefined, f = n && typeof n === 'object' && n.kind === 'finding' ? n.finding : undefined;
  if (!result || !f || typeof f !== 'object' || typeof f.category !== 'string' || typeof f.path !== 'string') return undefined;
  const key = findingKey(f);
  return result.findings.find(x => findingKey(x) === key);
 };
 const safe = (fn: (arg?: unknown) => Promise<void>) => async (arg?: unknown): Promise<void> => {
  try { await fn(arg); } catch { try { showReportableError('The audit action failed.'); } catch { /* nothing more to report */ } }
 };
 // Prepares the change as an unsaved edit (or an unsaved new file) for the user to review and save; nothing is written here.
 const prepare = async (findings: Finding[]): Promise<void> => {
  pendingSave = undefined;
  const lines = [...new Set(findings.map(f => f.suggestion).filter(x => x !== ''))].sort();
  if (lines.length === 0 || root === '') { notify('There is no safe suggestion to accept.'); return; }
  const path = join(root, '.kiroignore');
  const aggregate = aggregateFindings(findings); // counts, sizes and the secret count only; kept in memory until the matching save
  let exists = false;
  try {
   if (!lstatSync(path).isFile()) { notify('The .kiroignore in this workspace is not a regular file, so no change was prepared.'); return; }
   exists = true;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') { notify('The .kiroignore in this workspace could not be checked, so no change was prepared.'); return; } }
  // With auto save on, an edit to the real file could be written without the user reviewing it: show the lines in a new tab instead.
  // Auto save is read with the opened document as scope, so a per-language override counts; the document is only opened, never edited, until this is known.
  const opened = exists ? await vscode.workspace.openTextDocument(vscode.Uri.file(path)) : undefined;
  const autoSave = opened ? vscode.workspace.getConfiguration('files', opened).get<string>('autoSave') : undefined;
  if (exists && autoSave !== 'off') {
   const proposal = await vscode.workspace.openTextDocument({ content: kiroignoreAppend(undefined, lines), language: 'ignore' });
   pendingSave = { path, lines, accepted: aggregate };
   await vscode.window.showTextDocument(proposal);
   notify('Your editor saves files automatically, so the suggested lines are shown in a new tab. Copy them into .kiroignore and save.');
   for (const f of findings) if (f.suggestion !== '') accepted.add(findingKey(f));
   render();
   return;
  }
  const document = opened ?? await vscode.workspace.openTextDocument(vscode.Uri.file(path).with({ scheme: 'untitled' }));
  const current = document.getText();
  const text = kiroignoreAppend(exists || current !== '' ? current : undefined, lines);
  if (text === '') { await vscode.window.showTextDocument(document); notify('These lines are already in .kiroignore.'); return; }
  // One edit with an annotation that needs confirmation, so the editor shows its change preview (a diff with Apply and Discard) before anything changes.
  const rules = text.split(/\r?\n/).filter(line => line !== '' && !line.startsWith('#')).length;
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, document.positionAt(current.length), text, { ...excludeAnnotation(rules), needsConfirmation: true });
  const applied = await vscode.workspace.applyEdit(edit);
  // Discarding the preview (or unchecking the change) leaves the document as it was; that is not an error and prepares nothing.
  const after = document.getText();
  if (!applied || after === current) { notify('No changes were made.'); return; }
  pendingSave = { path, text: after, accepted: aggregate };
  await vscode.window.showTextDocument(document);
  // A saved .kiroignore has no effect while Agent Ignore Files does not list it: say so, and offer the setting (Cyclegauge never writes it).
  if (result && ignoreNotEffective(result)) {
   void Promise.resolve(vscode.window.showInformationMessage(`${preparedText(1)} ${IGNORE_USE_NOTE}`, OPEN_SETTING))
    .then(choice => choice === OPEN_SETTING ? vscode.commands.executeCommand('workbench.action.openSettings', 'kiroAgent.agentIgnoreFiles') : undefined).catch(() => undefined);
  } else notify(preparedText(1));
  for (const f of findings) if (f.suggestion !== '') accepted.add(findingKey(f));
  if (document.isDirty) prepared.add([document.uri]);
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
 register('audit.show', guardDashboardCommand(async () => { if (result && viewReady) await vscode.commands.executeCommand(`${ID_PREFIX}.auditView.focus`); else await audit(); }));
 register('audit.reveal', reveal);
 register('audit.copy', async () => {
  const findings = visible().filter(f => f.suggestion !== '');
  if (findings.length === 0) { notify('There are no suggestions to copy.'); return; }
  await vscode.env.clipboard.writeText(snippet(findings));
  notify('Suggestions copied. Review them before adding.');
 });
 register('audit.clearDismissed', async () => { await context.workspaceState.update(DISMISSED_KEY, undefined); render(); });
 // The only way back from "never remind": clears the snooze and the flag; the date of the last audit is kept.
 register('audit.resetReminder', async () => { await store(SNOOZE_KEY, undefined); await store(NEVER_KEY, undefined); syncWatcher(); notify('Audit reminder reset for this workspace.'); });
 // Once per window, shortly after activation. Every failure here is swallowed: it must never affect the gauge or the audit command.
 const checkReminder = async (): Promise<void> => {
  try {
   if (disposed || running || !vscode.workspace.isTrusted) return;
   const all = vscode.workspace.workspaceFolders ?? [];
   const folder = all.length === 1 && all[0]!.uri.scheme === 'file' ? all[0]! : undefined;
   if (!folder || 'reason' in folderCheck(folder)) return;
   // Application scope, read without a folder: only the user's own settings count, never a workspace's.
   const get = (prefix: string, key: string): unknown => vscode.workspace.getConfiguration(prefix).get<unknown>(key);
   const days = readReminderDays(get), automatic = readAuditAutomatically(get) !== 'off', today = utcDate(new Date());
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
   else if (choice === never) { await store(NEVER_KEY, true); syncWatcher(); }
   else await store(SNOOZE_KEY, addDays(today, due === 'first' ? days : LATER_DAYS)); // the first prompt waits a whole period
  } catch { /* fixed and silent */ }
 };
 const timer = setTimeout(() => checkReminder(), REMINDER_DELAY_MS);
 timer.unref?.();
 // The optional watcher (onOpenAndChanges): its folder, and the root-relative paths created since the last re-check. Memory only.
 let watcher: vscode.FileSystemWatcher | undefined, watchRoot = '', noticeDay = '', overflow = false;
 const created = new Set<string>();
 context.subscriptions.push({ dispose() { disposed = true; clearTimeout(timer); if (recheckTimer) clearTimeout(recheckTimer); reminderAbort?.abort(); watcher?.dispose(); watcher = undefined; created.clear(); } });
 // Watch-driven re-checks follow the same consent as automatic runs: the mode is on, reminders are on, the workspace was audited
 // before, and it is neither snoozed nor set to "don't remind me". Checked when a file appears and again when the re-check fires.
 const watchConsent = (): boolean => {
  const get = (prefix: string, key: string): unknown => vscode.workspace.getConfiguration(prefix).get<unknown>(key);
  const snooze = stored(SNOOZE_KEY);
  return readAuditAutomatically(get) === 'onOpenAndChanges' && readReminderDays(get) > 0 && stored(NEVER_KEY) !== true
   && isDate(stored(LAST_KEY)) && !(isDate(snooze) && utcDate(new Date()) < snooze);
 };
 // At most one notice per window and UTC day: only for secrets findings that were not in the previous result of this folder and
 // that a file created since then accounts for. Without a previous result, only the created paths count.
 const noticeNewSecrets = async (outcome: AuditResult | undefined, before: Set<string> | undefined, fresh: string[], overflowed: boolean): Promise<void> => {
  const today = utcDate(new Date());
  if (!outcome || outcome.status === 'unavailable' || outcome.reasons.includes('cancelled') || noticeDay === today || disposed) return;
  if (overflowed && before === undefined) return;
  const touched = (f: Finding): boolean => overflowed || fresh.some(c => c === f.path || c.startsWith(`${f.path}/`));
  const found = visible().filter(f => f.category === 'secret' && !before?.has(findingKey(f)) && touched(f));
  if (found.length === 0) return;
  noticeDay = today;
  const message = `${found.length === 1 ? 'A new file that may contain secrets' : `${found.length} new files that may contain secrets`} appeared in this workspace. Kiro may read ${found.length === 1 ? 'it' : 'them'}.`;
  if (!viewReady) { notify(message); return; }
  if (await vscode.window.showInformationMessage(message, 'Show') === 'Show') await vscode.commands.executeCommand(`${ID_PREFIX}.auditView.focus`);
 };
 // One timer serves both re-checks: after ignore rules change (a checked workspace, so the view and card are never stale) and after
 // matching files appear in the watched folder. Never alongside a running audit; each reason is re-validated when it fires.
 let recheckTarget = '', pendingIgnore = false, pendingWatch = false, watchSince = 0;
 const schedule = (delay: number): void => {
  if (recheckTimer) clearTimeout(recheckTimer);
  recheckTimer = setTimeout(fireRecheck, delay);
  recheckTimer.unref?.();
 };
 const fireRecheck = (): void => {
  recheckTimer = undefined;
  if (disposed) return;
  if (running) { schedule(RECHECK_DELAY_MS); return; } // after a running audit, never alongside it
  const watch = pendingWatch && recheckTarget === watchRoot && watchConsent(), ignore = pendingIgnore && !!result;
  const fresh = [...created], overflowed = overflow;
  pendingWatch = false; pendingIgnore = false; created.clear(); overflow = false;
  if (!watch && !ignore) return;
  const target = recheckTarget;
  const before = result && root === target ? new Set(visible().filter(f => f.category === 'secret').map(findingKey)) : undefined;
  const abort = new AbortController();
  reminderAbort = abort; running = true;
  void auditOnce(true, abort.signal, target).catch(() => undefined).finally(() => { running = false; reminderAbort = undefined; })
   .then(outcome => watch ? noticeNewSecrets(outcome, before, fresh, overflowed) : undefined).catch(() => undefined);
 };
 const recheck = (): void => {
  if (disposed || root === '' || !result) return;
  pendingIgnore = true; recheckTarget = root;
  schedule(RECHECK_DELAY_MS);
 };
 const watchEvent = (rel: string): void => {
  if (disposed || watchRoot === '' || !watchConsent()) return;
  if (created.size < MAX_CREATED) created.add(rel); else overflow = true;
  if (!pendingWatch) watchSince = Date.now();
  pendingWatch = true; recheckTarget = watchRoot;
  // A steady stream of matching files is still re-checked: after a minute the pending timer is no longer pushed back.
  if (recheckTimer && Date.now() - watchSince >= WATCH_MAX_WAIT_MS) return;
  schedule(WATCH_DELAY_MS);
 };
 // Root-relative path of a created entry in the watched folder, or undefined outside it or inside a folder the audit never enters.
 const watchedPath = (uri: vscode.Uri): string | undefined => {
  if (uri.scheme !== 'file' || watchRoot === '') return undefined;
  const rel = relative(watchRoot, uri.fsPath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  const segs = rel.split(sep);
  return segs.slice(0, -1).some(seg => PRUNE.has(seg.toLowerCase())) ? undefined : segs.join('/');
 };
 // Watches only in onOpenAndChanges, in one trusted local folder that may be audited, with reminders on for it.
 const syncWatcher = (): void => {
  try {
   const get = (prefix: string, key: string): unknown => vscode.workspace.getConfiguration(prefix).get<unknown>(key);
   const all = vscode.workspace.workspaceFolders ?? [];
   const folder = all.length === 1 && all[0]!.uri.scheme === 'file' ? all[0]! : undefined;
   const want = !disposed && folder && vscode.workspace.isTrusted && readAuditAutomatically(get) === 'onOpenAndChanges' && readReminderDays(get) > 0
    && stored(NEVER_KEY) !== true && !('reason' in folderCheck(folder)) ? folder : undefined;
   if (want && watcher && watchRoot === want.uri.fsPath) return;
   watcher?.dispose(); watcher = undefined; watchRoot = ''; created.clear(); overflow = false;
   // A re-check the old watcher scheduled no longer runs; one for changed ignore rules still does.
   if (pendingWatch) { pendingWatch = false; if (!pendingIgnore && recheckTimer) { clearTimeout(recheckTimer); recheckTimer = undefined; } }
   if (!want || !vscode.workspace.createFileSystemWatcher) return;
   const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(want, WATCH_GLOB), false, true, true);
   watcher = w; watchRoot = want.uri.fsPath;
   w.onDidCreate(uri => {
    try { const rel = watchedPath(uri); if (rel !== undefined) watchEvent(rel); } catch { /* a missed event leaves the last result */ }
   });
  } catch { watcher?.dispose(); watcher = undefined; watchRoot = ''; }
 };
 // Only `.kiroignore` and the files named by Agent Ignore Files, directly in the checked folder; the file itself is not read here.
 const isIgnoreFile = (path: string): boolean => {
  if (root === '' || (dirname(path) !== root && dirname(path) !== realRoot)) return false;
  const named = validIgnoreNames(vscode.workspace.getConfiguration('kiroAgent', vscode.Uri.file(root)).get<unknown>('agentIgnoreFiles')) ?? [];
  return ['.kiroignore', ...named].includes(basename(path));
 };
 if (vscode.workspace.onDidSaveTextDocument) context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
  try { if (document.uri.scheme === 'file' && isIgnoreFile(document.uri.fsPath)) recheck(); } catch { /* a missed re-check leaves the last result */ }
 }));
 if (vscode.workspace.onDidChangeConfiguration) context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
  try { if (event.affectsConfiguration('kiroAgent.agentIgnoreFiles')) recheck(); } catch { /* a missed re-check leaves the last result */ }
  try { if (event.affectsConfiguration(`${ID_PREFIX}.auditAutomatically`) || event.affectsConfiguration(`${ID_PREFIX}.auditReminderDays`)) syncWatcher(); } catch { /* the watcher stays as it was */ }
 }));
 if (vscode.workspace.onDidChangeWorkspaceFolders) context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => syncWatcher()));
 if (vscode.workspace.onDidGrantWorkspaceTrust) context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => syncWatcher()));
 syncWatcher();

 const automaticModes = () => {
  try { return { audit: readAuditAutomatically((prefix, key) => vscode.workspace.getConfiguration(prefix).get<unknown>(key)), config: readConfigReviewMode(vscode.workspace.getConfiguration(ID_PREFIX).inspect<unknown>('configReviewAutomatically')) }; }
  catch { return { audit: 'off' as const, config: 'off' as const }; }
 };
 try { configReview = registerConfigReview(context, vscode, folderCheck, () => changed?.fire(undefined), { support: configGate, reportError: showReportableError, prepared }); }
 catch { /* A failing configuration review registration must never remove the filename audit. */ }
 try {
  const emitter = new vscode.EventEmitter<ViewNode | undefined>();
  changed = emitter;
  // The one tree: the status line and the groups by action. The automatic modes only decide the "checks again …" wording.
  const provider: vscode.TreeDataProvider<ViewNode> = {
   onDidChangeTreeData: emitter.event,
   getChildren: node => node ? node.children ?? [] : reviewTree(parts, configReview.summary(), configReview.nodes(), automaticModes(), new Date(), prepared.count()),
   getTreeItem(node) {
    const item = new vscode.TreeItem(node.label, node.children ? (node.expanded === true ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
    item.id = node.id; item.description = node.description; item.tooltip = node.tooltip; item.contextValue = node.contextValue;
    // An explicit icon and no resourceUri, so the editor adds no file decorations.
    item.iconPath = new vscode.ThemeIcon(node.icon);
    if (node.action === 'previewKiroConfig') item.command = { command: commandId('config.preview'), title: 'Preview configuration suggestion', arguments: [node.id] };
    if (node.action === 'openIgnoreSetting') item.command = { command: 'workbench.action.openSettings', title: 'Open Agent Ignore Files setting', arguments: ['kiroAgent.agentIgnoreFiles'] };
    if (node.action === 'clearDismissed') item.command = { command: commandId('audit.clearDismissed'), title: 'Show hidden items again' };
    return item;
   },
  };
  context.subscriptions.push(emitter, vscode.window.registerTreeDataProvider(`${ID_PREFIX}.auditView`, provider));
  viewReady = true;
 } catch { /* Without the list, a finished audit falls back to a notification with a Copy suggestions button. */ }
 // The credit view is re-rendered only when what it shows (state, counts, time of the check) actually changed.
 const keyOf = (a: AuditSummary): string => [a.state, a.items, a.unclear, a.bytes, a.lowerBound, a.checkedAt].join('|');
 let shown = '';
 return { summary, onChange(fn) {
  try { shown = keyOf(summary()); } catch { /* the first change renders */ }
  summaryChanged = () => { try { const key = keyOf(summary()); if (key === shown) return; shown = key; fn(); } catch { /* the credit view never affects the audit */ } };
 } };
}
// Community prompts: a share command, one support prompt per window once the user has seen value, and a one-time note outside Kiro.
// State is bounded dates and flags in the editor's global state, never workspace data. Every failure is swallowed: nothing here may affect the gauge,
// the collector, the Store or the audit, and nothing is sent anywhere (links open only when the user clicks a button).
// "Your Cyclegauge summary": the saved-Exclude aggregates, per observed billing cycle, in the editor's global state under one versioned key.
// It holds bounded numbers and a billing reset time, never a path or identifier, and is not registered for Settings Sync. Reads and writes
// are fail-silent; a value of an unknown shape is shown as unknown and never overwritten (the explicit reset clears it).
interface ResultsLink { summary(): StoredResults; record(accepted: ExclusionAggregate): void }
function registerResults(context: vscode.ExtensionContext, cycle: () => string | null, changed: () => void): ResultsLink {
 let queue: Promise<void> = Promise.resolve();
 const read = (): StoredResults => { try { return readResults(context.globalState.get<unknown>(RESULTS_KEY)); } catch { return { status: 'unknown', entries: [] }; } };
 return {
  summary: read,
  record(accepted) {
   queue = queue.then(async () => {
    try {
     const key = cycle(), current = read();
     if (key === null || current.status !== 'ok') return;
     const next = record(current.entries, key, accepted);
     if (next === current.entries) return;
     await context.globalState.update(RESULTS_KEY, next);
     changed();
    } catch { /* the summary never affects the audit */ }
   });
  },
 };
}
// "Your Kiro cycle": whether the recap card of a cycle was shown or dismissed, in the editor's global state under one versioned key. It holds
// a billing reset time and a flag, never a path or identifier, and is not registered for Settings Sync. Reads and writes are fail-silent and
// serialised; a value of an unknown shape hides the card and is never overwritten (the explicit reset clears it).
interface RecapLink { state(): StoredRecap; shown(cycle: string): void; dismiss(cycle: string): Promise<boolean> }
function registerRecap(context: vscode.ExtensionContext): RecapLink {
 let queue: Promise<unknown> = Promise.resolve();
 const read = (): StoredRecap => { try { return readRecap(context.globalState.get<unknown>(RECAP_KEY)); } catch { return { status: 'unknown' }; } };
 // True when, afterwards, the stored value says `state` for this cycle.
 const write = (cycle: string, state: 'shown' | 'dismissed'): Promise<boolean> => {
  const run = queue.then(async () => {
   try {
    const current = read(), next = nextRecapState(current, cycle, state);
    if (!next) return current.status === 'ok' && current.value?.cycle === cycle && current.value.state === state;
    await context.globalState.update(RECAP_KEY, next);
    return true;
   } catch { return false; }
  });
  queue = run;
  return run;
 };
 return { state: read, shown(cycle) { void write(cycle, 'shown'); }, dismiss: cycle => write(cycle, 'dismissed') };
}
const SUPPORT_FIRST_KEY = 'cyclegauge.support.firstSeen.v1';
const SUPPORT_NEXT_KEY = 'cyclegauge.support.next.v1';
const SUPPORT_NEVER_KEY = 'cyclegauge.support.never.v1';
const SUPPORT_VALUE_KEY = 'cyclegauge.support.valueSeen.v1';
const SUPPORT_DETAIL_KEY = 'cyclegauge.support.detailDays.v1';
const SUPPORT_ADVISOR_KEY = 'cyclegauge.support.advisorUsed.v1';
const NOT_KIRO_KEY = 'cyclegauge.notKiro.shown.v1';
const SUPPORT_DELAY_MS = 180_000;
const inKiro = (): boolean => { try { return isKiroEditor(vscode.env.appName, vscode.env.uriScheme); } catch { return false; } };
interface SupportLink extends SupportGate { valueSeen(): void; detailOpened(): void; advisorUsed(): void; auditSaved(): void; absent(): void; pause(): void }
function registerSupport(context: vscode.ExtensionContext): SupportLink {
 let disposed = false, seen = false, shown = false, checking = false;
 // The configuration review's enable offer and this prompt never appear together (design 4.1); memory only.
 let promptOpen = false, lastPromptAt: number | undefined, offerOpen = false;
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
 register('share', guardDashboardCommand(async () => {
  try {
   await vscode.env.clipboard.writeText(SHARE_TEXT);
   void Promise.resolve(vscode.window.showInformationMessage('Link copied — thanks for sharing!')).catch(() => undefined);
  } catch { try { showReportableError('The link could not be copied.'); } catch { /* nothing more to report */ } }
 }));
 // Clears support state, including the legacy never flag, for compatibility with existing opt-outs.
 register('support.reset', async () => {
  for (const key of [SUPPORT_FIRST_KEY, SUPPORT_NEXT_KEY, SUPPORT_NEVER_KEY, SUPPORT_VALUE_KEY, SUPPORT_DETAIL_KEY, SUPPORT_ADVISOR_KEY, RESULTS_KEY, RECAP_KEY, CONFIG_OFFER_KEY]) await store(key, undefined);
  seen = false; strongPending = false; if (strongTimer) clearTimeout(strongTimer);
  void Promise.resolve(vscode.window.showInformationMessage('Support prompts reset.')).catch(() => undefined);
 });
 seen = stored(SUPPORT_VALUE_KEY) === true;
 const kiro = inKiro();
 const check = async (auditSaved = false): Promise<void> => {
  if (disposed || shown || checking || offerOpen) return;
  checking = true;
  try {
   const today = utcDate(new Date());
   if (!supportDue({ today, firstSeen: firstDate(), auditSaved, detailDays: detailDays().length, advisorUsed: stored(SUPPORT_ADVISOR_KEY), next: stored(SUPPORT_NEXT_KEY), never: stored(SUPPORT_NEVER_KEY), valueSeen: !strongPending && (seen || stored(SUPPORT_VALUE_KEY)), enabled: readSupportPrompts(get), kiro: inKiro() })) return;
   // Reserved synchronously, before any await, so the configuration review's offer (which reserves the same way) never shows alongside it.
   promptOpen = true;
   let choice: SupportChoice | undefined;
   try {
    if (!(await store(SUPPORT_NEXT_KEY, addDays(today, SNOOZE_DAYS)))) return; // a prompt left open or closed with the window is not repeated for a while
    if (disposed) return;
    shown = true;
    try { choice = await vscode.window.showInformationMessage('Finding Cyclegauge useful? Rate it or support development. Turn off reminders in Cyclegauge settings.', 'Rate', 'Support', 'Later') as SupportChoice | undefined; }
    finally { lastPromptAt = Date.now(); }
   } finally { promptOpen = false; }
   if (disposed) return;
   if (choice === 'Rate') open(LINKS.rate); else if (choice === 'Support') open(LINKS.support);
   const after = afterChoice(choice, today);
   if (after.next) await store(SUPPORT_NEXT_KEY, after.next);
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
  // A budget notice was shown in this window: the support prompt does not pile on top of it.
  pause() { shown = true; },
  promptOpen: () => promptOpen,
  lastPromptAt: () => lastPromptAt,
  offerOpen(open) { offerOpen = open; },
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
// First-minute walkthrough: a command to open it and, once, an automatic open for new users inside Kiro (never in extension tests). The only state is one
// global-state key, written before the walkthrough opens; no write means no open. Existing users (first-use date already stored) just get the key. The reads happen
// synchronously, before the support prompts store their own first-use date. Every failure is swallowed (the editor may not support walkthroughs): nothing here may affect the gauge.
const WALKTHROUGH_KEY = 'cyclegauge.walkthrough.shown.v1';
const WALKTHROUGH_ID = 'StefanSuess.cyclegauge#cyclegauge.gettingStarted';
function registerWalkthrough(context: vscode.ExtensionContext): void {
 const open = async (): Promise<void> => { try { await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID); } catch { /* the editor may not support walkthroughs */ } };
 context.subscriptions.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), 'gettingStarted', open));
 let existing: boolean;
 try {
  if (!inKiro() || (vscode.ExtensionMode !== undefined && context.extensionMode === vscode.ExtensionMode.Test) || context.globalState.get<unknown>(WALKTHROUGH_KEY) !== undefined) return;
  // Any earlier Cyclegauge state marks an existing user, as does a user who turned the support prompts off (they asked for fewer unsolicited views).
  const earlier = [SUPPORT_FIRST_KEY, SUPPORT_NEXT_KEY, SUPPORT_NEVER_KEY, SUPPORT_VALUE_KEY, SUPPORT_DETAIL_KEY, SUPPORT_ADVISOR_KEY, NOT_KIRO_KEY, 'cyclegauge.budgetWarning.v1'];
  existing = earlier.some(key => context.globalState.get<unknown>(key) !== undefined)
   || !readSupportPrompts((prefix, key) => vscode.workspace.getConfiguration(prefix).get<unknown>(key));
 } catch { return; }
 void (async () => {
  try {
   await context.globalState.update(WALKTHROUGH_KEY, true);
   if (!existing) await open();
  } catch { /* fixed and silent */ }
 })();
}
// Budget warning: at most one notice per window, in Kiro only and never in the extension tests. The cycle and the kinds already shown are the only
// state (one global-state key); it is written before the notice is shown, and a failed write means no notice. Every failure is swallowed.
const BUDGET_KEY = 'cyclegauge.budgetWarning.v1';
interface BudgetLink { evaluate(observation: ReturnType<typeof view>, eligible: boolean, now: string, insights: PlanInsights): void }
function registerBudget(context: vscode.ExtensionContext, beforeShow: () => void): BudgetLink {
 let disposed = false, busy = false;
 context.subscriptions.push({ dispose() { disposed = true; } });
 const testing = (): boolean => vscode.ExtensionMode !== undefined && context.extensionMode === vscode.ExtensionMode.Test;
 const get = (prefix: string, key: string): unknown => vscode.workspace.getConfiguration(prefix).get<unknown>(key);
 return {
  evaluate(observation, eligible, now, insights) {
   if (disposed || busy) return;
   busy = true; // set before the first await: renders arriving while a notice is open or being decided are ignored, so a window shows at most one
   void (async () => {
    let kept = false;
    try {
     if (!inKiro() || testing()) return;
     let stored: unknown;
     try { stored = context.globalState.get<unknown>(BUDGET_KEY); } catch { stored = undefined; }
     const due = decideBudgetNotice({ view: observation, eligible, now, insights, state: stored, enabled: readBudgetWarnings(get), percent: readBudgetWarningPercent(get) });
     if (!due) return;
     try { await context.globalState.update(BUDGET_KEY, due.state); } catch { return; }
     if (disposed) return;
     kept = true; // this window has shown its one notice
     try { beforeShow(); } catch { /* nothing else depends on it */ }
     const choice = await vscode.window.showInformationMessage(due.text, 'Show details', 'Turn off');
     if (choice === 'Show details') await vscode.commands.executeCommand(commandId('showUsage'));
     else if (choice === 'Turn off') await vscode.workspace.getConfiguration(ID_PREFIX).update('budgetWarnings', false, vscode.ConfigurationTarget.Global);
    } catch { /* fixed and silent */ } finally { if (!kept) busy = false; }
   })();
  },
 };
}
async function runCyclegauge(context: vscode.ExtensionContext): Promise<void> {
 gaugeState.gauge = 'starting'; gaugeState.diagnostics = undefined; gaugeState.config = undefined;
 try { await startGauge(context); } catch (e) { gaugeState.gauge = 'failed_to_start'; throw e; }
}
async function startGauge(context: vscode.ExtensionContext): Promise<void> {
 let audit: AuditLink | undefined, support: SupportLink | undefined, budget: BudgetLink | undefined, results: ResultsLink | undefined, recap: RecapLink | undefined;
 let controllerRef: Awaited<ReturnType<typeof startExtension>> | undefined;
 try { registerWalkthrough(context); } catch { /* The walkthrough must never stop the gauge either. */ }
 try { support = registerSupport(context); } catch { /* Nor must the community prompts. */ }
 try { budget = registerBudget(context, () => support?.pause()); } catch { /* Nor the budget warning. */ }
 try { results = registerResults(context, () => controllerRef?.cycle() ?? null, () => controllerRef?.rerender()); } catch { /* Nor the results summary. */ }
 try { recap = registerRecap(context); } catch { /* Nor the cycle recap. */ }
 sessionHints = undefined;
 // Context reminder and model hint from the newest IDE session: Kiro only, never in the extension tests, silent on any failure.
 try { sessionHints = registerSessionHints(context, () => inKiro() && !(vscode.ExtensionMode !== undefined && context.extensionMode === vscode.ExtensionMode.Test), () => support?.pause()); } catch { /* Nor must the session hints. */ }
 try { audit = registerAudit(context, () => support?.valueSeen(), accepted => { try { support?.auditSaved(); } catch { /* the support prompt never affects the audit */ } results?.record(accepted); }, support); } catch { /* The audit must never stop the gauge from starting. */ }
 try { registerDiagnostics(context); } catch { /* Neither must the diagnostics. */ }
 // Right alignment/priority is controllable; native Kiro item ordering is not a stable API.
 const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
 item.name = 'Cyclegauge credit budget';
 item.command = commandId('showUsage');
 item.text = '$(sync~spin) Kiro: Collecting data';
 item.show();
 // The five command links remain available if the enhanced webview script does not run.
 const advisorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
 advisorItem.name = 'Cyclegauge Cost Advisor';
 advisorItem.text = '$(lightbulb) Cost Advisor';
 advisorItem.tooltip = 'Confirm your plan and compare costs';
 advisorItem.command = commandId('costAdvisor');
 let panel: vscode.WebviewPanel | undefined;
 let dashboard: DashboardPanel | undefined;
 let revealing = false;
 let detail = '';
 const disposables: vscode.Disposable[] = [item, advisorItem];
 const setting = (key: Parameters<typeof readSetting>[1]) => readSetting((prefix, name) => vscode.workspace.getConfiguration(prefix).get<string>(name), key);
 const source = setting('sourceRoot') || defaultSource();
 // Like any extension: the editor's own per-extension storage folder unless a location is chosen.
 const chosenStorage = setting('storageRoot');
 const storage = chosenStorage || context.globalStorageUri.fsPath;
 const timezone = setting('sourceTimezone') || Intl.DateTimeFormat().resolvedOptions().timeZone;
 // The recap image and the CSV are written only through the save dialog, outside Cyclegauge storage and every Kiro folder (re-read at each save).
 const saving: SaveDeps = {
  async dialog(defaultPath, filter) {
   const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultPath), filters: { [filter.name]: [filter.extension] }, saveLabel: 'Save', title: 'Save a file you can share' });
   return uri ? { scheme: uri.scheme, fsPath: uri.fsPath } : undefined;
  },
  // Also the editor's own data root (three levels above this extension's global storage folder) and its log root.
  protectedPaths: () => protectedRoots([context.globalStorageUri.fsPath, dirname(dirname(dirname(context.globalStorageUri.fsPath))), logsRoot(context.logUri?.fsPath), storage, defaultStorage(), source, defaultSource(), setting('storageRoot'), setting('sourceRoot')].filter(Boolean)),
 };
 const actions: DashboardActions = {
  async exportCsv() { return controllerRef ? exportCsv(saving, await controllerRef.exportSnapshots()) : 'unavailable'; },
  // The image is saved only while a card is shown; the clipboard text is always built here, never by the page.
  async saveRecapImage(png) { return controllerRef?.recapText() ? saveRecapImage(saving, png) : 'unavailable'; },
  async copyRecapText() {
   const text = controllerRef?.recapText();
   if (!text) return 'unavailable';
   try { await vscode.env.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
  },
  async dismissRecap() { return controllerRef && await controllerRef.dismissRecap() ? 'dismissed' : 'failed'; },
 };
 const register = (suffix: string, fn: () => unknown) => disposables.push(registerCommand((id, f) => vscode.commands.registerCommand(id, f), suffix, fn));
 const ui: ExtensionUi = {
  setStatus(text, html, meta) {
   item.text = text;
   item.tooltip = meta?.tooltip ?? 'Open your credit budget and forecast';
   item.backgroundColor = meta?.severity === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground') : meta?.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
   detail = html;
   dashboard?.set(detail);
  },
  showDetails(html) {
   if (panel) { revealing = true; try { panel.reveal(); } finally { revealing = false; } dashboard?.reveal(html); advisorItem.show(); return; }
   panel = vscode.window.createWebviewPanel(PANEL_VIEW_TYPE, 'Your credit budget', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: false, enableCommandUris: [commandId('costAdvisor'), commandId('auditWorkspace'), commandId('audit.show'), commandId('share'), commandId('reportProblem')], localResourceRoots: [] });
   dashboard = new DashboardPanel(panel.webview, __DASHBOARD_SCRIPT__, () => { rejectedMessages = Math.min(Number.MAX_SAFE_INTEGER, rejectedMessages + 1); }, Date.now, m => controllerRef?.submitAdvisor(m.ticket,m) ?? Promise.resolve({status:'stale' as const,epoch:0}), actions);
   dashboard.reveal(html);
   advisorItem.show();
   disposables.push(panel.webview.onDidReceiveMessage(raw => dashboard?.receive(raw)));
   disposables.push(panel.onDidChangeViewState(e => { if (e.webviewPanel.visible) { advisorItem.show(); if (!revealing) dashboard?.reveal(detail); } else advisorItem.hide(); }));
   disposables.push(panel.onDidDispose(() => { dashboard?.dispose(); dashboard = undefined; panel = undefined; advisorItem.hide(); }));
  },
  costInput: {
   async pick(title,items) {const selected=await vscode.window.showQuickPick(items.map(i=>({label:i.label,description:i.description,id:i.id})),{title,ignoreFocusOut:true});return selected?.id;},
   async input(title,value,validateInput) {return vscode.window.showInputBox({title,value,validateInput,ignoreFocusOut:true});}
  },
  onCostCommand(id,fn) {
   const command={advisor:'costAdvisor'}[id];
   register(command,guardDashboardCommand(fn));
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
  const controller = await startExtension(ui, { source, storage, profileStorage: !chosenStorage, timezone, auditSummary: audit?.summary, resultsSummary: results?.summary, recapState: recap?.state, recapLink: () => readSupportPrompts((prefix, key) => vscode.workspace.getConfiguration(prefix).get<unknown>(key)), recapShown: cycle => recap?.shown(cycle), recapDismiss: cycle => recap?.dismiss(cycle) ?? Promise.resolve(false), notKiro: !inKiro() && !setting('sourceRoot'), onAdvisorUsed: () => support?.advisorUsed(), onForecast: () => support?.valueSeen(), onAbsent: () => support?.absent(), onBudget: (o, eligible, now, insights) => budget?.evaluate(o, eligible, now, insights) });
  controllerRef = controller;
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
