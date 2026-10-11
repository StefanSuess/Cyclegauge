import {test} from 'node:test';
import {view} from '../../src/view.ts';
import assert from 'node:assert/strict';
import {CostInputs,configureCostInputs,editCostInputs,parseAmount,parseLots,calculateCosts} from '../../src/extension/cost-inputs.ts';
import {presentCost} from '../../src/extension/cost-presentation.ts';
import {profile,request,forecastEvidence,syntheticCatalog} from './cost-synthetic.ts';
import {optimizeCosts} from '../../src/cost/optimize.ts';
const now='2030-01-15T00:00:00Z';
function native(answers:(string|string[]|undefined)[]){return {async pick(){return answers.shift() as string|undefined;},async input(){return answers.shift() as string|undefined;},async plans(){return answers.shift() as string[]|undefined;}};}
const independent={mode:'independent' as const,profile:profile({confirmedAt:now,currentPlan:null,resetAt:null}),monthlyCredits:'1200',beforeReset:undefined,demandMode:'manual' as const};

test('native default independent flow declares assumptions and works without forecast',async()=>{
 const input=await configureCostInputs(native(['independent','consumer_prepaid','1200','confirm']),now);
 assert.ok(input);assert.equal(input.mode,'independent');assert.equal(input.profile.currentPlan,null);
 const {h,f}=forecastEvidence();const results=calculateCosts(input,f,h,now,syntheticCatalog());
 assert.deepEqual(results.map(r=>r.months),[1,3,6]);assert.ok(results.every(r=>r.result?.scenarios.length));
 assert.ok(results.every(r=>r.result?.savings.every(s=>s.future===null)));
});
test('cancel, invalid input and clear/restart do not publish partial profiles',async()=>{
 assert.equal(await configureCostInputs(native(['pro',undefined]),now),null);
 assert.equal(await configureCostInputs(native(['independent','consumer_prepaid','synthetic-invalid']),now),null);
 const state=new CostInputs();state.observe('synthetic-private-key','single');const token=state.begin();
 assert.equal(state.commit(token,independent),true);state.clear();assert.equal(state.value,null);
 assert.equal(state.commit(token,independent),false);assert.equal(new CostInputs().value,null);
});
test('profile cannot cross accounts, ambiguity, concurrent edits or cleared open editors',()=>{
 const state=new CostInputs();state.observe('synthetic-a','single');const token=state.begin();
 state.observe('synthetic-b','single');assert.equal(state.commit(token,independent),false);
 state.commit(state.begin(),independent);state.observe(null,'ambiguous');assert.equal(state.value,null);
 const old=state.begin(),newer=state.begin();assert.equal(state.commit(old,independent),false);assert.equal(state.commit(newer,independent),true);
 assert.ok(!JSON.stringify(state.value).includes('synthetic-b'));
});
test('amount and lot input preserve unknown versus zero, precision and fixed errors',()=>{
 assert.equal(parseAmount('0'),'0');assert.equal(parseAmount('1.2500'),'1.25');assert.equal(parseAmount('-1'),null);
 assert.equal(parseAmount('synthetic-private-sentinel'),null);
 assert.deepEqual(parseLots('[]'),{kind:'known',value:[]});assert.deepEqual(parseLots(''),{kind:'unknown'});
 const lot=parseLots('[{"remainingCredits":"125.25","expiresAt":"2030-12-31T00:00:00Z","expiryPrecision":"instant"}]');
 assert.equal(lot?.kind,'known');assert.equal(parseLots('[{"remainingCredits":"1","expiresAt":null,"expiryPrecision":"instant"}]'),null);
 assert.equal(parseLots('[{"remainingCredits":"1","expiresAt":null,"expiryPrecision":"unknown","synthetic-private":"sentinel"}]'),null);
});
test('advanced lots, cohort, promotions, enterprise and restrictions are explicit',async()=>{
 const lots=await editCostInputs(native(['inventory','none']),independent,now);assert.deepEqual(lots?.profile.purchased,{kind:'known',value:[]});
 const expired=await editCostInputs(native(['inventory',undefined]),independent,now);assert.equal(expired,null);
 const cohort=await editCostInputs(native(['cohort','first_paid_month']),independent,now);assert.equal(cohort?.profile.cohort,'first_paid_month');
 const ent=await editCostInputs(native(['overage','enabled','2500']),independent,now);assert.deepEqual(ent?.profile.enterpriseOverage,{enabled:{kind:'known',value:true},headroomCredits:{kind:'known',value:'2500'}});
 const allowed=await editCostInputs(native(['plans',['pro_plus','power']]),independent,now);assert.deepEqual(allowed?.profile.allowedPlans,['pro_plus','power']);
});
test('renderer separates periods, costs, signed savings, alternatives, assumptions and references',()=>{
 const o=optimizeCosts(request('1050',3));const html=presentCost(o);
 for(const marker of ['Cost Optimizer','Before reset','Full billing cycles','USD','pre-tax','Pro+','Sensitivity','Assumptions','conditional','Session-only'])assert.ok(html.includes(marker),marker);
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
test('controller activation, configuration, open-view edit, refresh and clear preserve budget without expensive analysis',async()=>{
 const env=await setup();let html='',status='',at=now;
 const commands=new Map<string,()=>Promise<void>>();
 const answers:(string|undefined)[]=['independent','consumer_prepaid','1200','confirm'];
 const ui={setStatus(text:string,detail:string){status=text;html=detail;},showDetails(){},onClick(){},onChange(){},everyMinute(){},dispose(){},costInput:native(answers),onCostCommand(id:string,fn:()=>Promise<void>){commands.set(id,fn);}};
 try{
  const controller=await startExtension(ui,{...env,timezone:'UTC',now:()=>at});
  assert.match(html,/Cost Optimizer/);const budget=status;const started=performance.now();
  await commands.get('configure')!();assert.match(html,/Expected monthly usage: <strong>1200/);assert.equal(status,budget);
  answers.push('monthly','500');await commands.get('edit')!();assert.match(html,/Expected monthly usage: <strong>500/);
  at='2030-01-17T00:00:00Z';await controller.refresh();assert.match(html,/stale/i);assert.match(html,/500/);
  await commands.get('clear')!();assert.ok(!html.includes('Expected monthly usage:'));assert.ok(performance.now()-started<1000);
  controller.dispose();
 }finally{await rm(env.base,{recursive:true,force:true});}
});
test('account ambiguity during an open native editor rejects its late completion',async()=>{
 const env=await setup();let html='';let finish:((v:string)=>void)|undefined;
 const commands=new Map<string,()=>Promise<void>>();let count=0;let entered!:()=>void;const opened=new Promise<void>(resolve=>{entered=resolve;});
 const ui={setStatus(_t:string,d:string){html=d;},showDetails(){},onClick(){},onChange(){},everyMinute(){},dispose(){},onCostCommand(id:string,fn:()=>Promise<void>){commands.set(id,fn);},costInput:{...native([]),async pick(){count++;if(count===1)return 'independent';if(count===2)return 'consumer_prepaid';return 'confirm';},input(){return new Promise<string>(resolve=>{finish=resolve;entered();});}}};
 try{
  const controller=await startExtension(ui,{...env,timezone:'UTC',now:()=>now});const pending=commands.get('configure')!();
  await opened;assert.ok(finish);
  await appendFile(env.log,line('synthetic-b','2030-01-15 00:00:01.000'));await controller.refresh();finish!('1200');await pending;
  assert.ok(!html.includes('Expected monthly usage:'));assert.ok(!html.includes('synthetic-a'));assert.ok(!html.includes('synthetic-b'));controller.dispose();
 }finally{await rm(env.base,{recursive:true,force:true});}
});
test('native security and comparison wiring exclude command URI bridges, persistence and exact analysis',async()=>{
 const nativeSource=await readFile(new URL('../../src/extension/extension.ts',import.meta.url),'utf8');
 assert.match(nativeSource,/enableScripts: false/);assert.match(nativeSource,/enableCommandUris: false/);
 assert.match(nativeSource,/showQuickPick/);assert.match(nativeSource,/showInputBox/);
 const source=await readFile(new URL('../../src/extension/cost-inputs.ts',import.meta.url),'utf8');
 assert.ok(!source.includes('findBreakEven('));assert.ok(!source.includes('globalState'));assert.ok(!source.includes('workspaceState'));
});

test('guided native lot entry preserves expiry precision without asking for JSON',async()=>{
 const value=await editCostInputs(native(['inventory','replace','125.25','instant','2030-12-01T00:00:00Z','done']),independent,now);
 assert.deepEqual(value?.profile.purchased,{kind:'known',value:[{remainingCredits:'125.25',expiresAt:'2030-12-01T00:00:00Z',expiryPrecision:'instant'}]});
 const unknown=await editCostInputs(native(['inventory','unknown']),independent,now);assert.deepEqual(unknown?.profile.purchased,{kind:'unknown'});
});

test('panel title actions use the supported native editor title context',async()=>{
 const p=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 const menu=p.contributes.menus['editor/title'];assert.equal(menu?.length,3);
 assert.ok(menu.every((entry:any)=>entry.when==='activeWebviewPanelId == cyclegauge.usage'));
});

test('optimizer section has a local jump link and appears before the collapsed advanced details',async()=>{
 const env=await setup();let html='';
 const ui={setStatus(_t:string,d:string){html=d;},showDetails(){},onClick(){},onChange(){},everyMinute(){},dispose(){}};
 try{const c=await startExtension(ui,{...env,timezone:'UTC',now:()=>now});assert.ok(html.includes('href="#cost-optimizer"'));assert.ok(html.indexOf('aria-label="Cost Optimizer"')<html.indexOf('id="advanced-details"'));c.dispose();}
 finally{await rm(env.base,{recursive:true,force:true});}
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

import {presentCostSection} from '../../src/extension/cost-presentation.ts';
test('Cost Optimizer default is a short call to action, then a concise collapsed recommendation summary',()=>{
 const idle=presentCostSection(null);
 assert.ok(idle.includes('Configure Cost Optimizer'));assert.ok(idle.length<1200);
 assert.ok(!/<details[^>]*\bopen\b/.test(idle));
 assert.ok(!/Immediate upgrades|Monthly totals are repeated/.test(idle.replace(/<details>[\s\S]*<\/details>/,'')));
 const {h,f}=forecastEvidence();const results=calculateCosts(independent,f,h,now,syntheticCatalog());
 const html=presentCostSection(independent,results);
 assert.ok(html.includes('Expected monthly usage: <strong>1200'));
 assert.ok(!/<details[^>]*\bopen\b/.test(html),'no horizon is expanded by default');
 const primary=html.replace(/<details>[\s\S]*?<\/details>/g,'');
 assert.match(primary,/1 full billing cycle:/);assert.match(primary,/6 full billing cycles:/);
 assert.ok(!primary.includes('Before reset — new expenditure'));assert.ok(html.includes('Before reset — new expenditure'));
 assert.ok(html.includes('Edit Cost Scenario')&&html.includes('Clear Cost Inputs'));
});
