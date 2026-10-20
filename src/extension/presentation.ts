import type { AdvisorAnswers } from '../cost/advisor.ts';
import type { view } from '../view.ts';
import { compare, compareRatios } from '../decimal.ts';
import { readable, updated, date } from './labels.ts';
import { presentChartParts, CHART_CSS } from './chart.ts';
import { countsText, relativeTime, sizePhrase, type AuditSummary } from './audit-model.ts';
import { LINKS, NOT_KIRO_TEXT } from './identity.ts';
import { overageOver, type Overage } from '../cost/overage.ts';
import { decimalToRational, formatRational } from '../cost/money.ts';
import { rightSizeText, largerPlanText } from './budget-warning.ts';
import { NO_INSIGHTS, type PlanInsights } from '../cost/plan-hints.ts';
import { cycleComparison, todayPace } from './dashboard-insights.ts';
import { resultsText, type StoredResults } from './results-summary.ts';
import type { Recap } from './recap.ts';
import { recapSection } from './recap-presentation.ts';

const safe = (s: string | null) => s === null ? 'Not available' : s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
const row = (label: string, value: string | null) => `<tr><th scope="row">${safe(label)}</th><td>${safe(value)}</td></tr>`;
// Compact budgets truncate rather than round up the spending allowance.
const compact = (s: string) => {
 const [whole,fraction='']=s.split('.');
 if (compare(s,'0')>0 && compare(s,'0.1')<0) return '<0.1';
 return fraction[0] && fraction[0]!=='0' ? `${whole}.${fraction[0]}` : whole;
};
// Short, always-visible wording; the long policy sentence for collecting data lives under Advanced details.
const COLLECTING_POLICY='A provisional estimate requires at least 48 hours and 3 comparable account updates; a regular forecast requires at least 7 days and 8 updates. Gaps and billing changes can restart this window.';
const NEXT_STEP='Use Kiro for a few minutes so it can write a credit update. If this stays empty, use Report a problem below.';
const explanations: Record<string,string> = {
 stale:'Forecast paused — the last account update is too old. Use Kiro for a few minutes to get a fresh one.',
 insufficient_comparable_coverage:'Keep using Kiro. A first estimate appears after about 2 days and 3 account updates; a regular forecast after 7 days.',
 multiple_accounts:'Updates from different accounts cannot be combined, so no forecast is shown.',
 unknown_account:`Bobert cannot tell which account these updates belong to, so no forecast is shown. ${NEXT_STEP}`,
 conflicting_snapshots:'Two account updates for the same moment disagree, so an estimate would be misleading. Use Kiro for a few minutes; a newer update usually resolves this.',
 reset_elapsed:'The billing reset has passed. Use Kiro for a few minutes to get an account update from the new cycle.',
 reset_unknown:`The billing reset date is not known yet, so no forecast is shown. ${NEXT_STEP}`,
 reset_regressed:'Billing cycle dates are inconsistent.',
 future_observation:'The account update is dated in the future. Check the device clock.',
 missing_billing:`Credit usage or the credit limit is missing from the latest update. ${NEXT_STEP}`,
 unsupported_extra_credits:'Extra-credit information is not supported, so a forecast is unavailable.',
 unavailable:NEXT_STEP,
 runtime_unsupported:"This version of Kiro is too old for Bobert's credit view. Update Kiro to see your credits. The workspace audit still works.",
 storage_newer:'Your Bobert data was written by a newer Bobert version. Update Bobert; the data is left unchanged.',
};
// The status bar names the cause of an "update needed" state.
const BLOCKED_TEXT: Record<string,string> = { runtime_unsupported: 'Kiro: Needs a newer Kiro', storage_newer: 'Kiro: Update Bobert' };
// Said once, behind the hero's "About these numbers" disclosure, instead of repeating in every card.
const ABOUT='Figures are as of the last account update; usage since then is unknown. The reported limit is not verified as base-only or total capacity, so it may include purchased add-on credits, and usage can exceed it. Credits above it do not by themselves establish overage charges or a purchased balance. Forecasts assume the observed pace continues. Dollar amounts are modelled from list prices in USD before tax; they are not invoices.';
const creditsText=(c:string)=>{try{return formatRational(decimalToRational(c),compare(c,'10')>=0 ? 0 : 1,'half_up').replace(/^0$/,'under 0.1');}catch{return c;}};
const moneyText=(o:Overage)=>o.money===null ? '' : ` (≈ ${o.money==='0.00' ? 'under $0.01' : `$${o.money}`}, modelled)`;

