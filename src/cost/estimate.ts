// Modelled savings estimates for the Cost Advisor. Pure: no VS Code, no storage, no network. It never changes the
// pricing catalog, the demand builder, the simulator or the optimizer; it only reads their results and says how far
// a numerical difference between the current plan and an alternative can be trusted.
//
// Scope: strategies that keep the current plan or change plan at the next UTC reset. Both share the same current
// partial cycle, so only the full future billing cycles are compared. Mid-cycle upgrades are not priced here.
import {compare,decimal,subtract} from '../decimal.ts';
import type {Advice,AdvisorContext} from './advisor.ts';
import type {CostOptimization,CostScenario,Decimal,PlanId} from './types.ts';

/**
 * supported: every input explicit and the engine's own classification agrees.
 * modelled: baseline and alternative are both calculable; unconfirmed assumptions are listed as conditions.
 * comparison_only: alternatives can be priced but the current plan's cost cannot, so no difference is computed.
 * insufficient: nothing can be priced.
 */
export type EstimateTier='supported'|'modelled'|'comparison_only'|'insufficient';
export type EstimateOutcome='saving'|'no_cheaper'|'costs_only'|'none';
export interface PricedPlan {plan:PlanId; strategyId:string; cost:Decimal; keep:boolean}
export interface DemandEstimate {
 demandId:'low'|'base'|'high';
 baseline:Decimal|null;          // cost of keeping the current plan; null when it cannot be calculated
 priced:PricedPlan[];            // calculable options that serve the whole demand, cheapest first
 best:PricedPlan|null;           // lowest calculable option (not a proven global minimum)
 saving:Decimal|null;            // baseline minus best, never negative; null without a calculable baseline
 unpriced:number;                // compared options whose cost or feasibility is unknown
 unsuitable:number;              // compared options priced but unable to serve the demand
 forecastCredits:Decimal|null;   // credits the best option consumes from its plan allowance (only when nothing is bought)
}
export interface SavingsEstimate {
 tier:EstimateTier; outcome:EstimateOutcome; months:number; currency:'USD';
 window:{from:string;to:string}|null;   // full billing cycles the figures cover (UTC)
 baselinePlan:PlanId|null;
 levels:DemandEstimate[];               // low, base, high
 base:DemandEstimate|null;
 range:{minimum:Decimal;maximum:Decimal}|null;
 preferredChanges:boolean;              // the lowest calculable plan differs between demand levels
 stable:boolean;                        // all three demand levels priced, same preferred plan: the difference does not depend on usage
 conditions:string[];                   // fixed codes only
}

/**
 * Scenario conditions that do not change a list-price figure that was actually calculated. Anything else (stale or
 * mismatched balances, unknown rules, hypothetical catalogs, unknown purchase pricing) makes the figure unusable.
 */
const HARMLESS=new Set(['cohort_or_promotion_conditional','sustained_usage_scenario','catalog_review_due']);
const BLOCKING_CONTEXT=['usage_exceeds_reported_limit','limit_differs_from_plan_credits'];
const LEVELS=['low','base','high'] as const;

export const insufficientEstimate=(months:number,conditions:string[]=[]):SavingsEstimate=>({tier:'insufficient',outcome:'none',months,currency:'USD',window:null,baselinePlan:null,levels:[],base:null,range:null,preferredChanges:false,stable:false,conditions});

// Opening purchased lots would be valued at zero and consumed unevenly between options, so such figures are not comparable.
const noOpeningLots=(s:CostScenario)=>{const o=s.future.openingPurchasedCredits;return o===null||o===undefined||compare(o,'0')===0;};
const usable=(s:CostScenario|undefined):s is CostScenario=>!!s&&s.status!=='unavailable'&&s.future.feasible===true&&s.reasons.every(r=>HARMLESS.has(r))&&s.future.totalNewExpenditure?.currency==='USD'&&noOpeningLots(s);
const cost=(s:CostScenario):Decimal=>decimal(s.future.totalNewExpenditure!.amount);

