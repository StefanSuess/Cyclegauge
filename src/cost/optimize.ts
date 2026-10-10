import {type CostRequest,type Strategy,type CostOptimization,type CostScenario,type BreakEvenResult,type PlanId,type Rational} from './types.ts';
import {validateCatalog,validInstant} from './catalog.ts';
import {validProfile,utcMonthBoundary} from './demand.ts';
import {simulateStrategy,exactExpenditure,validDemand} from './simulate.ts';
import {decimalToRational as r,rational,addRational as add,subtractRational as sub,multiplyRational as mul,divideRational as div,compareRational as cmp,maxRational as max,ceilToQuantum,formatRational as fmt,ZERO} from './money.ts';
const money=(value:Rational)=>({currency:'USD' as const,amount:fmt(value,18,'floor')});
const unavailableBreak=(reason:string):BreakEvenResult=>({status:'unavailable',reasons:[reason],basis:'single_full_cycle_no_opening_lots',points:[],intervals:[],assumptions:[],evaluatedUsageRange:null});
const consistentDemands=(q:CostRequest)=>{
 const first=q.demands[0];
 if(!q.demands.every(d=>d.source===first.source&&Date.parse(d.anchorAt)===Date.parse(first.anchorAt)&&JSON.stringify(d.assumptions)===JSON.stringify(first.assumptions)&&d.beforeReset.kind===first.beforeReset.kind&&d.futureCycles.every((c,i)=>c.from===first.futureCycles[i].from&&c.to===first.futureCycles[i].to)))return false;
 const low=q.demands.find(d=>d.id==='low')!,base=q.demands.find(d=>d.id==='base')!,high=q.demands.find(d=>d.id==='high')!;
 return base.futureCycles.every((c,i)=>cmp(low.futureCycles[i].credits,c.credits)<=0&&cmp(c.credits,high.futureCycles[i].credits)<=0)&& (base.beforeReset.kind==='unknown'||low.beforeReset.kind==='known'&&high.beforeReset.kind==='known'&&cmp(low.beforeReset.value,base.beforeReset.value)<=0&&cmp(base.beforeReset.value,high.beforeReset.value)<=0);
};
const validRequest=(q:CostRequest)=>!!q&&validInstant(q.now)&&[1,3,6].includes(q.horizonMonths)&&validProfile(q.profile)&&Array.isArray(q.demands)&&q.demands.length===3&&new Set(q.demands.map(d=>d.id)).size===3&&q.demands.every(d=>validDemand(d,q.horizonMonths))&&consistentDemands(q);
const publicStrategy=(plan:PlanId,timing:Strategy['timing'],extras:Strategy['extras']='as_needed'):Strategy=>({id:`${plan}_${timing}_${extras}`,targetPlan:plan,timing,extras});
function candidates(q:CostRequest):Strategy[]{
 const p=q.profile,standalone=q.demands[0].assumptions.includes('standalone_comparison'),menu:Strategy[]=[];
 for(const plan of p.allowedPlans){
  if(p.billingSystem==='enterprise_postpaid'&&plan==='free')continue;
  if(standalone){menu.push(publicStrategy(plan,'next_reset'));continue;}
  if(plan===p.currentPlan){menu.push(publicStrategy(plan,'keep'),publicStrategy(plan,'keep','none'));continue;}
  menu.push(publicStrategy(plan,'next_reset'));
  const current=q.catalog.plans.find(x=>x.id===p.currentPlan),target=q.catalog.plans.find(x=>x.id===plan)!;
  if(current&&cmp(r(target.fee),r(current.fee))>0&&Date.parse(q.demands[0].anchorAt)<Date.parse(q.demands[0].futureCycles[0].from))menu.push(publicStrategy(plan,'now'),publicStrategy(plan,'now_then_revert_at_reset'));
 }
 return menu;
}
function total(s:CostScenario,standalone:boolean):Rational|null {
 if(s.status==='unavailable'||s.future.feasible!==true||!standalone&&s.bridge.feasible!==true)return null;
 const future=exactExpenditure(s.future),bridge=standalone?ZERO:exactExpenditure(s.bridge);
 return future&&bridge?add(future,bridge):null;
}
function preference(s:Strategy){return s.timing==='keep'?0:s.timing==='now_then_revert_at_reset'?2:1;}

