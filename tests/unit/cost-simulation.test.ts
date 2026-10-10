import {test} from 'node:test';import assert from 'node:assert/strict';
import {simulateStrategy} from '../../src/cost/simulate.ts';
import {reviewedCatalog} from '../../src/cost/catalog.ts';
import {request,profile,strategy} from './cost-synthetic.ts';
import {decimalToRational as r,addRational as add,compareRational as cmp} from '../../src/cost/money.ts';
import type {CostBreakdown} from '../../src/cost/types.ts';
const base=(q:ReturnType<typeof request>)=>q.demands[1];
function conservation(b:CostBreakdown){
 assert.equal(cmp(add(r(b.openingPurchasedCredits!),r(b.newPurchasedCredits!)),add(add(r(b.purchasedCreditsConsumed!),r(b.expiredPurchasedCredits!)),r(b.closingPurchasedCredits!))),0);
}
test('synthetic purchase minimum and split maximum: 1 -> 125/$5; 2501 -> 2625/$105',()=>{
 for(const [d,credits,spend] of [['1001','125','5'],['3501','2625','105']]){
  const q=request(d),s=simulateStrategy(q,strategy(),base(q));
  assert.equal(s.future.newPurchasedCredits,credits);assert.equal(s.future.newAddOnSpend!.amount,spend);assert.equal(s.future.feasible,true);conservation(s.future);
 }
});
test('reviewed unknown step withholds exact purchase and carries a labeled floor',()=>{
 const q=request('1001');q.catalog=structuredClone(reviewedCatalog);q.catalog.verifiedOn=q.now;
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.newAddOnSpend,null);assert.equal(s.future.newPurchasedCredits,null);
 assert.equal(s.future.lowerBoundNewAddOnSpend!.amount,'5');assert.ok(s.reasons.includes('purchase_step_unknown'));assert.equal(s.future.feasible,null);
});
test('opening inventory is not new expenditure and plan-first leaves 25',()=>{
 const q=request('1100',1,profile({purchased:{kind:'known',value:[{remainingCredits:'125',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant'}]},availablePackSlots:{kind:'known',value:4}}));
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.newAddOnSpend!.amount,'0');assert.equal(s.future.existingCreditsConsumed,'100');assert.equal(s.future.closingPurchasedCredits,'25');conservation(s.future);
});
test('earliest expiry consumed first, expired lots before reset demand, no closing cash credit',()=>{
 const q=request('1100',3,profile({purchased:{kind:'known',value:[{remainingCredits:'200',expiresAt:'2030-03-01T00:00:00Z',expiryPrecision:'instant'},{remainingCredits:'125',expiresAt:'2030-02-01T00:00:00Z',expiryPrecision:'instant'}]},availablePackSlots:{kind:'known',value:3}}));
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.expiredPurchasedCredits,'125');assert.equal(s.future.newAddOnSpend!.amount,'5');assert.equal(s.future.closingPurchasedCredits,'25');assert.equal(s.future.totalNewExpenditure!.amount,'65');conservation(s.future);
});
test('plan-first allows unused early lot to expire even when later credits needed',()=>{
 const q=request('1100',1,profile({purchased:{kind:'known',value:[{remainingCredits:'125',expiresAt:'2030-01-15T00:00:00Z',expiryPrecision:'instant'}]},availablePackSlots:{kind:'known',value:4}}));
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.expiredPurchasedCredits,'125');assert.equal(s.future.existingCreditsConsumed,'0');assert.equal(s.future.newAddOnSpend!.amount,'5');conservation(s.future);
});
test('day-only expiry is uncertainty rather than invented time',()=>{
 const q=request('1100',1,profile({purchased:{kind:'known',value:[{remainingCredits:'125',expiresAt:'2030-01-30T00:00:00Z',expiryPrecision:'day'}]}}));
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.status,'conditional');assert.equal(s.future.totalNewExpenditure,null);assert.ok(s.reasons.includes('lot_expiry_uncertain'));
});
test('no slots means unmet demand; unknown depleted release cannot promise refills',()=>{
 const q=request('3501');q.profile.availablePackSlots={kind:'known',value:1};q.catalog.consumer.depletedSlotRelease=false;
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.unmetDemandCredits,'1');assert.equal(s.future.feasible,false);
 q.catalog.consumer.depletedSlotRelease=null;
 const u=simulateStrategy(q,strategy(),base(q));assert.ok(u.reasons.includes('pack_slot_release_unknown'));assert.equal(u.future.feasible,null);
 q.profile.availablePackSlots={kind:'known',value:0};assert.equal(simulateStrategy(q,strategy(),base(q)).future.feasible,false);
});
test('paid upgrade adds $20 and rerates to 1100 remaining, not a fresh 2000 plus old balance',()=>{
 const p=profile({confirmedAt:'2030-01-15T00:00:00Z',resetAt:'2030-02-01T00:00:00Z',planRemaining:{kind:'known',value:'100'},cycleUsageForRerating:{kind:'known',value:'900'}});
 const q=request('1000',1,p);q.demands[1].beforeReset={kind:'known',value:r('1200')};
 const s=simulateStrategy(q,strategy('pro_plus','now'),base(q));assert.equal(s.bridge.newSubscriptionSpend!.amount,'20');assert.equal(s.bridge.planCreditsConsumed,'1100');assert.equal(s.bridge.additionalCreditsNeeded,'100');assert.equal(s.bridge.newAddOnSpend!.amount,'5');conservation(s.bridge);
 q.profile.priorAddOnConsumption='present_or_unknown';const u=simulateStrategy(q,strategy('pro_plus','now'),base(q));assert.ok(u.reasons.includes('consumed_pack_restoration_unknown'));assert.equal(u.future.totalNewExpenditure,null);
});
test('downgrades only after reset; temporary higher plan reverts then',()=>{
 const p=profile({confirmedAt:'2030-01-15T00:00:00Z',resetAt:'2030-02-01T00:00:00Z',currentPlan:'pro_plus',planRemaining:{kind:'known',value:'2000'}});const q=request('1000',1,p);
 const d=simulateStrategy(q,strategy('pro','next_reset'),base(q));assert.equal(d.bridge.newSubscriptionSpend!.amount,'0');assert.equal(d.future.newSubscriptionSpend!.amount,'20');assert.equal(Date.parse(d.effectiveAt!),Date.parse(p.resetAt!));
 assert.equal(simulateStrategy(q,strategy('pro','now'),base(q)).status,'unavailable');
 const t=request('1000',1,profile({...p,currentPlan:'pro'}));assert.equal(simulateStrategy(t,strategy('pro_plus','now_then_revert_at_reset'),base(t)).future.newSubscriptionSpend!.amount,'20');
});
test('first-paid and promotion cases stay conditional; regular cycles remain useful',()=>{
 const p=profile({confirmedAt:'2030-01-15T00:00:00Z',resetAt:'2030-02-01T00:00:00Z',cohort:'first_paid_month',promotion:'present_or_unknown'});const q=request('1000',1,p);
 const s=simulateStrategy(q,strategy('pro_plus','now'),base(q));assert.equal(s.status,'conditional');assert.equal(s.bridge.newSubscriptionSpend,null);assert.equal(s.future.totalNewExpenditure,null);
 const zero=request('1000');zero.profile.cohort='unknown';zero.profile.promotion='present_or_unknown';const normal=simulateStrategy(zero,strategy('pro_plus','next_reset'),base(zero));assert.equal(normal.status,'conditional');assert.equal(normal.future.newSubscriptionSpend!.amount,'40');assert.ok(normal.assumptions.includes('promotions_excluded'));
});
test('Free never buys packs; cancellation retains old lots; incompatible Free lots conditional',()=>{
 const q=request('51',1,profile({currentPlan:'free',cohort:'never_paid',planRemaining:{kind:'known',value:'50'}}));assert.equal(simulateStrategy(q,strategy('free'),base(q)).future.unmetDemandCredits,'1');
 q.profile.cohort='returning_free';q.profile.purchased={kind:'known',value:[{remainingCredits:'125',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant'}]};q.profile.availablePackSlots={kind:'known',value:4};assert.equal(simulateStrategy(q,strategy('free'),base(q)).future.feasible,true);
 q.profile.cohort='never_paid';assert.equal(simulateStrategy(q,strategy('free'),base(q)).future.feasible,null);
});
test('Enterprise liability has no pack minimum and explicit headroom gates feasibility',()=>{
 const q=request('1001',1,profile({billingSystem:'enterprise_postpaid',enterpriseOverage:{enabled:{kind:'known',value:true},headroomCredits:{kind:'known',value:'1'}}}));
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.newOverageLiability!.amount,'0.04');assert.equal(s.future.newAddOnSpend!.amount,'0');assert.deepEqual(s.future.purchases,[]);
 q.profile.enterpriseOverage.headroomCredits={kind:'known',value:'0.5'};assert.equal(simulateStrategy(q,strategy(),base(q)).future.unmetDemandCredits,'0.5');
 q.profile.enterpriseOverage.enabled={kind:'known',value:false};assert.equal(simulateStrategy(q,strategy(),base(q)).future.unmetDemandCredits,'1');
 q.profile.enterpriseOverage.enabled={kind:'unknown'};assert.equal(simulateStrategy(q,strategy(),base(q)).future.totalNewExpenditure,null);
 assert.equal(simulateStrategy(q,strategy('free','next_reset'),base(q)).status,'unavailable');
});
test('candidate copies and bridge inventory inheritance preserve conservation',()=>{
 const p=profile({confirmedAt:'2030-01-15T00:00:00Z',resetAt:'2030-02-01T00:00:00Z',planRemaining:{kind:'known',value:'0'},purchased:{kind:'known',value:[{remainingCredits:'125',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant'}]},availablePackSlots:{kind:'known',value:4}});const q=request('1100',1,p);q.demands[1].beforeReset={kind:'known',value:r('100')};
 const original=JSON.stringify(q.profile);const a=simulateStrategy(q,strategy(),base(q));simulateStrategy(q,strategy('pro_plus','now'),base(q));const b=simulateStrategy(q,strategy(),base(q));assert.deepEqual(a,b);assert.equal(JSON.stringify(q.profile),original);
 assert.equal(a.bridge.closingPurchasedCredits,'25');assert.equal(a.future.openingPurchasedCredits,'25');assert.equal(a.future.newAddOnSpend!.amount,'5');conservation(a.bridge);conservation(a.future);
 q.profile.purchased={kind:'unknown'};assert.equal(simulateStrategy(q,strategy(),base(q)).future.totalNewExpenditure,null);
});
test('huge demand hits event bound, invalid and private inputs never echo',()=>{
 const q=request('1'+'0'.repeat(30));const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.status,'unavailable');assert.ok(s.reasons.includes('scenario_limit_exceeded'));
 const small=request('0');const bad:any=strategy();bad.id='synthetic-private-marker';const out=simulateStrategy(small,bad,base(small));assert.ok(!JSON.stringify(out).includes('synthetic-private-marker'));assert.doesNotThrow(()=>JSON.stringify(out));
 small.profile.market='govcloud';assert.equal(simulateStrategy(small,strategy(),base(small)).status,'unavailable');
});
test('future dated price applies at boundary, expired rule does not claim unchanged verified price',()=>{
 const q=request('1000',3);q.catalog.changes=[{at:'2030-02-01T00:00:00Z',planId:'pro',fee:'21',credits:'1000',source:q.catalog.plans[1].source}];
 assert.equal(simulateStrategy(q,strategy(),base(q)).future.newSubscriptionSpend!.amount,'62');
 q.catalog.rules[3].effectiveTo='2030-02-01T00:00:00Z';const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.status,'conditional');assert.ok(s.reasons.includes('rule_outside_effective_period'));
});

test('manual and multi-cycle results remain conditional even with complete reviewed rules',()=>{
 const q=request('1000');q.catalog.evidence='reviewed';const manual=simulateStrategy(q,strategy(),base(q));assert.equal(manual.status,'conditional');assert.ok(manual.reasons.includes('manual_hypothetical_demand'));
 const future=request('1000',3);future.catalog.evidence='reviewed';future.demands.forEach(d=>d.source='forecast_regular');const s=simulateStrategy(future,strategy(),base(future));assert.equal(s.status,'conditional');assert.ok(s.reasons.includes('sustained_usage_scenario'));
});
test('five occupied slots and unknown slots never create exact new capacity',()=>{
 const q=request('1300',1,profile({purchased:{kind:'known',value:Array.from({length:5},()=>({remainingCredits:'1',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant' as const}))},availablePackSlots:{kind:'known',value:0}}));q.catalog.consumer.depletedSlotRelease=null;
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.feasible,null);assert.ok(s.reasons.includes('pack_slot_release_unknown'));
 const unknown=request('1001');unknown.profile.availablePackSlots={kind:'unknown'};assert.equal(simulateStrategy(unknown,strategy(),base(unknown)).future.totalNewExpenditure,null);
});
test('cancellation retained-lot permission is unavailable when B6 is unknown',()=>{
 const q=request('100',1,profile({currentPlan:'pro',purchased:{kind:'known',value:[{remainingCredits:'100',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant'}]},availablePackSlots:{kind:'known',value:4}}));q.catalog.rules[5].status='unknown';
 const s=simulateStrategy(q,strategy('free','next_reset'),base(q));assert.equal(s.future.feasible,null);assert.equal(s.future.totalNewExpenditure,null);assert.ok(s.reasons.includes('billing_rule_unknown'));
});

test('existing inventory requires B2 even without a new purchase',()=>{
 const q=request('1100',1,profile({purchased:{kind:'known',value:[{remainingCredits:'125',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant'}]},availablePackSlots:{kind:'known',value:4}}));q.catalog.rules[1].status='unknown';
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.future.totalNewExpenditure,null);assert.ok(s.reasons.includes('billing_rule_unknown'));
});
test('direct requests require reset and reject future confirmation or elapsed reset',()=>{
 const q=request('0');q.profile.resetAt=null;assert.ok(simulateStrategy(q,strategy(),base(q)).reasons.includes('reset_unknown'));
 const future=request('0');future.profile.confirmedAt='2030-01-02T00:00:00Z';assert.equal(simulateStrategy(future,strategy(),base(future)).status,'unavailable');
 const elapsed=request('0');elapsed.now='2030-01-02T00:00:00Z';assert.ok(simulateStrategy(elapsed,strategy(),base(elapsed)).reasons.includes('reset_elapsed'));
});
test('100000-event limit covers bridge and future together',()=>{
 const q=request('100001000',1,profile({confirmedAt:'2030-01-15T00:00:00Z',resetAt:'2030-02-01T00:00:00Z',planRemaining:{kind:'known',value:'0'}}));q.demands[1].beforeReset={kind:'known',value:r('30000000')};
 const s=simulateStrategy(q,strategy(),base(q));assert.equal(s.status,'unavailable');assert.ok(s.reasons.includes('scenario_limit_exceeded'));
});
