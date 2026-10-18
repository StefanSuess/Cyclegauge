// Pure notice logic for the session hints: thresholds with hysteresis, rate limits, the one-notice arbiter and the fixed wording. No IO.
import { modelHint, TABLE_SOURCE, type ModelHint, type ModelRow } from './models.ts';
export const THRESHOLDS = [70, 85] as const;
export const REARM_MARGIN = 10; // a threshold is armed again when the value falls below it minus this many points
export const FRESH_MS = 600_000; // an observation older than this never produces a notice
export const MIN_GAP_MS = 1_800_000; // per session: at most one notice in 30 minutes
export const MAX_PER_SESSION = 3; // and three per run
const MAX_SESSIONS = 50;
export interface Observation { key: string; modelId: string | null; sessionAsOf: number; context?: { percent: number; asOf: number } }
export type Notice = { kind: 'context'; threshold: number; text: string } | { kind: 'model'; text: string };
interface SessionState { fired: Set<number>; last: number; count: number }
/** In-memory state of one run (resets on restart). The session key is never logged, shown or stored. */
export interface HintState { sessions: Map<string, SessionState>; hinted: Set<string> } // hinted: models already hinted in this run, across sessions
export const newHintState = (): HintState => ({ sessions: new Map(), hinted: new Set() });
const pad = (n: number) => String(n).padStart(2, '0');
/** Local (device) time as HH:MM. */
export const clock = (ms: number): string => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function contextText(threshold: number, percent: number, asOf: number): string {
 const head = `Your most recent Kiro session in this workspace was about ${Math.round(percent)} % full as of ${clock(asOf)}`;
 return threshold >= 85 ? `${head}, close to its limit.` : `${head}. Kiro may compact it soon; consider starting a new session for unrelated work.`;
}
export function hintText(hint: ModelHint, asOf: number): string {
 const head = `Your most recent Kiro session in this workspace is set to ${hint.name} as of ${clock(asOf)}.`;
 return hint.stale ? `${head} Kiro lists it above the credits of Auto (check Kiro's current model table; last retrieved ${hint.date}); actual credits per task vary.`
  : `${head} Kiro lists it ${hint.from ? 'from about' : 'at about'} ${hint.multiplier}x the credits of Auto (${TABLE_SOURCE}, as of ${hint.date}); actual credits per task vary.`;
}
/**
 * One evaluation per tick. Hysteresis is updated from every value; a notice needs a fresh observation (after the extension started, within ten minutes).
 * At most one notice: the highest armed context threshold first, then the model hint (once per model per run, across sessions). A rate limit applies per session.
 * The state is committed only for the notice that is returned.
 */
export function evaluate(state: HintState, o: Observation, now: number, started: number, table?: readonly ModelRow[]): Notice | undefined {
 let s = state.sessions.get(o.key);
 if (!s) {
  if (state.sessions.size >= MAX_SESSIONS) state.sessions.delete(state.sessions.keys().next().value as string);
  s = { fired: new Set(), last: -Infinity, count: 0 };
  state.sessions.set(o.key, s);
 }
 const fresh = (at: number) => at > started && now - at <= FRESH_MS && at <= now + 300_000;
 const percent = o.context?.percent;
 if (percent !== undefined) for (const t of THRESHOLDS) if (percent < t - REARM_MARGIN) s.fired.delete(t);
 if (s.count >= MAX_PER_SESSION || now - s.last < MIN_GAP_MS) return undefined;
 if (o.context && percent !== undefined && fresh(o.context.asOf)) {
  const crossed = THRESHOLDS.filter(t => percent >= t);
  const top = crossed[crossed.length - 1];
  if (top !== undefined && !s.fired.has(top)) {
   for (const t of crossed) s.fired.add(t); // a higher threshold supersedes the lower ones
   s.last = now; s.count++;
   return { kind: 'context', threshold: top, text: contextText(top, percent, o.context.asOf) };
  }
 }
 if (o.modelId !== null && fresh(o.sessionAsOf) && !state.hinted.has(o.modelId)) {
  const hint = modelHint(o.modelId, now, table);
  if (hint) { state.hinted.add(o.modelId); s.last = now; s.count++; return { kind: 'model', text: hintText(hint, o.sessionAsOf) }; }
 }
 return undefined;
}
