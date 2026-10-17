import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync,unlinkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as realFsPromises from 'node:fs/promises';
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
  assert.deepEqual([...commands.keys()].sort(),[...AUDIT_COMMANDS,'cyclegauge.copyDiagnostics','cyclegauge.costAdvisor','cyclegauge.showUsage','cyclegauge.share','cyclegauge.support.reset'].sort());
  assert.ok(api.state.providers.has('cyclegauge.auditView'));
  const advisor=items.find(i=>i.command==='cyclegauge.costAdvisor');assert.equal(advisor.visible,false);
  await commands.get('cyclegauge.showUsage')!();assert.equal(advisor.visible,true);
  // Scripts stay off; the only command links are exactly four Cyclegauge commands, listed explicitly; the footer adds three fixed web links.
  assert.deepEqual(options,{enableScripts:false,enableCommandUris:['cyclegauge.costAdvisor','cyclegauge.auditWorkspace','cyclegauge.audit.show','cyclegauge.share'],localResourceRoots:[]});
  const allLinks=()=>[...panel.webview.html.matchAll(/href="([^"]*)"/g)].map((m:RegExpMatchArray)=>m[1]!);
  const linkIds=()=>allLinks().filter((h:string)=>h.startsWith('command:')&&h!=='command:cyclegauge.share');
  for(const h of allLinks().filter((h:string)=>h.startsWith('command:'))){assert.match(h,/^command:cyclegauge\.[A-Za-z.]+$/);assert.ok(options.enableCommandUris.includes(h.slice('command:'.length)),h);}
  assert.deepEqual(allLinks().filter((h:string)=>!h.startsWith('command:')),COMMUNITY_LINKS);assert.ok(allLinks().includes('command:cyclegauge.share'));
  assert.ok(linkIds().includes('command:cyclegauge.costAdvisor'));assert.ok(linkIds().includes('command:cyclegauge.auditWorkspace'));assert.ok(!linkIds().includes('command:cyclegauge.audit.show'));
  assert.match(panel.webview.html,/Workspace check/);assert.ok(!/<script/i.test(panel.webview.html));
  assert.match(panel.webview.html,/cost-advisor/);
   answers.push('plan:pro_max','consumer_prepaid','none');await commands.get(linkIds().find((h:string)=>h==='command:cyclegauge.costAdvisor')!.slice('command:'.length))!();
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
 const state={providers:new Map<string,any>(),executed:[] as any[][],edits:[] as any[],shown:[] as any[],saves:0,docs:new Map<string,any>(),contentDocs:[] as any[],store:new Map<string,unknown>(),fires:0,saveListeners:[] as any[]};
 class EventEmitter{listeners:any[]=[];event=(fn:any)=>{this.listeners.push(fn);return {dispose(){}};};fire(v:any){state.fires++;for(const l of this.listeners)l(v);}dispose(){}}
 class TreeItem{id?:string;description?:string;tooltip?:unknown;contextValue?:string;iconPath?:any;command?:any;resourceUri?:unknown;label:string;collapsibleState:number;constructor(label:string,collapsibleState:number){this.label=label;this.collapsibleState=collapsibleState;}}
 class ThemeIcon{id:string;constructor(id:string){this.id=id;}}
 class WorkspaceEdit{inserts:any[]=[];insert(uri:any,position:any,text:string){this.inserts.push({uri,position,text});}}
 const uri=(fsPath:string,scheme='file'):any=>({fsPath,scheme,with(o:any){return uri(fsPath,o.scheme??scheme);}});
 const key=(u:any)=>`${u.scheme}:${u.fsPath}`;
 return {state,Uri:{file:(p:string)=>uri(p)},EventEmitter,TreeItem,ThemeIcon,WorkspaceEdit,TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
  workspaceState:{get:(k:string)=>state.store.get(k),async update(k:string,v:unknown){if(v===undefined)state.store.delete(k);else state.store.set(k,structuredClone(v));}},
  workspace:{onDidSaveTextDocument(fn:any){state.saveListeners.push(fn);return {dispose(){state.saveListeners=state.saveListeners.filter(x=>x!==fn);}};},async openTextDocument(u:any){if(u.content!==undefined){const c={uri:{scheme:'untitled',fsPath:''},text:u.content,language:u.language,getText(){return this.text;},positionAt:(offset:number)=>({offset}),save(){state.saves++;}};state.contentDocs.push(c);return c;}let d=state.docs.get(key(u));if(!d){d={uri:u,text:u.scheme==='file'?readFileSync(u.fsPath,'utf8'):'',getText(){return this.text;},positionAt:(offset:number)=>({offset}),save(){state.saves++;}};state.docs.set(key(u),d);}return d;},
   async applyEdit(e:any){for(const i of e.inserts){const d=state.docs.get(key(i.uri));d.text=d.text.slice(0,i.position.offset)+i.text+d.text.slice(i.position.offset);}state.edits.push(e);return true;}},
  window:{registerTreeDataProvider(id:string,p:any){state.providers.set(id,p);return {dispose(){state.providers.delete(id);}};},async showTextDocument(d:any){state.shown.push(d);}},
  commands:{async executeCommand(...a:any[]){state.executed.push(a);}}};
};
const COMMUNITY_LINKS=['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews','https://github.com/StefanSuess/Cyclegauge','https://ko-fi.com/stefansuess'];
const AUDIT_COMMANDS=['cyclegauge.audit.accept','cyclegauge.audit.acceptAll','cyclegauge.audit.clearDismissed','cyclegauge.audit.copy','cyclegauge.audit.dismiss','cyclegauge.audit.resetReminder','cyclegauge.audit.reveal','cyclegauge.audit.show','cyclegauge.auditWorkspace'];
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
  assert.deepEqual(roots().map(n=>n.label),['2 items Kiro may read','Secrets and credentials (1)','Build output (1)']);
  assert.match(roots()[0].description,/^synthetic-workspace · checked (just now|\d+ min ago)$/);
  assert.deepEqual(infos,[{text:'2 items Kiro may read — see the Kiro Workspace Audit view.',extra:0}]);
  assert.ok(st.executed.some(a=>a[0]==='cyclegauge.auditView.focus'));
  const secretGroup=roots()[1],groupItem=provider.getTreeItem(secretGroup);
  assert.equal(groupItem.collapsibleState,2);assert.equal(groupItem.iconPath.id,'key');
  const env=find('.env'),dist=find('dist/');assert.equal(env.description,'Kiro may read this');assert.ok(env.tooltip.includes('Size: 26 B'));assert.equal(dist.contextValue,'finding-suggestible');
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
  assert.equal(find('.env').description,'Kiro may read this · rule prepared (unsaved)');assert.ok(!find('dist/').description.includes('rule prepared'));
  // Accept all: one combined edit; lines already in the document and the header are not repeated.
  await commands.get('cyclegauge.audit.acceptAll')!();
  assert.equal(st.edits.length,2);assert.equal(st.edits[1].inserts[0].text,'/dist/\n');assert.equal(st.saves,0);assert.deepEqual(readFileSync(kiroignore),before);
  assert.ok(find('dist/').description.includes('rule prepared (unsaved)'));
  // Running again clears the accepted marks.
  await run();assert.ok(!find('.env').description.includes('rule prepared'));assert.ok(!find('dist/').description.includes('rule prepared'));
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
  assert.deepEqual(roots().map(n=>n.label),['1 item Kiro may read','Build output (1)','1 hidden by you']);
  const footer=roots().at(-1);assert.equal(footer.action,'clearDismissed');assert.equal(provider.getTreeItem(footer).command.command,'cyclegauge.audit.clearDismissed');
  await commands.get('cyclegauge.audit.copy')!();assert.ok(!clipboard[0]!.includes('/.env'));assert.ok(clipboard[0]!.includes('/dist/'));
  await commands.get('cyclegauge.audit.dismiss')!(find('.env')??{kind:'info'});await commands.get('cyclegauge.audit.dismiss')!(undefined);assert.equal(state()!.hashes.length,1);
  await run();assert.ok(!find('.env'));assert.equal(roots().at(-1).label,'1 hidden by you');
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
  ignoreFiles=[];await run();assert.ok(roots().some(n=>n.label==='Workspace ignore files are turned off'));ignoreFiles=undefined;await run();assert.ok(roots().some(n=>n.label==="Couldn't read the Agent Ignore Files setting"));ignoreFiles=['.kiroignore'];
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
  assert.deepEqual(errors,['The workspace audit failed.']);infos.length=0;await run();assert.deepEqual(infoTexts(),['2 items Kiro may read — see the Kiro Workspace Audit view.']);
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
   assert.deepEqual(infos,[{text:'2 items Kiro may read.',extra:1}]);assert.equal(clipboard.length,1);assert.ok(clipboard[0]!.includes('/.env\n')&&clipboard[0]!.endsWith('/dist/'));
   assert.ok(!st.executed.some(a=>a[0]==='cyclegauge.auditView.focus'));assert.equal(st.edits.length,edits2);
   infos.length=0;clipboard.length=0;infoChoice=undefined;await run();assert.equal(infos.length,1);assert.equal(clipboard.length,0);
  }finally{module2.exports.deactivate();for(const d of subscriptions2)d.dispose();}
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});