export function optimizeCosts(q:CostRequest):CostOptimization {
 const output:CostOptimization={schemaVersion:1,status:'unavailable',catalogVersion:null,reasons:[],scenarios:[],baselineStrategyId:null,recommendation:null,alternatives:[],savings:[],savingsRange:null,breakEven:unavailableBreak('invalid_cost_input')};
 try{
  if(!validRequest(q))return {...output,reasons:['invalid_cost_input']};
  const validation=validateCatalog(q.catalog,q.now);if(!validation.catalog)return {...output,reasons:['invalid_catalog']};
  // Use only the catalog's allowlisted projection; no raw request labels propagate.
  q={...q,catalog:validation.catalog};output.catalogVersion=q.catalog.version;
  const standalone=q.demands[0].assumptions.includes('standalone_comparison'),menu=candidates(q);
  output.baselineStrategyId=standalone?null:menu.find(s=>s.timing==='keep'&&s.extras==='as_needed')?.id??null;
  const winners:CostScenario[]=[];let competitorUnknown=false;
  for(const d of q.demands){
   const results=menu.map(s=>simulateStrategy(q,s,d));output.scenarios.push(...results);
   // Unknown capacity/cost cannot be treated as either zero or proven dominated.
   const unknown=results.some(s=>s.status!=='unavailable'&&(s.future.feasible===null||!standalone&&s.bridge.feasible===null)||s.status==='unavailable'&&s.reasons.some(x=>['scenario_limit_exceeded','mid_cycle_price_change_unresolved','billing_profile_unknown_or_unsupported'].includes(x)));
   competitorUnknown||=unknown;
   const ranked=results.filter(s=>total(s,standalone)!==null).sort((a,b)=>cmp(total(a,standalone)!,total(b,standalone)!)||preference(a.strategy)-preference(b.strategy)||a.strategy.id.localeCompare(b.strategy.id));
   const winner=ranked[0];if(winner)winners.push(winner);
   output.alternatives.push({demandId:d.id,strategyId:winner?.strategy.id??null,status:!winner?'unavailable':unknown||winner.status==='conditional'?'conditional':'available'});
   const baseline=results.find(s=>s.strategy.id===output.baselineStrategyId);
   for(const candidate of results){
    const feasible=baseline&&total(baseline,false)!==null&&total(candidate,false)!==null;
    output.savings.push({strategyId:candidate.strategy.id,demandId:d.id,
     bridge:feasible?money(sub(exactExpenditure(baseline.bridge)!,exactExpenditure(candidate.bridge)!)):null,
     future:feasible?money(sub(exactExpenditure(baseline.future)!,exactExpenditure(candidate.future)!)):null});
   }
  }
  if(competitorUnknown)output.reasons.push('competitor_cost_unknown');
  if(standalone||q.profile.currentPlan===null)output.reasons.push('personalized_baseline_unavailable');
  const sameWinner=winners.length===3&&new Set(winners.map(s=>s.strategy.id)).size===1;
  if(winners.length===3&&!sameWinner)output.reasons.push('sensitivity_changes_winner');
  if(sameWinner&&!competitorUnknown&&!standalone&&output.baselineStrategyId){
   const conditional=winners.some(s=>s.status==='conditional')||q.horizonMonths>1;
   output.recommendation={strategyId:winners[0].strategy.id,demandIds:winners.map(s=>s.demandId),kind:conditional?'conditional_estimate':'supported_comparison'};
  }
  const spreads=winners.flatMap(w=>{const baseline=output.scenarios.find(s=>s.demandId===w.demandId&&s.strategy.id===output.baselineStrategyId);return baseline&&total(baseline,false)!==null&&total(w,false)!==null?[sub(total(baseline,false)!,total(w,false)!)]:[];});
  if(spreads.length===3){spreads.sort(cmp);output.savingsRange={minimum:money(spreads[0]),maximum:money(spreads.at(-1)!)};}
  if(!winners.length)output.reasons.push('no_feasible_comparison');
  output.breakEven=findAnalyticalBreakEven(q);
  output.status=winners.length?(output.reasons.length||output.scenarios.some(s=>s.status==='conditional')||q.horizonMonths>1?'conditional':'available'):'unavailable';
  return output;
 }catch{return {...output,status:'unavailable',reasons:['invalid_cost_input'],recommendation:null};}
}