// The command links of this view are exactly five Bobert commands (Cost Advisor, the two audit commands, Share and Report a problem); none carries arguments.
// The footer's three web links are fixed constants and only ever followed on a click.
// The workspace audit card shows counts and times only, never a path or folder name.
const ADVISOR_LINK = 'command:bobert.costAdvisor';
const AUDIT_LINK = { check: 'command:bobert.auditWorkspace', show: 'command:bobert.audit.show' } as const;
const SHARE_LINK = 'command:bobert.share';
const REPORT_LINK = 'command:bobert.reportProblem';
const FOOTER = `<footer class="community muted small"><a href="${REPORT_LINK}">Report a problem</a> · <a href="${SHARE_LINK}">Copy share link</a> · <a href="${LINKS.rate}"><span aria-hidden="true">★</span> Rate on Open VSX</a> · <a href="${LINKS.star}">Star on GitHub</a> · <a href="${LINKS.support}"><span aria-hidden="true">☕</span> Support</a></footer>`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function auditCard(a: AuditSummary | undefined, now: string): string {
 try { return buildAuditCard(a, now); } catch { return ''; } // the card can never take the gauge down
}
function buildAuditCard(a: AuditSummary | undefined, now: string): string {
 if (!a) return '';
 const ago = a.state === 'checked' ? relativeTime(a.checkedAt, new Date(now)) : '';
 const checked = ago ? ` · checked ${ago}` : '';
 const count = (n: number | undefined): number => n !== undefined && Number.isInteger(n) && n >= 0 ? n : 0;
 const items = count(a.items), unclear = count(a.unclear);
 const size = a.state === 'checked' && typeof a.bytes === 'number' && Number.isFinite(a.bytes) && a.bytes >= 0 ? sizePhrase({ bytes: a.bytes, lowerBound: a.lowerBound === true }) : '';
 const text = a.state === 'checked' ? `${countsText(items, unclear, size)}${checked}`
  : a.state === 'unavailable' ? "This folder can't be checked. Run the audit to see why."
  : `Run the workspace audit to find files Kiro can read but probably doesn't need.${a.lastDate && DAY.test(a.lastDate) ? ` Last checked ${a.lastDate} (UTC).` : ''}`;
 return `<section class="audit-card" aria-labelledby="audit-heading"><h2 id="audit-heading">Workspace audit</h2><p>${safe(text)}</p><p class="audit-actions"><a class="button primary" href="${AUDIT_LINK.check}">Run audit</a>${a.state === 'checked' ? ` <a class="button secondary" href="${AUDIT_LINK.show}">Show results</a>` : ''}</p></section>`;
}

// The advisor section itself has no command links. With the inline form present, the one command link is only a fallback:
// the stylesheet hides it once the page script has delivered a live model (html[data-cg-live]) and hides the form until then.
function withAdvisorButton(advisorHtml: string, formHtml: string): string {
 const link = `<a class="button primary" href="${ADVISOR_LINK}">Open Cost Advisor</a>`;
 const button = formHtml ? `<p class="advisor-actions advisor-fallback"><span class="small">Update your plan answers:</span> ${link}</p>` : `<p class="advisor-actions">${link}</p>`;
 return advisorHtml.endsWith('</section>') ? `${advisorHtml.slice(0, -'</section>'.length)}${button}${formHtml}</section>` : `${advisorHtml}${button}${formHtml}`;
}

export function inlineAdvisorForm(a:AdvisorAnswers,epoch:number):string {
 const plan=a.plan??'unsure',billing=a.billing??'unsure',addOns=a.addOns??'unsure',credits=a.addOnCredits??'';
 const options=(values:[string,string][])=>values.map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
 const error=(id:string)=>`<p id="${id}" class="field-error"></p>`; // filled in by the page script next to the field that needs attention
 // Open while the plan is unconfirmed so the question is visible; a confirmed plan keeps the form folded away.
 return `<details id="advisor-change" class="advisor-change"${a.plan===null?' open':''}><summary>Change your plan answers</summary><form id="advisor-form" data-advisor-epoch="${epoch}" data-plan="${plan}" data-billing="${billing}" data-add-ons="${addOns}" data-add-on-credits="${safe(credits)}"><fieldset><legend>Your plan details</legend>
 <div class="field"><label for="advisor-plan">Plan</label><select id="advisor-plan" name="plan">${options([['unsure','Not sure'],['free','Free'],['pro','Pro'],['pro_plus','Pro+'],['pro_max','Pro Max'],['power','Power'],['reset','Clear my answers']])}</select>${error('advisor-plan-error')}</div>
 <div class="field"><label for="advisor-billing">Account type</label><select id="advisor-billing" name="billing">${options([['unsure','Not sure'],['consumer_prepaid','Personal subscription'],['enterprise_postpaid','Enterprise']])}</select>${error('advisor-billing-error')}</div>
 <div class="field"><label for="advisor-add-ons">Purchased add-on credits</label><select id="advisor-add-ons" name="addOns">${options([['unsure','Not sure'],['none','None'],['some','Yes']])}</select>${error('advisor-add-ons-error')}</div>
 <div class="field"><label for="advisor-credits">Remaining add-on credits, if known</label><div class="input-unit"><input id="advisor-credits" name="addOnCredits" type="text"/><span class="unit">credits, e.g. 250</span></div>${error('advisor-credits-error')}</div>
 <div class="form-actions"><button type="submit">Update estimate</button><button id="advisor-review-again" type="button" hidden>Reload my answers</button></div></fieldset></form></details><p id="advisor-status" class="small" role="status" aria-live="polite"></p>`;
}

