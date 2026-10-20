import type { view } from '../view.ts';
import { chartModel, LOWER_FACTOR, HIGHER_FACTOR, type ChartModel } from './chart-model.ts';
import { escapeHtml as safe, date } from './labels.ts';
import { DAY_MS } from '../history.ts';

// Script-free inline SVG. Colors come from editor theme tokens; line patterns and marker shapes carry the same distinctions.
export const CHART_CSS = `.chart-frame{margin:0}.chart-frame svg{display:block;width:100%;height:auto;max-width:100%}
.chart-frame text{fill:var(--vscode-foreground);font-family:var(--vscode-font-family,sans-serif);font-size:12px}.chart-frame .axis,.chart-frame .grid{stroke:var(--vscode-panel-border,#8888);stroke-width:1;fill:none}.chart-frame .grid{stroke-dasharray:1 4}
.chart-frame .obs{stroke:var(--vscode-charts-blue,#3794ff);fill:none;stroke-width:2}.chart-frame circle.pt{fill:var(--vscode-charts-blue,#3794ff);stroke:var(--vscode-editor-background,#fff);stroke-width:1}
.chart-frame polygon.over{fill:var(--vscode-editor-background,#fff);stroke:var(--vscode-charts-red,#f14c4c);stroke-width:2.5}
.chart-frame .limit{stroke:var(--vscode-charts-red,#f14c4c);stroke-width:2.5;fill:none}.chart-frame .above{fill:var(--vscode-charts-red,#f14c4c);fill-opacity:.12}
.chart-frame .central{stroke:var(--vscode-charts-purple,#b180d7);stroke-width:2;stroke-dasharray:8 5;fill:none}.chart-frame .lower{stroke:var(--vscode-charts-green,#89d185);stroke-width:1.5;stroke-opacity:.85;stroke-dasharray:2 5;stroke-linecap:round;fill:none}
.chart-frame .higher{stroke:var(--vscode-charts-orange,#d18616);stroke-width:1.5;stroke-opacity:.85;stroke-dasharray:12 4 2 4;fill:none}.chart-frame .env{fill:var(--vscode-charts-purple,#b180d7);fill-opacity:.14;stroke:none}.chart-frame .split{stroke:var(--vscode-descriptionForeground,#888);stroke-width:1;stroke-dasharray:2 3;fill:none}.chart-frame .zone{fill:var(--vscode-descriptionForeground,#888);font-size:11px}
.chart-frame .budget{stroke:var(--vscode-charts-yellow,#cca700);stroke-width:1.5;stroke-dasharray:3 3;fill:none}.chart-frame .reset{stroke:var(--vscode-foreground);stroke-width:1.5;fill:none}
.chart-frame .query{stroke:var(--vscode-descriptionForeground,#888);stroke-width:1.5;stroke-dasharray:1 4;stroke-linecap:round;fill:none}
.chart-frame .unk{fill:url(#chart-unknown);stroke:var(--vscode-panel-border,#8888);stroke-dasharray:4 3}.chart-frame .unk-hatch{stroke:var(--vscode-descriptionForeground,#888);stroke-width:1}
.chart-frame .mark{stroke:var(--vscode-foreground);stroke-width:2.5;fill:none}.chart-frame .flag{fill:var(--vscode-editorWarning-foreground,#cca700);stroke:var(--vscode-foreground);stroke-width:1}.chart-frame [data-chart-point]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}.chart-tooltip{border:1px solid var(--vscode-panel-border);padding:6px 9px;margin:6px 0;max-width:max-content;background:var(--vscode-editorWidget-background,var(--vscode-editor-background))}.chart-tooltip[hidden]{display:none}
.chart-clip{margin:8px 0;padding-left:20px;font-weight:600;font-size:.95rem}.chart-legend{list-style:none;padding:0;margin:10px 0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.85rem}.chart-help{margin-top:6px}.chart-help>summary{font-weight:500}.chart-legend-full{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));font-size:.95rem}.chart-legend li{display:flex;gap:8px;align-items:flex-start}.chart-legend svg{flex:none;margin-top:3px}
.chart-legend line,.chart-legend path{fill:none}.chart-table th,.chart-table td{padding:6px 8px 6px 0;font-size:.9rem}.chart-table th,.chart-table td{overflow-wrap:normal;word-break:normal}.chart-table th{width:auto}.chart-table th[scope=row]{min-width:9em}.chart-table th[scope=col]{white-space:nowrap}.chart-table td:nth-child(2){min-width:12em}.chart-table td:nth-child(3){white-space:nowrap}.chart-scroll{overflow-x:auto}
@media(forced-colors:active){.chart-frame .obs,.chart-frame .limit,.chart-frame .central,.chart-frame .lower,.chart-frame .higher,.chart-frame .budget,.chart-frame .reset,.chart-frame .query,.chart-frame .axis,.chart-frame .mark{stroke:CanvasText}.chart-frame circle.pt{fill:CanvasText;stroke:Canvas}.chart-frame polygon.over,.chart-frame .flag{fill:Canvas;stroke:Highlight}.chart-frame .env,.chart-frame .above{fill:Highlight;fill-opacity:.25}.chart-frame text{fill:CanvasText}}`;