function level(result:CostOptimization,demandId:DemandEstimate['demandId']):DemandEstimate {
 const all=result.scenarios.filter(s=>s.demandId===demandId&&s.strategy.extras==='as_needed'&&(s.strategy.timing==='keep'||s.strategy.timing==='next_reset'));
 const baselineScenario=all.find(s=>s.strategy.id===result.baselineStrategyId);
 const baselineUsable=usable(baselineScenario)&&baselineScenario.strategy.timing==='keep';
 const baseline=baselineUsable?cost(baselineScenario):null;
 const window=baselineUsable?`${baselineScenario.future.from}|${baselineScenario.future.to}`:null;
 const priced:PricedPlan[]=[];let unpriced=0,unsuitable=0;
 for(const s of all){
  // Options are comparable only over the same full billing cycles as a calculable baseline.
  const comparable=window===null||`${s.future.from}|${s.future.to}`===window;
  if(usable(s)&&comparable)priced.push({plan:s.strategy.targetPlan,strategyId:s.strategy.id,cost:cost(s),keep:s.strategy.timing==='keep'});
  else if(s.status!=='unavailable'&&s.future.feasible===false&&s.reasons.every(r=>HARMLESS.has(r)||r==='unmet_demand'))unsuitable++;
  else unpriced++;
 }
 // Cheapest first; on a tie the current plan wins so that equal cost is never presented as a saving.
 priced.sort((a,b)=>compare(a.cost,b.cost)||Number(b.keep)-Number(a.keep)||a.strategyId.localeCompare(b.strategyId));
 const best=priced[0]??null;
 const saving=baseline!==null&&best!==null?subtract(baseline,best.cost):null;
 const bestScenario=best?all.find(s=>s.strategy.id===best.strategyId):undefined;
 const planCredits=bestScenario?.future.planCreditsConsumed,extra=bestScenario?.future.additionalCreditsNeeded;
 const forecastCredits=planCredits&&extra!==null&&extra!==undefined&&compare(extra,'0')===0?planCredits:null;
 return {demandId,baseline,priced,best,saving,unpriced,unsuitable,forecastCredits};
}

/** Upgrading immediately is outside this comparison; flag it when the engine itself prices it lower than keeping. */
function midCycleCheaper(result:CostOptimization,baseline:CostScenario|undefined):boolean {
 const total=(s:CostScenario)=>s.bridge.feasible===true&&s.future.feasible===true&&s.bridge.totalNewExpenditure&&s.future.totalNewExpenditure
  ?subtract(decimal(s.bridge.totalNewExpenditure.amount),subtract('0',decimal(s.future.totalNewExpenditure.amount))):null;
 const base=baseline?total(baseline):null;if(base===null)return false;
 return result.scenarios.some(s=>s.demandId==='base'&&(s.strategy.timing==='now'||s.strategy.timing==='now_then_revert_at_reset')&&s.status!=='unavailable'&&(()=>{const t=total(s);return t!==null&&compare(t,base)<0;})());
}

/**
 * Turns one horizon's optimizer result into a numerical estimate with an explicit trust tier. A difference is only
 * produced when the current plan's cost and an alternative's cost were both actually calculated over the same full
 * billing cycles. Unknown balances, prices, promotions, eligibility or purchased credits are never treated as zero.
 */
