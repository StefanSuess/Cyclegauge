import { subtract, compare, compareRatios, allocation, scaleRatio, combineRatio, exhaustionMilliseconds } from './decimal.ts';
import { DAY_MS, MAX_GAP_MS, type AccountHistory, type HistoryPoint } from './history.ts';

export type ForecastTier = 'unavailable' | 'provisional' | 'regular';
export type HistoryMethod = 'history_7_day' | 'history_14_day' | 'history_28_day' | 'history_84_day';
export type ForecastMethod = 'cycle_to_date' | 'rolling_7_day' | 'observed_window' | HistoryMethod;
export interface Heuristics { sustainedChange: boolean; completedBreakExclusion: boolean }
// Heuristic defaults are decided by the walk-forward backtest (historical evidence in the archived Cyclegauge repository).
// Completed-break exclusion improved break-return error without regressing decreases on design and held-out sets.
// Sustained-change selection regressed bursty usage and underprediction, so it stays off and only reports qualifiers.
export const DEFAULT_HEURISTICS: Heuristics = { sustainedChange: false, completedBreakExclusion: true };
export interface HistoryRequirement { days: number; minimumExposureDays: number; minimumSnapshots: number; minimumSnapshotDays: number }
export const HISTORY_POLICY: Record<HistoryMethod, HistoryRequirement> = {
 history_7_day: { days: 7, minimumExposureDays: 6, minimumSnapshots: 8, minimumSnapshotDays: 4 },
 history_14_day: { days: 14, minimumExposureDays: 12, minimumSnapshots: 10, minimumSnapshotDays: 6 },
 history_28_day: { days: 28, minimumExposureDays: 24, minimumSnapshots: 16, minimumSnapshotDays: 12 },
 history_84_day: { days: 84, minimumExposureDays: 72, minimumSnapshots: 40, minimumSnapshotDays: 30 },
};
const HISTORY_METHODS = Object.keys(HISTORY_POLICY) as HistoryMethod[];
export const BREAK_MINIMUM_DAYS = 5;
export const SUSTAINED_RATIO: [number, number] = [3, 2];
export interface ForecastEstimate {
 method: ForecastMethod; tier: ForecastTier; status: 'unavailable' | 'qualified'; reasons: string[];
 windowFrom: string | null; windowTo: string | null; windowDays: string | null; snapshotCount: number;
 ratePerDay: string | null; projectedUsageAtReset: string | null; projectedRemainingBaseAtReset: string | null;
 estimatedExhaustionDayUTC: string | null; exhaustionStatus: string; budgetComparison: string;
 /** Exact pooled evidence for the history methods; null for the three in-cycle methods. */
 evidenceCredits: string | null; evidenceMilliseconds: number | null; cyclesUsed: number | null; observedDays: number | null;
 zeroNetMilliseconds: number | null; excludedBreakMilliseconds: number | null;
}
export interface ForecastResult {
 schemaVersion: 3; policy: { version: 3; regular: { minimumSpanDays: 7; minimumSnapshots: 8 }; provisional: { minimumSpanHours: 48; minimumSnapshots: 3 }; maximumGapHours: 36; maxAgeHours: number;
  history: Record<HistoryMethod, HistoryRequirement>; maximumSingleIntervalShare: '1/2'; heuristics: Heuristics };
 status: 'unavailable' | 'qualified'; tier: ForecastTier; unit: 'CREDIT'; reasons: string[]; assumptions: string[]; qualifiers: string[];
 asOf: string | null; evaluatedAt: string; resetAt: string | null; horizonDays: string | null;
 currentCycleUsage: string | null; baseCreditLimit: string | null; remainingBaseCredits: string | null; dynamicDailyBudget: string | null;
 selectedMethod: ForecastMethod | null; estimates: ForecastEstimate[]; coverage: AccountHistory['coverage'];
 recentTrend: { direction: string; recentRatePerDay: string | null; previousRatePerDay: string | null };
}
const unavailable = (method: ForecastMethod, reasons: string[]): ForecastEstimate => ({ method,tier:'unavailable',status:'unavailable',reasons,
 windowFrom:null,windowTo:null,windowDays:null,snapshotCount:0,ratePerDay:null,projectedUsageAtReset:null,projectedRemainingBaseAtReset:null,
 estimatedExhaustionDayUTC:null,exhaustionStatus:'unavailable',budgetComparison:'unavailable',
 evidenceCredits:null,evidenceMilliseconds:null,cyclesUsed:null,observedDays:null,zeroNetMilliseconds:null,excludedBreakMilliseconds:null });
