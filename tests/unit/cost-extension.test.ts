import {test} from 'node:test';
import {view} from '../../src/view.ts';
import assert from 'node:assert/strict';
import {parseAmount,calculateCosts} from '../../src/extension/cost-inputs.ts';
import {presentCost} from '../../src/extension/cost-presentation.ts';
import {profile,request,forecastEvidence,syntheticCatalog} from './cost-synthetic.ts';
import {optimizeCosts} from '../../src/cost/optimize.ts';
const now='2030-01-15T00:00:00Z';
function native(answers:(string|string[]|undefined)[]){return {async pick(){return answers.shift() as string|undefined;},async input(){return answers.shift() as string|undefined;},async plans(){return answers.shift() as string[]|undefined;}};}
const independent={mode:'independent' as const,profile:profile({confirmedAt:now,currentPlan:null,resetAt:null}),monthlyCredits:'1200',beforeReset:undefined,demandMode:'manual' as const};

test('amount input preserves precision and rejects invalid values with no echo',()=>{
 assert.equal(parseAmount('0'),'0');assert.equal(parseAmount('1.2500'),'1.25');assert.equal(parseAmount('-1'),null);
 assert.equal(parseAmount('synthetic-private-sentinel'),null);
});
test('renderer separates periods, costs, signed savings, alternatives, assumptions and references',()=>{
 const o=optimizeCosts(request('1050',3));const html=presentCost(o);
 for(const marker of ['Cost comparison','Before reset','Full billing cycles','USD','pre-tax','Pro+','Sensitivity','Assumptions','conditional','this session only'])assert.ok(html.includes(marker),marker);
 assert.match(html, /70/);assert.match(html, /-50/);assert.ok(!html.includes('command:'));assert.ok(!html.includes('<script'));
 const inert=structuredClone(o);inert.reasons=['<img src=x onerror=synthetic-sentinel>'];inert.catalogVersion='<script>synthetic-sentinel</script>';
 const safe=presentCost(inert);assert.ok(!safe.includes('<img'));assert.ok(!safe.includes('<script'));assert.ok(!safe.includes('onerror='));
 const standalone=optimizeCosts(request('1200'));standalone.baselineStrategyId=null;standalone.savings.forEach(s=>{s.future=null;s.bridge=null;});
 assert.ok(presentCost(standalone).includes('Savings unavailable'));
});
test('personalized manual mode retains stale inventory and bridge uncertainty; forecast fails closed',()=>{
 const {h,f}=forecastEvidence();const input={...independent,mode:'personalized' as const,profile:profile({confirmedAt:now,resetAt:'2030-02-01T00:00:00Z',purchased:{kind:'unknown'}})};
 const results=calculateCosts(input,f,h,'2030-01-17T00:00:00Z',syntheticCatalog());
 assert.ok(results[0].result?.scenarios.some(s=>s.reasons.includes('bridge_inventory_unknown')));
 const forecast=calculateCosts({...input,demandMode:'forecast'},f,h,now,syntheticCatalog());assert.equal(forecast[0].result,null);assert.ok(forecast[0].reasons.length);
});

import {mkdtemp,mkdir,writeFile,appendFile,rm,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {startExtension} from '../../src/extension/controller.ts';
const line=(id:string,date='2030-01-15 00:00:00.000')=>`${date} [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:id},nextDateReset:'2030-02-01T00:00:00.000Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:100,usageLimitWithPrecision:1000,nextDateReset:'2030-02-01T00:00:00.000Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n';
async function setup(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'synthetic-cost-extension-'))),source=join(base,'Kiro'),storage=join(base,'owned'),dir=join(source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 await mkdir(dir,{recursive:true});const log=join(dir,'q-client.log');await writeFile(log,line('synthetic-a'));
 return {base,source,storage,log};
}
test('native security and comparison wiring exclude command URI bridges, persistence and exact analysis',async()=>{
 const nativeSource=await readFile(new URL('../../src/extension/extension.ts',import.meta.url),'utf8');
 assert.match(nativeSource,/enableScripts: false/);assert.match(nativeSource,/enableCommandUris: false/);assert.match(nativeSource,/advisorItem\.command = commandId\('costAdvisor'\)/);assert.match(nativeSource,/advisorItem\.show\(\)/);
 assert.match(nativeSource,/showQuickPick/);assert.match(nativeSource,/showInputBox/);
 const source=await readFile(new URL('../../src/extension/cost-inputs.ts',import.meta.url),'utf8');
 assert.ok(!source.includes('findBreakEven('));assert.ok(!source.includes('globalState'));assert.ok(!source.includes('workspaceState'));
});

test('manual comparisons work with no history and disclose catalog review age',()=>{
 const empty=view([],now);const catalog=syntheticCatalog();catalog.verifiedOn='2029-01-01T00:00:00Z';
 const results=calculateCosts(independent,empty.forecast,empty.history,now,catalog);
 assert.ok(results.every(h=>h.result?.scenarios.length));
 assert.ok(results.every(h=>h.result?.scenarios.some(s=>s.reasons.includes('catalog_review_due'))));
 assert.ok(presentCost(results[0].result!).includes('due for review'));
});
test('calculation failure has fixed diagnostics without echoing private input',()=>{
 const empty=view([],now),bad:any={...independent,profile:null,monthlyCredits:'synthetic-private-input'};
 const results=calculateCosts(bad,empty.forecast,empty.history,now);
 assert.ok(results.every(h=>h.result===null&&h.reasons[0]==='cost_optimizer_unavailable'));
 assert.ok(!JSON.stringify(results).includes('synthetic-private-input'));
});

test('missing keep-current baseline does not hide valid personalized before-reset costs',()=>{
 const q=request('100',1,profile({confirmedAt:now,resetAt:'2030-02-01T00:00:00Z',allowedPlans:['pro_plus']}));
 const o=optimizeCosts(q);assert.equal(o.baselineStrategyId,null);
 const html=presentCost(o);
 assert.ok(html.includes('Before reset — new expenditure</dt><dd>USD 20'));
 assert.ok(!html.includes('Excluded / no personalized baseline'));
 assert.ok(html.includes('Savings unavailable'));
});