// Cheap conditional reference only. This API never enumerates purchase breakpoints.
export function findAnalyticalBreakEven(q:CostRequest):BreakEvenResult {
 try {
  if(!validRequest(q))return unavailableBreak('invalid_cost_input');
  const validation=validateCatalog(q.catalog,q.now);if(!validation.catalog)return unavailableBreak('invalid_catalog');
  const c=validation.catalog,p=q.profile,standalone=q.demands[0].assumptions.includes('standalone_comparison');
  const system=standalone?(q.demands[0].assumptions.includes('standalone_consumer_prepaid')?'consumer_prepaid':'enterprise_postpaid'):p.billingSystem;
  if(system==='unknown')return unavailableBreak('billing_system_unknown');
  if(c.changes.length||!standalone&&(p.purchased.kind!=='known'||p.purchased.value.length||p.promotion!=='none_confirmed'||p.cohort!=='established_paid'||p.market!=='commercial'))return unavailableBreak('break_even_complex_scenario');
  const paid=c.plans.filter(x=>p.allowedPlans.includes(x.id)&&x.id!=='free').sort((a,b)=>cmp(r(a.credits),r(b.credits)));
  const points:BreakEvenResult['points']=[];
  for(let i=1;i<paid.length;i++){
   const a=paid[i-1],b=paid[i];
   const credit=add(r(a.credits),div(sub(r(b.fee),r(a.fee)),r(system==='enterprise_postpaid'?c.enterprise.pricePerCredit:c.consumer.pricePerCredit)));
   if(cmp(credit,r(a.credits))>=0&&cmp(credit,r(b.credits))<=0)points.push({plans:[a.id,b.id],credits:fmt(credit,18,'floor')});
  }
  return {status:'conditional',reasons:['exact_break_even_not_requested',...validation.reasons],basis:'conditional_linear_reference',points,intervals:[],assumptions:['continuous_extras_not_verified_purchases','single_steady_full_cycle','no_opening_inventory','pre_tax_list_prices','no_promotion','no_slot_or_quota_limit'],evaluatedUsageRange:null};
 }catch{return unavailableBreak('invalid_cost_input');}
}

