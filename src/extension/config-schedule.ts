// Vscode-free decision logic for the opt-in automatic Kiro configuration review (design section 4.1). Timers and the clock are
// injected, so every bound is tested with a fake clock. State is in memory only and is lost on window reload.
import type { FindingId } from '../audit/config-rules.ts';
export type ConfigReviewMode = 'off' | 'onOpen' | 'onOpenAndChanges';
export const CONFIG_REVIEW_DELAY_MS = 45_000; // staggered after the audit reminder's 30 s
export const CONFIG_DEBOUNCE_MS = 5_000;
export const CONFIG_MAX_WAIT_MS = 60_000;
export const CONFIG_MIN_INTERVAL_MS = 30_000;
export const CONFIG_MAX_AUTO_RUNS = 20;
export const CONFIG_MAX_NOTICES = 3;
export const CONFIG_NOTICE_GAP_MS = 60_000;
export const CONFIG_OFFER_SUPPORT_GAP_MS = 60_000;
export const CONFIG_WATCH_GLOB = '{AGENTS.md,.kiro/steering/*.md,.kiro/hooks/*.json}';

/** Only the user's own (global) value counts; a workspace value, an unknown or a malformed value is off. */
export function readConfigReviewMode(inspect: { globalValue?: unknown } | undefined): ConfigReviewMode {
 const value = inspect?.globalValue;
 return value === 'onOpen' || value === 'onOpenAndChanges' ? value : 'off';
}

/** Whether a root-relative watcher path (separators already `/`) has exactly one allowlisted shape. Pure string test. */
export function watchShape(rel: string, caseInsensitive: boolean): boolean {
 const p = caseInsensitive ? rel.toLowerCase() : rel;
 if (p === (caseInsensitive ? 'agents.md' : 'AGENTS.md')) return true;
 const parts = p.split('/');
 if (parts.length !== 3 || parts[0] !== '.kiro' || rel.includes('\\')) return false;
 const name = parts[2]!, ext = parts[1] === 'steering' ? '.md' : parts[1] === 'hooks' ? '.json' : undefined;
 return ext !== undefined && name.length > ext.length && name.endsWith(ext) && name !== '.' && name !== '..';
}

