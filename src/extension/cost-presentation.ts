import type {CostOptimization,CostScenario,Money,PlanId} from '../cost/types.ts';

import {planNames} from './cost-inputs.ts';
const safe=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const money=(m:Money|null)=>m?`USD ${safe(m.amount)}`:'Unavailable';
const timing={keep:'Keep current plan',now:'Upgrade now',next_reset:'Change at reset',now_then_revert_at_reset:'Upgrade now, return at reset'};
const name=(s:CostScenario)=>`${planNames[s.strategy.targetPlan]??'Unknown plan'} — ${timing[s.strategy.timing]??'Unknown timing'}${s.strategy.extras==='none'?' (no extras)':''}`;
const reasons:Record<string,string>={
 competitor_cost_unknown:'Some alternatives have unknown costs or eligibility. A cheapest overall strategy cannot be established.',
 personalized_baseline_unavailable:'No personalized baseline. Savings unavailable.',sensitivity_changes_winner:'Different demand levels favor different strategies; no single switch is recommended.',
 no_feasible_comparison:'No supported strategy can be priced and shown to serve the stated demand yet.',
 purchase_step_unknown:'Consumer purchase increments remain unverified. Exact add-on quantity and cost are unavailable.',
 pack_slots_unknown:'Confirm the available pack slots to assess purchases.',pack_slots_exhausted:'Insufficient pack slots for this strategy.',pack_slot_release_unknown:'Depleted-pack slot release remains unverified.',
 invoice_rounding_unknown:'Invoice rounding is unverified; these amounts are modeled expenditure.',
 bridge_inventory_unknown:'Before-reset demand or base/purchased balances are missing. Confirm them at the same as-of time; uncertainty can affect later cycles.',
 purchased_inventory_unknown:'Purchased-credit inventory is unknown.',lot_expiry_uncertain:'A lot has an unknown or day-only expiration. Its usability cannot be established exactly.',
 enterprise_overage_unknown:'Confirm Enterprise overage permission and applicable headroom.',enterprise_overage_disabled:'Enterprise overages are disabled.',enterprise_headroom_exhausted:'Enterprise overage headroom is insufficient.',
 future_shared_headroom_assumed:'The supplied Enterprise headroom is repeated per future cycle as a conditional assumption; future shared allocation is unverified.',
 billing_profile_unknown_or_unsupported:'Confirm the commercial billing system and market. Custom and GovCloud pricing are unsupported.',
 current_plan_unknown:'Confirm the current plan for personalized savings.',reset_unknown:'Confirm the next UTC calendar-month reset.',reset_conflict:'The supplied reset is incompatible with UTC calendar billing.',reset_elapsed:'The reset has passed. Reconfirm balances and the new reset.',
 inventory_stale:'Manual balances are older than 24 hours. Reconfirm them; later consumption is unknown.',inventory_anchor_mismatch:'Balance and demand anchors differ; personalized precision is unavailable.',
 forecast_balance_anchor_differs:'The forecast and manual balance timestamps differ.',forecast_unavailable:'A qualified forecast is unavailable. Manual monthly demand remains usable.',forecast_evidence_mismatch:'Forecast evidence no longer qualifies. Enter manual demand or wait for qualified data.',
 cohort_or_promotion_conditional:'Cohort or promotion is unresolved. List-price results exclude promotions and remain conditional.',upgrade_charge_or_rerating_unknown:'Immediate upgrade charge/rerating requires established-paid cohort, no promotion and cycle usage.',consumed_pack_restoration_unknown:'Previously consumed add-on restoration after upgrade is unverified.',
 standalone_hypothetical:'Independent what-if comparison: zero opening purchased inventory, excluded promotions and commercial UTC list-price cycles.',standalone_bridge_excluded:'The current partial cycle is excluded from an independent comparison.',
 catalog_review_due:'The bundled pricing catalog is due for review; prices remain dated conditional references.',hypothetical_catalog:'Invented test rules; not actual purchase quotes.',
 break_even_complex_scenario:'No analytical reference for this inventory, promotion or price-change scenario.',exact_break_even_not_requested:'Exhaustive exact break-even analysis is optional engine-only work and is not run in this view.',
 exact_purchase_rules_unavailable:'Exact purchase rules are incomplete; analytical thresholds are conditional references.',
 scenario_limit_exceeded:'The scenario exceeds the supported event bound.',mid_cycle_price_change_unresolved:'Mid-cycle price-change accounting is unsupported.',
 invalid_cost_input:'The billing inputs are invalid or unsupported.',cost_optimizer_unavailable:'The cost comparison is unavailable; the budget view remains usable.'
};
export const reasonText=(code:string)=>reasons[code]??'Additional billing evidence is required for this calculation.';
const notes=(codes:string[])=>[...new Set(codes)].map(c=>`<li>${safe(reasonText(c))}</li>`).join('');
const strategy=(o:CostOptimization,id:string|null,demand='base')=>o.scenarios.find(s=>s.strategy.id===id&&s.demandId===demand);
export function winnerText(o:CostOptimization,demand='base'){
 const alt=o.alternatives.find(a=>a.demandId===demand),s=strategy(o,alt?.strategyId??null,demand);
 if(!s)return 'No supported priced strategy';
 return `${o.reasons.includes('competitor_cost_unknown')?'Lowest calculable option (overall cheapest unknown)':o.scenarios.some(s=>s.assumptions.includes('standalone_comparison'))?'Lowest priced hypothetical option':'Cheapest supported strategy under stated assumptions'}: ${name(s)}${alt?.status==='conditional'?' — conditional':''}`;
}
export function presentCost(o:CostOptimization,showSavings=true):string{
 const base=o.scenarios.filter(s=>s.demandId==='base');
 const first=base[0],independent=base.some(s=>s.assumptions.includes('standalone_comparison'));
 const dates=first?`Before reset: ${safe(first.bridge.from)} to ${safe(first.bridge.to)}. Full billing cycles: ${safe(first.future.from)} to ${safe(first.future.to)} (UTC).`:'';
 const rows=base.map(s=>{
  const saving=o.savings.find(x=>x.strategyId===s.strategy.id&&x.demandId==='base');
  const b=s.bridge,u=s.future;
  return `<article class="cost-strategy"><h4>${safe(name(s))}</h4><p><strong>Full billing cycles: ${money(u.totalNewExpenditure)}</strong> · ${safe(s.status)}${u.feasible===false?' · does not serve all demand':''}</p><dl class="cost-grid"><dt>Before reset — new expenditure</dt><dd>${independent?'Excluded / no personalized baseline':money(b.totalNewExpenditure)}</dd><dt>Future subscription / add-ons / overages</dt><dd>${money(u.newSubscriptionSpend)} / ${money(u.newAddOnSpend)} / ${money(u.newOverageLiability)}</dd>${showSavings?`<dt>Before-reset savings</dt><dd>${saving?.bridge?money(saving.bridge):'Savings unavailable'}</dd><dt>Future-cycle savings</dt><dd>${saving?.future?money(saving.future):'Savings unavailable'}</dd>`:''}<dt>Purchased credits: opening / expired / remaining</dt><dd>${safe(u.openingPurchasedCredits??'Unknown')} / ${safe(u.expiredPurchasedCredits??'Unknown')} / ${safe(u.closingPurchasedCredits??'Unknown')}</dd><dt>Additional credits needed / unmet demand</dt><dd>${safe(u.additionalCreditsNeeded??'Unknown')} / ${safe(u.unmetDemandCredits??'Unknown')}</dd></dl>${s.reasons.length?`<ul class="muted small">${notes(s.reasons)}</ul>`:''}</article>`;
 }).join('');
 const reference=o.breakEven;
 const refs=reference.points.map(p=>`<li>${p.plans.map(id=>safe(planNames[id]??'Unknown plan')).join(' / ')}: ${safe(p.credits)} credits per full cycle</li>`).join('');
 return `<div class="cost-result"><h3>Cost comparison · ${safe(o.status)}</h3><p class="muted small">Based on your answers (kept for this session only). Costs are new expenditure in pre-tax USD, not invoices or historical refunds. Savings are signed; negative values mean higher cost.</p><p>${safe(winnerText(o))}</p><p class="small">${dates}</p>${o.reasons.length?`<ul>${notes(o.reasons)}</ul>`:''}<details><summary>Compare strategies and upgrade, downgrade or add-on costs</summary>${rows||'<p>No supported scenario.</p>'}</details><details><summary>Sensitivity — hypothetical 75% / 100% / 125% demand</summary><ul>${['low','base','high'].map((id,i)=>`<li>${[75,100,125][i]}%: ${safe(winnerText(o,id))}</li>`).join('')}</ul>${o.savingsRange&&showSavings?`<p>Matched total savings range: ${money(o.savingsRange.minimum)} to ${money(o.savingsRange.maximum)}.</p>`:''}<p>These are demand alternatives, not statistical confidence intervals.</p></details><details><summary>Conditional analytical break-even references</summary>${refs?`<ul>${refs}</ul>`:'<p>No valid reference for this scenario.</p>'}<p>One steady full cycle, no opening inventory, no promotion, continuous extra credits and no slot or quota limit. These are conditional analytical references, not exact pack thresholds or purchase quotes; they do not include multi-cycle carryover.</p><ul>${notes(reference.reasons)}</ul></details><details><summary>Assumptions and data quality</summary><p>Catalog ${safe(o.catalogVersion??'unavailable')}. Only the configured eligible tiers and supported fixed strategies are compared. This is not an optimum over arbitrary switching schedules. Monthly totals are repeated across full cycles, with constant demand within each cycle. Remaining purchased credits have no cash refund value.</p><p>Missing balances, eligibility, promotion or expiration are unknown. No live account balance is inferred from the selected plan. First-paid proration, pack restoration, exact purchase increments and invoice rounding can prevent personalized recommendations.</p><ul>${notes(o.scenarios.flatMap(s=>s.reasons))}</ul></details></div>`;
}
