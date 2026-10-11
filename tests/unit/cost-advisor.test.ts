import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,rm,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {planHint,advisorProfile,classifyAdvice,noAnswers,type AdvisorAnswers,type AdvisorContext} from '../../src/cost/advisor.ts';
import {calculateCosts} from '../../src/extension/cost-inputs.ts';
import {AdvisorInputs,reviewAdvisor} from '../../src/extension/advisor-inputs.ts';
import {presentAdvisor} from '../../src/extension/advisor-presentation.ts';
import {startExtension} from '../../src/extension/controller.ts';
import {reviewedCatalog} from '../../src/cost/catalog.ts';
import {forecastEvidence,syntheticCatalog,request} from './cost-synthetic.ts';
import {optimizeCosts} from '../../src/cost/optimize.ts';
import type {CostOptimization} from '../../src/cost/types.ts';

const now='2030-01-04T00:00:00Z';
const catalog=reviewedCatalog;
const ctx=(over:Partial<AdvisorContext>={}):AdvisorContext=>({planSource:'confirmed',plan:'pro',billingConfirmed:true,addOns:'none',assumptions:[],...over});
const optimization=(over:Partial<CostOptimization>={}):CostOptimization=>({
 schemaVersion:1,status:'available',catalogVersion:'synthetic-v1',reasons:[],scenarios:[],baselineStrategyId:'pro_keep_as_needed',
 recommendation:{strategyId:'pro_keep_as_needed',demandIds:['low','base','high'],kind:'supported_comparison'},
 alternatives:[{demandId:'base',strategyId:'pro_keep_as_needed',status:'available'}],savings:[],savingsRange:null,
 breakEven:{status:'unavailable',reasons:[],basis:'single_full_cycle_no_opening_lots',points:[],intervals:[],assumptions:[],evaluatedUsageRange:null},...over});