const W = 640, L = 60, R = 20, T = 20, B = 46;
/** Sparse histories get a shorter frame; only the frame height changes, never the data scale. */
const SPARSE_POINTS = 4, TALL = 340, SHORT = 240;
const methodLabels: Record<string, string> = { cycle_to_date: 'cycle-to-date rate', rolling_7_day: 'rolling 7-day rate', observed_window: 'observed-window rate',
 history_7_day: 'pooled 7-day history', history_14_day: 'pooled 14-day history', history_28_day: 'pooled 28-day history', history_84_day: 'pooled 84-day history' };
const eventLabels: Record<string, string> = { usage_adjustment: 'Counter decreased (adjustment) — not negative spending; the series restarts here',
 limit_change: 'Reported limit changed — a new segment starts; earlier and later limits are not one constant budget',
 unsupported_extra_credits: 'Unsupported extra-credit information — series broken' };
const unknownLabels: Record<string, string> = { before_first_observation: 'Before the first retained observation — unknown', gap_over_36_hours: 'Gap over 36 hours — within-gap timing not observed',
 usage_adjustment: 'Counter adjustment — period not compared', limit_change: 'Reported limit changed — period not compared', unsupported_extra_credits: 'Unsupported extra credits — period not compared',
 observation_gap: 'Observation gap — daily path unknown', conflicting_snapshots: 'Conflicting snapshots — unknown', missing_billing: 'Missing billing fields — unknown' };
const unknownLabel = (r: string) => unknownLabels[r] ?? 'Not comparable — unknown';
const n = (v: number) => (Math.round(v * 10) / 10).toString();
const credits = (s: string) => `${safe(s)} credits`;

function niceStep(raw: number): number {
 const exp = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / exp;
 return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}
const num = (s: string) => { const v = Number(s); return Number.isFinite(v) ? v : 0; }; // Plot positions only.

