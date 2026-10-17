import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync} from 'node:fs';
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
  const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ThemeColor:class{},Uri:{file:(fsPath:string)=>({fsPath})},RelativePattern:class{},extensions:{getExtension:()=>undefined},
   commands:{registerCommand(id:string,fn:()=>unknown){commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
   workspace:{getConfiguration:()=>({get:(key:string)=>({sourceRoot:source,storageRoot:storage,sourceTimezone:'UTC'} as any)[key]??''}),createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
   window:{createStatusBarItem(){const item={text:'',command:'',visible:false,show(){this.visible=true;},hide(){this.visible=false;},dispose(){this.visible=false;}};items.push(item);return item;},
    createWebviewPanel(_type:string,_title:string,_column:number,o:any){options=o;panel={visible:true,webview:{html:''},reveal(){this.visible=true;visibility({webviewPanel:this});},onDidDispose(fn:()=>void){disposed=fn;return disposable;},onDidChangeViewState(fn:(e:any)=>void){visibility=fn;return disposable;},dispose(){disposed();}};return panel;},
    async showQuickPick(choices:any[]){const id=answers.shift();return choices.find(i=>i.id===id);},async showInputBox(){return undefined;},async showWarningMessage(){throw new Error('synthetic-unexpected-warning');}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  const fixedNow=Date.parse('2030-01-04T00:00:00Z');
  class SyntheticDate extends Date {constructor(...args:any[]){super(args.length?args[0]:fixedNow);}static now(){return fixedNow;}}
  const module={exports:{} as any};
  runInThisContext(`(function(require,module,exports,Date){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports,SyntheticDate);
  extension=module.exports;await extension.activate({subscriptions});
  assert.deepEqual([...commands.keys()].sort(),['cyclegauge.auditWorkspace','cyclegauge.costAdvisor','cyclegauge.showUsage']);
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

// The audit command is registered before the collector starts, so a failing start leaves it available. It runs only on invocation.
test('packaged audit command survives a failing start, refuses untrusted workspaces and audits a synthetic folder',async()=>{
 const work=realpathSync.native(mkdtempSync(join(tmpdir(),'synthetic-audit-bundle-')));
 const subscriptions:any[]=[];let extension:any;
 try{
  const source=join(work,'source'),workspace=join(work,'synthetic-workspace');
  mkdirSync(join(source,'logs'),{recursive:true});mkdirSync(join(workspace,'dist'),{recursive:true});mkdirSync(join(work,'synthetic-owned','x'),{recursive:true});
  writeFileSync(join(workspace,'.env'),'SYNTHETIC_CONTENT_SENTINEL');writeFileSync(join(workspace,'.kiroignore'),'/ignored.log\n');writeFileSync(join(workspace,'dist','synthetic.js'),'x');
  const bundle=await builtBundle(work);
  const commands=new Map<string,()=>unknown>(),errors:string[]=[],warnings:string[]=[],infos:string[]=[],clipboard:string[]=[],panels:any[]=[];let trusted=false,folderPath=workspace,gate:Promise<void>|undefined,failProgress=false;
  const disposable={dispose(){}};
  const vscode={StatusBarAlignment:{Right:2},ViewColumn:{One:1},ProgressLocation:{Notification:15},ThemeColor:class{},Uri:{file:(fsPath:string)=>({fsPath})},RelativePattern:class{},extensions:{getExtension:()=>undefined},
   // Every other command fails to register, which makes startExtension throw and exercises the fallback path.
   commands:{registerCommand(id:string,fn:()=>unknown){if(id!=='cyclegauge.auditWorkspace')throw new Error('synthetic-register-failure');commands.set(id,fn);return {dispose(){commands.delete(id);}};}},
   env:{clipboard:{async writeText(t:string){clipboard.push(t);}}},
   workspace:{get isTrusted(){return trusted;},get workspaceFolders(){return [{name:'synthetic-workspace',uri:{scheme:'file',fsPath:folderPath}}];},
    getConfiguration:(section:string)=>({get:(key:string)=>section==='kiroAgent'?(key==='agentIgnoreFiles'?['.kiroignore']:undefined):({sourceRoot:source,storageRoot:join(work,'synthetic-owned'),sourceTimezone:'UTC'} as any)[key]??''}),
    createFileSystemWatcher:()=>({onDidCreate:()=>disposable,onDidChange:()=>disposable,onDidDelete:()=>disposable,dispose(){}})},
   window:{createStatusBarItem(){return {text:'',show(){},hide(){},dispose(){}};},
    createWebviewPanel(type:string,title:string,_column:number,o:any){const p={type,title,options:o,webview:{html:''},reveal(){},onDidDispose(){return disposable;},dispose(){}};panels.push(p);return p;},
    async showWarningMessage(m:string){warnings.push(m);},async showErrorMessage(m:string){errors.push(m);},
    async showInformationMessage(m:string){infos.push(m);return 'Copy suggestions';},
    async withProgress(_o:any,task:(p:unknown,t:unknown)=>Promise<unknown>){await gate;if(failProgress)throw new Error('synthetic-progress-failure /private/synthetic-path');return task({},{onCancellationRequested:()=>disposable});}}};
  const require=createRequire(new URL('../../package.json',import.meta.url));
  const module={exports:{} as any};
  runInThisContext(`(function(require,module,exports){${bundle}\n})`)((id:string)=>id==='vscode'?vscode:require(id),module,module.exports);
  extension=module.exports;await extension.activate({subscriptions,globalStorageUri:{fsPath:join(work,'global')}});
  assert.deepEqual([...commands.keys()],['cyclegauge.auditWorkspace']);
  await commands.get('cyclegauge.auditWorkspace')!();
  assert.deepEqual(warnings,['Cyclegauge audits only trusted workspaces.']);assert.equal(panels.length,0);
  trusted=true;await commands.get('cyclegauge.auditWorkspace')!();
  assert.equal(panels.length,1);assert.equal(panels[0].type,'cyclegauge.audit');assert.equal(panels[0].title,'Workspace audit');
  assert.deepEqual(panels[0].options,{enableScripts:false,enableCommandUris:false,localResourceRoots:[]});
  const html:string=panels[0].webview.html;assert.match(html,/Workspace audit/);assert.ok(html.includes('.env'));assert.ok(html.includes('dist'));
  assert.ok(!html.includes(work));assert.ok(!html.includes('SYNTHETIC_CONTENT_SENTINEL'));assert.ok(!/<script/.test(html));
  assert.deepEqual(infos,['Workspace audit: 2 findings.']);assert.equal(clipboard.length,1);assert.ok(clipboard[0]!.includes('/.env\n')||clipboard[0]!.endsWith('/.env'));assert.ok(clipboard[0]!.includes('/dist/'));
  assert.ok(!clipboard[0]!.includes(work)&&!clipboard[0]!.includes('SYNTHETIC_CONTENT_SENTINEL'));
  // A second invocation while one is in progress is declined; the lock is released afterwards.
  let release:()=>void=()=>{};gate=new Promise<void>(r=>{release=r;});infos.length=0;panels.length=0;
  const first=commands.get('cyclegauge.auditWorkspace')!();await new Promise(r=>setImmediate(r));
  await commands.get('cyclegauge.auditWorkspace')!();assert.deepEqual(infos,['A workspace audit is already running.']);
  release();await first;gate=undefined;assert.equal(infos.length,2);assert.equal(panels.length,0); // the existing panel is reused
  // Folders overlapping the configured source or storage roots are refused, and nothing is audited.
  infos.length=0;panels.length=0;warnings.length=0;
  for(const path of [source,join(source,'logs'),join(work,'synthetic-owned','x'),join(work,'synthetic-missing')]){
   folderPath=path;await commands.get('cyclegauge.auditWorkspace')!();
  }
  assert.deepEqual(warnings,["This folder can't be audited: it overlaps Kiro data.","This folder can't be audited: it overlaps Kiro data.","This folder can't be audited: it overlaps Cyclegauge storage.","This folder can't be audited: its real location could not be resolved."]);
  assert.equal(panels.length,0);assert.deepEqual(infos,[]);
  // Any failure becomes one fixed message, and the lock is released.
  folderPath=workspace;failProgress=true;await commands.get('cyclegauge.auditWorkspace')!();failProgress=false;
  assert.deepEqual(errors,['The workspace audit failed.']);panels.length=0;infos.length=0;await commands.get('cyclegauge.auditWorkspace')!();assert.deepEqual(infos,['Workspace audit: 2 findings.']);
  warnings.length=0;trusted=false;for(const d of subscriptions)d.dispose();assert.equal(commands.size,0);
 }finally{extension?.deactivate();for(const d of subscriptions)d.dispose();rmSync(work,{recursive:true,force:true});}
});
