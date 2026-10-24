import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {estimateSavings,formatUsd,insufficientEstimate} from '../../src/cost/estimate.ts';
import {advisorProfile,classifyAdvice,planHint,noAnswers,type AdvisorAnswers,type AdvisorContext} from '../../src/cost/advisor.ts';
import {reviewedCatalog} from '../../src/cost/catalog.ts';
import {optimizeCosts} from '../../src/cost/optimize.ts';
import {calculateCosts} from '../../src/extension/cost-inputs.ts';
import {presentAdvisor} from '../../src/extension/advisor-presentation.ts';
import {reviewAdvisor} from '../../src/extension/advisor-inputs.ts';
import {request,profile,forecastEvidence,syntheticCatalog} from './cost-synthetic.ts';
import type {BillingProfile,CostOptimization,CostRequest,PricingCatalog} from '../../src/cost/types.ts';

// Entirely invented figures. The reviewed bundled prices are used on a synthetic 2030 timeline.
const fresh=():PricingCatalog=>{const c=structuredClone(reviewedCatalog);c.verifiedOn='2030-01-01T00:00:00Z';return c;};
const ctx=(over:Partial<AdvisorContext>={}):AdvisorContext=>({planSource:'confirmed',plan:'pro_plus',billingConfirmed:true,addOns:'none',assumptions:[],...over});
/** Manual monthly demand through the real simulator and optimizer. `credits` is the base full-cycle demand. */
// Manual what-if demand is never a production advisor input, so the fixture is relabelled as a regular forecast.
const forecastLike=(q:CostRequest):CostRequest=>({...q,demands:q.demands.map(d=>({...d,source:'forecast_regular' as const,assumptions:d.assumptions.filter(a=>a!=='manual_hypothetical_demand'&&a!=='repeat_manual_cycle_total')}))});
const build=(credits:string,p:BillingProfile,months:1|3|6=1,catalog:PricingCatalog=fresh()):CostRequest=>forecastLike({...request(credits,months,p),catalog});
const optimize=(credits:string,p:BillingProfile=profile({currentPlan:'pro_plus'}),months:1|3|6=1,catalog:PricingCatalog=fresh()):CostOptimization=>optimizeCosts(build(credits,p,months,catalog));
const estimate=(credits:string,p?:BillingProfile,over:Partial<AdvisorContext>={},months:1|3|6=1)=>{
 const result=optimize(credits,p,months),context=ctx(over);
 return {result,context,advice:classifyAdvice(result,context),est:estimateSavings(result,context,classifyAdvice(result,context),months)};
};
const present=(est:ReturnType<typeof estimate>,over:Partial<AdvisorContext>={})=>presentAdvisor({hint:planHint('2000',reviewedCatalog),context:ctx(over),horizons:[{months:1,result:est.result,reasons:[]}],advice:[est.advice],singleAccount:true,limit:'2000'});

test('positive modelled savings: a cheaper plan that serves the forecast gives a numerical difference',()=>{
 const {est,advice}=estimate('900');
 assert.equal(est.tier,'modelled');assert.equal(est.outcome,'saving');
 // The engine itself still withholds a verdict (cheapest overall is unknown because mid-cycle upgrades cannot be priced).
 assert.equal(advice.kind,'conditional_comparison');
 assert.equal(est.baselinePlan,'pro_plus');assert.equal(est.base?.baseline,'40');assert.equal(est.base?.best?.plan,'pro');assert.equal(est.base?.best?.cost,'20');
 assert.equal(est.base?.saving,'20');assert.equal(est.currency,'USD');
 assert.deepEqual(est.window,{from:'2030-01-01T00:00:00.000Z',to:'2030-02-01T00:00:00.000Z'});
 assert.equal(est.base?.forecastCredits,'900');
 for(const c of ['list_prices_pre_tax','forecast_not_guaranteed','only_next_reset_changes_compared'])assert.ok(est.conditions.includes(c),c);
 // Multi-cycle figures are totals over the same horizon, labelled as sustained-usage scenarios.
 const three=estimate('900',undefined,{},3).est;
 assert.equal(three.base?.saving,'60');assert.ok(three.conditions.includes('sustained_usage_scenario'));assert.equal(three.months,3);
 const six=estimate('900',undefined,{},6).est;assert.equal(six.base?.saving,'120');
});