function observedContext(h: ReturnType<typeof view>['history'], now: string): string {
 const comparison = cycleComparison(h), pace = todayPace(h, now);
 if (comparison.status === 'not_observed' && pace.status === 'not_observed') return ''; // nothing to show yet: no card at all
 const elapsed = (ms: number) => `${Math.floor(ms / 86400000)} d ${Math.floor(ms % 86400000 / 3600000)} h`;
 const duration = (ms: number) => `${Math.floor(ms / 3600000)} h ${Math.floor(ms % 3600000 / 60000)} min`;
 let cycle = 'Not enough history yet to compare with last cycle. This fills in after your next reset.';
 if (comparison.status === 'not_comparable') cycle = "Last cycle can't be compared because of a gap or limit change in the history.";
 if (comparison.status === 'observed') cycle = `${elapsed(comparison.offsetMs!)} into the cycle: ${comparison.current!.usage} credits as of ${updated(comparison.current!.at)}. Last cycle at the same point: ${comparison.previous!.usage} credits as of ${updated(comparison.previous!.at)}.`;
 if (comparison.status === 'bracketed') cycle = `${elapsed(comparison.offsetMs!)} into the cycle: ${comparison.current!.usage} credits as of ${updated(comparison.current!.at)}. Last cycle had no update near that point; it stood at ${comparison.before!.usage} credits on ${updated(comparison.before!.at)} and ${comparison.after!.usage} credits on ${updated(comparison.after!.at)}.`;
 let today = "Today's pace isn't available yet.";
 if (pace.status === 'not_comparable') today = "Today's pace can't be compared because of a gap or limit change in the history.";
 if (pace.status === 'observed') today = `Since ${pace.from!.slice(11, 16)} UTC: ${pace.netChange} credits over ${duration(pace.elapsedMs!)}, as of ${updated(pace.asOf!)}.${pace.allocation === null ? '' : ` The 24-hour allocation at the last update was ${pace.allocation} credits — context, not a daily verdict.`}`;
 return `<section id="usage-context" aria-labelledby="usage-context-heading"><h2 id="usage-context-heading">Observed usage</h2><h3>This cycle vs last cycle</h3><p>${safe(cycle)}</p><h3>Today (UTC)</h3><p>${safe(today)}</p></section>`;
}

// The observed-usage card can never take the gauge down.
function contextCard(h: ReturnType<typeof view>['history'], now: string): string {
 try { return observedContext(h, now); } catch { return ''; }
}

// Static, script-free summary of saved exclusions and the observed use trend; every string is escaped here and a failure only omits the section.
function resultsSection(results: StoredResults | undefined, h: ReturnType<typeof view>['history'], now: string): string {
 if (!results) return '';
 try {
  const t = resultsText(results, h, now);
  return `<section id="results-summary" aria-labelledby="results-summary-heading"><h2 id="results-summary-heading">${safe(t.heading)}</h2><p class="muted small">${safe(t.scope)}</p><h3>${safe(t.exclusionsHeading)}</h3><ul>${t.exclusions.map(l => `<li>${safe(l)}</li>`).join('')}</ul>${t.notes.map(l => `<p class="muted small">${safe(l)}</p>`).join('')}<h3>${safe(t.trendHeading)}</h3><p>${safe(t.trend)}</p></section>`;
 } catch { return ''; }
}

// The recap card is static text; a failure only omits it.
function recapCard(recap: Recap | undefined): string {
 if (!recap) return '';
 try { return recapSection(recap); } catch { return ''; }
}

