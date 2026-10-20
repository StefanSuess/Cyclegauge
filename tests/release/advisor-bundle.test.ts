import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,realpathSync,rmSync,existsSync,unlinkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as realFsPromises from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {runInThisContext} from 'node:vm';
import {buildVsix} from '../../scripts/release/build-vsix.ts';
import {readZip} from '../../scripts/release/zip.ts';
import {buildDomModel} from '../../src/extension/dashboard-shell.ts';
import {deflateSync} from 'node:zlib';
import {CARD_HEIGHT,CARD_WIDTH,encodePng} from '../../src/extension/recap-card.ts';

let built:Promise<string>|undefined;
// The shipped bundle is built once per run; only its text is kept.
const builtBundle=(work:string)=>built??=(async()=>{const vsix=join(work,'candidate.vsix');await buildVsix(vsix);return readZip(readFileSync(vsix)).find(e=>e.name==='extension/dist/extension.cjs')!.data.toString();})();
const visibleHrefs=(html:string)=>[...html.slice(0,html.indexOf('</main>')+7).matchAll(/href="([^"]*)"/g)].map(m=>m[1]!);
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
  let panel:any,options:any,disposed:()=>void=()=>{},visibility:(e:any)=>void=()=>{},receive:(m:any)=>void=()=>{},htmlSets=0;const sent:any[]=[];
  const disposable={dispose(){}};
  const api=auditApi();
  const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ThemeColor:class{},Uri:api.Uri,RelativePattern:class{},extensions:{getExtension:()=>undefined},
   EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
   commands:{...api.commands,registerCommand(id:string,fn:()=>unknown){commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
   workspace:{...api.workspace,getConfiguration:()=>({get:(key:string)=>({sourceRoot:source,storageRoot:storage,sourceTimezone:'UTC'} as any)[key]??''}),createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
   window:{...api.window,createStatusBarItem(){const item={text:'',command:'',visible:false,show(){this.visible=true;},hide(){this.visible=false;},dispose(){this.visible=false;}};items.push(item);return item;},
    createWebviewPanel(_type:string,_title:string,_column:number,o:any){options=o;panel={visible:true,webview:{_html:'',get html(){return this._html;},set html(v:string){this._html=v;htmlSets++;},postMessage(m:any){sent.push(m);return Promise.resolve(true);},onDidReceiveMessage(fn:(m:any)=>void){receive=fn;return disposable;}},reveal(){this.visible=true;visibility({webviewPanel:this});},onDidDispose(fn:()=>void){disposed=fn;return disposable;},onDidChangeViewState(fn:(e:any)=>void){visibility=fn;return disposable;},dispose(){disposed();}};return panel;},
    async showQuickPick(choices:any[]){const id=answers.shift();return choices.find(i=>i.id===id);},async showInputBox(){return undefined;},async showWarningMessage(){throw new Error('synthetic-unexpected-warning');}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  let fixedNow=Date.parse('2030-01-04T00:00:00Z');
  class SyntheticDate extends Date {constructor(...args:any[]){super(args.length?args[0]:fixedNow);}static now(){return fixedNow;}}
  const module={exports:{} as any};
  runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports,SyntheticDate);
  extension=module.exports;await extension.activate({subscriptions});
  assert.deepEqual([...commands.keys()].sort(),[...AUDIT_COMMANDS,...CONFIG_COMMANDS,'cyclegauge.copyDiagnostics','cyclegauge.costAdvisor','cyclegauge.gettingStarted','cyclegauge.reportProblem','cyclegauge.showUsage','cyclegauge.share','cyclegauge.support.reset'].sort());
  assert.ok(api.state.providers.has('cyclegauge.auditView'));
  const advisor=items.find(i=>i.command==='cyclegauge.costAdvisor');assert.equal(advisor.visible,false);
  await commands.get('cyclegauge.showUsage')!();assert.equal(advisor.visible,true);
  // Scripts stay off; the only command links are exactly five Cyclegauge commands, listed explicitly; the footer adds three fixed web links.
  assert.deepEqual(options,{enableScripts:true,retainContextWhenHidden:false,enableCommandUris:['cyclegauge.costAdvisor','cyclegauge.auditWorkspace','cyclegauge.audit.show','cyclegauge.share','cyclegauge.reportProblem'],localResourceRoots:[]});
  const allLinks=()=>visibleHrefs(panel.webview.html);
  const linkIds=()=>allLinks().filter((h:string)=>h.startsWith('command:')&&h!=='command:cyclegauge.share'&&h!=='command:cyclegauge.reportProblem');
  for(const h of allLinks().filter((h:string)=>h.startsWith('command:'))){assert.match(h,/^command:cyclegauge\.[A-Za-z.]+$/);assert.ok(options.enableCommandUris.includes(h.slice('command:'.length)),h);}
  assert.deepEqual(allLinks().filter((h:string)=>!h.startsWith('command:')),COMMUNITY_LINKS);assert.ok(allLinks().includes('command:cyclegauge.share'));assert.ok(allLinks().includes('command:cyclegauge.reportProblem'));
  assert.ok(linkIds().includes('command:cyclegauge.costAdvisor'));assert.ok(linkIds().includes('command:cyclegauge.auditWorkspace'));assert.ok(!linkIds().includes('command:cyclegauge.audit.show'));
  assert.match(panel.webview.html,/Workspace audit/);assert.match(panel.webview.html,/<script nonce=/);
  assert.match(panel.webview.html,/cost-advisor/);
  assert.doesNotThrow(()=>buildDomModel(panel.webview.html),[...new Set([...panel.webview.html.slice(panel.webview.html.indexOf('<main>'),panel.webview.html.lastIndexOf('</main>')+7).matchAll(/<([A-Za-z][\w-]*)\b/g)].map(m=>m[1]))].sort().join(','));
  const load=Number(/data-cg-load="(\d+)"/.exec(panel.webview.html)![1]);receive({type:'ready',load});const initial=sent.at(-1);receive({type:'ack',version:initial.version});
  const day5=`2030-01-05 00:00:00.000 [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-bundle-account'},nextDateReset:'2030-02-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:50,usageLimitWithPrecision:5000,nextDateReset:'2030-02-01T00:00:00Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n';
  writeFileSync(join(logs,'q-client.log'),lines.join('')+day5);fixedNow=Date.parse('2030-01-05T00:00:00Z');
  const sets=htmlSets;answers.push(undefined);await commands.get('cyclegauge.costAdvisor')!();
  assert.equal(htmlSets,sets,'a new observed snapshot updates in place');assert.ok(sent.at(-1).version>initial.version);assert.ok(JSON.stringify(sent.at(-1).model).includes('2030-01-05'));receive({type:'ack',version:sent.at(-1).version});
  fixedNow+=2100;
   answers.push('plan:pro_max','consumer_prepaid','none');await commands.get(linkIds().find((h:string)=>h==='command:cyclegauge.costAdvisor')!.slice('command:'.length))!();
   assert.match(panel.webview.html,/Confirmed by you/);assert.match(panel.webview.html,/Modelled estimate/);assert.match(panel.webview.html,/USD/);
   assert.ok(!/Supported estimate|Guaranteed savings/.test(panel.webview.html));
   fixedNow+=2100;answers.push(undefined);await commands.get('cyclegauge.costAdvisor')!();assert.match(panel.webview.html,/Confirmed by you/);
   fixedNow+=2100;answers.push('reset');await commands.get('cyclegauge.costAdvisor')!();assert.ok(!panel.webview.html.includes('Confirmed by you'));
  assert.ok(!panel.webview.html.includes('synthetic-bundle-account'));assert.ok(!panel.webview.html.includes(work));
  panel.visible=false;visibility({webviewPanel:panel});assert.equal(advisor.visible,false);
  await commands.get('cyclegauge.showUsage')!();assert.equal(advisor.visible,true);
  panel.dispose();assert.equal(advisor.visible,false);
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});

// Native-API stand-ins for the audit sidebar: an in-memory document store (nothing is read back from or written to disk by edits),
// a recording tree-view registry and a Map-backed workspaceState.
const auditApi=()=>{
 const state={discard:false,providers:new Map<string,any>(),executed:[] as any[][],edits:[] as any[],shown:[] as any[],saves:0,docs:new Map<string,any>(),contentDocs:[] as any[],store:new Map<string,unknown>(),fires:0,saveListeners:[] as any[],closeListeners:[] as any[]};
 class EventEmitter{listeners:any[]=[];event=(fn:any)=>{this.listeners.push(fn);return {dispose(){}};};fire(v:any){state.fires++;for(const l of this.listeners)l(v);}dispose(){}}
 class TreeItem{id?:string;description?:string;tooltip?:unknown;contextValue?:string;iconPath?:any;command?:any;resourceUri?:unknown;label:string;collapsibleState:number;constructor(label:string,collapsibleState:number){this.label=label;this.collapsibleState=collapsibleState;}}
 class ThemeIcon{id:string;constructor(id:string){this.id=id;}}
 class WorkspaceEdit{inserts:any[]=[];insert(uri:any,position:any,text:string,metadata?:any){this.inserts.push({uri,position,text,metadata});}}
 const uri=(fsPath:string,scheme='file'):any=>({fsPath,scheme,with(o:any){return uri(fsPath,o.scheme??scheme);}});
 const key=(u:any)=>`${u.scheme}:${u.fsPath}`;
 return {state,Uri:{file:(p:string)=>uri(p)},EventEmitter,TreeItem,ThemeIcon,WorkspaceEdit,TreeItemCollapsibleState:{None:0,Collapsed:1,Expanded:2},
  workspaceState:{get:(k:string)=>state.store.get(k),async update(k:string,v:unknown){if(v===undefined)state.store.delete(k);else state.store.set(k,structuredClone(v));}},
  workspace:{onDidSaveTextDocument(fn:any){state.saveListeners.push(fn);return {dispose(){state.saveListeners=state.saveListeners.filter(x=>x!==fn);}};},onDidCloseTextDocument(fn:any){state.closeListeners.push(fn);return {dispose(){state.closeListeners=state.closeListeners.filter(x=>x!==fn);}};},async openTextDocument(u:any){if(u.content!==undefined){const c={uri:{scheme:'untitled',fsPath:''},text:u.content,language:u.language,getText(){return this.text;},positionAt:(offset:number)=>({offset}),save(){state.saves++;}};state.contentDocs.push(c);return c;}let d=state.docs.get(key(u));if(!d){d={uri:u,text:u.scheme==='file'?readFileSync(u.fsPath,'utf8'):'',getText(){return this.text;},positionAt:(offset:number)=>({offset}),save(){state.saves++;}};state.docs.set(key(u),d);}return d;},
   async applyEdit(e:any){if(state.discard){state.edits.push(e);return false;}for(const i of e.inserts){const d=state.docs.get(key(i.uri));d.text=d.text.slice(0,i.position.offset)+i.text+d.text.slice(i.position.offset);d.isDirty=true;}state.edits.push(e);return true;}},
  window:{registerTreeDataProvider(id:string,p:any){state.providers.set(id,p);return {dispose(){state.providers.delete(id);}};},async showTextDocument(d:any){state.shown.push(d);}},
  commands:{async executeCommand(...a:any[]){state.executed.push(a);}}};
};
const COMMUNITY_LINKS=['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews','https://github.com/StefanSuess/Cyclegauge','https://ko-fi.com/stefansuess'];
const CONFIG_COMMANDS=['cyclegauge.config.preview','cyclegauge.config.loadWhenNeeded','cyclegauge.config.loadWhenNeededAll','cyclegauge.config.narrowPattern','cyclegauge.config.runManually','cyclegauge.config.runManuallyAll','cyclegauge.config.disable','cyclegauge.config.open','cyclegauge.reviewKiroConfig'];
const AUDIT_COMMANDS=['cyclegauge.audit.accept','cyclegauge.audit.acceptAll','cyclegauge.audit.clearDismissed','cyclegauge.audit.copy','cyclegauge.audit.dismiss','cyclegauge.audit.resetReminder','cyclegauge.audit.reveal','cyclegauge.audit.show','cyclegauge.auditWorkspace'];
const flatTree=(nodes:any[]):any[]=>nodes.flatMap(n=>[n,...flatTree(n.children??[])]);
// Assertions about the filename audit deliberately exclude the independent configuration section.
const auditRoots=(provider:any):any[]=>provider.getChildren().filter((n:any)=>n.kind!=='config');

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
  const commands=new Map<string,(...a:any[])=>unknown>(),errors:string[]=[],errorButtons:string[][]=[],warnings:string[]=[],warnButtons:string[][]=[],infos:{text:string;extra:number}[]=[],clipboard:string[]=[];
  let trusted=false,folderPath=workspace,gate:Promise<void>|undefined,failProgress=false,ignoreFiles:unknown=['.kiroignore'],autoSave:unknown='off',documentAutoSave:unknown=undefined,failProvider=false,infoChoice:string|undefined,warnChoice:string|undefined;
  const disposable={dispose(){}};
  const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ProgressLocation:{Notification:15},ThemeColor:class{},Uri:api.Uri,RelativePattern:class{},extensions:{getExtension:()=>undefined},
   EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
   // Every command except the audit ones fails to register, which makes startExtension throw and exercises the fallback path.
   commands:{...api.commands,registerCommand(id:string,fn:(...a:any[])=>unknown){if(!id.startsWith('cyclegauge.audit'))throw new Error('synthetic-register-failure');commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
   env:{clipboard:{async writeText(t:string){clipboard.push(t);}}},
   workspace:{...api.workspace,get isTrusted(){return trusted;},get workspaceFolders(){return [{name:'synthetic-workspace',uri:{scheme:'file',fsPath:folderPath}}];},
    getConfiguration:(section:string,scope?:any)=>({get:(key:string)=>section==='files'?(key==='autoSave'?(typeof scope?.getText==='function'&&documentAutoSave!==undefined?documentAutoSave:autoSave):undefined):section==='kiroAgent'?(key==='agentIgnoreFiles'?ignoreFiles:undefined):({sourceRoot:source,storageRoot:join(work,'synthetic-owned'),sourceTimezone:'UTC'} as any)[key]??''}),
    createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
   // No createWebviewPanel: the audit must not open a webview any more.
   window:{...api.window,registerTreeDataProvider(id:string,p:any){if(failProvider)throw new Error('synthetic-provider-failure');return api.window.registerTreeDataProvider(id,p);},createStatusBarItem(){return {text:'',show(){},hide(){},dispose(){}};},
    async showWarningMessage(m:string,...b:string[]){warnings.push(m);warnButtons.push(b);return warnChoice;},async showErrorMessage(m:string,...b:string[]){errors.push(m);errorButtons.push(b);},
    async showInformationMessage(m:string,...rest:unknown[]){infos.push({text:m,extra:rest.length});return rest.length?infoChoice:undefined;},
    async withProgress(_o:any,task:(p:unknown,t:unknown)=>Promise<unknown>){await gate;if(failProgress)throw new Error('synthetic-progress-failure /private/synthetic-path');return task({},{onCancellationRequested:()=>disposable});}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  const module={exports:{} as any};
  let commandNow=Date.now();
  class CommandDate extends Date {constructor(...args:any[]){super(args.length?args[0]:commandNow);}static now(){return commandNow;}}
  runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports,CommandDate);
  extension=module.exports;await extension.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')},workspaceState:api.workspaceState});
  assert.deepEqual([...commands.keys()].sort(),AUDIT_COMMANDS);
  const provider=st.providers.get('cyclegauge.auditView');assert.ok(provider);assert.ok(!provider.getChildren().some((n:any)=>n.kind==='config'),'failed configuration registration must leave the original audit provider available');
  const roots=()=>auditRoots(provider);const infoTexts=()=>infos.map(i=>i.text);
  const run=()=>{commandNow+=2100;return commands.get('cyclegauge.auditWorkspace')!();};
  const find=(label:string)=>flatTree(roots()).find(n=>n.label===label);
  const state=()=>st.store.get('cyclegauge.audit.dismissed.v1') as {salt:string;hashes:string[]}|undefined;
  // Untrusted: nothing is audited and the list stays empty (the view then shows its welcome text).
  await run();
  assert.deepEqual(warnings,['Cyclegauge audits only trusted workspaces.']);assert.deepEqual(warnButtons,[['Manage Workspace Trust']]);assert.deepEqual(roots(),[]);assert.ok(!st.executed.some(a=>a[0]==='workbench.trust.manage'));
  // The button opens the editor's Workspace Trust page and nothing else.
  warnChoice='Manage Workspace Trust';await run();warnChoice=undefined;assert.deepEqual(st.executed.filter(a=>a[0]==='workbench.trust.manage'),[['workbench.trust.manage']]);
  warnings.length=0;warnButtons.length=0;st.executed.length=0;
  // Trusted: the tree lists the findings; the notification has no buttons; the view is focused.
  trusted=true;await run();
  // The status line, then one Exclude group whose categories are collapsed sub-groups.
  assert.equal(roots().length,2);assert.match(roots()[0].label,/^Checked .+ · 2 suggestions$/);assert.equal(roots()[1].label,'Exclude from Kiro (2)');
  assert.deepEqual(roots()[1].children.filter((n:any)=>n.kind==='group').map((n:any)=>n.label),['Secrets and credentials (1)','Build output (1)']);
  assert.match(roots()[0].description,/^Kiro may read about (?:\d+ B|\d+ KiB|\d+\.\d MiB|\d+\.\d GiB)$/);
  assert.match(roots()[0].tooltip,/^Folder: synthetic-workspace\n/);
  assert.deepEqual(infos,[{text:'Found 2 files Kiro may read (about 27 B). Open the Workspace Audit view.',extra:0}]);
  assert.ok(st.executed.some(a=>a[0]==='cyclegauge.auditView.focus'));
  const excludeItem=provider.getTreeItem(roots()[1]);assert.equal(excludeItem.collapsibleState,1,'every group starts collapsed');assert.equal(excludeItem.contextValue,'group-exclude');assert.equal(excludeItem.description,'adds lines to .kiroignore');
  const secretGroup=roots()[1].children.find((n:any)=>n.id==='secret'),groupItem=provider.getTreeItem(secretGroup);
  assert.equal(groupItem.collapsibleState,1);assert.equal(groupItem.iconPath.id,'key');
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
  // The edit goes through the editor's change preview: an annotation that needs confirmation with a short why and the alternative; then a fixed notice with the counts.
  const meta=insert.metadata;assert.deepEqual(meta,{label:'Exclude from Kiro',description:"Adds 1 line to .kiroignore. Kiro may read this file into the agent's context; excluding it keeps requests smaller. Alternative: Hide this item. Nothing changes until you save.",needsConfirmation:true});
  assert.ok(infoTexts().includes('Changes prepared in 1 file — review and save.'));infos.length=0;
  assert.equal(find('.env').description,'prepared — save the file to apply');assert.equal(provider.getTreeItem(find('.env')).iconPath.id,'edit');assert.ok(!find('dist/').description.includes('prepared'));
  assert.match(roots()[0].description,/1 file with unsaved prepared changes/);
  // Accept all: one combined edit; lines already in the document and the header are not repeated.
  await commands.get('cyclegauge.audit.acceptAll')!();
  assert.equal(st.edits.length,2);assert.equal(st.edits[1].inserts[0].text,'/dist/\n');assert.equal(st.saves,0);assert.deepEqual(readFileSync(kiroignore),before);
  assert.equal(st.edits[1].inserts[0].metadata.needsConfirmation,true);assert.equal(st.edits[1].inserts[0].metadata.label,'Exclude from Kiro');
  assert.equal(find('dist/').description,'prepared — save the file to apply');assert.match(roots()[0].description,/1 file with unsaved prepared changes/);
  // Closing the document without saving clears the marks and the count (a save would too, and then re-check the audit).
  for(const fn of st.closeListeners)fn(st.docs.get(`file:${kiroignore}`));
  assert.ok(!find('dist/').description.includes('prepared')&&!find('.env').description.includes('prepared'));assert.ok(!(roots()[0].description??'').includes('unsaved prepared'));
  // Running again clears the accepted marks.
  await run();assert.ok(!find('.env').description.includes('rule prepared'));assert.ok(!find('dist/').description.includes('rule prepared'));
  // Discarding the change preview is not an error: nothing is marked as prepared, nothing is remembered for a save, and one fixed note is shown.
  st.docs.clear();st.discard=true;infos.length=0;const discardEdits=st.edits.length;
  await commands.get('cyclegauge.audit.accept')!(find('.env'));
  st.discard=false;assert.equal(st.edits.length,discardEdits+1);assert.deepEqual(infoTexts(),['Tick each change you want in the preview, then select Apply. Nothing changes on disk until you save the file.','No changes were made. To prepare a change, tick it in the preview, then select Apply.']);assert.ok(!find('.env').description.includes('rule prepared'));assert.equal(st.saves,0);
  infos.length=0;st.docs.clear();
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
   assert.equal(st.edits.length,editCount,mode);assert.equal(st.docs.size,1,'the real document is opened (not shown or edited) so its own auto save scope can be read');assert.equal(st.shown.includes([...st.docs.values()][0]),false,mode);assert.equal(st.contentDocs.length,1,mode);
   assert.equal(st.contentDocs[0].text,'# Suggested by Cyclegauge - review before saving\n/.env\n');assert.equal(st.contentDocs[0].language,'ignore');assert.equal(st.contentDocs[0].uri.scheme,'untitled');
   assert.equal(st.shown.length,shownCount+1);assert.equal(st.shown.at(-1),st.contentDocs[0]);assert.equal(st.saves,0);
   assert.deepEqual(infoTexts(),['Your editor saves files automatically, so the suggested lines are shown in a new tab. Copy them into .kiroignore and save.']);
   assert.equal(readFileSync(kiroignore,'utf8'),'/ignored.log\n');
  }
  // An unset value counts as off.
  autoSave=undefined;st.docs.clear();st.contentDocs.length=0;const editsUnset=st.edits.length;await commands.get('cyclegauge.audit.accept')!(find('.env'));assert.equal(st.edits.length,editsUnset);assert.equal(st.contentDocs.length,1);
  // A per-language override that is only visible with the opened document as scope (the global value stays off) also counts as auto save.
  autoSave='off';documentAutoSave='afterDelay';st.docs.clear();st.contentDocs.length=0;const editsLanguage=st.edits.length;await commands.get('cyclegauge.audit.accept')!(find('.env'));assert.equal(st.edits.length,editsLanguage);assert.equal(st.contentDocs.length,1);assert.equal(readFileSync(kiroignore,'utf8'),'/ignored.log\n');
  documentAutoSave=undefined;
  autoSave='off';infos.length=0;
  // Ignore: only salted hex hashes reach workspaceState, and the finding disappears (also from Copy and after a re-run).
  clipboard.length=0;
  await commands.get('cyclegauge.audit.dismiss')!(find('.env'));
  const stored=state()!;assert.deepEqual(Object.keys(stored).sort(),['hashes','salt']);assert.match(stored.salt,/^[0-9a-f]{64}$/);assert.equal(stored.hashes.length,1);assert.match(stored.hashes[0]!,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(stored).includes('.env')&&!JSON.stringify(stored).includes(work)&&!JSON.stringify([...st.store]).includes('synthetic-workspace'));
  assert.equal(roots().length,3);assert.match(roots()[0].label,/^Checked .+ · 1 suggestion$/);assert.deepEqual(roots().slice(1).map(n=>n.label),['Exclude from Kiro (1)','1 hidden by you']);
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
  // While the findings are listed, the Exclude group itself says the rules won't take effect and offers the setting as its first row; there is no separate top-level row.
  const note=flatTree(roots()).find(n=>n.action==='openIgnoreSetting');assert.ok(note);assert.ok(!roots().some(n=>n.action==='openIgnoreSetting'));
  assert.equal(roots()[1].description,"won't take effect yet — add .kiroignore to Agent Ignore Files");assert.equal(provider.getTreeItem(roots()[1]).iconPath.id,'warning');assert.equal(roots()[1].children[0],note);assert.equal(note.label,'Add .kiroignore to Agent Ignore Files…');
  assert.deepEqual(provider.getTreeItem(note).command,{command:'workbench.action.openSettings',title:'Open Agent Ignore Files setting',arguments:['kiroAgent.agentIgnoreFiles']});
  // After a successful Review changes… the notice says the file counts only when listed, with an Open setting button that opens the setting (never writes it).
  st.docs.clear();infos.length=0;st.executed.length=0;infoChoice='Open setting';
  await commands.get('cyclegauge.audit.accept')!(find('.env'));await new Promise(r=>setImmediate(r));infoChoice=undefined;
  assert.deepEqual(infos,[{text:'Tick each change you want in the preview, then select Apply. Nothing changes on disk until you save the file.',extra:0},{text:"Changes prepared in 1 file — review and save. Kiro uses .kiroignore only when it's listed in Agent Ignore Files.",extra:1}]);
  assert.deepEqual(st.executed.at(-1),['workbench.action.openSettings','kiroAgent.agentIgnoreFiles']);
  for(const fn of st.closeListeners)fn(st.docs.get(`file:${kiroignore}`));infos.length=0;
  ignoreFiles=[];await run();assert.equal(roots()[1].description,"won't take effect yet — add .kiroignore to Agent Ignore Files");assert.ok(!roots().some(n=>n.label==='Workspace ignore files are turned off'));ignoreFiles=undefined;await run();assert.ok(roots().some(n=>n.label==="Couldn't read the Agent Ignore Files setting"));ignoreFiles=['.kiroignore'];
  // A second invocation while one is in progress is declined; the lock is released afterwards.
  let release:()=>void=()=>{};gate=new Promise<void>(r=>{release=r;});infos.length=0;
  const first=run();await new Promise(r=>setImmediate(r));
  await run();assert.deepEqual(infoTexts(),[]); // The command guard drops a concurrent invocation before the audit handler.
  release();await first;gate=undefined;assert.equal(infos.length,1);
  // Folders overlapping the configured source or storage roots are refused, and nothing is audited or replaced.
  infos.length=0;warnings.length=0;const kept=JSON.stringify(roots());
  for(const path of [source,join(source,'logs'),join(work,'synthetic-owned','x'),join(work,'synthetic-missing')]){
   folderPath=path;await run();
  }
  assert.deepEqual(warnings,["This folder can't be audited: it overlaps Kiro data.","This folder can't be audited: it overlaps Kiro data.","This folder can't be audited: it overlaps Cyclegauge storage.","This folder can't be audited: its real location could not be resolved."]);
  assert.deepEqual(infos,[]);assert.equal(JSON.stringify(roots()),kept);
  // Any failure becomes one fixed message, and the lock is released.
  folderPath=workspace;failProgress=true;await run();failProgress=false;
  assert.deepEqual(errors,['The workspace audit failed. You can report it with the button below.']);assert.deepEqual(errorButtons,[['Report a problem']]);infos.length=0;await run();assert.deepEqual(infoTexts(),['Found 2 files Kiro may read (about 27 B). Open the Workspace Audit view.']);
  assert.equal(st.saves,0);
  warnings.length=0;trusted=false;for(const d of subscriptions)d.dispose();assert.equal(commands.size,0);assert.equal(st.providers.size,0);
  // If the list cannot be registered, the commands stay available and a finished audit offers one clipboard-only button.
  failProvider=true;trusted=true;infos.length=0;clipboard.length=0;const edits2=st.edits.length;
  const module2={exports:{} as any},subscriptions2:any[]=[];
  runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module2,module2.exports,CommandDate);
  await module2.exports.activate({subscriptions:subscriptions2,globalStorageUri:{fsPath:join(work,'global')},workspaceState:api.workspaceState});
  try{
   assert.deepEqual([...commands.keys()].sort(),AUDIT_COMMANDS);assert.equal(st.providers.size,0);st.executed.length=0;
   infoChoice='Copy suggestions';await run();
   assert.deepEqual(infos,[{text:'Found 2 files Kiro may read (about 27 B).',extra:1}]);assert.equal(clipboard.length,1);assert.ok(clipboard[0]!.includes('/.env\n')&&clipboard[0]!.endsWith('/dist/'));
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
  kiro:false,globalStore:new Map<string,unknown>(),choice:undefined as string|undefined,onInfo:undefined as (()=>void)|undefined,cancel:false,pick:undefined as string|undefined,pickCalls:0,configOpens:[] as string[],failConfigOpen:false,throwState:false,failStart:true,failConfigPreview:false,configReads:[] as string[],source,workspace,empty,single,store,written,gate:undefined as Promise<void>|undefined,readdirs:[] as string[],lstats:[] as string[],configCalls:[] as {section:string;args:number}[],
  panels:[] as any[],htmlSets:0,panelOptions:undefined as any,infos:[] as {text:string;buttons:string[]}[],warnings:[] as string[],errors:[] as string[],progress:0,executed:[] as any[][],statusTexts:[] as string[],clipboard:[] as string[]};
 return env;
};
const reminderSession=async(env:ReturnType<typeof reminderEnv>,work:string)=>{
 const api=auditApi(),commands=new Map<string,(...a:any[])=>unknown>(),subscriptions:any[]=[],disposable={dispose(){}};
 const bundle=await builtBundle(work);
 const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ProgressLocation:{Notification:15},ThemeColor:class{},Uri:api.Uri,RelativePattern:class{},extensions:{getExtension:()=>undefined},
  EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
  commands:{async executeCommand(...a:any[]){env.executed.push(a);},registerCommand(id:string,fn:(...a:any[])=>unknown){if(env.failConfigPreview&&id==='cyclegauge.config.preview')throw new Error('synthetic-config-preview-register-failure');if(env.failStart&&!id.startsWith('cyclegauge.audit')&&!CONFIG_COMMANDS.includes(id))throw new Error('synthetic-register-failure');commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
  env:{clipboard:{async writeText(t:string){env.clipboard.push(t);}},...(env.kiro?{appName:'Kiro',uriScheme:'kiro'}:{})},
  workspace:{...api.workspace,get isTrusted(){return env.trusted;},get workspaceFolders(){return env.folders;},
   getConfiguration:(section:string,...more:unknown[])=>(env.configCalls.push({section,args:more.length}),{get:(key:string)=>section==='kiroAgent'?(key==='agentIgnoreFiles'?['.kiroignore']:undefined):section==='files'?'off':
    ({sourceRoot:env.source,storageRoot:join(work,'synthetic-owned'),sourceTimezone:'UTC',auditReminderDays:env.days,auditAutomatically:env.automatic} as any)[key]??''}),
   createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
  window:{...api.window,createStatusBarItem(){const item={set text(t:string){env.statusTexts.push(t);},show(){},hide(){},dispose(){}};return item;},
   createWebviewPanel(_t:string,_title:string,_c:number,o:any){env.panelOptions=o;const panel={webview:{_h:'',get html(){return this._h;},set html(v:string){env.htmlSets++;this._h=v;},postMessage(){return Promise.resolve(true);},onDidReceiveMessage(){return disposable;}},reveal(){},onDidDispose:()=>disposable,onDidChangeViewState:()=>disposable,dispose(){}};env.panels.push(panel);return panel;},
   async showWarningMessage(m:string){env.warnings.push(m);},async showErrorMessage(m:string){env.errors.push(m);},async showQuickPick(choices:any[]){env.pickCalls++;return env.pick==='first'?choices[0]:undefined;},
   async showInformationMessage(text:string,...buttons:string[]){env.infos.push({text,buttons});env.onInfo?.();return buttons.length?env.choice:undefined;},
   async withProgress(_o:any,task:(p:unknown,t:unknown)=>Promise<unknown>){env.progress++;return task({},{onCancellationRequested:(fn:()=>void)=>{if(env.cancel)fn();return disposable;}});}}};
 const workspaceState={get(k:string){if(env.throwState)throw new Error('synthetic-state-failure /private/synthetic-path');return env.store.get(k);},
  async update(k:string,v:unknown){if(env.throwState)throw new Error('synthetic-state-failure /private/synthetic-path');env.written.push(k);if(v===undefined)env.store.delete(k);else env.store.set(k,structuredClone(v));}};
 let fixedNow=Date.parse(env.now);
 class SyntheticDate extends Date {constructor(...args:any[]){super(args.length?args[0]:fixedNow);}static now(){return fixedNow;}}
 const timers:{fn:()=>Promise<void>;ms:number;cleared:boolean}[]=[];
 const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
 (globalThis as any).setTimeout=(fn:any,ms?:number,...rest:any[])=>{if(ms!==30000)return realSet(fn,ms,...rest);const t={fn,ms,cleared:false,unref(){return t;}};timers.push(t);return t;};
 (globalThis as any).clearTimeout=(t:any)=>{if(t&&timers.includes(t))t.cleared=true;else realClear(t);};
 const require=createRequire(new URL('../../package.json',import.meta.url));
 const module={exports:{} as any};
 // The walk's file system calls are observed (and the workspace listing can be held) so a run in flight can be inspected.
 const configRead=(p:any)=>{const path=String(p);if(/(?:^|[\\/])AGENTS\.md$|[\\/]\.kiro(?:[\\/]|$)/.test(path))env.configReads.push(path);};
 const fsHook={...realFsPromises,async lstat(p:any,...a:any[]){configRead(p);env.lstats.push(String(p));return (realFsPromises.lstat as any)(p,...a);},async opendir(p:any,...a:any[]){configRead(p);return (realFsPromises.opendir as any)(p,...a);},async open(p:any,...a:any[]){configRead(p);if(/[\\/]\.kiro[\\/](steering|hooks)[\\/]/.test(String(p))){env.configOpens.push(String(p));if(env.failConfigOpen)throw new Error('synthetic-config-open-failure /private/synthetic-path');}return (realFsPromises.open as any)(p,...a);},async readdir(p:any,...a:any[]){env.readdirs.push(String(p));if(env.gate&&String(p)===env.workspace)await env.gate;return (realFsPromises.readdir as any)(p,...a);}};
 runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:id==='node:fs/promises'?fsHook:require(id),module,module.exports,SyntheticDate);
 const globalState=env.kiro?{get:(k:string)=>env.globalStore.get(k),async update(k:string,v:unknown){if(v===undefined)env.globalStore.delete(k);else env.globalStore.set(k,v);}}:undefined;
 try{await module.exports.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')},workspaceState,...(globalState?{globalState}:{})});}finally{/* restored on disposal so delayed signal timers remain controllable */}
 let done=false;
 return {commands,timers,api,advance:()=>{fixedNow+=2100;},provider:()=>api.state.providers.get('cyclegauge.auditView'),
  fire:async()=>{assert.equal(timers.length,1);assert.equal(timers[0]!.ms,30000);return timers[0]!.fn();},
  dispose(){if(done)return;done=true;module.exports.deactivate();for(const d of subscriptions)d.dispose();(globalThis as any).setTimeout=realSet;(globalThis as any).clearTimeout=realClear;}};
};
test('packaged configuration registration is isolated, idle until invoked, and keeps its own native section',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-config-registration-bundle-')));
 const sessions:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);
  // The existing collector-failure mode permits these two independent commands, so its audit provider includes both sections.
  let session=await reminderSession(env,work);sessions.push(session);
  assert.ok(session.provider());
  for(const id of CONFIG_COMMANDS)assert.equal(typeof session.commands.get(id),'function');
  const config=()=>session.provider().getChildren().filter((n:any)=>n.kind==='config');
  // Nothing is checked yet: the tree is empty (the view shows its welcome text with the Check button) and has no Review entry.
  assert.deepEqual(session.provider().getChildren(),[]);
  assert.deepEqual(env.configReads.slice(),[],'registering and building the initial tree must not access configuration');
  // Explicit review reads only after invocation, updates its own section and leaves the filename audit/state unchanged.
  writeFileSync(join(env.workspace,'AGENTS.md'),Buffer.alloc(40000,'x'));
  const before=JSON.stringify({store:[...env.store],written:env.written,clipboard:env.clipboard,progress:env.progress});
  await session.commands.get('cyclegauge.reviewKiroConfig')!();
  assert.ok(env.configReads.some(p=>p.endsWith('AGENTS.md')));
  assert.equal(JSON.stringify({store:[...env.store],written:env.written,clipboard:env.clipboard,progress:env.progress}),before);
  assert.deepEqual(auditRoots(session.provider()).map((n:any)=>n.id),['status']);assert.match(auditRoots(session.provider())[0].label,/^Checked .+ · 2 suggestions$/);
  assert.deepEqual(config().map((n:any)=>n.label),['Worth a look (2)']);assert.ok(flatTree(config()).some((n:any)=>n.finding?.id==='S2'));
  assert.ok(!JSON.stringify(session.provider().getChildren()).includes('Review Kiro Steering and Hooks'));
  assert.equal(session.api.state.edits.length,0);session.dispose();
  // A failure after the first config command registers must roll it back and leave the original audit provider usable.
  env.failConfigPreview=true;env.configReads.length=0;
  session=await reminderSession(env,work);sessions.push(session);
  assert.ok(session.provider());assert.equal(session.commands.has('cyclegauge.reviewKiroConfig'),false);assert.equal(session.commands.has('cyclegauge.config.preview'),false);
  assert.ok(!session.provider().getChildren().some((n:any)=>n.kind==='config'));assert.deepEqual(env.configReads.slice(),[]);
  await session.commands.get('cyclegauge.auditWorkspace')!();assert.ok(auditRoots(session.provider()).some(n=>n.kind==='header'));
 }finally{for(const s of sessions)s.dispose();rmSync(work,{recursive:true,force:true});}
});
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
  const quiet=async(why:string)=>{s=await start();assert.ok(s.provider(),'the filename audit provider must survive registration failures');await s.fire();s.dispose();assert.deepEqual(env.infos,[],why);assert.deepEqual(env.warnings,[],why);assert.equal(env.progress,0,why);assert.equal(env.written.length,0,why);assert.equal(env.store.size,0,why);assert.deepEqual(s.provider()?auditRoots(s.provider()):[],[],why);};
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
  assert.equal(env.store.has('cyclegauge.audit.last.v1'),false);assert.equal(env.progress,0);assert.deepEqual(auditRoots(s.provider()),[]);s.dispose();
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
  assert.match(auditRoots(s.provider())[0].label,/^Checked .+ · 2 suggestions$/);
  assert.deepEqual(infoTexts(env),["Cyclegauge can check this workspace for files that may end up in Kiro's context.",'Found 2 files Kiro may read (about 27 B). Open the Workspace Audit view.']);s.dispose();
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
test('packaged audit reminder: the first-time prompt waits when this window just opened the walkthrough',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-reminder-walkthrough-bundle-')));
 const open:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);env.failStart=false;env.kiro=true;
  const opened=()=>env.executed.filter(a=>a[0]==='workbench.action.openWalkthrough').length;
  const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
  // New user in Kiro: the walkthrough opens, and its own audit step replaces the first-time prompt for this window (nothing is stored for it).
  let s=await reminderSession(env,work);open.push(s);await settle();
  assert.equal(opened(),1);await s.fire();
  assert.deepEqual(env.infos,[]);assert.equal(env.store.has('cyclegauge.audit.snoozeUntil.v1'),false);s.dispose();
  // The next window does not open the walkthrough again and asks as usual.
  env.executed.length=0;s=await reminderSession(env,work);open.push(s);await settle();
  assert.equal(opened(),0);env.choice='Later';await s.fire();
  assert.equal(firstInfo(env).text,"Cyclegauge can check this workspace for files that may end up in Kiro's context.");assert.deepEqual(firstInfo(env).buttons,['Run audit','Later',"Don't ask again"]);s.dispose();
  // A due reminder for a workspace audited before is not the first-time prompt and is never skipped.
  env.infos.length=0;env.store.clear();env.store.set('cyclegauge.audit.last.v1','2030-03-01');env.globalStore.clear();env.executed.length=0;
  s=await reminderSession(env,work);open.push(s);await settle();assert.equal(opened(),1);
  await s.fire();assert.equal(firstInfo(env).text,'This workspace was last audited 30 days ago.');s.dispose();
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
  assert.equal(env.progress,0);assert.deepEqual(auditRoots(s.provider()),[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');s.dispose();
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
  assert.deepEqual(env.infos,[{text:'Found 2 files Kiro may read (about 27 B). Open the Workspace Audit view.',buttons:['Show']}]);
  assert.match(auditRoots(s.provider())[0].label,/^Checked .+ · 2 suggestions$/);assert.ok(s.api.state.fires>0);assert.deepEqual(env.executed,[]);
  assert.ok(!JSON.stringify(auditRoots(s.provider())).includes('SYNTHETIC_CONTENT_SENTINEL'));s.dispose();
  reset();last('2030-03-01');env.choice='Show';s=await start();await s.fire();assert.deepEqual(env.executed,[['cyclegauge.auditView.focus']]);s.dispose();
  // No findings: silent. Not due: nothing runs. Never audited or snoozed: the first prompt or nothing, never a background run.
  reset();last('2030-03-01');env.folders=[{name:'synthetic-empty',uri:{scheme:'file',fsPath:env.empty}}];s=await start();await s.fire();
  assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);assert.match(auditRoots(s.provider())[0].label,/^Checked .+ · nothing to suggest$/);s.dispose();env.folders=[{name:'synthetic-workspace',uri:{scheme:'file',fsPath:env.workspace}}];
  // Automatic modes re-run an audit that is at least one UTC day old (well inside the reminder period), but not one from today.
  reset();last('2030-03-02');s=await start();await s.fire();s.dispose();assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);
  reset();last(TODAY);s=await start();await s.fire();s.dispose();assert.deepEqual(env.infos,[]);assert.equal(env.progress,0);
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
  assert.ok(!env.lstats.includes(nested));assert.deepEqual(env.infos,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),'2030-03-01');assert.equal(env.errors.length,0);assert.deepEqual(s.provider()?auditRoots(s.provider()):[],[]);
  // The reminder settings are application-scoped: they are read without a folder, so a workspace cannot set them.
  assert.ok(env.configCalls.some(c=>c.section==='cyclegauge'));assert.ok(env.configCalls.filter(c=>c.section==='cyclegauge').every(c=>c.args===0));
  // One counting rule: findings the user has not ignored plus omitted ones; singular forms.
  const hash=(salt:string,category:string,path:string)=>createHash('sha256').update(`${salt}\0${category}\0${path}`).digest('hex');
  const salt='b'.repeat(64);
  reset();last('2030-03-01');env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash(salt,'secret','.env')]});s=await start();await s.fire();
  assert.deepEqual(env.infos,[{text:'Found 1 file Kiro may read (about 1 B). Open the Workspace Audit view.',buttons:['Show']}]);s.dispose();
  reset();env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash(salt,'secret','.env')]});s=await start();await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.deepEqual(env.infos,[{text:'Found 1 file Kiro may read (about 1 B). Open the Workspace Audit view.',buttons:[]}]);s.dispose();
  env.folders=[{name:'synthetic-single',uri:{scheme:'file',fsPath:env.single}}];
  reset();last('2030-03-01');s=await start();await s.fire();assert.deepEqual(env.infos,[{text:'Found 1 file Kiro may read (about 26 B). Open the Workspace Audit view.',buttons:['Show']}]);s.dispose();
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
  const hrefs=()=>visibleHrefs(html()).filter(h=>h.startsWith('command:')&&h!=='command:cyclegauge.share'&&h!=='command:cyclegauge.reportProblem');
  const ALLOWED=['cyclegauge.costAdvisor','cyclegauge.auditWorkspace','cyclegauge.audit.show','cyclegauge.share','cyclegauge.reportProblem'];
  // Nothing checked yet: the card invites a check; "Show" is not offered; the panel's command allowlist is exactly five commands.
  let s=await start();await s.commands.get('cyclegauge.showUsage')!();
  assert.deepEqual(env.panelOptions,{enableScripts:true,retainContextWhenHidden:false,enableCommandUris:ALLOWED,localResourceRoots:[]});
  assert.match(html(),/Workspace audit/);assert.match(html(),/Run the workspace audit to find files Kiro can read but probably doesn&#39;t need\./);
  assert.deepEqual(hrefs(),['command:cyclegauge.costAdvisor','command:cyclegauge.auditWorkspace']);
  // "Show" with no result runs the audit (and then focuses the list); the open panel now shows the count and the new button.
  env.executed.length=0;await s.commands.get('cyclegauge.audit.show')!();
  assert.equal(env.progress,1);assert.ok(env.executed.some(a=>a[0]==='cyclegauge.auditView.focus'));
  assert.match(html(),/2 items Kiro may read \(about (?:\d+ B|\d+ KiB|\d+\.\d MiB|\d+\.\d GiB)\) · checked just now/);
  assert.deepEqual(hrefs(),['command:cyclegauge.costAdvisor','command:cyclegauge.auditWorkspace','command:cyclegauge.audit.show']);
  for(const h of hrefs())assert.ok(ALLOWED.includes(h.slice('command:'.length)),h);
  assert.ok(!html().includes('synthetic-workspace')&&!html().includes(work));
  // With a result, "Show" only focuses the list. The card follows what the user hides.
  env.progress=0;env.executed.length=0;s.advance();await s.commands.get('cyclegauge.audit.show')!();
  assert.equal(env.progress,0);assert.deepEqual(env.executed,[['cyclegauge.auditView.focus']]);
  const salt='a'.repeat(64),hash=(c:string,p:string)=>createHash('sha256').update(`${salt}\0${c}\0${p}`).digest('hex');
  env.store.set('cyclegauge.audit.dismissed.v1',{salt,hashes:[hash('secret','.env')]});await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.match(html(),/1 item Kiro may read \(about (?:\d+ B|\d+ KiB|\d+\.\d MiB|\d+\.\d GiB)\) · checked just now/);
  // The panel is re-rendered only when the summary changed: the same audit again (same counts and time) sets no HTML; hiding an item does.
  const sets=env.htmlSets;s.advance();await s.commands.get('cyclegauge.auditWorkspace')!();assert.equal(env.htmlSets,sets);
  env.store.delete('cyclegauge.audit.dismissed.v1');await s.commands.get('cyclegauge.audit.clearDismissed')!();assert.equal(env.htmlSets,sets+1);assert.match(html(),/2 items Kiro may read \(about (?:\d+ B|\d+ KiB|\d+\.\d MiB|\d+\.\d GiB)\) · checked just now/);
  // Later renders (the minute timer's refresh) keep the card; an unavailable run says so and drops the Show button.
  env.trusted=false;s.advance();await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.match(html(),/This folder can&#39;t be checked\. Run the audit to see why\./);assert.ok(!hrefs().includes('command:cyclegauge.audit.show'));env.trusted=true;s.dispose();
  // A broken workspaceState never takes the card or the gauge down.
  env.throwState=true;s=await start();await s.commands.get('cyclegauge.showUsage')!();assert.match(html(),/id="status-heading"/);assert.match(html(),/Workspace audit/);env.throwState=false;s.dispose();
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged audit reminder: a failing workspaceState never breaks activation, the gauge or the audit command',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-reminder-state-bundle-')));
 const open:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);env.throwState=true;env.failStart=false;env.now='2030-03-31T12:00:00Z';
  const s=await reminderSession(env,work);open.push(s);
  assert.ok(s.commands.has('cyclegauge.showUsage'));assert.ok(s.commands.has('cyclegauge.auditWorkspace'));
  assert.ok(env.statusTexts.length>0&&env.statusTexts.every(t=>!/unavailable|update needed|Needs a newer Kiro|Update Cyclegauge/i.test(t)),env.statusTexts.join('|'));
  env.choice='Later';await s.fire();
  assert.equal(env.infos.length,1);assert.deepEqual(env.errors,[]);assert.equal(env.written.length,0);
  await s.commands.get('cyclegauge.auditWorkspace')!();
  assert.equal(env.progress,1);assert.deepEqual(env.errors,[]);assert.match(auditRoots(s.provider())[0].label,/^Checked .+ · 2 suggestions$/);
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
    createWebviewPanel(_t:string,_title:string,_c:number,o:any){const p={options:o,webview:{html:'',postMessage(){return Promise.resolve(true);},onDidReceiveMessage(){return disposable;}},reveal(){},onDidDispose(){return disposable;},onDidChangeViewState(){return disposable;},dispose(){}};panels.push(p);return p;}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  const module={exports:{} as any};
  (process as {getBuiltinModule?:unknown}).getBuiltinModule=()=>undefined;
  runInThisContext(`(function(require,module,exports){${bundle}\n})`)((id:string)=>{if(id==='vscode')return vscode;if(/^(node:)?sqlite$/.test(id))throw new Error('synthetic-no-sqlite');return require(id);},module,module.exports);
  extension=module.exports;await extension.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')}});
  assert.ok(commands.has('cyclegauge.showUsage'));assert.ok(commands.has('cyclegauge.auditWorkspace'));
  assert.equal(items[0].text,'$(warning) Kiro: Needs a newer Kiro');
  await commands.get('cyclegauge.showUsage')!();
  assert.match(panels[0].webview.html,/too old for Cyclegauge&#39;s credit view/);
  assert.equal(existsSync(storage),false);
 }finally{process.getBuiltinModule=original;extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});

// Copy Diagnostics opens an unsaved plaintext document and copies the same text; it is registered before the collector starts.
const diagnosticsHarness=(work:string,source:string,storage:string,allow:(id:string)=>boolean,editor:{appName?:unknown;version?:unknown})=>{
 const commands=new Map<string,()=>unknown>(),opened:any[]=[],shown:any[]=[],clipboard:string[]=[],infos:string[]=[],errors:string[]=[],externals:string[]=[],errorButtons:string[][]=[],failExternal={on:false},items:any[]=[];const disposable={dispose(){}};
 const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ThemeColor:class{},Uri:{file:(fsPath:string)=>({fsPath}),parse:(value:string)=>({parsed:value})},RelativePattern:class{},extensions:{getExtension:()=>undefined},version:editor.version,
  commands:{registerCommand(id:string,fn:()=>unknown){if(!allow(id))throw new Error('synthetic-register-failure');commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
  env:{appName:editor.appName,clipboard:{async writeText(t:string){clipboard.push(t);}},async openExternal(u:any){if(failExternal.on)throw new Error('synthetic-open-failure /private/synthetic-path');externals.push(u.parsed);return true;}},
  workspace:{getConfiguration:()=>({get:(key:string)=>({sourceRoot:source,storageRoot:storage,sourceTimezone:'Europe/Berlin'} as any)[key]??''}),createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}}),
   async openTextDocument(o:any){opened.push(o);return {untitled:true,...o};}},
  window:{createStatusBarItem(){const item:any={text:'',show(){},hide(){},dispose(){}};items.push(item);return item;},createWebviewPanel(_t:string,_title:string,_c:number,o:any){return {options:o,webview:{html:'',postMessage(){return Promise.resolve(true);},onDidReceiveMessage(){return disposable;}},reveal(){},onDidDispose(){return disposable;},onDidChangeViewState(){return disposable;},dispose(){}};},
   async showTextDocument(d:any){shown.push(d);},async showInformationMessage(m:string){infos.push(m);},async showErrorMessage(m:string,...b:string[]){errors.push(m);errorButtons.push(b);}}};
 const require=createRequire(new URL('../../package.json',import.meta.url));
 const module={exports:{} as any};
 return {commands,items,opened,shown,clipboard,infos,errors,externals,errorButtons,failExternal,module,load:(bundle:string)=>runInThisContext(`(function(require,module,exports){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports)};
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
  // The failed-start status item says so in plain words and a click reports the problem (the credit view is not available then).
  assert.equal(h.items[0].text,'$(warning) Kiro: Unavailable');assert.equal(h.items[0].tooltip,'Cyclegauge could not start. Click to report a problem.');assert.equal(h.items[0].command,'cyclegauge.reportProblem');
  assert.ok(!text.includes('synthetic')&&!text.includes(work));
  // A failure while opening the document becomes one fixed message.
  const failing=diagnosticsHarness(work,source,join(work,'owned'),id=>id==='cyclegauge.copyDiagnostics',{appName:'Synthetic Editor',version:'1.99.0'});
  (failing as any).opened.push=()=>{throw new Error('synthetic-open-failure /private/synthetic-path');};
  failing.load(await builtBundle(work));await failing.module.exports.activate({subscriptions});await failing.commands.get('cyclegauge.copyDiagnostics')!();
  assert.deepEqual(failing.errors,['Diagnostics could not be copied.']);assert.deepEqual(failing.clipboard,[]);
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged Report a Problem copies the Copy Diagnostics text and opens exactly the fixed form address',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-report-bundle-')));
 const subscriptions:any[]=[];let extension:any;
 try{
  const source=join(work,'source');mkdirSync(join(source,'logs'),{recursive:true});
  const bundle=await builtBundle(work);
  // Each scenario gets a fresh activation: the command shares the 2-second cooldown of the other footer commands.
  const fresh=async()=>{const x=diagnosticsHarness(work,source,join(work,'owned'),()=>true,{appName:'Synthetic Editor',version:'1.99.0'});x.load(bundle);await x.module.exports.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')}});extension=x.module.exports;return x;};
  const h=await fresh();
  assert.ok(h.commands.has('cyclegauge.reportProblem'));
  await h.commands.get('cyclegauge.copyDiagnostics')!();const copied=h.clipboard[0]!;
  await h.commands.get('cyclegauge.reportProblem')!();
  assert.deepEqual(h.externals,['https://github.com/StefanSuess/Cyclegauge/issues/new?template=bug_report.yml']);
  assert.equal(h.clipboard.length,2);assert.equal(h.clipboard[1],copied);assert.equal(h.opened.length,2);assert.equal(h.opened[1].content,copied);assert.equal(h.opened[1].language,'plaintext');assert.equal(h.shown.length,2);assert.equal(h.shown[1].untitled,true);
  assert.deepEqual(h.errors,[]);
  // No diagnostics value, path or identifier is in the address.
  const url=new URL(h.externals[0]!);assert.deepEqual([...url.searchParams.entries()],[['template','bug_report.yml']]);assert.equal(url.hash,'');
  for(const line of copied.split('\n').slice(1).filter(Boolean)){const value=line.slice(line.indexOf(': ')+2);if(value.length>3)assert.ok(!h.externals[0]!.includes(value),value);}
  // Cooldown: concurrent and immediate repeat calls in one activation run the command once (one browser tab, one copy, one document).
  const burst=await fresh();
  await Promise.all([burst.commands.get('cyclegauge.reportProblem')!(),burst.commands.get('cyclegauge.reportProblem')!()]);await burst.commands.get('cyclegauge.reportProblem')!();
  assert.equal(burst.externals.length,1);assert.equal(burst.clipboard.length,1);assert.equal(burst.opened.length,1);
  // A failing Copy Diagnostics registration cannot prevent Report a Problem.
  const partial=diagnosticsHarness(work,source,join(work,'owned'),id=>id==='cyclegauge.reportProblem',{appName:'Synthetic Editor',version:'1.99.0'});
  partial.load(bundle);await partial.module.exports.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')}});extension=partial.module.exports;
  assert.deepEqual([...partial.commands.keys()],['cyclegauge.reportProblem']);
  // Any failure becomes one fixed text without a button, never exception text.
  const noBrowser=await fresh();noBrowser.failExternal.on=true;await noBrowser.commands.get('cyclegauge.reportProblem')!();
  assert.deepEqual(noBrowser.errors,['The problem report could not be opened.']);assert.deepEqual(noBrowser.errorButtons,[[]]);
  const noDocument=await fresh();(noDocument as any).opened.push=()=>{throw new Error('synthetic-open-failure /private/synthetic-path');};await noDocument.commands.get('cyclegauge.reportProblem')!();
  assert.deepEqual(noDocument.errors,['The problem report could not be opened.']);assert.deepEqual(noDocument.externals,[]);assert.deepEqual(noDocument.clipboard,[]);
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});