test('no cheaper calculable alternative: staying put is reported as a zero difference, never as a saving',()=>{
 // 1,500 credits exceed Pro's allowance; Pro's extras cannot be priced, so only Pro+ and larger plans are calculable.
 const {est}=estimate('1500');
 assert.equal(est.tier,'modelled');assert.equal(est.outcome,'no_cheaper');
 assert.equal(est.base?.saving,'0');assert.equal(est.base?.best?.plan,'pro_plus');assert.equal(est.base?.best?.keep,true);
 // Pro could not be priced, so the claim is "lowest calculable", with the overall-cheapest caveat.
 assert.ok((est.base?.unpriced??0)>0);assert.ok(est.conditions.includes('overall_cheapest_unknown'));
 // Equal cost must prefer the current plan, so a tie is never presented as a saving.
 const tied=fresh();tied.plans.find(p=>p.id==='pro')!.fee='40';
 const tie=estimateSavings(optimize('900',profile({currentPlan:'pro_plus'}),1,tied),ctx(),{kind:'conditional_comparison',reasons:[]},1);
 assert.equal(tie.outcome,'no_cheaper');assert.equal(tie.base?.best?.plan,'pro_plus');assert.equal(tie.base?.saving,'0');
});

test('unconfirmed current plan: the estimate lists every assumption and never reads as confirmed',()=>{
 const {h,f}=forecastEvidence();
 const obs={limit:'1000',usage:'1',asOf:f.asOf,resetAt:f.resetAt};
 const built=advisorProfile(obs,noAnswers,planHint('1000',reviewedCatalog));
 const horizons=calculateCosts({mode:'personalized',profile:built.profile!,monthlyCredits:'0',beforeReset:undefined,demandMode:'forecast'},f,h,'2030-01-04T00:00:00Z',fresh());
 assert.ok(horizons[0].result);
 const advice=horizons.map(x=>classifyAdvice(x.result,built.context));
 const est=estimateSavings(horizons[0].result,built.context,advice[0],1);
 assert.equal(est.tier,'modelled');
 for(const c of ['plan_is_hint','billing_assumed_consumer','add_ons_assumed_none'])assert.ok(est.conditions.includes(c),c);
 const html=presentAdvisor({hint:planHint('1000',reviewedCatalog),context:built.context,horizons,advice,singleAccount:true,limit:'1000'});
 assert.ok(html.includes('Modelled estimate'));assert.ok(html.includes('Unconfirmed'));assert.ok(!html.includes('Confirmed by you'));
 assert.match(html,/inferred from your reported 1000-credit limit, not confirmed/);
 assert.match(html,/personal \(consumer\) billing/);assert.match(html,/no purchased add-on credits/);
 // The plan can be corrected from the same view.
 assert.match(html,/Not your plan\? Confirm or correct it/);assert.match(html,/status bar/);
 // A tiny forecast fits the Free plan; that switch carries its own caveat.
 assert.equal(est.base?.best?.plan,'free');assert.ok(est.conditions.includes('free_plan_terms_unverified'));
 assert.match(html,/Free plan terms for your account were not verified/);
});