/** Presentation only: billing eligibility and exact projections remain in the core. */
export function present(o: ReturnType<typeof view>, diagnostics: string[] = [], costHtml = '', advisorHtml = '', audit?: AuditSummary, now = new Date().toISOString(), notKiro = false, insights: PlanInsights = NO_INSIGHTS, advisorForm = '', results?: StoredResults, recap?: Recap) {
 const h=o.history,f=o.forecast;
 const selected=f.estimates.find(e=>e.method===f.selectedMethod && e.status==='qualified');
 const stale=o.status==='stale' || f.reasons.includes('stale');
 const collecting=!stale && o.status==='observed' && f.reasons.includes('insufficient_comparable_coverage');
 const eligible=!stale && o.status==='observed' && f.status==='qualified' && !!selected;
 const blocked=diagnostics.find(c=>c==='runtime_unsupported' || c==='storage_newer');
 const reason=blocked ?? f.reasons[0] ?? o.status;
 // Outside Kiro without a chosen source, an empty source is expected rather than a fault.
 const absent=notKiro && !blocked && diagnostics.includes('no_source_logs');
 const tier=stale ? 'Forecast paused — stale data' : f.tier==='provisional' && eligible ? 'Provisional estimate — limited history' : eligible ? 'Regular forecast' : collecting ? 'Forecast not ready yet — more history needed' : 'Forecast unavailable';
 const tag=f.tier==='provisional' ? 'Based on limited history' : 'Based on 7+ days';
 const budget=o.availablePerDay;
 const exhausted=eligible && selected.exhaustionStatus==='already_exhausted_as_of';
 // Usage above the reported limit is a valid observation (e.g. Enterprise overage); the counter alone does not say why.
 const above=o.usage!==null && o.baseLimit!==null && compare(o.usage,o.baseLimit)>0;
 const over=eligible && (exhausted || selected.budgetComparison==='above_budget');
 const tight=eligible && !over && budget!==null && compare(budget,'0')>0 && compareRatios(selected.ratePerDay!,9,budget,10)>=0;
 const outlook=exhausted ? above ? 'Above reported limit' : 'Reported limit reached' : over ? 'Likely to exceed' : tight ? 'At risk' : eligible ? 'On track' : stale ? 'Stale data' : collecting ? 'Collecting data' : 'Unavailable';
 const exhaustion=eligible ? selected.estimatedExhaustionDayUTC : null;
 const allowance=budget===null ? '' : ` • ${compact(budget)}/day`;
 const status=stale ? 'Stale data' : !eligible ? collecting ? 'Collecting data' : 'Unavailable' : exhausted ? f.tier==='provisional' ? 'Provisional • limit reached' : above ? 'Above reported limit' : 'Reported limit reached' : f.tier==='provisional' ? `Provisional${exhaustion ? ` • runs out ${date(exhaustion)}` : allowance}` : over ? `Likely to exceed${exhaustion ? ` • runs out ${date(exhaustion)}` : allowance}` : `${tight ? 'At risk' : 'On track'}${allowance}`;
 // Stale or unavailable data keeps only the warning icon. The warning background means budget risk; red means the reported limit is reached or exceeded.
 const alert=stale || over || tight || exhausted || (!eligible && !collecting);
 const risk=over || tight || exhausted;
 const severity: 'none' | 'warning' | 'error' = exhausted ? 'error' : risk ? 'warning' : 'none';
 const resetMs=o.resetAt ? Date.parse(o.resetAt) : NaN, evalMs=f.evaluatedAt ? Date.parse(f.evaluatedAt) : NaN;
 const daysLeft=Number.isFinite(resetMs) && Number.isFinite(evalMs) ? Math.ceil((resetMs-evalMs)/86400000) : null;
 const resetIn=daysLeft===null ? '' : daysLeft<0 ? 'passed' : daysLeft===0 ? 'today' : daysLeft===1 ? 'in 1 day' : `in ${daysLeft} days`;
 const whole=(s:string)=>{const v=Number(s);return Number.isFinite(v) ? String(Math.round(v)) : s;};
 const resetDate=o.resetAt ? date(o.resetAt) : null;
 const lastsLine=eligible && selected.projectedUsageAtReset!==null && o.baseLimit!==null && !exhausted && !exhaustion ? `At the observed pace you will use about ${whole(selected.projectedUsageAtReset)} of ${whole(o.baseLimit)} reported credits by the reset${resetDate ? ` on ${resetDate}` : ''}.` : '';
 // Modelled overage (exact decimals, catalog price only); never an invoice and absent when nothing exceeds the reported limit.
 const projectedOver=eligible && selected.projectedUsageAtReset!==null ? overageOver(selected.projectedUsageAtReset,o.baseLimit,now) : null;
 // Only for a current observation: after a reset or with stale data the figure belongs to another cycle and is not "so far".
 const observedOver=above && o.status==='observed' && !o.flags.includes('unsupported_extra_credits') ? overageOver(o.usage,o.baseLimit,now) : null;
 // Plan hints (controller) are already empty unless every condition holds. The next-larger-plan comparison follows the projected overage line.
 const attempt=(text:()=>string)=>{try{return text();}catch{return '';}}; // a hint can never take the view down
 const noteLines=[projectedOver ? `At this pace by the reset: about ${creditsText(projectedOver.credits)} credits over${moneyText(projectedOver)}.` : '',
  projectedOver && insights.larger ? attempt(()=>largerPlanText(insights.larger!)) : '',insights.rightsize ? attempt(()=>rightSizeText(insights.rightsize!)) : ''].filter(Boolean);
 // The dollar figures above trace back to one reviewed price; said once, inside About these numbers.
 const priced=[observedOver,projectedOver].find(x=>x?.money);
 const priceNote=priced ? attempt(()=>`Dollar figures use $${priced.pricePerCredit} per credit from price list ${priced.catalogVersion}, reviewed ${date(priced.reviewedOn!,true)}.`) : '';
 const overFigure=observedOver ? `${creditsText(observedOver.credits)} credits` : '';
 const explanation=absent ? NOT_KIRO_TEXT : eligible ? exhausted ? above ? (observedOver ? '' : 'Usage was above the reported credit limit at the last account update.') : 'You had reached the reported credit limit at the last account update.' : exhaustion ? `At the observed pace your credits run out on ${date(exhaustion,true)} (UTC), before the reset${resetDate ? ` on ${resetDate}` : ''}.` : selected.exhaustionStatus==='zero_observed_rate' ? 'Your counter has not moved recently, so no run-out date is projected. New usage can change this.' : `${lastsLine ? lastsLine.replace(/\.$/,' — enough to last until then.') : 'Your credits are not projected to run out before the reset.'}${tight ? ' The margin is small: your pace is within 10% of the daily budget.' : ''}` : explanations[stale ? 'stale' : reason] ?? 'The available account updates do not support a safe forecast.';
 // A provisional estimate is never styled or headlined as reassuringly as a regular forecast.
 const early=eligible && f.tier==='provisional' && outlook==='On track';
 const heading=absent ? 'Kiro not detected' : early ? 'Looks on track so far' : outlook;
 const tone=absent ? 'neutral' : stale || (!eligible && !collecting) ? 'warn' : !eligible || early ? 'neutral' : exhausted || over ? 'bad' : tight ? 'warn' : 'ok';
 const icon={ok:'✓',warn:'!',bad:'✕',neutral:'…'}[tone];
 const usedPct=o.usage!==null && o.baseLimit!==null && compare(o.baseLimit,'0')>0 ? Math.max(0,Math.min(100,Math.round(Number(o.usage)/Number(o.baseLimit)*100))) : null;
 const limitations=eligible && f.tier==='provisional' ? 'This limited window may not represent future usage.' : '';
 const tooltip=[eligible ? `${outlook} · ${tier}` : outlook,`Daily credit budget until reset: ${budget===null ? 'Not available' : `${budget} credits per day`}`,eligible ? `Observed rate: ${selected.ratePerDay} credits per day` : '',`Last account update: ${o.observedAt ? updated(o.observedAt) : 'Not available'}. Click to open your budget.`].filter(Boolean).join('\n');
 const coverage=`${h.coverage.snapshotCount} distinct snapshots; ${h.coverage.completeUtcDays} complete, ${h.coverage.partialUtcDays} partial, ${h.coverage.unknownUtcDays} unknown UTC days; ${h.coverage.gaps.length} gaps or quality barriers`;
 const forecastRows=row('Observed spending rate',eligible ? `${selected.ratePerDay} credits per day` : null)
  +row('Projected credit usage at reset',eligible ? selected.projectedUsageAtReset : null)
  +row('Projected capacity left at reset (reported limit)',eligible ? selected.projectedRemainingBaseAtReset : null)
  +row('Estimated exhaustion date (UTC)',exhaustion ? date(exhaustion,true) : null);
 const windowRows=row('Forecast observation coverage',eligible ? `${selected.snapshotCount} comparable snapshots over ${selected.windowDays} UTC 24-hour days` : null)
  +row('Forecast window (UTC)',eligible ? `${selected.windowFrom} to ${selected.windowTo}` : null)
  +row('Observed history window (UTC)',h.coverage.from && h.coverage.to ? `${h.coverage.from} to ${h.coverage.to}` : null)
  +row('Coverage',coverage);
 const notes=[...o.flags,...diagnostics.filter(c=>c!=='source_changed'),...f.reasons,...new Set(h.coverage.gaps.map(g=>g.reason))].map(readable).join(', ') || 'No known issues in the retained observations';
 const methods=f.estimates.map(e=>row(readable(e.method),e.status==='qualified' ? `${e.ratePerDay} credits / 24h; ${e.tier}` : `Unavailable: ${e.reasons.map(readable).join(', ')}`)).join('');
 const details=row('Forecast method',f.selectedMethod ? readable(f.selectedMethod) : null)+row('Rate versus daily budget',eligible ? readable(selected.budgetComparison) : null)
  +row('Forecast evidence',selected && selected.evidenceCredits!==null ? `${selected.evidenceCredits} credits over ${(selected.evidenceMilliseconds!/86400000).toFixed(2)} observed days; updates on ${selected.observedDays} UTC days; ${selected.cyclesUsed} billing cycle(s)` : null)
  +row('Forecast qualifiers',f.qualifiers.length ? f.qualifiers.map(readable).join(', ') : null)
  +row('Evidence-backed cycle start (UTC)',h.cycleStartAt)+row('Cycle start coverage',h.coverage.initialPeriodUnknown ? 'Unknown or partially observed' : 'Boundary observed')
  +row('Interval average net change / 24h',h.averageObservedNetChangePerDay)+row('Recent 7-day trend',readable(f.recentTrend.direction))
  +row('Exact daily credit budget / 24h',budget)+row('Exact billing reset (UTC)',o.resetAt)+row('Exact last account update (UTC)',o.observedAt)+row('Source time interpretation',o.flags.includes('assumed_source_timezone') ? 'Device timezone assumed for offset-free source timestamps' : 'See source timestamp metadata')
  +row('Quality codes',notes);
 const chart=presentChartParts(o);
 const hasFigures=o.usage!==null || o.baseLimit!==null || o.resetAt!==null; // with no account update there are no figures to show

 const freshness=stale ? 'Stale — waiting for a fresh account update' : o.status==='observed' ? 'Fresh' : 'Not current';
 const stat=(label:string,value:string,note='',live=false)=>`<div class="stat"><dt>${safe(label)}</dt><dd${live ? ' id="usage-live" aria-live="polite" aria-atomic="true"' : ''}>${safe(value)}</dd>${note ? `<dd class="muted small">${safe(note)}</dd>` : ''}</div>`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your credit budget</title><style>
 :root{--ok:var(--vscode-charts-green,#3fb950);--warn:var(--vscode-editorWarning-foreground,#cca700);--bad:var(--vscode-errorForeground,#f14c4c);--neutral:var(--vscode-descriptionForeground,#888)}
 *{box-sizing:border-box}body{font:var(--vscode-font-size,14px)/1.5 var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;margin:0}main{max-width:820px;margin:auto}a{color:var(--vscode-textLink-foreground,#3794ff)}a:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}h1{font-size:1.1rem;font-weight:600;margin:0 0 12px;color:var(--vscode-descriptionForeground)}h2{font-size:1.1rem;margin:0 0 10px}h3{font-size:1rem}h4{margin:8px 0}p{margin:8px 0}.muted,.label{color:var(--vscode-descriptionForeground)}.small{font-size:.9rem}
 section{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:18px;margin-top:16px;background:var(--vscode-editorWidget-background,transparent)}
 .hero{margin-top:0;border-left:5px solid var(--tone)}.hero.ok{--tone:var(--ok)}.hero.warn{--tone:var(--warn)}.hero.bad{--tone:var(--bad)}.hero.neutral{--tone:var(--neutral)}
 .hero h2{font-size:1.8rem;line-height:1.2;margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px}.status-icon{display:inline-flex;align-items:center;justify-content:center;width:1.4em;height:1.4em;border-radius:50%;border:2px solid var(--tone);color:var(--tone);font-size:.7em;font-weight:700}.tag{font-size:.8rem;font-weight:400;border:1px solid var(--vscode-panel-border);border-radius:12px;padding:1px 9px;color:var(--vscode-descriptionForeground)}
 .lead{font-size:1.05rem;margin:10px 0 14px}.bar{display:block;width:100%;height:10px;border-radius:5px;background:var(--vscode-panel-border);overflow:hidden;margin:6px 0 16px}.bar>rect{height:10px;fill:var(--tone)}.bar-label{margin:-10px 0 16px}
 .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:0}.stat dt{color:var(--vscode-descriptionForeground);font-size:.9rem}.stat dd{margin:0;font-size:1.35rem;font-weight:600;overflow-wrap:anywhere}.stat dd.small{font-size:.9rem;font-weight:400}
 .audit-card h2{margin:0 0 4px}.audit-card p{margin:4px 0}.audit-actions,.advisor-actions{display:flex;flex-wrap:wrap;gap:8px}a.button{display:inline-block;padding:4px 12px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;text-decoration:none;font-weight:500;cursor:pointer}a.button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}a.button.primary:hover{background:var(--vscode-button-hoverBackground)}a.button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}a.button.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
 .community{margin:20px 0 4px;text-align:center}
 .meta{margin:14px 0 0;padding-top:12px;border-top:1px solid var(--vscode-panel-border)}.meta p{margin:0}.about>summary{margin:4px 0 0;font-weight:400}.about p{margin:6px 0 0}.overage-now strong{font-size:1.6rem;margin-right:4px}#usage-context h3{margin:12px 0 2px}
 .badge{display:inline-block;padding:1px 9px;border:1px solid var(--vscode-panel-border);border-radius:12px;font-size:.85rem}.verdict{font-size:1.05rem;font-weight:600;margin:10px 0}.plan-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.plan-row strong{font-size:1.2rem}.action{border:1px dashed var(--vscode-panel-border);border-radius:8px;padding:8px 12px;margin:10px 0}
 table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:9px 0;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}th{width:45%;font-weight:400;color:var(--vscode-descriptionForeground);padding-right:16px}
 summary{cursor:pointer;margin:10px 0;font-weight:500}details>summary{list-style-position:inside}.advanced>summary{font-size:1.05rem;font-weight:600;margin:0}.advanced[open]>summary{margin-bottom:12px}.advanced h3{margin:20px 0 8px;font-size:1.05rem;border-top:1px solid var(--vscode-panel-border);padding-top:14px}
 .estimate{border:1px solid var(--vscode-panel-border);border-left:5px solid var(--neutral);border-radius:8px;padding:12px 16px;margin:12px 0}.estimate-supported{border-left-color:var(--ok)}.estimate-modelled{border-left-color:var(--warn)}.estimate-comparison_only{border-left-color:var(--neutral)}.estimate p{margin:6px 0}.estimate .tier{margin-top:0}.estimate .figure{font-size:1rem}.estimate .figure strong{font-size:1.6rem;margin-right:6px}.estimate .verdict{font-size:1rem;font-weight:500}
 .cost-strategy{border-top:1px solid var(--vscode-panel-border);padding:10px 0}.cost-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 16px}.cost-grid dt{color:var(--vscode-descriptionForeground)}.cost-grid dd{margin:0}.cost-grid dt,.cost-grid dd,.cost-result li{overflow-wrap:anywhere}
 @media(max-width:540px){.stats{grid-template-columns:minmax(0,1fr)}.estimate{padding:10px 12px}body{padding:12px}section{padding:14px}.hero h2{font-size:1.5rem}.cost-grid{grid-template-columns:minmax(0,1fr)}.cost-grid dd{margin-bottom:6px}th{width:42%}}
 @media(forced-colors:active){a.button,.recap-actions button,#advisor-form button,#advisor-form select,#advisor-form input{border-color:ButtonText}.hero{border-left-color:Highlight}.bar>rect{fill:Highlight}}
 #results-summary ul,#recap-lines{margin:8px 0;padding-left:1.4em}
 .recap-actions{display:flex;flex-wrap:wrap;gap:8px}.recap-actions button{padding:4px 12px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;font:inherit;font-weight:500;cursor:pointer;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.recap-actions button:hover{background:var(--vscode-button-secondaryHoverBackground)}.recap-actions button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
 #recap-preview{margin:12px 0}#recap-canvas{display:block;max-width:100%;height:auto;border:1px solid var(--vscode-panel-border)}
 .advisor-change{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:0 14px;margin:12px 0}.advisor-change>summary{margin:10px 0}.advisor-change[open]>summary{margin-bottom:6px}.advisor-fallback{align-items:center}html:not([data-cg-live]) .advisor-change{display:none}#advisor-status{margin:4px 0}html[data-cg-live] .advisor-fallback{display:none}
 #advisor-form fieldset{border:0;margin:0;padding:0;min-width:0}#advisor-form legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}#advisor-form .field{margin:0 0 14px;max-width:26rem}#advisor-form label{display:block;margin:0 0 4px;font-weight:500}
 #advisor-form select,#advisor-form input{display:block;width:100%;min-height:28px;padding:4px 8px;font:inherit;border-radius:4px}#advisor-form select{color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border,var(--vscode-panel-border))}#advisor-form input{color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}#advisor-form input::placeholder{color:var(--vscode-input-placeholderForeground)}
 #advisor-form select:focus,#advisor-form input:focus{outline:2px solid var(--vscode-focusBorder);outline-offset:-1px}#advisor-form select[aria-invalid="true"],#advisor-form input[aria-invalid="true"]{outline:2px solid var(--vscode-errorForeground);outline-offset:-1px}#advisor-form .field-error{color:var(--vscode-errorForeground);margin:4px 0 0}#advisor-form .field-error:empty{display:none}#advisor-form .input-unit{display:flex;align-items:center;gap:8px}#advisor-form .input-unit input{flex:1 1 auto;width:auto;min-width:0}#advisor-form .unit{color:var(--vscode-descriptionForeground)}
 #advisor-form .form-actions{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}#advisor-form button{padding:4px 14px;min-height:28px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;font:inherit;font-weight:500;cursor:pointer}#advisor-form button[type="submit"]{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}#advisor-form button[type="submit"]:hover{background:var(--vscode-button-hoverBackground)}#advisor-form #advisor-review-again{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}#advisor-form #advisor-review-again:hover{background:var(--vscode-button-secondaryHoverBackground)}#advisor-form button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
 ${CHART_CSS}
 </style></head><body><main><h1>Your credit budget</h1>
 <section class="hero ${tone}" aria-labelledby="status-heading"><h2 id="status-heading"><span class="status-icon" aria-hidden="true">${icon}</span>${safe(heading)}${eligible ? `<span class="tag">${safe(tag)}</span>` : ''}</h2>
 ${overFigure ? `<p class="lead overage-now"><strong>${safe(overFigure)}</strong> over the limit so far${safe(moneyText(observedOver!))}.</p>` : ''}${explanation ? `<p class="lead">${safe(explanation)}</p>` : ''}${limitations ? `<p class="small">${safe(limitations)}</p>` : ''}${noteLines.map(l=>`<p class="small overage">${safe(l)}</p>`).join('')}
 ${usedPct===null ? '' : `<svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect width="${usedPct}" height="10"/></svg><p class="bar-label muted small">${usedPct}% of the reported credit limit used</p>`}
 ${hasFigures ? `<dl class="stats">${stat('Credits used',o.usage ?? 'Not available',o.baseLimit===null ? '' : `of ${o.baseLimit} reported credits`,true)}${above ? '' : stat('Credits left',o.remainingBaseCredits ?? 'Not available',budget!==null && compare(budget,'0')>0 ? `Daily budget until reset: ${compact(budget)} per day` : '')}${stat('Next reset',o.resetAt ? date(o.resetAt,true) : 'Not available',[resetIn,'UTC'].filter(Boolean).join(' · '))}</dl>` : ''}
 ${o.observedAt ? `<div class="meta muted small"><p>Last account update: ${safe(`${updated(o.observedAt)} · ${freshness}`)}</p><details class="about"><summary><span aria-hidden="true">ⓘ</span> About these numbers</summary><p>${safe(ABOUT)}</p>${priceNote ? `<p>${safe(priceNote)}</p>` : ''}</details></div>` : ''}</section>
 ${chart.main}
 ${contextCard(h, now)}
 ${recapCard(recap)}
 ${withAdvisorButton(advisorHtml,advisorForm)}
 ${auditCard(audit, now)}
 ${resultsSection(results, h, now)}
 ${costHtml}
 <section id="advanced-details" aria-label="Advanced details"><details class="advanced"><summary>Advanced details</summary><p class="muted small">Forecast methods and evidence, coverage, exact UTC timestamps, qualifiers, chart data and billing assumptions.</p>
 <h3>Forecast</h3><p>${safe(tier)}</p>${collecting || (eligible && f.tier==='provisional') ? `<p>${safe(COLLECTING_POLICY)}</p>` : ''}<table>${forecastRows}</table><p class="muted small">Estimates assume the observed rate continues. They are not guarantees or statistical confidence intervals. Negative projected credits indicate usage beyond the reported limit; this does not by itself establish overage charges.</p>
 ${chart.advanced}
 <h3>Observed history</h3><p>Only retained, comparable account updates support the forecast. Missing days stay unknown.</p><table>${windowRows}${row('Reported credit limit',o.baseLimit)}</table><details><summary>Recent account updates and daily changes</summary><table>${h.points.slice(-8).map(p=>row(p.observedAt,p.usage)).join('')}</table><h4>Daily observed changes (UTC)</h4><table>${h.days.slice(-14).map(d=>row(d.day+(d.complete ? ' (complete)' : ' (partial/unknown)'),d.netChange)).join('')}</table><p class="muted small">Partial values cover only supported intervals within that day. Cross-day changes are never distributed across missing days.</p></details>
 <h3>Data quality / notes</h3><p>The daily budget summary is truncated to one decimal; the exact allowance is in the technical details. Daily budget is an allocation of the remaining reported capacity at the last observation across the time left until reset, using 24-hour days. The reported credit limit is not verified as base-only or total capacity; it may include purchased add-on credits, and usage can exceed it. Usage since that account update is unknown. Extra credits, purchased balances and total availability remain unknown.</p><p class="muted small">Forecast policy v${f.policy.version}: provisional estimates need 3 comparable updates over at least 48 hours; regular in-cycle forecasts need 8 over at least 7 days. Pooled 7/14/28/84-day estimates need enough observed time, updates on enough different days and no single dominant interval; unobserved time is never counted as zero. Positive gaps over 36 hours are barriers for in-cycle methods, and the latest update must be fresh (${f.policy.maxAgeHours} hours).</p><h4>Technical details</h4><table>${details}</table><h4>Forecast methods</h4><table>${methods}</table><h4>Gaps and quality barriers</h4><table>${h.coverage.gaps.slice(-8).map(g=>row(`${g.from} to ${g.to}`,readable(g.reason))).join('')}</table><p class="muted small">Unknown periods are not zero. Interval net changes are not gross charges. Exact rolling boundaries must be observed; no daily consumption is invented.</p>
 <div id="export-tools"><h3>Export your observed history</h3><p>Save your retained account updates as a CSV file. You choose where it goes.</p><p class="recap-actions"><button type="button" id="export-csv" hidden>Export CSV…</button></p><p id="export-status" role="status"></p></div>
 </details></section>
 ${FOOTER}</main></body></html>`;
 if(absent)return {text:'$(info) Kiro not detected',tooltip:NOT_KIRO_TEXT,warning:false,severity:'none' as const,html,forecast:false,absent:true};
 if(blocked)return {text:`$(warning) ${BLOCKED_TEXT[blocked]}`,tooltip:explanations[blocked],warning:false,severity:'none' as const,html,forecast:false,absent:false};
 return {text:`${alert ? '$(warning)' : '$(gauge)'} Kiro credits: ${status}`,tooltip,warning:risk,severity,html,forecast:eligible,absent:false};
}