// Community prompts: footer, share command, the support prompt and the "not Kiro" notice. The bundle sees an injected clock (Date), the 3-minute
// delay is intercepted so the check runs on demand, and HOME and friends point at an empty synthetic folder so no real Kiro folder is ever read.
const SUPPORT_KEYS=['cyclegauge.support.firstSeen.v1','cyclegauge.support.next.v1','cyclegauge.support.never.v1','cyclegauge.support.valueSeen.v1','cyclegauge.support.detailDays.v1','cyclegauge.support.advisorUsed.v1'];
const WALKTHROUGH_KEY='cyclegauge.walkthrough.shown.v1';
const COMMUNITY_KEYS=[...SUPPORT_KEYS,'cyclegauge.notKiro.shown.v1',WALKTHROUGH_KEY];
const SUPPORT_TEXT='Finding Cyclegauge useful? Rate it or support development. You can turn these off in Settings › Cyclegauge › Support Prompts.';
const NOT_KIRO="Cyclegauge is built for Kiro IDE, so there is no credit view in this editor. What helps here is the workspace audit: run Cyclegauge: Run Workspace Audit to find files Kiro may read but doesn't need.";
const SUPPORT_BUTTONS=['Rate','Support','Later'];
const communityEnv=(work:string,withLogs:boolean)=>{
 const source=join(work,'source'),workspace=join(work,'synthetic-workspace'),logs=join(source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 mkdirSync(logs,{recursive:true});mkdirSync(workspace,{recursive:true});mkdirSync(join(work,'synthetic-home'),{recursive:true});writeFileSync(join(workspace,'.env'),'SYNTHETIC_CONTENT_SENTINEL');
 const logText=()=>[1,2,3,4].map(day=>`2030-01-0${day} 00:00:00.000 [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-bundle-account'},nextDateReset:'2030-02-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:day*10,usageLimitWithPrecision:5000,nextDateReset:'2030-02-01T00:00:00Z',bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n').join('');
 if(withLogs)writeFileSync(join(logs,'q-client.log'),logText());
 // Kiro's standard data folder as the bundle resolves it under the synthetic HOME (set per session).
 const placeDefaultLogs=()=>{const dir=join(process.platform==='darwin'?join(work,'synthetic-home','Library','Application Support','Kiro'):join(work,'synthetic-home','Kiro'),'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'q-client.log'),logText());};
 return {placeDefaultLogs,failWrites:false,now:'2030-01-04T00:00:00Z',appName:'Kiro' as unknown,uriScheme:'kiro' as unknown,sourceRoot:source,mode:1 as unknown,prompts:undefined as unknown,choice:undefined as string|undefined,throwState:false,
  globalStorage:join(work,'editor','User','globalStorage','synthetic.ext'),home:join(work,'synthetic-home'),workspace,source,store:new Map<string,unknown>(),written:[] as string[],infos:[] as {text:string;buttons:string[]}[],errors:[] as string[],opened:[] as string[],clipboard:[] as string[],statusTexts:[] as string[],panels:[] as any[],panelOptions:undefined as any,
  answers:[] as (string|undefined)[],autoSave:'off',timers:[] as {fn:()=>unknown;ms:number;cleared:boolean}[],configListeners:[] as ((e:{affectsConfiguration(k:string):boolean})=>void)[],automatic:undefined as unknown,watchers:[] as any[],budget:undefined as unknown,budgetPercent:undefined as unknown,executed:[] as string[],calls:[] as unknown[][],keyAtOpen:[] as boolean[],throwOpen:false,updates:[] as {section:string;key:string;value:unknown;target:unknown}[],atShow:[] as unknown[],
  posted:[] as any[],receive:(_m:unknown)=>{},saveTo:undefined as string|undefined|(()=>string|undefined),dialogs:[] as {defaultPath:string;filters:unknown}[],clipboardFails:false,errorButtons:[] as string[][],errorChoice:undefined as string|undefined,configOpens:[] as string[]};
};
const communitySession=async(env:ReturnType<typeof communityEnv>,work:string)=>{
 const api=auditApi(),commands=new Map<string,(...a:any[])=>unknown>(),subscriptions:any[]=[],disposable={dispose(){}};
 const bundle=await builtBundle(work);
 const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ProgressLocation:{Notification:15},ExtensionMode:{Production:1,Development:2,Test:3},ConfigurationTarget:{Global:1},ThemeColor:class{},Uri:{...api.Uri,parse:(u:string)=>({parsed:u})},RelativePattern:class{base:any;pattern:string;constructor(base:any,pattern:string){this.base=base;this.pattern=pattern;}},extensions:{getExtension:()=>undefined},
  EventEmitter:api.EventEmitter,TreeItem:api.TreeItem,ThemeIcon:api.ThemeIcon,WorkspaceEdit:api.WorkspaceEdit,TreeItemCollapsibleState:api.TreeItemCollapsibleState,
  commands:{async executeCommand(id:string,...a:unknown[]){env.calls.push([id,...a]);if(id==='workbench.action.openWalkthrough'){env.keyAtOpen.push(env.store.has(WALKTHROUGH_KEY));if(env.throwOpen)throw new Error('synthetic-no-walkthroughs /private/synthetic-path');return;}env.executed.push(id);},registerCommand(id:string,fn:(...a:any[])=>unknown){commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
  env:{get appName(){return env.appName;},get uriScheme(){return env.uriScheme;},clipboard:{async writeText(t:string){if(env.clipboardFails)throw new Error('synthetic-clipboard-failure /private/synthetic-path');env.clipboard.push(t);}},async openExternal(u:any){env.opened.push(u.parsed);return true;}},
  workspace:{...api.workspace,isTrusted:true,get workspaceFolders(){return [{name:'synthetic-workspace',uri:{scheme:'file',fsPath:env.workspace}}];},
   getConfiguration:(section:string)=>({get:(key:string)=>section==='kiroAgent'?(key==='agentIgnoreFiles'?['.kiroignore']:undefined):section==='files'?env.autoSave:
    ({sourceRoot:env.sourceRoot,storageRoot:'',sourceTimezone:'UTC',supportPrompts:env.prompts,auditAutomatically:env.automatic,budgetWarnings:env.budget,budgetWarningPercent:env.budgetPercent} as any)[key]??'',
    async update(key:string,value:unknown,target:unknown){env.updates.push({section,key,value,target});}}),
   createFileSystemWatcher:(pattern:any,...flags:unknown[])=>{const w={pattern,flags,listeners:[] as any[],disposed:false,onDidCreate(fn:any){w.listeners.push(fn);return disposable;},onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){w.disposed=true;}};env.watchers.push(w);return w;},
   onDidChangeConfiguration(fn:any){env.configListeners.push(fn);return disposable;}},
  window:{...api.window,createStatusBarItem(){return {set text(t:string){env.statusTexts.push(t);},show(){},hide(){},dispose(){}};},
   createWebviewPanel(_t:string,_title:string,_c:number,o:any){env.panelOptions=o;const panel={webview:{html:'',postMessage(m:any){env.posted.push(m);return Promise.resolve(true);},onDidReceiveMessage(fn:(m:unknown)=>void){env.receive=fn;return disposable;}},reveal(){},onDidDispose:()=>disposable,onDidChangeViewState:()=>disposable,dispose(){}};env.panels.push(panel);return panel;},
   async showSaveDialog(o:any){env.dialogs.push({defaultPath:o.defaultUri.fsPath,filters:o.filters});const to=typeof env.saveTo==='function'?env.saveTo():env.saveTo;return to===undefined?undefined:{scheme:'file',fsPath:to};},
   async showQuickPick(choices:any[]){const id=env.answers.shift();return choices.find(i=>i.id===id);},async showInputBox(){return undefined;},async showWarningMessage(){},async showErrorMessage(m:string,...b:string[]){env.errors.push(m);env.errorButtons.push(b);return env.errorChoice;},
   async showInformationMessage(text:string,...buttons:string[]){env.atShow.push(structuredClone(env.store.get('cyclegauge.budgetWarning.v1')));env.infos.push({text,buttons});return buttons.length?env.choice:undefined;},
   async withProgress(_o:any,task:(p:unknown,t:unknown)=>Promise<unknown>){return task({},{onCancellationRequested:()=>disposable});}}};
 const globalState={get(k:string){if(env.throwState)throw new Error('synthetic-state-failure /private/synthetic-path');return env.store.get(k);},
  async update(k:string,v:unknown){if(env.throwState||env.failWrites)throw new Error('synthetic-state-failure /private/synthetic-path');env.written.push(k);if(v===undefined)env.store.delete(k);else env.store.set(k,structuredClone(v));}};
 let fixedNow=Date.parse(env.now);
 class SyntheticDate extends Date {constructor(...args:any[]){super(args.length?args[0]:fixedNow);}static now(){return fixedNow;}}
 const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout;
 (globalThis as any).setTimeout=(fn:any,ms?:number,...rest:any[])=>{if(ms!==1000&&ms!==5000&&ms!==30000&&ms!==60000&&ms!==180000)return realSet(fn,ms,...rest);const t={fn,ms:ms!,cleared:false,unref(){return t;}};env.timers.push(t);return t;};
 (globalThis as any).clearTimeout=(t:any)=>{if(t&&env.timers.includes(t))t.cleared=true;else realClear(t);};
 const require=createRequire(new URL('../../package.json',import.meta.url));
 const module={exports:{} as any};
 const saved:Record<string,string|undefined>={};
 for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME']){saved[k]=process.env[k];process.env[k]=env.home;}
 const openHook={...realFsPromises,async open(p:any,...a:any[]){if(/[\\/]\.kiro[\\/](steering|hooks)[\\/]/.test(String(p)))env.configOpens.push(String(p));return (realFsPromises.open as any)(p,...a);}};
 runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:id==='node:fs/promises'?openHook:require(id),module,module.exports,SyntheticDate);
 const later=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 let done=false;
 try{await module.exports.activate({subscriptions,globalStorageUri:{fsPath:env.globalStorage},logUri:{fsPath:join(work,'editor','logs','synthetic-session','exthost','synthetic.ext')},workspaceState:api.workspaceState,globalState,extensionMode:env.mode});await later();}finally{/* restored on disposal so delayed signal timers remain controllable */}
 return {commands,api,later,advance:()=>{fixedNow+=2100;},support:()=>env.timers.filter(t=>t.ms===180000),
  fire:async()=>{const t=env.timers.filter(x=>x.ms===180000);assert.equal(t.length,1);await t[0]!.fn();await later();},
  dispose(){if(done)return;done=true;module.exports.deactivate();for(const d of subscriptions)d.dispose();(globalThis as any).setTimeout=realSet;(globalThis as any).clearTimeout=realClear;for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}};
};
const hrefsOf=visibleHrefs;

test('packaged footer, Share and Report a problem: five command links, three fixed web links, a fixed clipboard text',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-footer-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,true);
  const s=await communitySession(env,work);open.push(s);
  assert.ok(s.commands.has('cyclegauge.share'));assert.ok(s.commands.has('cyclegauge.reportProblem'));assert.ok(s.commands.has('cyclegauge.support.reset'));
  await s.commands.get('cyclegauge.showUsage')!();
  assert.deepEqual(env.panelOptions,{enableScripts:true,retainContextWhenHidden:false,enableCommandUris:['cyclegauge.costAdvisor','cyclegauge.auditWorkspace','cyclegauge.audit.show','cyclegauge.share','cyclegauge.reportProblem'],localResourceRoots:[]});
  const html:string=env.panels.at(-1).webview.html;
  assert.deepEqual(hrefsOf(html).filter(h=>!h.startsWith('command:')),COMMUNITY_LINKS);
  for(const h of hrefsOf(html).filter(h=>h.startsWith('command:')))assert.ok(env.panelOptions.enableCommandUris.includes(h.slice('command:'.length)),h);
  assert.ok(hrefsOf(html).includes('command:cyclegauge.share'));assert.ok(hrefsOf(html).includes('command:cyclegauge.reportProblem'));assert.match(html,/<script nonce=/);assert.ok(!/utm_|[?&]ref=/.test(html));
  assert.match(html,/Rate on Open VSX/);assert.match(html,/Star on GitHub/);assert.match(html,/Support<\/a>/);assert.match(html,/>Copy share link<\/a>/);assert.match(html,/>Report a problem<\/a>/);
  // Share copies a fixed text with no user data and confirms in one friendly line.
  env.infos.length=0;await s.commands.get('cyclegauge.share')!();await s.later();
  assert.deepEqual(env.clipboard,["Cyclegauge shows your Kiro credit usage, forecasts when you'll run out and finds files Kiro may read but probably doesn't need. Free and open source: https://open-vsx.org/extension/StefanSuess/cyclegauge"]);
  assert.deepEqual(env.infos,[{text:'Link copied — thanks for sharing!',buttons:[]}]);assert.ok(!env.clipboard[0]!.includes(work));assert.deepEqual(env.opened,[]);
  // A failing Share is one fixed error that offers Report a problem; dismissing it does nothing, and only the button runs the command.
  env.clipboardFails=true;env.errors.length=0;env.executed.length=0;s.advance();await s.commands.get('cyclegauge.share')!();await s.later();
  assert.deepEqual(env.errors,['The link could not be copied. You can report it with the button below.']);assert.deepEqual(env.errorButtons,[['Report a problem']]);assert.ok(!env.executed.includes('cyclegauge.reportProblem'));
  env.errorChoice='Report a problem';s.advance();await s.commands.get('cyclegauge.share')!();await s.later();
  assert.deepEqual(env.executed.filter(id=>id.startsWith('cyclegauge.')),['cyclegauge.reportProblem']);assert.deepEqual(env.opened,[]);
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
  seed(undefined);env.throwState=true;const shown=env.statusTexts.length;s=await start();assert.ok(s.commands.has('cyclegauge.showUsage'));assert.ok(env.statusTexts.slice(shown).every(t=>!/unavailable|update needed|Needs a newer Kiro|Update Cyclegauge/i.test(t)),env.statusTexts.join('|'));
  await s.fire();assert.deepEqual(env.infos,[]);assert.deepEqual(env.errors,[]);assert.equal(env.written.length,0);env.throwState=false;s.dispose();
  // The setting off: neither the first-use date nor the value flag is recorded.
  seed(undefined);env.prompts=false;s=await start();await s.fire();s.dispose();assert.deepEqual([...env.store.keys()],[WALKTHROUGH_KEY]);assert.deepEqual(env.written,[WALKTHROUGH_KEY]);assert.deepEqual(env.infos,[]);
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

test('packaged walkthrough: opens once for a new user with the key written first, never for existing users, outside Kiro or in Test mode; a failing open is silent',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-walkthrough-')));
 const OPEN=[['workbench.action.openWalkthrough','StefanSuess.cyclegauge#cyclegauge.gettingStarted']];
 try{
  const env=communityEnv(work,false);
  const run=async(setup:()=>void=()=>{})=>{env.store.clear();env.written.length=0;env.calls.length=0;env.keyAtOpen.length=0;env.errors.length=0;env.infos.length=0;env.timers.length=0;env.failWrites=false;env.throwOpen=false;env.appName='Kiro';env.uriScheme='kiro';env.mode=1;setup();const s=await communitySession(env,work);return s;};
  // A new user: opened once, with the key already stored at that moment; a second window with the same state does not open it again.
  let s=await run();assert.deepEqual(env.calls,OPEN);assert.deepEqual(env.keyAtOpen,[true]);assert.equal(env.store.get(WALKTHROUGH_KEY),true);assert.deepEqual(env.executed,[]);
  assert.ok(s.commands.has('cyclegauge.showUsage'));s.dispose();
  env.calls.length=0;s=await communitySession(env,work);assert.deepEqual(env.calls,[]);
  // The command opens it on demand, any time and in any editor.
  await s.commands.get('cyclegauge.gettingStarted')!();assert.deepEqual(env.calls,OPEN);s.dispose();
  // Existing users (first use already stored) only get the key.
  s=await run(()=>env.store.set('cyclegauge.support.firstSeen.v1','2029-12-01'));assert.deepEqual(env.calls,[]);assert.equal(env.store.get(WALKTHROUGH_KEY),true);s.dispose();
  // Any other earlier Cyclegauge state also marks an existing user (e.g. someone who turned the support prompts off but got a budget warning).
  s=await run(()=>env.store.set('cyclegauge.budgetWarning.v1',{cycle:'2030-02-01T00:00:00Z',done:['percent']}));assert.deepEqual(env.calls,[]);assert.equal(env.store.get(WALKTHROUGH_KEY),true);s.dispose();
  // A user who turned the support prompts off gets no unsolicited walkthrough either.
  s=await run(()=>{env.prompts=false;});assert.deepEqual(env.calls,[]);assert.equal(env.store.get(WALKTHROUGH_KEY),true);s.dispose();env.prompts=undefined;
  // Not Kiro, and the extension Test mode: nothing opens and nothing is written.
  s=await run(()=>{env.appName='Visual Studio Code';env.uriScheme='vscode';});assert.deepEqual(env.calls,[]);assert.equal(env.store.has(WALKTHROUGH_KEY),false);
  await s.commands.get('cyclegauge.gettingStarted')!();assert.deepEqual(env.calls,OPEN);s.dispose();
  s=await run(()=>{env.mode=3;});assert.deepEqual(env.calls,[]);assert.equal(env.store.has(WALKTHROUGH_KEY),false);assert.ok(s.commands.has('cyclegauge.gettingStarted'));s.dispose();
  // Fail closed: no write, no open. A throwing open is silent, leaves the key set and does not touch the gauge.
  s=await run(()=>{env.failWrites=true;});assert.deepEqual(env.calls,[]);assert.equal(env.store.has(WALKTHROUGH_KEY),false);assert.deepEqual(env.errors,[]);assert.ok(s.commands.has('cyclegauge.showUsage'));s.dispose();
  s=await run(()=>{env.throwOpen=true;});assert.equal(env.calls.length,1);assert.equal(env.store.get(WALKTHROUGH_KEY),true);assert.deepEqual(env.errors,[]);assert.deepEqual(env.infos,[]);
  await s.commands.get('cyclegauge.gettingStarted')!();assert.deepEqual(env.errors,[]);assert.ok(s.commands.has('cyclegauge.showUsage'));s.dispose();
 }finally{rmSync(work,{recursive:true,force:true});}
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
  // Outside Kiro, no source chosen: one notice, remembered; Run workspace audit runs the audit command on click only.
  outside();reset();env.choice='Run workspace audit';env.executed.length=0;let s=await start();
  assert.deepEqual(notices(),[{text:NOT_KIRO,buttons:['Run workspace audit','Got it']}]);assert.deepEqual(env.opened,[]);assert.deepEqual(env.executed.filter((id:string)=>id.startsWith('cyclegauge.')),['cyclegauge.auditWorkspace']);assert.equal(env.store.get('cyclegauge.notKiro.shown.v1'),true);
  assert.equal(s.support().length,0);assert.deepEqual([...env.store.keys()],['cyclegauge.notKiro.shown.v1']);
  assert.equal(env.statusTexts.at(-1),'$(info) Kiro not detected');
  await s.commands.get('cyclegauge.showUsage')!();const html:string=env.panels.at(-1).webview.html;
  assert.ok(html.includes(NOT_KIRO.replaceAll("'",'&#39;')));assert.match(html,/Kiro not detected/);assert.ok(!html.includes(work));s.dispose();
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
  outside();env.sourceRoot=env.source;reset();s=await start();assert.ok(env.statusTexts.at(-1)!.startsWith('$(warning) Kiro credits:'),env.statusTexts.at(-1));assert.ok(!env.statusTexts.includes('$(info) Kiro not detected'));s.dispose();
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

// Waits for real filesystem work (a re-check walks the synthetic workspace) with a real-time bound, not a tick count.
const until=async(done:()=>boolean,ms=5000)=>{const end=Date.now()+ms;while(!done()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));};
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
  const envFound=()=>flatTree(auditRoots(s.api.state.providers.get('cyclegauge.auditView'))).some((n:any)=>n.finding?.path==='.env');
  // Never checked: nothing starts.
  save(target);setting('kiroAgent.agentIgnoreFiles');assert.equal(pending().length,0);
  await s.commands.get('cyclegauge.auditWorkspace')!();await s.later();assert.ok(envFound());
  const infos=env.infos.length;
  // Other files, files outside the folder and other settings start nothing.
  save(join(env.workspace,'synthetic-other'));save(join(work,'.kiroignore'));setting('files.autoSave');assert.equal(pending().length,0);
  // A burst of saves is one silent re-check that picks up the saved rules.
  writeFileSync(target,'/.env\n');save(target);save(target);assert.equal(pending().length,1);
  await fire();await until(()=>!envFound());
  assert.ok(!envFound());assert.equal(env.infos.length,infos);
  // Changing Agent Ignore Files re-checks too, and disposal cancels a pending re-check.
  setting('kiroAgent.agentIgnoreFiles');assert.equal(pending().length,1);
  const last=pending()[0]!;s.dispose();assert.equal(last.cleared,true);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

// A manual audit also runs the Steering and Hooks review (approved 2026-10-18); silent re-runs never do. The review is observed by the opens of `.kiro/steering` and
// `.kiro/hooks` files, which only the review performs (the audit reads only ignore files).
test('packaged manual audit starts exactly one Steering and Hooks review; silent re-runs, a dismissed picker and a cancelled audit start none',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-review-bundle-')));
 const open:{dispose():void}[]=[];
 try{
  const env=reminderEnv(work);
  mkdirSync(join(env.workspace,'.kiro','steering'),{recursive:true});writeFileSync(join(env.workspace,'.kiro','steering','synthetic.md'),Buffer.alloc(30000,'x'));
  const start=async()=>{const s=await reminderSession(env,work);open.push(s);return s;};
  const reset=()=>{env.infos.length=0;env.warnings.length=0;env.errors.length=0;env.progress=0;env.executed.length=0;env.store.clear();env.written.length=0;env.choice=undefined;env.configOpens.length=0;env.configReads.length=0;env.pickCalls=0;env.pick=undefined;env.cancel=false;env.failConfigOpen=false;env.automatic=undefined;env.trusted=true;};
  const settle=()=>new Promise(r=>setTimeout(r,150));
  const config=(s:any)=>s.provider().getChildren().filter((n:any)=>n.kind==='config');
  const manual=(s:any,id='cyclegauge.auditWorkspace')=>{s.advance();return s.commands.get(id)!();}; // the dashboard commands are rate-limited per second
  // The manual command: the audit result and exactly one review run.
  reset();let s=await start();await manual(s);await until(()=>env.configOpens.length>0);await settle();
  assert.equal(env.configOpens.length,1);assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);assert.equal(env.progress,1);
  assert.deepEqual(env.infos,[{text:'Found 2 files Kiro may read (about 27 B). Open the Workspace Audit view.',buttons:[]}]);
  assert.ok(flatTree(config(s)).some((n:any)=>String(n.label).startsWith('Large Steering file is always included')));s.dispose();
  // The credit view's Show with no result runs the audit, so it runs the review too; a second run runs one more review.
  reset();s=await start();await manual(s,'cyclegauge.audit.show');await until(()=>env.configOpens.length>0);await settle();assert.equal(env.configOpens.length,1);
  await manual(s);await until(()=>env.configOpens.length>1);await settle();assert.equal(env.configOpens.length,2);s.dispose();
  // The reminder's Run audit button is a manual audit; the reminder-driven automatic run is silent and starts none.
  reset();env.store.set('cyclegauge.audit.last.v1','2030-03-01');env.choice='Run audit';s=await start();await s.fire();await until(()=>env.configOpens.length>0);await settle();assert.equal(env.configOpens.length,1);s.dispose();
  reset();env.store.set('cyclegauge.audit.last.v1','2030-03-01');env.automatic=true;s=await start();await s.fire();await settle();
  assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);assert.equal(env.progress,0);assert.deepEqual(env.configOpens,[]);assert.equal(config(s).length,0,'a silent re-run starts no review, so there is no Steering and Hooks group');s.dispose();
  // A dismissed folder picker (multi-root) and a cancelled audit start no review; choosing a folder does.
  const second=join(work,'synthetic-second');mkdirSync(second,{recursive:true});
  const both=[{name:'synthetic-workspace',uri:{scheme:'file',fsPath:env.workspace}},{name:'synthetic-second',uri:{scheme:'file',fsPath:second}}];
  reset();env.folders=both;s=await start();await manual(s);await settle();assert.equal(env.pickCalls,1);assert.deepEqual(env.configOpens,[]);assert.equal(env.store.has('cyclegauge.audit.last.v1'),false);
  env.pick='first';await manual(s);await settle();await until(()=>env.configOpens.length>0);await settle();assert.equal(env.configOpens.length,1);s.dispose();env.folders=[both[0]];
  reset();env.cancel=true;s=await start();await manual(s);await settle();assert.deepEqual(env.configOpens,[]);assert.equal(env.store.has('cyclegauge.audit.last.v1'),false);s.dispose();
  // An untrusted workspace: the review is told so in its own section, reads nothing and shows no enable offer; the audit's own warning stays.
  reset();env.trusted=false;s=await start();await manual(s);await settle();
  assert.deepEqual(env.warnings,['Cyclegauge audits only trusted workspaces.']);assert.deepEqual(env.configOpens,[]);assert.deepEqual(env.configReads.filter(p=>p.includes('steering')),[]);
  assert.match(JSON.stringify(config(s)),/not trusted/);assert.ok(!infoTexts(env).some(t=>t.includes('Steering and Hooks automatically')));s.dispose();
  // A failing review run leaves the audit's result and notification intact and raises no error.
  reset();env.failConfigOpen=true;s=await start();await manual(s);await until(()=>env.configOpens.length>0);await settle();
  assert.deepEqual(env.infos,[{text:'Found 2 files Kiro may read (about 27 B). Open the Workspace Audit view.',buttons:[]}]);assert.deepEqual(env.errors,[]);assert.equal(env.store.get('cyclegauge.audit.last.v1'),TODAY);
  assert.match(auditRoots(s.provider())[0].label,/^Checked .+ · 2 suggestions$/);s.dispose();
  // A refused folder is still an audit attempt: the audit says why and the review starts, refuses the same folder and reads nothing.
  reset();env.folders=[{name:'synthetic-source',uri:{scheme:'file',fsPath:env.source}}];s=await start();await manual(s);await settle();
  assert.equal(env.warnings.length,1);assert.deepEqual(env.configOpens,[]);assert.equal(config(s).length,1);s.dispose();env.folders=[both[0]];
 }finally{for(const s of open)s.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged ignore-file re-check after a manual audit starts no further review',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-review-recheck-')));
 let s:any;
 try{
  const env=communityEnv(work,true);env.prompts=false;
  mkdirSync(join(env.workspace,'.kiro','steering'),{recursive:true});writeFileSync(join(env.workspace,'.kiro','steering','synthetic.md'),Buffer.alloc(30000,'x'));
  s=await communitySession(env,work);
  const target=join(env.workspace,'.kiroignore');
  await s.commands.get('cyclegauge.auditWorkspace')!();await until(()=>env.configOpens.length>0);await s.later();assert.equal(env.configOpens.length,1);
  writeFileSync(target,'/.env\n');for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:target},getText:()=>''});
  const [t]=env.timers.filter(x=>x.ms===1000&&!x.cleared);assert.ok(t);t!.cleared=true;await t!.fn();await s.later();await new Promise(r=>setTimeout(r,150));
  assert.equal(env.configOpens.length,1,'the silent re-check never starts the review');
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

// onOpenAndChanges: one narrow watcher for the single trusted folder; new matching files lead to one silent re-check, and a new
// secrets finding to at most one notice a day. Other modes, pruned folders and non-secret files never notify.
test('packaged watch mode: narrow watcher, debounced re-check and one daily notice for new secret files',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-watch-')));
 let s:any;
 try{
  const env=communityEnv(work,true);env.prompts=false;
  const auditWatchers=()=>env.watchers.filter(w=>typeof w.pattern?.pattern==='string'&&w.pattern.pattern.startsWith('**/{'));
  const pending=()=>env.timers.filter(t=>t.ms===5000&&!t.cleared);
  const fire=async()=>{const [t]=pending();assert.ok(t);t!.cleared=true;await t!.fn();};
  const create=(rel:string)=>{const p=join(env.workspace,...rel.split('/'));mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,'');for(const w of auditWatchers())for(const fn of w.listeners)fn({scheme:'file',fsPath:p});};
  const notices=()=>env.infos.filter(i=>/may contain secrets/.test(i.text));
  for(const mode of [undefined,'off','onOpen',true,'OnOpenAndChanges']){env.automatic=mode;s=await communitySession(env,work);assert.equal(auditWatchers().length,0,String(mode));s.dispose();}
  env.automatic='onOpenAndChanges';s=await communitySession(env,work);
  const [w]=auditWatchers();assert.equal(auditWatchers().length,1);assert.deepEqual(w.flags,[false,true,true]);
  const store=s.api.state.store,LAST='cyclegauge.audit.last.v1',SNOOZE='cyclegauge.audit.snoozeUntil.v1';
  // Same consent as automatic runs: never audited, or snoozed, means a new file starts nothing.
  create('synthetic-0.pem');assert.equal(pending().length,0);
  store.set(LAST,'2030-01-03');store.set(SNOOZE,'2030-01-05');create('synthetic-0.pem');assert.equal(pending().length,0);store.delete(SNOOZE);
  assert.equal(w.pattern.base.uri.fsPath,env.workspace);assert.ok(w.pattern.pattern.includes('*.pem')&&w.pattern.pattern.includes('.env'));
  // Inside a folder the audit never enters, or outside the folder: nothing.
  create('node_modules/synthetic.pem');for(const fn of w.listeners)fn({scheme:'file',fsPath:join(work,'synthetic-outside.pem')});assert.equal(pending().length,0);
  // A burst of new files is one re-check after it settles; the new key is a secrets finding, so one notice with Show.
  create('synthetic-a.pem');create('synthetic-b.log');assert.equal(pending().length,1);
  await fire();await until(()=>notices().length>0);
  assert.deepEqual(notices(),[{text:'A new file that may contain secrets appeared in this workspace. Kiro may read it.',buttons:['Show']}]);
  // The same UTC day: re-checked, but no second notice.
  create('synthetic-c.ppk');await fire();await until(()=>flatTree(auditRoots(s.api.state.providers.get('cyclegauge.auditView'))).some((n:any)=>n.finding?.path==='synthetic-c.ppk'));
  assert.equal(notices().length,1);
  // Turning the mode off removes the watcher and cancels the re-check it had scheduled.
  create('synthetic-f.pem');const scheduled=pending()[0]!;
  env.automatic='onOpen';for(const fn of env.configListeners)fn({affectsConfiguration:(k:string)=>k==='cyclegauge.auditAutomatically'});
  assert.equal(w.disposed,true);assert.equal(scheduled.cleared,true);s.dispose();
  // A new non-secret file never notifies; disposal cancels a pending re-check and the watcher.
  env.infos.length=0;env.automatic='onOpenAndChanges';s=await communitySession(env,work);s.api.state.store.set('cyclegauge.audit.last.v1','2030-01-03');
  create('synthetic-d.log');await fire();await until(()=>false,300);assert.equal(notices().length,0);
  // A secret that was already in the previous result and is recreated (save by rename) is not new, even on a fresh day budget.
  await s.commands.get('cyclegauge.auditWorkspace')!();env.infos.length=0;
  create('.env');await fire();await until(()=>false,300);assert.equal(notices().length,0);
  create('synthetic-e.pem');const t=pending()[0]!;const [w2]=auditWatchers().filter(x=>!x.disposed);s.dispose();assert.equal(t.cleared,true);assert.equal(w2.disposed,true);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

// A re-check before the user saves a prepared Exclude edit keeps that edit, so saving it still counts as the support signal.
test('packaged re-check keeps a prepared Exclude edit',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-recheck-keep-')));
 let s:any;
 try{
  const env=communityEnv(work,true);env.store.set('cyclegauge.support.firstSeen.v1','2029-12-01');
  s=await communitySession(env,work);await s.commands.get('cyclegauge.auditWorkspace')!();
  const node=flatTree(auditRoots(s.api.state.providers.get('cyclegauge.auditView'))).find((n:any)=>n.finding?.suggestion);
  await s.commands.get('cyclegauge.audit.accept')!(node);await s.later();
  const last=s.api.state.fires;
  for(const fn of env.configListeners)fn({affectsConfiguration:(k:string)=>k==='kiroAgent.agentIgnoreFiles'});
  const t=env.timers.find(x=>x.ms===1000&&!x.cleared)!;t.cleared=true;await t.fn();
  await until(()=>s.api.state.fires>last);
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
  const node=flatTree(auditRoots(provider)).find((n:any)=>n.finding?.suggestion);
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
  s.advance();env.answers.push('reset');await s.commands.get('cyclegauge.costAdvisor')!();await s.later();assert.equal(env.store.has('cyclegauge.support.advisorUsed.v1'),false);
  s.advance();env.answers.push('plan:pro_max','consumer_prepaid','none');await s.commands.get('cyclegauge.costAdvisor')!();await s.later();
  assert.equal(env.store.get('cyclegauge.support.advisorUsed.v1'),true);assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,1);
  await s.commands.get('cyclegauge.support.reset')!();assert.deepEqual([...env.store.keys()].filter(k=>k.startsWith('cyclegauge.support.')),[]);
  s.advance();env.infos.length=0;env.answers.push('plan:pro_max','consumer_prepaid','none');await s.commands.get('cyclegauge.costAdvisor')!();await s.later();assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,0);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged saved exclusion with auto-save preserves existing ignore text',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-community-save-')));let s:any;
 try {
  const env=communityEnv(work,false);env.autoSave='afterDelay';env.store.set('cyclegauge.support.firstSeen.v1','2030-01-03');
  const path=join(env.workspace,'.kiroignore');writeFileSync(path,'# synthetic-existing\n');
  s=await communitySession(env,work);await s.commands.get('cyclegauge.auditWorkspace')!();
  const node=flatTree(auditRoots(s.api.state.providers.get('cyclegauge.auditView'))).find((n:any)=>n.finding?.suggestion);
  await s.commands.get('cyclegauge.audit.accept')!(node);const proposal=s.api.state.contentDocs.at(-1).getText();
  const text='# synthetic-existing\n'+proposal;writeFileSync(path,text);
  for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:path},getText:()=>text});await s.later();
  assert.equal(env.timers.filter(t=>t.ms===60000).length,1);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

// "Your Cyclegauge summary": a saved Exclude edit is counted once under the observed billing cycle, in one global-state key that only the explicit reset clears.
const RESULTS_KEY='cyclegauge.results.v1';
const saveExclude=async(s:any,env:ReturnType<typeof communityEnv>,path:string)=>{
 await s.commands.get('cyclegauge.auditWorkspace')!();
 const node=flatTree(auditRoots(s.api.state.providers.get('cyclegauge.auditView'))).find((n:any)=>n.finding?.suggestion);
 await s.commands.get('cyclegauge.audit.accept')!(node);const doc=s.api.state.contentDocs.at(-1);
 const text='# synthetic-existing\n'+doc.getText();writeFileSync(path,text);
 return {text,save:(file=path)=>{for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:file},getText:()=>text});}};
};
test('packaged results summary counts a matching save once, ignores other saves, and the explicit reset clears it',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-results-summary-')));let s:any;
 try {
  const env=communityEnv(work,true);env.autoSave='afterDelay';
  const path=join(env.workspace,'.kiroignore');writeFileSync(path,'# synthetic-existing\n');
  s=await communitySession(env,work);
  const {save}=await saveExclude(s,env,path);
  save(join(env.workspace,'synthetic-other'));await s.later();
  assert.equal(env.store.has(RESULTS_KEY),false,'a save of another file records nothing');
  save();await s.later();
  const cycle='2030-02-01T00:00:00.000Z';
  assert.deepEqual(env.store.get(RESULTS_KEY),[{cycle,bytes:'SYNTHETIC_CONTENT_SENTINEL'.length,bytesLowerBound:false,items:1,secrets:1}]);
  save();await s.later();
  assert.equal((env.store.get(RESULTS_KEY) as any[])[0].items,1,'the same prepared edit is counted once');
  assert.equal(env.written.filter(k=>k===RESULTS_KEY).length,1);
  const serialized=JSON.stringify(env.store.get(RESULTS_KEY));
  for(const marker of [work,'.env','synthetic-bundle-account','partition','synthetic-workspace'])assert.ok(!serialized.includes(marker));
  await s.commands.get('cyclegauge.showUsage')!();await s.later();
  const html=env.panels[0].webview.html as string;
  assert.match(html,/Your Cyclegauge summary/);assert.match(html,/This cycle, resetting 1 Feb 2030 \(UTC\): 1 item \(1 possible secret\), about 26 B\./);assert.ok(!/style=/.test(html));
  await s.commands.get('cyclegauge.support.reset')!();await s.later();
  assert.equal(env.store.has(RESULTS_KEY),false,'the explicit reset clears the summary');
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});
test('packaged results summary never overwrites an unreadable value and counts nothing without an observed cycle',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-results-unknown-')));let s:any;
 try {
  const env=communityEnv(work,true);env.autoSave='afterDelay';env.store.set(RESULTS_KEY,{v:2,cycles:[]});
  const path=join(env.workspace,'.kiroignore');writeFileSync(path,'# synthetic-existing\n');
  s=await communitySession(env,work);
  (await saveExclude(s,env,path)).save();await s.later();
  assert.deepEqual(env.store.get(RESULTS_KEY),{v:2,cycles:[]},'a value of an unknown shape is left as it is');
  await s.commands.get('cyclegauge.showUsage')!();await s.later();
  assert.match(env.panels[0].webview.html,/could not be read, so none are shown/);
  await s.commands.get('cyclegauge.support.reset')!();assert.equal(env.store.has(RESULTS_KEY),false);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
 const other=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-results-nocycle-')));
 try {
  const env=communityEnv(other,false);env.autoSave='afterDelay';
  const path=join(env.workspace,'.kiroignore');writeFileSync(path,'# synthetic-existing\n');
  s=await communitySession(env,other);
  (await saveExclude(s,env,path)).save();await s.later();
  assert.equal(env.store.has(RESULTS_KEY),false,'without an observed cycle nothing is counted');
 }finally{s?.dispose();rmSync(other,{recursive:true,force:true});}
});

test('packaged test override requires the isolated synthetic demo profile and explicit opt-in',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-cyclegauge-demo-')));let s:any;
 const oldFlag=process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST,oldSource=process.env.CYCLEGAUGE_SYNTHETIC_SOURCE;
 try {
  const env=communityEnv(work,false);process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST='1';process.env.CYCLEGAUGE_SYNTHETIC_SOURCE=env.source;
  for(const isolated of [false,true]) {
   env.store.clear();env.infos.length=0;env.timers.length=0;if(isolated)env.globalStorage=join(work,'user-data','global');
   s=await communitySession(env,work);await s.commands.get('cyclegauge.support.reset')!();await s.commands.get('cyclegauge.auditWorkspace')!();
   const node=flatTree(auditRoots(s.api.state.providers.get('cyclegauge.auditView'))).find((n:any)=>n.finding?.suggestion);
   await s.commands.get('cyclegauge.audit.accept')!(node);const doc=s.api.state.shown.at(-1),path=join(env.workspace,'.kiroignore');writeFileSync(path,doc.getText());
   for(const fn of s.api.state.saveListeners)fn({uri:{scheme:'file',fsPath:path},getText:()=>doc.getText()});await s.later();
   env.infos.length=0;await env.timers.find(t=>t.ms===60000)!.fn();await s.later();assert.equal(env.infos.filter(i=>i.text===SUPPORT_TEXT).length,isolated?1:0);
   s.dispose();rmSync(path);
  }
 }finally{s?.dispose();if(oldFlag===undefined)delete process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST;else process.env.CYCLEGAUGE_SYNTHETIC_SUPPORT_TEST=oldFlag;if(oldSource===undefined)delete process.env.CYCLEGAUGE_SYNTHETIC_SOURCE;else process.env.CYCLEGAUGE_SYNTHETIC_SOURCE=oldSource;rmSync(work,{recursive:true,force:true});}
});

// Budget warning: the packaged bundle shows at most one notice per window, once per billing cycle and kind, only in Kiro, never in the extension tests,
// and writes its single state key before showing it. The invented account has a limit of 100 credits and resets on 2030-02-01.
const BUDGET_KEY='cyclegauge.budgetWarning.v1';
const BUDGET_BUTTONS=['Show details','Turn off budget notices'];
const BUDGET_NOW='2030-01-08T00:30:00Z';
const FORECAST_TEXT='At this pace your Kiro credits run out on 10 Jan, 22 days before the reset (about $8.60 over the limit, modelled).';
const budgetLine=(stamp:string,usage:number,limit=100,reset='2030-02-01T00:00:00Z')=>`${stamp} [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-budget-account'},nextDateReset:reset,usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:usage,usageLimitWithPrecision:limit,nextDateReset:reset,bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n';
const budgetLogPath=(env:ReturnType<typeof communityEnv>)=>join(env.source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent','q-client.log');
const budgetData=(env:ReturnType<typeof communityEnv>,usages:number[],limit=100)=>writeFileSync(budgetLogPath(env),usages.map((u,i)=>budgetLine(`2030-01-0${i+1} 00:00:00.000`,u,limit)).join(''));
const budgetInfos=(env:ReturnType<typeof communityEnv>)=>env.infos.filter(i=>i.buttons.join()===BUDGET_BUTTONS.join());

test('packaged budget warning: one notice per window, once per cycle and kind, state written first, buttons and settings',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-budget-warning-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,false);env.now=BUDGET_NOW;
  const start=async()=>{const s=await communitySession(env,work);open.push(s);return s;};
  const clear=()=>{env.infos.length=0;env.atShow.length=0;env.executed.length=0;env.updates.length=0;env.written.length=0;env.errors.length=0;env.timers.length=0;};
  const wipe=()=>{clear();rmSync(env.globalStorage,{recursive:true,force:true});env.store.clear();env.choice=undefined;env.budget=undefined;env.budgetPercent=undefined;env.failWrites=false;env.throwState=false;env.mode=1;env.appName='Kiro';env.uriScheme='kiro';};
  // Forecast: the notice is due, its state is stored BEFORE it is shown, and a dismissal changes nothing else.
  budgetData(env,[5,15,25,35,45,55,65,75]);
  let s=await start();await until(()=>env.infos.length>0);await s.later();
  assert.deepEqual(env.infos,[{text:FORECAST_TEXT,buttons:BUDGET_BUTTONS}]);
  const stored=env.store.get(BUDGET_KEY) as {cycle:string;done:string[]};
  assert.deepEqual(Object.keys(stored).sort(),['cycle','done']);assert.deepEqual(stored.done,['forecast']);assert.equal(Date.parse(stored.cycle),Date.parse('2030-02-01T00:00:00Z'));
  assert.deepEqual(env.atShow,[stored]);assert.equal(env.written.filter(k=>k===BUDGET_KEY).length,1);
  assert.deepEqual(env.executed,[]);assert.deepEqual(env.updates,[]);
  // Never more than one notice per window: the limit is reached while the window is open and nothing more is shown.
  writeFileSync(budgetLogPath(env),budgetLine('2030-01-08 00:10:00.000',100),{flag:'a'});
  const watcher=env.watchers.find(w=>String(w.pattern?.pattern).includes('q-client.log'));assert.ok(watcher);
  env.infos.length=0;watcher.listeners[0]();await new Promise(r=>setTimeout(r,1300));await s.later();
  assert.deepEqual(budgetInfos(env),[]);assert.deepEqual((env.store.get(BUDGET_KEY) as any).done,['forecast']);
  s.dispose();
  // A new window in the same cycle: the forecast was handled, the more severe limit notice is shown now and "Show details" opens the credit view.
  clear();env.choice='Show details';s=await start();await until(()=>env.infos.length>0);await s.later();
  assert.equal(budgetInfos(env).length,1);assert.match(budgetInfos(env)[0]!.text,/^You have reached the reported Kiro credit limit \(100 of 100\); the reset is in 24 days[ .(]/);
  assert.deepEqual((env.store.get(BUDGET_KEY) as any).done,['limit','forecast','percent']);assert.deepEqual(env.executed,['cyclegauge.showUsage']);assert.deepEqual(env.updates,[]);
  s.dispose();
  // Handled kinds are not repeated in later windows of the cycle, and nothing is written.
  clear();env.choice=undefined;s=await start();await s.later();assert.deepEqual(budgetInfos(env),[]);assert.deepEqual(env.written.filter(k=>k===BUDGET_KEY),[]);s.dispose();
  // A new billing cycle starts over.
  env.store.set(BUDGET_KEY,{cycle:'2029-12-01T00:00:00.000Z',done:['forecast','limit','percent']});clear();s=await start();await until(()=>env.infos.length>0);await s.later();
  assert.equal(budgetInfos(env).length,1);assert.equal((env.store.get(BUDGET_KEY) as any).cycle.slice(0,10),'2030-02-01');s.dispose();
  // Turn off sets the user setting off globally.
  wipe();budgetData(env,[5,15,25,35,45,55,65,75]);env.choice='Turn off budget notices';s=await start();await until(()=>env.updates.length>0);
  assert.deepEqual(env.updates,[{section:'cyclegauge',key:'budgetWarnings',value:false,target:1}]);assert.deepEqual(env.executed,[]);s.dispose();
  // The setting off: no notice and no state.
  wipe();env.budget=false;s=await start();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);s.dispose();
  // Anything but an explicit false leaves it on.
  wipe();env.budget='false';s=await start();await until(()=>env.infos.length>0);assert.equal(budgetInfos(env).length,1);s.dispose();
  // Percent: the early notice at the configured share, and 0 turns only that notice off.
  wipe();budgetData(env,[85,85,85,85,85,85,85,85]);s=await start();await until(()=>env.infos.length>0);await s.later();
  assert.deepEqual(budgetInfos(env).map(i=>i.text),['You have used 85% of your reported Kiro credits (85 of 100); the reset is in 24 days.']);assert.deepEqual((env.store.get(BUDGET_KEY) as any).done,['percent']);s.dispose();
  wipe();env.budgetPercent=0;s=await start();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);s.dispose();
  wipe();env.budgetPercent=90;s=await start();await s.later();assert.deepEqual(env.infos,[]);s.dispose();
  wipe();env.budgetPercent=85;s=await start();await until(()=>env.infos.length>0);assert.equal(budgetInfos(env).length,1);s.dispose();
  // A state that cannot be written, or neither read nor written, shows nothing (fail closed).
  wipe();budgetData(env,[5,15,25,35,45,55,65,75]);env.failWrites=true;s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.deepEqual(env.errors,[]);s.dispose();
  wipe();env.throwState=true;const shown=env.statusTexts.length;s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.deepEqual(env.errors,[]);assert.ok(env.statusTexts.slice(shown).every(t=>!/unavailable|update needed|Needs a newer Kiro|Update Cyclegauge/i.test(t)));s.dispose();
  // Stale data (the last update is more than a day old) gives no notice.
  wipe();env.now='2030-01-10T00:00:00Z';s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);s.dispose();env.now=BUDGET_NOW;
  // A provisional forecast (five updates) is too early for a forecast notice, even though it would be exhausted before the reset.
  wipe();budgetData(env,[10,20,30,40,50]);env.now='2030-01-05T00:30:00Z';s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);s.dispose();env.now=BUDGET_NOW;
  // Extra credits are not supported: no notice rests on the reported limit.
  wipe();budgetData(env,[100,100,100,100,100,100,100,100]);writeFileSync(budgetLogPath(env),readFileSync(budgetLogPath(env),'utf8').replaceAll('overageCredits":[]','overageCredits":[{"synthetic":1}]'));
  s=await start();await s.later();await s.later();assert.deepEqual(budgetInfos(env),[]);s.dispose();
  // Only in Kiro and never in the extension tests: nothing shown, nothing stored.
  wipe();env.appName='Visual Studio Code';env.uriScheme='vscode';s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);s.dispose();
  wipe();env.mode=3;s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);s.dispose();
  wipe();budgetData(env,[5,15,25,35,45,55,65,75]);env.appName='Synthetic Editor';env.uriScheme='kiro';s=await start();await until(()=>env.infos.length>0);assert.equal(budgetInfos(env).length,1);assert.ok(!JSON.stringify(env.store.get(BUDGET_KEY)).includes(work)&&!JSON.stringify(env.store.get(BUDGET_KEY)).includes('synthetic'));s.dispose(); // Kiro by URL scheme alone; the state holds no path or identifier
  const texts=():string[]=>env.infos.map((i:{text:string})=>i.text);
  // No pile-up: after a budget notice, the support prompt (otherwise due) does not appear in this window; without a budget notice it does.
  wipe();budgetData(env,[5,15,25,35,45,55,65,75]);env.store.set('cyclegauge.support.firstSeen.v1','2029-12-01');env.choice='Show details';s=await start();await until(()=>env.infos.length>0);await s.later();
  assert.equal(budgetInfos(env).length,1);assert.deepEqual(env.executed,['cyclegauge.showUsage']);env.infos.length=0;await s.fire();assert.deepEqual(env.infos,[]);s.dispose();
  wipe();env.store.set('cyclegauge.support.firstSeen.v1','2029-12-01');env.budget=false;s=await start();await s.fire();assert.deepEqual(texts(),[SUPPORT_TEXT]);s.dispose();
  // Only the one documented budget key was written, holding no path, identifier or amount.
  assert.ok(env.written.every(k=>k===BUDGET_KEY||k===RECAP_KEY||COMMUNITY_KEYS.includes(k)),env.written.join());
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});