const ALL_METHODS: ForecastMethod[] = ['cycle_to_date','rolling_7_day','observed_window',...HISTORY_METHODS];

const add = (a: string, b: string) => subtract(a, subtract('0', b));
interface WindowStats { credits: string; exposureMs: number; maxIntervalMs: number; zeroNetMs: number; excludedBreakMs: number; snapshots: number; snapshotDays: number; cycles: number; breakRuns: number }
// Completed break: >= 5 consecutive fully observed zero-net UTC days that are later followed by observed positive usage.
function breakDays(h: AccountHistory, fromMs: number, toMs: number): Set<string> {
 const days = h.evidence.days.filter(d => Date.parse(d.day) >= fromMs && Date.parse(d.day) < toMs);
 const runs: string[][] = []; let run: string[] = [];
 const flush = () => { if (run.length >= BREAK_MINIMUM_DAYS) runs.push(run); run = []; };
 for (const d of days) {
  const contiguous = run.length === 0 || Date.parse(d.day) - Date.parse(run.at(-1)!) === DAY_MS;
  if (d.observedMilliseconds === DAY_MS && d.netChange === '0' && contiguous) run.push(d.day);
  else { flush(); if (d.observedMilliseconds === DAY_MS && d.netChange === '0') run.push(d.day); }
 }
 flush();
 const completed = runs.filter(r => { const end = Date.parse(r.at(-1)!) + DAY_MS; return h.evidence.intervals.some(i => Date.parse(i.from) >= end && i.netChange !== '0'); });
 const excluded = new Set<string>();
 // A single completed break is a pause; several are a pattern of use and stay in the exposure.
 if (completed.length === 1) completed[0].forEach(d => excluded.add(d));
 return excluded;
}
function windowStats(h: AccountHistory, fromMs: number, toMs: number, excludeBreaks: boolean): WindowStats {
 const excluded = excludeBreaks ? breakDays(h, fromMs, toMs) : new Set<string>();
 const stats: WindowStats = { credits: '0', exposureMs: 0, maxIntervalMs: 0, zeroNetMs: 0, excludedBreakMs: 0, snapshots: 0, snapshotDays: 0, cycles: 0, breakRuns: excluded.size ? 1 : 0 };
 const cycles = new Set<string>();
 for (const iv of h.evidence.intervals) {
  const from = Date.parse(iv.from), to = Date.parse(iv.to);
  let ms: number;
  if (iv.kind === 'zero_net') {
   const lo = Math.max(from, fromMs), hi = Math.min(to, toMs);
   if (hi <= lo) continue;
   ms = hi - lo;
   for (const d of excluded) { const a = Math.max(lo, Date.parse(d)), b = Math.min(hi, Date.parse(d) + DAY_MS); if (b > a) { ms -= b - a; stats.excludedBreakMs += b - a; } }
   if (ms <= 0) continue;
   stats.zeroNetMs += ms;
  } else {
   if (from < fromMs || to > toMs) continue;
   if (iv.kind === 'day' && iv.netChange === '0' && excluded.has(iv.from.slice(0, 10))) { stats.excludedBreakMs += to - from; continue; }
   ms = to - from;
  }
  stats.credits = add(stats.credits, iv.netChange); stats.exposureMs += ms; stats.maxIntervalMs = Math.max(stats.maxIntervalMs, ms); cycles.add(iv.resetAt);
 }
 const days = new Set<string>();
 for (const t of h.evidence.observations) { const m = Date.parse(t); if (m >= fromMs && m < toMs) { stats.snapshots++; days.add(t.slice(0, 10)); } }
 stats.snapshotDays = days.size; stats.cycles = cycles.size;
 return stats;
}
const iso = (time: number) => new Date(time).toISOString();
const span = (points: HistoryPoint[]) => Date.parse(points.at(-1)!.observedAt) - Date.parse(points[0].observedAt);
const provisionalAdequate = (points: HistoryPoint[]) => points.length >= 3 && span(points) >= 2*DAY_MS;
const adequate = (points: HistoryPoint[]) => points.length >= 8 && span(points) >= 7*DAY_MS;

