import { PLAN_IDS, type PricingCatalog, type CatalogValidation, type Provenance } from './types.ts';
import { decimal, compare } from '../decimal.ts';
import {decimalToRational as rationalAmount,ceilToQuantum,compareRational} from './money.ts';

export function validInstant(value:unknown): value is string {
 if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
 const ms=Date.parse(value); if(!Number.isFinite(ms)||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59) return false;
 const day=Number(value.slice(8,10)), month=Number(value.slice(5,7)), year=Number(value.slice(0,4));
 return month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate();
}
export function validAmount(value:unknown): value is string {
 try {return typeof value==='string'&&value.length<=256&&decimal(value)===value;} catch {return false;}
}
const source=(url:string,section:string):Provenance=>({url,section});
const billing='https://kiro.dev/docs/billing/';
const urls=[`${billing}add-on-credits/`,`${billing}add-on-credits/`,billing,`${billing}related-questions/`,`${billing}downgrading/`,`${billing}cancelling/`,'https://kiro.dev/docs/enterprise/billing/','https://kiro.dev/pricing/','https://kiro.dev/docs/enterprise/subscription-management/'];
const catalogData:PricingCatalog={schemaVersion:1,id:'kiro-commercial',version:'2026-10-10',verifiedOn:'2026-10-10T00:00:00Z',currency:'USD',market:'commercial',evidence:'reviewed',schedule:'utc_calendar_month',
 plans:PLAN_IDS.map((id,i)=>({id,fee:['0','20','40','100','200'][i],credits:['50','1000','2000','5000','10000'][i],source:source('https://kiro.dev/pricing/','Tier pricing')})),
 rules:urls.map((url,i)=>({id:`B${i+1}`,url,section:`Billing rule B${i+1}`,status:'verified',effectiveFrom:null,effectiveTo:null})),
 consumer:{billingSystem:'consumer_prepaid',pricePerCredit:'0.04',minimumCredits:'125',maximumCredits:'2500',maximumPacks:5,expiryMonths:12,purchaseStepCredits:null,moneyRounding:null,depletedSlotRelease:null},
 enterprise:{billingSystem:'enterprise_postpaid',pricePerCredit:'0.04',allowedPlans:['pro','pro_plus','pro_max','power']},changes:[]};
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const reviewedCatalog:PricingCatalog=freeze(catalogData);

