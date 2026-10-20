import type {Advice,AdviceKind,AdvisorContext,PlanHint} from '../cost/advisor.ts';
import {compare} from '../decimal.ts';
import {estimateSavings,formatUsd,type DemandEstimate,type SavingsEstimate} from '../cost/estimate.ts';
import {planNames,type CostHorizon} from './cost-inputs.ts';
import {winnerText,reasonText,presentCost} from './cost-presentation.ts';
import {reviewedCatalog} from '../cost/catalog.ts';

const safe=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export const adviceLabels:Record<AdviceKind,string>={no_action:'No action needed',potential_savings:'Potential savings',conditional_comparison:'Conditional comparison',insufficient_information:'Insufficient information'};
export const tierLabels:Record<SavingsEstimate['tier'],string>={supported:'Supported estimate',modelled:'Modelled estimate',comparison_only:'Cost comparison only',insufficient:'Insufficient information'};
const assumptionText:Record<string,string>={
 plan_is_hint:'Your plan is a hint from the reported credit limit and is not confirmed.',
 plan_not_confirmed:'Your plan is not confirmed.',
 free_not_available_on_enterprise:'Free is not an Enterprise plan, so it was ignored.',
 billing_assumed_consumer:'Personal (consumer) billing is assumed. Enterprise accounts are priced differently.',
 add_ons_unknown:'Purchased add-on credits are unknown or have not been entered.',
 add_ons_assumed_none:'No purchased add-on credits are assumed. Existing add-on credits would lower any purchase cost.',
 add_on_balance_unverified:'Remaining add-on credits were entered by you and are not verified.',
 limit_semantics_unverified:'Kiro may include purchased add-on credits in the reported limit; this has not been verified.',
 usage_exceeds_reported_limit:'Observed usage is above the reported limit, so the plan remainder is unknown (this can happen with overages or purchased credits).',
 limit_differs_from_plan_credits:'The reported limit differs from the chosen plan\'s nominal credits, so it may include other credits and the plan remainder is unknown.',
 enterprise_inputs_unconfirmed:'Enterprise prepaid add-ons, overage permission and headroom are not entered yet; comparisons stay unavailable or conditional.',
 list_prices_pre_tax:'Amounts are bundled list prices in USD before tax. Promotions are excluded. They are not invoices.',
 forecast_not_guaranteed:'The figures assume your usage continues at the forecast. Real usage can differ, so nothing is guaranteed.',
 only_next_reset_changes_compared:'Only keeping your plan or changing plan at the next billing reset is compared. Mid-cycle upgrades are not priced.',
 overall_cheapest_unknown:'Some options could not be priced, so a cheaper option than the lowest calculable one may exist.',
 sensitivity_changes_preferred_plan:'The lowest-cost plan changes with usage (see the sensitivity list).',
 sensitivity_partly_unpriced:'At some usage levels the cost could not be calculated, for example when extra credit purchases cannot be priced yet.',
 free_plan_terms_unverified:'Moving to Free means cancelling the paid plan. Free plan terms for your account were not verified.',
 baseline_cost_unavailable:'The cost of staying on your current plan could not be calculated, so no difference is shown.',
 limited_history:'The forecast is based on limited history.',
 long_history_future_rate:'Full future cycles use the longest qualified pooled-history rate, which can differ from the selected dashboard forecast window.',
 short_window_long_horizon:'Multi-cycle figures extend a short observation window.',
 mid_cycle_upgrade_cheaper:'Upgrading immediately, mid-cycle, is priced lower than keeping your plan; that option is not part of the estimate figure.',
 net_changes_not_gross_billable_usage:'The forecast is based on net changes in the reported counter, not on gross billable usage.',
 sustained_usage_scenario:'Multi-cycle figures repeat the forecast and are sustained-usage scenarios, not predictions.',
};
const usdCost=(d:string)=>`$${safe(formatUsd(d,'up'))}`;
const usdSaving=(d:string)=>`$${safe(formatUsd(d,'down'))}`;
const cycles=(n:number)=>`${n} full billing ${n===1?'cycle':'cycles'}`;
const day=(iso:string)=>safe(iso.slice(0,10));
const summary=(h:CostHorizon,a:Advice)=>{
 const label=adviceLabels[a.kind];
 const body=h.result&&a.kind!=='insufficient_information'
  ?a.kind==='conditional_comparison'?`If the conditions below hold: ${winnerText(h.result)}`:winnerText(h.result)
  :'Not enough confirmed information for a comparison.';
 return `<li><strong>${h.months} full billing ${h.months===1?'cycle':'cycles'}: ${safe(label)}</strong> — ${safe(body)}</li>`;
};
/** One line per horizon, always labelled with its tier so a modelled difference is never read as a confirmed saving. */
function horizonLine(e:SavingsEstimate,fallback:string):string {
 const head=`<strong>${cycles(e.months)}${e.window?` (from ${day(e.window.from)} UTC)`:''}: ${safe(tierLabels[e.tier])}</strong>`;
 const b=e.base;
 if(e.tier==='insufficient'||!b||!b.best)return `<li>${head} — ${safe(fallback)}</li>`;
 const now=b.baseline!==null&&e.baselinePlan?`${safe(planNames[e.baselinePlan])} ${usdCost(b.baseline)}`:'not priced';
 const alt=`${safe(planNames[b.best.plan])} ${usdCost(b.best.cost)}`;
 const diff=b.saving===null?'no difference calculated'
  :e.outcome==='saving'?`modelled difference ${usdSaving(b.saving)}`:'no cheaper option found (difference $0)';
 return `<li>${head} — ${b.best.keep?'staying on':'lowest calculable:'} ${alt}; current plan: ${now}; ${diff}</li>`;
}
function sensitivityLines(e:SavingsEstimate):string {
 const label={low:'75%',base:'100%',high:'125%'};
 const line=(l:DemandEstimate)=>{
  if(!l.best)return `<li><strong>${label[l.demandId]} of forecast usage:</strong> costs could not be calculated at this level.</li>`;
  const now=l.baseline!==null&&e.baselinePlan?`; current plan ${safe(planNames[e.baselinePlan])} ${usdCost(l.baseline)}`:'';
  const diff=l.saving===null?'':l.saving==='0'?'; no cheaper option (difference $0)':`; modelled difference ${usdSaving(l.saving)}`;
  const open=l.unpriced>0?`; ${l.unpriced} option${l.unpriced===1?'':'s'} could not be priced, so this is not a complete comparison`:'';
  return `<li><strong>${label[l.demandId]} of forecast usage:</strong> lowest calculable ${safe(planNames[l.best.plan])} ${usdCost(l.best.cost)}${now}${diff}${open}</li>`;
 };
 return `<ul class="small">${e.levels.map(line).join('')}</ul><p class="muted small">These are demand alternatives, not statistical confidence intervals.</p>`;
}
/** Most useful near-term estimate: the first horizon (next full cycle) that has any calculable figure. */
const headlineOf=(estimates:SavingsEstimate[])=>estimates.find(e=>e.tier!=='insufficient')??null;

