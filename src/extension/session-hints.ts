import * as vscode from 'vscode';
import { homedir } from 'node:os';
import type { HintCode } from '../session/codes.ts';
import { tick } from '../session/hints.ts';
import { newHintState } from '../session/notices.ts';
import { ID_PREFIX, LINKS, commandId, readSessionHints } from './identity.ts';
// Session hints: a context-fill reminder and a model hint from the newest IDE session of the open workspace (macOS observed, Windows and Linux enabled but unverified; local extension host only).
// The thin editor wiring only: a timer, the setting, the open folders and one non-modal information message. All logic and every filesystem access
// is in src/session and starts only after its gate, so a disabled, unsupported or remote window makes no filesystem call. Nothing is persisted:
// the state lives in memory and resets with the window; failures are swallowed and reported only as a fixed code.
const FIRST_DELAY_MS = 15_000;
const INTERVAL_MS = 60_000;
export interface SessionHintsLink { code(): HintCode | 'not_run'; notices(): number; capped(): number }
const TURN_OFF = 'Turn off session hints', SHOW_BUDGET = 'Show credit budget', TIPS = 'Tips';
// budgetTight: the gauge's own warning or limit state (never stale or unavailable data); it only decides whether a model hint may be shown.
export function registerSessionHints(context: vscode.ExtensionContext, eligible: () => boolean, beforeShow: () => void, budgetTight: () => boolean = () => false): SessionHintsLink {
 const started = Date.now(), state = newHintState();
 let disposed = false, busy = false, last: HintCode | 'not_run' = 'not_run', shown = 0, capped = 0, abort: AbortController | undefined;
 let first: ReturnType<typeof setTimeout> | undefined, every: ReturnType<typeof setInterval> | undefined;
 const run = async (): Promise<void> => {
  if (disposed || busy) return;
  busy = true;
  const controller = new AbortController();
  abort = controller;
  try {
   const folders = (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath);
   const enabled = eligible() && readSessionHints(vscode.workspace.getConfiguration(ID_PREFIX).inspect<boolean>('sessionHints'));
   const remote = typeof vscode.env.remoteName === 'string' && vscode.env.remoteName !== '';
   const result = await tick({ enabled, platform: process.platform, remote, folders, home: homedir, now: Date.now(), started, state, budgetTight: budgetTight(), signal: controller.signal });
   last = result.code; capped = result.capped;
   if (result.text && !disposed) {
    shown++;
    try { beforeShow(); } catch { /* nothing else depends on it */ }
    // Not awaited: the notification resolves only when dismissed.
    // The model hint adds Show credit budget and Tips (a fixed public page, opened only on click).
    const buttons = result.kind === 'model' ? [SHOW_BUDGET, TIPS, TURN_OFF] : [TURN_OFF];
    void Promise.resolve(vscode.window.showInformationMessage(result.text, ...buttons)).then(choice => {
     if (choice === SHOW_BUDGET) return vscode.commands.executeCommand(commandId('showUsage'));
     if (choice === TIPS) return vscode.env.openExternal(vscode.Uri.parse(LINKS.tips));
     if (choice === TURN_OFF) return vscode.workspace.getConfiguration(ID_PREFIX).update('sessionHints', false, vscode.ConfigurationTarget.Global);
     return undefined;
    }).catch(() => undefined);
   }
  } catch { last = 'error'; } finally { busy = false; if (abort === controller) abort = undefined; }
 };
 first = setTimeout(() => void run(), FIRST_DELAY_MS);
 every = setInterval(() => void run(), INTERVAL_MS);
 first.unref?.(); every.unref?.();
 context.subscriptions.push({ dispose() { disposed = true; abort?.abort(); if (first) clearTimeout(first); if (every) clearInterval(every); } });
 return { code: () => last, notices: () => shown, capped: () => capped };
}
