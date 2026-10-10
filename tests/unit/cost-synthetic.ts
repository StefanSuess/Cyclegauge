// Entirely invented complete rule fixture. Never substitute it for reviewed billing rules.
import { reviewedCatalog } from '../../src/cost/catalog.ts';
export function syntheticCatalog() {
 const c=structuredClone(reviewedCatalog);
 c.id='synthetic-cost-catalog'; c.version='synthetic-v1'; c.evidence='hypothetical';
 c.verifiedOn='2030-01-01T00:00:00Z';
 c.consumer.purchaseStepCredits='1'; c.consumer.moneyRounding='exact';
 c.consumer.depletedSlotRelease=true;
 for(const rule of c.rules) {rule.status='verified'; rule.effectiveFrom='2030-01-01T00:00:00Z';}
 return c;
}

import type { BillingProfile, CostRequest, Strategy } from '../../src/cost/types.ts';
import { history } from '../../src/history.ts';
import { forecast } from '../../src/forecast.ts';
import { buildDemand } from '../../src/cost/demand.ts';
export function profile(overrides:Partial<BillingProfile>={}):BillingProfile {
 return {provenance:'manual',confirmedAt:'2030-01-01T00:00:00Z',billingSystem:'consumer_prepaid',market:'commercial',currentPlan:'pro',allowedPlans:['free','pro','pro_plus','pro_max','power'],cohort:'established_paid',firstPaidAt:null,promotion:'none_confirmed',resetAt:'2030-01-01T00:00:00Z',planRemaining:{kind:'known',value:'1000'},cycleUsageForRerating:{kind:'known',value:'0'},priorAddOnConsumption:'none_confirmed',purchased:{kind:'known',value:[]},availablePackSlots:{kind:'known',value:5},enterpriseOverage:{enabled:{kind:'known',value:false},headroomCredits:{kind:'known',value:'0'}},...overrides};
}
export function forecastEvidence() {
 const h=history([0,1,2,3].map((day)=>({observedAt:`2030-01-0${day+1}T00:00:00Z`,usage:day===3?'1':'0',limit:'1000',resetAt:'2030-02-01T00:00:00Z',flags:[],partition:'synthetic-partition',associated:true,overages:null,overageCap:null} as any)));
 return {h,f:forecast(h,'2030-01-04T00:00:00Z')};
}
export function request(credits='1050',horizon:1|3|6=1,p=profile()):CostRequest {
 const {h,f}=forecastEvidence();
 const result=buildDemand(f,h,{asOf:p.confirmedAt,beforeReset:'0',futureCycleCredits:[credits]},p,horizon,p.confirmedAt);
 if(result.status==='unavailable')throw Error('synthetic-demand-failed');
 return {now:p.confirmedAt,horizonMonths:horizon,catalog:syntheticCatalog(),profile:p,demands:result.scenarios};
}
export function strategy(targetPlan:Strategy['targetPlan']='pro',timing:Strategy['timing']='keep',extras:Strategy['extras']='as_needed'):Strategy {
 return {id:`${targetPlan}_${timing}_${extras}`,targetPlan,timing,extras};
}