// Rebuild an allowlisted projection; never return the input object or exception text.
export function validateCatalog(input:unknown,now:string):CatalogValidation {
 const fail=(code='invalid_catalog'):CatalogValidation=>({status:'unavailable',catalog:null,reasons:[code]});
 try {
  const c=input as PricingCatalog;
  const text=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9_.-]{1,64}$/.test(s);
  const provenance=(s:Provenance)=>!!s&&typeof s.url==='string'&&s.url.length<=256&&/^https:\/\/[a-z0-9.-]+\/[a-zA-Z0-9/_#.-]*$/.test(s.url)&&typeof s.section==='string'&&s.section.length>0&&s.section.length<=128&&/^[a-zA-Z0-9 _.-]+$/.test(s.section);
  const projectSource=(s:Provenance)=>({url:s.url,section:s.section});
  if(!c||c.schemaVersion!==1||!text(c.id)||!text(c.version)||!validInstant(c.verifiedOn)||!validInstant(now)||Date.parse(now)<Date.parse(c.verifiedOn)||c.currency!=='USD'||c.market!=='commercial'||!['reviewed','hypothetical'].includes(c.evidence)||c.schedule!=='utc_calendar_month')return fail();
  if(!Array.isArray(c.plans)||c.plans.length!==5||new Set(c.plans.map(p=>p.id)).size!==5||c.plans.some(p=>!PLAN_IDS.includes(p.id)||!validAmount(p.fee)||!validAmount(p.credits)||!provenance(p.source)))return fail();
  if(!Array.isArray(c.rules)||c.rules.length!==9||new Set(c.rules.map(r=>r.id)).size!==9||c.rules.some(r=>!/^B[1-9]$/.test(r.id)||!provenance(r)||!['verified','unknown'].includes(r.status)||r.effectiveFrom!==null&&!validInstant(r.effectiveFrom)||r.effectiveTo!==null&&!validInstant(r.effectiveTo)||r.effectiveFrom!==null&&r.effectiveTo!==null&&Date.parse(r.effectiveFrom)>=Date.parse(r.effectiveTo)))return fail('conflicting_or_invalid_rules');
  const a=c.consumer,e=c.enterprise;
  if(!a||a.billingSystem!=='consumer_prepaid'||![a.pricePerCredit,a.minimumCredits,a.maximumCredits].every(validAmount)||compare(a.pricePerCredit,'0')<=0||compare(a.minimumCredits,'0')<=0||compare(a.maximumCredits,a.minimumCredits)<0||a.maximumPacks!==5||a.expiryMonths!==12||a.purchaseStepCredits!==null&&(!validAmount(a.purchaseStepCredits)||compare(a.purchaseStepCredits,'0')<=0||compare(a.purchaseStepCredits,a.maximumCredits)>0)||a.moneyRounding!==null&&a.moneyRounding!=='exact'||a.depletedSlotRelease!==null&&typeof a.depletedSlotRelease!=='boolean')return fail();
  if(a.purchaseStepCredits!==null&&compareRational(ceilToQuantum(rationalAmount(a.minimumCredits),rationalAmount(a.purchaseStepCredits)),rationalAmount(a.maximumCredits))>0)return fail('incompatible_purchase_quantum');
  if(!e||e.billingSystem!=='enterprise_postpaid'||!validAmount(e.pricePerCredit)||compare(e.pricePerCredit,'0')<=0||!Array.isArray(e.allowedPlans)||e.allowedPlans.length!==4||new Set(e.allowedPlans).size!==4||e.allowedPlans.some(p=>!PLAN_IDS.includes(p)||p==='free'))return fail();
  if(!Array.isArray(c.changes)||c.changes.length>30||c.changes.some(x=>!validInstant(x.at)||!PLAN_IDS.includes(x.planId)||!validAmount(x.fee)||!validAmount(x.credits)||!provenance(x.source))||new Set(c.changes.map(x=>`${Date.parse(x.at)}:${x.planId}`)).size!==c.changes.length)return fail();
  const catalog:PricingCatalog={schemaVersion:1,id:c.id,version:c.version,verifiedOn:c.verifiedOn,currency:'USD',market:'commercial',evidence:c.evidence,schedule:c.schedule,
   plans:c.plans.map(p=>({id:p.id,fee:p.fee,credits:p.credits,source:projectSource(p.source)})),
   rules:c.rules.map(r=>({id:r.id,...projectSource(r),status:r.status,effectiveFrom:r.effectiveFrom,effectiveTo:r.effectiveTo})),
   consumer:{billingSystem:'consumer_prepaid',pricePerCredit:a.pricePerCredit,minimumCredits:a.minimumCredits,maximumCredits:a.maximumCredits,maximumPacks:5,expiryMonths:12,purchaseStepCredits:a.purchaseStepCredits,moneyRounding:a.moneyRounding,depletedSlotRelease:a.depletedSlotRelease},
   enterprise:{billingSystem:'enterprise_postpaid',pricePerCredit:e.pricePerCredit,allowedPlans:[...e.allowedPlans]},
   changes:c.changes.map(x=>({at:x.at,planId:x.planId,fee:x.fee,credits:x.credits,source:projectSource(x.source)}))};
  const reasons=Date.parse(now)-Date.parse(c.verifiedOn)>30*86400000?['catalog_review_due']:[];
  return {status:reasons.length?'conditional':'available',catalog:freeze(catalog),reasons};
 } catch {return fail();}
}
