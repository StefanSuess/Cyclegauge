import type * as vscode from 'vscode';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { planHookEdit, planSteeringEdit, type ConfigEditPlan } from '../audit/config-edit.ts';
import { configPathAllowed, readConfigForEdit, sameStamp, type FileStamp } from '../audit/config-read.ts';
import type { ConfigApplyAction } from './config-model.ts';

// Apply actions for Steering and Hook findings (approved 2026-10-18; Review changes… flow approved 2026-10-18). Exactly like Exclude from Kiro, Cyclegauge writes nothing itself:
// it opens the real file in the editor and prepares small unsaved edits (or a selection) for the user to review in the editor's change preview and save. Each file is first
// proven unchanged since the review, and the only text read is the already-approved Steering prefix or Hook JSON, used for one edit computation and dropped.
// Every message is fixed text (or a fixed template with counts).
export const APPLY_TEXT = {
 untrusted: 'Cyclegauge changes configuration files only in trusted workspaces.',
 stale: 'This file changed since the review, so no change was prepared. Run the review again.',
 unsaved: 'This file has unsaved changes, so no change was prepared. Save or revert it, then run the review again.',
 autoSave: 'Your editor saves files automatically, so no change was prepared. The file was opened for you to edit yourself.',
 unsafe: 'This file cannot be opened safely, so nothing was prepared.',
 notLocated: 'Cyclegauge could not locate this setting safely, so the file was opened without a change.',
 discarded: 'No changes were made. To prepare a change, tick it in the preview, then select Apply.',
 // The editor's change preview starts with every change unticked (it is a change that needs confirmation), so Apply alone changes nothing.
 preview: 'Tick each change you want in the preview, then select Apply. Nothing changes on disk until you save the file.',
 selected: 'The pattern is selected. Type the pattern you want, then save the file.',
 rejected: 'The editor could not prepare this change (the file may be read-only or too large), so nothing was changed.',
 notOpened: 'The editor could not open this file, so nothing was prepared.',
 outdated: 'This review is out of date, so no change was prepared. Run the review again.',
 failed: 'The configuration action failed.',
} as const;
/** One fixed, never awaited information message. */
export const tell = (editor: typeof vscode, text: string): void => { try { void Promise.resolve(editor.window.showInformationMessage(text)).catch(() => undefined); } catch { /* the message is best effort */ } };
/** Fixed templates with counts only: "Changes prepared in M files — review and save." and the skipped counts of a group. */
export const preparedText = (files: number): string => `Changes prepared in ${files} ${files === 1 ? 'file' : 'files'} — review and save.`;
export const skippedText = (items: number): string => items === 1 ? '1 item skipped because it changed or is unsaved.' : `${items} items skipped because they changed or are unsaved.`;
export const autoSaveSkippedText = (items: number): string => `${items} ${items === 1 ? 'item' : 'items'} not changed because your editor saves files automatically. Open ${items === 1 ? 'the file' : 'the files'} to edit ${items === 1 ? 'it' : 'them'} yourself.`;
/** The short why and the alternatives shown with one change in the editor's preview. */
export interface Annotation { label: string; description: string }
export interface ApplyRequest { action: ConfigApplyAction; root: string; rel: string; hook?: number; stamp?: FileStamp; annotation?: Annotation }
export type ApplyOutcome = 'prepared' | 'selected' | 'opened' | 'fallback' | 'stale' | 'refused' | 'discarded';
const WHAT: Record<Exclude<ConfigApplyAction, 'open'>, { kind: 'steering' | 'hooks'; steering?: 'manual' | 'select_pattern'; hook?: 'run_manually' | 'disable' }> = {
 loadWhenNeeded: { kind: 'steering', steering: 'manual' }, narrowPattern: { kind: 'steering', steering: 'select_pattern' },
 runManually: { kind: 'hooks', hook: 'run_manually' }, disable: { kind: 'hooks', hook: 'disable' },
};
/** The real path of an allowlisted file below the checked root: a regular file (not a link) whose real location is exactly where its name says. */
function guardedPath(root: string, rel: string): string | undefined {
 if (typeof root !== 'string' || typeof rel !== 'string' || !isAbsolute(root)) return undefined;
 if (rel !== 'AGENTS.md' && !configPathAllowed(rel, 'steering') && !configPathAllowed(rel, 'hooks')) return undefined;
 try {
  const segments = rel.split('/'), path = join(root, ...segments);
  if (!lstatSync(path).isFile()) return undefined;
  return realpathSync.native(path) === join(realpathSync.native(root), ...segments) ? path : undefined;
 } catch { return undefined; }
}
/** One change that passed every guard, ready to go into the single edit. */
interface Ready { uri: vscode.Uri; document: vscode.TextDocument; version: number; planned: Extract<ConfigEditPlan, { kind: 'replace' }>; annotation: Annotation }
/** Either a change that passed every guard or the end of this request: `skip` says why when it was one of a group (counted, never shown). */
type Prepared = { ready: Ready } | { outcome: ApplyOutcome; skip?: 'changed' | 'auto' };
/** The guards for one request. `quiet` (one of several in a group) suppresses messages and opened tabs: the item is skipped and counted instead. */
async function prepare(editor: typeof vscode, request: ApplyRequest, quiet: boolean): Promise<Prepared> {
 const say = (text: string): void => { if (!quiet) tell(editor, text); };
 const show = async (document: vscode.TextDocument): Promise<void> => { if (!quiet) await editor.window.showTextDocument(document); };
 const refuse = (text: string, outcome: ApplyOutcome = 'refused'): Prepared => { say(text); return { outcome, skip: 'changed' }; };
 const path = guardedPath(request.root, request.rel);
 if (!path) return refuse(APPLY_TEXT.unsafe);
 const uri = editor.Uri.file(path);
 // A document the editor refuses to open (binary, too large, no access) is an expected refusal with a fixed message, not a failure to report.
 const load = async (): Promise<vscode.TextDocument | undefined> => { try { return await editor.workspace.openTextDocument(uri); } catch { say(APPLY_TEXT.notOpened); return undefined; } };
 if (request.action === 'open') { const document = await load(); if (!document) return { outcome: 'refused' }; await editor.window.showTextDocument(document); return { outcome: 'opened' }; }
 const what = WHAT[request.action];
 if (!what || (what.kind === 'steering') !== (request.rel.startsWith('.kiro/steering/')) || (what.kind === 'hooks' && !(Number.isSafeInteger(request.hook) && request.hook! >= 0))) return refuse(APPLY_TEXT.unsafe);
 // A hard link may point outside the checked folder: an edit is never prepared for one (the review refuses hook files with more than one link, too).
 try { if (lstatSync(path).nlink !== 1) return refuse(APPLY_TEXT.unsafe); } catch { return refuse(APPLY_TEXT.unsafe); }
 const fresh = async (): Promise<FileStamp | undefined> => { const r = await readConfigForEdit(request.root, request.rel, what.kind); if (!('bytes' in r)) return undefined; r.wipe(); return r.stamp; };
 const first = await readConfigForEdit(request.root, request.rel, what.kind);
 if (!('bytes' in first)) return refuse(APPLY_TEXT.unsafe);
 let planned: ConfigEditPlan | undefined, document: vscode.TextDocument;
 try {
  if (!sameStamp(request.stamp, first.stamp)) return refuse(APPLY_TEXT.stale, 'stale');
  const loaded = await load(); if (!loaded) return { outcome: 'refused', skip: 'changed' };
  document = loaded;
  if (document.isDirty) { await show(document); say(APPLY_TEXT.unsaved); return { outcome: 'refused', skip: 'changed' }; }
  // With auto save on, an edit to the real file could be saved without the user reviewing it (the same rule as Exclude from Kiro).
  // Read with the opened document as scope, so a per-language override counts.
  if (editor.workspace.getConfiguration('files', document).get<string>('autoSave') !== 'off') { await show(document); say(APPLY_TEXT.autoSave); return { outcome: 'fallback', skip: 'auto' }; }
  const eol = editor.EndOfLine !== undefined && document.eol === editor.EndOfLine.CRLF ? '\r\n' : '\n';
  const result = what.steering ? planSteeringEdit(first.bytes, first.size, what.steering, eol) : planHookEdit(first.bytes, request.hook!, what.hook!);
  if ('plan' in result) planned = result.plan;
 } finally { first.wipe(); }
 // The file is read again after the editor loaded it, so a change in between is caught as well.
 if (!sameStamp(request.stamp, await fresh())) { await show(document); say(APPLY_TEXT.stale); return { outcome: 'stale', skip: 'changed' }; }
 const range = (start: number, end: number): vscode.Range => new editor.Range(document.positionAt(start), document.positionAt(end));
 if (!planned || document.getText(range(planned.verify.start, planned.verify.end)) !== planned.verify.text) { await show(document); say(APPLY_TEXT.notLocated); return { outcome: 'fallback', skip: 'changed' }; }
 if (planned.kind === 'select') {
  const shown = await editor.window.showTextDocument(document);
  shown.selection = new editor.Selection(document.positionAt(planned.start), document.positionAt(planned.end));
  shown.revealRange(range(planned.start, planned.end));
  say(APPLY_TEXT.selected); return { outcome: 'selected' };
 }
 return { ready: { uri, document, version: document.version, planned, annotation: request.annotation ?? { label: 'Cyclegauge', description: '' } } };
}
/**
 * Review changes… for one request or a whole group: every change that passes its own guards goes into ONE edit, each with an annotation that needs confirmation, so the
 * editor shows its change preview (a diff with a checkbox per change, Apply and Discard) before anything changes. The edit is never saved here. In a group an item whose
 * guard fails is skipped and counted; one request keeps the messages and the opened tab of the single-item flow.
 */
