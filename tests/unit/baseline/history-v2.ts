import { subtract, scaleRatio } from '../../../src/decimal.ts';
import type { StoredSnapshot } from '../../../src/store.ts';

export const DAY_MS = 86400000;
export const MAX_GAP_MS = 36 * 3600000;
export interface HistoryPoint {
 observedAt: string; usage: string | null; baseLimit: string | null; resetAt: string | null; flags: string[]; conflicting: boolean;
}
export interface HistoryInterval { from: string; to: string; netChange: string | null; status: string; utcDay: string | null }
export interface HistoryDay { day: string; netChange: string | null; complete: boolean; observedMilliseconds: number }
export interface AccountHistory {
 status: string; reasons: string[]; cycleResetAt: string | null; cycleStartAt: string | null;
 points: HistoryPoint[]; intervals: HistoryInterval[]; days: HistoryDay[];
 averageObservedNetChangePerDay: string | null;
 coverage: { from: string | null; to: string | null; spanDays: string | null; snapshotCount: number;
  completeUtcDays: number; partialUtcDays: number; unknownUtcDays: number; initialPeriodUnknown: boolean;
  gaps: { from: string; to: string; reason: string }[] };
}
const empty = (status: string): AccountHistory => ({ status, reasons: [status], cycleResetAt: null, cycleStartAt: null,
 points: [], intervals: [], days: [], averageObservedNetChangePerDay: null,
 coverage: { from:null,to:null,spanDays:null,snapshotCount:0,completeUtcDays:0,partialUtcDays:0,unknownUtcDays:0,initialPeriodUnknown:true,gaps:[] } });
const fields = (s: StoredSnapshot) => JSON.stringify([s.usage,s.limit,s.resetAt,s.overages,s.overageCap,s.flags.filter(f => f !== 'assumed_source_timezone').sort()]);
const iso = (time: number) => new Date(time).toISOString();

export function history(snapshots: StoredSnapshot[]): AccountHistory {
 if (!snapshots.length) return empty('unavailable');
 if (new Set(snapshots.map(s => s.partition)).size !== 1) return empty('multiple_accounts');
 if (snapshots.some(s => !s.associated)) return empty('unknown_account');
 const grouped = new Map<number,StoredSnapshot[]>();
 for (const s of snapshots) {
  const time = Date.parse(s.observedAt);
  if (!Number.isFinite(time)) return empty('invalid_timestamp');
  grouped.set(time, [...(grouped.get(time) ?? []),s]);
 }
 const all: HistoryPoint[] = [...grouped].sort(([a],[b]) => a-b).map(([time,group]) => {
  const conflicting = new Set(group.map(fields)).size !== 1; const s = group[0];
  return { observedAt:iso(time),usage:conflicting ? null : s.usage,baseLimit:conflicting ? null : s.limit,
   resetAt:group.every(p => p.resetAt === s.resetAt) ? s.resetAt : null,
   flags:[...new Set(group.flatMap(p => p.flags))].sort(),conflicting };
 });
 const latest = all.at(-1)!;
 if (latest.conflicting) return empty('conflicting_snapshots');
 if (!latest.resetAt) return empty('reset_unknown');
 const h = empty('available'); h.reasons = []; h.cycleResetAt = latest.resetAt;
 let start = all.length - 1;
 while (start > 0 && all[start-1].resetAt === latest.resetAt) start--;
 if (start > 0) {
  const prior = all[start-1];
  if (prior.resetAt && Date.parse(prior.resetAt) > Date.parse(latest.resetAt)) return empty('reset_regressed');
  if (prior.resetAt && !prior.conflicting && Date.parse(prior.resetAt) > Date.parse(prior.observedAt) && Date.parse(prior.resetAt) <= Date.parse(all[start].observedAt)) h.cycleStartAt = iso(Date.parse(prior.resetAt));
  else h.reasons.push('ambiguous_cycle_start');
 }
 h.points = all.slice(start);
 const first = h.points[0]; const span = Date.parse(latest.observedAt) - Date.parse(first.observedAt);
 if (span > 3660 * DAY_MS) return empty('history_range_exceeded');
 h.coverage.from = first.observedAt; h.coverage.to = latest.observedAt;
 h.coverage.spanDays = scaleRatio(String(span),1n,BigInt(DAY_MS)); h.coverage.snapshotCount = h.points.length;
 h.coverage.initialPeriodUnknown = h.cycleStartAt === null || h.cycleStartAt !== first.observedAt;
 for (let i=1;i<h.points.length;i++) {
  const a=h.points[i-1], b=h.points[i]; const from=Date.parse(a.observedAt), to=Date.parse(b.observedAt);
  let status='comparable'; let netChange: string | null=null;
  if (a.conflicting || b.conflicting) status='conflicting_snapshots';
  else if (a.usage === null || b.usage === null || a.baseLimit === null || b.baseLimit === null) status='missing_billing';
  else if (a.baseLimit !== b.baseLimit) status='limit_change';
  else if (a.flags.includes('unsupported_extra_credits') || b.flags.includes('unsupported_extra_credits')) status='unsupported_extra_credits';
  else {
   netChange=subtract(b.usage,a.usage);
   if (netChange.startsWith('-')) status='usage_adjustment';
   else if (to-from > MAX_GAP_MS) status='observation_gap';
  }
  const sameDay=Math.floor(from/DAY_MS) === Math.floor((to-1)/DAY_MS);
  const utcDay=status === 'comparable' && sameDay ? iso(from).slice(0,10) : null;
  h.intervals.push({from:a.observedAt,to:b.observedAt,netChange,status,utcDay});
  if (status !== 'comparable') h.coverage.gaps.push({from:a.observedAt,to:b.observedAt,reason:status});
 }
 const firstDay=Math.floor(Date.parse(first.observedAt)/DAY_MS);
 const endDay=Math.floor((Date.parse(latest.observedAt) - (span > 0 ? 1 : 0))/DAY_MS);
 const days=new Map<string,HistoryDay>();
 for (let d=firstDay;d<=endDay;d++) { const day=iso(d*DAY_MS).slice(0,10); days.set(day,{day,netChange:null,complete:false,observedMilliseconds:0}); }
 for (const interval of h.intervals) {
  if (!interval.utcDay) continue;
  const day=days.get(interval.utcDay)!;
  day.netChange=subtract(day.netChange ?? '0', subtract('0',interval.netChange!));
  day.observedMilliseconds+=Date.parse(interval.to)-Date.parse(interval.from);
  day.complete=day.observedMilliseconds === DAY_MS;
 }
 h.days=[...days.values()];
 h.coverage.completeUtcDays=h.days.filter(d => d.complete).length;
 h.coverage.partialUtcDays=h.days.filter(d => d.netChange !== null && !d.complete).length;
 h.coverage.unknownUtcDays=h.days.filter(d => d.netChange === null).length;
 // This interval average does not claim daily measurements or gross charges.
 if (span > 0 && h.intervals.every(i => i.netChange !== null && ['comparable','observation_gap'].includes(i.status)))
  h.averageObservedNetChangePerDay=scaleRatio(subtract(latest.usage!,first.usage!),BigInt(DAY_MS),BigInt(span));
 return h;
}