// Plan hints in the packaged bundle. Three invented billing cycles on a 2000-credit account: the cycle before the last one ends at 200, the last one at `last`,
// and the current one (reset 2030-03-01) runs at 20 credits a day. The advisor treats the 2000-credit limit as a Pro+ hint and finds Pro cheaper.
const HINT_RESETS=['2030-01-01T00:00:00Z','2030-02-01T00:00:00Z','2030-03-01T00:00:00Z'];
const hintData=(env:ReturnType<typeof communityEnv>,o:{last?:number;currentDays?:number;withFirst?:boolean;limit?:number}={})=>{
 const {last=600,currentDays=23,withFirst=true,limit=2000}=o;
 const lines=[
  ...(withFirst?[budgetLine('2029-12-30 00:00:00.000',100,limit,HINT_RESETS[0]),budgetLine('2029-12-31 00:00:00.000',200,limit,HINT_RESETS[0])]:[]),
  budgetLine('2030-01-01 06:00:00.000',20,limit,HINT_RESETS[1]),budgetLine('2030-01-15 00:00:00.000',last/2,limit,HINT_RESETS[1]),budgetLine('2030-01-31 12:00:00.000',last,limit,HINT_RESETS[1]),
  ...Array.from({length:currentDays},(_,d)=>budgetLine(`2030-02-${String(d+1).padStart(2,'0')} 06:00:00.000`,d*20,limit,HINT_RESETS[2])),
 ];
 writeFileSync(budgetLogPath(env),lines.join(''));
};
const RIGHTSIZE_TEXT=/^If you are on Pro\+: You will likely leave about \d+ credits unused this cycle, and the last cycle also fit within Pro\. Pro would cost about \$20 a month less \(modelled\)\.$/;

