import { test } from 'node:test';
import assert from 'node:assert/strict';
import { view } from '../../src/view.ts';
import { present } from '../../src/extension/presentation.ts';
import { chartModel, MAX_CHART_POINTS } from '../../src/extension/chart-model.ts';
import { presentChart, CHART_CSS } from '../../src/extension/chart.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

const day = (i: number) => `2030-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`;
const series = (rate: number, limit = '1000', count = 8) => Array.from({ length: count }, (_, i) => snapshot(day(i), String(i * rate), { limit }));
const observe = (snaps = series(10), now = day(7)) => view(snaps, now);
const chart = (snaps = series(10), now = day(7)) => presentChart(observe(snaps, now));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const summary = (html: string) => /<p id="chart-summary"[^>]*>(.*?)<\/p>/s.exec(html)![1];
const table = (html: string) => /<table class="chart-data[^"]*">(.*?)<\/table>/s.exec(html)![1];
const plot = (html: string) => /<svg viewBox="0 0 640[\s\S]*?<\/svg>/.exec(html)![0];

// Synthetic capacity cases. The counter alone never says which semantics applies.
const enterprise = () => series(300, '2000');              // usage 2100 / reported limit 2000
const individualPrepaid = () => series(300, '2125');       // usage 2100 / reported limit 2125

test('usage above the reported limit is preserved, visible and not an impossible state', () => {
 const o = observe(enterprise());
 const m = chartModel(o);
 assert.equal(m.status, 'ready');
 assert.equal(m.points.at(-1)!.usage, '2100');
 assert.equal(m.points.at(-1)!.aboveLimit, true);
 assert.equal(m.limits[0].value, '2000');
 assert.ok(m.yMax >= 2100, 'axis must include observed usage above the limit');
 const html = presentChart(o);
 assert.match(html, /Above reported limit/);
 assert.match(html, /2100/);
 assert.match(summary(html), /100 credits above the reported limit/);
 assert.match(table(html), /above reported limit/i);
});

test('capacity labels never claim base-only or total capacity and billing is not inferred', () => {
 for (const snaps of [enterprise(), individualPrepaid()]) {
  const html = chart(snaps), plain = text(html);
  assert.match(plain, /Reported credit limit/);
  assert.match(plain, /not verified as (base-only|base-plan-only) or total/i);
  // The fuller caveat is said once, in the credit view's "About these numbers", not repeated in the chart help.
  assert.ok(!/does not establish actual overage charges/.test(plain));
  const about = text(present(observe(snaps)).html);
  assert.match(about, /may include purchased add-on credits/i);
  assert.match(about, /do not by themselves establish overage charges or a purchased balance/i);
  assert.ok(!/base credit limit/i.test(plain));
  assert.ok(!/verified total available/i.test(plain.replace(/not verified[^.]*\./gi, '')));
 }
});

test('individual prepaid capacity 2100 / 2125 stays below the reported limit and keeps the remaining capacity', () => {
 const o = observe(individualPrepaid());
 const m = chartModel(o);
 assert.equal(m.points.at(-1)!.aboveLimit, false);
 assert.equal(m.limits[0].value, '2125');
 const plain = text(presentChart(o));
 assert.match(plain, /25 credits below the reported limit/);
 assert.ok(!/displayed as observed/.test(plain));
 assert.ok(!/class="pt over"/.test(plot(presentChart(o))));
});

test('both capacity cases render the same observed counter without claiming overage charges', () => {
 const a = text(chart(enterprise())), b = text(chart(individualPrepaid()));
 assert.match(a, /2100 credits/);
 assert.match(b, /2100 credits/);
 assert.ok(!/overage (charge|bill|cost) (of|is|will)/i.test(a + b));
});

test('presentation terminology no longer calls the reported limit base-only', () => {
 const p = present(observe(enterprise()));
 assert.match(p.html, /reported credits/); // above the limit there is no remaining figure to show
 assert.ok(!/Credits left/.test(p.html));
 assert.match(p.html, /Reported credit limit/);
 assert.match(p.text, /Above reported limit/);
 assert.ok(!/Base credits exhausted/.test(p.text + p.html));
 const q = present(observe(individualPrepaid()));
 assert.match(q.html, /Credits left/);
});