function summaryText(m: ChartModel): string {
 const l = m.latest!;
 const parts = [`As of ${m.asOf} UTC the observed cumulative account counter was ${l.usage} credits against a reported credit limit of ${l.limit} credits: ${l.difference} credits ${l.aboveLimit ? 'above' : 'below'} the reported limit${l.aboveLimit ? ' (usage above the reported limit is displayed as observed)' : ''}.`];
 if (m.omittedPoints > 0) parts.push(`${m.omittedPoints} retained account updates are not plotted or listed (evenly thinned; first, last and every update beside an unknown period or event are kept).`);
 const p = m.projection;
 if (p) {
  const sc = (label: string, s: { end: string; clipped: boolean; aboveLimit: boolean | null }) => `${label}: ${s.end} credits at reset${s.aboveLimit ? ' (above the reported limit)' : ''}${s.clipped ? ' — this trajectory continues beyond the chart; the endpoint here is the full value' : ''}`;
  parts.push(`${p.tier === 'provisional' ? 'Provisional estimate – limited history. ' : ''}Expected trajectory (${methodLabels[p.method] ?? safe(p.method)}, ${p.ratePerDay} credits per 24 hours): ${p.central.end} credits at reset${p.central.aboveLimit ? ' (above the reported limit)' : ''}${p.central.clipped ? ' — continues beyond the chart; the endpoint here is the full value' : ''}.`);
  parts.push(`${sc(`Lower-usage scenario (${LOWER_FACTOR.label} of the selected observed rate)`, p.lower)}.`);
  parts.push(`${sc(`Higher-usage scenario (${HIGHER_FACTOR.label} of the selected observed rate)`, p.higher)}.`);
 } else parts.push('Projection not shown: the forecast is stale or unavailable, so no trajectory, scenario range or exhaustion timing is displayed.');
 if (m.budget) parts.push(`Budget guide: an even allocation of the remaining reported capacity, from ${m.budget.from.usage} credits at ${m.budget.from.at} to ${m.budget.to.usage} credits at the reset ${m.budget.to.at}.`);
 else if (m.budgetNote) parts.push('Budget guide not shown: no remaining reported capacity at the last account update.');
 if (m.exhaustion) parts.push(`Reported limit reached (conditional): estimated UTC day ${m.exhaustion.day} if the observed rate continues; not a prediction of purchased-credit exhaustion.`);
 else if (m.projection && m.exhaustionNote === 'already_exhausted_as_of') parts.push('The reported limit was already reached or exceeded at the last account update; no exhaustion date applies.');
 else if (m.projection) parts.push('No reported-limit exhaustion before reset is projected at the selected rate.');
 return parts.join(' ');
}

function tableRows(m: ChartModel): string {
 const rows: string[] = [];
 const r = (kind: string, layer: string, at: string, value: string, note: string) =>
  rows.push(`<tr data-kind="${kind}"><th scope="row">${safe(layer)}</th><td>${safe(at)}</td><td>${safe(value)}</td><td>${safe(note)}</td></tr>`);
 for (const p of m.points) r('point', 'Observed counter', p.at, p.usage, `${p.aboveLimit ? 'above reported limit; ' : ''}reported limit ${p.limit}`);
 for (const u of m.unknown) r('unknown', 'Unknown period', `${u.from} to ${u.to}`, '—', unknownLabel(u.reason));
 for (const e of m.events) r('event', 'Event', e.at, '—', eventLabels[e.kind] ?? 'Series broken');
 for (const l of m.limits) r('limit', 'Reported credit limit', `${l.from} to ${l.to}`, l.value, 'not verified as base-only or total capacity');
 const p = m.projection;
 if (p) {
  r('projection', 'Projection start', p.from.at, p.from.usage, `last observed account update; ${p.tier === 'provisional' ? 'provisional estimate' : 'regular forecast'}`);
  const end = (layer: string, s: { end: string; clipped: boolean; aboveLimit: boolean | null }, how: string) =>
   r('projection', layer, m.resetAt ?? '', s.end, `${how}${s.aboveLimit ? '; above reported limit' : ''}${s.clipped ? '; continues beyond the chart' : ''}`);
  end('Expected trajectory end', p.central, `${methodLabels[p.method] ?? p.method}, ${p.ratePerDay} credits per 24 hours`);
  end('Lower-usage scenario end', p.lower, `${LOWER_FACTOR.label} of the selected observed rate; lower consumption`);
  end('Higher-usage scenario end', p.higher, `${HIGHER_FACTOR.label} of the selected observed rate; higher consumption`);
 }
 if (m.budget) {
  r('budget', 'Budget guide start', m.budget.from.at, m.budget.from.usage, 'last observed account update');
  r('budget', 'Budget guide end', m.budget.to.at, m.budget.to.usage, `reported limit at reset${m.budget.perDay ? `; ${m.budget.perDay} credits per 24 hours from the evaluation time` : ''}`);
 }
 if (m.resetAt) r('reset', 'Reset', m.resetAt, '—', 'billing reset (UTC)');
 if (m.projection && m.evaluatedAt) r('query', 'Evaluation time', m.evaluatedAt, '—', 'usage after the last account update is unobserved');
 if (m.exhaustion) r('exhaustion', 'Reported limit reached (conditional)', m.exhaustion.day, '—', 'UTC day, if the observed rate continues');
 return rows.join('');
}

