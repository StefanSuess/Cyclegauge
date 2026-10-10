import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecast } from '../../src/forecast.ts';
import { history, DAY_MS } from '../../src/history.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';
import type { StoredSnapshot } from '../../src/store.ts';
const start=Date.parse('2030-06-01T00:00:00Z');
const series=(values: string[], offset=0) => values.map((value,i) => snapshot(new Date(start+(i+offset)*DAY_MS).toISOString(),value));
const steady=() => series(['0','10','20','30','40','50','60','70']);
const run=(s: StoredSnapshot[], now=s.at(-1)!.observedAt) => forecast(history(s),now);

test('consistent daily observations yield qualified forecasts, exact projections and budget comparison', () => {
 const r=run(steady()); assert.equal(r.status,'qualified'); assert.equal(r.selectedMethod,'rolling_7_day');
 const f=r.estimates.find(e => e.method==='rolling_7_day')!;
 assert.equal(f.ratePerDay,'10'); assert.equal(f.projectedUsageAtReset,'300'); assert.equal(f.projectedRemainingBaseAtReset,'700');
 assert.equal(f.estimatedExhaustionDayUTC,null); assert.equal(f.budgetComparison,'within_budget');
 assert.equal(r.remainingBaseCredits,'930'); assert.equal(r.dynamicDailyBudget,'40.434782');
 assert.equal(r.estimates.find(e => e.method==='cycle_to_date')?.status,'unavailable');
 assert.ok(r.assumptions.includes('net_counter_changes_not_gross_charges'));
 assert.ok(!JSON.stringify(r).includes('partition')); assert.ok(!JSON.stringify(r).includes('synthetic-private'));
});
test('increasing and decreasing seven-day consumption trends require two full observed windows', () => {
 for (const [increments,expected] of [[['10','20'],'increasing'],[['20','10'],'decreasing'],[['10','10'],'steady']] as const) {
  const values=['0']; let amount=0; for(let i=0;i<14;i++){amount+=Number(increments[i<7?0:1]);values.push(String(amount));}
  assert.equal(run(series(values)).recentTrend.direction,expected);
 }
 assert.equal(run(steady()).recentTrend.direction,'unavailable');
});
test('missing days limit clean windows; sparse snapshots withhold forecasts without allocating gaps', () => {
 const missing=steady().filter((_,i)=>i!==3); const r=run(missing);
 assert.equal(r.tier,'provisional'); assert.equal(r.estimates.find(e=>e.method==='observed_window')?.windowFrom,'2030-06-05T00:00:00.000Z');
 assert.equal(run([steady()[0],steady()[7]]).status,'unavailable');
 assert.equal(run(steady().slice(0,7)).tier,'provisional');
 assert.equal(run(series(['100','110','120','130','140','150','160','170'],10)).status,'qualified');
 assert.equal(run(series(['100','110','120','130','140','150','160','170'],10)).estimates[0].reasons.includes('cycle_start_unknown'),true);
});
test('cycle-to-date uses evidence-backed start and resets cannot reuse the old rate', () => {
 const old=snapshot('2030-05-31T22:00:00Z','900',{resetAt:'2030-06-01T00:00:00.000Z'});
 const r=run([old,...steady()]); const f=r.estimates.find(e=>e.method==='cycle_to_date')!;
 assert.equal(f.status,'qualified'); assert.equal(f.ratePerDay,'10');
 const next=snapshot('2030-07-01T01:00:00Z','1',{resetAt:'2030-08-01T00:00:00.000Z'});
 assert.equal(run([...steady(),next]).status,'unavailable');
 assert.equal(run(steady(),'2030-07-01T00:00:00Z').status,'unavailable');
 assert.ok(run(steady(),'2030-07-01T00:00:00Z').reasons.includes('reset_elapsed'));
});
test('stale/future/invalid observations never yield forecasts or dynamic budgets', () => {
 for(const now of ['2030-06-09T00:00:00.001Z','2030-06-07T23:59:59Z','invalid']){
  const r=run(steady(),now);assert.equal(r.status,'unavailable');assert.equal(r.dynamicDailyBudget,null);
 }
 assert.equal(run(steady(),'2030-06-09T00:00:00Z').status,'qualified');
});
test('adjustments and limit changes require a fresh clean window with its own tier', () => {
 const adjusted=steady(); adjusted[3].usage='19';
 assert.equal(run(adjusted).tier,'provisional');
 const changed=steady();changed[3].limit='2000';assert.equal(run(changed).tier,'provisional');
 const recovered=series(['100','90','100','110','120','130','140','150','160']);
 const r=run(recovered);assert.equal(r.status,'qualified');assert.equal(r.estimates[0].status,'unavailable');
 assert.ok(r.assumptions.includes('history_quality_barrier'));
});
test('conditional exhaustion uses exact decimals and gives only a UTC day, shortfall stays negative', () => {
 const s=series(['0','10','20','30','40','50','60','70']).map(p=>({...p,limit:'100'}));
 const f=run(s).estimates.find(e=>e.method==='rolling_7_day')!;
 assert.equal(f.estimatedExhaustionDayUTC,'2030-06-11');assert.equal(f.projectedRemainingBaseAtReset,'-200');assert.equal(f.budgetComparison,'above_budget');
 const zero=run(series(Array(8).fill('0')));assert.equal(zero.status,'qualified');assert.equal(zero.estimates[1].estimatedExhaustionDayUTC,null);
 const precise=series(['0','0.1','0.2','0.3','0.4','0.5','0.6','0.7']).map(p=>({...p,limit:'1'}));
 assert.equal(run(precise).estimates[1].projectedUsageAtReset,'3');assert.equal(run(precise).estimates[1].estimatedExhaustionDayUTC,'2030-06-11');
 assert.equal(run(s.map(p=>({...p,limit:'60'}))).estimates[1].exhaustionStatus,'already_exhausted_as_of');
});
test('projection anchors to snapshot time, not query time; exact rolling endpoints are mandatory', () => {
 const r=run(steady(),'2030-06-08T12:00:00Z');assert.equal(r.estimates[1].projectedUsageAtReset,'300');
 assert.equal(r.dynamicDailyBudget,'41.333333');
 const uneven=steady();uneven[0].observedAt='2030-05-31T23:00:00Z';
 const q=run(uneven);assert.equal(q.status,'qualified');assert.equal(q.selectedMethod,'observed_window');assert.equal(q.estimates[1].status,'unavailable');
});
test('conflicts, unknown accounts, extras and missing billing never masquerade as adequate history', () => {
 const s=steady();assert.equal(run([...s,{...s[7],usage:'71'}]).status,'unavailable');
 assert.equal(run(s.map(p=>({...p,associated:false}))).status,'unavailable');
 assert.equal(run(s.map(p=>({...p,flags:['unsupported_extra_credits']}))).status,'unavailable');
 assert.equal(run(s.map(p=>({...p,usage:null}))).status,'unavailable');
});

