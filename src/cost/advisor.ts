// Automatic Cost Advisor core. Pure: no VS Code, no storage, no network. It never changes the pricing
// catalog, the demand builder or the optimizer; it only builds their inputs and labels their outputs.
import {compare,subtract} from '../decimal.ts';
import {PLAN_IDS,type BillingProfile,type CostOptimization,type PlanId,type PricingCatalog} from './types.ts';
import {reviewedCatalog} from './catalog.ts';

export type PlanSource='confirmed'|'hint'|'unknown';
/** A hint is never a confirmed plan: the reported limit may include purchased add-on credits. */
export interface PlanHint {plan:PlanId|null; confidence:'moderate'|'none'; reasons:string[]}
export interface AdvisorAnswers {
 plan:PlanId|null;                                   // explicit selection; wins over any hint
 billing:'consumer_prepaid'|'enterprise_postpaid'|null;
 addOns:'none'|'some'|null;                          // null means "not sure", never zero
 addOnCredits:string|null;                           // remaining purchased credits, only with addOns==='some'
}
export const noAnswers:AdvisorAnswers={plan:null,billing:null,addOns:null,addOnCredits:null};
export interface AdvisorObservation {limit:string|null; usage:string|null; asOf:string|null; resetAt:string|null}
export interface AdvisorContext {
 planSource:PlanSource; plan:PlanId|null; billingConfirmed:boolean; addOns:'none'|'some'|'assumed_none'|'unknown';
 assumptions:string[];
}
export type AdviceKind='no_action'|'potential_savings'|'conditional_comparison'|'insufficient_information';
export interface Advice {kind:AdviceKind; reasons:string[]}

/**
 * Exact match against the bundled catalog's nominal plan credits. Always a hint: Kiro's documentation says the
 * IDE display may combine add-on credits with plan credits, and retained add-ons survive a switch to Free, so no
 * limit identifies a plan uniquely until the data contract is verified.
 */
export function planHint(limit:string|null,catalog:PricingCatalog):PlanHint {
 const reasons=['limit_semantics_unverified'];
 if(limit===null)return {plan:null,confidence:'none',reasons:[...reasons,'limit_unavailable']};
 try{
  const match=catalog.plans.find(p=>compare(p.credits,limit)===0);
  if(!match)return {plan:null,confidence:'none',reasons:[...reasons,'no_nominal_match']};
  return {plan:match.id,confidence:'moderate',reasons:[...reasons,'nominal_match_only']};
 }catch{return {plan:null,confidence:'none',reasons:[...reasons,'limit_unavailable']};}
}

const validAnswers=(a:AdvisorAnswers)=>!!a&&(a.plan===null||PLAN_IDS.includes(a.plan))&&[null,'consumer_prepaid','enterprise_postpaid'].includes(a.billing)&&[null,'none','some'].includes(a.addOns);

/**
 * Builds the engine's manual-provenance profile from observed values and explicit answers. Unknown stays unknown;
 * the only hypothetical is "no purchased add-ons" when the user is not sure, and it is returned as an assumption so
 * the result can never be presented as savings or as "no action needed".
 */
