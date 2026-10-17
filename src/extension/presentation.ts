import type { view } from '../view.ts';
import { compare, compareRatios } from '../decimal.ts';
import { readable, updated, date } from './labels.ts';
import { presentChartParts, CHART_CSS } from './chart.ts';
import { countsText, relativeTime, type AuditSummary } from './audit-model.ts';
import { LINKS, NOT_KIRO_TEXT } from './identity.ts';

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
 runtime_unsupported:'This Kiro version does not provide the SQLite support Cyclegauge needs. Update Kiro to use the credit gauge; the workspace audit still works.',
 storage_newer:'Your Cyclegauge data was written by a newer Cyclegauge version. Update Cyclegauge; the data is left unchanged.',
};

// The command links of this view are exactly four Cyclegauge commands (Cost Advisor, the two audit commands and Share); none carries arguments.
// The footer's three web links are fixed constants and only ever followed on a click.
// The workspace-check card shows counts and times only, never a path or folder name.
const ADVISOR_LINK = 'command:cyclegauge.costAdvisor';
const AUDIT_LINK = { check: 'command:cyclegauge.auditWorkspace', show: 'command:cyclegauge.audit.show' } as const;
const SHARE_LINK = 'command:cyclegauge.share';
const FOOTER = `<footer class="community muted small"><a href="${LINKS.rate}">★ Rate on Open VSX</a> · <a href="${LINKS.star}">Star on GitHub</a> · <a href="${LINKS.support}">☕ Support</a> · <a href="${SHARE_LINK}">Share</a></footer>`;
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
 const text = a.state === 'checked' ? `${countsText(items, unclear)}${checked}`
  : a.state === 'unavailable' ? "This folder can't be checked. Run Check now to see why."
  : `Check which files Kiro can read but probably doesn't need.${a.lastDate && DAY.test(a.lastDate) ? ` Last checked ${a.lastDate} (UTC).` : ''}`;
 return `<section class="audit-card" aria-labelledby="audit-heading"><h3 id="audit-heading">Workspace check</h3><p>${safe(text)}</p><p class="audit-actions"><a class="button primary" href="${AUDIT_LINK.check}">Check now</a>${a.state === 'checked' ? ` <a class="button secondary" href="${AUDIT_LINK.show}">Show</a>` : ''}</p></section>`;
}

// The advisor section itself has no command links; its one button is added here, inside the section when it is present.
function withAdvisorButton(advisorHtml: string): string {
 const button = `<p class="advisor-actions"><a class="button primary" href="${ADVISOR_LINK}">Open Cost Advisor</a></p>`;
 return advisorHtml.endsWith('</section>') ? `${advisorHtml.slice(0, -'</section>'.length)}${button}</section>` : `${advisorHtml}${button}`;
}

