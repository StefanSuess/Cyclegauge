import {PLAN_IDS,type CostRequest,type Strategy,type DemandScenario,type CostScenario,type CostBreakdown,type Rational,type PricingCatalog,type PlanId} from './types.ts';
import {validateCatalog,validInstant} from './catalog.ts';
import {validProfile,utcMonthBoundary,addUtcMonths} from './demand.ts';
import {decimalToRational as r,rational,addRational as add,subtractRational as sub,multiplyRational as mul,divideRational as div,compareRational as cmp,minRational as min,maxRational as max,ceilToQuantum,formatRational as fmt,ZERO} from './money.ts';

// Exact decision data are transient and cannot accidentally enter JSON output.
const exact = new WeakMap<CostBreakdown,{total:Rational|null;subscription:Rational;addOn:Rational;overage:Rational}>();
export const exactExpenditure=(b:CostBreakdown):Rational|null=>exact.get(b)?.total??null;
const amount=(x:Rational)=>fmt(x,18,'floor');
const money=(x:Rational)=>({currency:'USD' as const,amount:amount(x)});
const sum=(xs:Rational[])=>xs.reduce(add,ZERO);
const ms=(at:string)=>rational(BigInt(Date.parse(at)));
const iso=(t:Rational)=>new Date(Number(t.numerator/t.denominator)).toISOString();
const positive=(x:Rational)=>cmp(x,ZERO)>0;
const codes = new Set(['constant_within_cycle_demand','prices_assumed_unchanged','sensitivity_not_confidence','manual_hypothetical_demand','repeat_manual_cycle_total','standalone_comparison','standalone_consumer_prepaid','standalone_enterprise_postpaid','standalone_zero_opening_inventory','promotions_excluded','standalone_utc_calendar_schedule','constant_future_net_rate','net_changes_not_gross_billable_usage','limited_history','long_history_future_rate','short_window_long_horizon','forecast_balance_anchor_differs','inventory_anchor_mismatch','inventory_stale','standalone_hypothetical']);
export function validDemand(d:DemandScenario,horizon:number):boolean {
 try {
  const nonnegative=(x:Rational)=>cmp(x,ZERO)>=0;
  return !!d&&['low','base','high'].includes(d.id)&&['manual','forecast_regular','forecast_provisional'].includes(d.source)&&validInstant(d.anchorAt)&&d.withinCycle==='constant_rate_assumption'&&
   Array.isArray(d.assumptions)&&d.assumptions.length<=32&&d.assumptions.every(s=>codes.has(s))&&
   (d.beforeReset.kind==='unknown'||d.beforeReset.kind==='known'&&nonnegative(d.beforeReset.value))&&
   Array.isArray(d.futureCycles)&&d.futureCycles.length===horizon&&d.futureCycles.every((c,i)=>validInstant(c.from)&&validInstant(c.to)&&utcMonthBoundary(c.from)&&c.to===addUtcMonths(c.from,1)&&nonnegative(c.credits)&&Date.parse(c.from)>=Date.parse(d.anchorAt)&&(i===0||c.from===d.futureCycles[i-1].to));
 }catch{return false;}
}
export function planAt(c:PricingCatalog,id:PlanId,at:string){
 const plan={...c.plans.find(p=>p.id===id)!};
 for(const change of [...c.changes].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)))if(change.planId===id&&Date.parse(change.at)<=Date.parse(at)){plan.fee=change.fee;plan.credits=change.credits;}
 return plan;
}
function empty(from:string,to:string):CostBreakdown {
 return {from,to,newSubscriptionSpend:null,newAddOnSpend:null,newOverageLiability:null,totalNewExpenditure:null,additionalCreditsNeeded:null,unmetDemandCredits:null,openingPurchasedCredits:null,existingCreditsConsumed:null,expiredPurchasedCredits:null,closingPurchasedCredits:null,purchases:[],purchasedCreditsConsumed:null,newPurchasedCredits:null,planCreditsConsumed:null,lowerBoundNewAddOnSpend:null,feasible:null};
}
interface Lot {remaining:Rational; expires:Rational; opening:boolean}
interface State {lots:Lot[]|null; slots:number|null; slotReleaseUncertain:boolean}
interface Period {from:string;to:string;demand:Rational;planCredits:Rational;fee:Rational;plan:PlanId}

