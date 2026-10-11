import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath,readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {reviewedCatalog} from '../../src/cost/catalog.ts';

const script=new URL('../../scripts/verify-limit-contract.mjs',import.meta.url).pathname;
const record=(o:{limit:number;usage:number;reset?:string;title?:string;type?:string;bonuses?:unknown[];status?:string})=>
 '2030-01-01 00:00:00.000 [info] synthetic-envelope '+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{synthetic:'SYNTHETIC_INPUT_DO_NOT_RETAIN'},output:{
  userInfo:{userId:'synthetic-user-do-not-retain'},nextDateReset:o.reset??'2030-02-01T00:00:00Z',
  subscriptionInfo:{type:o.type??'SYNTHETIC_PRO',subscriptionTitle:o.title??'Synthetic SECRET-TITLE-SENTINEL'},
  overageConfiguration:{overageStatus:o.status??'DISABLED'},
  usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',usageLimitWithPrecision:o.limit,currentUsageWithPrecision:o.usage,bonuses:o.bonuses??[],overageCredits:[]}]},
  metadata:{requestId:'synthetic-request-do-not-retain'}})+'\n';
async function tree(lines:string){
 const base=await realpath(await mkdtemp(join(tmpdir(),'synthetic-limit-contract-')));
 const dir=join(base,'Kiro','logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 await mkdir(dir,{recursive:true});await writeFile(join(dir,'q-client.log'),lines);return {base,root:join(base,'Kiro'),dir};
}
const run=(root:string)=>execFileSync('node',['--disable-warning=ExperimentalWarning',script,'--source-root',root],{encoding:'utf8'});

test('prints fixed tokens and counts only, never values, paths or free text',async()=>{
 const t=await tree(record({limit:1000,usage:10,title:'Synthetic Pro'})+record({limit:1125,usage:20,title:'PATH-SENTINEL /Users/synthetic/private'})+'not json GetUsageLimitsCommand {\n'+record({limit:1125,usage:1200,bonuses:[{x:1}]}));
 try{
  const out=run(t.root),json=JSON.parse(out);
  assert.equal(json.schema,'ekg-limit-contract.1');
  assert.deepEqual(json.limit_tokens,['consistent_with_pro_plus_addons','nominal_pro']);
  assert.equal(json.limit_distinct_count,2);assert.equal(json.limit_changes_within_cycle_count,1);
  assert.equal(json.usage_above_limit_seen,true);assert.equal(json.bonuses_nonempty_seen,true);
  assert.equal(json.records_seen,4);assert.equal(json.records_parsed,3);
  assert.deepEqual(json.overage_status_tokens,['disabled']);
  for(const marker of ['SECRET-TITLE-SENTINEL','PATH-SENTINEL','synthetic-user','synthetic-request','SYNTHETIC_INPUT','1125','1200',t.base,'q-client','2030'])assert.ok(!out.includes(marker),marker);
  for(const value of Object.values(json))assert.ok(typeof value!=='string'||/^[a-z0-9_.-]+$/.test(value));
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('invalid or empty roots give fixed codes and symlinked logs are skipped',async()=>{
 const missing=spawnSync('node',[script,'--source-root','/nonexistent-synthetic-root'],{encoding:'utf8'});
 assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stdout).error,'SOURCE_ROOT_INVALID');assert.equal(missing.stderr,'');
 const t=await tree('');
 try{
  await rm(join(t.dir,'q-client.log'));
  const outside=join(t.base,'outside.log');await writeFile(outside,record({limit:50,usage:1}));
  await symlink(outside,join(t.dir,'q-client.log'));
  const r=spawnSync('node',[script,'--source-root',t.root],{encoding:'utf8'});
  assert.equal(JSON.parse(r.stdout).error,'NO_LOGS');
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('script is read-only, offline and consistent with the bundled catalog',async()=>{
 const text=await readFile(script,'utf8');
 for(const forbidden of ['writeFile','appendFile','createWriteStream','mkdir','unlink','rename','node:net','node:http','node:https','node:dns','child_process','fetch(','process.env','WebSocket','XMLHttpRequest'])assert.ok(!text.includes(forbidden),forbidden);
 const plans=reviewedCatalog.plans.map(p=>`['${p.id}',${p.credits}]`).join(',');
 assert.ok(text.includes(`const PLANS=[${plans}];`),'plan constants must match the bundled catalog');
 assert.ok(text.includes(`ADD_ON_MIN=${reviewedCatalog.consumer.minimumCredits}`));
 assert.ok(text.includes(`ADD_ON_MAX=${Number(reviewedCatalog.consumer.maximumCredits)*reviewedCatalog.consumer.maximumPacks}`));
});
