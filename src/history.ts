import { subtract, scaleRatio } from './decimal.ts';
import type { StoredSnapshot } from './store.ts';

export const DAY_MS = 86400000;
export const MAX_GAP_MS = 36 * 3600000;
export interface HistoryPoint {
 observedAt: string; usage: string | null; baseLimit: string | null; resetAt: string | null; flags: string[]; conflicting: boolean;
}
export interface HistoryInterval { from: string; to: string; netChange: string | null; status: string; utcDay: string | null }
export interface HistoryDay { day: string; netChange: string | null; complete: boolean; observedMilliseconds: number }
export const EVIDENCE_DAYS = 85;
export interface EvidenceInterval { from: string; to: string; netChange: string; kind: 'day' | 'zero_net' | 'span'; resetAt: string }
export interface EvidenceDay { day: string; netChange: string; observedMilliseconds: number; zeroNetMilliseconds: number; snapshots: number }
export interface EvidenceSpan { from: string; to: string; netChange: string }
export interface EvidenceCycle { resetAt: string; startAt: string | null; baseLimit: string | null; firstObservedAt: string; lastObservedAt: string; snapshotCount: number }
/** Billing-only, cross-cycle evidence. Unobserved time is never present here, so it cannot be mistaken for zero usage. */
export interface HistoryEvidence {
 maxDays: number; observations: string[]; cycles: EvidenceCycle[]; intervals: EvidenceInterval[]; days: EvidenceDay[]; spans: EvidenceSpan[];
 exclusions: { code: string; count: number }[]; stoppedBy: string | null;
}
export interface AccountHistory {
 evidence: HistoryEvidence;
 status: string; reasons: string[]; cycleResetAt: string | null; cycleStartAt: string | null;
 points: HistoryPoint[]; intervals: HistoryInterval[]; days: HistoryDay[];
 averageObservedNetChangePerDay: string | null;
 coverage: { from: string | null; to: string | null; spanDays: string | null; snapshotCount: number;
  completeUtcDays: number; partialUtcDays: number; unknownUtcDays: number; initialPeriodUnknown: boolean;
  gaps: { from: string; to: string; reason: string }[] };
}
const emptyEvidence = (): HistoryEvidence => ({ maxDays: EVIDENCE_DAYS, observations: [], cycles: [], intervals: [], days: [], spans: [], exclusions: [], stoppedBy: null });
const empty = (status: string): AccountHistory => ({ evidence: emptyEvidence(), status, reasons: [status], cycleResetAt: null, cycleStartAt: null,
 points: [], intervals: [], days: [], averageObservedNetChangePerDay: null,
 coverage: { from:null,to:null,spanDays:null,snapshotCount:0,completeUtcDays:0,partialUtcDays:0,unknownUtcDays:0,initialPeriodUnknown:true,gaps:[] } });
const fields = (s: StoredSnapshot) => JSON.stringify([s.usage,s.limit,s.resetAt,s.overages,s.overageCap,s.flags.filter(f => f !== 'assumed_source_timezone').sort()]);
const iso = (time: number) => new Date(time).toISOString();

const add = (a: string, b: string) => subtract(a, subtract('0', b));
const validPoint = (p: HistoryPoint) => !p.conflicting && p.usage !== null && p.baseLimit !== null;
const dayKey = (time: number) => iso(Math.floor(time / DAY_MS) * DAY_MS).slice(0, 10);

