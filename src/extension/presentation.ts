import type { view } from '../view.ts';
import { compare, compareRatios } from '../decimal.ts';
import { readable, updated, date } from './labels.ts';
import { presentChartParts, CHART_CSS } from './chart.ts';

const safe = (s: string | null) => s === null ? 'Not available' : s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
const row = (label: string, value: string | null) => `<tr><th scope="row">${safe(label)}</th><td>${safe(value)}</td></tr>`;
const card = (label: string, value: string | null, note = '') => `<div class="card"><div class="label">${safe(label)}</div><div class="value">${safe(value)}</div>${note ? `<div class="muted small">${safe(note)}</div>` : ''}</div>`;
// Compact budgets truncate rather than round up the spending allowance.
const compact = (s: string) => {
 const [whole,fraction='']=s.split('.');
 if (compare(s,'0')>0 && compare(s,'0.1')<0) return '<0.1';
 return fraction[0] && fraction[0]!=='0' ? `${whole}.${fraction[0]}` : whole;
};
// Short, always-visible wording; the long policy sentence for collecting data lives under Advanced details.
const COLLECTING_POLICY='A provisional estimate requires at least 48 hours and 3 comparable account updates; a regular forecast requires at least 7 days and 8 updates. Gaps and billing changes can restart this window.';
const explanations: Record<string,string> = {
 stale:'Forecast paused — stale data. The last account update is too old; waiting for a fresh one.',
 insufficient_comparable_coverage:'Forecast not ready yet — more history needed.',
 multiple_accounts:'Updates from different accounts cannot be combined.', unknown_account:'Account continuity could not be established.',
 conflicting_snapshots:'Account updates conflict, so an estimate would be misleading.',
 reset_elapsed:'The billing reset has passed. Waiting for an account update from the new cycle.',
 reset_unknown:'The billing reset date is not known.', reset_regressed:'Billing cycle dates are inconsistent.',
 future_observation:'The account update is dated in the future. Check the device clock.',
 missing_billing:'Required credit usage or limit information is missing.',
 unsupported_extra_credits:'Extra-credit information is not supported, so a forecast is unavailable.',
 unavailable:'Waiting for usable local account updates.',
};

