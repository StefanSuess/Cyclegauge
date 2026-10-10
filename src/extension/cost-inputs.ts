import {decimal} from '../decimal.ts';
import {validAmount,validInstant,reviewedCatalog} from '../cost/catalog.ts';
import {buildDemand,validProfile,utcMonthBoundary} from '../cost/demand.ts';
import {optimizeCosts} from '../cost/optimize.ts';
import {PLAN_IDS,type BillingProfile,type Knowledge,type PurchasedCreditLot,type PricingCatalog,type CostOptimization} from '../cost/types.ts';
import type {ForecastResult} from '../forecast.ts';
import type {AccountHistory} from '../history.ts';

export const planNames={free:'Free',pro:'Pro',pro_plus:'Pro+',pro_max:'Pro Max',power:'Power'};
export interface CostInput {mode:'independent'|'personalized'; profile:BillingProfile; monthlyCredits:string; beforeReset:string|undefined; demandMode:'manual'|'forecast'}
export interface NativeCostInput {
 pick(title:string,items:{id:string;label:string;description?:string}[]):Promise<string|undefined>;
 input(title:string,value?:string,validate?:(text:string)=>string|undefined):Promise<string|undefined>;
 plans(title:string,selected:string[]):Promise<string[]|undefined>;
}
export interface CostHorizon {months:1|3|6; result:CostOptimization|null; reasons:string[]}
const unknown=<T>():Knowledge<T>=>({kind:'unknown'});
const known=<T>(value:T):Knowledge<T>=>({kind:'known',value});
export function parseAmount(text:string):string|null {try{const n=decimal(text);return validAmount(n)?n:null;}catch{return null;}}
export function parseLots(text:string):Knowledge<PurchasedCreditLot[]>|null {
 if(text==='')return unknown();
 try{
  if(text.length>4096)return null;
  const lots=JSON.parse(text);
  if(!Array.isArray(lots)||lots.length>5)return null;
  const out:PurchasedCreditLot[]=[];
  for(const lot of lots){
   if(!lot||typeof lot!=='object'||Object.keys(lot).some(k=>!['remainingCredits','expiresAt','expiryPrecision'].includes(k))||typeof lot.remainingCredits!=='string')return null;
   const credits=parseAmount(lot.remainingCredits);
   if(credits===null||!['instant','day','unknown'].includes(lot.expiryPrecision)||lot.expiresAt!==null&&!validInstant(lot.expiresAt)||lot.expiryPrecision==='instant'&&lot.expiresAt===null)return null;
   out.push({remainingCredits:credits,expiresAt:lot.expiresAt,expiryPrecision:lot.expiryPrecision});
  }
  return known(out);
 }catch{return null;}
}
const emptyProfile=(now:string):BillingProfile=>({provenance:'manual',confirmedAt:now,billingSystem:'unknown',market:'unknown',currentPlan:null,allowedPlans:[...PLAN_IDS],cohort:'unknown',firstPaidAt:null,promotion:'present_or_unknown',resetAt:null,planRemaining:unknown(),cycleUsageForRerating:unknown(),priorAddOnConsumption:'present_or_unknown',purchased:unknown(),availablePackSlots:unknown(),enterpriseOverage:{enabled:unknown(),headroomCredits:unknown()}});
const choices=(ids:string[])=>ids.map(id=>({id,label:id.replaceAll('_',' ')}));
const amountError=(v:string)=>parseAmount(v)===null?'Enter a non-negative decimal credit amount.':undefined;
export async function configureCostInputs(ui:NativeCostInput,now:string):Promise<CostInput|null>{
 const mode=await ui.pick('Cost Optimizer — independent comparison or current plan',[{id:'independent',label:'Independent comparison',description:'What-if list prices; no personal savings or account balances'},...PLAN_IDS.map(id=>({id,label:`Current plan: ${planNames[id]}`,description:'Manual profile; missing details stay unknown'}))]);
 if(!mode)return null;
 const system=await ui.pick('Billing system / commercial list prices',[{id:'consumer_prepaid',label:'Consumer prepaid — commercial billing'},{id:'enterprise_postpaid',label:'Enterprise postpaid — commercial billing'},{id:'unknown',label:'Unknown / unsupported market'}]);if(!system)return null;
 const text=await ui.input('Expected credits per full month',undefined,amountError);if(text===undefined)return null;
 const monthlyCredits=parseAmount(text);if(monthlyCredits===null)return null;
 const profile=emptyProfile(now);profile.billingSystem=system as BillingProfile['billingSystem'];profile.market=system==='unknown'?'unknown':'commercial';
 if(mode==='independent'){
  if(system==='unknown')return null;
  const confirm=await ui.pick('Confirm hypothetical comparison assumptions',[{id:'confirm',label:'Compare commercial UTC list-price cycles',description:'Assume no opening purchased credits; exclude promotions and current partial cycle. Eligibility remains unverified.'},{id:'cancel',label:'Cancel'}]);
  if(confirm!=='confirm')return null;
  return {mode:'independent',profile,monthlyCredits,beforeReset:undefined,demandMode:'manual'};
 }
 if(!PLAN_IDS.includes(mode as any)||system==='enterprise_postpaid'&&mode==='free')return null;
 profile.currentPlan=mode as BillingProfile['currentPlan'];profile.allowedPlans=[profile.currentPlan!];
 return {mode:'personalized',profile,monthlyCredits,beforeReset:undefined,demandMode:'manual'};
}