test('plan inference is a hint with a confidence label, never a unique identification',()=>{
 for(const [limit,plan] of [['50','free'],['1000','pro'],['2000','pro_plus'],['5000','pro_max'],['10000','power'],['1000.00','pro']] as const){
  const h=planHint(limit,catalog);assert.equal(h.plan,plan);assert.equal(h.confidence,'moderate');
  assert.ok(h.reasons.includes('limit_semantics_unverified'));assert.ok(h.reasons.includes('nominal_match_only'));
 }
 for(const limit of ['1125','0','49.99','1000.5','-1','synthetic-private-text',null]){
  const h=planHint(limit as string|null,catalog);assert.equal(h.plan,null);assert.equal(h.confidence,'none');
  assert.ok(h.reasons.includes('limit_semantics_unverified'));
 }
});
test('explicit selection takes precedence and a changed reported limit alone does not invalidate it',()=>{
 const obs={limit:'2000',usage:'10',asOf:'2030-01-04T00:00:00.000Z',resetAt:'2030-02-01T00:00:00Z'};
 const answers:AdvisorAnswers={...noAnswers,plan:'pro'};
 const a=advisorProfile(obs,answers,planHint('2000',catalog));
 assert.equal(a.context.planSource,'confirmed');assert.equal(a.profile?.currentPlan,'pro');
 const b=advisorProfile({...obs,limit:'1125'},answers,planHint('1125',catalog));
 assert.equal(b.context.planSource,'confirmed');assert.equal(b.profile?.currentPlan,'pro');
 const hinted=advisorProfile(obs,noAnswers,planHint('2000',catalog));
 assert.equal(hinted.context.planSource,'hint');assert.ok(hinted.context.assumptions.includes('plan_is_hint'));
 const unknown=advisorProfile({...obs,limit:'1125'},noAnswers,planHint('1125',catalog));
 assert.equal(unknown.context.planSource,'unknown');assert.equal(unknown.profile?.currentPlan,null);
});
test('unknown add-ons are never silently zero: they become a labelled assumption, not a fact',()=>{
 const obs={limit:'1000',usage:'100',asOf:'2030-01-04T00:00:00.000Z',resetAt:'2030-02-01T00:00:00Z'};
 const unsure=advisorProfile(obs,{...noAnswers,plan:'pro',billing:'consumer_prepaid'},planHint('1000',catalog));
 assert.equal(unsure.context.addOns,'assumed_none');assert.ok(unsure.context.assumptions.includes('add_ons_assumed_none'));
 const none=advisorProfile(obs,{...noAnswers,plan:'pro',billing:'consumer_prepaid',addOns:'none'},planHint('1000',catalog));
 assert.equal(none.context.addOns,'none');assert.deepEqual(none.context.assumptions,[]);
 assert.deepEqual(none.profile?.planRemaining,{kind:'known',value:'900'});
 const someUnknown=advisorProfile(obs,{...noAnswers,plan:'pro',billing:'consumer_prepaid',addOns:'some'},planHint('1000',catalog));
 assert.deepEqual(someUnknown.profile?.purchased,{kind:'unknown'});assert.deepEqual(someUnknown.profile?.planRemaining,{kind:'unknown'});
 const some=advisorProfile(obs,{...noAnswers,plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:'125.5'},planHint('1000',catalog));
 assert.deepEqual(some.profile?.purchased,{kind:'known',value:[{remainingCredits:'125.5',expiresAt:null,expiryPrecision:'unknown'}]});
 assert.deepEqual(some.profile?.planRemaining,{kind:'unknown'});
 assert.equal(advisorProfile({...obs,resetAt:null},noAnswers,planHint('1000',catalog)).profile,null);
});
test('four advice outcomes; savings and "no action" need every input to be explicit',()=>{
 assert.equal(classifyAdvice(null,ctx()).kind,'insufficient_information');
 assert.equal(classifyAdvice(optimization({status:'unavailable',baselineStrategyId:null,recommendation:null,alternatives:[]}),ctx()).kind,'insufficient_information');
 assert.equal(classifyAdvice(optimization(),ctx()).kind,'no_action');
 const better=optimization({recommendation:{strategyId:'pro_plus_next_reset_as_needed',demandIds:['base'],kind:'supported_comparison'},savingsRange:{minimum:{currency:'USD',amount:'4'},maximum:{currency:'USD',amount:'9'}}});
 assert.equal(classifyAdvice(better,ctx()).kind,'potential_savings');
 const zero=optimization({recommendation:{strategyId:'pro_plus_next_reset_as_needed',demandIds:['base'],kind:'supported_comparison'},savingsRange:{minimum:{currency:'USD',amount:'0'},maximum:{currency:'USD',amount:'9'}}});
 assert.equal(classifyAdvice(zero,ctx()).kind,'conditional_comparison');
 // Any open assumption or engine condition downgrades both of the positive outcomes.
 for(const open of [['plan_is_hint'],['billing_assumed_consumer'],['add_ons_assumed_none']]){
  assert.equal(classifyAdvice(better,ctx({assumptions:open})).kind,'conditional_comparison',open.join());
  assert.equal(classifyAdvice(optimization(),ctx({assumptions:open})).kind,'conditional_comparison',open.join());
 }
 assert.equal(classifyAdvice(better,ctx({addOns:'some'})).kind,'conditional_comparison');
 assert.equal(classifyAdvice(better,ctx({planSource:'hint',assumptions:['plan_is_hint']})).kind,'conditional_comparison');
 assert.equal(classifyAdvice(optimization({status:'conditional'}),ctx()).kind,'conditional_comparison');
 assert.equal(classifyAdvice(optimization({reasons:['purchased_inventory_unknown']}),ctx()).kind,'conditional_comparison');
 assert.equal(classifyAdvice(optimization({recommendation:{strategyId:'x',demandIds:['base'],kind:'conditional_estimate'}}),ctx()).kind,'conditional_comparison');
});
test('forecast-derived demand reaches the optimizer (regression: assumption codes were rejected)',()=>{
 const {h,f}=forecastEvidence();
 const obs={limit:'1000',usage:'1',asOf:f.asOf,resetAt:f.resetAt};
 const built=advisorProfile(obs,{...noAnswers,plan:'pro',billing:'consumer_prepaid',addOns:'none'},planHint('1000',syntheticCatalog()));
 const horizons=calculateCosts({mode:'personalized',profile:built.profile!,monthlyCredits:'0',beforeReset:undefined,demandMode:'forecast'},f,h,now,syntheticCatalog());
 assert.ok(horizons.every(x=>x.result!==null),JSON.stringify(horizons.map(x=>x.reasons)));
 assert.ok(horizons[0].result!.scenarios.length>0);
 // Fully explicit answers still yield only a conditional comparison: the engine labels every priced result conditional.
 const advice=horizons.map(x=>classifyAdvice(x.result,built.context));
 assert.ok(advice.every(a=>a.kind==='conditional_comparison'),JSON.stringify(advice));
 // With unknown add-ons the same inputs may never produce savings or "no action".
 const hypothetical=advisorProfile(obs,noAnswers,planHint('1000',syntheticCatalog()));
 const h2=calculateCosts({mode:'personalized',profile:hypothetical.profile!,monthlyCredits:'0',beforeReset:undefined,demandMode:'forecast'},f,h,now,syntheticCatalog());
 assert.ok(h2.map(x=>classifyAdvice(x.result,hypothetical.context).kind).every(k=>k==='conditional_comparison'||k==='insufficient_information'));
});
test('real optimizer results never reach the positive outcomes today (engine marks every comparison conditional)',()=>{
 for(const credits of ['100','900','1050','1800','4000'])for(const horizon of [1,3] as const){
  const result=optimizeCosts(request(credits,horizon));
  assert.equal(result.status,'conditional');
  const kind=classifyAdvice(result,ctx()).kind;
  assert.equal(kind,'conditional_comparison',`${credits}/${horizon}`);
 }
});
test('ambiguous limits make the plan remainder unknown and add visible conditions',()=>{
 const base={asOf:'2030-01-04T00:00:00.000Z',resetAt:'2030-02-01T00:00:00Z'};
 const answers:AdvisorAnswers={plan:'pro',billing:'consumer_prepaid',addOns:'none',addOnCredits:null};
 const over=advisorProfile({...base,limit:'1000',usage:'1200'},answers,planHint('1000',catalog));
 assert.deepEqual(over.profile?.planRemaining,{kind:'unknown'});assert.ok(over.context.assumptions.includes('usage_exceeds_reported_limit'));
 const differs=advisorProfile({...base,limit:'2000',usage:'10'},answers,planHint('2000',catalog));
 assert.deepEqual(differs.profile?.planRemaining,{kind:'unknown'});assert.ok(differs.context.assumptions.includes('limit_differs_from_plan_credits'));
 assert.equal(differs.context.plan,'pro');
 const fine=advisorProfile({...base,limit:'1000',usage:'10'},answers,planHint('1000',catalog));
 assert.deepEqual(fine.profile?.planRemaining,{kind:'known',value:'990'});assert.deepEqual(fine.context.assumptions,[]);
 // Both cases force a conditional outcome even on an otherwise perfect optimizer result.
 assert.equal(classifyAdvice(optimization(),differs.context).kind,'conditional_comparison');
 assert.equal(classifyAdvice(optimization(),over.context).kind,'conditional_comparison');
});
test('Enterprise keeps prepaid add-ons unknown, drops an impossible Free plan and never assumes zero add-ons',()=>{
 const obs={limit:'50',usage:'1',asOf:'2030-01-04T00:00:00.000Z',resetAt:'2030-02-01T00:00:00Z'};
 const e=advisorProfile(obs,{plan:null,billing:'enterprise_postpaid',addOns:null,addOnCredits:null},planHint('50',catalog));
 assert.equal(e.context.planSource,'unknown');assert.equal(e.profile?.currentPlan,null);
 assert.deepEqual(e.profile?.purchased,{kind:'unknown'});assert.ok(e.context.assumptions.includes('enterprise_inputs_unconfirmed'));
 assert.ok(!e.context.assumptions.includes('add_ons_assumed_none'));assert.ok(!e.profile!.allowedPlans.includes('free'));
 const chosen=advisorProfile(obs,{plan:'free',billing:'enterprise_postpaid',addOns:null,addOnCredits:null},planHint('50',catalog));
 assert.equal(chosen.profile?.currentPlan,null);
});
test('engine conditions are shown to the user, not hidden behind the strategy name',()=>{
 const o=optimizeCosts(request('1800',1));
 const horizons=[{months:1 as const,result:o,reasons:[]}];
 const context=ctx();const advice=horizons.map(h=>classifyAdvice(h.result,context));
 assert.ok(advice[0].reasons.length>0);
 const html=presentAdvisor({hint:planHint('1000',catalog),context,horizons,advice,singleAccount:true,limit:'1000'});
 assert.ok(html.includes('Conditions that apply'));assert.ok(html.includes('Different demand levels favor different strategies'));
 const hinted=presentAdvisor({hint:planHint('1000',catalog),context:ctx({planSource:'hint',assumptions:['plan_is_hint']}),horizons:[],advice:[],singleAccount:true,limit:'1000'});
 assert.ok(hinted.includes('Hint confidence: moderate'));
});
test('add-on balance caveat and hand-built inconsistent contexts are surfaced and never positive',()=>{
 const horizons=[{months:1 as const,result:optimization(),reasons:[]}];
 const some=ctx({addOns:'some'});const advice=horizons.map(h=>classifyAdvice(h.result,some));
 assert.equal(advice[0].kind,'conditional_comparison');
 const html=presentAdvisor({hint:planHint('1000',catalog),context:some,horizons,advice,singleAccount:true,limit:'1000'});
 assert.ok(html.includes('entered by you and are not verified'));
 for(const bad of [{planSource:'hint' as const},{billingConfirmed:false},{addOns:'unknown' as const},{addOns:'assumed_none' as const}])
  assert.equal(classifyAdvice(optimization(),ctx(bad)).kind,'conditional_comparison',JSON.stringify(bad));
 const better=optimization({recommendation:{strategyId:'pro_plus_next_reset_as_needed',demandIds:['base'],kind:'supported_comparison'},savingsRange:{minimum:{currency:'USD',amount:'4'},maximum:{currency:'USD',amount:'9'}}});
 assert.equal(classifyAdvice(better,ctx({planSource:'unknown',plan:null})).kind,'conditional_comparison');
});
test('native questions are minimal, cancellable and keep unknown as unknown',async()=>{
 const native=(answers:(string|undefined)[])=>({async pick(){return answers.shift();},async input(){return answers.shift();},async plans(){return undefined;}});
 const hint=planHint('1000',catalog);
 assert.deepEqual(await reviewAdvisor(native(['unsure','unsure','unsure']),hint,noAnswers),{plan:null,billing:null,addOns:null,addOnCredits:null});
 assert.deepEqual(await reviewAdvisor(native(['plan:pro_plus','consumer_prepaid','some','250']),hint,noAnswers),{plan:'pro_plus',billing:'consumer_prepaid',addOns:'some',addOnCredits:'250'});
 assert.deepEqual(await reviewAdvisor(native(['plan:pro','consumer_prepaid','some','']),hint,noAnswers),{plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:null});
 const asked:string[]=[];
 const counting={async pick(t:string){asked.push(t);return asked.length===1?'plan:pro_max':'enterprise_postpaid';},async input(){return undefined;},async plans(){return undefined;}};
 assert.deepEqual(await reviewAdvisor(counting,hint,noAnswers),{plan:'pro_max',billing:'enterprise_postpaid',addOns:null,addOnCredits:null});
 assert.equal(asked.length,2);
 assert.equal(await reviewAdvisor(native([undefined]),hint,noAnswers),null);
 assert.equal(await reviewAdvisor(native(['plan:pro','consumer_prepaid',undefined]),hint,noAnswers),null);
 assert.deepEqual(await reviewAdvisor(native(['plan:free','enterprise_postpaid']),hint,noAnswers),{plan:null,billing:'enterprise_postpaid',addOns:null,addOnCredits:null});
 assert.equal(await reviewAdvisor(native(['plan:pro','consumer_prepaid','some','synthetic-private-text']),hint,noAnswers),null);
});
test('the picker can clear answers in one step and nothing else is asked',async()=>{
 const asked:string[]=[];
 const ui={async pick(t:string){asked.push(t);return 'reset';},async input(){return undefined;},async plans(){return undefined;}};
 assert.deepEqual(await reviewAdvisor(ui,planHint('1000',catalog),{plan:'pro',billing:'consumer_prepaid',addOns:'none',addOnCredits:null}),noAnswers);
 assert.equal(asked.length,1);
});
test('answers cannot cross accounts, ambiguity or stale editor tickets',()=>{
 const state=new AdvisorInputs();state.observe('synthetic-a','single');
 const answers:AdvisorAnswers={...noAnswers,plan:'pro'};
 const t=state.begin();state.observe('synthetic-b','single');assert.equal(state.commit(t,answers),false);
 assert.equal(state.commit(state.begin(),answers),true);assert.equal(state.value.plan,'pro');
 state.observe(null,'ambiguous');assert.equal(state.value.plan,null);assert.equal(state.commit(state.begin(),answers),false);
 const old=state.begin();state.observe('synthetic-c','single');const newer=state.begin();
 assert.equal(state.commit(old,answers),false);assert.equal(state.commit(newer,answers),true);
 state.clear();assert.equal(state.value.plan,null);
});
test('presentation is script-free, escaped, traceable to the catalog and never offers a purchase instruction',()=>{
 const hint=planHint('1000',catalog);
 const html=presentAdvisor({hint,context:ctx({planSource:'hint',plan:'pro',billingConfirmed:false,addOns:'assumed_none',assumptions:['plan_is_hint','billing_assumed_consumer','add_ons_assumed_none']}),horizons:[],advice:[],singleAccount:true,limit:'<img src=x onerror=synthetic-sentinel>'});
 for(const marker of ['Cost Advisor','hint only','not confirmed',catalog.version,catalog.verifiedOn.slice(0,10),'Offline only','Insufficient information'])assert.ok(html.includes(marker),marker);
 assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('command:'));
 assert.ok(!/buy now|purchase now|click to buy/i.test(html));
});
test('advisor modules are offline and storage-free',async()=>{
 for(const file of ['src/cost/advisor.ts','src/extension/advisor-inputs.ts','src/extension/advisor-presentation.ts']){
  const text=await readFile(new URL('../../'+file,import.meta.url),'utf8');
  for(const forbidden of ['vscode','node:fs','node:net','node:http','node:child_process','fetch(','globalState','workspaceState','process.env'])assert.ok(!text.includes(forbidden),`${file} must not use ${forbidden}`);
 }
});

