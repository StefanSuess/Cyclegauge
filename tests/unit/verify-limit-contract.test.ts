import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath,readFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {reviewedCatalog} from '../../src/cost/catalog.ts';

const script=fileURLToPath(new URL('../../scripts/verify-limit-contract.mjs',import.meta.url));
const skipSymlinks=process.platform==='win32'?'symlink creation needs privilege on Windows runners':false;
const record=(o:{limit:number|string;usage:number|string;reset?:string;title?:string;type?:string;bonuses?:unknown[];status?:string;user?:string|null;ts?:string})=>{
 const body=JSON.stringify({commandName:'GetUsageLimitsCommand',input:{synthetic:'SYNTHETIC_INPUT_DO_NOT_RETAIN'},output:{
  ...(o.user===null?{}:{userInfo:{userId:o.user??'synthetic-user-do-not-retain'}}),nextDateReset:o.reset??'2030-02-01T00:00:00Z',
  subscriptionInfo:{type:o.type??'SYNTHETIC_PRO',subscriptionTitle:o.title??'Synthetic SECRET-TITLE-SENTINEL'},
  overageConfiguration:{overageStatus:o.status??'DISABLED'},
  usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',usageLimitWithPrecision:'@@L@@',currentUsageWithPrecision:'@@U@@',bonuses:o.bonuses??[],overageCredits:[]}]},
  metadata:{requestId:'synthetic-request-do-not-retain',httpStatusCode:200}}).replace('"@@L@@"',String(o.limit)).replace('"@@U@@"',String(o.usage));
 return `${o.ts??'2030-01-01 00:00:00.000'} [info] synthetic-envelope ${body}\n`;
};
async function tree(lines:string){
 const base=await realpath(await mkdtemp(join(tmpdir(),'synthetic-limit-contract-')));
 const dir=join(base,'Kiro','logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 await mkdir(dir,{recursive:true});await writeFile(join(dir,'q-client.log'),lines);return {base,root:join(base,'Kiro'),dir};
}
// process.execPath, never a bare "node": container and CI images do not always have it on PATH.
const run=(root:string,extra:string[]=[])=>execFileSync(process.execPath,['--disable-warning=ExperimentalWarning',script,'--source-root',root,...extra],{encoding:'utf8'});
const spawn=(args:string[])=>spawnSync(process.execPath,['--disable-warning=ExperimentalWarning',script,...args],{encoding:'utf8'});

test('prints fixed tokens and counts only, never values, paths or free text',async()=>{
 const t=await tree(record({limit:1000,usage:10,title:'Synthetic Pro',ts:'2030-01-01 00:00:00.000'})+record({limit:1125,usage:20,title:'PATH-SENTINEL /Users/synthetic/private',ts:'2030-01-02 00:00:00.000'})+'not json GetUsageLimitsCommand {\n'+record({limit:1125,usage:1200,bonuses:[{x:1}],ts:'2030-01-03 00:00:00.000'}));
 try{
  const out=run(t.root),json=JSON.parse(out);
  assert.equal(json.schema,'ekg-limit-contract.1');
  assert.deepEqual(json.limit_tokens,['exceeds_pro_within_addon_range','nominal_pro']);assert.equal(json.distinct_accounts_seen,1);
  assert.equal(json.limit_distinct_count,2);assert.equal(json.limit_changes_within_cycle_count,1);
  assert.equal(json.usage_above_limit_seen,true);assert.equal(json.unsupported_extra_credits_seen,true);
  assert.equal(json.records_seen,4);assert.equal(json.records_accepted,3);assert.deepEqual(json.records_rejected_by_status,{malformed_record:1});
  assert.deepEqual(json.overage_status_tokens,['disabled']);
  for(const marker of ['SECRET-TITLE-SENTINEL','PATH-SENTINEL','synthetic-user','synthetic-request','SYNTHETIC_INPUT','1125','1200',t.base,'q-client','2030'])assert.ok(!out.includes(marker),marker);
  for(const value of Object.values(json))assert.ok(typeof value!=='string'||/^[a-z0-9_.-]+$/.test(value));
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('numbers use the production parser: exact decimal text, exponents and reduced precision',async()=>{
 const t=await tree(
  record({limit:'1000.0000000000000001',usage:1,ts:'2030-01-01 00:00:00.000'})+   // a double would round this to nominal Pro
  record({limit:'1.125e3',usage:1,ts:'2030-01-02 00:00:00.000'})+              // exponent form of 1125
  record({limit:'-5',usage:1,ts:'2030-01-03 00:00:00.000'}));                    // invalid billing value
 try{
  const j=JSON.parse(run(t.root));
  assert.ok(!j.limit_tokens.includes('nominal_pro'));assert.equal(j.limit_non_integer_seen,true);
  assert.equal(j.records_accepted,2);assert.deepEqual(j.records_rejected_by_status,{invalid_billing:1});
  assert.ok(j.limit_tokens.includes('exceeds_pro_within_addon_range'));
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('timestamp, record and reset validation match the collector and are reported by fixed status',async()=>{
 const good=record({limit:1000,usage:1,ts:'2030-01-01 00:00:00.000',reset:'2030-02-01T00:00:00Z'});
 const spelled=record({limit:1125,usage:1,ts:'2030-01-02 00:00:00.000',reset:'2030-02-01T00:00:00.000Z'});
 const noPrefix=good.replace('2030-01-01 00:00:00.000 [info] ','garbage ');
 const badDate=good.replace('2030-01-01 00:00:00.000','2030-02-31 00:00:00.000');
 const wrongCommand=good.replace('"commandName":"GetUsageLimitsCommand"','"commandName":"OtherCommand"');
 const conflict=JSON.parse(good.slice(good.indexOf('{')));conflict.output.usageBreakdownList[0].nextDateReset='2030-03-01T00:00:00Z';
 const conflictLine='2030-01-03 00:00:00.000 [info] synthetic-envelope '+JSON.stringify(conflict)+'\n';
 const twoCredits=JSON.parse(good.slice(good.indexOf('{')));twoCredits.output.usageBreakdownList.push({...twoCredits.output.usageBreakdownList[0]});
 const twoLine='2030-01-04 00:00:00.000 [info] synthetic-envelope '+JSON.stringify(twoCredits)+'\n';
 const failed=good.replace('"httpStatusCode":200','"httpStatusCode":500');
 const anon=record({limit:1000,usage:1,ts:'2030-01-05 00:00:00.000',user:null});
 const t=await tree(good+spelled+noPrefix+badDate+wrongCommand+conflictLine+twoLine+failed+anon);
 try{
  const j=JSON.parse(run(t.root));
  // good, spelled, the conflict line (accepted with a flag, no reset) and anon; the rest is rejected by status.
  assert.equal(j.records_accepted,4);
  assert.equal(j.conflicting_reset_metadata_seen,true);
  assert.deepEqual(j.records_rejected_by_status,{conflicting_resources:1,failed_response:1,invalid_timestamp:2});
  assert.equal(j.limit_changes_within_cycle_count,1);assert.equal(j.cycles_seen,1);
  assert.equal(j.records_without_cycle,1);assert.equal(j.records_without_account,1);
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('limit changes are counted per account and cycle, in time order',async()=>{
 const same=record({limit:1000,usage:1,ts:'2030-01-01 00:00:00.000',user:'synthetic-a'})+record({limit:2000,usage:1,ts:'2030-01-02 00:00:00.000',user:'synthetic-b'})+record({limit:1000,usage:1,ts:'2030-01-03 00:00:00.000',user:'synthetic-a'});
 const t=await tree(same);
 try{const j=JSON.parse(run(t.root));assert.equal(j.distinct_accounts_seen,2);assert.equal(j.limit_changes_within_cycle_count,0);}finally{await rm(t.base,{recursive:true,force:true});}
 const u=await tree(record({limit:1125,usage:1,ts:'2030-01-02 00:00:00.000'})+record({limit:1000,usage:1,ts:'2030-01-01 00:00:00.000'}));
 try{const j=JSON.parse(run(u.root));assert.equal(j.limit_changes_within_cycle_count,1);assert.equal(j.cycles_seen,1);}finally{await rm(u.base,{recursive:true,force:true});}
});
test('framing: invalid UTF-8, over-long and unterminated lines are counted, not parsed',async()=>{
 const good=record({limit:1000,usage:1,ts:'2030-01-01 00:00:00.000'});
 const t=await tree('');
 try{
  const file=join(t.dir,'q-client.log');
  const invalid=Buffer.concat([Buffer.from(record({limit:1001,usage:1,ts:'2030-01-02 00:00:00.000'}).trimEnd().replace('synthetic-envelope','synthetic-\u00e9')),Buffer.from([0xff])]);
  const long='2030-01-03 00:00:00.000 [info] GetUsageLimitsCommand '+'x'.repeat(300*1024)+'\n';
  const unterminated=record({limit:1002,usage:1,ts:'2030-01-04 00:00:00.000'}).trimEnd();
  await writeFile(file,Buffer.concat([Buffer.from(good),Buffer.from(invalid),Buffer.from('\n'),Buffer.from(long),Buffer.from(unterminated)]));
  const j=JSON.parse(run(t.root));
  assert.equal(j.records_accepted,1);assert.equal(j.records_too_long,1);assert.equal(j.records_partial_unterminated,1);
  assert.deepEqual(j.records_rejected_by_status,{malformed_record:1});
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('offset-free timestamps need a valid IANA zone; bad arguments give fixed output',async()=>{
 const t=await tree(record({limit:1000,usage:1}));
 try{
  const given=JSON.parse(run(t.root,['--source-timezone','Europe/Berlin']));
  assert.equal(given.assumed_source_timezone_seen,true);assert.equal(given.source_timezone_origin,'argument');
  const defaulted=JSON.parse(run(t.root));assert.equal(defaulted.source_timezone_origin,'device');
  const bad=spawn(['--source-root',t.root,'--source-timezone','Not/AZone']);
  assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stdout).error,'TIMEZONE_INVALID');
  const unknown=spawn(['--source-root',t.root,'--surprise','x']);
  assert.equal(unknown.status,1);assert.match(unknown.stdout,/^usage:/);assert.equal(unknown.stderr,'');
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('an invalid root gives a fixed code and nothing else',()=>{
 const missing=spawn(['--source-root','/nonexistent-synthetic-root']);
 assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stdout).error,'SOURCE_ROOT_INVALID');assert.equal(missing.stderr,'');
});
test('symlinked logs and directories are not followed',{skip:skipSymlinks},async()=>{
 const t=await tree('');
 try{
  await rm(join(t.dir,'q-client.log'));
  const outside=join(t.base,'outside.log');await writeFile(outside,record({limit:50,usage:1}));
  await symlink(outside,join(t.dir,'q-client.log'));
  assert.equal(JSON.parse(spawn(['--source-root',t.root]).stdout).error,'NO_LOGS');
  const real=join(t.base,'real-exthost');await mkdir(join(real,'kiro.kiroAgent'),{recursive:true});await writeFile(join(real,'kiro.kiroAgent','q-client.log'),record({limit:50,usage:1}));
  const window=join(t.root,'logs','synthetic-run','synthetic-window');await rm(join(window,'exthost'),{recursive:true,force:true});await symlink(real,join(window,'exthost'));
  assert.equal(JSON.parse(spawn(['--source-root',t.root]).stdout).error,'NO_LOGS');
 }finally{await rm(t.base,{recursive:true,force:true});}
});
test('script is read-only, offline and consistent with the bundled catalog',async()=>{
 const text=await readFile(script,'utf8');
 for(const forbidden of ['writeFile','appendFile','createWriteStream','mkdir','unlink','rename','node:net','node:http','node:https','node:dns','child_process','fetch(','process.env','WebSocket','XMLHttpRequest'])assert.ok(!text.includes(forbidden),forbidden);
 const plans=reviewedCatalog.plans.map(p=>`['${p.id}','${p.credits}']`).join(',');
 assert.ok(text.includes(`const PLANS=[${plans}];`),'plan constants must match the bundled catalog');
 assert.ok(text.includes(`ADD_ON_MIN='${reviewedCatalog.consumer.minimumCredits}'`));
 assert.ok(text.includes(`ADD_ON_MAX='${Number(reviewedCatalog.consumer.maximumCredits)*reviewedCatalog.consumer.maximumPacks}'`));
 // Only the production parser and decimal helpers may be imported from the application.
 assert.deepEqual([...text.matchAll(/from '(\.\.\/src\/[^']+)'/g)].map(m=>m[1]),['../src/projection.ts','../src/decimal.ts']);
 assert.ok(text.includes("fail('RUNTIME_UNSUPPORTED')"));
});