test('packaged right-sizing hint: shown in the credit view whenever it holds, as a notice only in the last week, once per cycle',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-rightsize-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,false);
  const start=async()=>{const s=await communitySession(env,work);open.push(s);return s;};
  const wipe=()=>{env.infos.length=0;env.atShow.length=0;env.executed.length=0;env.updates.length=0;env.written.length=0;env.timers.length=0;env.panels.length=0;rmSync(env.globalStorage,{recursive:true,force:true});env.store.clear();env.choice=undefined;env.budget=undefined;env.budgetPercent=undefined;};
  const detail=async(s:Awaited<ReturnType<typeof start>>)=>{await s.commands.get('cyclegauge.showUsage')!();return env.panels.at(-1).webview.html as string;};
  const lineIn=(html:string)=>html.match(/<p class="small overage">(If you are on Pro\+: You will likely[^<]*)<\/p>/)?.[1];
  // 6 days before the reset: the notice and the line.
  wipe();hintData(env);env.now='2030-02-23T06:30:00Z';let s=await start();await until(()=>env.infos.length>0);await s.later();
  assert.equal(budgetInfos(env).length,1);assert.match(budgetInfos(env)[0]!.text,RIGHTSIZE_TEXT);
  const stored=env.store.get(BUDGET_KEY) as {cycle:string;done:string[]};assert.deepEqual(stored.done,['rightsize']);assert.equal(Date.parse(stored.cycle),Date.parse(HINT_RESETS[2]!));assert.deepEqual(env.atShow,[stored]);
  assert.match(lineIn(await detail(s))??'',RIGHTSIZE_TEXT);s.dispose();
  // Once per cycle: a later window shows the line but no second notice.
  env.infos.length=0;s=await start();await s.later();await s.later();assert.deepEqual(budgetInfos(env),[]);assert.match(lineIn(await detail(s))??'',RIGHTSIZE_TEXT);s.dispose();
  // Setting off: no notice, the line stays (it is part of the credit view).
  wipe();hintData(env);env.budget=false;s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);assert.match(lineIn(await detail(s))??'',RIGHTSIZE_TEXT);s.dispose();
  // 13 days before the reset: no notice yet, but the line is already there.
  wipe();hintData(env,{currentDays:15});env.now='2030-02-15T06:30:00Z';s=await start();await s.later();await s.later();assert.deepEqual(budgetInfos(env),[]);assert.equal(env.store.has(BUDGET_KEY),false);assert.match(lineIn(await detail(s))??'',RIGHTSIZE_TEXT);s.dispose();
  // The last cycle ended above the smaller plan's 1000 credits, or there is no completed cycle with backed usage: nothing, no line.
  for(const o of [{last:1200},{withFirst:false}]){wipe();hintData(env,o);env.now='2030-02-23T06:30:00Z';s=await start();await s.later();await s.later();assert.deepEqual(budgetInfos(env),[],JSON.stringify(o));assert.equal(lineIn(await detail(s)),undefined,JSON.stringify(o));s.dispose();}
  // Not Kiro (with a chosen source): the line is part of the view, but there is no notice and nothing is stored.
  wipe();hintData(env);env.appName='Visual Studio Code';env.uriScheme='vscode';env.sourceRoot=join(env.source);s=await start();await s.later();await s.later();assert.deepEqual(env.infos,[]);assert.equal(env.store.has(BUDGET_KEY),false);assert.match(lineIn(await detail(s))??'',RIGHTSIZE_TEXT);s.dispose();env.appName='Kiro';env.uriScheme='kiro';
  assert.ok(env.written.every(k=>k===BUDGET_KEY||k===RECAP_KEY||COMMUNITY_KEYS.includes(k)),env.written.join());
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged next-larger-plan comparison: beside the projected overage and on the forecast notice, with list-price facts only',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-larger-plan-')));
 const open:{dispose():void}[]=[];
 try{
  const env=communityEnv(work,false);env.now='2030-01-08T00:30:00Z';
  const wipe=()=>{env.infos.length=0;env.panels.length=0;env.timers.length=0;rmSync(env.globalStorage,{recursive:true,force:true});env.store.clear();env.choice=undefined;};
  const run=async(limit:number,perDay:number,notice=true)=>{
   wipe();writeFileSync(budgetLogPath(env),[0,1,2,3,4,5,6,7].map(i=>budgetLine(`2030-01-0${i+1} 00:00:00.000`,i*perDay,limit)).join(''));
   const s=await communitySession(env,work);open.push(s);if(notice)await until(()=>env.infos.length>0);await s.later();await s.later();
   await s.commands.get('cyclegauge.showUsage')!();const html:string=env.panels.at(-1).webview.html;s.dispose();
   return {notice:budgetInfos(env)[0]?.text??'',html};
  };
  const COST=/ \(about \$[\d.]+ over the limit, modelled\)\./;
  // A 1000-credit account (a Pro hint) at 50 credits a day is forecast to pass its limit.
  const pro=await run(1000,50);
  assert.match(pro.notice,/^At this pace your Kiro credits run out on /);assert.match(pro.notice,COST);
  assert.ok(pro.notice.endsWith(' For comparison, if you are on Pro: Pro+ costs $20 a month more and includes 1000 more credits.'),pro.notice);
  const lines=[...pro.html.matchAll(/<p class="small overage">([^<]*)<\/p>/g)].map(m=>m[1]!);
  assert.equal(lines.length,2);assert.match(lines[0]!,/^At this pace by the reset: about \d+ credits over/);
  assert.equal(lines[1],'For comparison, if you are on Pro: Pro+ costs $20 a month more than Pro and includes 1000 more credits (list prices, price list reviewed 18 Oct 2026).');
  assert.ok(!/save|cheaper|recommend|switch/i.test(lines[1]!+pro.notice.slice(pro.notice.indexOf('For comparison'))));
  // The largest plan has nothing larger; an account whose limit matches no plan has no known plan.
  for(const [limit,perDay] of [[10000,500],[100,10]] as const){
   const other=await run(limit,perDay);
   assert.match(other.notice,/^At this pace your Kiro credits run out on /);assert.ok(!other.notice.includes('For comparison')&&!other.html.includes('For comparison'),String(limit));
   assert.match(other.html,/At this pace by the reset: about \d+ credits over/);
  }
  // Without a projected overage there is no line (and no notice).
  const calm=await run(1000,5,false);assert.equal(calm.notice,'');assert.ok(!calm.html.includes('For comparison'));
 }finally{for(const o of open)o.dispose();rmSync(work,{recursive:true,force:true});}
});

