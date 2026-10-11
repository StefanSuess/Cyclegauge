import type {CostOptimization} from '../cost/types.ts';
import type {Advice,AdviceKind,AdvisorContext,PlanHint} from '../cost/advisor.ts';
import {planNames,type CostHorizon} from './cost-inputs.ts';
import {winnerText,reasonText,presentCost} from './cost-presentation.ts';
import {reviewedCatalog} from '../cost/catalog.ts';

const safe=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export const adviceLabels:Record<AdviceKind,string>={no_action:'No action needed',potential_savings:'Potential savings',conditional_comparison:'Conditional comparison',insufficient_information:'Insufficient information'};
const assumptionText:Record<string,string>={
 plan_is_hint:'Your plan is a hint from the reported credit limit and is not confirmed.',
 plan_not_confirmed:'Your plan is not confirmed.',
 free_not_available_on_enterprise:'Free is not an Enterprise plan, so it was ignored.',
 billing_assumed_consumer:'Personal (consumer) billing is assumed. Enterprise accounts are priced differently.',
 add_ons_assumed_none:'No purchased add-on credits are assumed. Existing add-on credits would lower any purchase cost.',
 add_on_balance_unverified:'Remaining add-on credits were entered by you and are not verified.',
 limit_semantics_unverified:'Kiro may include purchased add-on credits in the reported limit; this has not been verified.',
 usage_exceeds_reported_limit:'Observed usage is above the reported limit, so the plan remainder is unknown (this can happen with overages or purchased credits).',
 limit_differs_from_plan_credits:'The reported limit differs from the chosen plan\'s nominal credits, so it may include other credits and the plan remainder is unknown.',
 enterprise_inputs_unconfirmed:'Enterprise prepaid add-ons, overage permission and headroom are not entered yet; comparisons stay unavailable or conditional.',
};
const summary=(h:CostHorizon,a:Advice)=>{
 const label=adviceLabels[a.kind];
 const body=h.result&&a.kind!=='insufficient_information'
  ?a.kind==='conditional_comparison'?`If the conditions below hold: ${winnerText(h.result)}`:winnerText(h.result)
  :'Not enough confirmed information for a comparison.';
 return `<li><strong>${h.months} full billing ${h.months===1?'cycle':'cycles'}: ${safe(label)}</strong> — ${safe(body)}</li>`;
};
function savings(o:CostOptimization|null){
 const r=o?.savingsRange;return r?` Modelled saving range: USD ${safe(r.minimum.amount)} to USD ${safe(r.maximum.amount)} over the period (list prices, pre-tax).`:'';
}
/** Compact verdict first; assumptions, per-horizon comparisons and the full cost tables stay behind one disclosure. Script-free, no links with commands. */
export function presentAdvisor(o:{hint:PlanHint;context:AdvisorContext;horizons:CostHorizon[];advice:Advice[];singleAccount:boolean;failed?:boolean;limit:string|null}):string {
 const {hint,context,horizons,advice}=o;
 const planName=context.plan?safe(planNames[context.plan]):null;
 const codes=[...new Set([...hint.reasons.filter(r=>r==='limit_semantics_unverified'),...context.assumptions,...advice.flatMap(a=>a.reasons)])];
 const assumptions=codes.filter(c=>c in assumptionText).map(c=>assumptionText[c]);
 const engineReasons=codes.filter(c=>!(c in assumptionText));
 const conditions=[...assumptions,...engineReasons.map(reasonText)];
 const catalog=reviewedCatalog;
 const first=horizons[0]?.result??null;
 const kind=advice[0]?.kind??'insufficient_information';
 // The verdict never states a saving unless the engine classified it as potential_savings (every input confirmed).
 const verdict=o.failed?'The Cost Advisor is unavailable; your budget and forecast remain usable.'
  :kind==='potential_savings'?`Potential saving${first?.savingsRange?`: USD ${safe(first.savingsRange.minimum.amount)} to USD ${safe(first.savingsRange.maximum.amount)} over one billing cycle (list prices, pre-tax)`:''}. ${first?safe(winnerText(first)):''}`
  :kind==='no_action'?'No cheaper option found for your forecast usage. Keep your current plan.'
  :kind==='conditional_comparison'?'No saving can be confirmed yet. A comparison exists, but it depends on details you have not confirmed (see below). No savings are claimed.'
  :horizons.length?'Not enough confirmed information to compare plans yet. No savings are claimed.':'A qualified forecast is needed before costs can be compared. Keep using Kiro; this updates automatically.';
 const planLine=context.planSource==='confirmed'?`<span class="badge">Confirmed by you</span>`
  :context.planSource==='hint'?`<span class="badge">Unconfirmed</span>`:'';
 const planText=planName?`<strong>${planName}</strong>`:'<strong>Plan unknown</strong>';
 const planNote=context.planSource==='hint'?`Inferred from the reported ${safe(o.limit??'')} credits; this may include purchased credits, so it is only a hint.`
  :context.planSource==='confirmed'?'Used for the comparison below.':'Not confirmed, and the reported credit limit is unavailable or matches no catalog plan.';
 const rows=horizons.map((h,i)=>summary(h,advice[i])).join('');
 const detail=(rows||conditions.length||horizons.some(h=>h.result))
  ?`<details><summary>Why, assumptions and comparison</summary>`
   +(conditions.length?`<p class="small"><strong>Conditions that apply:</strong></p><ul class="small">${conditions.map(t=>`<li>${safe(t)}</li>`).join('')}</ul>`:'')
   +(rows?`<p class="small"><strong>By horizon</strong></p><ul class="small">${rows}</ul>`:'')
   +(horizons.some(h=>h.result)?`<details class="small"><summary>Full cost comparison and sensitivity</summary><p class="muted small">Saving figures are hidden unless every input is confirmed; differences here are costs under the conditions above, not savings.</p>${horizons.filter(h=>h.result).map(h=>`<h4>${h.months} full billing ${h.months===1?'cycle':'cycles'}</h4>${presentCost(h.result!,advice[horizons.indexOf(h)]?.kind==='potential_savings')}`).join('')}</details>`:'')
   +`<p class="muted small">Bundled list prices: catalog ${safe(catalog.version)}, reviewed ${safe(catalog.verifiedOn.slice(0,10))}. Offline only; nothing is purchased or sent anywhere.</p></details>`
  :'';
 return `<section id="cost-advisor" aria-labelledby="advisor-heading"><h2 id="advisor-heading">Cost Advisor</h2>`
  +`<p class="plan-row"><span class="label">Likely plan</span> ${planText} ${planLine}</p><p class="muted small">${planNote}${context.planSource==='hint'?` Hint confidence: ${safe(hint.confidence)}.`:''}</p>`
  +`<p class="verdict">${verdict}</p>`
  +`<p class="action small"><strong>Confirm or change your plan:</strong> use the <strong>Cost Advisor</strong> light-bulb button in this panel's title bar, or run <strong>EasyKiroGauge: Cost Advisor</strong> from the Command Palette (it also clears your answers).${o.singleAccount?' Answers last for this session and are cleared when the account context changes.':' Answers are unavailable until a single account context is established.'}</p>`
  +detail+`</section>`;
}