export function estimateSavings(result:CostOptimization|null,context:AdvisorContext,advice:Advice,months:number):SavingsEstimate {
 try{
  if(!result||result.status==='unavailable'||!Array.isArray(result.scenarios)||!result.scenarios.length)return insufficientEstimate(months);
  if(context.addOns==='unknown'||BLOCKING_CONTEXT.some(c=>context.assumptions.includes(c)))return insufficientEstimate(months,context.assumptions);
  const levels=LEVELS.map(id=>level(result,id)),base=levels[1];
  if(!base.best)return insufficientEstimate(months,context.assumptions);
  const baselineScenario=result.scenarios.find(s=>s.demandId==='base'&&s.strategy.id===result.baselineStrategyId);
  const baselinePlan=base.baseline!==null?baselineScenario!.strategy.targetPlan:null;
  const window=base.baseline!==null?{from:baselineScenario!.future.from,to:baselineScenario!.future.to}:null;
  const best=base.best;
  const bestScenario=result.scenarios.find(s=>s.demandId==='base'&&s.strategy.id===best.strategyId)!;
  const conditions=new Set<string>(context.assumptions);
  const conditionsFrom=(s:CostScenario|undefined)=>{for(const r of s?.reasons??[])if(HARMLESS.has(r))conditions.add(r);for(const a of s?.assumptions??[])if(a==='limited_history'||a==='short_window_long_horizon'||a==='net_changes_not_gross_billable_usage')conditions.add(a);};
  conditionsFrom(baselineScenario);conditionsFrom(bestScenario);
  conditions.add('list_prices_pre_tax');conditions.add('forecast_not_guaranteed');conditions.add('only_next_reset_changes_compared');
  if(base.unpriced>0)conditions.add('overall_cheapest_unknown');
  if(levels.some(l=>l.best?.plan==='free'&&!l.best.keep))conditions.add('free_plan_terms_unverified');
  if(midCycleCheaper(result,baselineScenario))conditions.add('mid_cycle_upgrade_cheaper');
  const savings=levels.map(l=>l.saving);
  const range=savings.every(s=>s!==null)?(()=>{const sorted=[...savings as string[]].sort(compare);return {minimum:sorted[0],maximum:sorted.at(-1)!};})():null;
  if(!range)conditions.add('sensitivity_partly_unpriced');
  const bests=new Set(levels.flatMap(l=>l.best?[l.best.plan]:[]));
  const preferredChanges=bests.size>1;
  const stable=!preferredChanges&&range!==null&&levels.every(l=>l.unpriced===0);
  if(preferredChanges)conditions.add('sensitivity_changes_preferred_plan');
  if(base.saving===null){
   conditions.add('baseline_cost_unavailable');
   return {tier:'comparison_only',outcome:'costs_only',months,currency:'USD',window:{from:bestScenario.future.from,to:bestScenario.future.to},baselinePlan:null,levels,base,range:null,preferredChanges,stable:false,conditions:[...conditions]};
  }
  const saving=compare(base.saving,'0')>0;
  // "Supported" additionally needs the engine's own classification: every input explicit, no engine condition left.
  // A move to Free carries unverified terms, so it is never presented as supported.
  const supported=!conditions.has('free_plan_terms_unverified')&&(saving?advice.kind==='potential_savings':advice.kind==='no_action');
  return {tier:supported?'supported':'modelled',outcome:saving?'saving':'no_cheaper',months,currency:'USD',window,baselinePlan,levels,base,range,preferredChanges,stable,conditions:[...conditions]};
 }catch{return insufficientEstimate(months);}
}

/** Display helper. Savings round down and costs round up so a displayed figure never overstates the benefit. */
export function formatUsd(amount:Decimal,direction:'down'|'up'='down'):string {
 const value=decimal(amount);const [whole,fraction='']=value.split('.');
 if(fraction.length<=2)return fraction?`${whole}.${fraction.padEnd(2,'0')}`:whole;
 const kept=fraction.slice(0,2),rest=fraction.slice(2);
 let text=`${whole}.${kept}`;
 if(direction==='up'&&/[1-9]/.test(rest)){
  const cents=BigInt(whole+kept)+1n,digits=cents.toString().padStart(3,'0');text=`${digits.slice(0,-2)}.${digits.slice(-2)}`;
 }
 return text.replace(/\.00$/,'');
}
