import { Store } from '../store.ts';
import { collect } from '../collector.ts';
import { view } from '../view.ts';
import { present } from './presentation.ts';
import {CostInputs,configureCostInputs,editCostInputs,calculateCosts,type NativeCostInput} from './cost-inputs.ts';
import {presentCostSection} from './cost-presentation.ts';

export interface ExtensionUi {
 setStatus(text: string, detail: string, meta?: { tooltip: string; warning: boolean }): void;
 showDetails(detail: string): void;
 onClick(callback: () => void): void;
 onChange(callback: () => void): void;
 everyMinute(callback: () => void): void;
 costInput?: NativeCostInput;
 onCostCommand?(id: 'configure'|'edit'|'clear', callback: () => Promise<void>): void;
 dispose(): void;
}
export interface ExtensionOptions { source: string; storage: string; timezone: string; now?: () => string; maxAgeHours?: number }

export async function startExtension(ui: ExtensionUi, options: ExtensionOptions) {
 let store: Store | undefined;
 let disposed = false;
 let detail = '';
 let running: Promise<void> | undefined;
 const inputs=new CostInputs();
 let observation= view([],(options.now ?? (() => new Date().toISOString()))());
 let codes:string[]=[];
 const now=()=> (options.now ?? (() => new Date().toISOString()))();
 const render=()=>{
  const input=inputs.value;
  let costHtml:string;
  try{costHtml=presentCostSection(input,input?calculateCosts(input,observation.forecast,observation.history,now()):[]);}
  catch{costHtml=presentCostSection(input,[],true);}
  const presentation=present(observation,codes,costHtml);
  detail=presentation.html;
  if(!disposed)ui.setStatus(presentation.text,detail,presentation);
 };
 const refresh = async () => {
  if (disposed) return;
  if (running) return running;
  running = (async () => {
   try {
    store ??= new Store(options.storage, options.source);
    const now = (options.now ?? (() => new Date().toISOString()))();
    const imported = await collect(options.source, store, options.timezone, now);
    const snapshots=store.snapshots();
    observation = view(snapshots, now, options.maxAgeHours ?? 24);
    const partitions=new Set(snapshots.map(s=>s.partition));
    const single=partitions.size===1&&snapshots.every(s=>s.associated)&&observation.status!=='conflicting_snapshots';
    inputs.observe(single?snapshots[0].partition:null,single?'single':snapshots.length?'ambiguous':'unavailable');
    codes=Object.keys(imported.codes);
    render();
   } catch (e) {
    inputs.observe(null,'unavailable');
    // Only these allowlisted failures are distinguished; every other failure stays generic.
    observation=view([],now());const known:Record<string,string>={RUNTIME_UNSUPPORTED:'runtime_unsupported',STORAGE_PERMISSIONS_UNSUPPORTED:'storage_permissions_unsupported'},message=String((e as Error)?.message);codes=[Object.hasOwn(known,message)?known[message]:'unavailable'];render();
   }
  })();
  try { await running; } finally { running = undefined; }
 };
 const edit=async(command:'configure'|'edit'|'clear')=>{
  if(disposed)return;
  if(command==='clear'){inputs.clear();render();return;}
  if(!ui.costInput)return;
  // Revalidate account context before opening an editor and again before attaching it.
  await refresh();if(disposed)return;
  const ticket=inputs.begin(),current=inputs.value;
  try{
   const value=command==='configure'||!current?await configureCostInputs(ui.costInput,now()):await editCostInputs(ui.costInput,current,now());
   if(!value||disposed)return;
   await refresh();if(disposed)return;
   if(inputs.commit(ticket,value)){render();ui.showDetails(detail);}
  }catch{/* Native input failures never expose input values or affect the budget. */}
 };
 for(const command of ['configure','edit','clear'] as const)ui.onCostCommand?.(command,()=>edit(command));
 ui.onClick(() => ui.showDetails(detail));
 ui.onChange(() => { void refresh(); });
 ui.everyMinute(() => { void refresh(); });
 await refresh();
 return { refresh, dispose() { if (disposed) return; disposed = true; inputs.clear(); store?.close(); ui.dispose(); } };
}