export function forecast(h: AccountHistory, now = new Date().toISOString(), maxAgeHours = 24, options: { heuristics?: Partial<Heuristics> } = {}): ForecastResult {
 const latest=h.points.at(-1);
 const heuristics: Heuristics = { ...DEFAULT_HEURISTICS, ...options.heuristics };
 const result: ForecastResult = { schemaVersion:3,policy:{version:3,regular:{minimumSpanDays:7,minimumSnapshots:8},provisional:{minimumSpanHours:48,minimumSnapshots:3},maximumGapHours:36,maxAgeHours,
   history:HISTORY_POLICY,maximumSingleIntervalShare:'1/2',heuristics},
  status:'unavailable',tier:'unavailable',unit:'CREDIT',reasons:[],
  assumptions:['constant_future_net_rate','net_counter_changes_not_gross_charges','base_credits_only','unobserved_usage_since_snapshot_unknown','no_statistical_confidence_interval'],qualifiers:[],
  asOf:latest?.observedAt ?? null,evaluatedAt:now,resetAt:h.cycleResetAt,horizonDays:null,
  currentCycleUsage:latest?.usage ?? null,baseCreditLimit:latest?.baseLimit ?? null,remainingBaseCredits:null,dynamicDailyBudget:null,
  selectedMethod:null,estimates:[],coverage:h.coverage,recentTrend:{direction:'unavailable',recentRatePerDay:null,previousRatePerDay:null} };
 const block = (reason: string) => {
  result.reasons.push(reason);
  result.estimates=ALL_METHODS.map(method=>unavailable(method,[reason]));
  return result;
 };
 if (h.status !== 'available' || !latest) return block(h.status);
 const nowMs=Date.parse(now), observedMs=Date.parse(latest.observedAt), resetMs=Date.parse(h.cycleResetAt!);
 if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return block('invalid_time_policy');
 if (!Number.isFinite(resetMs)) return block('reset_unknown');
 if (resetMs <= nowMs || resetMs <= observedMs) return block('reset_elapsed');
 if (nowMs < observedMs) return block('future_observation');
 if (latest.usage === null || latest.baseLimit === null) return block('missing_billing');
 const remaining=subtract(latest.baseLimit,latest.usage);
 result.remainingBaseCredits=compare(remaining,'0') < 0 ? '0' : remaining;
 if (nowMs-observedMs > maxAgeHours*3600000) return block('stale');
 if (latest.flags.includes('unsupported_extra_credits')) return block('unsupported_extra_credits');
 result.dynamicDailyBudget=allocation(result.remainingBaseCredits,resetMs-nowMs);
 const horizon=resetMs-observedMs;
 result.horizonDays=scaleRatio(String(horizon),1n,BigInt(DAY_MS));
 // A usable window never crosses a quality barrier or an excessive gap.
 let cleanStart=0;
 for (let i=0;i<h.intervals.length;i++) if (h.intervals[i].status !== 'comparable') cleanStart=i+1;
 const clean=h.points.slice(cleanStart);
 if (cleanStart > 0) result.assumptions.push('history_quality_barrier');
 if (clean.some(p=>p.flags.includes('reduced_precision'))) result.assumptions.push('reduced_source_precision');
 if (clean.some(p=>p.flags.includes('assumed_source_timezone'))) result.assumptions.push('assumed_source_timezone');
 // Defensive check even if a caller constructs history outside the collector.
 const cleanValid=clean.every(p=>p.usage !== null && p.baseLimit === latest.baseLimit && p.resetAt === h.cycleResetAt && Number.isFinite(Date.parse(p.observedAt)) && Date.parse(p.observedAt) < resetMs && !p.conflicting && !p.flags.includes('unsupported_extra_credits')) &&
  clean.slice(1).every((p,i)=>Date.parse(p.observedAt) > Date.parse(clean[i].observedAt) && (Date.parse(p.observedAt)-Date.parse(clean[i].observedAt) <= MAX_GAP_MS || p.usage === clean[i].usage) && compare(p.usage!,clean[i].usage!) >= 0);
 const project = (method: ForecastMethod, points: HistoryPoint[], change: string, duration: number, from=points[0].observedAt, tier: ForecastTier='regular'): ForecastEstimate => {
  const projectedUsage=combineRatio(latest.usage!,change,BigInt(horizon),BigInt(duration));
  const projectedRemaining=combineRatio(subtract(latest.baseLimit!,latest.usage!),subtract('0',change),BigInt(horizon),BigInt(duration));
  const delay=exhaustionMilliseconds(result.remainingBaseCredits!,change,duration);
  const exhausted=result.remainingBaseCredits === '0';
  const beforeReset=delay !== null && compareRatios(result.remainingBaseCredits!,horizon,change,duration) < 0;
  // Never convert an unbounded exhaustion horizon to a Number or Date.
  const day=!exhausted && beforeReset ? new Date(observedMs+Number(delay)).toISOString().slice(0,10) : null;
  const comparison=compareRatios(change,duration,result.remainingBaseCredits!,resetMs-nowMs);
  return {method,tier,status:'qualified',reasons:tier === 'provisional' ? ['constant_rate_scenario','limited_history'] : ['constant_rate_scenario'],windowFrom:from,windowTo:latest.observedAt,
   windowDays:scaleRatio(String(duration),1n,BigInt(DAY_MS)),snapshotCount:points.length,
   ratePerDay:scaleRatio(change,BigInt(DAY_MS),BigInt(duration)),projectedUsageAtReset:projectedUsage,projectedRemainingBaseAtReset:projectedRemaining,
   estimatedExhaustionDayUTC:day,exhaustionStatus:exhausted ? 'already_exhausted_as_of' : beforeReset ? 'conditional_before_reset' : compare(change,'0') === 0 ? 'zero_observed_rate' : 'not_projected_before_reset',
   budgetComparison:comparison > 0 ? 'above_budget' : comparison < 0 ? 'within_budget' : 'at_budget',
   evidenceCredits:null,evidenceMilliseconds:null,cyclesUsed:null,observedDays:null,zeroNetMilliseconds:null,excludedBreakMilliseconds:null };
 };
 const cycleStart=h.cycleStartAt ? Date.parse(h.cycleStartAt) : null;
 if (cycleStart === null) result.estimates.push(unavailable('cycle_to_date',['cycle_start_unknown']));
 else if (cleanStart !== 0 || !cleanValid || !adequate(clean) || Date.parse(clean[0].observedAt)-cycleStart > DAY_MS || observedMs <= cycleStart)
  result.estimates.push(unavailable('cycle_to_date',['insufficient_cycle_coverage']));
 else result.estimates.push(project('cycle_to_date',clean,latest.usage!,observedMs-cycleStart,h.cycleStartAt!));
 const rollingStart=clean.findIndex(p=>Date.parse(p.observedAt) === observedMs-7*DAY_MS);
 const rolling=rollingStart < 0 ? [] : clean.slice(rollingStart);
 if (cleanValid && rolling.length && adequate(rolling)) result.estimates.push(project('rolling_7_day',rolling,subtract(latest.usage!,rolling[0].usage!),7*DAY_MS));
 else result.estimates.push(unavailable('rolling_7_day',[rollingStart < 0 ? 'rolling_boundary_unobserved' : 'insufficient_comparable_coverage']));
 if (cleanValid && provisionalAdequate(clean)) result.estimates.push(project('observed_window',clean,subtract(latest.usage!,clean[0].usage!),span(clean),clean[0].observedAt,adequate(clean) ? 'regular' : 'provisional'));
 else result.estimates.push(unavailable('observed_window',['insufficient_comparable_coverage']));
 // Pooled, exposure-weighted history methods: complete UTC days before the latest observation's day.
 const dayStart=Math.floor(observedMs/DAY_MS)*DAY_MS;
 const pooled=(method: HistoryMethod, excludeBreaks: boolean): ForecastEstimate => {
  const need=HISTORY_POLICY[method], from=dayStart-need.days*DAY_MS;
  const w=windowStats(h,from,dayStart,excludeBreaks);
  const reasons: string[]=[];
  if (w.exposureMs < need.minimumExposureDays*DAY_MS) reasons.push('insufficient_exposure');
  else if (w.snapshots < need.minimumSnapshots) reasons.push('insufficient_observations');
  else if (w.snapshotDays < need.minimumSnapshotDays) reasons.push('insufficient_observation_days');
  else if (w.maxIntervalMs*2 > w.exposureMs) reasons.push('dependent_window');
  if (reasons.length) return unavailable(method,reasons);
  const e=project(method,[],w.credits,w.exposureMs,iso(from),'regular');
  return {...e,windowTo:iso(dayStart),snapshotCount:w.snapshots,evidenceCredits:w.credits,evidenceMilliseconds:w.exposureMs,cyclesUsed:w.cycles,observedDays:w.snapshotDays,
   zeroNetMilliseconds:w.zeroNetMs,excludedBreakMilliseconds:w.excludedBreakMs};
 };
 for (const method of HISTORY_METHODS) result.estimates.push(pooled(method,heuristics.completedBreakExclusion));
 // Qualifier codes: breaks and recent changes are reported even when the corresponding heuristic is off.
 const blockStats=(fromDays: number,toDays: number)=>windowStats(h,dayStart-fromDays*DAY_MS,dayStart-toDays*DAY_MS,false);
 const w28=windowStats(h,dayStart-28*DAY_MS,dayStart,false);
 if (breakDays(h,dayStart-28*DAY_MS,dayStart).size) result.qualifiers.push('extended_zero_net_period_in_window');
 const recent=blockStats(7,0), middle=blockStats(14,7), older=blockStats(28,14);
 let sustained=false;
 if ([recent,middle,older].every(b=>b.exposureMs >= 5*DAY_MS) && w28.exposureMs > 0) {
  const times=(c: string,n: number)=>n === 2 ? add(c,c) : add(add(c,c),c);
  const [num,den]=SUSTAINED_RATIO; // r > num/den * older
  const higher=(x: WindowStats)=>compareRatios(times(x.credits,den),x.exposureMs,times(older.credits,num),older.exposureMs) > 0;
  const lower=(x: WindowStats)=>compareRatios(times(x.credits,num),x.exposureMs,times(older.credits,den),older.exposureMs) < 0;
  if (higher(recent) && higher(middle)) { sustained=true; result.qualifiers.push('recent_usage_higher'); }
  else if (lower(recent) && lower(middle)) { sustained=true; result.qualifiers.push('recent_usage_lower'); }
 }
 const qualified=(m: ForecastMethod)=>result.estimates.some(e=>e.method===m && e.status==='qualified');
 const order: ForecastMethod[]=['history_28_day','history_14_day','rolling_7_day','history_7_day','cycle_to_date','observed_window'];
 if (heuristics.sustainedChange && sustained && qualified('history_14_day')) order.unshift('history_14_day');
 result.selectedMethod=order.find(qualified) ?? null;
 if (result.selectedMethod) {
  result.status='qualified';
  const chosen=result.estimates.find(e=>e.method===result.selectedMethod)!;
  result.tier=chosen.tier; if (result.tier==='provisional') result.assumptions.push('limited_history');
  if (HISTORY_METHODS.includes(result.selectedMethod as HistoryMethod)) {
   result.assumptions.push('unobserved_periods_not_zero');
   if ((chosen.zeroNetMilliseconds ?? 0) > 0) result.assumptions.push('zero_net_change_not_proof_of_inactivity');
   if ((chosen.excludedBreakMilliseconds ?? 0) > 0) result.assumptions.push('completed_break_excluded');
  }
 }
 else result.reasons.push('insufficient_comparable_coverage');
 const previousStart=clean.findIndex(p=>Date.parse(p.observedAt) === observedMs-14*DAY_MS);
 if (cleanValid && rolling.length && adequate(rolling) && previousStart >= 0 && adequate(clean.slice(previousStart,rollingStart+1))) {
  const recent=subtract(latest.usage!,rolling[0].usage!), previous=subtract(rolling[0].usage!,clean[previousStart].usage!);
  const direction=compare(recent,previous);
  result.recentTrend={direction:direction > 0 ? 'increasing' : direction < 0 ? 'decreasing' : 'steady',
   recentRatePerDay:scaleRatio(recent,1n,7n),previousRatePerDay:scaleRatio(previous,1n,7n)};
 }
 return result;
}
