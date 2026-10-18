import type * as vscode from 'vscode';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { planHookEdit, planSteeringEdit, type ConfigEditPlan } from '../audit/config-edit.ts';
import { configPathAllowed, readConfigForEdit, sameStamp, type FileStamp } from '../audit/config-read.ts';
import type { ConfigApplyAction } from './config-model.ts';

// Apply actions for Steering and Hook findings (approved 2026-10-18). Exactly like Exclude from Kiro, Cyclegauge writes nothing itself: it opens the real file in the
// editor and prepares one small unsaved edit (or a selection) for the user to review and save. The file is first proven unchanged since the review, and the only
// text read is the already-approved Steering prefix or Hook JSON, used for one edit computation and dropped. Every message is fixed text.
export const APPLY_TEXT = {
 untrusted: 'Cyclegauge changes configuration files only in trusted workspaces.',
 stale: 'This file changed since the review, so no change was prepared. Run the review again.',
 unsaved: 'This file has unsaved changes, so no change was prepared. Save or revert it, then run the review again.',
 autoSave: 'Your editor saves files automatically, so no change was prepared. The file was opened for you to edit yourself.',
 unsafe: 'This file cannot be opened safely, so nothing was prepared.',
 notLocated: 'Cyclegauge could not locate this setting safely, so the file was opened without a change.',
 prepared: 'The change is prepared but not saved. Review it, then save the file.',
 selected: 'The pattern is selected. Type the pattern you want, then save the file.',
 outdated: 'This review is out of date, so no change was prepared. Run the review again.',
 failed: 'The configuration action failed.',
} as const;
/** One fixed, never awaited information message. */
export const tell = (editor: typeof vscode, text: string): void => { try { void Promise.resolve(editor.window.showInformationMessage(text)).catch(() => undefined); } catch { /* the message is best effort */ } };
export interface ApplyRequest { action: ConfigApplyAction; root: string; rel: string; hook?: number; stamp?: FileStamp }
export type ApplyOutcome = 'prepared' | 'selected' | 'opened' | 'fallback' | 'stale' | 'refused';
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
export async function applyConfigAction(editor: typeof vscode, request: ApplyRequest): Promise<ApplyOutcome> {
 const say = (text: string): void => tell(editor, text);
 if (!editor.workspace.isTrusted) { say(APPLY_TEXT.untrusted); return 'refused'; }
 const path = guardedPath(request.root, request.rel);
 if (!path) { say(APPLY_TEXT.unsafe); return 'refused'; }
 const uri = editor.Uri.file(path);
 const open = async (): Promise<vscode.TextDocument> => { const document = await editor.workspace.openTextDocument(uri); await editor.window.showTextDocument(document); return document; };
 if (request.action === 'open') { await open(); return 'opened'; }
 const what = WHAT[request.action];
 if (!what || (what.kind === 'steering') !== (request.rel.startsWith('.kiro/steering/')) || (what.kind === 'hooks' && !(Number.isSafeInteger(request.hook) && request.hook! >= 0))) { say(APPLY_TEXT.unsafe); return 'refused'; }
 const fresh = async (): Promise<FileStamp | undefined> => { const r = await readConfigForEdit(request.root, request.rel, what.kind); if (!('bytes' in r)) return undefined; r.wipe(); return r.stamp; };
 const first = await readConfigForEdit(request.root, request.rel, what.kind);
 if (!('bytes' in first)) { say(APPLY_TEXT.unsafe); return 'refused'; }
 let planned: ConfigEditPlan | undefined, document: vscode.TextDocument;
 try {
  if (!sameStamp(request.stamp, first.stamp)) { say(APPLY_TEXT.stale); return 'stale'; }
  document = await editor.workspace.openTextDocument(uri);
  if (document.isDirty) { await editor.window.showTextDocument(document); say(APPLY_TEXT.unsaved); return 'refused'; }
  // With auto save on, an edit to the real file could be saved without the user reviewing it (the same rule as Exclude from Kiro).
  if (editor.workspace.getConfiguration('files', uri).get<string>('autoSave') !== 'off') { await editor.window.showTextDocument(document); say(APPLY_TEXT.autoSave); return 'fallback'; }
  const eol = editor.EndOfLine !== undefined && document.eol === editor.EndOfLine.CRLF ? '\r\n' : '\n';
  const result = what.steering ? planSteeringEdit(first.bytes, first.size, what.steering, eol) : planHookEdit(first.bytes, request.hook!, what.hook!);
  if ('plan' in result) planned = result.plan;
 } finally { first.wipe(); }
 // The file is read again after the editor loaded it, so a change in between is caught as well.
 if (!sameStamp(request.stamp, await fresh())) { await editor.window.showTextDocument(document); say(APPLY_TEXT.stale); return 'stale'; }
 const range = (start: number, end: number): vscode.Range => new editor.Range(document.positionAt(start), document.positionAt(end));
 if (!planned || document.getText(range(planned.verify.start, planned.verify.end)) !== planned.verify.text) { await editor.window.showTextDocument(document); say(APPLY_TEXT.notLocated); return 'fallback'; }
 if (planned.kind === 'select') {
  const shown = await editor.window.showTextDocument(document);
  shown.selection = new editor.Selection(document.positionAt(planned.start), document.positionAt(planned.end));
  shown.revealRange(range(planned.start, planned.end));
  say(APPLY_TEXT.selected); return 'selected';
 }
 const edit = new editor.WorkspaceEdit();
 if (planned.start === planned.end) edit.insert(uri, document.positionAt(planned.start), planned.text); else edit.replace(uri, range(planned.start, planned.end), planned.text);
 if (!(await editor.workspace.applyEdit(edit))) throw new Error('EDIT_REJECTED');
 await editor.window.showTextDocument(document);
 say(APPLY_TEXT.prepared); return 'prepared';
}
