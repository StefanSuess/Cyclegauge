// Billing-only core contracts. No identities, paths, application state or UI types.
export type PlanId = 'free' | 'pro' | 'pro_plus' | 'pro_max' | 'power';
export const PLAN_IDS: readonly PlanId[] = ['free','pro','pro_plus','pro_max','power'];
export type Status = 'available' | 'conditional' | 'unavailable';
export type Decimal = string;
export type Instant = string;
export type Knowledge<T> = {kind:'known'; value:T} | {kind:'unknown'};
export interface Rational {numerator:bigint; denominator:bigint}
export interface Money {currency:'USD'; amount:Decimal}
export interface Provenance {url:string; section:string}
export interface RuleEvidence extends Provenance {
 id:string; status:'verified'|'unknown'|'conflicting'; effectiveFrom:Instant|null; effectiveTo:Instant|null;
}
export interface PlanPrice {id:PlanId; fee:Decimal; credits:Decimal; source:Provenance}
export interface PricingCatalog {
 schemaVersion:1; id:string; version:string; verifiedOn:Instant; currency:'USD'; market:'commercial';
 evidence:'reviewed'|'hypothetical'; plans:PlanPrice[]; rules:RuleEvidence[];
 schedule:'utc_calendar_month';
 consumer:{billingSystem:'consumer_prepaid'; pricePerCredit:Decimal; minimumCredits:Decimal; maximumCredits:Decimal;
  maximumPacks:5; expiryMonths:12; purchaseStepCredits:Decimal|null; moneyRounding:'exact'|null; depletedSlotRelease:boolean|null};
 enterprise:{billingSystem:'enterprise_postpaid'; pricePerCredit:Decimal; allowedPlans:PlanId[]};
 changes:{at:Instant; planId:PlanId; fee:Decimal; credits:Decimal; source:Provenance}[];
}
export interface CatalogValidation {status:Status; catalog:PricingCatalog|null; reasons:string[]}
export interface PurchasedCreditLot {remainingCredits:Decimal; expiresAt:Instant|null; expiryPrecision:'instant'|'day'|'unknown'}
export interface BillingProfile {
 provenance:'manual'; confirmedAt:Instant; billingSystem:'consumer_prepaid'|'enterprise_postpaid'|'unknown';
 market:'commercial'|'govcloud'|'custom'|'unknown'; currentPlan:PlanId|null; allowedPlans:PlanId[];
 cohort:'established_paid'|'first_paid_month'|'never_paid'|'returning_free'|'unknown'; firstPaidAt:Instant|null;
 promotion:'none_confirmed'|'present_or_unknown'; resetAt:Instant|null;
 planRemaining:Knowledge<Decimal>; cycleUsageForRerating:Knowledge<Decimal>; priorAddOnConsumption:'none_confirmed'|'present_or_unknown';
 purchased:Knowledge<PurchasedCreditLot[]>; availablePackSlots:Knowledge<number>;
 enterpriseOverage:{enabled:Knowledge<boolean>; headroomCredits:Knowledge<Decimal>};
}
export interface ManualDemand {
 asOf:Instant; beforeReset?:Decimal; futureCycleCredits:Decimal[]; lowFactor?:Decimal; highFactor?:Decimal;
 // Explicit standalone comparison assumptions; absence never means confirmed zero.
 standalone?:{billingSystem:'consumer_prepaid'|'enterprise_postpaid'; market:'commercial'; openingPurchased:'none'; promotion:'excluded'; schedule:'utc_calendar_month'};
}
export interface DemandScenario {
 id:'low'|'base'|'high'; source:'forecast_provisional'|'forecast_regular'|'manual'; anchorAt:Instant;
 beforeReset:Knowledge<Rational>; futureCycles:{from:Instant; to:Instant; credits:Rational}[];
 withinCycle:'constant_rate_assumption'; assumptions:string[];
}
export interface DemandResult {status:Status; reasons:string[]; scenarios:DemandScenario[]}
export interface Strategy {id:string; targetPlan:PlanId; timing:'keep'|'now'|'next_reset'|'now_then_revert_at_reset'; extras:'as_needed'|'none'}
export interface CostBreakdown {
 from:Instant; to:Instant; newSubscriptionSpend:Money|null; newAddOnSpend:Money|null; newOverageLiability:Money|null;
 totalNewExpenditure:Money|null; additionalCreditsNeeded:Decimal|null; unmetDemandCredits:Decimal|null;
 openingPurchasedCredits:Decimal|null; existingCreditsConsumed:Decimal|null; expiredPurchasedCredits:Decimal|null;
 closingPurchasedCredits:Decimal|null; purchases:{modeledAt:Instant; credits:Decimal; spend:Money}[];
 // Conservation includes newly bought lots separately from already paid opening inventory.
 purchasedCreditsConsumed:Decimal|null; newPurchasedCredits:Decimal|null; planCreditsConsumed:Decimal|null;
 lowerBoundNewAddOnSpend:Money|null; feasible:boolean|null;
}
export interface CostScenario {
 schemaVersion:1; strategy:Strategy; demandId:DemandScenario['id']; status:Status; reasons:string[];
 effectiveAt:Instant|null; bridge:CostBreakdown; future:CostBreakdown; assumptions:string[];
}
export interface CostRequest {now:Instant; horizonMonths:1|3|6; catalog:PricingCatalog; profile:BillingProfile; demands:DemandScenario[]}
export interface BreakEvenResult {
 status:Status; reasons:string[]; basis:'single_full_cycle_no_opening_lots'|'conditional_linear_reference';
 points:{plans:PlanId[]; credits:Decimal}[];
 intervals:{lower:Decimal; upper:Decimal; lowerInclusive:boolean; upperInclusive:boolean; tiedPlans:PlanId[]; winningPlans:PlanId[]}[];
 assumptions:string[];
 evaluatedUsageRange:{lower:Decimal;upper:Decimal}|null;
}
export interface CostOptimization {
 schemaVersion:1; status:Status; catalogVersion:string|null; reasons:string[]; scenarios:CostScenario[];
 baselineStrategyId:string|null;
 recommendation:{strategyId:string; demandIds:DemandScenario['id'][]; kind:'conditional_estimate'|'supported_comparison'}|null;
 alternatives:{demandId:DemandScenario['id']; strategyId:string|null; status:Status}[];
 savings:{strategyId:string; demandId:DemandScenario['id']; bridge:Money|null; future:Money|null}[];
 savingsRange:{minimum:Money; maximum:Money}|null; breakEven:BreakEvenResult;
}