export async function applyConfigChanges(editor: typeof vscode, requests: readonly ApplyRequest[], marks?: PreparedFiles): Promise<ApplyOutcome> {
 if (requests.length === 0) return 'refused';
 const say = (text: string): void => tell(editor, text);
 if (!editor.workspace.isTrusted) { say(APPLY_TEXT.untrusted); return 'refused'; }
 // The same change asked for twice (one hook with two findings, such as a broad trigger and a large prompt) is prepared once: two identical replaces would overlap, and the editor rejects an edit with overlapping ranges.
 const seen = new Set<string>(), unique = requests.filter(r => { const key = [r.root, r.rel, r.hook ?? '', r.action].join('\0'); if (seen.has(key)) return false; seen.add(key); return true; });
 const quiet = unique.length > 1, prepared: Ready[] = [];
 let changed = 0, auto = 0, last: ApplyOutcome = 'refused';
 for (const request of unique) {
  const result = await prepare(editor, request, quiet);
  if ('ready' in result) { prepared.push(result.ready); continue; }
  last = result.outcome;
  if (result.skip === 'auto') auto++; else if (result.skip === 'changed') changed++;
 }
 // Right before the edit is built: a document that became unsaved or changed while later items were prepared is skipped and counted, and so is a change whose place no longer verifies.
 // A change that overlaps one already kept in the same file is dropped (never two edits over the same text).
 const ready: Ready[] = [], spans: { path: string; start: number; end: number }[] = [];
 for (const item of prepared) {
  const { document, planned } = item, path = item.uri.fsPath;
  const verify = (): boolean => document.getText(new editor.Range(document.positionAt(planned.verify.start), document.positionAt(planned.verify.end))) === planned.verify.text;
  if (document.isDirty || document.version !== item.version || !verify()) { changed++; continue; }
  if (spans.some(o => o.path === path && ((o.start === planned.start && o.end === planned.end) || (o.start < planned.end && planned.start < o.end)))) continue;
  spans.push({ path, start: planned.start, end: planned.end }); ready.push(item);
 }
 const skipped = quiet ? [changed > 0 ? skippedText(changed) : '', auto > 0 ? autoSaveSkippedText(auto) : ''].filter(Boolean) : [];
 if (ready.length === 0) { if (skipped.length) say(skipped.join(' ')); else if (!quiet && prepared.length > 0) say(APPLY_TEXT.stale); return quiet ? 'refused' : last; }
 const edit = new editor.WorkspaceEdit();
 for (const { uri, document, planned, annotation } of ready) {
  const metadata = { label: annotation.label, description: annotation.description, needsConfirmation: true };
  const range = new editor.Range(document.positionAt(planned.start), document.positionAt(planned.end));
  if (planned.start === planned.end) edit.insert(uri, range.start, planned.text, metadata); else edit.replace(uri, range, planned.text, metadata);
 }
 say(APPLY_TEXT.preview);
 let applied = false;
 try { applied = await editor.workspace.applyEdit(edit); } catch { say(APPLY_TEXT.rejected); return 'refused'; }
 // Discarding the preview (or unchecking every change) leaves the documents as they were; that is not an error.
 const changedDocuments = new Set(ready.filter(r => applied && r.document.isDirty).map(r => r.document));
 const changes = ready.filter(r => changedDocuments.has(r.document)).length;
 if (changes === 0) { say([APPLY_TEXT.discarded, ...skipped].join(' ')); return 'discarded'; }
 marks?.add([...changedDocuments].map(document => document.uri));
 if (!quiet) await editor.window.showTextDocument(ready[0]!.document);
 say([preparedText(changedDocuments.size), ...skipped].join(' ')); return 'prepared';
}
/** One request: the same flow with the single-item messages. */
export const applyConfigAction = (editor: typeof vscode, request: ApplyRequest, marks?: PreparedFiles): Promise<ApplyOutcome> => applyConfigChanges(editor, [request], marks);
/** What happened to a prepared file: it was prepared (`added`), saved by the user, or closed or reverted without saving (`cleared`). */
export type PreparedEvent = 'added' | 'saved' | 'cleared';
/**
 * The files in which Cyclegauge prepared an edit that is still unsaved (approved 2026-10-20). In memory only, keyed by the file's path, never persisted and never shown as a path.
 * A mark is removed when the document is saved, closed or reverted. Cyclegauge saves nothing itself; a save here is always the user's.
 */
