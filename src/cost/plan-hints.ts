// Vscode-free plan hints. 'larger': next to a projected overage, the next larger plan's list-price fee and credit differences (reviewed price list
// only, no recommendation). 'rightsize': read-only from the Cost Advisor's 1-month estimate, a smaller plan that would have served the forecast and the
// last completed cycle. Anything unknown or unusable gives nothing.
import { compare, subtract } from '../decimal.ts';
import { decimalToRational } from './money.ts';
import type { AccountHistory } from '../history.ts';
import type { view } from '../view.ts';
import type { PlanSource } from './advisor.ts';
import { reviewedCatalog, validateCatalog } from './catalog.ts';
import type { SavingsEstimate } from './estimate.ts';
import { PLAN_IDS, type PlanId, type PricingCatalog } from './types.ts';

/** The next larger plan beside the current one: two list-price facts from the reviewed price list, no recommendation. */
export interface PlanComparison { current: PlanId; next: PlanId; feeDiff: string; creditDiff: string; hint: boolean; reviewedOn: string }
/** A smaller plan that the forecast and the last completed cycle both fit into, with its modelled monthly saving. */
export interface RightSizing { current: PlanId; plan: PlanId; saving: string; unusedCredits: string; hint: boolean }
export interface PlanInsights { larger: PlanComparison | null; rightsize: RightSizing | null }
export const NO_INSIGHTS: PlanInsights = { larger: null, rightsize: null };

const DAY_MS = 86_400_000;
const rank = (plan: PlanId): number => PLAN_IDS.indexOf(plan);
const add = (a: string, b: string): string => subtract(a, subtract('0', b));
const same = (a: string, b: string): boolean => Date.parse(a) === Date.parse(b);

/**
 * The last completed cycle's observed usage plus an allowance for its last unobserved hours, from stored history only. Observed usage is the
 * counter's net changes over that cycle; it is exact only when the cycle's start is backed by evidence (so it needs three observed cycles) and
 * every interval is present. The last observation may lie up to a day before the reset, so the allowance is that gap times the cycle's average
 * net use per unit of observed time, rounded up to six decimals. Null in every other case (observed usage alone is a lower bound).
 */
export function previousCycleUsage(h: AccountHistory, limit: string): string | null {
 try {
  const cycles = h.evidence.cycles, cur = cycles.at(-1), prev = cycles.at(-2);
  if (!cur || !prev || h.cycleResetAt === null || cur.resetAt !== h.cycleResetAt || !prev.startAt || cur.startAt === null || !same(cur.startAt, prev.resetAt)) return null;
  if (prev.baseLimit !== limit) return null;
  const toReset = Date.parse(prev.resetAt) - Date.parse(prev.lastObservedAt);
  if (!Number.isFinite(toReset) || toReset < 0 || toReset > DAY_MS) return null;
  const chain = h.evidence.intervals.filter(i => i.resetAt === prev.resetAt).sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  if (!chain.length || !same(chain[0]!.from, prev.startAt) || !same(chain.at(-1)!.to, prev.lastObservedAt) || chain.some((x, i) => i > 0 && !same(chain[i - 1]!.to, x.from))) return null;
  const observed = chain.reduce((sum, x) => add(sum, x.netChange), '0');
  const span = Date.parse(prev.lastObservedAt) - Date.parse(prev.startAt);
  if (!Number.isFinite(span) || span <= 0 || observed.startsWith('-')) return null;
  const r = decimalToRational(observed), scale = 1_000_000n, denominator = r.denominator * BigInt(span);
  const micro = (r.numerator * BigInt(toReset) * scale + denominator - 1n) / denominator; // rounded up
  return add(observed, subtract(`${micro / scale}.${(micro % scale).toString().padStart(6, '0')}`, '0'));
 } catch { return null; }
}

export interface InsightsInput {
 view: ReturnType<typeof view>;
 /** The advisor's 1-month estimate (right-sizing only); null when none could be built. */
 estimate: SavingsEstimate | null;
 planSource: PlanSource;
 /** The current plan (confirmed or hinted from the limit); null when unknown. */
 plan: PlanId | null;
 now: string;
 catalog?: PricingCatalog;
}

/** The next larger plan's fee and credit differences, only with a known plan, a projected overage and a valid, reviewed (not hypothetical) price list. */
function largerPlan(i: InsightsInput, projected: string, limit: string): PlanComparison | null {
 const o = i.view;
 if (i.plan === null || i.planSource === 'unknown' || compare(projected, limit) <= 0 || o.flags.includes('unsupported_extra_credits')) return null;
 const checked = validateCatalog(i.catalog ?? reviewedCatalog, i.now), catalog = checked.catalog;
 if (!catalog || checked.status === 'unavailable' || catalog.evidence !== 'reviewed') return null;
 const next = PLAN_IDS[rank(i.plan) + 1];
 const a = catalog.plans.find(p => p.id === i.plan), b = next && catalog.plans.find(p => p.id === next);
 if (!a || !b || !next) return null;
 const feeDiff = subtract(b.fee, a.fee), creditDiff = subtract(b.credits, a.credits);
 if (compare(feeDiff, '0') <= 0 || compare(creditDiff, '0') <= 0) return null;
 return { current: i.plan, next, feeDiff, creditDiff, hint: i.planSource === 'hint', reviewedOn: catalog.verifiedOn };
}

/** Both hints, or nothing: they need a fresh forecast; right-sizing also needs a regular one and a usable 'saving' estimate. */
export function planInsights(i: InsightsInput): PlanInsights {
 try {
  const o = i.view, f = o.forecast;
  const selected = f.estimates.find(x => x.method === f.selectedMethod && x.status === 'qualified');
  const projected = selected?.projectedUsageAtReset;
  if (o.status !== 'observed' || f.status !== 'qualified' || !selected || !projected || o.baseLimit === null) return NO_INSIGHTS;
  let larger: PlanComparison | null = null;
  try { larger = largerPlan(i, projected, o.baseLimit); } catch { larger = null; }
  return { larger, rightsize: f.tier === 'regular' ? rightSizing(i, projected, o.baseLimit) : null };
 } catch { return NO_INSIGHTS; }
}

function rightSizing(i: InsightsInput, projected: string, limit: string): RightSizing | null {
 try {
  const o = i.view, e = i.estimate;
  const checked = validateCatalog(i.catalog ?? reviewedCatalog, i.now), catalog = checked.catalog;
  if (!catalog || checked.status === 'unavailable' || catalog.evidence !== 'reviewed') return null;
  if (o.flags.includes('unsupported_extra_credits')) return null;
  if (i.planSource === 'unknown' || !e || (e.tier !== 'supported' && e.tier !== 'modelled') || e.outcome !== 'saving' || !e.baselinePlan || !e.base?.best || e.base.best.keep || e.base.saving === null) return null;
  if (compare(e.base.saving, '0') <= 0 || e.conditions.includes('free_plan_terms_unverified')) return null;
  const current = e.baselinePlan, best = e.base.best.plan, plan = catalog.plans.find(p => p.id === best);
  if (!plan || compare(projected, limit) >= 0 || rank(best) >= rank(current) || e.preferredChanges || compare(plan.credits, projected) < 0) return null;
  // Deliberate size threshold: the smaller plan must cover the projected usage, so the unused part is at least the gap between the two plans.
  const previous = previousCycleUsage(o.history, limit);
  if (previous === null || compare(previous, plan.credits) > 0) return null;
  return { current, plan: best, saving: e.base.saving, unusedCredits: subtract(limit, projected), hint: i.planSource === 'hint' };
 } catch { return null; }
}