test('confirmed plan and billing details are shown as confirmed; the figure stays modelled while engine conditions remain',()=>{
 const e=estimate('900');
 const html=present(e);
 assert.equal(e.est.tier,'modelled');
 assert.ok(html.includes('Confirmed by you'));assert.ok(html.includes('Your plan'));assert.ok(!html.includes('Unconfirmed'));
 assert.match(html,/you are on Pro\+ \(confirmed by you\)/);
 assert.ok(!html.includes('personal (consumer) billing'));assert.ok(!html.includes('no purchased add-on credits'));
 assert.match(html,/Pro\+ to Pro at your next billing reset: USD 40 becomes USD 20/);
 assert.match(html,/USD 20 under your current forecast<\/strong> <span>modelled saving per billing cycle/);
 assert.match(html,/from 2030-01-01 UTC, 1 month/);assert.match(html,/<li>Your forecast of about 900 credits per cycle fits within Pro's 1000 credits\.<\/li>/);
 assert.match(html,/Change your plan or answers/);
});

test('supported tier needs the engine to agree: only an unconditional engine verdict upgrades a modelled figure',()=>{
 const e=estimate('900');
 const clean:CostOptimization={...e.result,status:'available',reasons:[],recommendation:{strategyId:'pro_next_reset_as_needed',demandIds:['low','base','high'],kind:'supported_comparison'},savingsRange:{minimum:{currency:'USD',amount:'20'},maximum:{currency:'USD',amount:'20'}}};
 const advice=classifyAdvice(clean,ctx());assert.equal(advice.kind,'potential_savings');
 const supported=estimateSavings(clean,ctx(),advice,1);assert.equal(supported.tier,'supported');assert.equal(supported.outcome,'saving');
 const html=presentAdvisor({hint:planHint('2000',reviewedCatalog),context:ctx(),horizons:[{months:1,result:clean,reasons:[]}],advice:[advice],singleAccount:true,limit:'2000'});
 assert.ok(html.includes('Supported estimate'));assert.match(html,/<span>potential saving per billing cycle/);assert.ok(!html.includes('modelled saving'));
 // Any open assumption drops it back to modelled even on the same engine result.
 const hinted=ctx({planSource:'hint',assumptions:['plan_is_hint']});
 assert.equal(estimateSavings(clean,hinted,classifyAdvice(clean,hinted),1).tier,'modelled');
});

test('unknown or existing add-on credits never become confirmed zero and never produce a figure',()=>{
 const {h,f}=forecastEvidence();
 const base={limit:'1000',usage:'1',asOf:f.asOf,resetAt:f.resetAt};
 const run=(answers:AdvisorAnswers)=>{
  const built=advisorProfile(base,answers,planHint('1000',reviewedCatalog));
  const horizons=calculateCosts({mode:'personalized',profile:built.profile!,monthlyCredits:'0',beforeReset:undefined,demandMode:'forecast'},f,h,'2030-01-04T00:00:00Z',fresh());
  return {built,horizons,est:horizons.map(x=>estimateSavings(x.result,built.context,classifyAdvice(x.result,built.context),x.months))};
 };
 // Add-ons present, with or without a balance: the plan remainder cannot be separated from the reported limit.
 for(const addOnCredits of [null,'250']){
  const r=run({...noAnswers,plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits});
  assert.ok(r.est.every(e=>e.tier==='insufficient'&&e.outcome==='none'),String(addOnCredits));
  const html=presentAdvisor({hint:planHint('1000',reviewedCatalog),context:r.built.context,horizons:r.horizons,advice:r.horizons.map(x=>classifyAdvice(x.result,r.built.context)),singleAccount:true,limit:'1000'});
  assert.ok(!/USD \d/.test(html.replace(/Bundled list prices[^<]*/,'').split('Full cost comparison')[0]),'no figure before the details');
  assert.match(html,/You have add-on credits/);assert.ok(!html.includes('Modelled estimate'));
 }
 // Enterprise inputs unconfirmed: add-ons stay unknown, so a consumer list-price estimate is not offered.
 const e=run({plan:'pro',billing:'enterprise_postpaid',addOns:null,addOnCredits:null});
 assert.ok(e.est.every(x=>x.tier==='insufficient'));
 // A hand-built context that is inconsistent with the numbers is refused as well.
 const result=optimize('900');
 assert.equal(estimateSavings(result,ctx({addOns:'unknown'}),classifyAdvice(result,ctx({addOns:'unknown'})),1).tier,'insufficient');
 for(const code of ['usage_exceeds_reported_limit','limit_differs_from_plan_credits'])
  assert.equal(estimateSavings(result,ctx({assumptions:[code]}),{kind:'conditional_comparison',reasons:[]},1).tier,'insufficient',code);
 // Explicitly no add-ons: the estimate exists and says so only when it was an assumption.
 const none=run({...noAnswers,plan:'pro',billing:'consumer_prepaid',addOns:'none'});
 assert.ok(none.est.every(x=>x.tier==='modelled'));assert.ok(none.est.every(x=>!x.conditions.includes('add_ons_assumed_none')));
});

test('missing competitor costs and eligibility restrictions limit what is claimed',()=>{
 // Current plan cannot be priced (extras unknown) while a larger plan can: costs only, no difference.
 const costsOnly=estimate('1500',profile({currentPlan:'pro'}),{plan:'pro'});
 assert.equal(costsOnly.est.tier,'comparison_only');assert.equal(costsOnly.est.outcome,'costs_only');
 assert.equal(costsOnly.est.base?.saving,null);assert.equal(costsOnly.est.base?.baseline,null);assert.equal(costsOnly.est.baselinePlan,null);
 assert.ok(costsOnly.est.conditions.includes('baseline_cost_unavailable'));
 const html=present(costsOnly,{plan:'pro'});
 assert.match(html,/Cost comparison only/);assert.match(html,/No saving calculated/);
 assert.match(html,/The cost of staying on your current plan could not be calculated, so no saving is shown/);
 assert.ok(!/modelled potential saving|less per billing/i.test(html));
 // Plans the account may not choose are never offered, so they can never be the "cheaper" plan.
 const restricted=estimate('600',profile({currentPlan:'pro_plus',allowedPlans:['pro_plus','pro_max','power']}));
 assert.equal(restricted.est.outcome,'no_cheaper');assert.ok(restricted.est.base!.priced.every(p=>p.plan!=='pro'&&p.plan!=='free'));
 // Enterprise cannot choose Free.
 const ent=estimateSavings(optimize('30',profile({currentPlan:'pro',billingSystem:'enterprise_postpaid',allowedPlans:['pro','pro_plus','pro_max','power']})),ctx({plan:'pro'}),{kind:'conditional_comparison',reasons:[]},1);
 assert.ok(ent.base===null||ent.base.priced.every(p=>p.plan!=='free'));
 // A balance that is stale or inconsistent with its anchor makes the figure unusable instead of "mostly right".
 const stale=optimizeCosts({...build('900',profile({currentPlan:'pro_plus',resetAt:'2030-02-01T00:00:00Z'})),now:'2030-01-02T12:00:00Z'});
 assert.ok(stale.scenarios.some(s=>s.reasons.includes('inventory_stale')));
 assert.equal(estimateSavings(stale,ctx(),{kind:'conditional_comparison',reasons:[]},1).tier,'insufficient');
});

test('demand sensitivity: when the preferred plan changes the range and the reason are shown',()=>{
 // 900 credits fits Pro; 125% (1,125) does not, so Pro+ is the only calculable option at the high level.
 const e=estimate('900');
 assert.equal(e.est.preferredChanges,true);
 assert.deepEqual(e.est.levels.map(l=>l.best?.plan),['pro','pro','pro_plus']);
 assert.deepEqual(e.est.levels.map(l=>l.saving),['20','20','0']);
 assert.deepEqual(e.est.range,{minimum:'0',maximum:'20'});
 assert.ok(e.est.conditions.includes('sensitivity_changes_preferred_plan'));
 const html=present(e);
 assert.match(html,/The USD 20 applies to your forecast \(100%\) only\. At 125% the lowest calculable option is Pro\+ \(difference USD 0\)\./);
 assert.match(html,/Costs at 125% of forecast usage could not be fully calculated \(1 option unpriced\), so the calculated range of USD 0 to USD 20 is not a complete bound\./);
 assert.match(html,/125% of forecast usage:<\/strong> lowest calculable Pro\+ USD 40; current plan Pro\+ USD 40; no cheaper option \(difference USD 0\); 1 option could not be priced, so this is not a complete comparison/);
 // A stable preference has no such caveat.
 const stable=estimate('300');
 assert.equal(stable.est.preferredChanges,false);assert.ok(!stable.est.conditions.includes('sensitivity_changes_preferred_plan'));
});

test('no numerical estimate is justified without calculable costs',()=>{
 const result=optimize('900');
 const advice={kind:'insufficient_information' as const,reasons:[]};
 assert.deepEqual(estimateSavings(null,ctx(),advice,1),insufficientEstimate(1));
 assert.equal(estimateSavings({...result,status:'unavailable',scenarios:[]},ctx(),advice,1).tier,'insufficient');
 // Invented rules (hypothetical catalog) are never turned into a figure for the user.
 const hypothetical=optimizeCosts(request('900',1,profile({currentPlan:'pro_plus'})));
 assert.ok(hypothetical.scenarios.some(s=>s.reasons.includes('hypothetical_catalog')));
 assert.equal(estimateSavings(hypothetical,ctx(),advice,1).tier,'insufficient');
 // Unknown current plan: the engine prices nothing.
 const unknown=optimizeCosts(build('900',profile({currentPlan:null})));
 assert.equal(estimateSavings(unknown,ctx({plan:null,planSource:'unknown'}),advice,1).tier,'insufficient');
 // Malformed results never throw.
 assert.equal(estimateSavings({scenarios:[{}]} as any,ctx(),advice,1).tier,'insufficient');
 assert.equal(estimateSavings({...result,scenarios:'x'} as any,ctx(),advice,1).tier,'insufficient');
 const html=presentAdvisor({hint:planHint('2000',reviewedCatalog),context:ctx(),horizons:[{months:1,result:unknown,reasons:[]}],advice:[advice],singleAccount:true,limit:'2000'});
 assert.match(html,/Not enough confirmed information to compare plans yet\. No savings are claimed\./);
 assert.ok(!html.includes('Modelled estimate'));assert.ok(!/class="figure"/.test(html));
});

test('wording keeps modelled differences apart from realised savings and invoices and never promises',()=>{
 const html=present(estimate('900'));
 assert.match(html,/not a guarantee, not a saving you have realised and not an invoice/);
 assert.match(html,/list prices before tax, no promotions/);
 assert.match(html,/Amounts are bundled list prices before tax\. Promotions are excluded\. They are not invoices\./);
 assert.ok(!/\b(will save|you save|guaranteed saving|guaranteed to|cheapest plan overall|globally cheapest)\b/i.test(html));
 assert.ok(!html.includes('<script'));assert.ok(!html.includes('command:'));assert.ok(!/buy now|purchase now/i.test(html));
 // Horizons, sensitivity and calculations stay under expandable details.
 for(const summary of ['1, 3 and 6 billing cycles','Sensitivity — 75% / 100% / 125% of forecast usage','Full cost comparison and calculations'])assert.ok(html.includes(`<summary>${summary}</summary>`),summary);
 assert.ok(html.indexOf('class="estimate')<html.indexOf('<details>'));
});

test('horizon lines carry their tier, billing period and currency',()=>{
 const {h,f}=forecastEvidence();
 const built=advisorProfile({limit:'1000',usage:'1',asOf:f.asOf,resetAt:f.resetAt},{...noAnswers,plan:'pro',billing:'consumer_prepaid',addOns:'none'},planHint('1000',reviewedCatalog));
 const horizons=calculateCosts({mode:'personalized',profile:built.profile!,monthlyCredits:'0',beforeReset:undefined,demandMode:'forecast'},f,h,'2030-01-04T00:00:00Z',fresh());
 const html=presentAdvisor({hint:planHint('1000',reviewedCatalog),context:built.context,horizons,advice:horizons.map(x=>classifyAdvice(x.result,built.context)),singleAccount:true,limit:'1000'});
 for(const n of ['1 full billing cycle','3 full billing cycles','6 full billing cycles'])assert.ok(html.includes(`<strong>${n} (`),n);
 assert.match(html,/\(from 2030-02-01 UTC\): Modelled estimate/);assert.match(html,/USD 0/);
});

test('formatUsd rounds savings down and costs up',()=>{
 assert.equal(formatUsd('20'),'20');assert.equal(formatUsd('20.5'),'20.50');assert.equal(formatUsd('20.509','down'),'20.50');
 assert.equal(formatUsd('20.501','up'),'20.51');assert.equal(formatUsd('20.50','up'),'20.50');assert.equal(formatUsd('0.999999','up'),'1');assert.equal(formatUsd('19.995','up'),'20');
 assert.equal(formatUsd('0'),'0');
});

test('the picker offers the inferred plan first as a one-click confirmation',async()=>{
 const seen:{title:string;ids:string[];label:string}[]=[];
 const ui={async pick(title:string,items:{id:string;label:string}[]){seen.push({title,ids:items.map(i=>i.id),label:items[0].label});return seen.length===1?items[0].id:'unsure';},async input(){return undefined;}};
 const answers=await reviewAdvisor(ui,planHint('2000',reviewedCatalog),noAnswers);
 assert.equal(answers?.plan,'pro_plus');
 assert.equal(seen[0].ids[0],'plan:pro_plus');assert.equal(seen[0].label,"Yes, I'm on Pro+");
 assert.equal(seen[0].ids.filter(id=>id==='plan:pro_plus').length,1);
 for(const id of ['plan:free','plan:pro','plan:pro_max','plan:power','unsure','reset'])assert.ok(seen[0].ids.includes(id),id);
 // Without a hint the list is unchanged in content and nothing is pre-selected.
 const none:string[]=[];
 await reviewAdvisor({async pick(_t:string,items:{id:string;label:string}[]){none.push(...items.map(i=>i.label));return undefined;},async input(){return undefined;}},planHint(null,reviewedCatalog),noAnswers);
 assert.ok(none.every(l=>!l.startsWith('Yes')));
});

test('the estimate layer is offline, storage-free and does not touch the engine',async()=>{
 const text=await readFile(new URL('../../src/cost/estimate.ts',import.meta.url),'utf8');
 for(const forbidden of ['vscode','node:fs','node:net','node:http','node:child_process','fetch(','globalState','workspaceState','process.env','optimizeCosts','simulateStrategy'])assert.ok(!text.includes(forbidden),forbidden);
 void syntheticCatalog;
});

test('a move to Free is never supported, is caveated in the card and a tiny forecast is not shown as "about 0"',()=>{
 const result=optimize('0.4',profile({currentPlan:'pro'}));
 const context=ctx({plan:'pro'});
 const clean:CostOptimization={...result,status:'available',reasons:[],recommendation:{strategyId:'free_next_reset_as_needed',demandIds:['low','base','high'],kind:'supported_comparison'},savingsRange:{minimum:{currency:'USD',amount:'20'},maximum:{currency:'USD',amount:'20'}}};
 const advice=classifyAdvice(clean,context);assert.equal(advice.kind,'potential_savings');
 const est=estimateSavings(clean,context,advice,1);
 assert.equal(est.base?.best?.plan,'free');assert.equal(est.tier,'modelled');assert.ok(est.conditions.includes('free_plan_terms_unverified'));
 const html=presentAdvisor({hint:planHint('1000',reviewedCatalog),context,horizons:[{months:1,result:clean,reasons:[]}],advice:[advice],singleAccount:true,limit:'1000'});
 assert.ok(!html.includes('Supported estimate'));assert.match(html,/Moving to Free means cancelling the paid plan/);assert.match(html,/under 1 credit per cycle/);
});

test('an unconfirmed plan qualifies the figure itself and puts the confirmation next to it',()=>{
 const e=estimate('900');
 const html=present(e,{planSource:'hint',assumptions:['plan_is_hint']});
 assert.match(html,/Assumes Pro\+ \(unconfirmed\)\./);assert.match(html,/Not your plan\? Confirm or correct it/);
 // The instruction appears exactly once in the unconfirmed view.
 assert.equal(html.split('Confirm or correct it').length-1,1);assert.ok(!html.includes('Change your plan or answers'));
 assert.ok(!html.includes('aria-label="Savings estimate"'));
});

test('review findings: Free at any demand level is caveated, opening lots and cheaper immediate upgrades are not hidden',()=>{
 // Low level picks Free while base does not: the caveat still applies.
 const low=estimate('60');
 assert.equal(low.est.base?.best?.plan,'pro');assert.equal(low.est.levels[0].best?.plan,'free');assert.ok(low.est.conditions.includes('free_plan_terms_unverified'));
 // Known opening purchased lots make figures not comparable, so nothing is produced.
 const lots=optimize('900',profile({currentPlan:'pro_plus',purchased:{kind:'known',value:[{remainingCredits:'400',expiresAt:'2031-01-01T00:00:00Z',expiryPrecision:'instant'}]}}),1,(()=>{const c=fresh();c.consumer.purchaseStepCredits='1';c.consumer.moneyRounding='exact';return c;})());
 assert.equal(estimateSavings(lots,ctx(),{kind:'conditional_comparison',reasons:[]},1).tier,'insufficient');
 // A calculable immediate upgrade that is cheaper than keeping is flagged instead of "no cheaper".
 const cheap=(()=>{const c=fresh();c.consumer.purchaseStepCredits='1';c.consumer.moneyRounding='exact';return c;})();
 const q=build('1500',profile({currentPlan:'pro',resetAt:'2030-02-01T00:00:00Z',planRemaining:{kind:'known',value:'100'},cycleUsageForRerating:{kind:'known',value:'900'}}),1,cheap);
 const r=optimizeCosts({...q,demands:q.demands.map(d=>({...d,beforeReset:{kind:'known' as const,value:{numerator:3000n,denominator:1n}}}))});
 const e=estimateSavings(r,ctx({plan:'pro'}),{kind:'conditional_comparison',reasons:[]},1);
 assert.equal(e.tier,'modelled');assert.equal(e.outcome,'no_cheaper');assert.ok(e.conditions.includes('mid_cycle_upgrade_cheaper'));
 const html=presentAdvisor({hint:planHint('1000',reviewedCatalog),context:ctx({plan:'pro'}),horizons:[{months:1,result:r,reasons:[]}],advice:[{kind:'conditional_comparison',reasons:[]}],singleAccount:true,limit:'1000'});
 assert.match(html,/No cheaper change at the next reset found/);assert.ok(!html.includes('No cheaper plan found'));
});

test('final headline wording: a usage-dependent saving is a point estimate, never a stable or complete bound',()=>{
 const html=present(estimate('900'));
 const card=html.slice(html.indexOf('<div class="estimate'),html.indexOf('</div>',html.indexOf('<div class="estimate')));
 // Concise, qualified headline; "Up to" is never used because the unpriced level means no bound is known.
 assert.match(card,/<strong>USD 20 under your current forecast<\/strong> <span>modelled saving per billing cycle<\/span>/);
 assert.ok(!/Up to USD/i.test(html));
 assert.match(card,/Higher usage may remove it: at 125% of forecast usage extra credits on smaller plans cannot be priced\./);
 assert.ok(!/ranges? from|stable range|guaranteed saving/i.test(card));
 // Secondary explanation lives in the expandable details, not in the headline.
 assert.ok(!card.includes('fits within'));assert.ok(!card.includes('Assumes:'));assert.ok(!card.includes('not a complete bound'));
 const details=html.slice(html.indexOf('<details><summary>Why, assumptions and comparison'));
 for(const text of ['Why this figure and its limits','fits within Pro','is not a complete bound','Assumes: you are on Pro+ (confirmed by you)'])assert.ok(details.includes(text),text);
 assert.ok(card.length<1100,`headline card stays compact (${card.length})`);
});

test('regression: unpriced high-demand scenarios never become a "0 to 20" bound or a bare saving',()=>{
 const e=estimate('900');
 assert.equal(e.est.stable,false);assert.equal(e.est.levels[2].unpriced,1);
 const html=present(e);
 assert.ok(!/<strong>USD 20<\/strong>/.test(html));
 // The calculated 0..20 appears only in the details, always marked as not complete.
 for(const m of html.matchAll(/USD 0 to USD 20/g)){const around=html.slice(m.index,m.index!+160);assert.match(around,/not a complete bound/);}
 // A unit-for-unit stable case keeps the plain figure: every level priced and the same preferred plan.
 const stable=estimate('300');
 assert.equal(stable.est.stable,true);
 const plain=present(stable);
 assert.match(plain,/<strong>USD 20<\/strong> <span>modelled saving per billing cycle<\/span>/);
 assert.ok(!plain.includes('under your current forecast'));assert.ok(!plain.includes('Higher usage may remove it'));
 // A usage-dependent preference without any unpriced option is still qualified, with the other plan named.
 const free=estimate('60');
 assert.equal(free.est.stable,false);assert.match(present(free),/under your current forecast/);
});

test('unpriced low or high levels are named in the details and the headline stays qualified for 3 and 6 cycles',()=>{
 for(const months of [3,6] as const){
  const e=estimate('900',undefined,{},months);
  assert.equal(e.est.stable,false);
  const html=presentAdvisor({hint:planHint('2000',reviewedCatalog),context:ctx(),horizons:[{months,result:e.result,reasons:[]}],advice:[e.advice],singleAccount:true,limit:'2000'});
  assert.match(html,new RegExp(`USD ${months===3?60:120} under your current forecast</strong> <span>modelled saving over ${months} billing cycles`));
  assert.match(html,/1 option could not be priced, so this is not a complete comparison/);
 }
});

test('regression: the same cheapest plan with different savings per usage level is not stable',()=>{
 const priced=fresh();priced.consumer.purchaseStepCredits='1';priced.consumer.moneyRounding='exact';
 const result=optimize('2500',profile({currentPlan:'pro_max'}),1,priced);
 const context=ctx({plan:'pro_max'});
 const advice=classifyAdvice(result,context);
 const est=estimateSavings(result,context,advice,1);
 // Pro+ is cheapest at 75%, 100% and 125% usage, but the saving differs because the current plan's extras grow (exact decimals).
 assert.deepEqual(est.levels.map(l=>l.best?.plan),['pro_plus','pro_plus','pro_plus']);
 assert.deepEqual(est.levels.map(l=>l.unpriced),[0,0,0]);
 assert.deepEqual(est.levels.map(l=>l.saving),['60','40','15']);
 assert.equal(est.preferredChanges,false);assert.notEqual(est.range,null);
 assert.equal(est.stable,false);assert.ok(!est.conditions.includes('sensitivity_changes_preferred_plan'));
 const html=presentAdvisor({hint:planHint('5000',reviewedCatalog),context,horizons:[{months:1,result,reasons:[]}],advice:[advice],singleAccount:true,limit:'5000'});
 assert.match(html,/<strong>USD 40 under your current forecast<\/strong> <span>modelled saving per billing cycle<\/span>/);
 // The differing levels are 75% (higher saving) and 125% (lower saving, but not zero): neither is "may remove it".
 assert.match(html,/It depends on usage: at 75% of forecast usage the modelled saving is USD 60\./);
 assert.ok(!html.includes('Higher usage may remove it'));
 // Exact decimal comparison: a one-cent difference also breaks stability.
 const cent=fresh();cent.consumer.purchaseStepCredits='1';cent.consumer.moneyRounding='exact';cent.consumer.pricePerCredit='0.04001';
 const sensitive=estimateSavings(optimize('2500',profile({currentPlan:'pro_max'}),1,cent),context,advice,1);
 assert.equal(sensitive.stable,false);
 // Identical savings at every level (and nothing unpriced) stay stable and unqualified.
 assert.equal(estimate('300').est.stable,true);
});

test('"Higher usage may remove it" is only used when the differing scenario is the higher-usage one',()=>{
 const only=(html:string)=>html.includes('Higher usage may remove it');
 // 125% unpriced: higher usage.
 assert.ok(only(present(estimate('900'))));
 // 75% differs (Free is cheapest at low usage): never "Higher usage".
 const low=present(estimate('60'));
 assert.ok(!only(low));assert.match(low,/It depends on usage: at 75% of forecast usage the modelled saving is USD 40\./);
});

test('Advisor discloses when full cycles use the longest qualified pooled-history rate',()=>{
 const result=optimize('900');
 for(const scenario of result.scenarios)scenario.assumptions.push('long_history_future_rate');
 const context=ctx(),advice=classifyAdvice(result,context);
 const est=estimateSavings(result,context,advice,1);
 assert.ok(est.conditions.includes('long_history_future_rate'));
 const html=presentAdvisor({hint:planHint('2000',reviewedCatalog),context,horizons:[{months:1,result,reasons:[]}],advice:[advice],singleAccount:true,limit:'2000'});
 assert.ok(html.includes('longest qualified pooled-history rate'));
});