// Audit reminder: a once-per-window check 30 s after activation. The delay is intercepted so the check runs on demand; the clock is injected
// through the Date the bundle sees. Only the four documented workspaceState keys may be written, and never a path.
const REMINDER_KEYS=['cyclegauge.audit.last.v1','cyclegauge.audit.snoozeUntil.v1','cyclegauge.audit.neverRemind.v1','cyclegauge.audit.dismissed.v1'];
const reminderEnv=(work:string)=>{
 const source=join(work,'source'),workspace=join(work,'synthetic-workspace'),empty=join(work,'synthetic-empty'),single=join(work,'synthetic-single');
 const logs=join(source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 mkdirSync(logs,{recursive:true});mkdirSync(join(workspace,'dist'),{recursive:true});mkdirSync(empty,{recursive:true});mkdirSync(single,{recursive:true});writeFileSync(join(single,'.env'),'SYNTHETIC_CONTENT_SENTINEL');
 writeFileSync(join(logs,'q-client.log'),`2030-03-31 00:00:00.000 [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-bundle-account'},nextDateReset:'2030-04-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:4,usageLimitWithPrecision:50,nextDateReset:'2030-04-01T00:00:00Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n');
 writeFileSync(join(workspace,'.env'),'SYNTHETIC_CONTENT_SENTINEL');writeFileSync(join(workspace,'dist','synthetic.js'),'x');
 const store=new Map<string,unknown>(),written:string[]=[];
 const env={now:'2030-03-31T12:00:00Z',trusted:true,folders:[{name:'synthetic-workspace',uri:{scheme:'file',fsPath:workspace}}] as any[],days:undefined as unknown,automatic:undefined as unknown,
  choice:undefined as string|undefined,onInfo:undefined as (()=>void)|undefined,cancel:false,throwState:false,failStart:true,source,workspace,empty,single,store,written,gate:undefined as Promise<void>|undefined,readdirs:[] as string[],lstats:[] as string[],configCalls:[] as {section:string;args:number}[],
  panels:[] as any[],htmlSets:0,panelOptions:undefined as any,infos:[] as {text:string;buttons:string[]}[],warnings:[] as string[],errors:[] as string[],progress:0,executed:[] as any[][],statusTexts:[] as string[],clipboard:[] as string[]};
 return env;
};
const reminderSession=async(env:ReturnType<typeof reminderEnv>,work:string)=>{
 const api=auditApi(),commands=new Map<string,(...a:any[])=>unknown>(),subscriptions:any[]=[],disposable={dispose(){}};
 const bundle=await builtBundle(work);
 const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ProgressLocation:{Notification:15},ThemeColor:class{},Uri:api.Uri,RelativePattern:class{},extensions:{getExtension:()=>undefined},
  EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
  commands:{async executeCommand(...a:any[]){env.executed.push(a);},registerCommand(id:string,fn:(...a:any[])=>unknown){if(env.failStart&&!id.startsWith('cyclegauge.audit'))throw new Error('synthetic-register-failure');commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
  env:{clipboard:{async writeText(t:string){env.clipboard.push(t);}}},
  workspace:{...api.workspace,get isTrusted(){return env.trusted;},get workspaceFolders(){return env.folders;},
   getConfiguration:(section:string,...more:unknown[])=>(env.configCalls.push({section,args:more.length}),{get:(key:string)=>section==='kiroAgent'?(key==='agentIgnoreFiles'?['.kiroignore']:undefined):section==='files'?'off':
    ({sourceRoot:env.source,storageRoot:join(work,'synthetic-owned'),sourceTimezone:'UTC',auditReminderDays:env.days,auditAutomatically:env.automatic} as any)[key]??''}),
   createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
  window:{...api.window,createStatusBarItem(){const item={set text(t:string){env.statusTexts.push(t);},show(){},hide(){},dispose(){}};return item;},
   createWebviewPanel(_t:string,_title:string,_c:number,o:any){env.panelOptions=o;const panel={webview:{_h:'',get html(){return this._h;},set html(v:string){env.htmlSets++;this._h=v;}},reveal(){},onDidDispose:()=>disposable,onDidChangeViewState:()=>disposable,dispose(){}};env.panels.push(panel);return panel;},
   async showWarningMessage(m:string){env.warnings.push(m);},async showErrorMessage(m:string){env.errors.push(m);},
   async showInformationMessage(text:string,...buttons:string[]){env.infos.push({text,buttons});env.onInfo?.();return buttons.length?env.choice:undefined;},
   async withProgress(_o:any,task:(p:unknown,t:unknown)=>Promise<unknown>){env.progress++;return task({},{onCancellationRequested:(fn:()=>void)=>{if(env.cancel)fn();return disposable;}});}}};
 const workspaceState={get(k:string){if(env.throwState)throw new Error('synthetic-state-failure /private/synthetic-path');return env.store.get(k);},
  async update(k:string,v:unknown){if(env.throwState)throw new Error('synthetic-state-failure /private/synthetic-path');env.written.push(k);if(v===undefined)env.store.delete(k);else env.store.set(k,structuredClone(v));}};
 const fixedNow=Date.parse(env.now);
 class SyntheticDate extends Date {constructor(...args:any[]){super(args.length?args[0]:fixedNow);}static now(){return fixedNow;}}
 const timers:{fn:()=>Promise<void>;ms:number;cleared:boolean}[]=[];
 const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
 (globalThis as any).setTimeout=(fn:any,ms?:number,...rest:any[])=>{if(ms!==30000)return realSet(fn,ms,...rest);const t={fn,ms,cleared:false,unref(){return t;}};timers.push(t);return t;};
 (globalThis as any).clearTimeout=(t:any)=>{if(t&&timers.includes(t))t.cleared=true;else realClear(t);};
 const require=createRequire(new URL('../../package.json',import.meta.url));
 const module={exports:{} as any};
 // The walk's file system calls are observed (and the workspace listing can be held) so a run in flight can be inspected.
 const fsHook={...realFsPromises,async lstat(p:any,...a:any[]){env.lstats.push(String(p));return (realFsPromises.lstat as any)(p,...a);},async readdir(p:any,...a:any[]){env.readdirs.push(String(p));if(env.gate&&String(p)===env.workspace)await env.gate;return (realFsPromises.readdir as any)(p,...a);}};
 runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:id==='node:fs/promises'?fsHook:require(id),module,module.exports,SyntheticDate);
 try{await module.exports.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')},workspaceState});}finally{/* restored on disposal so delayed signal timers remain controllable */}
 let done=false;
 return {commands,timers,api,provider:()=>api.state.providers.get('cyclegauge.auditView'),
  fire:async()=>{assert.equal(timers.length,1);assert.equal(timers[0]!.ms,30000);return timers[0]!.fn();},
  dispose(){if(done)return;done=true;module.exports.deactivate();for(const d of subscriptions)d.dispose();(globalThis as any).setTimeout=realSet;(globalThis as any).clearTimeout=realClear;}};
};
const TODAY='2030-03-31';
// A function boundary keeps the narrowing from assert.deepEqual(env.infos, []) out of later reads.
const infoTexts=(env:{infos:{text:string}[]})=>env.infos.map(i=>i.text);
const firstInfo=(env:{infos:{text:string;buttons:string[]}[]})=>env.infos[0]!;
test('packaged audit reminder: guards, first prompt, buttons and stored state',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-reminder-bundle-')));
 const open:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);
  const start=async()=>{const s=await reminderSession(env,work);open.push(s);return s;};
  const reset=()=>{env.infos.length=0;env.warnings.length=0;env.errors.length=0;env.progress=0;env.executed.length=0;env.store.clear();env.written.length=0;env.choice=undefined;};
  // The timer is registered once, for 30 seconds, and disposed with the extension.
  let s=await start();assert.equal(s.timers.length,1);assert.equal(s.timers[0]!.cleared,false);s.dispose();assert.equal(s.timers[0]!.cleared,true);
  await s.timers[0]!.fn();assert.deepEqual(env.infos,[]);assert.equal(env.progress,0);assert.equal(env.written.length,0);
  // Untrusted, multi-root, non-file, no folder and refused roots: silent, nothing audited, nothing written.
  const folder=(fsPath:string,scheme='file')=>({name:'synthetic-workspace',uri:{scheme,fsPath}});
  const quiet=async(why:string)=>{s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[],why);assert.deepEqual(env.warnings,[],why);assert.equal(env.progress,0,why);assert.equal(env.written.length,0,why);assert.equal(env.store.size,0,why);assert.deepEqual(s.provider()?.getChildren()??[],[],why);};
  env.trusted=false;await quiet('untrusted');env.trusted=true;
  env.folders=[folder(env.workspace),folder(env.empty)];await quiet('multi-root');
  env.folders=[folder(env.workspace,'vscode-remote')];await quiet('remote');
  env.folders=[];await quiet('no folder');
  for(const refused of [env.source,join(env.source,'logs'),join(work,'synthetic-missing')]){env.folders=[folder(refused)];await quiet('refused');}
  env.folders=[folder(env.workspace)];
  for(const days of [0,-5]){env.days=days;await quiet(`days ${days}`);}env.days=undefined;
  // Never audited: one prompt with three buttons; the snooze is recorded when it is shown (today + reminderDays), so it is not repeated.
  s=await start();await s.fire();
  assert.deepEqual(env.infos,[{text:"Cyclegauge can check this workspace for files that may end up in Kiro's context.",buttons:['Run audit','Later',"Don't ask again"]}]);
  assert.equal(env.store.has('cyclegauge.audit.last.v1'),false);assert.equal(env.progress,0);assert.deepEqual(s.provider().getChildren(),[]);s.dispose();
  // The snooze (today + reminderDays) is already recorded while the prompt is open, so a prompt left unanswered is not repeated either.
  reset();let snoozeWhileOpen:unknown;env.onInfo=()=>{snoozeWhileOpen=env.store.get('cyclegauge.audit.snoozeUntil.v1');};
  s=await start();await s.fire();s.dispose();env.onInfo=undefined;assert.equal(snoozeWhileOpen,'2030-04-30');
  env.infos.length=0;s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);
  // The setting changes the period (also for Later): 10 days.
  reset();env.days=10;env.onInfo=()=>{snoozeWhileOpen=env.store.get('cyclegauge.audit.snoozeUntil.v1');};s=await start();await s.fire();s.dispose();env.onInfo=undefined;assert.equal(snoozeWhileOpen,'2030-04-10');env.days=undefined;
  // Later and a dismissed first prompt both wait a whole reminder period (30 days), not the 7 days of a regular reminder.
  for(const choice of ['Later',undefined]){reset();env.choice=choice;s=await start();await s.fire();s.dispose();assert.equal(env.store.get('cyclegauge.audit.snoozeUntil.v1'),'2030-04-30',String(choice));assert.equal(env.store.has('cyclegauge.audit.neverRemind.v1'),false);assert.equal(env.progress,0);}
  // After the snooze the prompt returns (unless it was dismissed for good).
  env.now='2030-04-29T00:00:00Z';env.infos.length=0;env.choice=undefined;s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);
  env.now='2030-04-30T00:00:00Z';s=await start();await s.fire();s.dispose();assert.equal(env.infos.length,1);env.now='2030-03-31T12:00:00Z';
  // Don't ask again: never again, however much time passes.
  reset();env.choice="Don't ask again";s=await start();await s.fire();s.dispose();
  assert.equal(env.store.get('cyclegauge.audit.neverRemind.v1'),true);
  env.infos.length=0;env.now='2031-03-31T00:00:00Z';env.choice=undefined;s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.equal(env.progress,0);env.now='2030-03-31T12:00:00Z';
  // Run audit: the normal command, with its progress notification; it records the date and fills the list.
  reset();env.choice='Run audit';s=await start();await s.fire();
  assert.equal(env.progress,1);assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);
  assert.deepEqual(s.provider().getChildren().map((n:any)=>n.label).slice(0,1),['2 items Kiro may read']);
  assert.deepEqual(infoTexts(env),["Cyclegauge can check this workspace for files that may end up in Kiro's context.",'2 items Kiro may read — see the Kiro Workspace Audit view.']);s.dispose();
  // A command-driven run records the date too (and only a finished, not cancelled, run does).
  reset();s=await start();await s.commands.get('cyclegauge.auditWorkspace')!();assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);s.dispose();
  reset();env.cancel=true;s=await start();await s.commands.get('cyclegauge.auditWorkspace')!();assert.equal(env.store.has('cyclegauge.audit.last.v1'),false);s.dispose();env.cancel=false;
  reset();env.folders=[folder(env.source)];s=await start();await s.commands.get('cyclegauge.auditWorkspace')!();assert.equal(env.store.has('cyclegauge.audit.last.v1'),false);s.dispose();env.folders=[folder(env.workspace)];
  // Reset: clears the snooze and the never flag, keeps the date of the last audit.
  reset();env.store.set('cyclegauge.audit.last.v1','2030-03-01');env.store.set('cyclegauge.audit.snoozeUntil.v1','2031-01-01');env.store.set('cyclegauge.audit.neverRemind.v1',true);
  s=await start();await s.commands.get('cyclegauge.audit.resetReminder')!();
  assert.deepEqual([...env.store],[['cyclegauge.audit.last.v1','2030-03-01']]);assert.deepEqual(infoTexts(env),['Audit reminder reset for this workspace.']);
  env.infos.length=0;await s.fire();assert.equal(firstInfo(env).text,'This workspace was last audited 30 days ago.');s.dispose();
  // Only the documented keys were written, with date-or-flag values and no path.
  assert.ok(env.written.every(k=>REMINDER_KEYS.includes(k)),env.written.join());
 }finally{for(const s of open)s.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged audit reminder: due reminder, automatic run and its limits',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-reminder-auto-bundle-')));
 const open:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);
  const start=async()=>{const s=await reminderSession(env,work);open.push(s);return s;};
  const reset=()=>{env.infos.length=0;env.warnings.length=0;env.errors.length=0;env.progress=0;env.executed.length=0;env.store.clear();env.written.length=0;env.choice=undefined;env.clipboard.length=0;};
  const last=(v:string)=>env.store.set('cyclegauge.audit.last.v1',v);
  // Due and not automatic: the reminder names the number of days, nothing runs, the list stays empty.
  reset();last('2030-03-01');let s=await start();await s.fire();
  assert.deepEqual(env.infos,[{text:'This workspace was last audited 30 days ago.',buttons:['Run audit','Later',"Don't remind me"]}]);
  assert.equal(env.progress,0);assert.deepEqual(s.provider().getChildren(),[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');s.dispose();
  // One day short of the period: nothing.
  reset();last('2030-03-02');s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);
  // Buttons: Later = +7 days, Don't remind me = never, Run audit = the command.
  reset();last('2020-03-31');env.choice='Later';s=await start();await s.fire();s.dispose();assert.equal(env.store.get('cyclegauge.audit.snoozeUntil.v1'),'2030-04-07');
  assert.equal(firstInfo(env).text,'This workspace was last audited 3652 days ago.');
  reset();last('2030-03-01');env.choice="Don't remind me";s=await start();await s.fire();s.dispose();assert.equal(env.store.get('cyclegauge.audit.neverRemind.v1'),true);
  reset();last('2030-03-01');env.choice='Run audit';s=await start();await s.fire();assert.equal(env.progress,1);assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);s.dispose();
  // Automatic: the audit runs without a progress notification; the list is updated; findings give one message with a Show button.
  reset();last('2030-03-01');env.automatic=true;s=await start();await s.fire();
  assert.equal(env.progress,0);assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);
  assert.deepEqual(env.infos,[{text:'2 items Kiro may read — see the Kiro Workspace Audit view.',buttons:['Show']}]);
  assert.equal(s.provider().getChildren()[0].label,'2 items Kiro may read');assert.ok(s.api.state.fires>0);assert.deepEqual(env.executed,[]);
  assert.ok(!JSON.stringify(s.provider().getChildren()).includes('SYNTHETIC_CONTENT_SENTINEL'));s.dispose();
  reset();last('2030-03-01');env.choice='Show';s=await start();await s.fire();assert.deepEqual(env.executed,[['cyclegauge.auditView.focus']]);s.dispose();
  // No findings: silent. Not due: nothing runs. Never audited or snoozed: the first prompt or nothing, never a background run.
  reset();last('2030-03-01');env.folders=[{name:'synthetic-empty',uri:{scheme:'file',fsPath:env.empty}}];s=await start();await s.fire();
  assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);assert.equal(s.provider().getChildren()[0].label,'No risky files found');s.dispose();env.folders=[{name:'synthetic-workspace',uri:{scheme:'file',fsPath:env.workspace}}];
  reset();last('2030-03-02');s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-02');
  reset();s=await start();await s.fire();s.dispose();assert.equal(firstInfo(env).buttons.length,3);assert.equal(env.store.has('cyclegauge.audit.last.v1'),false);
  reset();last('2030-03-01');env.store.set('cyclegauge.audit.snoozeUntil.v1','2030-04-01');s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');
  reset();last('2030-03-01');env.store.set('cyclegauge.audit.neverRemind.v1',true);s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');
  reset();last('2030-03-01');env.days=0;s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');env.days=undefined;
  // Invalid stored values count as absent.
  reset();last('synthetic-not-a-date');env.store.set('cyclegauge.audit.snoozeUntil.v1','2030-99-99');env.store.set('cyclegauge.audit.neverRemind.v1','yes');s=await start();await s.fire();s.dispose();assert.equal(firstInfo(env).buttons[2],"Don't ask again");
  // Untrusted or a refused root never auto-run, even when due.
  reset();last('2030-03-01');env.trusted=false;s=await start();await s.fire();s.dispose();env.trusted=true;assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');
  reset();last('2030-03-01');env.folders=[{name:'synthetic-source',uri:{scheme:'file',fsPath:env.source}}];s=await start();await s.fire();s.dispose();env.folders=[{name:'synthetic-workspace',uri:{scheme:'file',fsPath:env.workspace}}];assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');
  // A run in flight is held at the listing of the workspace. Without a dispose it walks every entry (baseline); a command invoked meanwhile is declined.
  reset();env.lstats.length=0;env.readdirs.length=0;last('2030-03-01');let release:()=>void=()=>{};env.gate=new Promise<void>(r=>{release=r;});
  s=await start();let pending=s.fire();while(!env.readdirs.includes(env.workspace))await new Promise(r=>setImmediate(r));
  await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.deepEqual(infoTexts(env),['An automatic workspace audit is running; try again shortly.']);assert.equal(env.progress,0);
  release();await pending;env.gate=undefined;s.dispose();
  const nested=join(env.workspace,'dist','synthetic.js');
  assert.ok(env.lstats.includes(nested),'an unaborted walk enters dist');assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);
  // Disposing the extension while the automatic run is in flight aborts its signal: the walk does not enter dist, and there is no list update, date or message.
  reset();env.lstats.length=0;env.readdirs.length=0;last('2030-03-01');env.gate=new Promise<void>(r=>{release=r;});
  s=await start();pending=s.fire();while(!env.readdirs.includes(env.workspace))await new Promise(r=>setImmediate(r));
  s.dispose();release();await pending;env.gate=undefined;
  assert.ok(!env.lstats.includes(nested));assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');assert.equal(env.errors.length,0);assert.deepEqual(s.provider()?.getChildren()??[],[]);
  // The reminder settings are application-scoped: they are read without a folder, so a workspace cannot set them.
  assert.ok(env.configCalls.some(c=>c.section==='cyclegauge'));assert.ok(env.configCalls.filter(c=>c.section==='cyclegauge').every(c=>c.args===0));
  // One counting rule: findings the user has not ignored plus omitted ones; singular forms.
  const hash=(salt:string,category:string,path:string)=>createHash('sha256').update(`${salt}\0${category}\0${path}`).digest('hex');
  const salt='b'.repeat(64);
  reset();last('2030-03-01');env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash(salt,'secret','.env')]});s=await start();await s.fire();
  assert.deepEqual(env.infos,[{text:'1 item Kiro may read — see the Kiro Workspace Audit view.',buttons:['Show']}]);s.dispose();
  reset();env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash(salt,'secret','.env')]});s=await start();await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.deepEqual(env.infos,[{text:'1 item Kiro may read — see the Kiro Workspace Audit view.',buttons:[]}]);s.dispose();
  env.folders=[{name:'synthetic-single',uri:{scheme:'file',fsPath:env.single}}];
  reset();last('2030-03-01');s=await start();await s.fire();assert.deepEqual(env.infos,[{text:'1 item Kiro may read — see the Kiro Workspace Audit view.',buttons:['Show']}]);s.dispose();
  reset();last('2030-03-01');env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash(salt,'secret','.env')]});s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);
  reset();env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash(salt,'secret','.env')]});s=await start();await s.commands.get('cyclegauge.auditWorkspace')!();s.dispose();assert.deepEqual(env.infos,[{text:'No risky files found.',buttons:[]}]);
  env.folders=[{name:'synthetic-workspace',uri:{scheme:'file',fsPath:env.workspace}}];
  reset();last('2030-03-30');env.days=1;env.automatic=false;env.choice=undefined;s=await start();await s.fire();s.dispose();assert.equal(firstInfo(env).text,'This workspace was last audited 1 day ago.');env.days=undefined;
  // Only the documented keys were written, and no stored value holds a path or file name.
  assert.ok(env.written.every(k=>REMINDER_KEYS.includes(k)),env.written.join());
  const everything=JSON.stringify([...env.store]);assert.ok(!everything.includes(work)&&!everything.includes('synthetic-workspace')&&!everything.includes('.env'));
 }finally{for(const s of open)s.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged workspace-check card: Show focuses the list or runs the audit, and a run updates the open panel',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-card-bundle-')));
 const open:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);env.failStart=false;
  const start=async()=>{const s=await reminderSession(env,work);open.push(s);return s;};
  const html=()=>env.panels.at(-1).webview.html as string;
  const hrefs=()=>[...html().matchAll(/href="([^"]*)"/g)].map(m=>m[1]!).filter(h=>h.startsWith('command:')&&h!=='command:cyclegauge.share');
  const ALLOWED=['cyclegauge.costAdvisor','cyclegauge.auditWorkspace','cyclegauge.audit.show','cyclegauge.share'];
  // Nothing checked yet: the card invites a check; "Show" is not offered; the panel's command allowlist is exactly four commands.
  let s=await start();await s.commands.get('cyclegauge.showUsage')!();
  assert.deepEqual(env.panelOptions,{enableScripts:false,enableCommandUris:ALLOWED,localResourceRoots:[]});
  assert.match(html(),/Workspace check/);assert.match(html(),/Check which files Kiro can read but probably doesn&#39;t need\./);
  assert.deepEqual(hrefs(),['command:cyclegauge.auditWorkspace','command:cyclegauge.costAdvisor']);
  // "Show" with no result runs the audit (and then focuses the list); the open panel now shows the count and the new button.
  env.executed.length=0;await s.commands.get('cyclegauge.audit.show')!();
  assert.equal(env.progress,1);assert.ok(env.executed.some(a=>a[0]==='cyclegauge.auditView.focus'));
  assert.match(html(),/2 items Kiro may read · checked just now/);
  assert.deepEqual(hrefs(),['command:cyclegauge.auditWorkspace','command:cyclegauge.audit.show','command:cyclegauge.costAdvisor']);
  for(const h of hrefs())assert.ok(ALLOWED.includes(h.slice('command:'.length)),h);
  assert.ok(!html().includes('synthetic-workspace')&&!html().includes(work)&&!/<script/i.test(html()));
  // With a result, "Show" only focuses the list. The card follows what the user hides.
  env.progress=0;env.executed.length=0;await s.commands.get('cyclegauge.audit.show')!();
  assert.equal(env.progress,0);assert.deepEqual(env.executed,[['cyclegauge.auditView.focus']]);
  const salt='a'.repeat(64),hash=(c:string,p:string)=>createHash('sha256').update(`${salt}\0${c}\0${p}`).digest('hex');
  env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash('secret','.env')]});await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.match(html(),/1 item Kiro may read · checked just now/);
  // The panel is re-rendered only when the summary changed: the same audit again (same counts and time) sets no HTML; hiding an item does.
  const sets=env.htmlSets;await s.commands.get('cyclegauge.auditWorkspace')!();assert.equal(env.htmlSets,sets);
  env.store.delete('cyclegauge.audit.dismissed.v1');await s.commands.get('cyclegauge.audit.clearDismissed')!();assert.equal(env.htmlSets,sets+1);assert.match(html(),/2 items Kiro may read · checked just now/);
  // Later renders (the minute timer's refresh) keep the card; an unavailable run says so and drops the Show button.
  env.trusted=false;await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.match(html(),/This folder can&#39;t be checked\. Run Check now to see why\./);assert.ok(!hrefs().includes('command:cyclegauge.audit.show'));env.trusted=true;s.dispose();
  // A broken workspaceState never takes the card or the gauge down.
  env.throwState=true;s=await start();await s.commands.get('cyclegauge.showUsage')!();assert.match(html(),/id="status-heading"/);assert.match(html(),/Workspace check/);env.throwState=false;s.dispose();
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged audit reminder: a failing workspaceState never breaks activation, the gauge or the audit command',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-reminder-state-bundle-')));
 const open:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);env.throwState=true;env.failStart=false;env.now='2030-03-31T12:00:00Z';
  const s=await reminderSession(env,work);open.push(s);
  assert.ok(s.commands.has('cyclegauge.showUsage'));assert.ok(s.commands.has('cyclegauge.auditWorkspace'));
  assert.ok(env.statusTexts.length>0&&env.statusTexts.every(t=>!/unavailable|update needed/.test(t)),env.statusTexts.join('|'));
  env.choice='Later';await s.fire();
  assert.equal(env.infos.length,1);assert.deepEqual(env.errors,[]);assert.equal(env.written.length,0);
  await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.equal(env.progress,1);assert.deepEqual(env.errors,[]);assert.equal(s.provider().getChildren()[0].label,'2 items Kiro may read');
  env.automatic=true;env.infos.length=0;await s.fire();assert.deepEqual(env.errors,[]);
 }finally{for(const s of open)s.dispose();rmSync(work,{recursive:true,force:true});}
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

// Community prompts: footer, share command, the support prompt and the "not Kiro" notice. The bundle sees an injected clock (Date), the 3-minute
// delay is intercepted so the check runs on demand, and HOME and friends point at an empty synthetic folder so no real Kiro folder is ever read.
const SUPPORT_KEYS=['cyclegauge.support.firstSeen.v1','cyclegauge.support.next.v1','cyclegauge.support.never.v1','cyclegauge.support.valueSeen.v1','cyclegauge.support.detailDays.v1','cyclegauge.support.advisorUsed.v1'];
const COMMUNITY_KEYS=[...SUPPORT_KEYS,'cyclegauge.notKiro.shown.v1'];
const SUPPORT_TEXT='Finding Cyclegauge useful? Rate it or support development. Turn off reminders in Cyclegauge settings.';
const NOT_KIRO='Cyclegauge is built for Kiro IDE. This editor has no Kiro credit logs, so the credit view stays empty. The workspace audit still works.';
const SUPPORT_BUTTONS=['Rate','Support','Later'];
const communityEnv=(work:string,withLogs:boolean)=>{
 const source=join(work,'source'),workspace=join(work,'synthetic-workspace'),logs=join(source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 mkdirSync(logs,{recursive:true});mkdirSync(workspace,{recursive:true});mkdirSync(join(work,'synthetic-home'),{recursive:true});writeFileSync(join(workspace,'.env'),'SYNTHETIC_CONTENT_SENTINEL');
 const logText=()=>[1,2,3,4].map(day=>`2030-01-0${day} 00:00:00.000 [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-bundle-account'},nextDateReset:'2030-02-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:day*10,usageLimitWithPrecision:5000,nextDateReset:'2030-02-01T00:00:00Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n').join('');
 if(withLogs)writeFileSync(join(logs,'q-client.log'),logText());
 // Kiro's standard data folder as the bundle resolves it under the synthetic HOME (set per session).
 const placeDefaultLogs=()=>{const dir=join(process.platform==='darwin'?join(work,'synthetic-home','Library','Application Support','Kiro'):join(work,'synthetic-home','Kiro'),'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'q-client.log'),logText());};
 return {placeDefaultLogs,failWrites:false,now:'2030-01-04T00:00:00Z',appName:'Kiro' as unknown,uriScheme:'kiro' as unknown,sourceRoot:source,mode:1 as unknown,prompts:undefined as unknown,choice:undefined as string|undefined,throwState:false,
  globalStorage:join(work,'global'),home:join(work,'synthetic-home'),workspace,source,store:new Map<string,unknown>(),written:[] as string[],infos:[] as {text:string;buttons:string[]}[],errors:[] as string[],opened:[] as string[],clipboard:[] as string[],statusTexts:[] as string[],panels:[] as any[],panelOptions:undefined as any,
  answers:[] as (string|undefined)[],autoSave:'off',timers:[] as {fn:()=>unknown;ms:number;cleared:boolean}[],configListeners:[] as ((e:{affectsConfiguration(k:string):boolean})=>void)[]};
};
const communitySession=async(env:ReturnType<typeof communityEnv>,work:string)=>{
 const api=auditApi(),commands=new Map<string,(...a:any[])=>unknown>(),subscriptions:any[]=[],disposable={dispose(){}};
 const bundle=await builtBundle(work);
 const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ProgressLocation:{Notification:15},ExtensionMode:{Production:1,Development:2,Test:3},ThemeColor:class{},Uri:{...api.Uri,parse:(u:string)=>({parsed:u})},RelativePattern:class{},extensions:{getExtension:()=>undefined},
  EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
  commands:{async executeCommand(){},registerCommand(id:string,fn:(...a:any[])=>unknown){commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
  env:{get appName(){return env.appName;},get uriScheme(){return env.uriScheme;},clipboard:{async writeText(t:string){env.clipboard.push(t);}},async openExternal(u:any){env.opened.push(u.parsed);return true;}},
  workspace:{...api.workspace,isTrusted:true,get workspaceFolders(){return [{name:'synthetic-workspace',uri:{scheme:'file',fsPath:env.workspace}}];},
   getConfiguration:(section:string)=>({get:(key:string)=>section==='kiroAgent'?(key==='agentIgnoreFiles'?['.kiroignore']:undefined):section==='files'?env.autoSave:
    ({sourceRoot:env.sourceRoot,storageRoot:'',sourceTimezone:'UTC',supportPrompts:env.prompts} as any)[key]??''}),
   createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}}),
   onDidChangeConfiguration(fn:any){env.configListeners.push(fn);return disposable;}},
  window:{...api.window,createStatusBarItem(){return {set text(t:string){env.statusTexts.push(t);},show(){},hide(){},dispose(){}};},
   createWebviewPanel(_t:string,_title:string,_c:number,o:any){env.panelOptions=o;const panel={webview:{html:''},reveal(){},onDidDispose:()=>disposable,onDidChangeViewState:()=>disposable,dispose(){}};env.panels.push(panel);return panel;},
   async showQuickPick(choices:any[]){const id=env.answers.shift();return choices.find(i=>i.id===id);},async showInputBox(){return undefined;},async showWarningMessage(){},async showErrorMessage(m:string){env.errors.push(m);},
   async showInformationMessage(text:string,...buttons:string[]){env.infos.push({text,buttons});return buttons.length?env.choice:undefined;},
   async withProgress(_o:any,task:(p:unknown,t:unknown)=>Promise<unknown>){return task({},{onCancellationRequested:()=>disposable});}}};
 const globalState={get(k:string){if(env.throwState)throw new Error('synthetic-state-failure /private/synthetic-path');return env.store.get(k);},
  async update(k:string,v:unknown){if(env.throwState||env.failWrites)throw new Error('synthetic-state-failure /private/synthetic-path');env.written.push(k);if(v===undefined)env.store.delete(k);else env.store.set(k,structuredClone(v));}};
 const fixedNow=Date.parse(env.now);
 class SyntheticDate extends Date {constructor(...args:any[]){super(args.length?args[0]:fixedNow);}static now(){return fixedNow;}}
 const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
 (globalThis as any).setTimeout=(fn:any,ms?:number,...rest:any[])=>{if(ms!==1000&&ms!==30000&&ms!==60000&&ms!==180000)return realSet(fn,ms,...rest);const t={fn,ms:ms!,cleared:false,unref(){return t;}};env.timers.push(t);return t;};
 (globalThis as any).clearTimeout=(t:any)=>{if(t&&env.timers.includes(t))t.cleared=true;else realClear(t);};
 const require=createRequire(new URL('../../package.json',import.meta.url));
 const module={exports:{} as any};
 const saved:Record<string,string|undefined>={};
 for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME']){saved[k]=process.env[k];process.env[k]=env.home;}
 runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports,SyntheticDate);
 const later=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 let done=false;
 try{await module.exports.activate({subscriptions,globalStorageUri:{fsPath:env.globalStorage},workspaceState:api.workspaceState,globalState,extensionMode:env.mode});await later();}finally{/* restored on disposal so delayed signal timers remain controllable */}
 return {commands,api,later,support:()=>env.timers.filter(t=>t.ms===180000),
  fire:async()=>{const t=env.timers.filter(x=>x.ms===180000);assert.equal(t.length,1);await t[0]!.fn();await later();},
  dispose(){if(done)return;done=true;module.exports.deactivate();for(const d of subscriptions)d.dispose();(globalThis as any).setTimeout=realSet;(globalThis as any).clearTimeout=realClear;for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}};
};
const hrefsOf=(html:string)=>[...html.matchAll(/href="([^"]*)"/g)].map(m=>m[1]!);

test('packaged footer and Share: four command links, three fixed web links, a fixed clipboard text',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-footer-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,true);
  const s=await communitySession(env,work);open.push(s);
  assert.ok(s.commands.has('cyclegauge.share'));assert.ok(s.commands.has('cyclegauge.support.reset'));
  await s.commands.get('cyclegauge.showUsage')!();
  assert.deepEqual(env.panelOptions,{enableScripts:false,enableCommandUris:['cyclegauge.costAdvisor','cyclegauge.auditWorkspace','cyclegauge.audit.show','cyclegauge.share'],localResourceRoots:[]});
  const html:string=env.panels.at(-1).webview.html;
  assert.deepEqual(hrefsOf(html).filter(h=>!h.startsWith('command:')),COMMUNITY_LINKS);
  for(const h of hrefsOf(html).filter(h=>h.startsWith('command:')))assert.ok(env.panelOptions.enableCommandUris.includes(h.slice('command:'.length)),h);
  assert.ok(hrefsOf(html).includes('command:cyclegauge.share'));assert.ok(!/<script/i.test(html));assert.ok(!/utm_|[?&]ref=/.test(html));
  assert.match(html,/Rate on Open VSX/);assert.match(html,/Star on GitHub/);assert.match(html,/Support<\/a>/);assert.match(html,/>Share<\/a>/);
  // Share copies a fixed text with no user data and confirms in one friendly line.
  env.infos.length=0;await s.commands.get('cyclegauge.share')!();await s.later();
  assert.deepEqual(env.clipboard,["Cyclegauge shows your Kiro credit usage, forecasts when you'll run out and finds files Kiro may read but probably doesn't need. Free and open source: https://open-vsx.org/extension/StefanSuess/cyclegauge"]);
  assert.deepEqual(env.infos,[{text:'Link copied — thanks for sharing!',buttons:[]}]);assert.ok(!env.clipboard[0]!.includes(work));assert.deepEqual(env.opened,[]);
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged support prompt: only when due, once per window, each button sets its state, the setting turns it off',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-support-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,true);
  const start=async()=>{env.timers.length=0;const s=await communitySession(env,work);open.push(s);return s;};
  const reset=()=>{env.infos.length=0;env.errors.length=0;env.opened.length=0;env.store.clear();env.written.length=0;env.timers.length=0;env.choice=undefined;env.prompts=undefined;env.throwState=false;};
  const seed=(first:string|undefined,extra:Record<string,unknown>={})=>{reset();if(first)env.store.set('cyclegauge.support.firstSeen.v1',first);for(const [k,v] of Object.entries(extra))env.store.set(k,v);};
  // First use is recorded on activation, and a forecast shown in the gauge counts as value seen; the 3-minute check is one disposed timer.
  seed(undefined);let s=await start();
  assert.equal(env.store.get('cyclegauge.support.firstSeen.v1'),'2030-01-04');assert.equal(env.store.get('cyclegauge.support.valueSeen.v1'),true);
  assert.equal(s.support().length,1);assert.equal(s.support()[0]!.ms,180000);assert.equal(s.support()[0]!.cleared,false);
  // Less than seven days after first use: nothing, and nothing is written.
  env.written.length=0;await s.fire();assert.deepEqual(env.infos,[]);assert.equal(env.written.length,0);
  s.dispose();assert.equal(s.support()[0]!.cleared,true);env.infos.length=0;await s.support()[0]!.fn();assert.deepEqual(env.infos,[]);
  // Seven days after first use it is due: one prompt with three buttons; the 60-day snooze is already stored while it is open, so a second check shows nothing.
  seed('2029-12-28');s=await start();env.written.length=0;await s.fire();
  assert.deepEqual(env.infos,[{text:SUPPORT_TEXT,buttons:SUPPORT_BUTTONS}]);assert.equal(env.store.get('cyclegauge.support.next.v1'),'2030-03-05');
  env.infos.length=0;await s.support()[0]!.fn();await s.later();assert.deepEqual(env.infos,[]);s.dispose();
  seed('2029-12-29');s=await start();await s.fire();assert.equal(env.infos.length,0);s.dispose(); // six days: not yet
  // Each button.
  for(const [choice,link,next] of [['Rate',COMMUNITY_LINKS[0],'2030-05-04'],['Support',COMMUNITY_LINKS[2],'2030-05-04'],['Later',undefined,'2030-03-05'],[undefined,undefined,'2030-03-05']] as const){
   seed('2029-12-01');env.choice=choice;s=await start();await s.fire();s.dispose();
   assert.deepEqual(env.opened,link?[link]:[],String(choice));assert.equal(env.store.get('cyclegauge.support.next.v1'),next,String(choice));assert.equal(env.store.has('cyclegauge.support.never.v1'),false,String(choice));
  }
  // A legacy never flag still suppresses prompts, and reset remains its compatibility exit.
  seed('2029-12-01',{'cyclegauge.support.never.v1':true});s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);
  env.now='2030-01-04T00:00:00Z';s=await start();await s.commands.get('cyclegauge.support.reset')!();await s.later();s.dispose();assert.equal(env.store.has('cyclegauge.support.never.v1'),false);
  // A snooze holds until its date.
  env.infos.length=0;env.now='2035-01-04T00:00:00Z';env.choice=undefined;s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);env.now='2030-01-04T00:00:00Z';
  seed('2029-12-01',{'cyclegauge.support.next.v1':'2030-01-05'});s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);
  env.now='2030-01-05T00:00:00Z';env.infos.length=0;s=await start();await s.fire();s.dispose();assert.equal(env.infos.length,1);env.now='2030-01-04T00:00:00Z';
  // The setting off: never prompted. Anything but an explicit false leaves it on.
  seed('2029-12-01');env.prompts=false;s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.equal(env.store.has('cyclegauge.support.next.v1'),false);
  seed('2029-12-01');env.prompts='false';s=await start();await s.fire();s.dispose();assert.equal(env.infos.length,1);
  // Invalid stored values count as absent: a broken first-use date is replaced, never due on the same day.
  seed('synthetic-not-a-date',{'cyclegauge.support.next.v1':'2030-99-99','cyclegauge.support.never.v1':'yes'});s=await start();assert.equal(env.store.get('cyclegauge.support.firstSeen.v1'),'2030-01-04');await s.fire();s.dispose();assert.deepEqual(env.infos,[]);
  // Reset clears the support state.
  seed('2029-12-01',{'cyclegauge.support.never.v1':true});s=await start();await s.commands.get('cyclegauge.support.reset')!();await s.later();
  assert.deepEqual([...env.store.keys()].filter(k=>k.startsWith('cyclegauge.support.')),[]);s.dispose();
  // A broken global state never breaks activation, the gauge or the prompt check.
  seed(undefined);env.throwState=true;s=await start();assert.ok(s.commands.has('cyclegauge.showUsage'));assert.ok(env.statusTexts.every(t=>!/unavailable|update needed/.test(t)),env.statusTexts.join('|'));
  await s.fire();assert.deepEqual(env.infos,[]);assert.deepEqual(env.errors,[]);assert.equal(env.written.length,0);env.throwState=false;s.dispose();
  // The setting off: neither the first-use date nor the value flag is recorded.
  seed(undefined);env.prompts=false;s=await start();await s.fire();s.dispose();assert.equal(env.store.size,0);assert.equal(env.written.length,0);assert.deepEqual(env.infos,[]);
  // A global state that reads fine but cannot be written: the prompt is not shown (its snooze could not be saved), so it cannot repeat in every window.
  seed('2029-12-01',{'cyclegauge.support.valueSeen.v1':true});env.failWrites=true;s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.deepEqual(env.errors,[]);env.failWrites=false;
  // Not Kiro (even with a chosen source): no timer, nothing recorded, no prompt and no notice.
  seed(undefined);env.appName='Visual Studio Code';env.uriScheme='vscode';s=await start();assert.equal(s.support().length,0);assert.equal(env.store.size,0);assert.deepEqual(env.infos,[]);s.dispose();
  // Kiro recognised by its URL scheme alone.
  seed('2029-12-01');env.appName='Synthetic Editor';env.uriScheme='kiro';s=await start();await s.fire();s.dispose();assert.equal(env.infos.length,1);
  // Only the documented keys were ever written.
  assert.ok(env.written.every(k=>COMMUNITY_KEYS.includes(k)),env.written.join());
  // Only the documented keys were ever written (checked in the audit test below).
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged support prompt: value is also seen through an audit finding, never from an empty gauge',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-value-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,false);env.store.set('cyclegauge.support.firstSeen.v1','2029-12-01');
  const s=await communitySession(env,work);open.push(s);
  assert.equal(env.store.has('cyclegauge.support.valueSeen.v1'),false);
  await s.fire();assert.deepEqual(env.infos,[]);
  await s.commands.get('cyclegauge.auditWorkspace')!();await s.later();
  assert.equal(env.store.get('cyclegauge.support.valueSeen.v1'),true);
  env.infos.length=0;await s.fire();assert.deepEqual(env.infos,[{text:SUPPORT_TEXT,buttons:SUPPORT_BUTTONS}]);
  assert.ok(env.written.every(k=>COMMUNITY_KEYS.includes(k)),env.written.join());
  const everything=JSON.stringify([...env.store]);assert.ok(!everything.includes(work)&&!everything.includes('.env')&&!everything.includes('synthetic-workspace'));
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged Kiro-not-detected notice: once, only outside Kiro with no chosen source, and the status says so',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-notkiro-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,false);
  const start=async()=>{const s=await communitySession(env,work);open.push(s);return s;};
  const reset=()=>{env.infos.length=0;env.opened.length=0;env.store.clear();env.written.length=0;env.timers.length=0;env.statusTexts.length=0;env.panels.length=0;env.choice=undefined;};
  const notices=()=>env.infos.filter(i=>i.text===NOT_KIRO);
  const outside=()=>{env.appName='Visual Studio Code';env.uriScheme='vscode';env.sourceRoot='';env.mode=1;};
  // Outside Kiro, no source chosen: one notice, remembered; Learn about Kiro opens the fixed address on click only.
  outside();reset();env.choice='Learn about Kiro';let s=await start();
  assert.deepEqual(notices(),[{text:NOT_KIRO,buttons:['Learn about Kiro','Got it']}]);assert.deepEqual(env.opened,['https://kiro.dev']);assert.equal(env.store.get('cyclegauge.notKiro.shown.v1'),true);
  assert.equal(s.support().length,0);assert.deepEqual([...env.store.keys()],['cyclegauge.notKiro.shown.v1']);
  assert.equal(env.statusTexts.at(-1),'$(info) Kiro not detected');
  await s.commands.get('cyclegauge.showUsage')!();const html:string=env.panels.at(-1).webview.html;
  assert.ok(html.includes(NOT_KIRO));assert.match(html,/Kiro not detected/);assert.ok(!html.includes(work));s.dispose();
  // Never again once shown; Got it opens nothing.
  env.infos.length=0;env.opened.length=0;s=await start();assert.deepEqual(notices(),[]);assert.deepEqual(env.opened,[]);s.dispose();
  reset();env.choice='Got it';s=await start();assert.equal(notices().length,1);assert.deepEqual(env.opened,[]);s.dispose();
  // A dismissed notice is still counted as shown.
  reset();env.choice=undefined;s=await start();assert.equal(notices().length,1);s.dispose();env.infos.length=0;s=await start();assert.deepEqual(notices(),[]);s.dispose();
  // Not shown inside Kiro (by name or by scheme), with a chosen source, or in the extension tests; the status is the normal one there.
  for(const [why,edit] of [['name',()=>{env.appName='Kiro';env.uriScheme='vscode';}],['scheme',()=>{env.appName='Visual Studio Code';env.uriScheme='kiro';}],['source',()=>{env.appName='Visual Studio Code';env.uriScheme='vscode';env.sourceRoot=env.source;}],['test mode',()=>{env.appName='Visual Studio Code';env.uriScheme='vscode';env.mode=3;}]] as const){
   outside();edit();reset();s=await start();assert.deepEqual(notices(),[],why);assert.equal(env.store.has('cyclegauge.notKiro.shown.v1'),false,why);
   if(why!=='test mode')assert.ok(env.statusTexts.every(t=>!/not detected/.test(t)),why);s.dispose();
  }
  // With a chosen source the status stays "Kiro: ..." in a non-Kiro editor too (demos and tests).
  outside();env.sourceRoot=env.source;reset();s=await start();assert.ok(env.statusTexts.at(-1)!.startsWith('$(warning) Kiro:'),env.statusTexts.at(-1));assert.ok(!env.statusTexts.includes('$(info) Kiro not detected'));s.dispose();
  // Kiro installed beside this editor: its default folder has logs, so nothing is "not detected" and no note is shown (the note needs a refresh that really found no logs).
  outside();reset();env.placeDefaultLogs();s=await start();
  assert.deepEqual(notices(),[]);assert.equal(env.store.has('cyclegauge.notKiro.shown.v1'),false);assert.ok(env.statusTexts.every(t=>!/not detected/.test(t)),env.statusTexts.join('|'));
  await s.commands.get('cyclegauge.showUsage')!();assert.ok(!env.panels.at(-1).webview.html.includes(NOT_KIRO));s.dispose();
  rmSync(join(work,'synthetic-home'),{recursive:true,force:true});mkdirSync(join(work,'synthetic-home'));
  // A global state that cannot be written: the note is not shown (it could not be remembered), so it cannot repeat in every window.
  outside();reset();env.failWrites=true;s=await start();assert.deepEqual(notices(),[]);assert.equal(env.statusTexts.at(-1),'$(info) Kiro not detected');s.dispose();env.failWrites=false;
  // A broken global state is silent.
  outside();reset();env.throwState=true;s=await start();assert.ok(s.commands.has('cyclegauge.showUsage'));assert.deepEqual(env.errors,[]);s.dispose();env.throwState=false;
  // Only the documented keys were written.
  assert.ok(env.written.every(k=>COMMUNITY_KEYS.includes(k)),env.written.join());
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});

