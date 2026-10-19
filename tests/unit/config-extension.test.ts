import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfigReviewer } from '../../src/audit/config-review.ts';
import { registerConfigReview, startManualReview } from '../../src/extension/config-review.ts';
import { createPreparedFiles } from '../../src/extension/config-apply.ts';
import { evaluateConfigRules } from '../../src/audit/config-rules.ts';
import type { ConfigReview, ConfigReviewRoot } from '../../src/audit/config-review.ts';

function setup(operation?: (roots:readonly ConfigReviewRoot[],options?:{signal?:AbortSignal})=>Promise<ConfigReview>, extra: Record<string, unknown> = {}) {
 const executed:unknown[][]=[], commands=new Map<string,(...args: unknown[])=>unknown>(), subscriptions:{dispose():unknown}[]=[], opened:unknown[]=[], messages:string[]=[], reads:ConfigReviewRoot[][]=[];
 let checks=0, refreshes=0;
 const folder=(name:string,path:string,scheme='file')=>({name,index:0,uri:{scheme,fsPath:path}});
 const workspace={isTrusted:true,workspaceFolders:[folder('synthetic-root','/synthetic/root')],openTextDocument:async(value:unknown)=>{opened.push(value);return value;}};
 const window={showTextDocument:async(value:unknown)=>{opened.push(value);},showErrorMessage:async(text:string)=>{messages.push(text);}};
 const editor={workspace,window,commands:{registerCommand:(id:string,fn:(...args:unknown[])=>unknown)=>{commands.set(id,fn);return{dispose(){}};},executeCommand:async(...args:unknown[])=>{executed.push(args);}}} as unknown as typeof vscode;
 const values={summary:{state:'checked',items:2,checkedAt:'2030-01-01T00:00:00Z'},valueSeen:false,clipboard:'synthetic-existing-lines',reminder:'2030-01-01'};
 const context={subscriptions,globalState:{get(){return values.valueSeen;},update(){throw Error('storage touched');}},workspaceState:{get(){return values.reminder;},update(){throw Error('audit storage touched');}}} as unknown as vscode.ExtensionContext;
 const check=(f:vscode.WorkspaceFolder)=>{checks++;return f.uri.fsPath.includes('refused')?{reason:'it overlaps Kiro data'}:{chosen:f.uri.fsPath,resolved:f.uri.fsPath.replace('alias','root')};};
 const result=():ConfigReview=>{
  const roots=[{root:0,nestedNotChecked:0,steering:[{rel:'.kiro/steering/synthetic.md',mode:'always' as const,size:26000,matchAll:false as const,patternCount:0}],hooks:[]}];
  return{...evaluateConfigRules(roots),roots,status:'complete',bytesRead:0};
 };
 const reviewer={async review(roots:readonly ConfigReviewRoot[],options?:{signal?:AbortSignal}){reads.push([...roots]);return operation ? operation(roots,options) : result();}};
 const link=registerConfigReview(context,editor,check,()=>{refreshes++;},{reviewer, ...extra});
 return{workspace,executed,commands,subscriptions,opened,messages,reads,link,folder,values,get checks(){return checks;},get refreshes(){return refreshes;},run:()=>commands.get('cyclegauge.reviewKiroConfig')!()};
}
test('registration with automatic mode off does nothing by itself and has no audit dependencies',async()=>{
 const s=setup();assert.equal(s.reads.length,0);assert.equal(s.checks,0);assert.equal(s.refreshes,0);
 await s.run();assert.equal(s.reads.length,1);assert.equal(s.refreshes,1);assert.equal(s.messages.length,0);
 const source=await readFile(new URL('../../src/extension/config-review.ts',import.meta.url),'utf8');
 for(const forbidden of ['WorkspaceEdit','applyEdit','writeFile','clipboard','workspaceState','onFinding','valueSeen','AuditSummary','auditAutomatically','neverRemind','snoozeUntil']) assert.ok(!source.includes(forbidden),forbidden);
 // The only global-state write is the approved offer key, and the only setting written is the user's own automatic-mode setting.
 assert.deepEqual(source.match(/globalState\.update\([^,]*/g),['globalState.update(CONFIG_OFFER_KEY']);
 assert.deepEqual(source.match(/\.update\(SETTING[^)]*\)/g),[".update(SETTING, 'onOpenAndChanges', editor.ConfigurationTarget.Global)"]);
 for(const name of ['config-model','config-review','config-schedule']) { const code=await readFile(new URL(`../../src/extension/${name}.ts`,import.meta.url),'utf8');assert.doesNotMatch(code,/RegExp\s*\(|new RegExp|console\.|(?:^|[}\s])catch\s*\(/); }
 const main=await readFile(new URL('../../src/extension/extension.ts',import.meta.url),'utf8');
 assert.match(main,/reviewTree\(parts, configReview\.summary\(\), configReview\.nodes\(\)/);
 assert.equal((main.match(/registerConfigReview\(/g)??[]).length,1);
 assert.match(main,/registerConfigReview\(context, vscode, folderCheck, \(\) => changed\?\.fire\(undefined\), \{ support: configGate, reportError: showReportableError, prepared \}\)/);
 const manifest=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 assert.equal(manifest.contributes.commands.filter((c:{command:string})=>c.command==='cyclegauge.reviewKiroConfig').length,1);
 assert.equal(manifest.contributes.configuration.properties['cyclegauge.configReviewAutomatically'].default,'off');
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
test('the read-only suggestion (only for findings without an apply action) is unsaved plaintext and requires a current tree node',async()=>{
 const wide=():ConfigReview=>{
  const roots=[{root:0,nestedNotChecked:0,steering:['a','b'].map(n=>({rel:`.kiro/steering/synthetic-${n}.md`,mode:'always' as const,size:20000,matchAll:false as const,patternCount:0})),hooks:[]}];
  return{...evaluateConfigRules(roots),roots,status:'complete',bytesRead:0};
 };
 const s=setup(async()=>wide());await s.run();const flatten=(nodes:ReturnType<typeof s.link.nodes>):ReturnType<typeof s.link.nodes>=>nodes.flatMap(n=>[n,...flatten(n.children??[])]);
 const all=flatten(s.link.nodes()), node=all.find(n=>n.action==='previewKiroConfig')!;assert.ok(node);
 assert.equal(node.finding!.id,'S3');assert.equal(all.filter(n=>n.finding&&n.action!=='previewKiroConfig').length,2,'S1 findings use apply actions instead');
 const preview=s.commands.get('cyclegauge.config.preview')!;
 await preview('synthetic-forged-id');await preview({id:'synthetic-forged-id'});await preview({});await preview(undefined);assert.equal(s.opened.length,0);
 await preview(node.id);assert.equal(s.opened.length,2);assert.equal((s.opened[0] as {language:string}).language,'plaintext');
 await preview({...node});assert.equal(s.opened.length,4,'the menu passes the tree element; only its id is read');
 await s.run();await preview(node.id);assert.equal(s.opened.length,4,'stale nodes cannot open a preview');
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

// ---- the review next to a manual audit (approved 2026-10-18)
test('a manual audit starts exactly one manual review run; a failing or throwing review never escapes',async()=>{
 let runs=0;startManualReview({run:async()=>{runs++;}});await Promise.resolve();assert.equal(runs,1);
 startManualReview({run:()=>Promise.reject(new Error('synthetic-error-sentinel'))});
 startManualReview({run:()=>{throw new Error('synthetic-error-sentinel');}});
 await new Promise(r=>setTimeout(r,5)); // no unhandled rejection and no exception: the audit continues
 const s=setup();startManualReview(s.link);await new Promise(r=>setTimeout(r,5));assert.equal(s.reads.length,1,'the same bounded run as the review command');
 assert.equal(s.messages.length,0);
});
test('the review run behind a manual audit survives a failing reader and a refused folder without touching anything else',async()=>{
 const s=setup(async()=>{throw new Error('synthetic-error-sentinel');});
 await s.link.run();assert.equal(s.reads.length,1);assert.ok(!JSON.stringify(s.link.nodes()).includes('sentinel'));
 s.workspace.workspaceFolders=[s.folder('synthetic-refused','/synthetic/refused')];
 await s.link.run();assert.match(JSON.stringify(s.link.nodes()),/it overlaps Kiro data/);
});
test('only the manual audit command starts the review: the silent re-runs and the watcher never do',async()=>{
 const main=await readFile(new URL('../../src/extension/extension.ts',import.meta.url),'utf8');
 assert.equal((main.match(/startManualReview\(/g)??[]).length,1);
 // exactly in the manual `audit` function, right after the (non-silent) run settles, also when it throws
 assert.match(main,/const audit = async \(\): Promise<void> => \{[\s\S]*?try \{ outcome = await auditOnce\(\); \} finally \{ running = false; if \(!userCancelled\) startManualReview\(configReview\); \}/);
 const silent=main.match(/auditOnce\(true[^\n]*/g)??[];assert.ok(silent.length>=2);for(const line of silent)assert.ok(!line.includes('startManualReview')&&!line.includes('configReview'),line);
 const start=main.indexOf('const auditOnce = async');const end=main.indexOf('// Registered independently of the collector');
 assert.ok(!main.slice(start,end).includes('startManualReview'));
});
test('the Audit view title bar has one Check button, which also runs the review; the review command stays available in the palette', async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
 const command=manifest.contributes.commands.find((c:{command:string})=>c.command==='cyclegauge.reviewKiroConfig');
 assert.match(command.icon,/^\$\([a-z-]+\)$/);
 const nav=(manifest.contributes.menus['view/title'] as {command:string;when:string;group:string}[]).filter(m=>m.group.startsWith('navigation@')).sort((a,b)=>Number(a.group.split('@')[1])-Number(b.group.split('@')[1]));
 assert.deepEqual(nav.map(m=>m.command),['cyclegauge.auditWorkspace']);
 assert.ok(nav.every(m=>m.when==='view == cyclegauge.auditView'));
 assert.ok(!manifest.contributes.menus.commandPalette.some((m:{command:string})=>m.command==='cyclegauge.reviewKiroConfig'),'not hidden from the palette');
 const main=await readFile(new URL('../../src/extension/extension.ts',import.meta.url),'utf8');
 assert.ok(!main.includes("'Review Kiro Steering and Hooks'"),'no Review entry in the tree');
});
test('the review tree has no Review entry or header node; its top level is the groups',async()=>{
 const s=setup();assert.deepEqual(s.link.nodes(),[]);assert.equal(s.link.summary().reviewed,false);
 await s.run();
 const top=s.link.nodes();assert.deepEqual(top.map(n=>n.label),['Load only when needed (1)']);
 assert.equal(s.link.summary().reviewed,true);assert.equal(s.link.summary().findings,1);assert.equal(s.link.summary().automatic,false);
 assert.ok(!JSON.stringify(s.link.nodes()).includes('Review Kiro Steering and Hooks'));
});

// A fake editor with the three document events, so the tracker and the review can be driven without an editor.
function events() {
 const save:((d:unknown)=>void)[]=[], close:((d:unknown)=>void)[]=[], change:((e:unknown)=>void)[]=[];
 const on=(list:((x:any)=>void)[])=>(fn:(x:any)=>void)=>{list.push(fn);return{dispose(){}};};
 const workspace={onDidSaveTextDocument:on(save),onDidCloseTextDocument:on(close),onDidChangeTextDocument:on(change)};
 const doc=(fsPath:string,dirty=true,scheme='file')=>({uri:{scheme,fsPath},isDirty:dirty});
 return{editor:{workspace} as unknown as typeof vscode,doc,save:(d:unknown)=>save.forEach(f=>f(d)),close:(d:unknown)=>close.forEach(f=>f(d)),change:(d:unknown)=>change.forEach(f=>f({document:d}))};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('prepared files are marked while unsaved and cleared by a save, a close or a revert; nothing is stored',async()=>{
 const e=events(), prepared=createPreparedFiles(e.editor,'linux'), log:string[]=[];
 prepared.subscribe((path,event)=>log.push(`${event}:${path}`));
 const a=e.doc('/synthetic/root/.kiro/steering/a.md'), b=e.doc('/synthetic/root/.kiro/steering/b.md'), c=e.doc('/synthetic/root/.kiro/hooks/c.json'), u=e.doc('/synthetic/root/x.md',true,'untitled');
 prepared.add([a.uri,b.uri,c.uri,u.uri] as never);
 assert.equal(prepared.count(),3,'only file documents are tracked'); assert.ok(prepared.has('/synthetic/root/.kiro/steering/a.md')); assert.ok(!prepared.has('/synthetic/root/x.md'));
 prepared.add([a.uri] as never); assert.equal(prepared.count(),3); assert.equal(log.filter(x=>x.startsWith('added')).length,3,'a second mark of the same file is not a new one');
 e.save(a); assert.equal(prepared.count(),2); assert.ok(log.includes('saved:/synthetic/root/.kiro/steering/a.md'));
 e.close(b); assert.equal(prepared.count(),1); assert.ok(log.includes('cleared:/synthetic/root/.kiro/steering/b.md'));
 c.isDirty=true; e.change(c); await tick(); assert.equal(prepared.count(),1,'still unsaved: typing keeps the mark');
 c.isDirty=false; e.change(c); await tick(); assert.equal(prepared.count(),0); assert.ok(log.includes('cleared:/synthetic/root/.kiro/hooks/c.json'),'a revert clears the mark');
 // The editor reports the clean state just before the save: the save still wins and is reported as a save.
 const d=e.doc('/synthetic/root/.kiro/steering/d.md'); prepared.add([d.uri] as never); d.isDirty=false; e.change(d); e.save(d); await tick();
 assert.equal(log.at(-1),'saved:/synthetic/root/.kiro/steering/d.md'); assert.equal(prepared.count(),0);
 // An unrelated document changes nothing.
 e.save(e.doc('/synthetic/root/other.md',false)); e.close(e.doc('/synthetic/root/other.md',false)); assert.equal(log.filter(x=>x.startsWith('saved')).length,2);
 prepared.add([a.uri] as never); prepared.dispose(); assert.equal(prepared.count(),0);
 for(const name of ['config-apply']) { const code=await readFile(new URL(`../../src/extension/${name}.ts`,import.meta.url),'utf8'); const tracker=code.slice(code.indexOf('export function createPreparedFiles')); assert.doesNotMatch(tracker,/globalState|workspaceState|writeFile|\.update\(|showInformationMessage|console\./); }
});
test('saving a Steering or Hook file Cyclegauge prepared starts one manual review; other saves, unprepared files and a running review start none',async()=>{
 const e=events(), prepared=createPreparedFiles(e.editor,'linux');
 const s=setup(undefined,{prepared});
 await s.run(); assert.equal(s.reads.length,1); const focused=s.executed.length;
 const steering=e.doc('/synthetic/root/.kiro/steering/synthetic.md'), hook=e.doc('/synthetic/root/.kiro/hooks/synthetic.json'), other=e.doc('/synthetic/root/README.md'), elsewhere=e.doc('/synthetic/other/.kiro/steering/x.md'), kiroignore=e.doc('/synthetic/root/.kiroignore');
 // A save of a file nothing prepared does nothing.
 e.save(steering); await tick(); assert.equal(s.reads.length,1);
 // Prepared but not yet saved: no review.
 prepared.add([steering.uri,hook.uri,other.uri,elsewhere.uri,kiroignore.uri] as never); await tick(); assert.equal(s.reads.length,1);
 for (const doc of [other,elsewhere,kiroignore]) { e.save(doc); await tick(); }
 assert.equal(s.reads.length,1,'only a Steering or Hook file inside a checked folder starts a review');
 e.save(steering); await tick(); assert.equal(s.reads.length,2); assert.deepEqual(s.reads[1],['/synthetic/root']);
 assert.equal(s.executed.length,focused,'a re-check after a save takes no focus'); assert.equal(s.messages.length,0);
 e.save(hook); await tick(); assert.equal(s.reads.length,3);
 e.save(steering); await tick(); assert.equal(s.reads.length,3,'the mark is gone after the save');
 // Single flight: a save while a review is running starts no second one.
 let release:()=>void=()=>undefined, calls=0;
 const roots=[{root:0,nestedNotChecked:0,steering:[{rel:'.kiro/steering/synthetic.md',mode:'always' as const,size:26000,matchAll:false as const,patternCount:0}],hooks:[]}];
 const gate=new Promise<void>(r=>{release=r;});
 const slow=setup(async()=>{calls++;if(calls>1)await gate;return{...evaluateConfigRules(roots),roots,status:'complete' as const,bytesRead:0};},{prepared});
 await slow.run(); assert.equal(calls,1);
 const running=slow.run(); await tick(); assert.equal(calls,2);
 const again=e.doc('/synthetic/root/.kiro/steering/synthetic.md'); prepared.add([again.uri] as never); e.save(again); await tick();
 release(); await running; await tick(); assert.equal(calls,2,'a running review is never doubled');
});
test('items of a drawn review are marked while their file is prepared and unsaved, and the marks follow saves',async()=>{
 const e=events(), prepared=createPreparedFiles(e.editor,'linux'), s=setup(undefined,{prepared});
 await s.run();
 const item=()=>JSON.stringify(s.link.nodes());
 assert.ok(!item().includes('prepared — save the file to apply'));
 const doc=e.doc('/synthetic/root/.kiro/steering/synthetic.md'); const before=s.refreshes;
 prepared.add([doc.uri] as never); assert.ok(item().includes('prepared — save the file to apply')); assert.ok(s.refreshes>before,'the view is refreshed');
 e.close(doc); assert.ok(!item().includes('prepared — save the file to apply'));
 prepared.add([doc.uri] as never); assert.ok(item().includes('prepared — save the file to apply'));
 e.save(doc); await tick(); assert.ok(!item().includes('prepared — save the file to apply'));
});