export function simulateStrategy(request:CostRequest,strategyInput:Strategy,d:DemandScenario):CostScenario {
 // Validate before copying any caller-controlled label into the public result.
 const safeStrategy:Strategy={id:'invalid_strategy',targetPlan:'free',timing:'keep',extras:'none'};
 let result:CostScenario={schemaVersion:1,strategy:safeStrategy,demandId:['low','base','high'].includes(d?.id)?d.id:'base',status:'unavailable',reasons:[],effectiveAt:null,bridge:empty('',''),future:empty('',''),assumptions:[]};
 const reason=(code:string)=>{if(!result.reasons.includes(code))result.reasons.push(code);};
 const stop=(code:string)=>{reason(code);result.status='unavailable';return result;};
 try {
  if(!request||!validInstant(request.now)||![1,3,6].includes(request.horizonMonths)||!validProfile(request.profile)||!validDemand(d,request.horizonMonths)||Date.parse(d.anchorAt)>Date.parse(request.now)||Date.parse(request.profile.confirmedAt)>Date.parse(request.now))return stop('invalid_cost_input');
  const validation=validateCatalog(request.catalog,request.now);if(!validation.catalog)return stop('invalid_catalog');const c=validation.catalog,p=request.profile;
  if(!strategyInput||!PLAN_IDS.includes(strategyInput.targetPlan)||!['keep','now','next_reset','now_then_revert_at_reset'].includes(strategyInput.timing)||!['as_needed','none'].includes(strategyInput.extras))return stop('invalid_strategy');
  const s:Strategy={id:`${strategyInput.targetPlan}_${strategyInput.timing}_${strategyInput.extras}`,targetPlan:strategyInput.targetPlan,timing:strategyInput.timing,extras:strategyInput.extras};
  result.strategy=s;result.assumptions=[...d.assumptions,'pre_tax_usd','modeled_expenditure_not_invoice','amounts_displayed_at_18_decimals'];
  if(d.source==='manual')reason('manual_hypothetical_demand');
  if(request.horizonMonths>1)reason('sustained_usage_scenario');
  validation.reasons.forEach(reason);if(c.evidence==='hypothetical')reason('hypothetical_catalog');
  const standalone=d.assumptions.includes('standalone_comparison');
  const system=standalone?(d.assumptions.includes('standalone_consumer_prepaid')?'consumer_prepaid':'enterprise_postpaid'):p.billingSystem;
  if(!standalone&&(p.market!=='commercial'||system==='unknown'))return stop('billing_profile_unknown_or_unsupported');
  if(!p.allowedPlans.includes(s.targetPlan)||system==='enterprise_postpaid'&&s.targetPlan==='free')return stop('plan_not_eligible');
  if(!standalone&&s.timing==='keep'&&s.targetPlan!==p.currentPlan)return stop('invalid_strategy');
  if(standalone&&s.timing!=='next_reset')return stop('standalone_transition_unavailable');
  const first=d.futureCycles[0].from,last=d.futureCycles.at(-1)!.to;
  if(!standalone&&p.resetAt===null)return stop('reset_unknown');
  if(Date.parse(first)<Date.parse(request.now))return stop('reset_elapsed');
  if(p.resetAt!==null&&Date.parse(p.resetAt)!==Date.parse(first))return stop('reset_conflict');
  result.bridge=empty(d.anchorAt,first);result.future=empty(first,last);
  result.effectiveAt=s.timing==='keep'?null:s.timing==='next_reset'?first:d.anchorAt;
  if(!standalone&&p.currentPlan===null)return stop('current_plan_unknown');
  if(Date.parse(p.confirmedAt)!==Date.parse(d.anchorAt))reason('inventory_anchor_mismatch');
  if(Date.parse(request.now)-Date.parse(p.confirmedAt)>86400000)reason('inventory_stale');
  const needsRule=(id:string,from:string,to:string):boolean=>{
   const rule=c.rules.find(x=>x.id===id)!;
   if(rule.status!=='verified'){reason('billing_rule_unknown');return false;}
   if(rule.effectiveFrom&&Date.parse(from)<Date.parse(rule.effectiveFrom)||rule.effectiveTo&&Date.parse(to)>Date.parse(rule.effectiveTo)){reason('rule_outside_effective_period');return false;}return true;
  };
  if(!needsRule('B4',d.anchorAt,last))reason('schedule_rule_conditional');
  if(c.changes.some(x=>Date.parse(x.at)>Date.parse(d.anchorAt)&&Date.parse(x.at)<Date.parse(last)&&!utcMonthBoundary(x.at)))return stop('mid_cycle_price_change_unresolved');
  if(p.promotion!=='none_confirmed'||p.cohort!=='established_paid'){reason('cohort_or_promotion_conditional');if(!result.assumptions.includes('promotions_excluded'))result.assumptions.push('promotions_excluded');}
  if(standalone)reason('standalone_hypothetical');
  let state:State={lots:standalone?[]:p.purchased.kind==='known'?p.purchased.value.map(l=>({remaining:r(l.remainingCredits),expires:l.expiryPrecision==='instant'&&l.expiresAt?ms(l.expiresAt):rational(-1n),opening:true})):null,
   slots:standalone?null:p.availablePackSlots.kind==='known'?p.availablePackSlots.value:null,slotReleaseUncertain:false};
  if(!standalone&&p.purchased.kind==='known'&&p.purchased.value.some(l=>l.expiryPrecision!=='instant'&&positive(r(l.remainingCredits)))){state.lots=null;reason('lot_expiry_uncertain');}
  if(!standalone&&p.currentPlan==='free'&&p.cohort!=='returning_free'&&state.lots?.some(l=>positive(l.remaining))){state.lots=null;reason('free_retained_lot_eligibility_unknown');}
  if(system==='enterprise_postpaid'&&state.lots?.some(l=>positive(l.remaining)))return stop('billing_system_inventory_mismatch');
  let events=0;
  const run=(periods:Period[],output:CostBreakdown):boolean=>{
   let subscription=sum(periods.map(x=>x.fee)),addOn=ZERO,overage=ZERO,needed=ZERO,unmet=ZERO,expired=ZERO,consumed=ZERO,openingConsumed=ZERO,newCredits=ZERO,planConsumed=ZERO;
   const opening=state.lots?sum(state.lots.map(l=>l.remaining)):null;
   state.lots?.forEach(l=>l.opening=true);
   let uncertain=state.lots===null;
   if(state.lots?.some(l=>positive(l.remaining))&&periods.length){
    if(!needsRule('B2',output.from,output.to)||periods.some(period=>period.plan==='free')&&!needsRule('B6',output.from,output.to)){uncertain=true;state.lots=null;}
   }
   const release=()=>{if(c.consumer.depletedSlotRelease===true&&state.slots!==null)state.slots=Math.min(5,state.slots+1);else if(c.consumer.depletedSlotRelease===null)state.slotReleaseUncertain=true;};
   const expire=(at:Rational)=>{
    if(!state.lots)return;
    const removed=state.lots.filter(l=>cmp(l.expires,at)<=0);expired=add(expired,sum(removed.map(l=>l.remaining)));removed.forEach(release);
    state.lots=state.lots.filter(l=>cmp(l.expires,at)>0);
   };
   for(const period of periods){
    let plan=period.planCredits;const end=ms(period.to),start=ms(period.from);const rate=cmp(end,start)>0?div(period.demand,sub(end,start)):ZERO;
    let cursor=start,headroom=p.enterpriseOverage.headroomCredits.kind==='known'?r(p.enterpriseOverage.headroomCredits.value):null;
    if(system==='enterprise_postpaid'&&periods.length>1){reason('future_shared_headroom_assumed');result.assumptions.push('explicit_headroom_repeated_per_cycle');}
    if(uncertain)continue;
    while(cmp(cursor,end)<0){
     if(++events>100000)throw Error('scenario_limit_exceeded');expire(cursor);
     const nextExpiry=state.lots!.filter(l=>cmp(l.expires,cursor)>0&&cmp(l.expires,end)<0).sort((a,b)=>cmp(a.expires,b.expires))[0]?.expires;
     const boundary=nextExpiry??end;let left=mul(rate,sub(boundary,cursor));
     // Instant expiry happens before demand at its instant. No interpolation of observations.
     while(positive(left)){
      if(++events>100000)throw Error('scenario_limit_exceeded');
      if(positive(plan)){const use=min(plan,left);plan=sub(plan,use);left=sub(left,use);planConsumed=add(planConsumed,use);cursor=add(cursor,div(use,rate));continue;}
      const lot=state.lots!.filter(l=>positive(l.remaining)&&cmp(l.expires,cursor)>0).sort((a,b)=>cmp(a.expires,b.expires))[0];
      if(lot){const use=min(lot.remaining,left);lot.remaining=sub(lot.remaining,use);left=sub(left,use);consumed=add(consumed,use);if(lot.opening)openingConsumed=add(openingConsumed,use);cursor=add(cursor,div(use,rate));
       if(!positive(lot.remaining)){state.lots=state.lots!.filter(l=>l!==lot);release();}continue;}
      needed=add(needed,left);
      if(s.extras==='none'||period.plan==='free'){unmet=add(unmet,left);left=ZERO;break;}
      if(system==='enterprise_postpaid'){
       if(!needsRule('B8',period.from,period.to)||!needsRule('B9',period.from,period.to)||p.enterpriseOverage.enabled.kind==='unknown'||p.enterpriseOverage.enabled.value&&headroom===null){reason('enterprise_overage_unknown');uncertain=true;left=ZERO;break;}
       const use=p.enterpriseOverage.enabled.value?min(headroom!,left):ZERO;headroom=headroom?sub(headroom,use):null;overage=add(overage,mul(use,r(c.enterprise.pricePerCredit)));unmet=add(unmet,sub(left,use));left=ZERO;break;
      }
      if(!needsRule('B1',period.from,period.to)||!needsRule('B2',period.from,period.to)){uncertain=true;left=ZERO;break;}
      if(state.slots===null){reason('pack_slots_unknown');uncertain=true;left=ZERO;break;}
      if(state.slots===0){if(state.slotReleaseUncertain){reason('pack_slot_release_unknown');uncertain=true;}else{reason('pack_slots_exhausted');unmet=add(unmet,left);}left=ZERO;break;}
      const packRules=c.consumer;
      if(packRules.purchaseStepCredits===null){reason('purchase_step_unknown');
       if(cmp(left,r(packRules.maximumCredits))<=0)output.lowerBoundNewAddOnSpend=money(mul(max(left,r(packRules.minimumCredits)),r(packRules.pricePerCredit)));
       uncertain=true;left=ZERO;break;
      }
      const q=r(packRules.purchaseStepCredits),maxPack=mul(rational(div(r(packRules.maximumCredits),q).numerator/div(r(packRules.maximumCredits),q).denominator),q);
      if(!positive(maxPack)||cmp(maxPack,ceilToQuantum(r(packRules.minimumCredits),q))<0){reason('purchase_quantum_incompatible');uncertain=true;left=ZERO;break;}
      if(cmp(div(left,maxPack),r('100000'))>0)throw Error('scenario_limit_exceeded');
      const quantity=min(maxPack,ceilToQuantum(max(left,r(packRules.minimumCredits)),q)),spend=mul(quantity,r(packRules.pricePerCredit));
      // `needed` counts demand beyond plan/opening lots once, not again after each pack.
      needed=sub(needed,left);
      const modeledAt=iso(cursor),fraction=sub(cursor,ms(modeledAt));
      state.lots!.push({remaining:quantity,expires:add(ms(addUtcMonths(modeledAt,12)),fraction),opening:false});state.slots--;
      newCredits=add(newCredits,quantity);addOn=add(addOn,spend);output.purchases.push({modeledAt,credits:amount(quantity),spend:money(spend)});
      if(packRules.moneyRounding===null)reason('invoice_rounding_unknown');
     }
     if(uncertain)break;cursor=boundary;
    }
    // End-exclusive: expiry at reset is accounted in the following period.
   }
   output.newSubscriptionSpend=money(subscription);output.newAddOnSpend=uncertain?null:money(addOn);output.newOverageLiability=uncertain?null:money(overage);
   output.openingPurchasedCredits=opening?amount(opening):null;
   if(uncertain){state.lots=null;output.feasible=null;exact.set(output,{total:null,subscription,addOn,overage});return false;}
   // Deficit includes new-purchased consumption and overage as well as unmet demand.
   needed=add(sub(consumed,openingConsumed),add(positive(overage)?div(overage,r(c.enterprise.pricePerCredit)):ZERO,unmet));
   output.totalNewExpenditure=money(add(add(subscription,addOn),overage));output.additionalCreditsNeeded=amount(needed);output.unmetDemandCredits=amount(unmet);
   output.existingCreditsConsumed=amount(openingConsumed);output.expiredPurchasedCredits=amount(expired);output.closingPurchasedCredits=amount(sum(state.lots!.map(l=>l.remaining)));
   output.purchasedCreditsConsumed=amount(consumed);output.newPurchasedCredits=amount(newCredits);output.planCreditsConsumed=amount(planConsumed);output.feasible=!positive(unmet);
   exact.set(output,{total:add(add(subscription,addOn),overage),subscription,addOn,overage});return true;
  };
  const current=p.currentPlan??s.targetPlan;const immediate=s.timing==='now'||s.timing==='now_then_revert_at_reset';
  let bridgePlan=current,bridgeBalance=p.planRemaining.kind==='known'?r(p.planRemaining.value):null,bridgeFee=ZERO,bridgeKnown=true;
  if(immediate){
   const old=planAt(c,current,d.anchorAt),target=planAt(c,s.targetPlan,d.anchorAt);
   if(cmp(r(target.fee),r(old.fee))<=0)return stop('immediate_downgrade_unsupported');
   bridgePlan=s.targetPlan;
   if(p.cohort!=='established_paid'||p.promotion!=='none_confirmed'||p.cycleUsageForRerating.kind!=='known'||!needsRule(system==='consumer_prepaid'?'B3':'B7',d.anchorAt,first)){reason('upgrade_charge_or_rerating_unknown');bridgeKnown=false;}
   else{bridgeFee=sub(r(target.fee),r(old.fee));bridgeBalance=max(sub(r(target.credits),r(p.cycleUsageForRerating.value)),ZERO);}
   if(system==='consumer_prepaid'&&p.priorAddOnConsumption!=='none_confirmed'){reason('consumed_pack_restoration_unknown');bridgeKnown=false;}
  }
  if(s.timing==='next_reset'||s.timing==='now_then_revert_at_reset')needsRule(system==='consumer_prepaid'?'B5':'B7',first,last);
  if(!standalone&&Date.parse(first)>Date.parse(d.anchorAt)){
   if(!bridgeKnown||d.beforeReset.kind==='unknown'||bridgeBalance===null||result.reasons.includes('inventory_anchor_mismatch')){reason('bridge_inventory_unknown');state.lots=null;}
   else run([{from:d.anchorAt,to:first,demand:d.beforeReset.value,planCredits:bridgeBalance,fee:bridgeFee,plan:bridgePlan}],result.bridge);
  }else if(!standalone)run([],result.bridge);
  else {reason('standalone_bridge_excluded');state={lots:[],slots:null,slotReleaseUncertain:false};}
  const futurePlan=s.timing==='now_then_revert_at_reset'?current:s.targetPlan;
  const futurePeriods=d.futureCycles.map(period=>{const price=planAt(c,futurePlan,period.from);return {...period,demand:period.credits,planCredits:r(price.credits),fee:r(price.fee),plan:futurePlan};});
  run(futurePeriods,result.future);
  if(result.bridge.feasible===false||result.future.feasible===false)reason('unmet_demand');
  result.assumptions=[...new Set(result.assumptions)];result.status=result.reasons.length?'conditional':'available';
  return result;
 }catch(error){return stop(error instanceof Error&&error.message==='scenario_limit_exceeded'?'scenario_limit_exceeded':'invalid_cost_input');}
}