test('final projected fields each truncate the exact rational result, never a subtotal', () => {
 const s=series(['0.0000009','0.1000009','0.2000009','0.3000009','0.4000009','0.5000009','0.6000009','1.0000009']).map(p=>({...p,limit:'5'}));
 const f=run(s).estimates[1];
 assert.equal(f.projectedUsageAtReset,'4.285715');assert.equal(f.projectedRemainingBaseAtReset,'0.714284');
});

test('sub-millisecond exhaustion before reset retains the preceding UTC day without rounding past reset', () => {
 const s=series(['0','1','2','3','4','5','6','7']).map(p=>({...p,limit:'29.9999999999'}));
 assert.equal(run(s).estimates[1].exhaustionStatus,'conditional_before_reset');
 assert.equal(run(s).estimates[1].estimatedExhaustionDayUTC,'2030-06-30');
 assert.equal(run(s.map(p=>({...p,limit:'30'}))).estimates[1].estimatedExhaustionDayUTC,null);
});

// Removing tier gates or crossing a quality barrier must fail these cases.
test('progresses at 48 hours to provisional and at seven days to regular, using observed endpoints', () => {
 assert.equal(run(steady().slice(0,2)).tier,'unavailable');
 const early=run(steady().slice(0,3));
 assert.equal(early.tier,'provisional'); assert.equal(early.selectedMethod,'observed_window');
 const f=early.estimates.find(e=>e.method===early.selectedMethod)!;
 assert.equal(f.tier,'provisional'); assert.equal(f.windowDays,'2'); assert.equal(f.snapshotCount,3);
 assert.equal(f.projectedUsageAtReset,'300'); assert.equal(f.projectedRemainingBaseAtReset,'700');
 assert.equal(early.estimates.find(e=>e.method==='rolling_7_day')?.status,'unavailable');
 assert.equal(run(steady().slice(0,7)).tier,'provisional');
 const sevenPoints=Array.from({length:7},(_,i)=>snapshot(new Date(start+i*28*3600000).toISOString(),String(i*10)));
 assert.equal(run(sevenPoints).tier,'provisional');
 assert.equal(run(steady()).tier,'regular');
 assert.equal(run(steady()).estimates[1].tier,'regular');
 assert.ok(!('confidence' in early));
});
test('early estimates require three distinct points, full 48 hours and gaps at most 36 hours', () => {
 assert.equal(run([steady()[0],steady()[2]]).tier,'unavailable');
 assert.equal(run([steady()[0],steady()[0],steady()[2]]).tier,'unavailable');
 const short=steady().slice(0,3);short[2].observedAt='2030-06-02T23:59:59.999Z';
 assert.equal(run(short).tier,'unavailable');
 const boundary=[snapshot('2030-06-01T00:00:00Z','0'),snapshot('2030-06-02T12:00:00Z','15'),snapshot('2030-06-03T00:00:00Z','20')];
 assert.equal(run(boundary).tier,'provisional');
 boundary[1].observedAt='2030-06-02T12:00:00.001Z';
 assert.equal(run(boundary).tier,'unavailable');
 const sparse=steady().filter((_,i)=>i%2===0);assert.equal(run(sparse).tier,'unavailable');
});
test('provisional freshness, continuity and anomalies fail closed and recover only on clean evidence', () => {
 const early=steady().slice(0,3);
 assert.equal(run(early,'2030-06-04T00:00:00Z').tier,'provisional');
 assert.equal(run(early,'2030-06-04T00:00:00.001Z').tier,'unavailable');
 for(const changes of [{partition:'synthetic-other-account'},{associated:false},{limit:'2000'},{usage:null},{usage:'9'},{flags:['unsupported_extra_credits']}]) {
  const broken=early.map(p=>({...p}));Object.assign(broken[2],changes);
  assert.equal(run(broken).tier,'unavailable');
 }
 assert.equal(run([...early,{...early[2],usage:'21'}]).tier,'unavailable');
 const afterGap=steady().filter((_,i)=>i!==3);
 assert.equal(run(afterGap).tier,'provisional');
 const f=run(afterGap).estimates.find(e=>e.method==='observed_window')!;
 assert.equal(f.windowDays,'3');assert.equal(f.snapshotCount,4);
 assert.equal(run(afterGap).coverage.unknownUtcDays,2);
});
test('reset discards old evidence and needs a new 48-hour window; early exhaustion and zero rates are conditional', () => {
 const next=series(['0','10','20'],30).map(p=>({...p,resetAt:'2030-08-01T00:00:00.000Z'}));
 assert.equal(run([...steady(),...next.slice(0,2)]).tier,'unavailable');
 const r=run([...steady(),...next]);assert.equal(r.tier,'provisional');
 assert.equal(r.estimates.find(e=>e.method==='observed_window')?.windowFrom,'2030-07-01T00:00:00.000Z');
 const exhausted=run(steady().slice(0,3).map(p=>({...p,limit:'25'}))).estimates[2];
 assert.equal(exhausted.estimatedExhaustionDayUTC,'2030-06-03');
 assert.equal(exhausted.projectedRemainingBaseAtReset,'-275');
 const zero=run(series(['0','0','0'])).estimates[2];
 assert.equal(zero.estimatedExhaustionDayUTC,null);assert.equal(zero.exhaustionStatus,'zero_observed_rate');
});