// "Your Kiro cycle": the recap card, its state key, and the image / CSV / clipboard actions of the packaged bundle with an invented source.
const RECAP_KEY='cyclegauge.recap.v1';
const recapLine=(when:string,usage:number,reset:string)=>`${when} [info] synthetic-envelope `+JSON.stringify({commandName:'GetUsageLimitsCommand',input:{},output:{userInfo:{userId:'synthetic-bundle-account'},nextDateReset:reset,usageBreakdownList:[{resourceType:'CREDIT',unit:'INVOCATIONS',currentUsageWithPrecision:usage,usageLimitWithPrecision:1000,nextDateReset:reset,bonuses:[],overageCredits:[]}]},metadata:{httpStatusCode:200}})+'\n';
const recapEnv=(work:string)=>{
 const env=communityEnv(work,false);env.now='2030-07-02T00:00:00Z';
 const R0='2030-06-01T00:00:00Z',R1='2030-07-01T00:00:00Z',R2='2030-08-01T00:00:00Z';
 writeFileSync(join(env.source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent','q-client.log'),recapLine('2030-05-20 00:00:00.000',100,R0)+recapLine('2030-06-01 06:00:00.000',30,R1)+recapLine('2030-06-10 00:00:00.000',300,R1)+recapLine('2030-06-30 20:00:00.000',900,R1)+recapLine('2030-07-01 06:00:00.000',10,R2));
 mkdirSync(join(work,'synthetic-home','Downloads'),{recursive:true});mkdirSync(join(work,'synthetic-out'),{recursive:true});
 return env;
};
const waitFor=async(check:()=>boolean,s:{later():Promise<void>})=>{for(let i=0;i<300&&!check();i++)await new Promise(r=>setTimeout(r,10));await s.later();};
const readyPanel=async(s:any,env:ReturnType<typeof communityEnv>)=>{
 await s.commands.get('cyclegauge.showUsage')!();await s.later();
 const load=Number(/data-cg-load="(\d+)"/.exec(env.panels.at(-1).webview.html)![1]);env.receive({type:'ready',load});await s.later();
};
const results=(env:ReturnType<typeof communityEnv>)=>env.posted.filter((m:any)=>m.type==='actionResult').map((m:any)=>`${m.action}:${m.code}`);

test('packaged recap card appears once, is marked shown, copies its own text and is dismissed through the validated key',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-recap-card-')));let s:any;
 try{
  const env=recapEnv(work);s=await communitySession(env,work);
  await s.commands.get('cyclegauge.showUsage')!();await s.later();
  const html:string=env.panels.at(-1).webview.html;
  assert.match(html,/<h2 id="recap-title">Your Kiro cycle<\/h2>/);assert.match(html,/Credits used: 900 of 1000 reported credits/);assert.match(html,/Busiest observed day \(partial observation\)/);
  assert.deepEqual(env.store.get(RECAP_KEY),{cycle:'2030-08-01T00:00:00.000Z',state:'shown'});
  assert.equal(env.written.filter(k=>k===RECAP_KEY).length,1,'written once');
  assert.ok(!/<[a-z][^>]*\sstyle\s*=/i.test(html),'no style attribute on any element');
  for(const marker of [work,'synthetic-bundle-account','partition'])assert.ok(!JSON.stringify(env.store.get(RECAP_KEY)).includes(marker));
  const load=Number(/data-cg-load="(\d+)"/.exec(html)![1]);env.receive({type:'ready',load});await s.later();
  // Copy text: built by the extension from the card, never from the page.
  env.receive({type:'copyRecapText'});await waitFor(()=>env.clipboard.length>0,s);
  assert.equal(env.clipboard.length,1);assert.match(env.clipboard[0]!,/^Your Kiro cycle\nCycle that ended 1 Jul 2030 \(UTC\)\./);assert.match(env.clipboard[0]!,/Cyclegauge for Kiro IDE: https:\/\/open-vsx\.org\/extension\/StefanSuess\/cyclegauge$/);
  assert.ok(!env.clipboard[0]!.includes(work));assert.deepEqual(results(env),['copyRecapText:copied']);
  // Dismiss writes only the validated shape, and the card is gone from the next page.
  s.advance();env.receive({type:'dismissRecap'});await waitFor(()=>(env.store.get(RECAP_KEY) as any)?.state==='dismissed',s);
  assert.deepEqual(env.store.get(RECAP_KEY),{cycle:'2030-08-01T00:00:00.000Z',state:'dismissed'});assert.ok(results(env).includes('dismissRecap:dismissed'));
  await s.commands.get('cyclegauge.showUsage')!();await s.later();assert.ok(!env.panels.at(-1).webview.html.includes('id="recap-card"'));
  env.receive({type:'ready',load:Number(/data-cg-load="(\d+)"/.exec(env.panels.at(-1).webview.html)![1])});await s.later();
  s.advance();env.receive({type:'copyRecapText'});await waitFor(()=>results(env).includes('copyRecapText:unavailable'),s);assert.ok(results(env).includes('copyRecapText:unavailable'));
  // The explicit reset clears the key; the card returns the next time it is evaluated.
  await s.commands.get('cyclegauge.support.reset')!();assert.equal(env.store.has(RECAP_KEY),false);
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged recap leaves an unreadable stored value untouched and shows no card; the link follows the support switch',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-recap-unknown-')));let s:any;
 try{
  const env=recapEnv(work);env.store.set(RECAP_KEY,{v:2,cycle:'x'});s=await communitySession(env,work);
  await s.commands.get('cyclegauge.showUsage')!();await s.later();
  assert.ok(!env.panels.at(-1).webview.html.includes('id="recap-card"'));assert.deepEqual(env.store.get(RECAP_KEY),{v:2,cycle:'x'});assert.equal(env.written.includes(RECAP_KEY),false);
  const load=Number(/data-cg-load="(\d+)"/.exec(env.panels.at(-1).webview.html)![1]);env.receive({type:'ready',load});await s.later();
  env.receive({type:'dismissRecap'});await s.later();assert.deepEqual(env.store.get(RECAP_KEY),{v:2,cycle:'x'},'dismissing never overwrites it');
  s.dispose();
  const root2=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-recap-link-')));
  try{
   const env2=recapEnv(root2);env2.prompts=false;s=await communitySession(env2,root2);
   await s.commands.get('cyclegauge.showUsage')!();await s.later();
   assert.match(env2.panels.at(-1).webview.html,/id="recap-card"/);assert.ok(!env2.panels.at(-1).webview.html.includes('Cyclegauge for Kiro IDE: https://'));
  }finally{s?.dispose();rmSync(root2,{recursive:true,force:true});}
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged CSV export and image save write only after a dialog, refuse guarded targets and never touch Kiro or storage folders',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-recap-save-')));let s:any;
 try{
  const env=recapEnv(work);s=await communitySession(env,work);await readyPanel(s,env);
  const downloads=join(env.home,'Downloads'),out=join(work,'synthetic-out');
  const png=Buffer.from(await encodePng(new Uint8Array(CARD_WIDTH*CARD_HEIGHT*4).fill(255),async raw=>new Uint8Array(deflateSync(raw))));
  const act=async(message:object)=>{s.advance();const before=results(env).length;env.receive(message);await waitFor(()=>results(env).length>before,s);return results(env).at(-1);};
  // Dialog opens at a fixed name in Downloads; cancelling writes nothing.
  env.saveTo=undefined;assert.equal(await act({type:'exportCsv'}),'exportCsv:cancelled');
  assert.equal(env.dialogs.at(-1)!.defaultPath,join(downloads,'cyclegauge-credit-history.csv'));assert.deepEqual(env.dialogs.at(-1)!.filters,{'CSV file':['csv']});
  assert.deepEqual(readdirSync(downloads),[]);
  // A normal target receives the exact CSV: header, one row per snapshot, no identifier.
  env.saveTo=join(out,'history.csv');assert.equal(await act({type:'exportCsv'}),'exportCsv:saved');
  const csv=readFileSync(env.saveTo,'utf8').split('\r\n');
  assert.equal(csv[0],'observed_at_source,observed_at_utc,credits_used,credit_limit,reset_at_utc,flags,conflict');assert.equal(csv.length,7);
  assert.match(csv[1]!,/^2030-05-20 00:00:00\.000,2030-05-20T00:00:00\.000Z,100,1000,2030-06-01T00:00:00\.000Z,assumed_source_timezone,no$/);
  assert.ok(!readFileSync(env.saveTo,'utf8').includes('synthetic-bundle-account'));
  // Guarded targets: Cyclegauge storage, the configured Kiro source, a .kiro folder, a link and a directory are refused and nothing is written there.
  mkdirSync(env.globalStorage,{recursive:true});mkdirSync(join(work,'synthetic-home','.kiro'),{recursive:true});writeFileSync(join(out,'victim.txt'),'synthetic-victim');
  mkdirSync(join(work,'editor','logs','synthetic-session'),{recursive:true});mkdirSync(join(work,'synthetic-home','.ssh'),{recursive:true});
  const refused:string[]=[join(env.globalStorage,'x.csv'),join(work,'editor','User','x.csv'),join(work,'editor','logs','synthetic-session','x.csv'),join(env.source,'x.csv'),join(work,'synthetic-home','.kiro','x.csv'),join(work,'synthetic-home','.ssh','x.csv'),out];
  if(process.platform!=='win32'){symlinkSync(join(out,'victim.txt'),join(out,'link.csv'));refused.push(join(out,'link.csv'));}
  for(const target of refused){env.saveTo=target;assert.equal(await act({type:'exportCsv'}),'exportCsv:refused_target',target);}
  assert.equal(readFileSync(join(out,'victim.txt'),'utf8'),'synthetic-victim');assert.equal(existsSync(join(env.globalStorage,'x.csv')),false);assert.equal(existsSync(join(env.source,'x.csv')),false);
  assert.deepEqual(readdirSync(out).filter(n=>n.endsWith('.tmp')),[]);
  // Image: validated before any dialog, written only after one.
  const dialogs=env.dialogs.length;
  assert.equal(await act({type:'saveRecapImage',png:'AAAA'}),'saveRecapImage:invalid_image');assert.equal(env.dialogs.length,dialogs,'an invalid image never opens the dialog');
  const bad=Buffer.from(png);bad[40]=bad[40]!^1;assert.equal(await act({type:'saveRecapImage',png:bad.toString('base64')}),'saveRecapImage:invalid_image');
  env.saveTo=join(out,'card.png');assert.equal(await act({type:'saveRecapImage',png:png.toString('base64')}),'saveRecapImage:saved');
  assert.deepEqual(readFileSync(env.saveTo),png);assert.equal(env.dialogs.at(-1)!.defaultPath,join(downloads,'cyclegauge-cycle-recap.png'));
  env.saveTo=join(env.source,'card.png');assert.equal(await act({type:'saveRecapImage',png:png.toString('base64')}),'saveRecapImage:refused_target');
  // The failure of the clipboard is a fixed code, not a message.
  env.clipboardFails=true;assert.equal(await act({type:'copyRecapText'}),'copyRecapText:failed');assert.ok(!JSON.stringify(env.posted).includes('synthetic-path'));
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});

test('packaged export is refused with a fixed reason for more than one account and nothing is written',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-recap-accounts-')));let s:any;
 try{
  const env=recapEnv(work);
  const log=join(env.source,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent','q-client.log');
  writeFileSync(log,readFileSync(log,'utf8')+recapLine('2030-07-01 07:00:00.000',5,'2030-08-01T00:00:00Z').replace('synthetic-bundle-account','synthetic-second-account'));
  s=await communitySession(env,work);await readyPanel(s,env);
  env.saveTo=join(work,'synthetic-out','history.csv');s.advance();env.receive({type:'exportCsv'});await waitFor(()=>results(env).length>0,s);
  assert.deepEqual(results(env),['exportCsv:multiple_accounts']);assert.equal(env.dialogs.length,0);assert.equal(existsSync(env.saveTo),false);
  assert.ok(!/id="recap-card"/.test(env.panels.at(-1).webview.html),'no recap across accounts');
 }finally{s?.dispose();rmSync(work,{recursive:true,force:true});}
});
