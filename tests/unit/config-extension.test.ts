import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfigReviewer } from '../../src/audit/config-review.ts';
import { registerConfigReview } from '../../src/extension/config-review.ts';
import { evaluateConfigRules } from '../../src/audit/config-rules.ts';
import type { ConfigReview, ConfigReviewRoot } from '../../src/audit/config-review.ts';

function setup(operation?: (roots:readonly ConfigReviewRoot[],options?:{signal?:AbortSignal})=>Promise<ConfigReview>) {
 const commands=new Map<string,(...args: unknown[])=>unknown>(), subscriptions:{dispose():unknown}[]=[], opened:unknown[]=[], messages:string[]=[], reads:ConfigReviewRoot[][]=[];
 let checks=0, refreshes=0;
 const folder=(name:string,path:string,scheme='file')=>({name,index:0,uri:{scheme,fsPath:path}});
 const workspace={isTrusted:true,workspaceFolders:[folder('synthetic-root','/synthetic/root')],openTextDocument:async(value:unknown)=>{opened.push(value);return value;}};
 const window={showTextDocument:async(value:unknown)=>{opened.push(value);},showErrorMessage:async(text:string)=>{messages.push(text);}};
 const editor={workspace,window,commands:{registerCommand:(id:string,fn:(...args:unknown[])=>unknown)=>{commands.set(id,fn);return{dispose(){}};},executeCommand:async()=>{}}} as unknown as typeof vscode;
 const values={summary:{state:'checked',items:2,checkedAt:'2030-01-01T00:00:00Z'},valueSeen:false,clipboard:'synthetic-existing-lines',reminder:'2030-01-01'};
 const context={subscriptions,globalState:{get(){return values.valueSeen;},update(){throw Error('storage touched');}},workspaceState:{get(){return values.reminder;},update(){throw Error('audit storage touched');}}} as unknown as vscode.ExtensionContext;
 const check=(f:vscode.WorkspaceFolder)=>{checks++;return f.uri.fsPath.includes('refused')?{reason:'it overlaps Kiro data'}:{chosen:f.uri.fsPath,resolved:f.uri.fsPath.replace('alias','root')};};
 const result=():ConfigReview=>{
  const roots=[{root:0,nestedNotChecked:0,steering:[{rel:'.kiro/steering/synthetic.md',mode:'always' as const,size:26000,matchAll:false as const,patternCount:0}],hooks:[]}];
  return{...evaluateConfigRules(roots),roots,status:'complete',bytesRead:0};
 };
 const reviewer={async review(roots:readonly ConfigReviewRoot[],options?:{signal?:AbortSignal}){reads.push([...roots]);return operation ? operation(roots,options) : result();}};
 const link=registerConfigReview(context,editor,check,()=>{refreshes++;},{reviewer});
 return{workspace,commands,subscriptions,opened,messages,reads,link,folder,values,get checks(){return checks;},get refreshes(){return refreshes;},run:()=>commands.get('cyclegauge.reviewKiroConfig')!()};
}
test('manual registration does nothing automatically, no watchers, storage or audit dependencies',async()=>{
 const s=setup();assert.equal(s.reads.length,0);assert.equal(s.checks,0);assert.equal(s.refreshes,0);
 await s.run();assert.equal(s.reads.length,1);assert.equal(s.refreshes,1);assert.equal(s.messages.length,0);
 const source=await readFile(new URL('../../src/extension/config-review.ts',import.meta.url),'utf8');
 for(const forbidden of ['WorkspaceEdit','applyEdit','writeFile','clipboard','workspaceState','globalState','onFinding','valueSeen','AuditSummary','setTimeout','createFileSystemWatcher']) assert.ok(!source.includes(forbidden),forbidden);
 for(const name of ['config-model','config-review']) { const code=await readFile(new URL(`../../src/extension/${name}.ts`,import.meta.url),'utf8');assert.doesNotMatch(code,/RegExp\s*\(|new RegExp|console\.|(?:^|[}\s])catch\s*\(/); }
 const main=await readFile(new URL('../../src/extension/extension.ts',import.meta.url),'utf8');
 assert.match(main,/\.\.\.configReview\.nodes\(\)/);
 assert.equal((main.match(/registerConfigReview\(/g)??[]).length,1);
 assert.match(main,/registerConfigReview\(context, vscode, folderCheck, \(\) => changed\?\.fire\(undefined\)\)/);
 const manifest=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 assert.equal(manifest.contributes.commands.filter((c:{command:string})=>c.command==='cyclegauge.reviewKiroConfig').length,1);
 assert.ok(!JSON.stringify(manifest.contributes.configuration).includes('configReviewAutomatically'));
});
test('untrusted roots do no filesystem work; nonlocal and refused roots are fixed counted gaps',async()=>{
 const s=setup();s.workspace.isTrusted=false;await s.run();assert.equal(s.checks,0);assert.equal(s.reads.length,0);assert.match(JSON.stringify(s.link.nodes()),/workspace is not trusted/);
 s.workspace.isTrusted=true;s.workspace.workspaceFolders=[s.folder('synthetic-refused','/synthetic/refused'),s.folder('synthetic-remote','/synthetic/remote','vscode-remote'),s.folder('synthetic-good','/synthetic/good')];
 await s.run();assert.deepEqual(s.reads[0],['/synthetic/good']);assert.match(JSON.stringify(s.link.nodes()),/it overlaps Kiro data/);assert.match(JSON.stringify(s.link.nodes()),/not a local/);
});
test('realpath deduplication and eight checked roots; refusal cannot hide remaining valid roots',async()=>{
 const s=setup();s.workspace.workspaceFolders=[s.folder('synthetic-refused','/synthetic/refused'),s.folder('synthetic-root','/synthetic/root'),s.folder('synthetic-alias','/synthetic/alias'),...Array.from({length:9},(_,i)=>s.folder(`synthetic-${i}`,`/synthetic/${i}`))];
 await s.run();assert.equal(s.reads[0]!.length,8);assert.equal(s.reads[0]!.filter(x=>x==='/synthetic/root').length,1);assert.match(JSON.stringify(s.link.nodes()),/root limit/);
});
test('preview is unsaved plaintext and requires a current opaque tree node',async()=>{
 const s=setup();await s.run();const flatten=(nodes:ReturnType<typeof s.link.nodes>):ReturnType<typeof s.link.nodes>=>nodes.flatMap(n=>[n,...flatten(n.children??[])]);
 const node=flatten(s.link.nodes()).find(n=>n.action==='previewKiroConfig')!;assert.ok(node);
 const preview=s.commands.get('cyclegauge.config.preview')!;
 await preview({...node});assert.equal(s.opened.length,0);
 await preview(node.id);assert.equal(s.opened.length,2);assert.equal((s.opened[0] as {language:string}).language,'plaintext');
 await s.run();await preview(node.id);assert.equal(s.opened.length,2,'stale nodes cannot open a preview');
});
test('single-flight and stale/disposed results never refresh the section',async()=>{
 const s=setup();await s.run();const before=s.refreshes;for(const d of s.subscriptions)d.dispose();await s.run();assert.equal(s.refreshes,before);assert.equal(s.reads.length,1);
});

const flatten = (nodes:ReturnType<ReturnType<typeof setup>['link']['nodes']>):ReturnType<ReturnType<typeof setup>['link']['nodes']>=>nodes.flatMap(n=>[n,...flatten(n.children??[])]);
test('in-flight manual calls coalesce and changed roots, trust loss or disposal discard stale results',async()=>{
 for(const change of ['roots','trust','dispose']) {
  let release:((r:ConfigReview)=>void)|undefined, signal:AbortSignal|undefined;
  const s=setup(async(_roots,options)=>{signal=options?.signal;return new Promise<ConfigReview>(resolve=>{release=resolve;});});
  const first=s.run();await s.run();assert.equal(s.reads.length,1);assert.equal(s.refreshes,0);
  if(change==='roots')s.workspace.workspaceFolders=[s.folder('synthetic-other','/synthetic/other')];
  if(change==='trust')s.workspace.isTrusted=false;
  if(change==='dispose'){for(const d of s.subscriptions)d.dispose();assert.equal(signal?.aborted,true);}
  release!({...evaluateConfigRules([]),roots:[],status:'complete',bytesRead:0});await first;assert.equal(s.refreshes,0);
 }
});
test('hostile synthetic content reaches no output surface; hook name is capped and escaped only in a sidebar label',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'synthetic-config-ui-')));
 const reviewer=createConfigReviewer();const s=setup(reviewer.review);
 const sentinel='SYNTHETIC-INJECT-IGNORE-PREVIOUS', name='synthetic-name-\u202E'+ '😀'.repeat(70)+'SYNTHETIC-NAME-END';
 try {
  await mkdir(join(base,'.kiro','steering'),{recursive:true});await mkdir(join(base,'.kiro','hooks'));
  await writeFile(join(base,'.kiro','steering','synthetic.md'),'---\ninclusion: fileMatch\nfileMatchPattern: '+sentinel+'\n---\n'+sentinel);
  // Valid IDE v1 schema plus invalid JSON exercise both finding and fixed-failure output.
  await writeFile(join(base,'.kiro','hooks','synthetic.json'),JSON.stringify({version:'v1',hooks:[{name,trigger:'PostFileSave',action:{type:'agent',prompt:sentinel.repeat(200)},matcher:sentinel},{name:'synthetic-command',trigger:'PostFileSave',action:{type:'command',command:sentinel},matcher:sentinel}]}));
  await writeFile(join(base,'.kiro','hooks','synthetic-invalid.json'),'{'+sentinel);
  s.workspace.workspaceFolders=[s.folder('synthetic-root-\u202E',base)];
  const before=JSON.stringify(s.values);await s.run();assert.equal(JSON.stringify(s.values),before);
  const ns=flatten(s.link.nodes());
  for(const n of ns){
   assert.ok(!JSON.stringify(n).includes(sentinel));assert.ok(!n.id.includes(base));
   assert.ok(!n.tooltip?.includes('synthetic-name'));assert.ok(!n.description?.includes('synthetic-name'));assert.ok(!n.label.includes('SYNTHETIC-NAME-END'));
   if(n.action==='previewKiroConfig')await s.commands.get('cyclegauge.config.preview')!(n.id);
  }
  assert.ok(ns.some(n=>n.label.includes('synthetic-name-\\u{202E}')),'positive control: a parsed hook name is shown');
  const out=JSON.stringify({opened:s.opened,messages:s.messages});
  for(const forbidden of [sentinel,'synthetic-name','😀',base,'SYNTHETIC-NAME-END'])assert.ok(!out.includes(forbidden),forbidden);
 }finally{await rm(base,{recursive:true,force:true});}
});