export async function editCostInputs(ui:NativeCostInput,current:CostInput,now:string):Promise<CostInput|null>{
 const value=structuredClone(current),p=value.profile;
 const field=await ui.pick('Edit scenario / advanced billing details',[
  {id:'monthly',label:'Expected monthly credits'}, {id:'demand',label:'Demand source: manual or qualified forecast'},
  {id:'before',label:'Expected additional credits before reset'}, {id:'balances',label:'Confirm balance anchor, reset and current plan balances'},
  {id:'inventory',label:'Existing purchased credit lots',description:'Confirm none, retain unknown or enter up to five lots'},
  {id:'slots',label:'Available add-on pack slots'}, {id:'cohort',label:'Billing cohort'}, {id:'first_paid',label:'First paid subscription date'},
  {id:'promotion',label:'Promotions'}, {id:'prior',label:'Previously consumed add-on credits'},
  {id:'overage',label:'Enterprise overages and headroom'}, {id:'plans',label:'Eligible plans / feature restrictions'}, {id:'market',label:'Commercial, GovCloud or custom market'}
 ]);if(!field)return null;
 const number=async(title:string,existing:Knowledge<string>):Promise<Knowledge<string>|null>=>{
  const text=await ui.input(title+' — blank = unknown',existing.kind==='known'?existing.value:'',v=>v===''?undefined:amountError(v));
  if(text===undefined)return null;if(text==='')return unknown();const n=parseAmount(text);return n===null?null:known(n);
 };
 if(field==='monthly'){const n=await ui.input('Expected credits per full month',value.monthlyCredits,amountError);if(n===undefined)return null;const a=parseAmount(n);if(a===null)return null;value.monthlyCredits=a;value.demandMode='manual';}
 else if(field==='demand'){const mode=await ui.pick('Demand source',choices(value.mode==='independent'?['manual']:['manual','forecast']));if(!mode)return null;value.demandMode=mode as CostInput['demandMode'];}
 else if(field==='before'){const n=await number('Additional demand from balance anchor until reset',value.beforeReset===undefined?unknown():known(value.beforeReset));if(!n)return null;value.beforeReset=n.kind==='known'?n.value:undefined;}
 else if(field==='balances'){
  const at=await ui.input('Balance as-of instant with UTC offset',p.confirmedAt,v=>validInstant(v)&&Date.parse(v)<=Date.parse(now)?undefined:'Enter a valid instant, no later than now.');if(at===undefined||!validInstant(at)||Date.parse(at)>Date.parse(now))return null;
  const reset=await ui.input('Next reset instant — UTC calendar-month boundary',p.resetAt??'',v=>validInstant(v)&&utcMonthBoundary(v)&&Date.parse(v)>=Date.parse(now)?undefined:'Enter the next UTC calendar-month boundary.');if(reset===undefined||!validInstant(reset)||!utcMonthBoundary(reset)||Date.parse(reset)<Date.parse(now))return null;
  const remaining=await number('Remaining plan credits (base only)',p.planRemaining);if(!remaining)return null;
  const used=await number('Total cycle credits used for upgrade rerating',p.cycleUsageForRerating);if(!used)return null;
  p.confirmedAt=at;p.resetAt=reset;p.planRemaining=remaining;p.cycleUsageForRerating=used;
 }
 else if(field==='inventory'){
  const mode=await ui.pick('Existing purchased inventory',[
   {id:'unknown',label:'Unknown inventory'}, {id:'none',label:'Confirm no existing purchased credits'},
   {id:'replace',label:'Enter replacement purchased credit lots',description:'Up to five lots; credits and expiry entered separately'}
  ]);if(!mode)return null;
  if(mode==='unknown')p.purchased=unknown();
  else if(mode==='none')p.purchased=known([]);
  else if(mode==='replace'){
   const lots:PurchasedCreditLot[]=[];
   for(let i=0;i<5;i++){
    const text=await ui.input(`Lot ${i+1}: remaining purchased credits`,undefined,amountError);if(text===undefined)return null;
    const credits=parseAmount(text);if(credits===null)return null;
    const precision=await ui.pick(`Lot ${i+1}: expiration precision`,choices(['instant','day','unknown']));if(!precision)return null;
    let expiry:string|null=null;
    if(precision!=='unknown'){
     const at=await ui.input(`Lot ${i+1}: expiration instant with UTC offset${precision==='day'?' (date-only remains uncertain)':''}`,undefined,v=>validInstant(v)?undefined:'Enter a valid ISO instant with UTC offset.');
     if(at===undefined||!validInstant(at))return null;expiry=at;
    }
    lots.push({remainingCredits:credits,expiresAt:expiry,expiryPrecision:precision as PurchasedCreditLot['expiryPrecision']});
    if(i<4){const action=await ui.pick('Purchased lots',choices(['done','add_another']));if(!action)return null;if(action==='done')break;}
   }
   p.purchased=known(lots);
  }else return null;
 }
 else if(field==='slots'){const text=await ui.input('Available pack slots: 0–5; blank = unknown',p.availablePackSlots.kind==='known'?String(p.availablePackSlots.value):'',v=>/^(?:[0-5])?$/.test(v)?undefined:'Enter an integer from 0 to 5, or leave blank.');if(text===undefined||!/^(?:[0-5])?$/.test(text))return null;p.availablePackSlots=text===''?unknown():known(Number(text));}
 else if(field==='cohort'){const n=await ui.pick('Billing cohort',choices(['unknown','established_paid','first_paid_month','never_paid','returning_free']));if(!n)return null;p.cohort=n as BillingProfile['cohort'];}
 else if(field==='first_paid'){const n=await ui.input('First paid instant; blank = unknown',p.firstPaidAt??'',v=>v===''||validInstant(v)&&Date.parse(v)<=Date.parse(p.confirmedAt)?undefined:'Enter a valid instant no later than the balance anchor.');if(n===undefined||n!==''&&(!validInstant(n)||Date.parse(n)>Date.parse(p.confirmedAt)))return null;p.firstPaidAt=n||null;}
 else if(field==='promotion'){const n=await ui.pick('Promotion status',choices(['present_or_unknown','none_confirmed']));if(!n)return null;p.promotion=n as BillingProfile['promotion'];}
 else if(field==='prior'){const n=await ui.pick('Consumed add-ons earlier in this billing cycle',choices(['present_or_unknown','none_confirmed']));if(!n)return null;p.priorAddOnConsumption=n as BillingProfile['priorAddOnConsumption'];}
 else if(field==='overage'){
  const n=await ui.pick('Enterprise overage permission',choices(['unknown','disabled','enabled']));if(!n)return null;
  p.enterpriseOverage.enabled=n==='unknown'?unknown():known(n==='enabled');
  const h=await number('Applicable remaining overage headroom',p.enterpriseOverage.headroomCredits);if(!h)return null;p.enterpriseOverage.headroomCredits=h;
 }
 else if(field==='plans'){const n=await ui.plans('Confirm eligible tiers satisfying your feature / admin restrictions',p.allowedPlans);if(!n||!n.length||n.some(id=>!PLAN_IDS.includes(id as any))||p.billingSystem==='enterprise_postpaid'&&n.includes('free'))return null;p.allowedPlans=n as BillingProfile['allowedPlans'];}
 else if(field==='market'){const n=await ui.pick('Billing market',choices(['unknown','commercial','govcloud','custom']));if(!n)return null;p.market=n as BillingProfile['market'];}
 else return null;
 return validProfile(p)?value:null;
}

/** Identity stays private to this object; only a monotonically changing editor ticket escapes. */
export class CostInputs {
 #scope:string|null=null;#state='unobserved';#epoch=0;#value:CostInput|null=null;
 get value():CostInput|null{return this.#value?structuredClone(this.#value):null;}
 observe(scope:string|null,state:'single'|'ambiguous'|'unavailable'){
  if(scope!==this.#scope||state!==this.#state){this.clear();this.#scope=scope;this.#state=state;}
 }
 begin(){return ++this.#epoch;}
 commit(ticket:number,value:CostInput){if(ticket!==this.#epoch||value.mode==='personalized'&&this.#state!=='single')return false;this.#value=structuredClone(value);return true;}
 clear(){this.#epoch++;this.#value=null;}
}

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