/** Headline stays short and qualified; reasons and limits go to `why`, which sits under an expandable detail. */
function estimateCard(e:SavingsEstimate,context:AdvisorContext,limit:string|null):{verdict:string;html:string;why:string} {
 const b=e.base!;const best=b.best!;
 const cur=e.baselinePlan?safe(planNames[e.baselinePlan]):null;
 const target=safe(planNames[best.plan]);
 const confirmed=context.planSource==='confirmed';
 const period=e.window?`from ${day(e.window.from)} UTC, ${e.months} ${e.months===1?'month':'months'}`:'';
 const span=e.months===1?'the next full billing cycle':`the next ${e.months} full billing cycles`;
 const per=e.months===1?'per billing cycle':`over ${e.months} billing cycles`;
 const badge=e.tier==='supported'?'Based on your confirmed details':e.tier==='modelled'?'Based on assumptions':'Costs only';
 const label={low:'75%',base:'100%',high:'125%'};
 // A figure that depends on usage, or whose neighbours could not be priced, is a point estimate, never a stable or complete bound.
 const qualified=e.outcome==='saving'&&!e.stable;
 // The scenario that differs from the 100% forecast: unpriced, another plan, or the same plan with another saving (exact comparison).
 const other=e.levels.find(l=>l.demandId!=='base'&&(l.unpriced>0||!l.best||l.best.plan!==best.plan||l.saving===null||b.saving===null||compare(l.saving,b.saving)!==0));
 const unpriced=e.levels.filter(l=>l.unpriced>0||!l.best);
 const limitLine=qualified&&other?(()=>{
  const higher=other.demandId==='high',pct=label[other.demandId];
  const lost=other.saving===null||compare(other.saving,'0')===0||!other.best||other.best.keep;
  if(other.unpriced>0||!other.best)return higher?`Higher usage may remove it: at ${pct} of forecast usage extra credits on smaller plans cannot be priced.`:`Lower usage changes it: at ${pct} of forecast usage some options could not be priced.`;
  const detail=other.saving!==null?`the modelled saving is ${usdSaving(other.saving)}`:`${safe(planNames[other.best.plan])} is the lowest calculable option`;
  return higher&&lost?`Higher usage may remove it: at ${pct} of forecast usage ${detail}.`:`It depends on usage: at ${pct} of forecast usage ${detail}.`;
 })():qualified?'It depends on usage: at some usage levels the cost could not be calculated.':'';
 let figure='',verdict='';
 if(e.outcome==='saving'&&b.saving!==null&&b.baseline!==null){
  const kind=e.tier==='supported'?'potential saving':'modelled saving';
  figure=`<p class="figure"><strong>${usdSaving(b.saving)}${qualified?' under your current forecast':''}</strong> <span>${kind} ${per}</span></p>`;
  verdict=`${cur} to ${target} at your next billing reset: ${usdCost(b.baseline)} becomes ${usdCost(best.cost)} in ${span} (${period}).`;
 }else if(e.outcome==='no_cheaper'&&b.baseline!==null){
  figure=e.conditions.includes('mid_cycle_upgrade_cheaper')
   ?`<p class="figure"><strong>No cheaper change at the next reset found</strong> <span>an immediate upgrade may be cheaper</span></p>`
   :`<p class="figure"><strong>No cheaper plan found</strong> <span>among the options that could be priced</span></p>`;
  verdict=`${cur} is the lowest-cost option that could be priced for your forecast: ${usdCost(b.baseline)} in ${span} (${period}).`;
 }else{
  figure=`<p class="figure"><strong>No saving calculated</strong> <span>— extra credits on your current plan cannot be priced at this usage</span></p>`;
  verdict=`For your forecast the lowest calculable option is ${target} at ${usdCost(best.cost)} in ${span} (${period}). The cost of staying on your current plan could not be calculated, so no saving is shown.`;
 }
 const credits=PLAN_CREDITS[best.plan];
 const fc=b.forecastCredits!==null?Number(b.forecastCredits)/e.months:null;
 const fcText=fc===null||!Number.isFinite(fc)?null:fc<1?'under 1 credit':`about ${Math.round(fc)} credits`;
 const fits=fcText&&credits!==undefined?`Your forecast of ${fcText} per cycle${e.months>1?' (average)':''} fits within ${target}'s ${safe(credits)} credits.`:'';
 const unstableWhy=qualified&&b.saving!==null
  ?`The ${usdSaving(b.saving)} applies to your forecast (100%) only.${other?.best?` At ${label[other.demandId]} the lowest calculable option is ${safe(planNames[other.best.plan])}${other.saving!==null?` (difference ${usdSaving(other.saving)})`:''}.`:''}${unpriced.length?` Costs at ${unpriced.map(l=>label[l.demandId]).join(' and ')} of forecast usage could not be fully calculated (${unpriced.reduce((n,l)=>n+l.unpriced,0)} option${unpriced.reduce((n,l)=>n+l.unpriced,0)===1?'':'s'} unpriced), so${e.range?` the calculated range of $${safe(formatUsd(e.range.minimum))} to $${safe(formatUsd(e.range.maximum))}`:' the calculated differences'} is not a complete bound.`:''}`
  :'';
 const free=best.plan==='free'&&!best.keep?'Moving to Free means cancelling the paid plan; Free terms for your account were not verified.':'';
 const assumes:string[]=[];
 if(cur)assumes.push(confirmed?`you are on ${cur} (confirmed by you)`:`you are on ${cur} (inferred${limit!==null?` from your reported ${safe(limit)}-credit limit`:''}, not confirmed)`);
 if(!context.billingConfirmed)assumes.push('personal (consumer) billing');
 if(context.addOns==='assumed_none')assumes.push('no purchased add-on credits');
 if(context.addOns==='some')assumes.push('add-on credits as you entered them (unverified)');
 if(e.conditions.includes('limited_history'))assumes.push('a forecast based on limited history');
 if(e.conditions.includes('net_changes_not_gross_billable_usage'))assumes.push('net changes in the reported counter as usage');
 if(e.conditions.includes('short_window_long_horizon'))assumes.push('a short observation window extended over later cycles');
 assumes.push('your usage continues at the forecast','list prices before tax, no promotions');
 const planLine=cur?(confirmed?'':`<p class="small"><strong>Assumes ${cur} (unconfirmed).</strong> Not your plan? Change your plan answers below.</p>`):'';
 const foot=e.outcome==='saving'?'Modelled from list prices: not a guarantee, not a saving you have realised and not an invoice.':'Modelled from list prices: not a guarantee and not an invoice.';
 const html=`<div class="estimate estimate-${e.tier}" role="group" aria-label="Plan cost estimate"><p class="tier"><span class="badge">${safe(badge)}</span></p>${figure}`
  +(limitLine?`<p class="small">${limitLine}</p>`:'')
  +`<p class="verdict">${verdict}</p>`
  +(free?`<p class="small">${free}</p>`:'')
  +planLine
  +`<p class="muted small">${foot}</p></div>`;
 const why=`<ul class="small">${[fits,unstableWhy,`Assumes: ${assumes.join('; ')}.`].filter(Boolean).map(t=>`<li>${t}</li>`).join('')}</ul>`;
 return {verdict,html,why};
}
const PLAN_CREDITS:Record<string,string>=Object.fromEntries(reviewedCatalog.plans.map(p=>[p.id,p.credits]));

