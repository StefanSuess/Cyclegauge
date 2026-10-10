import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDemand} from '../../src/cost/demand.ts';
import {decimalToRational as r, formatRational as fmt, ceilToQuantum, compareRational, multiplyRational} from '../../src/cost/money.ts';
import {profile,forecastEvidence} from './cost-synthetic.ts';
const known=(value:string)=>({kind:'known' as const,value});
test('exact selected rate preserves 31/3 instead of multiplying 0.333333',()=>{
 const {h,f}=forecastEvidence(); assert.equal(f.estimates.find(e=>e.method===f.selectedMethod)!.ratePerDay,'0.333333');
 const p=profile({confirmedAt:f.asOf!,resetAt:f.resetAt});
 const d=buildDemand(f,h,null,p,3,f.asOf!);
 assert.equal(d.status,'available'); assert.equal(d.scenarios[1].source,'forecast_provisional');
 assert.deepEqual(d.scenarios[1].futureCycles[1].credits,{numerator:31n,denominator:3n});
 assert.equal(d.scenarios[1].beforeReset.kind,'known');
});
test('automatic demand refuses policy/window/evidence quality mismatch',()=>{
 const {h,f}=forecastEvidence(); const p=profile({confirmedAt:f.asOf!,resetAt:f.resetAt});
 for(const change of [(x:any)=>x.policy.version=99,(x:any)=>x.estimates.find((e:any)=>e.method===x.selectedMethod).windowFrom='2030-01-02T00:00:00Z',(x:any)=>x.asOf='2030-01-03T00:00:00Z',(x:any)=>x.status='unavailable']){
  const bad=structuredClone(f);change(bad);assert.equal(buildDemand(bad,h,null,p,1,f.asOf!).status,'unavailable');
 }
 for(const status of ['multiple_accounts','conflicting_snapshots','unsupported_extra_credits'])assert.equal(buildDemand(f,{...h,status},null,p,1,f.asOf!).status,'unavailable');
 assert.equal(buildDemand(f,h,null,p,1,'2030-01-06T00:00:01Z').status,'unavailable');
 const bad=structuredClone(h);bad.points[1].flags.push('unsupported_extra_credits');assert.equal(buildDemand(f,bad,null,p,1,f.asOf!).status,'unavailable');
});
test('manual independent of forecasts preserves sensitivity and spikes',()=>{
 const {h,f}=forecastEvidence(); const p=profile();
 const d=buildDemand({...f,status:'unavailable'},h,{asOf:p.confirmedAt,futureCycleCredits:['1200','0','3000']},p,3,p.confirmedAt);
 assert.deepEqual(d.scenarios.map(s=>s.futureCycles.map(c=>fmt(c.credits,0,'floor'))),[['900','0','2250'],['1200','0','3000'],['1500','0','3750']]);
 assert.equal(d.scenarios[1].source,'manual'); assert.equal(d.scenarios[1].beforeReset.kind,'unknown');
});
test('explicit standalone assumptions permit unknown account profile without inventing balances',()=>{
 const {h,f}=forecastEvidence();const p=profile({currentPlan:null,billingSystem:'unknown',market:'unknown',resetAt:null,purchased:{kind:'unknown'},planRemaining:{kind:'unknown'}});
 const d=buildDemand(f,h,{asOf:p.confirmedAt,futureCycleCredits:['1200'],standalone:{billingSystem:'consumer_prepaid',market:'commercial',openingPurchased:'none',promotion:'excluded',schedule:'utc_calendar_month'}},p,1,p.confirmedAt);
 assert.equal(d.status,'conditional');assert.ok(d.scenarios[1].assumptions.includes('standalone_zero_opening_inventory'));
 assert.equal(d.scenarios[1].beforeReset.kind,'unknown');
});
test('invalid decimals, sensitivity, timestamps and profile values fail closed',()=>{
 const {h,f}=forecastEvidence(); const p=profile();
 for(const v of ['-1','1'.repeat(257),'synthetic-html-marker','NaN'])assert.equal(buildDemand(f,h,{asOf:p.confirmedAt,futureCycleCredits:[v]},p,1,p.confirmedAt).status,'unavailable');
 assert.equal(buildDemand(f,h,{asOf:p.confirmedAt,futureCycleCredits:['0'],lowFactor:'1.1'},p,1,p.confirmedAt).status,'unavailable');
 assert.equal(buildDemand(f,h,{asOf:'2030-02-30T00:00:00Z',futureCycleCredits:['0']},p,1,p.confirmedAt).status,'unavailable');
 assert.equal(buildDemand(f,h,{asOf:p.confirmedAt,futureCycleCredits:['0']},{...p,planRemaining:known('-1')},1,p.confirmedAt).status,'unavailable');
});
test('anchor age and mismatch disclosed; reset conflict blocked; leap and UTC schedule preserved',()=>{
 const {h,f}=forecastEvidence(); const p=profile({confirmedAt:'2032-02-01T01:00:00+01:00',resetAt:'2032-02-01T00:00:00Z'});
 const d=buildDemand(f,h,{asOf:p.confirmedAt,beforeReset:'0',futureCycleCredits:['1']},p,3,p.confirmedAt);
 assert.equal(Date.parse(d.scenarios[1].futureCycles[0].to)-Date.parse(d.scenarios[1].futureCycles[0].from),29*86400000);
 assert.equal(Date.parse(d.scenarios[1].futureCycles[1].to)-Date.parse(d.scenarios[1].futureCycles[1].from),31*86400000);
 const old=profile({confirmedAt:'2030-01-02T00:00:00Z',resetAt:'2030-02-01T00:00:00Z'});
 const stale=buildDemand(f,h,{asOf:'2030-01-03T01:00:00Z',futureCycleCredits:['1']},old,1,'2030-01-04T00:00:00Z');
 assert.equal(stale.status,'conditional'); assert.ok(stale.reasons.includes('inventory_anchor_mismatch'));assert.ok(stale.reasons.includes('inventory_stale'));
 assert.equal(buildDemand(f,h,{asOf:old.confirmedAt,futureCycleCredits:['1']},{...old,resetAt:'2030-02-02T00:00:00Z'},1,old.confirmedAt).status,'unavailable');
});
test('quantum, subcent, signed savings and comparisons stay exact',()=>{
 assert.equal(fmt(ceilToQuantum(r('0.000000001'),r('1')),0,'floor'),'1');
 assert.equal(fmt(multiplyRational(r('0.01'),r('0.04')),6,'half_up'),'0.0004');
 assert.equal(fmt(r('-0.005'),2,'floor'),'-0.01');assert.equal(fmt(r('-0.005'),2,'ceil'),'0');assert.equal(fmt(r('-0.005'),2,'half_up'),'-0.01');
 assert.equal(compareRational(r('20.0000000000000000001'),r('20')),1);
 assert.throws(()=>r('1'.repeat(257)),/invalid_amount/);assert.throws(()=>ceilToQuantum(r('1'),r('0')),/invalid_quantum/);
});

