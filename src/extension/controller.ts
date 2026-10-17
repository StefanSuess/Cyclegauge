import { Store } from '../store.ts';
import { snapshotFacts, storeStateFor, type DiagnosticsInput, type StoreState } from '../diagnostics.ts';
import { collect } from '../collector.ts';
import { view } from '../view.ts';
import { present } from './presentation.ts';
import type { AuditSummary } from './audit-model.ts';
import {calculateCosts,type NativeCostInput} from './cost-inputs.ts';
import {AdvisorInputs,reviewAdvisor} from './advisor-inputs.ts';
import {presentAdvisor} from './advisor-presentation.ts';
import {planHint,advisorProfile,classifyAdvice} from '../cost/advisor.ts';
import {reviewedCatalog} from '../cost/catalog.ts';
import {estimateSavings} from '../cost/estimate.ts';
import {planInsights,NO_INSIGHTS,type PlanInsights} from '../cost/plan-hints.ts';

export interface ExtensionUi {
 setStatus(text: string, detail: string, meta?: { tooltip: string; warning: boolean; severity?: 'none' | 'warning' | 'error' }): void;
 showDetails(detail: string): void;
 onClick(callback: () => void): void;
 onChange(callback: () => void): void;
 everyMinute(callback: () => void): void;
 costInput?: NativeCostInput;
 onCostCommand?(id: 'advisor', callback: () => Promise<void>): void;
 dispose(): void;
}
export interface ExtensionOptions { source: string; storage: string; profileStorage?: boolean; timezone: string; now?: () => string; maxAgeHours?: number;
 // Counts and times of the workspace check for the detail view's card; read on every render and never allowed to affect the gauge.
 auditSummary?: () => AuditSummary;
 // Not running in Kiro and no source chosen: an empty source is then shown as "Kiro not detected". Default: false (no change).
 notKiro?: boolean;
 // Called when a render shows a provisional or regular forecast; used only for the support prompt and never allowed to affect the gauge.
 onForecast?: () => void;
 // Called when a render shows "Kiro not detected" (notKiro and no source logs); same rules as onForecast.
 onAbsent?: () => void;
 // Called after each render with the latest observation, whether its forecast is fresh and qualified, and the render time; used only for the budget warning and never allowed to affect the gauge.
 onBudget?: (observation: ReturnType<typeof view>, eligible: boolean, now: string, insights: PlanInsights) => void;
 onAdvisorUsed?: () => void }

export async function startExtension(ui: ExtensionUi, options: ExtensionOptions) {
 let store: Store | undefined;
 let disposed = false;
 let detail = '';
 let running: Promise<void> | undefined;
 const advisor=new AdvisorInputs();
 let observation= view([],(options.now ?? (() => new Date().toISOString()))());
 let codes:string[]=[];
 // Latest fixed status for Copy Diagnostics: codes and counts only, never snapshot values or identifiers.
 let facts:{store:StoreState;importCodes:Record<string,number>;snapshots?:number;accounts?:number;unassociated?:number;latestMs?:number}={store:'not_opened',importCodes:{}};
 const now=()=> (options.now ?? (() => new Date().toISOString()))();
 const render=()=>{
  let advisorHtml:string;
  let insights:PlanInsights=NO_INSIGHTS;
  try{
   const hint=planHint(observation.baseLimit,reviewedCatalog);
   const built=advisorProfile({limit:observation.baseLimit,usage:observation.usage,asOf:observation.forecast.asOf??null,resetAt:observation.forecast.resetAt??null},advisor.value,hint);
   const horizons=built.profile?calculateCosts({mode:'personalized',profile:built.profile,monthlyCredits:'0',beforeReset:undefined,demandMode:'forecast'},observation.forecast,observation.history,now()):[];
   const advice=horizons.map(h=>classifyAdvice(h.result,built.context));
   advisorHtml=presentAdvisor({hint,context:built.context,horizons,advice,singleAccount:advisor.isSingleAccount,limit:observation.baseLimit});
   // Read-only reuse of the advisor's 1-month estimate; a failure here never touches the gauge or the advisor view.
   try{insights=planInsights({view:observation,estimate:horizons.length?estimateSavings(horizons[0].result,built.context,advice[0],1):null,planSource:built.context.planSource,plan:built.context.plan,now:now()});}catch{insights=NO_INSIGHTS;}
  }catch{
   advisorHtml=presentAdvisor({hint:{plan:null,confidence:'none',reasons:[]},context:{planSource:'unknown',plan:null,billingConfirmed:false,addOns:'unknown',assumptions:[]},horizons:[],advice:[],singleAccount:advisor.isSingleAccount,failed:true,limit:null});
  }
  let audit:AuditSummary|undefined;
  try{audit=options.auditSummary?.();}catch{audit=undefined;}
  const presentation=present(observation,codes,'',advisorHtml,audit,now(),options.notKiro===true,insights);
  detail=presentation.html;
  if(presentation.forecast)try{options.onForecast?.();}catch{/* the support prompt never affects the gauge */}
  if(presentation.absent)try{options.onAbsent?.();}catch{/* nor the not-Kiro note */}
  if(!disposed)ui.setStatus(presentation.text,detail,presentation);
  if(!disposed&&!presentation.absent)try{options.onBudget?.(observation,presentation.forecast,now(),insights);}catch{/* nor the budget warning */}
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
    // Computed on its own: a failure here can never make the gauge unavailable.
    try{facts={store:'ok',importCodes:{...imported.codes},...snapshotFacts(snapshots)};}catch{facts={store:'ok',importCodes:{}};}
    render();
   } catch (e) {
    // Only two fixed codes are surfaced; everything else stays the generic 'unavailable'.
    const code=storeStateFor(e);
    advisor.observe(null,'unavailable');
    facts={store:code,importCodes:{}};
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
   let reset = false;
   const value=await reviewAdvisor({ ...ui.costInput, async pick(title, items) { const choice = await ui.costInput!.pick(title, items); if (choice === 'reset') reset = true; return choice; } },planHint(observation.baseLimit,reviewedCatalog),advisor.value);
   if(!value||disposed)return;
   await refresh();if(disposed)return;
   if(advisor.commit(ticket,value)){render();ui.showDetails(detail);try{if(!reset)options.onAdvisorUsed?.();}catch{/* support never affects the Advisor */}}
  }catch{/* Native input failures never expose answers or affect the budget. */}
 };
 ui.onCostCommand?.('advisor',review);
 ui.onClick(() => ui.showDetails(detail));
 ui.onChange(() => { void refresh(); });
 ui.everyMinute(() => { void refresh(); });
 await refresh();
 // No IO: the status kept in memory by the last refresh.
 const diagnostics=():DiagnosticsInput=>({store:facts.store,status:observation.status,forecast:observation.forecast.tier,snapshots:facts.snapshots,accounts:facts.accounts,unassociated:facts.unassociated,
  observedAgeMs:facts.latestMs===undefined?null:Date.parse(now())-facts.latestMs,importCodes:facts.importCodes});
 // Re-renders with the current workspace-check summary; no collection and no IO.
 const rerender=()=>{if(!disposed)render();};
 return { refresh, diagnostics, rerender, dispose() { if (disposed) return; disposed = true; advisor.clear(); store?.close(); ui.dispose(); } };
}