export function advisorProfile(o:AdvisorObservation,answers:AdvisorAnswers,hint:PlanHint,catalog:PricingCatalog=reviewedCatalog):{profile:BillingProfile|null;context:AdvisorContext} {
 const assumptions:string[]=[];
 const billingConfirmed=answers.billing!==null;
 const system=answers.billing??'consumer_prepaid';
 if(!billingConfirmed)assumptions.push('billing_assumed_consumer');
 // Free does not exist on Enterprise: such a plan or hint is dropped rather than priced.
 const enterpriseFree=system==='enterprise_postpaid';
 const explicit=answers.plan!==null&&!(enterpriseFree&&answers.plan==='free')?answers.plan:null;
 const hinted=hint.plan!==null&&!(enterpriseFree&&hint.plan==='free')?hint.plan:null;
 if(enterpriseFree&&(answers.plan==='free'||hint.plan==='free'))assumptions.push('free_not_available_on_enterprise');
 const planSource:PlanSource=explicit?'confirmed':hinted?'hint':'unknown';
 const plan=explicit??hinted;
 if(planSource==='hint')assumptions.push('plan_is_hint');
 let addOns:AdvisorContext['addOns']='unknown';
 if(system==='enterprise_postpaid'){assumptions.push('enterprise_inputs_unconfirmed');}
 else if(answers.addOns==='none')addOns='none';
 else if(answers.addOns==='some')addOns='some';
 else {addOns='assumed_none';assumptions.push('add_ons_assumed_none');}
 const context:AdvisorContext={planSource,plan,billingConfirmed,addOns,assumptions};
 if(!validAnswers(answers)||o.asOf===null||o.resetAt===null)return {profile:null,context};
 // Reported remaining credits are the plan remainder only when nothing else can be inside the reported limit:
 // add-ons confirmed or assumed absent, usage within the limit, and a limit equal to the plan's nominal credits.
 let remaining:string|null=null;
 if((addOns==='none'||addOns==='assumed_none')&&o.limit!==null&&o.usage!==null){
  try{
   const r=subtract(o.limit,o.usage);
   if(compare(r,'0')<0)assumptions.push('usage_exceeds_reported_limit');
   else {
    const nominal=plan?catalog.plans.find(p=>p.id===plan)?.credits:undefined;
    if(nominal!==undefined&&compare(nominal,o.limit)!==0)assumptions.push('limit_differs_from_plan_credits');
    else remaining=r;
   }
  }catch{remaining=null;}
 }
 const purchased:BillingProfile['purchased']=addOns==='some'
  ?(answers.addOnCredits!==null?{kind:'known',value:[{remainingCredits:answers.addOnCredits,expiresAt:null,expiryPrecision:'unknown'}]}:{kind:'unknown'})
  :addOns==='unknown'?{kind:'unknown'}:{kind:'known',value:[]};
 const profile:BillingProfile={
  provenance:'manual',confirmedAt:o.asOf,billingSystem:system,market:'commercial',currentPlan:plan,
  allowedPlans:system==='enterprise_postpaid'?PLAN_IDS.filter(id=>id!=='free'):[...PLAN_IDS],
  cohort:'unknown',firstPaidAt:null,promotion:'present_or_unknown',resetAt:o.resetAt,
  planRemaining:remaining!==null?{kind:'known',value:remaining}:{kind:'unknown'},
  cycleUsageForRerating:remaining!==null&&o.usage!==null?{kind:'known',value:o.usage}:{kind:'unknown'},
  priorAddOnConsumption:'present_or_unknown',purchased,availablePackSlots:{kind:'unknown'},
  enterpriseOverage:{enabled:{kind:'unknown'},headroomCredits:{kind:'unknown'}},
 };
 return {profile,context};
}

/**
 * Four outcomes. "No action" and "potential savings" require every input to be explicit (plan and billing chosen by
 * the user, add-on state answered), a supported priced comparison, and no conditional marker from the engine.
 */
export function classifyAdvice(result:CostOptimization|null,context:AdvisorContext):Advice {
 if(!result||result.status==='unavailable'||!result.baselineStrategyId||!result.alternatives.some(a=>a.strategyId!==null))
  return {kind:'insufficient_information',reasons:result?.reasons??['cost_advisor_unavailable']};
 const open=[...context.assumptions];
 // Defence in depth: the context fields themselves must also be explicit, not only the assumption list.
 if(context.planSource!=='confirmed'&&!open.includes('plan_is_hint'))open.push('plan_not_confirmed');
 if(!context.billingConfirmed&&!open.includes('billing_assumed_consumer'))open.push('billing_assumed_consumer');
 if(context.addOns!=='none'&&context.addOns!=='some'&&!open.some(c=>c==='add_ons_assumed_none'||c==='enterprise_inputs_unconfirmed'))open.push('add_ons_assumed_none');
 if(context.addOns==='some'&&!open.includes('add_on_balance_unverified'))open.push('add_on_balance_unverified');
 const conditional=open.length>0||result.status==='conditional'||result.recommendation===null||result.recommendation.kind!=='supported_comparison'||result.reasons.length>0;
 if(conditional)return {kind:'conditional_comparison',reasons:[...open,...result.reasons]};
 const rec=result.recommendation!;
 if(rec.strategyId===result.baselineStrategyId)return {kind:'no_action',reasons:[]};
 const min=result.savingsRange?.minimum.amount;
 if(min!==undefined&&compare(min,'0')>0)return {kind:'potential_savings',reasons:[]};
 return {kind:'conditional_comparison',reasons:['savings_not_established']};
}
