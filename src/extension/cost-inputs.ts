import {decimal} from '../decimal.ts';
import {validAmount,reviewedCatalog} from '../cost/catalog.ts';
import {buildDemand} from '../cost/demand.ts';
import {optimizeCosts} from '../cost/optimize.ts';
import type {BillingProfile,PricingCatalog,CostOptimization} from '../cost/types.ts';
import type {ForecastResult} from '../forecast.ts';
import type {AccountHistory} from '../history.ts';

export const planNames={free:'Free',pro:'Pro',pro_plus:'Pro+',pro_max:'Pro Max',power:'Power'};
/** Engine input. Built only by the Cost Advisor; there is no separate user-facing manual entry any more. */
export interface CostInput {mode:'independent'|'personalized'; profile:BillingProfile; monthlyCredits:string; beforeReset:string|undefined; demandMode:'manual'|'forecast'}
/** Native pickers used by the Cost Advisor's few questions. */
export interface NativeCostInput {
 pick(title:string,items:{id:string;label:string;description?:string}[]):Promise<string|undefined>;
 input(title:string,value?:string,validate?:(text:string)=>string|undefined):Promise<string|undefined>;
 plans(title:string,selected:string[]):Promise<string[]|undefined>;
}
export interface CostHorizon {months:1|3|6; result:CostOptimization|null; reasons:string[]}
export function parseAmount(text:string):string|null {try{const n=decimal(text);return validAmount(n)?n:null;}catch{return null;}}

export function calculateCosts(input:CostInput,f:ForecastResult,h:AccountHistory,now:string,catalog:PricingCatalog=reviewedCatalog):CostHorizon[]{
 return ([1,3,6] as const).map(months=>{
  try{
   const p=structuredClone(input.profile),standalone=input.mode==='independent';
   if(standalone){p.confirmedAt=now;p.resetAt=null;}
   const manual=input.demandMode==='manual'?{asOf:standalone?now:p.confirmedAt,beforeReset:input.beforeReset,futureCycleCredits:[input.monthlyCredits],...(standalone?{standalone:{billingSystem:p.billingSystem as 'consumer_prepaid'|'enterprise_postpaid',market:'commercial' as const,openingPurchased:'none' as const,promotion:'excluded' as const,schedule:'utc_calendar_month' as const}}:{})}:null;
   const demand=buildDemand(f,h,manual,p,months,now);
   if(demand.status==='unavailable')return {months,result:null,reasons:demand.reasons};
   // Ordinary comparisons are deliberately the only optimizer entry point imported here.
   return {months,result:optimizeCosts({now,horizonMonths:months,catalog,profile:p,demands:demand.scenarios}),reasons:demand.reasons};
  }catch{return {months,result:null,reasons:['cost_optimizer_unavailable']};}
 });
}
