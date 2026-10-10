import {test} from 'node:test';import assert from 'node:assert/strict';
import {optimizeCosts,findBreakEven} from '../../src/cost/optimize.ts';
import {request,profile,forecastEvidence} from './cost-synthetic.ts';
import {reviewedCatalog} from '../../src/cost/catalog.ts';
import {buildDemand} from '../../src/cost/demand.ts';
import {decimalToRational as r} from '../../src/cost/money.ts';

test('enumerates skip-tier, future changes, temporary bridge upgrades; respects features',()=>{
 const p=profile({confirmedAt:'2030-01-15T00:00:00Z',resetAt:'2030-02-01T00:00:00Z'}),q=request('1200',1,p);
 const o=optimizeCosts(q);const ids=o.scenarios.filter(s=>s.demandId==='base').map(s=>s.strategy.id);
 for(const id of ['pro_keep_as_needed','power_now_as_needed','power_next_reset_as_needed','pro_plus_now_then_revert_at_reset_as_needed','free_next_reset_as_needed'])assert.ok(ids.includes(id));
 q.profile.allowedPlans=['pro_plus','pro_max','power'];const filtered=optimizeCosts(q);assert.ok(filtered.scenarios.every(s=>q.profile.allowedPlans.includes(s.strategy.targetPlan)));assert.equal(filtered.baselineStrategyId,null);
});
test('rollover drives actual 1/3/6-cycle expenses and signed matched savings',()=>{
 for(const [months,pro,plus,difference] of [[1,'25','40','-15'],[3,'70','120','-50'],[6,'135','240','-105']] as const){
  const o=optimizeCosts(request('1050',months));const a=o.scenarios.find(s=>s.demandId==='base'&&s.strategy.id==='pro_keep_as_needed')!,b=o.scenarios.find(s=>s.demandId==='base'&&s.strategy.id==='pro_plus_next_reset_as_needed')!;
  assert.equal(a.future.totalNewExpenditure!.amount,pro);assert.equal(b.future.totalNewExpenditure!.amount,plus);
  assert.equal(o.savings.find(s=>s.demandId==='base'&&s.strategyId===b.strategy.id)!.future!.amount,difference);
  assert.equal(a.future.from,b.future.from);assert.equal(a.future.to,b.future.to);
  const currentPlus=optimizeCosts(request('1050',months,profile({currentPlan:'pro_plus',planRemaining:{kind:'known',value:'2000'}})));
  assert.equal(currentPlus.savings.find(s=>s.demandId==='base'&&s.strategyId==='pro_next_reset_as_needed')!.future!.amount,difference.slice(1));
 }
});
test('infeasible Free/disabled overage baseline cannot produce savings',()=>{
 const free=optimizeCosts(request('100',1,profile({currentPlan:'free',cohort:'returning_free',planRemaining:{kind:'known',value:'50'}})));
 assert.ok(free.savings.filter(s=>s.demandId==='base').every(s=>s.future===null));
 const enterprise=optimizeCosts(request('1100',1,profile({billingSystem:'enterprise_postpaid'})));
 assert.ok(enterprise.savings.filter(s=>s.demandId==='base').every(s=>s.future===null));
});
test('manual detached comparison survives unknown plan/profile without personalized savings',()=>{
 const {h,f}=forecastEvidence(),p=profile({currentPlan:null,billingSystem:'unknown',market:'unknown',resetAt:null,purchased:{kind:'unknown'},planRemaining:{kind:'unknown'}});
 const demands=buildDemand(f,h,{asOf:p.confirmedAt,futureCycleCredits:['1200'],standalone:{billingSystem:'consumer_prepaid',market:'commercial',openingPurchased:'none',promotion:'excluded',schedule:'utc_calendar_month'}},p,1,p.confirmedAt).scenarios;
 const o=optimizeCosts({now:p.confirmedAt,catalog:reviewedCatalog,horizonMonths:1,profile:p,demands});
 assert.equal(o.baselineStrategyId,null);assert.equal(o.recommendation,null);assert.ok(o.scenarios.some(s=>s.strategy.targetPlan==='pro_plus'&&s.future.totalNewExpenditure?.amount==='40'));
 assert.ok(o.savings.every(s=>s.future===null));assert.ok(o.alternatives.some(a=>a.strategyId!==null));assert.equal(o.status,'conditional');
});
test('unknown competitor and catalog age prohibit supported recommendation, ties favor keep',()=>{
 const q=request('1500');q.demands.forEach(d=>d.futureCycles[0].credits=r('1500'));
 let o=optimizeCosts(q);assert.equal(o.recommendation!.strategyId,'pro_keep_as_needed');
 q.catalog.consumer.purchaseStepCredits=null;o=optimizeCosts(q);assert.equal(o.recommendation,null);assert.ok(o.reasons.includes('competitor_cost_unknown'));
 const normal=request('1000');normal.catalog.evidence='reviewed';normal.catalog.verifiedOn='2029-11-01T00:00:00Z';o=optimizeCosts(normal);assert.notEqual(o.recommendation?.kind,'supported_comparison');
});
test('sensitivity selects alternatives without categorical recommendation or probability',()=>{
 const o=optimizeCosts(request('1500'));const low=o.alternatives.find(x=>x.demandId==='low')!,high=o.alternatives.find(x=>x.demandId==='high')!;
 assert.equal(low.strategyId,'pro_keep_as_needed');assert.equal(high.strategyId,'pro_plus_next_reset_as_needed');assert.equal(o.recommendation,null);assert.ok(o.reasons.includes('sensitivity_changes_winner'));assert.ok(o.savingsRange);assert.ok(!JSON.stringify(o).includes('confidence_interval'));
});
test('conditional linear references are 1500/3500/7500 and never exact pack quotes',()=>{
 const q=request('1000');q.catalog.consumer.purchaseStepCredits=null;const b=findBreakEven(q);
 assert.equal(b.status,'conditional');assert.equal(b.basis,'conditional_linear_reference');assert.deepEqual(b.points.map(p=>p.credits),['1500','3500','7500']);assert.ok(b.assumptions.includes('continuous_extras_not_verified_purchases'));
});
test('exact single-cycle pack break-even has (1499,1500] tie, complex cases unavailable',()=>{
 const b=findBreakEven(request('1000'));
 assert.equal(b.basis,'single_full_cycle_no_opening_lots');assert.ok(b.intervals.some(i=>i.lower==='1499'&&i.upper==='1500'&&!i.lowerInclusive&&i.upperInclusive&&i.tiedPlans.includes('pro')&&i.tiedPlans.includes('pro_plus')));
 const complex=findBreakEven(request('1000',3));assert.equal(complex.status,'unavailable');assert.ok(complex.reasons.includes('break_even_complex_scenario'));
 const lots=request('1000');lots.profile.purchased={kind:'known',value:[{remainingCredits:'1',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant'}]};assert.equal(findBreakEven(lots).status,'unavailable');
 const tiny=request('1000');tiny.catalog.consumer.purchaseStepCredits='0.000001';assert.ok(findBreakEven(tiny).reasons.includes('break_even_limit_exceeded'));
});
test('failure isolated to capacity-dependent strategies, tiny cost differences rank exactly',()=>{
 const q=request('1200');q.catalog.consumer.purchaseStepCredits=null;const o=optimizeCosts(q);assert.ok(o.scenarios.some(s=>s.strategy.targetPlan==='pro_plus'&&s.future.totalNewExpenditure!==null));
 const nearly=request('1500');nearly.catalog.plans.find(p=>p.id==='pro_plus')!.fee='39.9999999999999999999';nearly.demands.forEach(d=>d.futureCycles[0].credits=r('1500'));
 const n=optimizeCosts(nearly);assert.equal(n.recommendation!.strategyId,'pro_plus_next_reset_as_needed');
});
test('invalid request has fixed diagnostics and JSON-safe empty output',()=>{
 const q:any=request();q.demands[0].assumptions.push('synthetic-private-marker');const o=optimizeCosts(q);
 assert.equal(o.status,'unavailable');assert.ok(!JSON.stringify(o).includes('synthetic-private-marker'));
});

test('inconsistent demand anchors and modes cannot be compared',()=>{
 const q=request('0');q.demands[2].anchorAt='2029-12-31T00:00:00Z';assert.equal(optimizeCosts(q).status,'unavailable');
 const modes=request('0');modes.demands[2].assumptions.push('standalone_comparison');assert.equal(optimizeCosts(modes).status,'unavailable');
});

test('Enterprise linear reference uses postpaid price; unknown billing has no reference',()=>{
 const q=request('1000',1,profile({billingSystem:'enterprise_postpaid',enterpriseOverage:{enabled:{kind:'known',value:true},headroomCredits:{kind:'known',value:'10000'}}}));q.catalog.enterprise.pricePerCredit='0.08';const b=findBreakEven(q);
 assert.equal(b.points[0].credits,'1250');q.profile.billingSystem='unknown';assert.equal(findBreakEven(q).status,'unavailable');
});
test('unknown pack rule cannot label exact winner intervals available',()=>{
 const q=request('1000');q.catalog.evidence='reviewed';q.catalog.rules[0].status='unknown';const b=findBreakEven(q);
 assert.notEqual(b.status,'available');assert.equal(b.basis,'conditional_linear_reference');
});

test('recyclable-pack exact break-even discloses its bounded evaluated domain',()=>{
 const b=findBreakEven(request('1000'));assert.equal(b.status,'conditional');assert.ok(b.reasons.includes('break_even_bounded_domain'));
 assert.deepEqual(b.evaluatedUsageRange,{lower:'0',upper:'22500'});
});