const line=(id:string,date:string,usage:number)=>`${date} [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:id},nextDateReset:'2030-02-01T00:00:00.000Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:usage,usageLimitWithPrecision:1000,nextDateReset:'2030-02-01T00:00:00.000Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n';
async function setup(lines:string){
 const base=await realpath(await mkdtemp(join(tmpdir(),'synthetic-cost-advisor-'))),source=join(base,'Kiro'),storage=join(base,'owned'),dir=join(source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 await mkdir(dir,{recursive:true});const log=join(dir,'q-client.log');await writeFile(log,lines);return {base,source,storage,log};
}
test('detail view shows the advisor first, answers are applied through the native action and cleared on account change',async()=>{
 const lines=['2030-01-01','2030-01-02','2030-01-03','2030-01-04'].map((d,i)=>line('synthetic-a',`${d} 00:00:00.000`,i===3?10:0)).join('');
 const env=await setup(lines);let html='',status='';const commands=new Map<string,()=>Promise<void>>();
 const answers:(string|undefined)[]=[];
 const ui={setStatus(text:string,detail:string){status=text;html=detail;},showDetails(){},onClick(){},onChange(){},everyMinute(){},dispose(){},
  costInput:{async pick(){return answers.shift();},async input(){return answers.shift();},async plans(){return undefined;}},
  onCostCommand(id:string,fn:()=>Promise<void>){commands.set(id,fn);}};
 try{
  const controller=await startExtension(ui,{...env,timezone:'UTC',now:()=>now});
  assert.ok(html.includes('id="cost-advisor"'));assert.ok(!html.includes('Cost Optimizer'));assert.ok(!html.includes('cost-optimizer'));
  // Recommendation at a glance: directly after the current status and before the chart and advanced details.
  assert.ok(html.indexOf('class="outlook"')<html.indexOf('id="cost-advisor"'));assert.ok(html.indexOf('id="cost-advisor"')<html.indexOf('id="advanced-details"'));
  if(html.includes('<svg'))assert.ok(html.indexOf('id="cost-advisor"')<html.indexOf('<svg'));
  assert.ok(commands.has('advisor'));assert.ok(!html.includes('Pro — confirmed by you'));
  if(process.platform==='win32'){
   // Windows storage stays fail-closed: no store opens, so there are no observations. The advisor must still render,
   // say that nothing can be compared, and must not pretend an answer was applied.
   assert.ok(html.includes('Insufficient information'));
   assert.ok(html.includes('storage')||html.includes('Storage'),'the fail-closed storage reason must be visible, not just an empty log');
   answers.push('plan:pro','consumer_prepaid','none');await commands.get('advisor')!();
   assert.ok(!html.includes('Pro — confirmed by you'));assert.ok(!/Potential savings|No action needed/.test(html));
  }else{
   assert.ok(html.includes('hint only'));
   const budget=status;
   answers.push('plan:pro','consumer_prepaid','none');await commands.get('advisor')!();
   assert.ok(html.includes('Pro — confirmed by you'));assert.equal(status,budget);
   assert.ok(!/Potential savings|No action needed/.test(html),'the engine marks every priced comparison conditional');
   await appendFile(env.log,line('synthetic-b','2030-01-04 00:00:01.000',11));await controller.refresh();
   assert.ok(!html.includes('Pro — confirmed by you'));assert.ok(!html.includes('synthetic-a'));assert.ok(!html.includes('synthetic-b'));
  }
  controller.dispose();
 }finally{await rm(env.base,{recursive:true,force:true});}
});
test('manifest exposes the advisor as the first panel title action',async()=>{
 const p=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 assert.ok(p.contributes.commands.some((c:any)=>c.command==='easykirogauge.costAdvisor'&&c.icon==='$(lightbulb)'));
 const menu=p.contributes.menus['editor/title'];assert.equal(menu.length,1);
 const first=menu[0];
 assert.equal(first.command,'easykirogauge.costAdvisor');assert.equal(first.when,'activeWebviewPanelId == easykirogauge.usage');
 const ext=await readFile(new URL('../../src/extension/extension.ts',import.meta.url),'utf8');
 for(const gone of ['configureCostOptimizer','editCostScenario','clearCostInputs'])assert.ok(!p.contributes.commands.some((c:any)=>c.command.endsWith(gone)),gone);
 assert.ok(!JSON.stringify(p.contributes).includes('Cost Optimizer'));
 assert.match(ext,/advisor:'costAdvisor'/);assert.match(ext,/enableScripts: false/);
});
