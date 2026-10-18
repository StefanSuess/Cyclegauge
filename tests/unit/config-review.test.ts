import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigReviewer } from '../../src/audit/config-review.ts';
import { configFs, type ConfigFs } from '../../src/audit/config-read.ts';
const temp = async (t: {after(fn:()=>Promise<unknown>):void}) => { const root = await realpath(await mkdtemp(join(await realpath(tmpdir()),'synthetic-review-'))); t.after(()=>rm(root,{recursive:true,force:true})); return root; };
const put = async (root:string,rel:string,content:string) => { await mkdir(join(root,...rel.split('/').slice(0,-1)),{recursive:true}); await writeFile(join(root,rel),content); };
const hookFile = (matcher:string, prompt='synthetic-prompt', action='agent') => JSON.stringify({version:'v1',hooks:[{trigger:'PostFileSave',matcher,name:'synthetic-name',action:{type:action,prompt}}]});
test('reviews only allowlisted configuration, merges cross-root H5 equality, drops keys and root paths',async t=>{
 const a=await temp(t),b=await temp(t),sentinel='SYNTHETIC-INJECT-IGNORE-PREVIOUS';
 await put(a,'.kiro/steering/synthetic.md',sentinel.repeat(400)); await put(a,'AGENTS.md',sentinel.repeat(900));
 await put(a,'.kiro/hooks/synthetic.json',hookFile(sentinel,sentinel)); await put(b,'.kiro/hooks/synthetic.json',hookFile(sentinel,sentinel));
 let yields=0; const result=await createConfigReviewer({yield:async()=>{yields++;}}).review([a,b]);
 assert.equal(result.status,'complete'); assert.equal(result.findings.filter(f=>f.id==='H5').length,1); assert.ok(yields>=3);
 const output=JSON.stringify(result); for(const privateValue of [a,b,sentinel,'matcherKey']) assert.ok(!output.includes(privateValue));
 assert.equal(result.roots.length,2); assert.equal(result.alwaysIncluded.lowerBound,true);
});
test('empty roots are nothing to review; refused input codes and root cap read no extra roots',async t=>{
 const root=await temp(t); const empty=await createConfigReviewer().review([root]); assert.equal(empty.status,'complete');assert.deepEqual(empty.notChecked,{no_kiro_config:1});
 let calls=0; const fs:ConfigFs={...configFs,lstat:async p=>{calls++;return configFs.lstat(p);}};
 const result=await createConfigReviewer({fs}).review(Array(10).fill(root)); assert.equal(result.roots.length,8); assert.equal(result.notChecked.limit_roots,2); assert.equal(result.status,'partial');assert.equal(calls,48);
 const refused=await createConfigReviewer({fs}).review([{code:'untrusted'},{code:'root_not_local'},{code:'root_refused'}]);
 assert.equal(refused.status,'unavailable'); assert.deepEqual(refused.notChecked,{untrusted:1,root_not_local:1,root_refused:1}); assert.equal(calls,48);
});
test('missing after listing, malformed JSON/front matter and symlinked AGENTS remain gaps',async t=>{
 const root=await temp(t); await put(root,'.kiro/steering/synthetic.md','---\ninclusion: synthetic-unknown\n---\n'); await put(root,'.kiro/hooks/synthetic.json','SYNTHETIC-INJECT-IGNORE-PREVIOUS'); await put(root,'synthetic-target','synthetic'); await symlink(join(root,'synthetic-target'),join(root,'AGENTS.md'));
 const result=await createConfigReviewer().review([root]); assert.equal(result.status,'partial'); assert.deepEqual(result.notChecked,{link_not_followed:1,json_invalid:1,fm_unrecognised:1}); assert.equal(result.alwaysIncluded.incomplete,true); assert.deepEqual(result.findings,[]);
 const fs:ConfigFs={...configFs,open:async()=>{throw {code:'ENOENT'};}}; const vanished=await createConfigReviewer({fs}).review([root]); assert.ok((vanished.notChecked.file_unreadable??0)>=1);
});
test('cancellation and 3s deadline stop between files, retaining lower-bound findings',async t=>{
 const root=await temp(t); await put(root,'.kiro/steering/synthetic-a.md','synthetic'.repeat(1000)); await put(root,'.kiro/steering/synthetic-b.md','synthetic'.repeat(1000));
 const controller=new AbortController(); let yields=0; const reviewer=createConfigReviewer({yield:async()=>{if(++yields===1)controller.abort();}});
 const result=await reviewer.review([root],{signal:controller.signal});assert.equal(result.status,'partial');assert.equal(result.notChecked.cancelled,1);assert.equal(result.roots[0]!.steering.length,1);assert.equal(result.roots[0]!.incomplete,true);assert.equal(result.alwaysIncluded.incomplete,true);
 let now=0;const timed=await createConfigReviewer({now:()=>now,yield:async()=>{now=3001;}}).review([root]);assert.equal(timed.notChecked.limit_time,1);assert.equal(timed.roots[0]!.steering.length,1);
 let calls=0;const fs:ConfigFs={...configFs,lstat:async p=>{calls++;return configFs.lstat(p);}};const aborted=await createConfigReviewer({fs}).review([root],{signal:controller.signal});assert.equal(calls,0);assert.equal(aborted.notChecked.cancelled,1);assert.equal(aborted.status,'partial');
});
test('single-flight coalesces callers until all pending reads settle and releases after completion',async t=>{
 const root=await temp(t);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let calls=0;
 const fs:ConfigFs={...configFs,lstat:async p=>{calls++;await gate;return configFs.lstat(p);}};const reviewer=createConfigReviewer({fs});
 const first=reviewer.review([root]),second=reviewer.review([root]);assert.equal(first,second);release();await first;assert.equal(calls,6);await reviewer.review([root]);assert.equal(calls,12);
});
test('3.6 MiB budget is shared across roots; capped files and hooks produce fixed counts',async t=>{
 const a=await temp(t),b=await temp(t);const content=hookFile('synthetic-pattern','synthetic'.repeat(7200));
 for(let i=0;i<35;i++)await put(a,`.kiro/hooks/synthetic-${i}.json`,content);
 for(let i=0;i<35;i++)await put(b,`.kiro/hooks/synthetic-${i}.json`,content);
 const result=await createConfigReviewer({now:()=>0,yield:async()=>{}}).review([a,b]);assert.equal(result.status,'partial');assert.equal(result.notChecked.limit_bytes,1);assert.ok(result.bytesRead<=3774873);assert.ok(result.roots[1]!.hooks.length<35);
 const c=await temp(t);for(let i=0;i<102;i++)await put(c,`.kiro/hooks/synthetic-${String(i).padStart(3,'0')}.json`,JSON.stringify({version:'v1',hooks:Array(201).fill({enabled:false})}));
 const capped=await createConfigReviewer({now:()=>0,yield:async()=>{}}).review([c]);assert.equal(capped.notChecked.limit_files,2);assert.equal(capped.notChecked.limit_hooks,100);assert.equal(capped.status,'partial');
});
test('configuration modules use no dynamic regex, console output, or data-bearing catch bindings',async()=>{
 for(const name of ['config-read','config-parse','config-rules','config-review']) {const source=await readFile(new URL(`../../src/audit/${name}.ts`,import.meta.url),'utf8');assert.doesNotMatch(source,/RegExp\s*\(|new RegExp|console\.|(?:^|[}\s])catch\s*\(/);}
});
test('fixed failure counts cover unreadable folders, unsafe names, nested gaps and unknown schemas',async t=>{
 const root=await temp(t);await put(root,'.kiro/steering/synthetic.md','---\ninclusion: manual\n---\n');
 await put(root,'.kiro/hooks/synthetic.json',JSON.stringify({version:'synthetic-unknown'}));await put(root,'.kiro/hooks/synthetic\u202e.json','synthetic');await mkdir(join(root,'.kiro/steering/synthetic-nested'));
 let result=await createConfigReviewer().review([root]);assert.equal(result.notChecked.schema_unknown,1);assert.equal(result.notChecked.name_unsafe,1);assert.equal(result.roots[0]!.nestedNotChecked,1);assert.equal(result.alwaysIncluded.incomplete,true);
 const fs:ConfigFs={...configFs,opendir:async()=>{throw {code:'EACCES',message:'SYNTHETIC-INJECT-IGNORE-PREVIOUS'};}};
 result=await createConfigReviewer({fs}).review([root]);assert.equal(result.notChecked.folder_unreadable,2);assert.equal(result.status,'partial');assert.ok(!JSON.stringify(result).includes('SYNTHETIC-INJECT'));
 const other=await temp(t);await put(other,'synthetic-target','synthetic');await symlink(other,join(other,'.kiro'));
 result=await createConfigReviewer().review([other]);assert.equal(result.notChecked.folder_symlink,2);assert.deepEqual(result.findings,[]);
});
test('hook names survive only in sidebar entries; invalid/unknown hook text never reaches findings',async t=>{
 const root=await temp(t),sentinel='SYNTHETIC-INJECT-IGNORE-PREVIOUS';
 await put(root,'.kiro/hooks/synthetic.json',JSON.stringify({version:'v1',hooks:[{name:sentinel,trigger:'PostFileSave',matcher:sentinel,action:{type:'agent',prompt:sentinel}},{trigger:sentinel,action:{type:'agent',prompt:sentinel}},{trigger:'PostFileSave',enabled:sentinel,action:{type:'agent'}}]}));
 const result=await createConfigReviewer().review([root]);assert.equal(result.status,'partial');assert.equal(result.roots[0]!.incomplete,true);assert.deepEqual(result.notChecked,{trigger_unknown:1,field_unrecognised:1});assert.equal(result.roots[0]!.hooks[0]!.name,sentinel);assert.ok(!JSON.stringify(result.findings).includes(sentinel));
 const withoutNames={...result,roots:result.roots.map(root=>({...root,hooks:root.hooks.map(({name,...hook})=>hook)}))};assert.ok(!JSON.stringify(withoutNames).includes(sentinel));assert.doesNotMatch(JSON.stringify(result),/\d+\s+credits?\b/i);
});
test('cancelled stalled read keeps single-flight until read settles, then permits another run',async t=>{
 const root=await temp(t),controller=new AbortController();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 let calls=0;const fs:ConfigFs={...configFs,lstat:async p=>{calls++;await gate;return configFs.lstat(p);}};const reviewer=createConfigReviewer({fs});
 const first=reviewer.review([root],{signal:controller.signal});controller.abort();const joined=reviewer.review([root]);assert.equal(first,joined);release();const stopped=await first;assert.equal(stopped.notChecked.cancelled,1);const before=calls;await reviewer.review([root]);assert.ok(calls>before);
});

test('cancellation after the final file yield still marks the active root incomplete',async t=>{
 const root=await temp(t),controller=new AbortController();await put(root,'.kiro/hooks/synthetic.json',hookFile('synthetic'));
 const result=await createConfigReviewer({yield:async()=>controller.abort()}).review([root],{signal:controller.signal});assert.equal(result.status,'partial');assert.equal(result.roots[0]!.incomplete,true);assert.equal(result.notChecked.cancelled,1);
});
for (const phase of ['open','read'] as const) test(`cancel during pending ${phase} keeps single-flight through IO settlement, close and buffer wipe`,async t=>{
 const root=await temp(t);await put(root,'.kiro/hooks/synthetic.json',hookFile('synthetic-pattern'));
 const controller=new AbortController();
 let enter!:()=>void,releaseIo!:()=>void,enterClose!:()=>void,releaseClose!:()=>void;
 const entered=new Promise<void>(r=>{enter=r;}),ioGate=new Promise<void>(r=>{releaseIo=r;});
 const closing=new Promise<void>(r=>{enterClose=r;}),closeGate=new Promise<void>(r=>{releaseClose=r;});
 t.after(()=>{releaseIo();releaseClose();});
 let calls=0,closed=0,closeCalls=0;let held:Uint8Array|undefined;
 const fs:ConfigFs={...configFs,lstat:async p=>{calls++;return configFs.lstat(p);},open:async(p,flags)=>{
  calls++;const handle=await configFs.open(p,flags);
  if(phase==='open'){enter();await ioGate;}
  return {...handle,read:async(buffer,offset,length,position)=>{
   held=buffer;enter();await ioGate;return handle.read(buffer,offset,length,position);
  },close:async()=>{closeCalls++;enterClose();await closeGate;await handle.close();closed++;}};
 }};
 const reviewer=createConfigReviewer({fs}),first=reviewer.review([root],{signal:controller.signal});let settled=false;void first.then(()=>{settled=true;});
 await entered;controller.abort();await new Promise<void>(r=>setImmediate(r));
 const before=calls,joined=reviewer.review([root]);assert.equal(joined,first);await new Promise<void>(r=>setImmediate(r));assert.equal(calls,before);assert.equal(settled,false);assert.equal(closed,0);
 releaseIo();await closing;await new Promise<void>(r=>setImmediate(r));
 assert.equal(reviewer.review([root]),first);assert.equal(settled,false);assert.equal(closed,0);
 if(phase==='read'){assert.ok(held?.some(byte=>byte!==0));}
 releaseClose();const result=await first;assert.equal(result.notChecked.cancelled,1);assert.equal(closed,1);assert.equal(closeCalls,1);
 if(held)assert.ok(held.every(byte=>byte===0));
 // A fresh run may only begin after the old handle has closed and the old buffer is wiped.
 const fresh=reviewer.review([root]);assert.notEqual(fresh,first);await fresh;assert.ok(calls>before);
});