/** Presentation only: billing eligibility and exact projections remain in the core. */
export function present(o: ReturnType<typeof view>, diagnostics: string[] = [], costHtml = '', advisorHtml = '', audit?: AuditSummary, now = new Date().toISOString(), notKiro = false) {
 const h=o.history,f=o.forecast;
 const selected=f.estimates.find(e=>e.method===f.selectedMethod && e.status==='qualified');
 const stale=o.status==='stale' || f.reasons.includes('stale');
 const collecting=!stale && o.status==='observed' && f.reasons.includes('insufficient_comparable_coverage');
 const eligible=!stale && o.status==='observed' && f.status==='qualified' && !!selected;
 const blocked=diagnostics.find(c=>c==='runtime_unsupported' || c==='storage_newer');
 const reason=blocked ?? f.reasons[0] ?? o.status;
 // Outside Kiro without a chosen source, an empty source is expected rather than a fault.
 const absent=notKiro && !blocked && diagnostics.includes('no_source_logs');
 const tier=stale ? 'Forecast paused — stale data' : f.tier==='provisional' && eligible ? 'Provisional estimate – limited history' : eligible ? 'Regular forecast' : collecting ? 'Forecast not ready yet — more history needed' : 'Forecast unavailable';
 const budget=o.availablePerDay;
 const exhausted=eligible && selected.exhaustionStatus==='already_exhausted_as_of';
 // Usage above the reported limit is a valid observation (e.g. Enterprise overage); the counter alone does not say why.
 const above=o.usage!==null && o.baseLimit!==null && compare(o.usage,o.baseLimit)>0;
 const over=eligible && (exhausted || selected.budgetComparison==='above_budget');
 const tight=eligible && !over && budget!==null && compare(budget,'0')>0 && compareRatios(selected.ratePerDay!,9,budget,10)>=0;
 const outlook=exhausted ? above ? 'Above reported limit' : 'Reported limit reached' : over ? 'Likely to exceed' : tight ? 'At risk' : eligible ? 'On track' : stale ? 'Stale data' : collecting ? 'Collecting data' : 'Unavailable';
 const exhaustion=eligible ? selected.estimatedExhaustionDayUTC : null;
 const allowance=budget===null ? '' : ` • ${compact(budget)}/day`;
 const status=stale ? 'Stale data' : !eligible ? collecting ? 'Collecting data' : 'Unavailable' : exhausted ? f.tier==='provisional' ? 'Provisional • exhausted' : above ? 'Above reported limit' : 'Reported limit reached' : f.tier==='provisional' ? `Provisional${exhaustion ? ` • empty ${date(exhaustion)}` : allowance}` : over ? `Likely to exceed${exhaustion ? ` • empty ${date(exhaustion)}` : allowance}` : `${tight ? 'At risk' : 'On track'}${allowance}`;
 const warning=stale || over || tight || (!eligible && !collecting);
 const resetMs=o.resetAt ? Date.parse(o.resetAt) : NaN, evalMs=f.evaluatedAt ? Date.parse(f.evaluatedAt) : NaN;
 const daysLeft=Number.isFinite(resetMs) && Number.isFinite(evalMs) ? Math.ceil((resetMs-evalMs)/86400000) : null;
 const resetIn=daysLeft===null ? '' : daysLeft<0 ? 'passed' : daysLeft===0 ? 'today' : daysLeft===1 ? 'in 1 day' : `in ${daysLeft} days`;
 const whole=(s:string)=>{const v=Number(s);return Number.isFinite(v) ? String(Math.round(v)) : s;};
 const resetDate=o.resetAt ? date(o.resetAt) : null;
 const lastsLine=eligible && selected.projectedUsageAtReset!==null && o.baseLimit!==null && !exhausted && !exhaustion ? `At the observed pace you will use about ${whole(selected.projectedUsageAtReset)} of ${whole(o.baseLimit)} reported credits by the reset${resetDate ? ` on ${resetDate}` : ''}.` : '';
 const explanation=absent ? NOT_KIRO_TEXT : eligible ? exhausted ? above ? 'Observed usage was above the reported credit limit at the last account update. The counter alone does not establish overage charges, purchased balance or billing eligibility.' : 'Observed usage had reached the reported credit limit at the last account update.' : exhaustion ? `Estimated to run out on ${date(exhaustion,true)} (UTC), before the reset${resetDate ? ` on ${resetDate}` : ''}, if the observed rate continues.` : selected.exhaustionStatus==='zero_observed_rate' ? 'No exhaustion date at the observed zero rate. Future usage can change this.' : `${lastsLine ? lastsLine.replace(/\.$/,' — enough to last until then if the observed rate continues.')+'' : 'Your reported credits are not projected to run out before reset if the observed rate continues.'}${tight ? ' The margin is small: your pace is within 10% of the daily budget.' : ''}` : explanations[stale ? 'stale' : reason] ?? 'The available account updates do not support a safe forecast.';
 // A provisional estimate is never styled or headlined as reassuringly as a regular forecast.
 const early=eligible && f.tier==='provisional' && outlook==='On track';
 const heading=absent ? 'Kiro not detected' : early ? 'Looks on track so far' : outlook;
 const tone=absent ? 'neutral' : stale || (!eligible && !collecting) ? 'warn' : !eligible || early ? 'neutral' : exhausted || over ? 'bad' : tight ? 'warn' : 'ok';
 const icon={ok:'✓',warn:'!',bad:'✕',neutral:'…'}[tone];
 const usedPct=o.usage!==null && o.baseLimit!==null && compare(o.baseLimit,'0')>0 ? Math.max(0,Math.min(100,Math.round(Number(o.usage)/Number(o.baseLimit)*100))) : null;
 const limitations=eligible && f.tier==='provisional' ? 'This limited window may not represent future usage. A regular forecast needs at least 7 days and 8 comparable updates.' : '';
 const tooltip=[`${outlook} · ${tier}`,`Daily credit budget until reset: ${budget ?? 'Not available'} credits / 24h`,eligible ? `Observed rate: ${selected.ratePerDay} credits / 24h` : '',`Last account update: ${o.observedAt ? updated(o.observedAt) : 'Not available'}. Click to open your budget.`].filter(Boolean).join('\n');
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
 const freshness=stale ? 'Stale — waiting for a fresh account update' : o.status==='observed' ? 'Fresh' : 'Not available';
 const stat=(label:string,value:string,note='')=>`<div class="stat"><dt>${safe(label)}</dt><dd>${safe(value)}</dd>${note ? `<dd class="muted small">${safe(note)}</dd>` : ''}</div>`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your credit budget</title><style>
 :root{--ok:var(--vscode-charts-green,#3fb950);--warn:var(--vscode-editorWarning-foreground,#cca700);--bad:var(--vscode-errorForeground,#f14c4c);--neutral:var(--vscode-descriptionForeground,#888)}
 *{box-sizing:border-box}body{font:var(--vscode-font-size,14px)/1.5 var(--vscode-font-family,sans-serif);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;margin:0}main{max-width:820px;margin:auto}a{color:var(--vscode-textLink-foreground,#3794ff)}a:focus-visible,summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}h1{font-size:1.1rem;font-weight:600;margin:0 0 12px;color:var(--vscode-descriptionForeground)}h2{font-size:1.1rem;margin:0 0 10px}h3{font-size:1rem}h4{margin:8px 0}p{margin:8px 0}.muted,.label{color:var(--vscode-descriptionForeground)}.small{font-size:.9rem}
 section{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:18px;margin-top:16px;background:var(--vscode-editorWidget-background,transparent)}
 .hero{margin-top:0;border-left:5px solid var(--tone)}.hero.ok{--tone:var(--ok)}.hero.warn{--tone:var(--warn)}.hero.bad{--tone:var(--bad)}.hero.neutral{--tone:var(--neutral)}
 .hero h2{font-size:1.8rem;line-height:1.2;margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px}.status-icon{display:inline-flex;align-items:center;justify-content:center;width:1.4em;height:1.4em;border-radius:50%;border:2px solid var(--tone);color:var(--tone);font-size:.7em;font-weight:700}.tag{font-size:.8rem;font-weight:400;border:1px solid var(--vscode-panel-border);border-radius:12px;padding:1px 9px;color:var(--vscode-descriptionForeground)}
 .lead{font-size:1.05rem;margin:10px 0 14px}.bar{height:10px;border-radius:5px;background:var(--vscode-panel-border);overflow:hidden;margin:6px 0 16px}.bar>span{display:block;height:100%;background:var(--tone)}.bar-label{margin:-10px 0 16px}
 .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:0}.stat dt{color:var(--vscode-descriptionForeground);font-size:.9rem}.stat dd{margin:0;font-size:1.35rem;font-weight:600;overflow-wrap:anywhere}.stat dd.small{font-size:.9rem;font-weight:400}
 .audit-card h3{margin:0 0 4px;font-size:1rem}.audit-card p{margin:4px 0}.audit-actions,.advisor-actions{display:flex;flex-wrap:wrap;gap:8px}a.button{display:inline-block;padding:4px 12px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;text-decoration:none;font-weight:500;cursor:pointer}a.button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}a.button.primary:hover{background:var(--vscode-button-hoverBackground)}a.button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}a.button.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
 .community{margin:20px 0 4px;text-align:center}
 .meta{margin:14px 0 0;padding-top:12px;border-top:1px solid var(--vscode-panel-border)}
 .badge{display:inline-block;padding:1px 9px;border:1px solid var(--vscode-panel-border);border-radius:12px;font-size:.85rem}.verdict{font-size:1.05rem;font-weight:600;margin:10px 0}.plan-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.plan-row strong{font-size:1.2rem}.action{border:1px dashed var(--vscode-panel-border);border-radius:8px;padding:8px 12px;margin:10px 0}
 table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:9px 0;border-bottom:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}th{width:45%;font-weight:400;color:var(--vscode-descriptionForeground);padding-right:16px}
 summary{cursor:pointer;margin:10px 0;font-weight:500}details>summary{list-style-position:inside}.advanced>summary{font-size:1.05rem;font-weight:600;margin:0}.advanced[open]>summary{margin-bottom:12px}.advanced h3{margin:20px 0 8px;font-size:1.05rem;border-top:1px solid var(--vscode-panel-border);padding-top:14px}
 .estimate{border:1px solid var(--vscode-panel-border);border-left:5px solid var(--neutral);border-radius:8px;padding:12px 16px;margin:12px 0}.estimate-supported{border-left-color:var(--ok)}.estimate-modelled{border-left-color:var(--warn)}.estimate-comparison_only{border-left-color:var(--neutral)}.estimate p{margin:6px 0}.estimate .tier{margin-top:0}.estimate .figure{font-size:1rem}.estimate .figure strong{font-size:1.6rem;margin-right:6px}.estimate .verdict{font-size:1rem;font-weight:500}
 .cost-strategy{border-top:1px solid var(--vscode-panel-border);padding:10px 0}.cost-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 16px}.cost-grid dt{color:var(--vscode-descriptionForeground)}.cost-grid dd{margin:0}.cost-grid dt,.cost-grid dd,.cost-result li{overflow-wrap:anywhere}
 @media(max-width:540px){.stats{grid-template-columns:minmax(0,1fr)}.estimate{padding:10px 12px}body{padding:12px}section{padding:14px}.hero h2{font-size:1.5rem}.cost-grid{grid-template-columns:minmax(0,1fr)}.cost-grid dd{margin-bottom:6px}th{width:42%}}
 @media(forced-colors:active){a.button{border-color:ButtonText}.hero{border-left-color:Highlight}.bar>span{background:Highlight}}
 ${CHART_CSS}
 </style></head><body><main><h1>Your credit budget</h1>
 <section class="hero ${tone}" aria-labelledby="status-heading"><h2 id="status-heading"><span class="status-icon" aria-hidden="true">${icon}</span>${safe(heading)}${eligible ? `<span class="tag">${safe(tier)}</span>` : ''}</h2>
 <p class="lead">${safe(explanation)}</p>${limitations ? `<p class="small">${safe(limitations)}</p>` : ''}
 ${usedPct===null ? '' : `<div class="bar" role="img" aria-label="${usedPct}% of the reported credit limit used"><span style="width:${usedPct}%"></span></div><p class="bar-label muted small">${usedPct}% of the reported credit limit used</p>`}
 <dl class="stats">${stat('Credits used',o.usage===null ? 'Not available' : `${o.usage} credits`,o.baseLimit===null ? '' : `of ${o.baseLimit} reported`)}${stat('Remaining reported capacity',o.remainingBaseCredits===null ? 'Not available' : `${o.remainingBaseCredits} credits`,budget===null ? '' : `Daily credit budget until reset: ${compact(budget)} credits / day`)}${stat('Next reset',o.resetAt ? date(o.resetAt,true) : 'Not available',[resetIn,'UTC'].filter(Boolean).join(' · '))}</dl>
 <p class="meta muted small">Last account update: ${safe(o.observedAt ? `${updated(o.observedAt)} · ${freshness}` : 'Not available')}. Amounts are as of that update; later usage is unknown. The reported limit is not verified as base-only or total capacity.</p></section>
 ${auditCard(audit, now)}
 ${withAdvisorButton(advisorHtml)}
 ${chart.main}
 ${costHtml}
 <section id="advanced-details" aria-label="Advanced details"><details class="advanced"><summary>Advanced details</summary><p class="muted small">Forecast methods and evidence, coverage, exact UTC timestamps, qualifiers, chart data and billing assumptions.</p>
 <h3>Forecast</h3><p>${safe(tier)}</p>${collecting ? `<p>${safe(COLLECTING_POLICY)}</p>` : ''}<table>${forecastRows}</table><p class="muted small">Estimates assume the observed rate continues. They are not guarantees or statistical confidence intervals. Negative projected credits indicate usage beyond the reported limit; this does not by itself establish overage charges.</p>
 ${chart.advanced}
 <h3>Observed history</h3><p>Only retained, comparable account updates support the forecast. Missing days stay unknown.</p><table>${windowRows}${row('Reported credit limit (CREDIT)',o.baseLimit)}</table><details><summary>Recent account updates and daily changes</summary><table>${h.points.slice(-8).map(p=>row(p.observedAt,p.usage)).join('')}</table><h4>Daily observed changes (UTC)</h4><table>${h.days.slice(-14).map(d=>row(d.day+(d.complete ? ' (complete)' : ' (partial/unknown)'),d.netChange)).join('')}</table><p class="muted small">Partial values cover only supported intervals within that day. Cross-day changes are never distributed across missing days.</p></details>
 <h3>Data quality / notes</h3><p>The daily budget summary is truncated to one decimal; the exact allowance is in the technical details. Daily budget is an allocation of the remaining reported capacity at the last observation across the time left until reset, using 24-hour days. The reported credit limit is not verified as base-only or total capacity; it may include purchased add-on credits, and usage can exceed it. Usage since that account update is unknown. Extra credits, purchased balances and total availability remain unknown.</p><p class="muted small">Forecast policy v${f.policy.version}: provisional estimates need 3 comparable updates over at least 48 hours; regular in-cycle forecasts need 8 over at least 7 days. Pooled 7/14/28/84-day estimates need enough observed time, updates on enough different days and no single dominant interval; unobserved time is never counted as zero. Positive gaps over 36 hours are barriers for in-cycle methods, and the latest update must be fresh (${f.policy.maxAgeHours} hours).</p><h4>Technical details</h4><table>${details}</table><h4>Forecast methods</h4><table>${methods}</table><h4>Gaps and quality barriers</h4><table>${h.coverage.gaps.slice(-8).map(g=>row(`${g.from} to ${g.to}`,readable(g.reason))).join('')}</table><p class="muted small">Unknown periods are not zero. Interval net changes are not gross charges. Exact rolling boundaries must be observed; no daily consumption is invented.</p>
 </details></section>
 ${FOOTER}</main></body></html>`;
 if(absent)return {text:'$(info) Kiro not detected',tooltip:NOT_KIRO_TEXT,warning:false,html,forecast:false,absent:true};
 if(blocked)return {text:'$(warning) Kiro: update needed',tooltip:explanations[blocked],warning:true,html,forecast:false,absent:false};
 return {text:`${warning ? '$(warning)' : '$(gauge)'} Kiro: ${status}`,tooltip,warning,html,forecast:eligible,absent:false};
}