export interface ChartParts { main: string; advanced: string }
/** Standalone form: the default chart followed by its technical details. */
export const presentChart = (o: ReturnType<typeof view>): string => { const c = presentChartParts(o); return c.main + c.advanced; };

/** Default reading flow in `main`; full legend, caveats, text alternative and data table in `advanced`. */
export function presentChartParts(o: ReturnType<typeof view>): ChartParts {
 const m = chartModel(o);
 if (m.status === 'empty') return { main: `<section id="usage-chart" aria-label="Usage trajectory"><h2>Usage trajectory</h2><p>There are no account updates to chart yet. The chart appears after Kiro writes its first credit update.</p></section>`, advanced: '' };
 const H = m.points.length < SPARSE_POINTS ? SHORT : TALL;
 const startMs = Date.parse(m.axis.startAt), endMs = Math.max(Date.parse(m.axis.endAt), startMs + DAY_MS);
 const pw = W - L - R, ph = H - T - B;
 const x = (ms: number) => L + (Math.min(Math.max(ms, startMs), endMs) - startMs) / (endMs - startMs) * pw;
 const y = (v: number) => T + (1 - Math.min(Math.max(v, 0), m.yMax) / m.yMax) * ph;
 const xt = (iso: string) => x(Date.parse(iso));
 const out: string[] = [];
 out.push(`<defs><pattern id="chart-unknown" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="unk-hatch" x1="0" y1="0" x2="0" y2="8"/></pattern></defs>`);
 // Grid and axes
 const step = niceStep(m.yMax / 4);
 for (let v = 0; v <= m.yMax; v += step) out.push(`<line class="grid" x1="${L}" y1="${n(y(v))}" x2="${W - R}" y2="${n(y(v))}"/><text x="${L - 6}" y="${n(y(v) + 4)}" text-anchor="end">${n(v)}</text>`);
 const ticks = 4, tickAt = (i: number) => startMs + (endMs - startMs) * i / ticks;
 for (let i = 0; i <= ticks; i++) out.push(`<text x="${n(x(tickAt(i)))}" y="${H - 24}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${safe(date(new Date(tickAt(i)).toISOString()))}</text>`);
 out.push(`<line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/><line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>`);
 out.push(`<text x="${L}" y="${H - 6}">Credits · dates in UTC</text>`);
 // Unknown periods are shaded, never zero-filled.
 for (const u of m.unknown) { const a = xt(u.from), b = xt(u.to); out.push(`<rect class="unk" x="${n(a)}" y="${T}" width="${n(Math.max(b - a, 2))}" height="${ph}"><title>${safe(unknownLabel(u.reason))}</title></rect>`); }
 // Region above the reported limit
 const anyOver = m.points.some(p => p.aboveLimit) || (m.projection && [m.projection.central, m.projection.lower, m.projection.higher].some(s => s.aboveLimit));
 if (anyOver) for (const l of m.limits) { const a = xt(l.from), b = xt(l.to), top = y(num(l.value)); out.push(`<rect class="above" x="${n(a)}" y="${T}" width="${n(b - a)}" height="${n(Math.max(top - T, 0))}"/>`); }
 // Scenario envelope and lines (clipped at the visible range, never plotted beyond it)
 const p = m.projection;
 let clipNotes = '';
 if (p) {
  const x0 = xt(p.from.at), y0 = y(num(p.from.usage)), x1 = x(endMs), yTop = y(m.yMax);
  const path = (s: { end: string; clipped: boolean }) => {
   const v = num(s.end);
   if (!s.clipped) return { x: x1, y: y(v), cx: null as number | null };
   const t = (m.yMax - num(p.from.usage)) / (v - num(p.from.usage));
   return { x: x0 + (x1 - x0) * t, y: yTop, cx: x0 + (x1 - x0) * t };
  };
  const lo = path(p.lower), hi = path(p.higher), mid = path(p.central);
  const envelope = [`${n(x0)},${n(y0)}`, `${n(hi.x)},${n(hi.y)}`];
  if (p.higher.clipped) envelope.push(`${n(x1)},${n(yTop)}`);
  envelope.push(`${n(x1)},${n(lo.y)}`);
  if (p.lower.clipped) envelope.push(`${n(lo.x)},${n(lo.y)}`);
  out.push(`<polygon class="env" points="${envelope.join(' ')}"><title>Scenario range, not a statistical confidence interval</title></polygon>`);
  const dash: Record<string, string> = { lower: '2 5', central: '8 5', higher: '12 4 2 4' };
  const line = (cls: string, e: { x: number; y: number }, label: string) => out.push(`<line class="${cls}" stroke-dasharray="${dash[cls]}" x1="${n(x0)}" y1="${n(y0)}" x2="${n(e.x)}" y2="${n(e.y)}"><title>${safe(label)}</title></line>`);
  line('lower', lo, `Lower-usage scenario: ${p.lower.end} credits at reset`);
  line('central', mid, `Expected trajectory: ${p.central.end} credits at reset`);
  line('higher', hi, `Higher-usage scenario: ${p.higher.end} credits at reset`);
  const flag = (s: { clipped: boolean; end: string }, e: { x: number; cx: number | null }, label: string) => {
   if (!s.clipped || e.cx === null) return;
   out.push(`<path class="flag" d="M${n(e.cx)} ${n(yTop - 2)} l-6 11 h12 z"><title>${safe(label)} continues beyond the chart: ${safe(s.end)} credits at reset</title></path>`);
   clipNotes += `<li>▲ ${safe(label)} continues beyond the chart; endpoint ${safe(s.end)} credits at reset.</li>`;
  };
  flag(p.central, mid, 'Expected trajectory'); flag(p.higher, hi, 'Higher-usage scenario'); flag(p.lower, lo, 'Lower-usage scenario');
 }

 if (p) { const sx = xt(p.from.at), room = sx - L >= 150 && W - R - sx >= 70; out.push(`<line class="split" x1="${n(sx)}" y1="${T}" x2="${n(sx)}" y2="${H - B}"/>${room ? `<text class="zone" x="${n(sx - 5)}" y="${T + 10}" text-anchor="end">Observed</text>` : ''}${room ? `<text class="zone" x="${n(sx + 5)}" y="${T + 10}">Forecast</text>` : ''}`); }
 // Budget guide
 if (m.budget) out.push(`<line class="budget" stroke-dasharray="3 3" x1="${n(xt(m.budget.from.at))}" y1="${n(y(num(m.budget.from.usage)))}" x2="${n(xt(m.budget.to.at))}" y2="${n(y(num(m.budget.to.usage)))}"><title>Budget guide: even allocation of remaining reported capacity</title></line>`);
 // Reported limit segments (a changed limit starts a new segment)
 for (const l of m.limits) out.push(`<line class="limit" x1="${n(xt(l.from))}" y1="${n(y(num(l.value)))}" x2="${n(xt(l.to))}" y2="${n(y(num(l.value)))}"><title>Reported credit limit ${safe(l.value)} credits (not verified as base-only or total capacity)</title></line>`);
 const lastLimit = m.limits.at(-1)!;
 out.push(`<text x="${L + 6}" y="${n(Math.max(y(num(lastLimit.value)) - 6, T + 10))}">Reported limit ${safe(lastLimit.value)}</text>`);
 // Reset and evaluation time
 if (m.resetAt && Date.parse(m.resetAt) <= endMs) out.push(`<line class="reset" x1="${n(xt(m.resetAt))}" y1="${T}" x2="${n(xt(m.resetAt))}" y2="${H - B}"><title>Billing reset (UTC)</title></line><text x="${n(xt(m.resetAt) - 4)}" y="${H - B - 6}" text-anchor="end">Reset</text>`);
 if (p && m.evaluatedAt && Date.parse(m.evaluatedAt) > Date.parse(m.asOf!) && Date.parse(m.evaluatedAt) < endMs) out.push(`<line class="query" stroke-dasharray="1 4" x1="${n(xt(m.evaluatedAt))}" y1="${T}" x2="${n(xt(m.evaluatedAt))}" y2="${H - B}"><title>Evaluation time; usage after the last account update is unobserved</title></line>`);
 // Observed connectors, then points on top
 for (const [a, b] of m.connectors) out.push(`<line class="obs" x1="${n(xt(m.points[a].at))}" y1="${n(y(num(m.points[a].usage)))}" x2="${n(xt(m.points[b].at))}" y2="${n(y(num(m.points[b].usage)))}"><title>Comparable interval; timing within the interval was not observed</title></line>`);
 for (const e of m.events) out.push(`<path class="flag" d="M${n(xt(e.at))} ${H - B - 2} l-6 -11 h12 z"><title>${safe(eventLabels[e.kind] ?? 'Series broken')}</title></path>`);
 // Every plotted update is a focusable marker. The source may contain more updates than the plot's bounded selection.
 m.points.forEach((pt, i) => {
  const cx = xt(pt.at), cy = y(num(pt.usage));
  const label = `${pt.at} UTC, ${pt.usage} credits used; change since previous update: ${pt.change === null ? 'not comparable' : `${pt.change} credits`}`;
  const attrs = `data-chart-point="${safe(pt.at)}" tabindex="${i === 0 ? '0' : '-1'}" aria-label="${safe(label)}"`;
  out.push(pt.aboveLimit ? `<polygon class="pt over" ${attrs} points="${n(cx)},${n(cy - 6)} ${n(cx + 6)},${n(cy)} ${n(cx)},${n(cy + 6)} ${n(cx - 6)},${n(cy)}"/>` : `<circle class="pt obs" ${attrs} cx="${n(cx)}" cy="${n(cy)}" r="3.5"/>`);
 });
 if (m.exhaustion?.approxAt) { const ex = xt(m.exhaustion.approxAt), ey = y(num(lastLimit.value)); out.push(`<path class="mark" d="M${n(ex - 6)} ${n(ey - 6)} l12 12 m0 -12 l-12 12"><title>Reported limit reached (conditional): UTC day ${safe(m.exhaustion.day)}</title></path>`); }

 const swatch = (inner: string) => `<svg width="36" height="14" viewBox="0 0 36 14" aria-hidden="true" class="chart-frame">${inner}</svg>`;
 const legend: string[] = [], brief: string[] = [];
 const item = (sw: string, text: string, short?: string) => {
  legend.push(`<li>${swatch(sw)}<span>${text}</span></li>`);
  if (short) brief.push(`<li>${swatch(sw)}<span>${short}</span></li>`);
 };
 item(`<line class="obs" x1="2" y1="7" x2="34" y2="7"/><circle class="pt obs" cx="18" cy="7" r="4"/>`, 'Observed cumulative account counter (net usage as of each account update; not verified gross charges)', 'Credits used');
 if (m.connectors.length) item(`<line class="obs" x1="2" y1="7" x2="34" y2="7"/>`, 'Comparable interval — timing within it was not observed');
 if (m.unknown.length) item(`<rect class="unk" x="2" y="1" width="32" height="12"/>`, 'Unknown period (hatched) — not zero', 'Unknown period');
 item(`<line class="limit" x1="2" y1="7" x2="34" y2="7"/>`, 'Reported credit limit — not verified as base-only or total capacity', 'Reported limit');
 if (anyOver) item(`<polygon class="pt over" points="18,1 25,7 18,13 11,7"/>`, 'Above reported limit — usage above the reported limit (diamond marker, tinted region)', 'Above limit');
 if (p) {
  item(`<line class="central" x1="2" y1="7" x2="34" y2="7"/>`, `Expected trajectory (dashed) — ${safe(methodLabels[p.method] ?? p.method)}${p.tier === 'provisional' ? ', provisional estimate – limited history' : ', regular forecast'}`, p.tier === 'provisional' ? 'Expected usage (provisional)' : 'Expected usage');
  item(`<line class="lower" x1="2" y1="7" x2="34" y2="7"/>`, `Lower-usage scenario (dotted) — ${LOWER_FACTOR.label} of the selected observed rate`);
  item(`<line class="higher" x1="2" y1="7" x2="34" y2="7"/>`, `Higher-usage scenario (dash-dot) — ${HIGHER_FACTOR.label} of the selected observed rate`);
  item(`<rect class="env" x="2" y="1" width="32" height="12"/>`, 'Scenario range — not a statistical confidence interval', 'Scenario range');
  if (m.evaluatedAt && Date.parse(m.evaluatedAt) > Date.parse(m.asOf!)) item(`<line class="query" x1="2" y1="7" x2="34" y2="7"/>`, 'Evaluation time — the span since the last update is estimated, not measured');
 }
 if (m.budget) item(`<line class="budget" x1="2" y1="7" x2="34" y2="7"/>`, 'Budget guide — even allocation of remaining reported capacity', 'Daily budget pace');
 if (m.resetAt) item(`<line class="reset" x1="2" y1="7" x2="34" y2="7"/>`, 'Billing reset (UTC)', 'Reset');
 if (m.exhaustion) item(`<path class="mark" d="M12 1 l12 12 m0 -12 l-12 12"/>`, 'Reported limit reached (conditional)', 'Limit reached (if rate continues)');
 if (m.events.length) item(`<path class="flag" d="M18 1 l-7 12 h14 z"/>`, 'Series break: counter adjustment, limit change or unsupported extra credits', 'Series break');
 if (p && [p.central, p.lower, p.higher].some(s => s.clipped)) item(`<path class="flag" d="M18 1 l-7 12 h14 z"/>`, 'A trajectory continues beyond the chart; its full endpoint is in the summary and table');

 const summary = summaryText(m);
 const startNote = m.axis.startKnown ? '' : ' The earlier part of the cycle was not observed; the series starts at the first retained update.';
 const notes = `<p class="muted small">Points are the observed cumulative account counter, net usage as of each account update — not independently verified gross charges. Missing or incompatible periods are unknown, never zero.${startNote}</p>`
  + (p ? `<p class="muted small">The shaded range is a scenario range, not a statistical confidence interval. Lower-usage means lower consumption (${LOWER_FACTOR.label} of the selected observed rate); higher-usage means higher consumption (${HIGHER_FACTOR.label}). Observed history is never scaled.</p>` : '');
 const caption = p ? `Expected usage assumes the observed rate continues; the shaded range is a ${LOWER_FACTOR.label}–${HIGHER_FACTOR.label} scenario, not a confidence interval.` : 'No forecast trajectory is drawn while the forecast is unavailable or stale.';
 const main = `<section id="usage-chart" aria-labelledby="chart-heading"><h2 id="chart-heading">Usage trajectory</h2>`
  + `<figure class="chart-frame"><svg viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="chart-title" aria-describedby="chart-desc chart-data-table" xmlns="http://www.w3.org/2000/svg"><title id="chart-title">Observed credit usage and scenario trajectories until the billing reset</title><desc id="chart-desc">${safe(summary)} Use arrow keys to move through plotted account updates.</desc>${out.join('')}</svg><p id="chart-tooltip" class="chart-tooltip" role="tooltip" hidden></p></figure>`
  + (clipNotes ? `<ul class="chart-clip">${clipNotes}</ul>` : '')
  + `<ul class="chart-legend">${brief.join('')}</ul><p class="muted small">${safe(caption)}</p>`
  + `<details class="chart-help"><summary>How to read this chart</summary>${notes}<h4>Chart key</h4><ul class="chart-legend chart-legend-full">${legend.join('')}</ul></details></section>`;
 const advanced = `<div id="chart-details"><h3>Chart details</h3><p id="chart-summary">${safe(summary)}</p>`
  + `<details><summary>Chart data table</summary><div id="chart-data-table" class="chart-scroll"><table class="chart-data chart-table"><caption>Every value drawn on the chart (UTC; amounts are credits)</caption><thead><tr><th scope="col">Layer</th><th scope="col">Time (UTC)</th><th scope="col">Credits</th><th scope="col">Meaning</th></tr></thead><tbody>${tableRows(m)}</tbody></table></div></details></div>`;
 return { main, advanced };
}