// Small bounded cache of public analytical results, never account/profile identities.
// Each returned result is copied so a caller cannot mutate another calculation.
const breakCache=new Map<string,BreakEvenResult>();
export function findBreakEven(q:CostRequest):BreakEvenResult {
 try{
  if(!validRequest(q))return unavailableBreak('invalid_cost_input');
  const validation=validateCatalog(q.catalog,q.now);if(!validation.catalog)return unavailableBreak('invalid_catalog');q={...q,catalog:validation.catalog};
  const p=q.profile,c=q.catalog;
  if(p.billingSystem==='unknown')return unavailableBreak('billing_system_unknown');
  if(q.horizonMonths!==1||p.purchased.kind!=='known'||p.purchased.value.length||p.cohort!=='established_paid'||p.promotion!=='none_confirmed'||p.market!=='commercial'||!utcMonthBoundary(q.demands[0].anchorAt)||Date.parse(q.demands[0].anchorAt)!==Date.parse(q.demands[0].futureCycles[0].from)||c.changes.length)return unavailableBreak('break_even_complex_scenario');
  const effectiveRules=['B1','B2','B4'].every(id=>{const rule=c.rules.find(x=>x.id===id)!;return rule.status==='verified'&&(!rule.effectiveFrom||Date.parse(q.demands[0].futureCycles[0].from)>=Date.parse(rule.effectiveFrom))&&(!rule.effectiveTo||Date.parse(q.demands[0].futureCycles[0].to)<=Date.parse(rule.effectiveTo));});
  if(!effectiveRules||p.billingSystem!=='consumer_prepaid'||c.consumer.purchaseStepCredits===null||c.consumer.moneyRounding===null||p.availablePackSlots.kind!=='known'){
   const paid=c.plans.filter(x=>p.allowedPlans.includes(x.id)&&x.id!=='free').sort((a,b)=>cmp(r(a.credits),r(b.credits)));
   const points:BreakEvenResult['points']=[];
   for(let i=1;i<paid.length;i++){const a=paid[i-1],b=paid[i];const credit=add(r(a.credits),div(sub(r(b.fee),r(a.fee)),r(p.billingSystem==='enterprise_postpaid'?c.enterprise.pricePerCredit:c.consumer.pricePerCredit)));
    if(cmp(credit,r(b.credits))<=0)points.push({plans:[a.id,b.id],credits:fmt(credit,18,'floor')});}
   return {status:'conditional',reasons:['exact_purchase_rules_unavailable'],basis:'conditional_linear_reference',points,intervals:[],assumptions:['continuous_extras_not_verified_purchases','no_opening_inventory','pre_tax_list_prices','no_promotion','no_slot_or_quota_limit'],evaluatedUsageRange:null};
  }
  const slots=p.availablePackSlots.value,step=r(c.consumer.purchaseStepCredits),maximum=r(c.consumer.maximumCredits);
  const maximumPack=mul(rational(div(maximum,step).numerator/div(maximum,step).denominator),step);
  const count=div(mul(maximumPack,r(String(slots))),step);
  if(cmp(count,r('100000'))>0)return unavailableBreak('break_even_limit_exceeded');
  const key=JSON.stringify([c,q.now,p.allowedPlans,slots,q.demands[0].futureCycles[0].from,q.demands[0].futureCycles[0].to]);
  const cached=breakCache.get(key);if(cached)return structuredClone(cached);
  const plans=c.plans.filter(x=>p.allowedPlans.includes(x.id));
  const values=new Map<string,Rational>();const insert=(v:Rational)=>values.set(`${v.numerator}/${v.denominator}`,v);
  insert(ZERO);
  for(const plan of plans){
   const allowance=r(plan.credits);insert(allowance);if(plan.id==='free')continue;
   const minPack=ceilToQuantum(r(c.consumer.minimumCredits),step);
   for(let k=0;k<=Number(count.numerator/count.denominator);k++){
    const deficit=mul(step,rational(BigInt(k)));
    if(cmp(deficit,minPack)>=0)insert(add(allowance,deficit));
    if(values.size>100000)return unavailableBreak('break_even_limit_exceeded');
   }
  }
  const boundaries=[...values.values()].sort(cmp);
  const output:BreakEvenResult={status:c.evidence==='hypothetical'||validation.status==='conditional'?'conditional':'available',reasons:c.evidence==='hypothetical'?['hypothetical_catalog']:validation.reasons,basis:'single_full_cycle_no_opening_lots',points:[],intervals:[],assumptions:['single_steady_full_cycle','no_opening_inventory','pre_tax_usd','promotions_excluded','evaluated_fixed_tiers_only'],evaluatedUsageRange:null};
  const evaluate=(credits:Rational):PlanId[]=>{
   const demand={...q.demands[1],beforeReset:{kind:'known' as const,value:ZERO},futureCycles:[{...q.demands[1].futureCycles[0],credits}]};
   let lowest:Rational|null=null,ties:PlanId[]=[];
   for(const plan of plans){const s=simulateStrategy(q,publicStrategy(plan.id,'next_reset'),demand);const value=exactExpenditure(s.future);if(s.status==='unavailable'||s.future.feasible!==true||!value)continue;
    const order=lowest?cmp(value,lowest):-1;if(order<0){lowest=value;ties=[plan.id];}else if(order===0)ties.push(plan.id);
   }return ties;
  };
  const append=(lower:Rational,upper:Rational,lowerInclusive:boolean,upperInclusive:boolean,winners:PlanId[])=>{
   if(!winners.length)return;
   const lo=fmt(lower,18,'floor'),hi=fmt(upper,18,'floor'),previous=output.intervals.at(-1);
   if(previous&&previous.upper===lo&&JSON.stringify(previous.winningPlans)===JSON.stringify(winners)&&(previous.upperInclusive||lowerInclusive)){previous.upper=hi;previous.upperInclusive=upperInclusive;}
   else output.intervals.push({lower:lo,upper:hi,lowerInclusive,upperInclusive,tiedPlans:winners.length>1?[...winners]:[],winningPlans:[...winners]});
  };
  for(let i=0;i<boundaries.length;i++){
   const point=boundaries[i],winners=evaluate(point);append(point,point,true,true,winners);
   if(i+1<boundaries.length){const next=boundaries[i+1];append(point,next,false,false,evaluate(div(add(point,next),r('2'))));}
  }
  for(const interval of output.intervals)if(interval.tiedPlans.length>1)output.points.push({plans:[...interval.tiedPlans],credits:interval.upper});
  output.evaluatedUsageRange={lower:'0',upper:fmt(boundaries.at(-1)!,18,'floor')};
  if(c.consumer.depletedSlotRelease===true){output.status='conditional';output.reasons.push('break_even_bounded_domain');}
  if(breakCache.size>=16)breakCache.delete(breakCache.keys().next().value!);breakCache.set(key,structuredClone(output));
  return output;
 }catch{return unavailableBreak('invalid_cost_input');}
}
