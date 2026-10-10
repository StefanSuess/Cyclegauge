import { subtract, compare, compareRatios, allocation, scaleRatio, combineRatio, exhaustionMilliseconds } from '../../../src/decimal.ts';
import { DAY_MS, MAX_GAP_MS, type AccountHistory, type HistoryPoint } from './history-v2.ts';

export type ForecastTier = 'unavailable' | 'provisional' | 'regular';
export type ForecastMethod = 'cycle_to_date' | 'rolling_7_day' | 'observed_window';
export interface ForecastEstimate {
 method: ForecastMethod; tier: ForecastTier; status: 'unavailable' | 'qualified'; reasons: string[];
 windowFrom: string | null; windowTo: string | null; windowDays: string | null; snapshotCount: number;
 ratePerDay: string | null; projectedUsageAtReset: string | null; projectedRemainingBaseAtReset: string | null;
 estimatedExhaustionDayUTC: string | null; exhaustionStatus: string; budgetComparison: string;
}
export interface ForecastResult {
 schemaVersion: 2; policy: { version: 2; regular: { minimumSpanDays: 7; minimumSnapshots: 8 }; provisional: { minimumSpanHours: 48; minimumSnapshots: 3 }; maximumGapHours: 36; maxAgeHours: number };
 status: 'unavailable' | 'qualified'; tier: ForecastTier; unit: 'CREDIT'; reasons: string[]; assumptions: string[];
 asOf: string | null; evaluatedAt: string; resetAt: string | null; horizonDays: string | null;
 currentCycleUsage: string | null; baseCreditLimit: string | null; remainingBaseCredits: string | null; dynamicDailyBudget: string | null;
 selectedMethod: ForecastMethod | null; estimates: ForecastEstimate[]; coverage: AccountHistory['coverage'];
 recentTrend: { direction: string; recentRatePerDay: string | null; previousRatePerDay: string | null };
}
const unavailable = (method: ForecastMethod, reasons: string[]): ForecastEstimate => ({ method,tier:'unavailable',status:'unavailable',reasons,
 windowFrom:null,windowTo:null,windowDays:null,snapshotCount:0,ratePerDay:null,projectedUsageAtReset:null,projectedRemainingBaseAtReset:null,
 estimatedExhaustionDayUTC:null,exhaustionStatus:'unavailable',budgetComparison:'unavailable' });
const span = (points: HistoryPoint[]) => Date.parse(points.at(-1)!.observedAt) - Date.parse(points[0].observedAt);
const provisionalAdequate = (points: HistoryPoint[]) => points.length >= 3 && span(points) >= 2*DAY_MS;
const adequate = (points: HistoryPoint[]) => points.length >= 8 && span(points) >= 7*DAY_MS;

export function forecast(h: AccountHistory, now = new Date().toISOString(), maxAgeHours = 24): ForecastResult {
 const latest=h.points.at(-1);
 const result: ForecastResult = { schemaVersion:2,policy:{version:2,regular:{minimumSpanDays:7,minimumSnapshots:8},provisional:{minimumSpanHours:48,minimumSnapshots:3},maximumGapHours:36,maxAgeHours},
  status:'unavailable',tier:'unavailable',unit:'CREDIT',reasons:[],
  assumptions:['constant_future_net_rate','net_counter_changes_not_gross_charges','base_credits_only','unobserved_usage_since_snapshot_unknown','no_statistical_confidence_interval'],
  asOf:latest?.observedAt ?? null,evaluatedAt:now,resetAt:h.cycleResetAt,horizonDays:null,
  currentCycleUsage:latest?.usage ?? null,baseCreditLimit:latest?.baseLimit ?? null,remainingBaseCredits:null,dynamicDailyBudget:null,
  selectedMethod:null,estimates:[],coverage:h.coverage,recentTrend:{direction:'unavailable',recentRatePerDay:null,previousRatePerDay:null} };
 const block = (reason: string) => {
  result.reasons.push(reason);
  result.estimates=(['cycle_to_date','rolling_7_day','observed_window'] as const).map(method=>unavailable(method,[reason]));
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
  clean.slice(1).every((p,i)=>Date.parse(p.observedAt) > Date.parse(clean[i].observedAt) && Date.parse(p.observedAt)-Date.parse(clean[i].observedAt) <= MAX_GAP_MS && compare(p.usage!,clean[i].usage!) >= 0);
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
   budgetComparison:comparison > 0 ? 'above_budget' : comparison < 0 ? 'within_budget' : 'at_budget' };
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
 result.selectedMethod=(['rolling_7_day','cycle_to_date','observed_window'] as const).find(method=>result.estimates.some(e=>e.method===method && e.status==='qualified')) ?? null;
 if (result.selectedMethod) {result.status='qualified';result.tier=result.estimates.find(e=>e.method===result.selectedMethod)!.tier; if (result.tier==='provisional') result.assumptions.push('limited_history');}
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