// Saving an ignore file or changing Agent Ignore Files re-checks a checked workspace once, silently; nothing else does.
test('packaged re-check after ignore changes: checked workspaces only, ignore files only, debounced and silent',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-recheck-')));
 let s:any;
 try{
  const env=communityEnv(work,true);env.prompts=false;s=await communitySession(env,work);
  const pending=()=>env.timers.filter(t=>t.ms===1000&&!t.cleared);
  const fire=async()=>{const [t]=pending();assert.ok(t);t!.cleared=true;await t!.fn();};
  const target=join(env.workspace,'.kiroignore');
  const save=(path:string)=>{for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:path},getText:()=>''});};
  const setting=(key:string)=>{for(const fn of env.configListeners)fn({affectsConfiguration:(k:string)=>k===key});};
  const envFound=()=>flatTree(s.api.state.providers.get('cyclegauge.auditView').getChildren()).some((n:any)=>n.finding?.path==='.env');
  // Never checked: nothing starts.
  save(target);setting('kiroAgent.agentIgnoreFiles');assert.equal(pending().length,0);
  await s.commands.get('cyclegauge.auditWorkspace')!();await s.later();assert.ok(envFound());
  const infos=env.infos.length;
  // Other files, files outside the folder and other settings start nothing.
  save(join(env.workspace,'synthetic-other'));save(join(work,'.kiroignore'));setting('files.autoSave');assert.equal(pending().length,0);
  // A burst of saves is one silent re-check that picks up the saved rules.
  writeFileSync(target,'/.env\n');save(target);save(target);assert.equal(pending().length,1);
  await fire();for(let i=0;i<40&&envFound();i++)await s.later();
  assert.ok(!envFound());assert.equal(env.infos.length,infos);
  // Changing Agent Ignore Files re-checks too, and disposal cancels a pending re-check.
  setting('kiroAgent.agentIgnoreFiles');assert.equal(pending().length,1);
  const last=pending()[0]!;s.dispose();assert.equal(last.cleared,true);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

