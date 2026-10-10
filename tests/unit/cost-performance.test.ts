import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {optimizeCosts} from '../../src/cost/optimize.ts';
import {request} from './cost-synthetic.ts';

test('ordinary comparisons never enumerate exact break-even even with complete pack rules and cold refresh times',()=>{
 const start=performance.now();
 for(let i=0;i<3;i++){
  const q=request('1050');q.now=`2030-01-01T00:00:00${['Z','.0Z','.00Z'][i]}`;
  const o=optimizeCosts(q);
  assert.equal(o.scenarios.find(s=>s.demandId==='base'&&s.strategy.id==='pro_keep_as_needed')?.future.totalNewExpenditure?.amount,'25');
  assert.equal(o.breakEven.basis,'conditional_linear_reference');
  assert.equal(o.breakEven.intervals.length,0);
  assert.ok(o.breakEven.reasons.includes('exact_break_even_not_requested'));
 }
 assert.ok(performance.now()-start<1000,'ordinary comparisons exceeded 1 second for three cold calculations');
});
