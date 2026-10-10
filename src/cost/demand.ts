import {forecast as qualify, type ForecastResult, type ForecastEstimate} from '../forecast.ts';
import type {AccountHistory} from '../history.ts';
import {PLAN_IDS, type BillingProfile, type DemandResult, type ManualDemand, type Rational, type DemandScenario} from './types.ts';
import {validAmount,validInstant} from './catalog.ts';
import {decimalToRational as r,rational,multiplyRational as mul,subtractRational as sub,divideRational as div,compareRational as cmp,ZERO} from './money.ts';

export function utcMonthBoundary(at:string):boolean {
 const d=new Date(at);return d.getUTCDate()===1&&d.getUTCHours()===0&&d.getUTCMinutes()===0&&d.getUTCSeconds()===0&&d.getUTCMilliseconds()===0;
}
// Preserve original day/time when adding months; clamp a leap-day lot expiry.
export function addUtcMonths(at:string,months:number):string {
 const d=new Date(at),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
 d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString();
}
export function validProfile(p:BillingProfile):boolean {
 try {
  const known=(k:any,check:(v:any)=>boolean)=>k&& (k.kind==='unknown'||k.kind==='known'&&check(k.value));
  return !!p&&p.provenance==='manual'&&validInstant(p.confirmedAt)&&['consumer_prepaid','enterprise_postpaid','unknown'].includes(p.billingSystem)&&['commercial','govcloud','custom','unknown'].includes(p.market)&&
   (p.currentPlan===null||PLAN_IDS.includes(p.currentPlan))&&Array.isArray(p.allowedPlans)&&p.allowedPlans.length>0&&p.allowedPlans.length<=5&&new Set(p.allowedPlans).size===p.allowedPlans.length&&p.allowedPlans.every(x=>PLAN_IDS.includes(x))&&
   ['established_paid','first_paid_month','never_paid','returning_free','unknown'].includes(p.cohort)&&(p.firstPaidAt===null||validInstant(p.firstPaidAt)&&Date.parse(p.firstPaidAt)<=Date.parse(p.confirmedAt))&&['none_confirmed','present_or_unknown'].includes(p.promotion)&&
   (p.resetAt===null||validInstant(p.resetAt))&&known(p.planRemaining,validAmount)&&known(p.cycleUsageForRerating,validAmount)&&['none_confirmed','present_or_unknown'].includes(p.priorAddOnConsumption)&&
   known(p.purchased,(lots:any)=>Array.isArray(lots)&&lots.length<=5&&lots.every(l=>l&&validAmount(l.remainingCredits)&&['instant','day','unknown'].includes(l.expiryPrecision)&&(l.expiresAt===null||validInstant(l.expiresAt))&&(l.expiryPrecision!=='instant'||l.expiresAt!==null)))&&
   known(p.availablePackSlots,(n:any)=>Number.isInteger(n)&&n>=0&&n<=5)&&known(p.enterpriseOverage?.enabled,(b:any)=>typeof b==='boolean')&&known(p.enterpriseOverage?.headroomCredits,validAmount);
 }catch{return false;}
}
const duration=(from:string,to:string)=>rational(BigInt(Date.parse(to)-Date.parse(from)),86400000n);
export function buildDemand(f:ForecastResult,h:AccountHistory,manual:ManualDemand|null,p:BillingProfile,horizon:1|3|6,now:string):DemandResult {
 const fail=(code:string):DemandResult=>({status:'unavailable',reasons:[code],scenarios:[]});
 try {
  if(!validProfile(p)||!validInstant(now)||![1,3,6].includes(horizon))return fail('invalid_cost_input');
  let rate:Rational|null=null,futureRate:Rational|null=null,anchor=p.confirmedAt,source:DemandScenario['source']='manual';
  const assumptions=['constant_within_cycle_demand','prices_assumed_unchanged','sensitivity_not_confidence'];const reasons:string[]=[];
  if(manual){
   if(!validInstant(manual.asOf)||!Array.isArray(manual.futureCycleCredits)||![1,horizon].includes(manual.futureCycleCredits.length)||!manual.futureCycleCredits.every(validAmount)||manual.beforeReset!==undefined&&!validAmount(manual.beforeReset))return fail('invalid_manual_demand');
   anchor=manual.asOf;assumptions.push('manual_hypothetical_demand');
   if(manual.futureCycleCredits.length===1&&horizon>1)assumptions.push('repeat_manual_cycle_total');
   if(manual.standalone){const s=manual.standalone;if(!['consumer_prepaid','enterprise_postpaid'].includes(s.billingSystem)||s.market!=='commercial'||s.openingPurchased!=='none'||s.promotion!=='excluded'||s.schedule!=='utc_calendar_month')return fail('invalid_standalone_assumptions');
    assumptions.push('standalone_comparison',`standalone_${s.billingSystem}`,'standalone_zero_opening_inventory','promotions_excluded','standalone_utc_calendar_schedule');reasons.push('standalone_hypothetical');
   }
  }else{
   if(!f||f.schemaVersion!==3||f.policy?.version!==3||f.status!=='qualified'||h.status!=='available'||!validInstant(f.asOf)||!validInstant(f.resetAt))return fail('forecast_unavailable');
   const actual=qualify(h,now,f.policy.maxAgeHours,{heuristics:f.policy.heuristics});
   const selected=f.estimates.find(e=>e.method===f.selectedMethod), expected=actual.estimates.find(e=>e.method===actual.selectedMethod);
   if(actual.status!=='qualified'||!selected||!expected||selected.status!=='qualified'||actual.selectedMethod!==f.selectedMethod||actual.asOf!==f.asOf||actual.resetAt!==f.resetAt||actual.tier!==f.tier||JSON.stringify(f.policy)!==JSON.stringify(actual.policy)||['windowFrom','windowTo','snapshotCount','tier','evidenceCredits','evidenceMilliseconds'].some(k=>(selected as any)[k]!== (expected as any)[k]))return fail('forecast_evidence_mismatch');
   const pooledRate=(e:ForecastEstimate)=>div(r(e.evidenceCredits!),rational(BigInt(e.evidenceMilliseconds!),86400000n));
   if(selected.evidenceCredits!==null){
    if(!validAmount(selected.evidenceCredits)||!Number.isSafeInteger(selected.evidenceMilliseconds)||selected.evidenceMilliseconds!<=0)return fail('forecast_evidence_mismatch');
    rate=pooledRate(selected);
   }else{
    if(!selected.windowFrom||!selected.windowTo)return fail('forecast_evidence_mismatch');
    const points=h.points.filter(x=>Date.parse(x.observedAt)>=Date.parse(selected.windowFrom!)&&Date.parse(x.observedAt)<=Date.parse(selected.windowTo!));
    const end=points.at(-1);
    const startUsage=f.selectedMethod==='cycle_to_date'?'0':points[0]?.usage;
    if(!end||startUsage===null||startUsage===undefined||!validAmount(end.usage)||!validAmount(startUsage))return fail('forecast_evidence_mismatch');
    rate=div(sub(r(end.usage),r(startUsage)),duration(selected.windowFrom,selected.windowTo));
   }
   if(cmp(rate,ZERO)<0)return fail('forecast_evidence_mismatch');
   // Future full cycles use the longest qualified pooled window; a short window projected over months is labelled.
   const longest=(['history_84_day','history_28_day'] as const).map(m=>actual.estimates.find(e=>e.method===m&&e.status==='qualified')).find(Boolean);
   if(longest&&validAmount(longest.evidenceCredits)){futureRate=pooledRate(longest);assumptions.push('long_history_future_rate');}
   else assumptions.push('short_window_long_horizon');
   source=f.tier==='provisional'?'forecast_provisional':'forecast_regular';
   assumptions.push('constant_future_net_rate','net_changes_not_gross_billable_usage');if(f.tier==='provisional')assumptions.push('limited_history');
   if(Date.parse(anchor)!==Date.parse(f.asOf))reasons.push('forecast_balance_anchor_differs');
   if(p.resetAt!==null&&Date.parse(p.resetAt)!==Date.parse(f.resetAt))return fail('reset_conflict');
  }
  if(Date.parse(anchor)>Date.parse(now)||Date.parse(p.confirmedAt)>Date.parse(now))return fail('future_anchor');
  if(Date.parse(p.confirmedAt)!==Date.parse(anchor))reasons.push('inventory_anchor_mismatch');
  if(Date.parse(now)-Date.parse(p.confirmedAt)>86400000)reasons.push('inventory_stale');
  let reset=p.resetAt;
  if(reset===null){if(!manual?.standalone)return fail('reset_unknown');const a=new Date(anchor);a.setUTCDate(1);a.setUTCHours(0,0,0,0);reset=utcMonthBoundary(anchor)?a.toISOString():addUtcMonths(a.toISOString(),1);}
  if(!utcMonthBoundary(reset))return fail('reset_conflict');
  if(Date.parse(reset)<Date.parse(anchor)||Date.parse(reset)<Date.parse(now))return fail('reset_elapsed');
  const low=manual?.lowFactor??'0.75',high=manual?.highFactor??'1.25';
  if(!validAmount(low)||!validAmount(high)||cmp(r(low),r('1'))>0||cmp(r(high),r('1'))<0)return fail('invalid_sensitivity');
  const scenarios:DemandScenario[]=(['low','base','high'] as const).map((id,index)=>{
   const factor=r([low,'1',high][index]);
   const before=manual?.beforeReset!==undefined?r(manual.beforeReset):rate?mul(rate,duration(anchor,reset!)):null;
   return {id,source,anchorAt:anchor,beforeReset:before?{kind:'known',value:mul(before,factor)}:{kind:'unknown'},withinCycle:'constant_rate_assumption',assumptions:[...assumptions],
    futureCycles:Array.from({length:horizon},(_,i)=>{const from=addUtcMonths(reset!,i),to=addUtcMonths(reset!,i+1);const credits=manual?r(manual.futureCycleCredits[manual.futureCycleCredits.length===1?0:i]):mul(futureRate??rate!,duration(from,to));return {from,to,credits:mul(credits,factor)};})};
  });
  // Only fixed codes, never copies of caller-supplied text.
  for(const scenario of scenarios)scenario.assumptions.push(...reasons);
  return {status:reasons.length?'conditional':'available',reasons,scenarios};
 }catch{return fail('invalid_cost_input');}
}
