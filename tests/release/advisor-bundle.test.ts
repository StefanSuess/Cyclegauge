import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync,unlinkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {runInThisContext} from 'node:vm';
import {buildVsix} from '../../scripts/release/build-vsix.ts';
import {readZip} from '../../scripts/release/zip.ts';

let built:Promise<string>|undefined;
// The shipped bundle is built once per run; only its text is kept.
const builtBundle=(work:string)=>built??=(async()=>{const vsix=join(work,'candidate.vsix');await buildVsix(vsix,true);return readZip(readFileSync(vsix)).find(e=>e.name==='extension/dist/extension.cjs')!.data.toString();})();
// Exercise the shipped bundle with an invented source and explicit roots. No IDE or real profile is opened.
test('packaged Advisor native commands, conditional figure, cancellation and panel lifecycle',async()=>{
 // Native realpath: the collector rejects a source spelled through a Windows 8.3 short-name alias.
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-advisor-bundle-')));
 let extension:any;const subscriptions:any[]=[];
 try{
  const source=join(work,'source'),storage=join(work,'owned'),logs=join(source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
  mkdirSync(logs,{recursive:true});
  const lines=[1,2,3,4].map(day=>`2030-01-0${day} 00:00:00.000 [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-bundle-account'},nextDateReset:'2030-02-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:day*10,usageLimitWithPrecision:5000,nextDateReset:'2030-02-01T00:00:00Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n');
  writeFileSync(join(logs,'q-client.log'),lines.join(''));
  const bundle=await builtBundle(work);
  const commands=new Map<string,()=>unknown>(),items:any[]=[],answers:(string|undefined)[]=[];
  let panel:any,options:any,disposed:()=>void=()=>{},visibility:(e:any)=>void=()=>{};
  const disposable={dispose(){}};
  const api=auditApi();
  const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ThemeColor:class{},Uri:api.Uri,RelativePattern:class{},extensions:{getExtension:()=>undefined},
   EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
   commands:{...api.commands,registerCommand(id:string,fn:()=>unknown){commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
   workspace:{...api.workspace,getConfiguration:()=>({get:(key:string)=>({sourceRoot:source,storageRoot:storage,sourceTimezone:'UTC'} as any)[key]??''}),createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
   window:{...api.window,createStatusBarItem(){const item={text:'',command:'',visible:false,show(){this.visible=true;},hide(){this.visible=false;},dispose(){this.visible=false;}};items.push(item);return item;},
    createWebviewPanel(_type:string,_title:string,_column:number,o:any){options=o;panel={visible:true,webview:{html:''},reveal(){this.visible=true;visibility({webviewPanel:this});},onDidDispose(fn:()=>void){disposed=fn;return disposable;},onDidChangeViewState(fn:(e:any)=>void){visibility=fn;return disposable;},dispose(){disposed();}};return panel;},
    async showQuickPick(choices:any[]){const id=answers.shift();return choices.find(i=>i.id===id);},async showInputBox(){return undefined;},async showWarningMessage(){throw new Error('synthetic-unexpected-warning');}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  const fixedNow=Date.parse('2030-01-04T00:00:00Z');
  class SyntheticDate extends Date {constructor(...args:any[]){super(args.length?args[0]:fixedNow);}static now(){return fixedNow;}}
  const module={exports:{} as any};
  runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports,SyntheticDate);
  extension=module.exports;await extension.activate({subscriptions});
  assert.deepEqual([...commands.keys()].sort(),[...AUDIT_COMMANDS,'cyclegauge.copyDiagnostics','cyclegauge.costAdvisor','cyclegauge.showUsage'].sort());
  assert.ok(api.state.providers.has('cyclegauge.auditView'));
  const advisor=items.find(i=>i.command==='cyclegauge.costAdvisor');assert.equal(advisor.visible,false);
  await commands.get('cyclegauge.showUsage')!();assert.equal(advisor.visible,true);
  assert.deepEqual(options,{enableScripts:false,enableCommandUris:false,localResourceRoots:[]});
  assert.match(panel.webview.html,/cost-advisor/);
   answers.push('plan:pro_max','consumer_prepaid','none');await commands.get('cyclegauge.costAdvisor')!();
   assert.match(panel.webview.html,/Confirmed by you/);assert.match(panel.webview.html,/Modelled estimate/);assert.match(panel.webview.html,/USD/);
   assert.ok(!/Supported estimate|Guaranteed savings/.test(panel.webview.html));
   const before=panel.webview.html;answers.push(undefined);await commands.get('cyclegauge.costAdvisor')!();assert.equal(panel.webview.html,before);
   answers.push('reset');await commands.get('cyclegauge.costAdvisor')!();assert.ok(!panel.webview.html.includes('Confirmed by you'));
  assert.ok(!panel.webview.html.includes('synthetic-bundle-account'));assert.ok(!panel.webview.html.includes(work));
  panel.visible=false;visibility({webviewPanel:panel});assert.equal(advisor.visible,false);
  await commands.get('cyclegauge.showUsage')!();assert.equal(advisor.visible,true);
  panel.dispose();assert.equal(advisor.visible,false);
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});

// Native-API stand-ins for the audit sidebar: an in-memory document store (nothing is read back from or written to disk by edits),
// a recording tree-view registry and a Map-backed workspaceState.
const auditApi=()=>{
 const state={providers:new Map<string,any>(),executed:[] as any[][],edits:[] as any[],shown:[] as any[],saves:0,docs:new Map<string,any>(),contentDocs:[] as any[],store:new Map<string,unknown>(),fires:0};
 class EventEmitter{listeners:any[]=[];event=(fn:any)=>{this.listeners.push(fn);return {dispose(){}};};fire(v:any){state.fires++;for(const l of this.listeners)l(v);}dispose(){}}
 class TreeItem{id?:string;description?:string;tooltip?:unknown;contextValue?:string;iconPath?:any;command?:any;resourceUri?:unknown;label:string;collapsibleState:number;constructor(label:string,collapsibleState:number){this.label=label;this.collapsibleState=collapsibleState;}}
 class ThemeIcon{id:string;constructor(id:string){this.id=id;}}
 class WorkspaceEdit{inserts:any[]=[];insert(uri:any,position:any,text:string){this.inserts.push({uri,position,text});}}
 const uri=(fsPath:string,scheme='file'):any=>({fsPath,scheme,with(o:any){return uri(fsPath,o.scheme??scheme);}});
 const key=(u:any)=>`${u.scheme}:${u.fsPath}`;
 return {state,Uri:{file:(p:string)=>uri(p)},EventEmitter,TreeItem,ThemeIcon,WorkspaceEdit,TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
  workspaceState:{get:(k:string)=>state.store.get(k),async update(k:string,v:unknown){if(v===undefined)state.store.delete(k);else state.store.set(k,structuredClone(v));}},
  workspace:{async openTextDocument(u:any){if(u.content!==undefined){const c={uri:{scheme:'untitled',fsPath:''},text:u.content,language:u.language,getText(){return this.text;},positionAt:(offset:number)=>({offset}),save(){state.saves++;}};state.contentDocs.push(c);return c;}let d=state.docs.get(key(u));if(!d){d={uri:u,text:u.scheme==='file'?readFileSync(u.fsPath,'utf8'):'',getText(){return this.text;},positionAt:(offset:number)=>({offset}),save(){state.saves++;}};state.docs.set(key(u),d);}return d;},
   async applyEdit(e:any){for(const i of e.inserts){const d=state.docs.get(key(i.uri));d.text=d.text.slice(0,i.position.offset)+i.text+d.text.slice(i.position.offset);}state.edits.push(e);return true;}},
  window:{registerTreeDataProvider(id:string,p:any){state.providers.set(id,p);return {dispose(){state.providers.delete(id);}};},async showTextDocument(d:any){state.shown.push(d);}},
  commands:{async executeCommand(...a:any[]){state.executed.push(a);}}};
};
const AUDIT_COMMANDS=['cyclegauge.audit.accept','cyclegauge.audit.acceptAll','cyclegauge.audit.clearDismissed','cyclegauge.audit.copy','cyclegauge.audit.dismiss','cyclegauge.audit.reveal','cyclegauge.auditWorkspace'];
const flatTree=(nodes:any[]):any[]=>nodes.flatMap(n=>[n,...flatTree(n.children??[])]);

// The audit command is registered before the collector starts, so a failing start leaves it available. It runs only on invocation.
test('packaged audit sidebar survives a failing start, refuses untrusted workspaces, lists findings and prepares changes without writing',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-bundle-')));
 const subscriptions:any[]=[];let extension:any;
 try{
  const source=join(work,'source'),workspace=join(work,'synthetic-workspace'),kiroignore=join(workspace,'.kiroignore');
  mkdirSync(join(source,'logs'),{recursive:true});mkdirSync(join(workspace,'dist'),{recursive:true});mkdirSync(join(work,'synthetic-owned','x'),{recursive:true});
  writeFileSync(join(workspace,'.env'),'SYNTHETIC_CONTENT_SENTINEL');writeFileSync(kiroignore,'/ignored.log\n');writeFileSync(join(workspace,'dist','synthetic.js'),'x');
  const bundle=await builtBundle(work);
  const api=auditApi(),st=api.state;
  const commands=new Map<string,(...a:any[])=>unknown>(),errors:string[]=[],warnings:string[]=[],infos:{text:string;extra:number}[]=[],clipboard:string[]=[];
  let trusted=false,folderPath=workspace,gate:Promise<void>|undefined,failProgress=false,ignoreFiles:unknown=['.kiroignore'],autoSave:unknown='off',failProvider=false,infoChoice:string|undefined;
  const disposable={dispose(){}};
  const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ProgressLocation:{Notification:15},ThemeColor:class{},Uri:api.Uri,RelativePattern:class{},extensions:{getExtension:()=>undefined},
   EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
   // Every command except the audit ones fails to register, which makes startExtension throw and exercises the fallback path.
   commands:{...api.commands,registerCommand(id:string,fn:(...a:any[])=>unknown){if(!id.startsWith('cyclegauge.audit'))throw new Error('synthetic-register-failure');commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
   env:{clipboard:{async writeText(t:string){clipboard.push(t);}}},
   workspace:{...api.workspace,get isTrusted(){return trusted;},get workspaceFolders(){return [{name:'synthetic-workspace',uri:{scheme:'file',fsPath:folderPath}}];},
    getConfiguration:(section:string)=>({get:(key:string)=>section==='files'?(key==='autoSave'?autoSave:undefined):section==='kiroAgent'?(key==='agentIgnoreFiles'?ignoreFiles:undefined):({sourceRoot:source,storageRoot:join(work,'synthetic-owned'),sourceTimezone:'UTC'} as any)[key]??''}),
    createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
   // No createWebviewPanel: the audit must not open a webview any more.
   window:{...api.window,registerTreeDataProvider(id:string,p:any){if(failProvider)throw new Error('synthetic-provider-failure');return api.window.registerTreeDataProvider(id,p);},createStatusBarItem(){return {text:'',show(){},hide(){},dispose(){}};},
    async showWarningMessage(m:string){warnings.push(m);},async showErrorMessage(m:string){errors.push(m);},
    async showInformationMessage(m:string,...rest:unknown[]){infos.push({text:m,extra:rest.length});return rest.length?infoChoice:undefined;},
    async withProgress(_o:any,task:(p:unknown,t:unknown)=>Promise<unknown>){await gate;if(failProgress)throw new Error('synthetic-progress-failure /private/synthetic-path');return task({},{onCancellationRequested:()=>disposable});}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  const module={exports:{} as any};
  runInThisContext(`(function(require,module,exports){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports);
  extension=module.exports;await extension.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')},workspaceState:api.workspaceState});
  assert.deepEqual([...commands.keys()].sort(),AUDIT_COMMANDS);
  const provider=st.providers.get('cyclegauge.auditView');assert.ok(provider);
  const roots=()=>provider.getChildren() as any[];const infoTexts=()=>infos.map(i=>i.text);
  const run=()=>commands.get('cyclegauge.auditWorkspace')!();
  const find=(label:string)=>flatTree(roots()).find(n=>n.label===label);
  const state=()=>st.store.get('cyclegauge.audit.dismissed.v1') as {salt:string;hashes:string[]}|undefined;
  // Untrusted: nothing is audited and the list stays empty (the view then shows its welcome text).
  await run();
  assert.deepEqual(warnings,['Cyclegauge audits only trusted workspaces.']);assert.deepEqual(roots(),[]);
  // Trusted: the tree lists the findings; the notification has no buttons; the view is focused.
  trusted=true;await run();
  assert.deepEqual(roots().map(n=>n.label),['Audited folder: synthetic-workspace','Global ignore files were not checked','Secrets and credentials (1)','Build output (1)']);
  assert.equal(roots()[0].description,'Complete');
  assert.deepEqual(infos,[{text:'Workspace audit: 2 findings.',extra:0}]);
  assert.ok(st.executed.some(a=>a[0]==='cyclegauge.auditView.focus'));
  const secretGroup=roots()[2],groupItem=provider.getTreeItem(secretGroup);
  assert.equal(groupItem.collapsibleState,2);assert.equal(groupItem.iconPath.id,'key');
  const env=find('.env'),dist=find('dist/');assert.equal(env.description,'Not covered · 26 B');assert.equal(dist.contextValue,'finding-suggestible');
  const envItem=provider.getTreeItem(env);assert.equal(envItem.resourceUri,undefined);assert.equal(envItem.iconPath.id,'key');assert.equal(typeof envItem.tooltip,'string');assert.equal(envItem.command,undefined);
  const shown=JSON.stringify(roots());assert.ok(!shown.includes(work));assert.ok(!shown.includes('SYNTHETIC_CONTENT_SENTINEL'));
  // Copy: clipboard only, the same snippet as before.
  await commands.get('cyclegauge.audit.copy')!();
  assert.equal(clipboard.length,1);assert.ok(clipboard[0]!.startsWith('# Suggested by Cyclegauge - review before adding\n'));assert.ok(clipboard[0]!.includes('/.env\n'));assert.ok(clipboard[0]!.endsWith('/dist/'));
  assert.ok(!clipboard[0]!.includes(work)&&!clipboard[0]!.includes('SYNTHETIC_CONTENT_SENTINEL'));
  // Accept with an existing .kiroignore: an unsaved edit on the opened document; the file on disk is untouched.
  const before=readFileSync(kiroignore);
  await commands.get('cyclegauge.audit.accept')!(env);
  assert.equal(st.edits.length,1);assert.equal(st.edits[0].inserts.length,1);
  const insert=st.edits[0].inserts[0];assert.equal(insert.uri.fsPath,kiroignore);assert.equal(insert.uri.scheme,'file');assert.equal(insert.position.offset,'/ignored.log\n'.length);
  assert.equal(insert.text,'# Suggested by Cyclegauge - review before saving\n/.env\n');
  assert.equal(st.shown.length,1);assert.equal(st.saves,0);assert.deepEqual(readFileSync(kiroignore),before);
  assert.equal(find('.env').description,'Not covered · 26 B · accepted (unsaved)');assert.ok(!find('dist/').description.includes('accepted'));
  // Accept all: one combined edit; lines already in the document and the header are not repeated.
  await commands.get('cyclegauge.audit.acceptAll')!();
  assert.equal(st.edits.length,2);assert.equal(st.edits[1].inserts[0].text,'/dist/\n');assert.equal(st.saves,0);assert.deepEqual(readFileSync(kiroignore),before);
  assert.ok(find('dist/').description.includes('accepted (unsaved)'));
  // Running again clears the accepted marks.
  await run();assert.ok(!find('.env').description.includes('accepted'));assert.ok(!find('dist/').description.includes('accepted'));
  // Accept without a .kiroignore: an unsaved untitled document at that path; nothing is created on disk.
  unlinkSync(kiroignore);st.docs.clear();
  await commands.get('cyclegauge.audit.accept')!(find('.env'));
  const created=st.edits.at(-1).inserts[0];assert.equal(created.uri.scheme,'untitled');assert.equal(created.uri.fsPath,kiroignore);assert.equal(created.text,'# Suggested by Cyclegauge - review before saving\n/.env\n');
  assert.equal(existsSync(kiroignore),false);assert.equal(st.saves,0);
  // A .kiroignore that is not a regular file is not touched.
  mkdirSync(kiroignore);const editsBefore=st.edits.length;await commands.get('cyclegauge.audit.accept')!(find('.env'));assert.equal(st.edits.length,editsBefore);rmSync(kiroignore,{recursive:true});
  // A symlinked .kiroignore is refused too (skipped where links need privileges); the target is left alone.
  const target=join(work,'synthetic-link-target');writeFileSync(target,'synthetic-target\n');
  try{symlinkSync(target,kiroignore);const linkEdits=st.edits.length,linkDocs=st.docs.size;await commands.get('cyclegauge.audit.accept')!(find('.env'));assert.equal(st.edits.length,linkEdits);assert.equal(st.docs.size,linkDocs);assert.equal(readFileSync(target,'utf8'),'synthetic-target\n');unlinkSync(kiroignore);}catch(e){if(!(e as NodeJS.ErrnoException).code?.match(/^(EPERM|EACCES|ENOSYS)$/))throw e;}
  writeFileSync(kiroignore,'/ignored.log\n');
  // Tree ids are opaque: they never contain a path.
  assert.ok(flatTree(roots()).every(n=>!/\.env|dist|synthetic-workspace/.test(n.id)));assert.ok(flatTree(roots()).some(n=>/^finding:secret:\d+$/.test(n.id)));
  // Item commands look the finding up again: a forged node cannot smuggle in a suggestion or a path.
  writeFileSync(kiroignore,'/ignored.log\n');st.docs.clear();const editsAtForge=st.edits.length;
  const forged=(over:any)=>({kind:'finding',id:'finding:secret:0',finding:{path:'.env',isDir:false,category:'secret',coverage:'not_covered',suggestion:'/synthetic-malicious\n!/*',...over}});
  await commands.get('cyclegauge.audit.accept')!(forged({path:'synthetic-unknown.pem'}));assert.equal(st.edits.length,editsAtForge);assert.equal(st.docs.size,0);
  await commands.get('cyclegauge.audit.accept')!(forged({}));
  assert.equal(st.edits.length,editsAtForge+1);assert.equal(st.edits.at(-1).inserts[0].text,'# Suggested by Cyclegauge - review before saving\n/.env\n');assert.ok(!JSON.stringify(st.edits).includes('malicious'));
  await commands.get('cyclegauge.audit.dismiss')!(forged({path:'synthetic-unknown.pem'}));assert.equal(state(),undefined);
  // Auto save on: the real .kiroignore document is never edited; the lines open in a separate untitled tab instead.
  for(const mode of ['afterDelay','onFocusChange','onWindowChange']){
   autoSave=mode;st.docs.clear();st.contentDocs.length=0;infos.length=0;const editCount:number=st.edits.length,shownCount:number=st.shown.length;
   await commands.get('cyclegauge.audit.accept')!(find('.env'));
   assert.equal(st.edits.length,editCount,mode);assert.equal(st.docs.size,0,mode);assert.equal(st.contentDocs.length,1,mode);
   assert.equal(st.contentDocs[0].text,'# Suggested by Cyclegauge - review before saving\n/.env\n');assert.equal(st.contentDocs[0].language,'ignore');assert.equal(st.contentDocs[0].uri.scheme,'untitled');
   assert.equal(st.shown.length,shownCount+1);assert.equal(st.shown.at(-1),st.contentDocs[0]);assert.equal(st.saves,0);
   assert.deepEqual(infoTexts(),['Your editor saves files automatically, so the suggested lines are shown in a new tab. Copy them into .kiroignore and save.']);
   assert.equal(readFileSync(kiroignore,'utf8'),'/ignored.log\n');
  }
  // An unset value counts as off.
  autoSave=undefined;st.docs.clear();st.contentDocs.length=0;const editsUnset=st.edits.length;await commands.get('cyclegauge.audit.accept')!(find('.env'));assert.equal(st.edits.length,editsUnset);assert.equal(st.contentDocs.length,1);
  autoSave='off';infos.length=0;
  // Ignore: only salted hex hashes reach workspaceState, and the finding disappears (also from Copy and after a re-run).
  clipboard.length=0;
  await commands.get('cyclegauge.audit.dismiss')!(find('.env'));
  const stored=state()!;assert.deepEqual(Object.keys(stored).sort(),['hashes','salt']);assert.match(stored.salt,/^[0-9a-f]{64}$/);assert.equal(stored.hashes.length,1);assert.match(stored.hashes[0]!,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(stored).includes('.env')&&!JSON.stringify(stored).includes(work)&&!JSON.stringify([...st.store]).includes('synthetic-workspace'));
  assert.deepEqual(roots().map(n=>n.label),['Audited folder: synthetic-workspace','Global ignore files were not checked','Build output (1)','1 ignored by you']);
  const footer=roots().at(-1);assert.equal(footer.action,'clearDismissed');assert.equal(provider.getTreeItem(footer).command.command,'cyclegauge.audit.clearDismissed');
  await commands.get('cyclegauge.audit.copy')!();assert.ok(!clipboard[0]!.includes('/.env'));assert.ok(clipboard[0]!.includes('/dist/'));
  await commands.get('cyclegauge.audit.dismiss')!(find('.env')??{kind:'info'});await commands.get('cyclegauge.audit.dismiss')!(undefined);assert.equal(state()!.hashes.length,1);
  await run();assert.ok(!find('.env'));assert.equal(roots().at(-1).label,'1 ignored by you');
  await commands.get('cyclegauge.audit.clearDismissed')!();assert.equal(state(),undefined);assert.ok(find('.env'));
  // At most 2,000 hashes are kept: the oldest are dropped.
  const hex=(i:number)=>i.toString(16).padStart(64,'0'),goodSalt='a'.repeat(64);
  st.store.set('cyclegauge.audit.dismissed.v1',{salt:goodSalt,hashes:Array.from({length:2000},(_,i)=>hex(i))});
  await commands.get('cyclegauge.audit.dismiss')!(find('.env'));
  assert.equal(state()!.hashes.length,2000);assert.equal(state()!.hashes[0],hex(1));assert.match(state()!.hashes.at(-1)!,/^[0-9a-f]{64}$/);assert.ok(!state()!.hashes.includes(hex(0)));assert.equal(state()!.salt,goodSalt);
  // An invalid stored salt is discarded together with its hashes and replaced by a fresh random one.
  st.store.set('cyclegauge.audit.dismissed.v1',{salt:'synthetic-not-hex',hashes:[hex(5)]});
  await commands.get('cyclegauge.audit.dismiss')!(find('dist/'));
  assert.match(state()!.salt,/^[0-9a-f]{64}$/);assert.notEqual(state()!.salt,'synthetic-not-hex');assert.equal(state()!.hashes.length,1);assert.notEqual(state()!.hashes[0],hex(5));
  await commands.get('cyclegauge.audit.clearDismissed')!();
  // Show file: always revealed in the Explorer, never opened in an editor tab; unknown or forged nodes do nothing.
  writeFileSync(join(workspace,'small.log'),Buffer.alloc(200*1024));writeFileSync(join(workspace,'big.log'),Buffer.alloc(2*1024*1024));
  const outside=join(work,'synthetic-outside.log');writeFileSync(outside,'x');
  await run();st.executed.length=0;
  const reveal=commands.get('cyclegauge.audit.reveal')!,last=()=>st.executed.at(-1)!;
  await reveal(find('small.log'));assert.equal(last()[0],'revealInExplorer');assert.equal(last()[1].fsPath,join(workspace,'small.log'));
  await reveal(find('big.log'));assert.equal(last()[0],'revealInExplorer');
  await reveal(find('.env'));assert.equal(last()[0],'revealInExplorer');assert.equal(last()[1].fsPath,join(workspace,'.env'));
  await reveal(find('dist/'));assert.equal(last()[0],'revealInExplorer');assert.equal(last()[1].fsPath,join(workspace,'dist'));
  assert.ok(!st.executed.some(a=>a[0]==='vscode.open'));
  st.executed.length=0;infos.length=0;
  for(const path of ['../synthetic-outside.log','dist/../../synthetic-outside.log'])await reveal({kind:'finding',finding:{path,isDir:false,category:'log',size:1,coverage:'not_covered',suggestion:''}});
  await reveal({kind:'group'});await reveal('synthetic-not-a-node');await reveal(undefined);
  assert.equal(st.executed.length,0);
  // A file replaced by a link to somewhere outside the root after the audit is refused as well (skipped where links need privileges).
  let linked=false;try{unlinkSync(join(workspace,'small.log'));symlinkSync(outside,join(workspace,'small.log'));linked=true;}catch{/* no link privilege */}
  if(linked){infos.length=0;await reveal(find('small.log'));assert.equal(st.executed.length,0);assert.equal(infos.length,1);}
  unlinkSync(join(workspace,'big.log'));await reveal(find('big.log'));assert.equal(st.executed.length,0);
  rmSync(join(workspace,'small.log'),{force:true});rmSync(join(workspace,'big.log'),{force:true});
  // Ignore-mode notes and the setting action (the setting is only ever opened, never changed).
  ignoreFiles=['.other'];writeFileSync(kiroignore,'/ignored.log\n');await run();
  const note=roots().find(n=>n.action==='openIgnoreSetting');assert.ok(note);
  assert.deepEqual(provider.getTreeItem(note).command,{command:'workbench.action.openSettings',title:'Open Agent Ignore Files setting',arguments:['kiroAgent.agentIgnoreFiles']});
  ignoreFiles=[];await run();assert.ok(roots().some(n=>n.label==='Workspace ignore files are disabled'));ignoreFiles=undefined;await run();assert.ok(roots().some(n=>n.label==='Could not read the Agent Ignore Files setting'));ignoreFiles=['.kiroignore'];
  // A second invocation while one is in progress is declined; the lock is released afterwards.
  let release:()=>void=()=>{};gate=new Promise<void>(r=>{release=r;});infos.length=0;
  const first=run();await new Promise(r=>setImmediate(r));
  await run();assert.deepEqual(infoTexts(),['A workspace audit is already running.']);
  release();await first;gate=undefined;assert.equal(infos.length,2);
  // Folders overlapping the configured source or storage roots are refused, and nothing is audited or replaced.
  infos.length=0;warnings.length=0;const kept=JSON.stringify(roots());
  for(const path of [source,join(source,'logs'),join(work,'synthetic-owned','x'),join(work,'synthetic-missing')]){
   folderPath=path;await run();
  }
  assert.deepEqual(warnings,["This folder can't be audited: it overlaps Kiro data.","This folder can't be audited: it overlaps Kiro data.","This folder can't be audited: it overlaps Cyclegauge storage.","This folder can't be audited: its real location could not be resolved."]);
  assert.deepEqual(infos,[]);assert.equal(JSON.stringify(roots()),kept);
  // Any failure becomes one fixed message, and the lock is released.
  folderPath=workspace;failProgress=true;await run();failProgress=false;
  assert.deepEqual(errors,['The workspace audit failed.']);infos.length=0;await run();assert.deepEqual(infoTexts(),['Workspace audit: 2 findings.']);
  assert.equal(st.saves,0);
  warnings.length=0;trusted=false;for(const d of subscriptions)d.dispose();assert.equal(commands.size,0);assert.equal(st.providers.size,0);
  // If the list cannot be registered, the commands stay available and a finished audit offers one clipboard-only button.
  failProvider=true;trusted=true;infos.length=0;clipboard.length=0;const edits2=st.edits.length;
  const module2={exports:{} as any},subscriptions2:any[]=[];
  runInThisContext(`(function(require,module,exports){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module2,module2.exports);
  await module2.exports.activate({subscriptions:subscriptions2,globalStorageUri:{fsPath:join(work,'global')},workspaceState:api.workspaceState});
  try{
   assert.deepEqual([...commands.keys()].sort(),AUDIT_COMMANDS);assert.equal(st.providers.size,0);st.executed.length=0;
   infoChoice='Copy suggestions';await run();
   assert.deepEqual(infos,[{text:'Workspace audit: 2 findings.',extra:1}]);assert.equal(clipboard.length,1);assert.ok(clipboard[0]!.includes('/.env\n')&&clipboard[0]!.endsWith('/dist/'));
   assert.ok(!st.executed.some(a=>a[0]==='cyclegauge.auditView.focus'));assert.equal(st.edits.length,edits2);
   infos.length=0;clipboard.length=0;infoChoice=undefined;await run();assert.equal(infos.length,1);assert.equal(clipboard.length,0);
  }finally{module2.exports.deactivate();for(const d of subscriptions2)d.dispose();}
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});

// node:sqlite is loaded lazily, so a runtime without it still loads the bundle, registers its commands and says an update is needed.
test('packaged bundle has no top-level node:sqlite require and still starts without it',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-runtime-bundle-')));
 const subscriptions:any[]=[];let extension:any;const original=process.getBuiltinModule;
 try{
  const bundle=await builtBundle(work);
  assert.ok(!/require\(\s*["']node:sqlite["']\s*\)/.test(bundle),'node:sqlite must not be required when the bundle loads');
  const source=join(work,'source'),storage=join(work,'owned');mkdirSync(source,{recursive:true});
  const commands=new Map<string,()=>unknown>(),items:any[]=[],panels:any[]=[];const disposable={dispose(){}};
  const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ThemeColor:class{},Uri:{file:(fsPath:string)=>({fsPath})},RelativePattern:class{},extensions:{getExtension:()=>undefined},
   commands:{registerCommand(id:string,fn:()=>unknown){commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
   workspace:{getConfiguration:()=>({get:(key:string)=>({sourceRoot:source,storageRoot:storage,sourceTimezone:'UTC'} as any)[key]??''}),createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
   window:{createStatusBarItem(){const item:any={text:'',show(){},hide(){},dispose(){}};items.push(item);return item;},
    createWebviewPanel(_t:string,_title:string,_c:number,o:any){const p={options:o,webview:{html:''},reveal(){},onDidDispose(){return disposable;},onDidChangeViewState(){return disposable;},dispose(){}};panels.push(p);return p;}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  const module={exports:{} as any};
  (process as {getBuiltinModule?:unknown}).getBuiltinModule=()=>undefined;
  runInThisContext(`(function(require,module,exports){${bundle}\n})`)((id:string)=>{if(id==='vscode')return vscode;if(/^(node:)?sqlite$/.test(id))throw new Error('synthetic-no-sqlite');return require(id);},module,module.exports);
  extension=module.exports;await extension.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')}});
  assert.ok(commands.has('cyclegauge.showUsage'));assert.ok(commands.has('cyclegauge.auditWorkspace'));
  assert.equal(items[0].text,'$(warning) Kiro: update needed');
  await commands.get('cyclegauge.showUsage')!();
  assert.match(panels[0].webview.html,/does not provide the SQLite support/);
  assert.equal(existsSync(storage),false);
 }finally{process.getBuiltinModule=original;extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});

// Copy Diagnostics opens an unsaved plaintext document and copies the same text; it is registered before the collector starts.
const diagnosticsHarness=(work:string,source:string,storage:string,allow:(id:string)=>boolean,editor:{appName?:unknown;version?:unknown})=>{
 const commands=new Map<string,()=>unknown>(),opened:any[]=[],shown:any[]=[],clipboard:string[]=[],infos:string[]=[],errors:string[]=[];const disposable={dispose(){}};
 const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ThemeColor:class{},Uri:{file:(fsPath:string)=>({fsPath})},RelativePattern:class{},extensions:{getExtension:()=>undefined},version:editor.version,
  commands:{registerCommand(id:string,fn:()=>unknown){if(!allow(id))throw new Error('synthetic-register-failure');commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
  env:{appName:editor.appName,clipboard:{async writeText(t:string){clipboard.push(t);}}},
  workspace:{getConfiguration:()=>({get:(key:string)=>({sourceRoot:source,storageRoot:storage,sourceTimezone:'Europe/Berlin'} as any)[key]??''}),createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}}),
   async openTextDocument(o:any){opened.push(o);return {untitled:true,...o};}},
  window:{createStatusBarItem(){return {text:'',show(){},hide(){},dispose(){}};},createWebviewPanel(_t:string,_title:string,_c:number,o:any){return {options:o,webview:{html:''},reveal(){},onDidDispose(){return disposable;},onDidChangeViewState(){return disposable;},dispose(){}};},
   async showTextDocument(d:any){shown.push(d);},async showInformationMessage(m:string){infos.push(m);},async showErrorMessage(m:string){errors.push(m);}}};
 const require=createRequire(new URL('../../package.json',import.meta.url));
 const module={exports:{} as any};
 return {commands,opened,shown,clipboard,infos,errors,module,load:(bundle:string)=>runInThisContext(`(function(require,module,exports){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports)};
};
const diagnosticsFields=(text:string)=>Object.fromEntries(text.split('\n').slice(1).filter(Boolean).map(l=>[l.slice(0,l.indexOf(': ')),l.slice(l.indexOf(': ')+2)]));
test('packaged Copy Diagnostics opens an untitled document, copies the same text and leaks nothing',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-diagnostics-bundle-')));
 const subscriptions:any[]=[];let extension:any;
 try{
  const source=join(work,'source'),storage=join(work,'owned'),logs=join(source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
  mkdirSync(logs,{recursive:true});
  writeFileSync(join(logs,'q-client.log'),`2030-01-04 00:00:00.000 [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-bundle-account'},nextDateReset:'2030-02-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:4.35,usageLimitWithPrecision:50,nextDateReset:'2030-02-01T00:00:00Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n');
  const h=diagnosticsHarness(work,source,storage,()=>true,{appName:'Synthetic Editor',version:'1.99.0'});
  h.load(await builtBundle(work));extension=h.module.exports;await extension.activate({subscriptions});
  assert.ok(h.commands.has('cyclegauge.copyDiagnostics'));
  await h.commands.get('cyclegauge.copyDiagnostics')!();
  assert.equal(h.opened.length,1);assert.equal(h.opened[0].language,'plaintext');assert.deepEqual(Object.keys(h.opened[0]).sort(),['content','language']);
  assert.equal(h.shown.length,1);assert.equal(h.shown[0].untitled,true);assert.deepEqual(h.clipboard,[h.opened[0].content]);
  assert.deepEqual(h.infos,['Diagnostics copied. Review them before pasting.']);assert.deepEqual(h.errors,[]);
  const text:string=h.clipboard[0]!,f=diagnosticsFields(text);
  assert.ok(text.startsWith('# Cyclegauge diagnostics — fixed codes and counts only. Review before sharing.\n'));
  assert.equal(f.cyclegauge,JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')).version);
  assert.equal(f.surface,'extension');assert.equal(f.editor,'Synthetic Editor');assert.equal(f.editor_version,'1.99.0');assert.equal(f.gauge,'running');assert.equal(f.store,'ok');
  assert.equal(f.storage,'chosen');assert.equal(f.source,'chosen');assert.equal(f.timezone,'chosen');assert.equal(f.snapshots,'1');assert.equal(f.accounts,'1');assert.equal(f.audit,'available');
  for(const marker of [work,'synthetic-','Europe/Berlin','4.35','45.65','/','\\'])assert.ok(!text.includes(marker),marker);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text));
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged Copy Diagnostics still works when the gauge failed to start and reports hostile editor metadata as other',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-diagnostics-failed-bundle-')));
 const subscriptions:any[]=[];let extension:any;
 try{
  const source=join(work,'source');mkdirSync(join(source,'logs'),{recursive:true});
  const h=diagnosticsHarness(work,source,join(work,'owned'),id=>id==='cyclegauge.copyDiagnostics',{appName:'/synthetic/private/Editor',version:'1.2 synthetic-token'});
  h.load(await builtBundle(work));extension=h.module.exports;await extension.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')}});
  assert.deepEqual([...h.commands.keys()],['cyclegauge.copyDiagnostics']);
  await h.commands.get('cyclegauge.copyDiagnostics')!();
  const text:string=h.clipboard[0]!,f=diagnosticsFields(text);
  assert.equal(h.opened[0].content,text);assert.equal(f.gauge,'failed_to_start');assert.equal(f.store,'not_opened');assert.equal(f.editor,'other');assert.equal(f.editor_version,'other');assert.equal(f.status,'unavailable');
  assert.ok(!text.includes('synthetic')&&!text.includes(work));
  // A failure while opening the document becomes one fixed message.
  const failing=diagnosticsHarness(work,source,join(work,'owned'),id=>id==='cyclegauge.copyDiagnostics',{appName:'Synthetic Editor',version:'1.99.0'});
  (failing as any).opened.push=()=>{throw new Error('synthetic-open-failure /private/synthetic-path');};
  failing.load(await builtBundle(work));await failing.module.exports.activate({subscriptions});await failing.commands.get('cyclegauge.copyDiagnostics')!();
  assert.deepEqual(failing.errors,['Diagnostics could not be copied.']);assert.deepEqual(failing.clipboard,[]);
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});