test('clipped higher scenario is flagged on the chart and its full endpoint is in the accessible summary and table', () => {
 const o = observe(series(10, '100'));
 const m = chartModel(o);
 assert.equal(m.status, 'ready');
 const high = m.projection!.higher;
 assert.equal(high.end, '357.5');
 assert.equal(high.clipped, true);
 assert.ok(m.yMax < 357.5);
 const html = presentChart(o);
 assert.match(html, /continues beyond the chart/i);
 assert.match(summary(html), /357\.5 credits at reset/);
 assert.match(table(html), /357\.5/);
 assert.match(text(html), /▲/);
});

test('unclipped scenarios carry no beyond-the-chart indicator', () => {
 const m = chartModel(observe(series(10, '1000')));
 assert.equal(m.projection!.higher.clipped, false);
 assert.ok(!/continues beyond the chart/i.test(presentChart(observe(series(10, '1000')))));
});

test('scenario endpoints are exact scenario ranges from the selected rate, not confidence intervals', () => {
 const m = chartModel(observe(series(10, '1000')));
 const p = m.projection!;
 assert.equal(p.central.end, '300');
 assert.equal(p.lower.end, '242.5');
 assert.equal(p.higher.end, '357.5');
 const plain = text(chart(series(10, '1000')));
 assert.match(plain, /75% of the selected observed rate/);
 assert.match(plain, /125% of the selected observed rate/);
 assert.match(plain, /scenario range, not a statistical confidence interval/i);
 assert.match(plain, /lower consumption/);
 assert.match(plain, /higher consumption/);
});