export interface PreparedFiles {
 add(uris: readonly vscode.Uri[]): void;
 has(path: string): boolean;
 count(): number;
 subscribe(listener: (path: string, event: PreparedEvent) => void): void;
 dispose(): void;
}
const MAX_PREPARED = 500;
const REVERT_WAIT_MS = 500;
export function createPreparedFiles(editor: typeof vscode, platform: NodeJS.Platform = process.platform, revertWaitMs = REVERT_WAIT_MS): PreparedFiles {
 const ci = platform === 'darwin' || platform === 'win32', paths = new Map<string, string>(), listeners: ((path: string, event: PreparedEvent) => void)[] = [], waiting = new Map<string, ReturnType<typeof setTimeout>>();
 // Normalised so the same file compares equal however its separators were written (fsPath vs. join).
 const keyOf = (path: string): string => { const p = normalize(path); return ci ? p.toLowerCase() : p; };
 const emit = (path: string, event: PreparedEvent): void => { for (const listener of listeners) { try { listener(path, event); } catch { /* a listener never affects the tracking */ } } };
 const forget = (document: vscode.TextDocument, event: PreparedEvent): void => {
  if (document.uri.scheme !== 'file') return;
  const key = keyOf(document.uri.fsPath), path = paths.get(key), timer = waiting.get(key);
  if (timer !== undefined) { clearTimeout(timer); waiting.delete(key); }
  if (path === undefined) return;
  paths.delete(key); emit(path, event);
 };
 const subscriptions: vscode.Disposable[] = [];
 const ws = editor.workspace;
 try {
  if (ws.onDidSaveTextDocument) subscriptions.push(ws.onDidSaveTextDocument(document => forget(document, 'saved')));
  if (ws.onDidCloseTextDocument) subscriptions.push(ws.onDidCloseTextDocument(document => forget(document, 'cleared')));
  // A revert (or undoing every change) leaves the document clean without a save. The editor reports the clean state and the save as separate messages, so a clean document is only treated as reverted
  // when no save follows within a short wait (a save cancels it); typing again cancels it too.
  if (ws.onDidChangeTextDocument) subscriptions.push(ws.onDidChangeTextDocument(event => {
   const document = event.document;
   if (document.uri.scheme !== 'file') return;
   const key = keyOf(document.uri.fsPath), timer = waiting.get(key);
   if (document.isDirty) { if (timer !== undefined) { clearTimeout(timer); waiting.delete(key); } return; }
   if (!paths.has(key) || timer !== undefined) return;
   const handle = setTimeout(() => { waiting.delete(key); if (!document.isDirty) forget(document, 'cleared'); }, revertWaitMs);
   handle.unref?.(); waiting.set(key, handle);
  }));
 } catch { /* without the events nothing is marked as prepared */ }
 return {
  add(uris) {
   for (const uri of uris) {
    if (uri.scheme !== 'file' || (paths.size >= MAX_PREPARED && !paths.has(keyOf(uri.fsPath)))) continue;
    const key = keyOf(uri.fsPath), known = paths.has(key);
    paths.set(key, uri.fsPath);
    if (!known) emit(uri.fsPath, 'added');
   }
  },
  has: path => paths.has(keyOf(path)),
  count: () => paths.size,
  subscribe(listener) { listeners.push(listener); },
  dispose() { for (const t of waiting.values()) clearTimeout(t); waiting.clear(); for (const s of subscriptions) { try { s.dispose(); } catch { /* already gone */ } } subscriptions.length = 0; paths.clear(); listeners.length = 0; },
 };
}