/** Compact verdict first; assumptions, per-horizon comparisons and the full cost tables stay behind one disclosure. Script-free, no links with commands. */
export function presentAdvisor(o:{hint:PlanHint;context:AdvisorContext;horizons:CostHorizon[];advice:Advice[];singleAccount:boolean;failed?:boolean;limit:string|null}):string {
 const {hint,context,horizons,advice}=o;
 const planName=context.plan?safe(planNames[context.plan]):null;
 const estimates=o.failed?[]:horizons.map((h,i)=>estimateSavings(h.result,context,advice[i]??{kind:'insufficient_information',reasons:[]},h.months));
 const headline=headlineOf(estimates);
 const fromContext=[...(context.planSource==='hint'?['plan_is_hint']:context.planSource==='unknown'?['plan_not_confirmed']:[]),...(context.billingConfirmed?[]:['billing_assumed_consumer']),...(context.addOns==='some'?['add_on_balance_unverified']:context.addOns==='assumed_none'?['add_ons_assumed_none']:context.addOns==='unknown'?['add_ons_unknown']:[])];
 const codes=[...new Set([...hint.reasons.filter(r=>r==='limit_semantics_unverified'),...context.assumptions,...fromContext,...advice.flatMap(a=>a.reasons),...estimates.flatMap(e=>e.conditions)])];
 const assumptions=codes.filter(c=>c in assumptionText).map(c=>assumptionText[c]);
 const engineReasons=codes.filter(c=>!(c in assumptionText)&&!(headline&&c==='sensitivity_changes_winner'));
 const conditions=[...assumptions,...engineReasons.map(reasonText)];
 const catalog=reviewedCatalog;
 const first=horizons[0]?.result??null;
 const kind=advice[0]?.kind??'insufficient_information';
 // Without a numerical estimate the verdict never states a saving unless the engine classified it as potential_savings.
 const verdict=o.failed?'The Cost Advisor is unavailable; your budget and forecast remain usable.'
  :kind==='potential_savings'?`Potential saving${first?.savingsRange?`: $${safe(first.savingsRange.minimum.amount)} to $${safe(first.savingsRange.maximum.amount)} over ${horizons[0].months} full billing ${horizons[0].months===1?'cycle':'cycles'} (list prices)`:''}. ${first?safe(winnerText(first)):''}`
  :kind==='no_action'?'No cheaper option found for your forecast usage. Keep your current plan.'
  :kind==='conditional_comparison'?(advice[0]?.reasons.includes('savings_not_established')?'No saving is established with the details you confirmed. No savings are claimed.':'No saving can be confirmed yet. A comparison exists, but it depends on details you have not confirmed (see below). No savings are claimed.')
  :horizons.length?'Not enough confirmed information to compare plans yet. No savings are claimed.':'A qualified forecast is needed before costs can be compared. Keep using Kiro; this updates automatically.';
 // Name the visible blocking condition when the plan remainder is unknown; still fail-closed, no figures are derived from it.
 const nominal=context.plan?reviewedCatalog.plans.find(p=>p.id===context.plan)?.credits:undefined;
 const blocker=headline!==null||kind==='potential_savings'||kind==='no_action'?null
  :codes.includes('limit_differs_from_plan_credits')&&nominal!==undefined&&o.limit!==null?`Your reported limit (${safe(o.limit)}) doesn't match ${planName} (${safe(nominal)}). Check your plan or add-on credits.`
  :codes.includes('usage_exceeds_reported_limit')?'Observed usage is above the reported limit, so the remaining plan credits are unknown.'
  :context.addOns==='some'?'You have add-on credits, so your remaining plan credits cannot be separated from the reported limit.'
  :null;
 const card=headline?estimateCard(headline,context,o.limit):null;
 const verdictBlock=card?card.html:`<p class="verdict">${blocker?`${blocker} ${verdict}`:verdict}</p>`;
 const planLine=context.planSource==='confirmed'?`<span class="badge">Confirmed by you</span>`
  :context.planSource==='hint'?`<span class="badge">Unconfirmed</span>`:'';
 const planText=planName?`<strong>${planName}</strong>`:'<strong>Plan unknown</strong>';
 const planNote=context.planSource==='hint'?`Inferred from the reported ${safe(o.limit??'')} credits; this may include purchased credits, so it is only a hint.`
  :context.planSource==='confirmed'?(kind==='insufficient_information'||!horizons.some(h=>h.result)?'':'Used for the estimate.'):'Not confirmed, and the reported credit limit is unavailable or matches no catalog plan.';
 const rows=estimates.some(e=>e.tier!=='insufficient')
  ?estimates.map((e,i)=>horizonLine(e,summaryFallback(horizons[i],advice[i]))).join('')
  :horizons.map((h,i)=>summary(h,advice[i])).join('');
 const anyCosts=horizons.some(h=>h.result);
 const detail=(rows||conditions.length||anyCosts)
  ?`<details><summary>Why, assumptions and comparison</summary>`
   +(card?`<details class="small"><summary>Why this figure and its limits</summary>${card.why}</details>`:'')
   +(conditions.length?`<p class="small"><strong>Conditions that apply:</strong></p><ul class="small">${conditions.map(t=>`<li>${safe(t)}</li>`).join('')}</ul>`:'')
   +(rows?`<details class="small" open><summary>1, 3 and 6 billing cycles</summary><ul class="small">${rows}</ul><p class="muted small">Multi-cycle figures repeat the same forecast. They are scenarios, not predictions.</p></details>`:'')
   +(headline?`<details class="small"><summary>Sensitivity — 75% / 100% / 125% of forecast usage</summary>${sensitivityLines(headline)}</details>`:'')
   +(anyCosts?`<details class="small"><summary>Full cost comparison and calculations</summary><p class="muted small">Costs are modelled new expenditure under the conditions above, not invoices. Per-strategy saving figures stay hidden unless every input is confirmed.</p>${horizons.filter(h=>h.result).map(h=>`<p><strong>${h.months} full billing ${h.months===1?'cycle':'cycles'}</strong></p>${presentCost(h.result!,advice[horizons.indexOf(h)]?.kind==='potential_savings')}`).join('')}</details>`:'')
   +`<p class="muted small">Bundled list prices: catalog ${safe(catalog.version)}, reviewed ${safe(catalog.verifiedOn.slice(0,10))}.</p></details>`
  :'';
 const action=context.planSource==='confirmed'
  ?`<strong>Change your plan or answers:</strong> open <strong>Change your plan answers</strong> below.`
  :card?''
  :`<strong>Not your plan?</strong> Change your plan answers below. The figures above update immediately.`;
 return `<section id="cost-advisor" aria-labelledby="advisor-heading"><h2 id="advisor-heading">Cost Advisor</h2>`
  +`<p class="plan-row"><span class="label">${context.planSource==='confirmed'?'Your plan':'Likely plan'}</span> ${planText} ${planLine}</p>${planNote?`<p class="muted small">${planNote}${context.planSource==='hint'?` Hint confidence: ${safe(hint.confidence)}.`:''}</p>`:''}`
  +verdictBlock
  +(action||!o.singleAccount?`<p class="action small">${action}${o.singleAccount?'':' Unavailable until a single account context is established.'}</p>`:'')
  +detail+`</section>`;
}
function summaryFallback(h:CostHorizon|undefined,a:Advice|undefined):string {
 if(!h||!a||!h.result)return 'Not enough confirmed information for a comparison.';
 return `No numerical estimate is justified (${adviceLabels[a.kind].toLowerCase()}).`;
}