export type RunTrigger = 'open' | 'watch';
/** 'ran' counts toward the cap; 'skipped' (guards failed, nothing to do) does not; 'deferred' (a manual run is busy) retries later. */
export type RunOutcome = 'ran' | 'skipped' | 'deferred';
interface SchedulerDeps {
 now(): number;
 setTimer(fn: () => void, ms: number): unknown;
 clearTimer(handle: unknown): void;
 run(trigger: RunTrigger): Promise<RunOutcome>;
 onPause?(): void;
}
export interface ConfigScheduler {
 /** Arm the once-per-window open run after CONFIG_REVIEW_DELAY_MS. */
 open(): void;
 /** An allowlisted file changed: trailing debounce, forced after CONFIG_MAX_WAIT_MS; absorbed by a pending open run. */
 event(): void;
 /** Forget pending triggers (setting off, trust or roots changed, manual run). A running run is aborted by the caller. */
 cancel(): void;
 readonly paused: boolean;
 readonly runs: number;
 dispose(): void;
}
// Single-flight, one timer, a minimum interval between automatic runs and a hard per-window cap.
export function createConfigScheduler(deps: SchedulerDeps): ConfigScheduler {
 let timer: unknown, openAt: number | undefined, firstAt: number | undefined, lastAt: number | undefined;
 let running = false, endedAt: number | undefined, runs = 0, paused = false, disposed = false;
 const clear = (): void => { if (timer !== undefined) deps.clearTimer(timer); timer = undefined; };
 const due = (): number | undefined => {
  const watch = firstAt === undefined ? undefined : Math.min(lastAt! + CONFIG_DEBOUNCE_MS, firstAt + CONFIG_MAX_WAIT_MS);
  const next = [openAt, watch].filter((t): t is number => t !== undefined);
  if (!next.length) return undefined;
  return Math.max(Math.min(...next), endedAt === undefined ? -Infinity : endedAt + CONFIG_MIN_INTERVAL_MS);
 };
 const arm = (): void => {
  clear();
  const at = due();
  if (disposed || paused || running || at === undefined) return;
  timer = deps.setTimer(() => { timer = undefined; void fire(); }, Math.max(0, at - deps.now()));
 };
 const fire = async (): Promise<void> => {
  const at = due(), now = deps.now();
  if (disposed || paused || running || at === undefined) return;
  if (at > now) { arm(); return; }
  const trigger: RunTrigger = openAt !== undefined && openAt <= now ? 'open' : 'watch';
  if (trigger === 'open') openAt = undefined;
  // An open run also covers the files changed before it.
  firstAt = undefined; lastAt = undefined;
  running = true;
  let outcome: RunOutcome;
  try { outcome = await deps.run(trigger); } catch { outcome = 'skipped'; }
  running = false;
  if (disposed) return;
  if (outcome === 'ran') {
   runs++; endedAt = deps.now();
   if (runs >= CONFIG_MAX_AUTO_RUNS) { paused = true; openAt = undefined; firstAt = undefined; lastAt = undefined; try { deps.onPause?.(); } catch { /* the view shows the pause */ } }
  } else if (outcome === 'deferred') {
   const t = deps.now();
   if (trigger === 'open') openAt = t + CONFIG_DEBOUNCE_MS; else if (firstAt === undefined) { firstAt = t; lastAt = t; }
  }
  arm();
 };
 return {
  open() { if (disposed || paused) return; openAt = deps.now() + CONFIG_REVIEW_DELAY_MS; arm(); },
  event() {
   if (disposed || paused) return;
   // While the staggered open run is pending it covers the change, so startup activity (a checkout) does not run before it.
   if (openAt !== undefined && !running) return;
   const t = deps.now();
   if (firstAt === undefined) firstAt = t;
   lastAt = t;
   arm(); // while running, nothing is armed; the follow-up is armed when the run ends
  },
  cancel() { openAt = undefined; firstAt = undefined; lastAt = undefined; clear(); },
  get paused() { return paused; },
  get runs() { return runs; },
  dispose() { disposed = true; clear(); },
 };
}

export interface NoticeState { seen: Set<FindingId>; seeded: boolean; notices: number; lastNoticeAt?: number }
export const createNoticeState = (): NoticeState => ({ seen: new Set(), seeded: false, notices: 0 });
export type ReviewOrigin = 'manual' | RunTrigger;
/**
 * Whether one fixed, non-modal message may be shown for this review, updating the in-memory class set. A manual run and the
 * first automatic run only add their classes; open runs never notify; H3 is information and never notifies. A class held
 * back by the per-window or spacing limit stays unseen, so a later run announces it.
 */
export function noticeDecision(state: NoticeState, classes: readonly FindingId[], origin: ReviewOrigin, now: number): boolean {
 const relevant = [...new Set(classes)].filter(id => id !== 'H3');
 if (origin === 'manual' || origin === 'open' || !state.seeded) {
  for (const id of relevant) state.seen.add(id);
  if (origin !== 'manual') state.seeded = true;
  return false;
 }
 const fresh = relevant.filter(id => !state.seen.has(id));
 if (!fresh.length) return false;
 if (state.notices >= CONFIG_MAX_NOTICES || (state.lastNoticeAt !== undefined && now - state.lastNoticeAt < CONFIG_NOTICE_GAP_MS)) return false;
 for (const id of fresh) state.seen.add(id);
 state.notices++; state.lastNoticeAt = now;
 return true;
}

export interface OfferInput { supportPrompts: boolean; globalValue: unknown; offered: unknown; supportOpen: boolean; lastSupportAt?: number; now: number }
/** The one-time enable offer after a manual run. Any stored offer value (even of an unknown shape) or any global setting value means decided. */
export function offerDue(i: OfferInput): boolean {
 if (!i.supportPrompts || i.globalValue !== undefined || i.offered !== undefined || i.supportOpen) return false;
 return i.lastSupportAt === undefined || i.now - i.lastSupportAt >= CONFIG_OFFER_SUPPORT_GAP_MS;
}
