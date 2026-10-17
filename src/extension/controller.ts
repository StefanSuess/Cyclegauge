import { Store } from '../store.ts';
import { collect } from '../collector.ts';
import { view } from '../view.ts';
import { present } from './presentation.ts';
import {calculateCosts,type NativeCostInput} from './cost-inputs.ts';
import {AdvisorInputs,reviewAdvisor} from './advisor-inputs.ts';
import {presentAdvisor} from './advisor-presentation.ts';
import {planHint,advisorProfile,classifyAdvice} from '../cost/advisor.ts';
import {reviewedCatalog} from '../cost/catalog.ts';

export interface ExtensionUi {
 setStatus(text: string, detail: string, meta?: { tooltip: string; warning: boolean }): void;
 showDetails(detail: string): void;
 onClick(callback: () => void): void;
 onChange(callback: () => void): void;
 everyMinute(callback: () => void): void;
 costInput?: NativeCostInput;
 onCostCommand?(id: 'advisor', callback: () => Promise<void>): void;
 dispose(): void;
}
export interface ExtensionOptions { source: string; storage: string; profileStorage?: boolean; timezone: string; now?: () => string; maxAgeHours?: number }

export async function startExtension(ui: ExtensionUi, options: ExtensionOptions) {
 let store: Store | undefined;
 let disposed = false;
 let detail = '';
 let running: Promise<void> | undefined;
 const advisor=new AdvisorInputs();
 let observation= view([],(options.now ?? (() => new Date().toISOString()))());
 let codes:string[]=[];
 const now=()=> (options.now ?? (() => new Date().toISOString()))();
 const render=()=>{
  let advisorHtml:string;
  try{
   const hint=planHint(observation.baseLimit,reviewedCatalog);
   const built=advisorProfile({limit:observation.baseLimit,usage:observation.usage,asOf:observation.forecast.asOf??null,resetAt:observation.forecast.resetAt??null},advisor.value,hint);
   const horizons=built.profile?calculateCosts({mode:'personalized',profile:built.profile,monthlyCredits:'0',beforeReset:undefined,demandMode:'forecast'},observation.forecast,observation.history,now()):[];
   advisorHtml=presentAdvisor({hint,context:built.context,horizons,advice:horizons.map(h=>classifyAdvice(h.result,built.context)),singleAccount:advisor.isSingleAccount,limit:observation.baseLimit});
  }catch{
   advisorHtml=presentAdvisor({hint:{plan:null,confidence:'none',reasons:[]},context:{planSource:'unknown',plan:null,billingConfirmed:false,addOns:'unknown',assumptions:[]},horizons:[],advice:[],singleAccount:advisor.isSingleAccount,failed:true,limit:null});
  }
  const presentation=present(observation,codes,'',advisorHtml);
  detail=presentation.html;
  if(!disposed)ui.setStatus(presentation.text,detail,presentation);
 };
 const refresh = async () => {
  if (disposed) return;
  if (running) return running;
  running = (async () => {
   try {
    store ??= new Store(options.storage, options.source, options.profileStorage);
    const now = (options.now ?? (() => new Date().toISOString()))();
    const imported = await collect(options.source, store, options.timezone, now);
    const snapshots=store.snapshots();
    observation = view(snapshots, now, options.maxAgeHours ?? 24);
    const partitions=new Set(snapshots.map(s=>s.partition));
    const single=partitions.size===1&&snapshots.every(s=>s.associated)&&observation.status!=='conflicting_snapshots';
    advisor.observe(single?snapshots[0].partition:null,single?'single':snapshots.length?'ambiguous':'unavailable');
    codes=Object.keys(imported.codes);
    render();
   } catch (e) {
    // Only two fixed codes are surfaced; everything else stays the generic 'unavailable'.
    const message=(e as Error)?.message;
    const code=message==='RUNTIME_UNSUPPORTED'?'runtime_unsupported':message==='STORAGE_NEWER'?'storage_newer':'unavailable';
    advisor.observe(null,'unavailable');
    observation=view([],now());codes=[code];render();
   }
  })();
  try { await running; } finally { running = undefined; }
 };
 const review=async()=>{
  if(disposed||!ui.costInput)return;
  await refresh();if(disposed)return;
  const ticket=advisor.begin();
  try{
   const value=await reviewAdvisor(ui.costInput,planHint(observation.baseLimit,reviewedCatalog),advisor.value);
   if(!value||disposed)return;
   await refresh();if(disposed)return;
   if(advisor.commit(ticket,value)){render();ui.showDetails(detail);}
  }catch{/* Native input failures never expose answers or affect the budget. */}
 };
 ui.onCostCommand?.('advisor',review);
 ui.onClick(() => ui.showDetails(detail));
 ui.onChange(() => { void refresh(); });
 ui.everyMinute(() => { void refresh(); });
 await refresh();
 return { refresh, dispose() { if (disposed) return; disposed = true; advisor.clear(); store?.close(); ui.dispose(); } };
}