// A re-check before the user saves a prepared Exclude edit keeps that edit, so saving it still counts as the support signal.
test('packaged re-check keeps a prepared Exclude edit',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-recheck-keep-')));
 let s:any;
 try{
  const env=communityEnv(work,true);env.store.set('cyclegauge.support.firstSeen.v1','2029-12-01');
  s=await communitySession(env,work);await s.commands.get('cyclegauge.auditWorkspace')!();
  const node=flatTree(s.api.state.providers.get('cyclegauge.auditView').getChildren()).find((n:any)=>n.finding?.suggestion);
  await s.commands.get('cyclegauge.audit.accept')!(node);await s.later();
  const last=s.api.state.fires;
  for(const fn of env.configListeners)fn({affectsConfiguration:(k:string)=>k==='kiroAgent.agentIgnoreFiles'});
  const t=env.timers.find(x=>x.ms===1000&&!x.cleared)!;t.cleared=true;await t.fn();
  for(let i=0;i<40&&s.api.state.fires===last;i++)await s.later();
  assert.ok(s.api.state.fires>last);
  const doc=s.api.state.shown.at(-1),target=join(env.workspace,'.kiroignore');
  writeFileSync(target,doc.getText());
  for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:target},getText:()=>doc.getText()});
  await s.later();assert.equal(env.timers.filter(x=>x.ms===60000).length,1);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged earlier support signals: distinct detail days and saved accepted edits',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-earlier-')));
 let s:any;
 try {
  const env=communityEnv(work,false);env.store.set('cyclegauge.support.firstSeen.v1','2030-01-01');
  for(const day of ['02','02','03','04']) {
   env.now=`2030-01-${day}T00:00:00Z`;s=await communitySession(env,work);
   await s.commands.get('cyclegauge.showUsage')!();await s.later();
   if(day!=='04')assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,0);
   s.dispose();
  }
  assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,1);
  assert.deepEqual(env.store.get('cyclegauge.support.detailDays.v1'),['2030-01-02','2030-01-03','2030-01-04']);
  env.store.clear();env.store.set('cyclegauge.support.firstSeen.v1','2029-12-01');env.infos.length=0;env.timers.length=0;
  s=await communitySession(env,work);await s.commands.get('cyclegauge.auditWorkspace')!();
  const provider=s.api.state.providers.get('cyclegauge.auditView');
  const node=flatTree(provider.getChildren()).find((n:any)=>n.finding?.suggestion);
  await s.commands.get('cyclegauge.audit.accept')!(node);await s.later();
  assert.equal(env.timers.filter(t=>t.ms===60000).length,0);
  const doc=s.api.state.shown.at(-1);const target=join(env.workspace,'.kiroignore');
  const saved={uri:{scheme:'file',fsPath:target},getText:()=>doc.getText()};
  for(const fn of s.api.state.saveListeners)fn({...saved,uri:{scheme:'file',fsPath:join(env.workspace,'synthetic-other')}});
  assert.equal(env.timers.filter(t=>t.ms===60000).length,0);
  writeFileSync(target,doc.getText());
  for(const fn of s.api.state.saveListeners)fn(saved);
  await s.later();assert.equal(env.timers.filter(t=>t.ms===60000).length,1);
  env.infos.length=0;await s.fire();assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,0);
  await env.timers.find(t=>t.ms===60000)!.fn();await s.later();
  assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,1);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged medium signals ignore future days, cancelled Advisor and reset',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-medium-')));let s:any;
 try {
  const env=communityEnv(work,true);env.store.set('cyclegauge.support.firstSeen.v1','2030-01-03');
  env.store.set('cyclegauge.support.detailDays.v1',['2030-01-05','2030-01-06','2030-01-07']);
  s=await communitySession(env,work);await s.commands.get('cyclegauge.showUsage')!();await s.later();
  assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,0);
  await s.commands.get('cyclegauge.costAdvisor')!();await s.later();assert.equal(env.store.has('cyclegauge.support.advisorUsed.v1'),false);
  env.answers.push('reset');await s.commands.get('cyclegauge.costAdvisor')!();await s.later();assert.equal(env.store.has('cyclegauge.support.advisorUsed.v1'),false);
  env.answers.push('plan:pro_max','consumer_prepaid','none');await s.commands.get('cyclegauge.costAdvisor')!();await s.later();
  assert.equal(env.store.get('cyclegauge.support.advisorUsed.v1'),true);assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,1);
  await s.commands.get('cyclegauge.support.reset')!();assert.deepEqual([...env.store.keys()].filter(k=>k.startsWith('cyclegauge.support.')),[]);
  env.infos.length=0;env.answers.push('plan:pro_max','consumer_prepaid','none');await s.commands.get('cyclegauge.costAdvisor')!();await s.later();assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,0);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged saved exclusion with auto-save preserves existing ignore text',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-save-')));let s:any;
 try {
  const env=communityEnv(work,false);env.autoSave='afterDelay';env.store.set('cyclegauge.support.firstSeen.v1','2030-01-03');
  const path=join(env.workspace,'.kiroignore');writeFileSync(path,'# synthetic-existing\n');
  s=await communitySession(env,work);await s.commands.get('cyclegauge.auditWorkspace')!();
  const node=flatTree(s.api.state.providers.get('cyclegauge.auditView').getChildren()).find((n:any)=>n.finding?.suggestion);
  await s.commands.get('cyclegauge.audit.accept')!(node);const proposal=s.api.state.contentDocs.at(-1).getText();
  const text='# synthetic-existing\n'+proposal;writeFileSync(path,text);
  for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:path},getText:()=>text});await s.later();
  assert.equal(env.timers.filter(t=>t.ms===60000).length,1);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged test override requires the isolated synthetic demo profile and explicit opt-in',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-cyclegauge-demo-')));let s:any;
 const oldFlag=process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST,oldSource=process.env.CYCLEGAUGE_SYNTHETIC_SOURCE;
 try {
  const env=communityEnv(work,false);process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST='1';process.env.CYCLEGAUGE_SYNTHETIC_SOURCE=env.source;
  for(const isolated of [false,true]) {
   env.store.clear();env.infos.length=0;env.timers.length=0;if(isolated)env.globalStorage=join(work,'user-data','global');
   s=await communitySession(env,work);await s.commands.get('cyclegauge.support.reset')!();await s.commands.get('cyclegauge.auditWorkspace')!();
   const node=flatTree(s.api.state.providers.get('cyclegauge.auditView').getChildren()).find((n:any)=>n.finding?.suggestion);
   await s.commands.get('cyclegauge.audit.accept')!(node);const doc=s.api.state.shown.at(-1),path=join(env.workspace,'.kiroignore');writeFileSync(path,doc.getText());
   for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:path},getText:()=>doc.getText()});await s.later();
   env.infos.length=0;await env.timers.find(t=>t.ms===60000)!.fn();await s.later();assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,isolated?1:0);
   s.dispose();rmSync(path);
  }
 }finally{s?.dispose();if(oldFlag===undefined)delete process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST;else process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST=oldFlag;if(oldSource===undefined)delete process.env.CYCLEGAUGE_SYNTHETIC_SOURCE;else process.env.CYCLEGAUGE_SYNTHETIC_SOURCE=oldSource;rmSync(work,{recursive:true,force:true});}
});