test('accessible data parity: every displayed value appears in the text alternative', () => {
 const o = observe(series(10, '100'));
 const m = chartModel(o);
 const html = presentChart(o);
 const t = table(html);
 for (const p of m.points) { assert.ok(t.includes(p.at), p.at); assert.ok(t.includes(`>${p.usage}<`) || t.includes(`${p.usage} credits`), p.usage); }
 const markers = plot(html).match(/<(circle|polygon) class="pt/g) ?? [];
 // Markers are reduced to the ends, isolated and above-limit updates; every update stays in the data table.
 assert.ok(markers.length >= 2 && markers.length <= m.points.length);
 const rows = (t.match(/data-kind="point"/g) ?? []).length;
 assert.equal(rows, m.points.length);
 const plain = text(html);
 for (const value of [m.limits[0].value, m.projection!.central.end, m.projection!.lower.end, m.projection!.higher.end]) assert.ok(plain.includes(value), value);
 // Budget guide endpoints and exhaustion
 assert.ok(m.budget);
 assert.ok(t.includes(m.budget!.from.at) && t.includes(m.budget!.to.at));
 assert.match(t, /Budget guide/);
 assert.match(t, /Reset/);
 assert.ok(m.exhaustion);
 assert.match(plain, /Reported limit reached \(conditional\)/);
 assert.ok(plain.includes(m.exhaustion!.day));
});

test('budget guide spends the remaining reported capacity evenly and is omitted when none remains', () => {
 const m = chartModel(observe(series(10, '1000')));
 assert.deepEqual([m.budget!.from.usage, m.budget!.to.usage], ['70', '1000']);
 assert.equal(m.budget!.to.at, '2030-07-01T00:00:00.000Z');
 const gone = chartModel(observe(enterprise()));
 assert.equal(gone.budget, null);
 assert.match(text(presentChart(observe(enterprise()))), /Budget guide not shown: no remaining reported capacity/);
});

test('conditional exhaustion appears only when the engine projects it before reset', () => {
 const over = chartModel(observe(series(10, '100')));
 assert.equal(over.exhaustion!.day, '2030-06-11');
 assert.equal(over.exhaustion!.conditional, true);
 assert.equal(chartModel(observe(series(10, '1000'))).exhaustion, null);
 assert.equal(chartModel(observe(series(0, '1000'))).exhaustion, null);
});

test('stale, unavailable and collecting data keep observed history but drop projected reassurance', () => {
 const stale = observe(series(10, '100'), '2030-06-09T00:00:00.001Z');
 const m = chartModel(stale);
 assert.equal(m.points.length, 8);
 assert.equal(m.projection, null);
 assert.equal(m.budget, null);
 assert.equal(m.exhaustion, null);
 const plain = text(presentChart(stale));
 assert.match(plain, /Projection not shown/);
 assert.ok(!/Higher-usage scenario/.test(plain.replace(/Projection not shown[^.]*\./, '')));
 const few = chartModel(observe(series(10, '1000', 2), day(1)));
 assert.equal(few.points.length, 2);
 assert.equal(few.projection, null);
});

test('provisional forecasts are labeled provisional', () => {
 const m = chartModel(observe(series(10, '1000', 3), day(2)));
 assert.equal(m.projection!.tier, 'provisional');
 assert.match(text(presentChart(observe(series(10, '1000', 3), day(2)))), /Provisional estimate/);
});

test('long gaps and counter adjustments are never bridged by an observed connector', () => {
 const snaps = [snapshot(day(0), '0'), snapshot(day(1), '10'), snapshot(day(4), '40'), snapshot(day(5), '50'), snapshot(day(6), '20'), snapshot(day(7), '30')];
 const o = observe(snaps, day(7));
 const m = chartModel(o);
 const pairs = m.connectors.map(c => `${m.points[c[0]].at}>${m.points[c[1]].at}`);
 assert.deepEqual(pairs, ['2030-06-01T00:00:00.000Z>2030-06-02T00:00:00.000Z', '2030-06-05T00:00:00.000Z>2030-06-06T00:00:00.000Z', '2030-06-07T00:00:00.000Z>2030-06-08T00:00:00.000Z']);
 assert.ok(m.unknown.some(u => u.from === '2030-06-02T00:00:00.000Z' && u.to === '2030-06-05T00:00:00.000Z'));
 assert.ok(m.events.some(e => e.kind === 'usage_adjustment' && e.at === '2030-06-07T00:00:00.000Z'));
 const plain = text(presentChart(o));
 assert.match(plain, /not negative spending/);
 assert.match(plain, /Unknown/);
});

test('a changed reported limit starts a new segment', () => {
 const snaps = [...series(10, '1000', 4), ...Array.from({ length: 4 }, (_, i) => snapshot(day(i + 4), String(40 + i * 10), { limit: '1500' }))];
 const m = chartModel(observe(snaps, day(7)));
 assert.deepEqual(m.limits.map(l => l.value), ['1000', '1500']);
 assert.ok(m.events.some(e => e.kind === 'limit_change'));
 assert.ok(!m.connectors.some(([a, b]) => m.points[a].limit !== m.points[b].limit));
});

test('mid-cycle observation start marks the earlier period unknown instead of zero', () => {
 const snaps = series(10, '1000', 4).map((s, i) => ({ ...s, observedAt: day(i + 10), observedText: day(i + 10) }));
 const o = observe(snaps, day(13));
 const m = chartModel(o);
 assert.ok(m.points.every(p => Number(p.usage) >= 0));
 assert.equal(m.points[0].usage, '0');
 assert.equal(m.axis.startKnown, false);
 assert.equal(m.axis.startAt, m.points[0].at);
});

test('decimation is bounded, keeps barriers and the table lists exactly the plotted points', () => {
 const many = Array.from({ length: 3000 }, (_, i) => snapshot(new Date(Date.parse('2030-06-01T00:00:00Z') + i * 600000).toISOString(), String(i)));
 const o = view(many, '2030-06-21T20:00:00Z');
 const m = chartModel(o);
 assert.ok(m.points.length <= MAX_CHART_POINTS);
 assert.equal(m.omittedPoints, m.totalPoints - m.points.length);
 assert.ok(m.omittedPoints > 0);
 assert.equal(m.points[0].at, '2030-06-01T00:00:00.000Z');
 assert.equal(m.points.at(-1)!.at, '2030-06-21T19:50:00.000Z');
 const html = presentChart(o);
 assert.equal((table(html).match(/data-kind="point"/g) ?? []).length, m.points.length);
 { const markers = (plot(html).match(/<(circle|polygon) class="pt/g) ?? []).length; assert.ok(markers >= 2 && markers <= m.points.length); }
 assert.match(text(html), new RegExp(`${m.omittedPoints} retained account updates`));
 assert.ok(html.length < 72_000, `chart HTML ${html.length} bytes`); // Measured at 62 KB for 96 keyboard-labeled points.
});

test('decimation never drops a barrier endpoint', () => {
 const base = Date.parse('2030-06-01T00:00:00Z');
 const snaps = Array.from({ length: 400 }, (_, i) => snapshot(new Date(base + i * 3600000).toISOString(), String(i), { limit: '100000' }));
 const barrier = 200;
 const shifted = snaps.map((s, i) => i >= barrier ? { ...s, observedAt: new Date(base + (i + 60) * 3600000).toISOString(), observedText: '' } : s);
 const m = chartModel(view(shifted, shifted.at(-1)!.observedAt));
 const times = m.points.map(p => p.at);
 assert.ok(times.includes(new Date(Date.parse(shifted[barrier - 1].observedAt)).toISOString()));
 assert.ok(times.includes(new Date(Date.parse(shifted[barrier].observedAt)).toISOString()));
 assert.ok(!m.connectors.some(([a, b]) => m.points[a].at === new Date(Date.parse(shifted[barrier - 1].observedAt)).toISOString() && m.points[b].at === new Date(Date.parse(shifted[barrier].observedAt)).toISOString()));
});

test('chart output is script-free, escaped and carries no private identifiers', () => {
 const p = present(observe(series(10, '100')));
 assert.ok(!/<script/i.test(p.html));
 assert.ok(!/\son[a-z]+=/i.test(p.html));
 assert.ok(!/javascript:/i.test(p.html));
 // The only web links are the community footer's; the chart itself links nowhere and loads nothing.
 assert.ok(!/(href|src)="https?:/i.test(p.html.replace(/<footer class="community[\s\S]*?<\/footer>/, '')));
 assert.ok(!/src="/i.test(p.html));
 assert.match(p.html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
 for (const marker of ['synthetic-private', 'partition', 'sourceTimezone']) assert.ok(!p.html.includes(marker));
 assert.match(p.html, /<svg[^>]*role="group"/); // the chart; the usage bar is decorative and aria-hidden
 assert.match(p.html, /<svg class="bar"[^>]*aria-hidden="true"/);
 assert.match(p.html, /id="usage-chart"/);
});

test('accessible alternatives and non-color encodings are present', () => {
 const html = presentChart(observe(series(10, '100')));
 assert.match(html, /role="group" aria-labelledby="chart-title" aria-describedby="chart-desc chart-data-table"/);
 assert.equal((html.match(/data-chart-point="/g) ?? []).length, chartModel(observe(series(10, '100'))).points.length);
 assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
 assert.match(html, /id="chart-tooltip"[^>]*role="tooltip" hidden/);
 assert.match(html, /<title id="chart-title">/);
 assert.match(html, /<desc id="chart-desc">/);
 assert.match(html, /stroke-dasharray=/);
 assert.match(html, /<details>?[^>]*><summary>Chart data table/);
 assert.match(html, /<caption>/);
 assert.match(html, /class="chart-legend"/);
 assert.match(CHART_CSS, /forced-colors:active/);
 assert.match(present(observe(series(10, '100'))).html, /forced-colors:active/);
});

test('plotted points report the change from the preceding observed update and barriers as not comparable', () => {
 const points = [snapshot(day(0), '1'), snapshot(day(1), '2.25'), snapshot(day(2), '0.5'), snapshot(day(3), '1.75')];
 const model = chartModel(observe(points, day(3)));
 assert.deepEqual(model.points.map(p => p.change), [null, '1.25', null, '1.25']);
 const html = presentChart(observe(points, day(3)));
 assert.match(html, /change since previous update: 1\.25 credits/);
 assert.match(html, /change since previous update: not comparable/);
});

test('unavailable history renders an honest empty state', () => {
 const html = presentChart(view([], day(0)));
 assert.match(text(html), /There are no account updates to chart yet\./);
 assert.ok(!html.includes('<svg'));
});

test('injected markers in model strings are escaped', () => {
 const o = observe(series(10, '100'));
 o.forecast.reasons.push('<img src=x onerror=synthetic-sentinel>');
 const html = presentChart(o);
 assert.ok(!html.includes('<img'));
});