function buildEvidence(all: HistoryPoint[]): HistoryEvidence {
 const evidence = emptyEvidence();
 const latestMs = Date.parse(all.at(-1)!.observedAt);
 const earliest = (Math.floor(latestMs / DAY_MS) - EVIDENCE_DAYS) * DAY_MS;
 const exclusions = new Map<string, number>();
 const exclude = (code: string) => exclusions.set(code, (exclusions.get(code) ?? 0) + 1);
 let lo = all.length - 1;
 while (lo > 0) {
  const a = all[lo-1], b = all[lo];
  if (Date.parse(a.observedAt) < earliest) { evidence.stoppedBy = 'evidence_range'; break; }
  if (!a.resetAt || !b.resetAt) { evidence.stoppedBy = 'reset_unknown'; break; }
  if (Date.parse(a.resetAt) > Date.parse(b.resetAt)) { evidence.stoppedBy = 'reset_regressed'; break; }
  if (a.flags.includes('unsupported_extra_credits')) { evidence.stoppedBy = 'unsupported_extra_credits'; break; }
  if (validPoint(a) && validPoint(b) && a.baseLimit !== b.baseLimit) { evidence.stoppedBy = 'limit_change'; break; }
  lo--;
 }
 const points = all.slice(lo);
 evidence.observations = points.map(p => p.observedAt);
 // Cycles are maximal same-reset runs; the start is backed only by the preceding snapshot's own reset time.
 let runStart = 0;
 for (let i = 1; i <= points.length; i++) {
  if (i < points.length && points[i].resetAt === points[runStart].resetAt) continue;
  const first = points[runStart], last = points[i-1];
  let startAt: string | null = null;
  if (runStart > 0) {
   const prior = points[runStart-1];
   if (prior.resetAt && !prior.conflicting && Date.parse(prior.resetAt) > Date.parse(prior.observedAt) && Date.parse(prior.resetAt) <= Date.parse(first.observedAt)) startAt = iso(Date.parse(prior.resetAt));
  }
  const valid = points.slice(runStart, i).filter(validPoint);
  evidence.cycles.push({ resetAt: first.resetAt!, startAt, baseLimit: valid.at(-1)?.baseLimit ?? null, firstObservedAt: first.observedAt, lastObservedAt: last.observedAt, snapshotCount: i - runStart });
  if (startAt && validPoint(first) && !first.flags.includes('unsupported_extra_credits') && Date.parse(first.observedAt) - Date.parse(startAt) <= DAY_MS && Date.parse(first.observedAt) > Date.parse(startAt)) {
   // The usage counter is zero at an evidence-backed cycle start; this is the rule cycle_to_date already uses.
   classify({ at: startAt, flags: [] }, first, first.usage!);
  }
  runStart = i;
 }
 function classify(a: { at: string; flags: string[] }, b: HistoryPoint, net: string) {
  const from = Date.parse(a.at), to = Date.parse(b.observedAt);
  const sameDay = Math.floor(from / DAY_MS) === Math.floor((to - 1) / DAY_MS);
  const zero = net === '0';
  if (!sameDay && zero && (a.flags.includes('reduced_precision') || b.flags.includes('reduced_precision'))) { exclude('reduced_precision_zero_net'); return; }
  evidence.intervals.push({ from: iso(from), to: iso(to), netChange: net, kind: sameDay ? 'day' : zero ? 'zero_net' : 'span', resetAt: b.resetAt! });
 }
 for (let i = 1; i < points.length; i++) {
  const a = points[i-1], b = points[i];
  if (a.resetAt !== b.resetAt) continue;
  if (a.conflicting || b.conflicting) { exclude('conflicting_snapshots'); continue; }
  if (a.usage === null || b.usage === null) { exclude('missing_billing'); continue; }
  if (b.flags.includes('unsupported_extra_credits')) { exclude('unsupported_extra_credits'); continue; }
  const net = subtract(b.usage, a.usage);
  if (net.startsWith('-')) { exclude('usage_adjustment'); continue; }
  classify({ at: a.observedAt, flags: a.flags }, b, net);
 }
 evidence.intervals.sort((x, y) => Date.parse(x.from) - Date.parse(y.from));
 const days = new Map<string, EvidenceDay>();
 const row = (day: string) => { let r = days.get(day); if (!r) { r = { day, netChange: '0', observedMilliseconds: 0, zeroNetMilliseconds: 0, snapshots: 0 }; days.set(day, r); } return r; };
 for (const p of points) if (validPoint(p)) row(dayKey(Date.parse(p.observedAt))).snapshots++;
 for (const iv of evidence.intervals) {
  const from = Date.parse(iv.from), to = Date.parse(iv.to);
  if (iv.kind === 'day') { const r = row(dayKey(from)); r.netChange = add(r.netChange, iv.netChange); r.observedMilliseconds += to - from; }
  else if (iv.kind === 'zero_net') {
   for (let d = Math.floor(from / DAY_MS); d * DAY_MS < to; d++) {
    const overlap = Math.min(to, (d+1) * DAY_MS) - Math.max(from, d * DAY_MS);
    const r = row(iso(d * DAY_MS).slice(0, 10)); r.observedMilliseconds += overlap; r.zeroNetMilliseconds += overlap;
   }
  } else evidence.spans.push({ from: iv.from, to: iv.to, netChange: iv.netChange });
 }
 evidence.days = [...days.values()].sort((x, y) => x.day < y.day ? -1 : 1);
 evidence.exclusions = [...exclusions].map(([code, count]) => ({ code, count })).sort((x, y) => x.code < y.code ? -1 : 1);
 return evidence;
}

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
 h.evidence = buildEvidence(all);
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
   else if (to-from > MAX_GAP_MS && netChange !== '0') status='observation_gap'; // an unchanged counter is observed zero net change, not a quality barrier
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
