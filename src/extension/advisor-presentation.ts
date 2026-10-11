import type {CostOptimization} from '../cost/types.ts';
import type {Advice,AdviceKind,AdvisorContext,PlanHint} from '../cost/advisor.ts';
import {planNames,type CostHorizon} from './cost-inputs.ts';
import {winnerText} from './cost-presentation.ts';
import {reviewedCatalog} from '../cost/catalog.ts';

const safe=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export const adviceLabels:Record<AdviceKind,string>={no_action:'No action needed',potential_savings:'Potential savings',conditional_comparison:'Conditional comparison',insufficient_information:'Insufficient information'};
const assumptionText:Record<string,string>={
 plan_is_hint:'Your plan is a hint from the reported credit limit and is not confirmed.',
 billing_assumed_consumer:'Personal (consumer) billing is assumed. Enterprise accounts are priced differently.',
 add_ons_assumed_none:'No purchased add-on credits are assumed. Existing add-on credits would lower any purchase cost.',
 add_on_balance_unverified:'Remaining add-on credits were entered by you and are not verified.',
 limit_semantics_unverified:'Kiro may include purchased add-on credits in the reported limit; this has not been verified.',
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
  :'Unknown — the reported credit limit matches no catalog plan, or is unavailable';
 const assumptions=[...new Set([...hint.reasons.filter(r=>r==='limit_semantics_unverified'),...context.assumptions])].map(c=>assumptionText[c]).filter(Boolean);
 const rows=horizons.map((h,i)=>summary(h,advice[i])).join('');
 const catalog=reviewedCatalog;
 const first=horizons[0]?.result??null;
 const headline=advice[0]?safe(adviceLabels[advice[0].kind]):safe(adviceLabels.insufficient_information);
 return `<section id="cost-advisor" aria-label="Cost Advisor"><h2>Cost Advisor</h2>`
  +`<p><span class="badge">${headline}</span></p>`
  +(o.failed?'<p>The Cost Advisor is unavailable; your budget and forecast remain usable.</p>':rows?`<ul>${rows}</ul>`:'<p>A qualified forecast is needed before costs can be compared. Keep using Kiro; this updates automatically.</p>')
  +(advice[0]?.kind==='potential_savings'?`<p>${savings(first).trim()}</p>`:'')
  +`<p class="small"><strong>Plan:</strong> ${plan}.</p>`
  +(assumptions.length?`<ul class="small">${assumptions.map(t=>`<li>${safe(t)}</li>`).join('')}</ul>`:'')
  +`<p class="muted small">Bundled list prices: catalog ${safe(catalog.version)}, reviewed ${safe(catalog.verifiedOn.slice(0,10))}. Offline only; nothing is purchased or sent anywhere.</p>`
  +`<p class="small">To change the plan or answer the questions above, use the <strong>Cost Advisor</strong> button (light-bulb) in this panel's title bar, or the Command Palette entry <strong>EasyKiroGauge: Cost Advisor</strong>.${o.singleAccount?' Answers last for this session and are cleared when the account context changes.':' Answers are unavailable until a single account context is established.'}</p>`
  +`</section>`;
}
