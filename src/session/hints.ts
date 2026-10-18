// One tick of the session hints: gate first (no filesystem call at all unless enabled, on macOS, in a local extension host with a file: folder),
// then the bounded read, then the notice decision. No editor API: the extension passes plain values in. Nothing is stored; the only state is in memory.
import type { HintCode } from './codes.ts';
import { evaluate, type HintState } from './notices.ts';
import { readSession, type SessionFs } from './reader.ts';
import type { ModelRow } from './models.ts';
export const TICK_BUDGET_MS = 500;
export interface TickRequest {
 enabled: boolean; platform: string; remote: boolean;
 folders: readonly string[]; // fsPath of every file: workspace folder
 home: () => string; // resolved only after the gate
 now: number; started: number; state: HintState;
 signal?: AbortSignal; budgetMs?: number; fs?: SessionFs; table?: readonly ModelRow[]; decode?: (b: Uint8Array) => string;
}
export interface TickResult { code: HintCode; text?: string; kind?: 'context' | 'model'; opened: number; capped: number }
/** The gate alone: a code when the feature must stay completely inactive. Pure, no IO. */
export function gate(r: Pick<TickRequest, 'enabled' | 'platform' | 'remote' | 'folders'>): HintCode | undefined {
 if (!r.enabled) return 'disabled';
 if (r.platform !== 'darwin' || r.remote) return 'unsupported_platform';
 if (r.folders.length === 0) return 'no_match';
 return undefined;
}
export async function tick(r: TickRequest): Promise<TickResult> {
 const closed = gate(r);
 if (closed) return { code: closed, opened: 0, capped: 0 };
 try {
  const budget = AbortSignal.timeout(r.budgetMs ?? TICK_BUDGET_MS);
  const signal = r.signal ? AbortSignal.any([r.signal, budget]) : budget;
  const out = await readSession({ home: r.home(), folders: r.folders, now: r.now, signal, fs: r.fs, decode: r.decode });
  if (out.code !== 'ok') return { code: out.code, opened: out.opened, capped: out.capped };
  const notice = evaluate(r.state, out.observation, r.now, r.started, r.table);
  return notice ? { code: 'ok', text: notice.text, kind: notice.kind, opened: out.opened, capped: out.capped } : { code: 'ok', opened: out.opened, capped: out.capped };
 } catch { return { code: 'error', opened: 0, capped: 0 }; }
}