/** Presentation only: billing eligibility and exact projections remain in the core. */
export function present(o: ReturnType<typeof view>, diagnostics: string[] = [], costHtml = '', advisorHtml = '') {
 const h=o.history,f=o.forecast;
 const selected=f.estimates.find(e=>e.method===f.selectedMethod && e.status==='qualified');
 const stale=o.status==='stale' || f.reasons.includes('stale');
 const collecting=!stale && o.status==='observed' && f.reasons.includes('insufficient_comparable_coverage');
 const eligible=!stale && o.status==='observed' && f.status==='qualified' && !!selected;
 const reason=f.reasons[0] ?? o.status;
 const tier=stale ? 'Forecast paused — stale data' : f.tier==='provisional' && eligible ? 'Provisional estimate – limited history' : eligible ? 'Regular forecast' : collecting ? 'Forecast not ready yet — more history needed' : 'Forecast unavailable';
 const budget=o.availablePerDay;
 const exhausted=eligible && selected.exhaustionStatus==='already_exhausted_as_of';
 // Usage above the reported limit is a valid observation (e.g. Enterprise overage); the counter alone does not say why.
 const above=o.usage!==null && o.baseLimit!==null && compare(o.usage,o.baseLimit)>0;
 const over=eligible && (exhausted || selected.budgetComparison==='above_budget');
 const tight=eligible && !over && budget!==null && compare(budget,'0')>0 && compareRatios(selected.ratePerDay!,9,budget,10)>=0;
 const outlook=exhausted ? above ? 'Above reported limit' : 'Reported limit reached' : over ? 'Over budget' : tight ? 'Tight budget' : eligible ? 'On track' : stale ? 'Stale data' : collecting ? 'Collecting data' : 'Unavailable';
 const exhaustion=eligible ? selected.estimatedExhaustionDayUTC : null;
 const allowance=budget===null ? '' : ` • ${compact(budget)}/day`;
 const status=stale ? 'Stale data' : !eligible ? collecting ? 'Collecting data' : 'Unavailable' : exhausted ? f.tier==='provisional' ? 'Provisional • exhausted' : above ? 'Above reported limit' : 'Reported limit reached' : f.tier==='provisional' ? `Provisional${exhaustion ? ` • empty ${date(exhaustion)}` : allowance}` : over ? `Over budget${exhaustion ? ` • empty ${date(exhaustion)}` : allowance}` : `${tight ? 'Tight' : 'On track'}${allowance}`;
 const warning=stale || over || tight || (!eligible && !collecting);
 const explanation=eligible ? exhausted ? above ? 'Observed usage was above the reported credit limit at the last account update. The counter alone does not establish overage charges, purchased balance or billing eligibility.' : 'Observed usage had reached the reported credit limit at the last account update.' : exhaustion ? `Estimated to run out on ${date(exhaustion,true)} (UTC), if the observed rate continues.` : selected.exhaustionStatus==='zero_observed_rate' ? 'No exhaustion date at the observed zero rate. Future usage can change this.' : 'The reported credit limit is not projected to be reached before reset if the observed rate continues.' : explanations[stale ? 'stale' : reason] ?? 'The available account updates do not support a safe forecast.';
 const limitations=eligible && f.tier==='provisional' ? 'This limited window may not represent future usage. A regular forecast needs at least 7 days and 8 comparable updates.' : '';
 const tooltip=[outlook,tier,`Daily credit budget until reset: ${budget ?? 'Not available'} credits / 24h`,eligible ? `Observed rate: ${selected.ratePerDay} credits / 24h` : '',explanation,`Last account update: ${o.observedAt ?? 'Not available'}`, 'Amounts are observed as of that update; later usage is unknown. Click to open your budget.'].filter(Boolean).join('\n');
 const coverage=`${h.coverage.snapshotCount} distinct snapshots; ${h.coverage.completeUtcDays} complete, ${h.coverage.partialUtcDays} partial, ${h.coverage.unknownUtcDays} unknown UTC days; ${h.coverage.gaps.length} gaps or quality barriers`;
 const forecastRows=row('Observed spending rate',eligible ? `${selected.ratePerDay} credits per 24 hours` : null)
  +row('Projected credit usage at reset',eligible ? selected.projectedUsageAtReset : null)
  +row('Projected capacity left at reset (reported limit)',eligible ? selected.projectedRemainingBaseAtReset : null)
  +row('Estimated exhaustion date (UTC)',exhaustion ? date(exhaustion,true) : null);
 const windowRows=row('Forecast observation coverage',eligible ? `${selected.snapshotCount} comparable snapshots over ${selected.windowDays} UTC 24-hour days` : null)
  +row('Forecast window (UTC)',eligible ? `${selected.windowFrom} to ${selected.windowTo}` : null)
  +row('Observed history window (UTC)',h.coverage.from && h.coverage.to ? `${h.coverage.from} to ${h.coverage.to}` : null)
  +row('Coverage',coverage);
 const notes=[...o.flags,...diagnostics.filter(c=>c!=='source_changed'),...f.reasons,...new Set(h.coverage.gaps.map(g=>g.reason))].map(readable).join(', ') || 'No known issues in the retained observations';
 const methods=f.estimates.map(e=>row(readable(e.method),e.status==='qualified' ? `${e.ratePerDay} CREDIT / 24h; ${e.tier}` : `Unavailable: ${e.reasons.map(readable).join(', ')}`)).join('');
 const details=row('Forecast method',f.selectedMethod ? readable(f.selectedMethod) : null)+row('Rate versus daily budget',eligible ? readable(selected.budgetComparison) : null)
  +row('Forecast evidence',selected && selected.evidenceCredits!==null ? `${selected.evidenceCredits} credits over ${(selected.evidenceMilliseconds!/86400000).toFixed(2)} observed days; updates on ${selected.observedDays} UTC days; ${selected.cyclesUsed} billing cycle(s)` : null)
  +row('Forecast qualifiers',f.qualifiers.length ? f.qualifiers.map(readable).join(', ') : null)
  +row('Evidence-backed cycle start (UTC)',h.cycleStartAt)+row('Cycle start coverage',h.coverage.initialPeriodUnknown ? 'Unknown or partially observed' : 'Boundary observed')
  +row('Interval average net change / 24h',h.averageObservedNetChangePerDay)+row('Recent 7-day trend',readable(f.recentTrend.direction))
  +row('Exact daily credit budget / 24h',budget)+row('Exact billing reset (UTC)',o.resetAt)+row('Exact last account update (UTC)',o.observedAt)+row('Source time interpretation',o.flags.includes('assumed_source_timezone') ? 'Device timezone assumed for offset-free source timestamps' : 'See source timestamp metadata')
  +row('Quality codes',notes);
 const chart=presentChartParts(o);
 const tierLine=eligible ? tier : '';
 const freshness=stale ? 'Stale — waiting for a fresh account update' : o.status==='observed' ? 'Fresh' : 'Not available';
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
 body{font:var(--vscode-font-size,14px)/1.55 var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;margin:0}main{max-width:900px;margin:auto}a{color:var(--vscode-textLink-foreground,#3794ff)}a:focus-visible{outline:2px solid var(--vscode-focusBorder)}h1{font-size:1.7rem;margin:0}h2{font-size:1.15rem;margin:0 0 12px}h3{font-size:1rem}.subtitle,.label,.muted{color:var(--vscode-descriptionForeground)}.subtitle{margin:4px 0 20px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.card,section{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:16px}.card{background:var(--vscode-editorWidget-background)}.value{font-size:1.25rem;font-weight:600;margin-top:6px;overflow-wrap:anywhere}section{margin-top:18px}.outlook{border-left:4px solid ${warning ? 'var(--vscode-editorWarning-foreground)' : 'var(--vscode-focusBorder)'}}.badge{display:inline-block;padding:2px 8px;border:1px solid var(--vscode-panel-border);border-radius:12px;font-size:.85rem}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:9px 0;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}th{width:45%;font-weight:400;color:var(--vscode-descriptionForeground);padding-right:16px}summary{cursor:pointer;margin:12px 0}summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}.cost-strategy{border-top:1px solid var(--vscode-panel-border);padding:10px 0}.cost-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 16px}.cost-grid dt{color:var(--vscode-descriptionForeground)}.cost-grid dd{margin:0}.cost-grid dt,.cost-grid dd,.cost-result li{overflow-wrap:anywhere}h4{margin:8px 0}@media(max-width:540px){.cost-grid{grid-template-columns:minmax(0,1fr)}.cost-grid dd{margin-bottom:6px}}p{margin:10px 0}.small{font-size:.9rem}@media(max-width:540px){body{padding:14px}.summary{grid-template-columns:1fr}.value{font-size:1.15rem}th{width:42%}}
 .advanced>summary{font-size:1.05rem;font-weight:600;margin:0}.advanced[open]>summary{margin-bottom:12px}.advanced h3{margin:20px 0 8px;font-size:1.05rem;border-top:1px solid var(--vscode-panel-border);padding-top:14px}.tier{margin-left:8px}.status-table th{width:40%}
 ${CHART_CSS}
 </style></head><body><main><h1>Your credit budget</h1><p class="subtitle">Your remaining credits until the next billing reset. <a href="#cost-advisor">Cost Advisor</a></p><div class="summary">${card('Credits used',o.usage===null ? null : `${o.usage} credits`,o.baseLimit===null ? '' : `of ${o.baseLimit} reported`)}${card('Remaining reported capacity',o.remainingBaseCredits===null ? null : `${o.remainingBaseCredits} credits`)}${card('Daily credit budget until reset',budget===null ? null : `${compact(budget)} credits / day`)}</div>
 <section class="outlook"><h2>Current status</h2><span class="badge">${safe(outlook)}</span>${tierLine ? `<span class="muted tier">${safe(tierLine)}</span>` : ''}<p>${safe(explanation)}</p>${limitations ? `<p>${safe(limitations)}</p>` : ''}${o.flags.includes('future_records_ignored') ? `<p>${safe(readable('future_records_ignored'))}</p>` : ''}<table class="status-table">${row('Next billing reset',o.resetAt ? `${date(o.resetAt,true)} (UTC)` : null)}${row('Last account update',o.observedAt ? `${updated(o.observedAt)} · ${freshness}` : null)}</table><p class="muted small">Amounts are as of the last update; later usage is unknown. The reported limit is not verified as base-only or total capacity.</p></section>
 ${advisorHtml}
 ${chart.main}
 ${costHtml}
 <section id="advanced-details" aria-label="Advanced details"><details class="advanced"><summary>Advanced details</summary><p class="muted small">Forecast methods and evidence, coverage, exact UTC timestamps, qualifiers, chart data and billing assumptions.</p>
 <h3>Forecast</h3><p>${safe(tier)}</p>${collecting ? `<p>${safe(COLLECTING_POLICY)}</p>` : ''}<table>${forecastRows}</table><p class="muted small">Estimates assume the observed rate continues. They are not guarantees or statistical confidence intervals. Negative projected credits indicate usage beyond the reported limit; this does not by itself establish overage charges.</p>
 ${chart.advanced}
 <h3>Observed history</h3><p>Only retained, comparable account updates support the forecast. Missing days stay unknown.</p><table>${windowRows}${row('Reported credit limit (CREDIT)',o.baseLimit)}</table><details><summary>Recent account updates and daily changes</summary><table>${h.points.slice(-8).map(p=>row(p.observedAt,p.usage)).join('')}</table><h4>Daily observed changes (UTC)</h4><table>${h.days.slice(-14).map(d=>row(d.day+(d.complete ? ' (complete)' : ' (partial/unknown)'),d.netChange)).join('')}</table><p class="muted small">Partial values cover only supported intervals within that day. Cross-day changes are never distributed across missing days.</p></details>
 <h3>Data quality / notes</h3><p>The daily budget summary is truncated to one decimal; the exact allowance is in the technical details. Daily budget is an allocation of the remaining reported capacity at the last observation across the time left until reset, using 24-hour days. The reported credit limit is not verified as base-only or total capacity; it may include purchased add-on credits, and usage can exceed it. Usage since that account update is unknown. Extra credits, purchased balances and total availability remain unknown.</p><p class="muted small">Forecast policy v${f.policy.version}: provisional estimates need 3 comparable updates over at least 48 hours; regular in-cycle forecasts need 8 over at least 7 days. Pooled 7/14/28/84-day estimates need enough observed time, updates on enough different days and no single dominant interval; unobserved time is never counted as zero. Positive gaps over 36 hours are barriers for in-cycle methods, and the latest update must be fresh (${f.policy.maxAgeHours} hours).</p><h4>Technical details</h4><table>${details}</table><h4>Forecast methods</h4><table>${methods}</table><h4>Gaps and quality barriers</h4><table>${h.coverage.gaps.slice(-8).map(g=>row(`${g.from} to ${g.to}`,readable(g.reason))).join('')}</table><p class="muted small">Unknown periods are not zero. Interval net changes are not gross charges. Exact rolling boundaries must be observed; no daily consumption is invented.</p>
 </details></section></main></body></html>`;
 return {text:`${warning ? '$(warning)' : '$(gauge)'} Kiro: ${status}`,tooltip,warning,html};
}
