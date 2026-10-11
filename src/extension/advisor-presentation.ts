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
/** Recommendation first; configuration only when needed. Script-free, no links with commands. */
export function presentAdvisor(o:{hint:PlanHint;context:AdvisorContext;horizons:CostHorizon[];advice:Advice[];singleAccount:boolean;failed?:boolean;limit:string|null}):string {
 const {hint,context,horizons,advice}=o;
 const plan=context.planSource==='confirmed'?`${safe(planNames[context.plan!])} — confirmed by you`
  :context.planSource==='hint'?`${safe(planNames[context.plan!])} — hint only: matches the reported ${safe(o.limit??'')} credits, not confirmed`
  :'Unknown — not confirmed by you, and the reported credit limit is unavailable or matches no catalog plan';
 const codes=[...new Set([...hint.reasons.filter(r=>r==='limit_semantics_unverified'),...context.assumptions,...advice.flatMap(a=>a.reasons)])];
 const assumptions=codes.filter(c=>c in assumptionText).map(c=>assumptionText[c]);
 const engineReasons=codes.filter(c=>!(c in assumptionText));
 const confidence=context.planSource==='hint'?` Hint confidence: ${hint.confidence} (exact match with the plan's nominal credits only).`:'';
 const rows=horizons.map((h,i)=>summary(h,advice[i])).join('');
 const catalog=reviewedCatalog;
 const first=horizons[0]?.result??null;
 const headline=advice[0]?safe(adviceLabels[advice[0].kind]):safe(adviceLabels.insufficient_information);
 return `<section id="cost-advisor" aria-label="Cost Advisor"><h2>Cost Advisor</h2>`
  +`<p><span class="badge">${headline}</span></p>`
  +(o.failed?'<p>The Cost Advisor is unavailable; your budget and forecast remain usable.</p>':rows?`<ul>${rows}</ul>`:'<p>A qualified forecast is needed before costs can be compared. Keep using Kiro; this updates automatically.</p>')
  +(advice[0]?.kind==='potential_savings'?`<p>${savings(first).trim()}</p>`:'')
  +`<p class="small"><strong>Plan:</strong> ${plan}.${safe(confidence)}</p>`
  +(assumptions.length||engineReasons.length?`<p class="small"><strong>Conditions that apply:</strong></p><ul class="small">${[...assumptions,...engineReasons.map(reasonText)].map(t=>`<li>${safe(t)}</li>`).join('')}</ul>`:'')
  +(horizons.some(h=>h.result)?`<details class="small"><summary>Compare options, assumptions and sensitivity</summary>${horizons.filter(h=>h.result).map(h=>`<h4>${h.months} full billing ${h.months===1?'cycle':'cycles'}</h4>${presentCost(h.result!)}`).join('')}</details>`:'')
  +`<p class="muted small">Bundled list prices: catalog ${safe(catalog.version)}, reviewed ${safe(catalog.verifiedOn.slice(0,10))}. Offline only; nothing is purchased or sent anywhere.</p>`
  +`<p class="small">To change the plan or answer the questions above, use the <strong>Cost Advisor</strong> button (light-bulb) in this panel's title bar, or the Command Palette entry <strong>EasyKiroGauge: Cost Advisor</strong> (it also clears your answers).${o.singleAccount?' Answers last for this session and are cleared when the account context changes.':' Answers are unavailable until a single account context is established.'}</p>`
  +`</section>`;
}