test('regular forecast tier preserved and malformed midnight rejected',()=>{
 const {h,f}=forecastEvidence();const bad=structuredClone(f);bad.policy.regular.minimumSnapshots=7 as any;
 const p=profile({confirmedAt:f.asOf!,resetAt:f.resetAt});assert.equal(buildDemand(bad,h,null,p,1,f.asOf!).status,'unavailable');
 const midnight=profile({confirmedAt:'2030-01-01T24:00:00Z',resetAt:'2030-02-01T00:00:00Z'});
 assert.equal(buildDemand(f,h,{asOf:midnight.confirmedAt,futureCycleCredits:['1']},midnight,1,'2030-01-02T00:00:00Z').status,'unavailable');
});

test('eight comparable daily observations preserve regular forecast quality',async()=>{
 const {history}=await import('../../src/history.ts');const {forecast}=await import('../../src/forecast.ts');
 const h=history(Array.from({length:8},(_,i)=>({observedAt:`2030-01-0${i+1}T00:00:00Z`,usage:String(i),limit:'1000',resetAt:'2030-02-01T00:00:00Z',flags:[],partition:'synthetic-partition',associated:true,overages:null,overageCap:null} as any)));
 const f=forecast(h,'2030-01-08T00:00:00Z'),p=profile({confirmedAt:f.asOf!,resetAt:f.resetAt});const d=buildDemand(f,h,null,p,1,f.asOf!);
 assert.equal(d.status,'available');assert.equal(d.scenarios[1].source,'forecast_regular');assert.deepEqual(d.scenarios[1].futureCycles[0].credits,{numerator:28n,denominator:1n});
});
