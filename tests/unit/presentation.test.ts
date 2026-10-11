import { test } from 'node:test';
import assert from 'node:assert/strict';
import { view } from '../../src/view.ts';
import { present } from '../../src/extension/presentation.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';
const series=(rate:number,limit='1000',count=8)=>Array.from({length:count},(_,i)=>snapshot(`2030-06-${String(i+1).padStart(2,'0')}T00:00:00Z`,String(i*rate),{limit}));
const render=(rate:number,limit='1000',count=8,now=`2030-06-${String(count).padStart(2,'0')}T00:00:00Z`)=>present(view(series(rate,limit,count),now));

test('status emphasizes daily budget and outlook without repeating balance',()=>{
 const r=render(10);assert.match(r.text,/Kiro: On track • 40\.4\/day/);
 assert.ok(!r.text.includes('930'));assert.match(r.tooltip,/Regular forecast/);
 assert.match(r.tooltip,/Daily credit budget until reset: 40\.434782/);
 assert.match(r.html,/Daily credit budget until reset/);assert.match(r.html,/Remaining reported capacity/);
 assert.match(r.html,/id="status-heading"/);assert.match(r.html,/Data quality \/ notes/);
 assert.ok(r.html.indexOf('class="stats"')<r.html.indexOf('Observed history'));
});
test('regular tight and over-budget states reflect the modeled budget and conditional exhaustion',()=>{
 assert.match(render(10,'321').text,/At risk • 10\.9\/day/);
 assert.match(render(10,'300').text,/At risk/); // Rate equals budget, no exhaustion before reset.
 const r=render(10,'100');assert.match(r.text,/Likely to exceed • empty 11 Jun/);
 assert.equal(r.warning,true);assert.match(r.html,/Estimated to run out on 11 Jun 2030/);
 assert.match(r.html,/UTC/);
 assert.match(render(10,'60').text,/Above reported limit/);assert.match(render(10,'70').text,/Reported limit reached/);
 assert.match(render(0).text,/On track/);assert.match(render(0).html,/No exhaustion date at the observed zero rate/);
});
test('provisional tier remains visible even when the early rate predicts exhaustion',()=>{
 const r=render(10,'1000',3);assert.match(r.text,/Provisional • 35\/day/);
 assert.match(r.html,/Provisional estimate – limited history/);
 assert.match(r.html,/limited window may not represent future usage/);
 const risk=render(10,'25',3);assert.match(risk.text,/Provisional • empty 3 Jun/);
 assert.match(risk.tooltip,/Likely to exceed/);assert.equal(risk.warning,true);
});
test('collecting, stale and unsafe data never display reassuring outlooks',()=>{
 const collecting=render(10,'1000',1);assert.match(collecting.text,/Collecting data/);
 assert.match(collecting.html,/Forecast not ready yet — more history needed/);
 assert.match(collecting.html,/at least 48 hours/);assert.match(collecting.html,/at least 7 days/);
 const stale=render(10,'1000',8,'2030-06-09T00:00:00.001Z');assert.match(stale.text,/Stale data/);
 assert.match(stale.html,/Forecast paused — stale data/);assert.ok(!stale.text.includes('/day'));
 const accounts=series(10);accounts[2].partition='synthetic-other';
 assert.match(present(view(accounts,'2030-06-08T00:00:00Z')).text,/Unavailable/);
 const extras=series(10).map(p=>({...p,flags:['unsupported_extra_credits']}));
 assert.match(present(view(extras,'2030-06-08T00:00:00Z')).text,/Unavailable/);
 assert.match(render(10,'1000',8,'2030-07-01T00:00:00Z').text,/Unavailable/);
});
test('presentation preserves exact amounts and private keys stay absent',()=>{
 const r=present(view([snapshot('2030-06-01T00:00:00Z','0.123456789')],'2030-06-01T00:00:00Z'));
 assert.match(r.html,/0\.123456789/);
 for(const marker of ['synthetic-private','partition','sourceTimezone']) assert.ok(!r.html.includes(marker));
 assert.match(r.html,/default-src 'none'/);
});

// v0.5.1 progressive disclosure: concise default reading flow, one collapsed Advanced details section.
const split=(html:string)=>{const i=html.indexOf('<section id="advanced-details"');assert.ok(i>0);return {primary:html.slice(0,i),advanced:html.slice(i)};};
const visible=(html:string)=>html.replace(/<(title|desc|style)\b[\s\S]*?<\/\1>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

test('default view is concise and exactly one Advanced details section is collapsed',()=>{
 const {html}=render(10);const {primary,advanced}=split(html);
 assert.equal((html.match(/<details class="advanced">/g)??[]).length,1);
 assert.ok(!/<details[^>]*\bopen\b/.test(html),'no details element is expanded by default');
 assert.match(advanced,/<summary>Advanced details<\/summary>/);
 for(const technical of ['Forecast methods','Quality codes','Exact billing reset','Forecast qualifiers','Chart data table','Forecast policy','Gaps and quality barriers','Evidence-backed cycle start','comparable snapshots over','Source time interpretation']){
  assert.ok(!primary.includes(technical),`${technical} must not be in the primary view`);
  assert.ok(advanced.includes(technical),`${technical} must remain in Advanced details`);
 }
 for(const essential of ['Credits used','Remaining reported capacity','Daily credit budget until reset','status-heading','Usage trajectory','Next reset','Last account update']) assert.ok(primary.includes(essential),essential);
 assert.ok(primary.indexOf('class="stats"')<primary.indexOf('id="usage-chart"'));
 assert.ok(primary.indexOf('id="usage-chart"')<primary.indexOf('id="cost-optimizer"')||!primary.includes('id="cost-optimizer"'));
});

test('forecast-unavailable and collecting messages appear once in the default reading flow',()=>{
 const collecting=split(render(10,'1000',1).html).primary;
 assert.equal((visible(collecting).match(/Forecast not ready yet/g)??[]).length,1);
 assert.ok(!/at least 48 hours/.test(collecting));assert.match(split(render(10,'1000',1).html).advanced,/at least 48 hours/);
 const unavailable=visible(split(present(view(series(10),'2030-07-01T00:00:00Z')).html).primary);
 assert.ok(!/Projection not shown/.test(unavailable));
});

test('freshness, uncertainty and above-limit warnings stay in the default view',()=>{
 const stale=visible(split(render(10,'1000',8,'2030-06-09T00:00:00.001Z').html).primary);
 assert.match(stale,/Forecast paused — stale data/);assert.match(stale,/Stale — waiting for a fresh account update/);
 const provisional=visible(split(render(10,'1000',3).html).primary);
 assert.match(provisional,/Provisional estimate – limited history/);assert.match(provisional,/may not represent future usage/);
 const above=visible(split(render(10,'60').html).primary);
 assert.match(above,/above the reported credit limit|Above reported limit/);assert.match(above,/not verified as base-only or total capacity/);
 const fresh=visible(split(render(10).html).primary);assert.match(fresh,/Fresh/);
 assert.match(fresh,/Estimated to run out|not projected to be reached|On track/);
});

test('chart default shows a compact legend and a shorter frame only when history is sparse',()=>{
 const full=render(10).html,sparse=render(10,'1000',3).html;
 const frame=(h:string)=>Number(/<svg viewBox="0 0 640 (\d+)"/.exec(h)![1]);
 assert.equal(frame(full),340);assert.equal(frame(sparse),240);
 const {primary,advanced}=split(full);
 const items=(h:string,cls:string)=>(new RegExp(`<ul class="${cls}">([\\s\\S]*?)</ul>`).exec(h)?.[1].match(/<li>/g)??[]).length;
 assert.ok(items(primary,'chart-legend')>0&&items(primary,'chart-legend')<=items(primary,'chart-legend chart-legend-full'));
 assert.ok(!/not verified gross charges/.test(primary.replace(/<desc[\s\S]*?<\/desc>/,'').replace(/<details class="chart-help">[\s\S]*?<\/details>/,'')));
 assert.match(primary,/<details class="chart-help"><summary>How to read this chart/);
 assert.match(advanced,/id="chart-summary"/);assert.match(advanced,/<summary>Chart data table/);
 assert.match(primary,/<desc id="chart-desc">[^<]*Expected trajectory/);
 assert.ok(!/<script/i.test(full));assert.match(full,/default-src 'none'; style-src 'unsafe-inline'/);
 assert.match(full,/<svg[^>]*role="img"/);assert.match(full,/prefers-color-scheme|var\(--vscode-/);
});

// Dashboard redesign: status first, one-click details, advanced only behind the collapsed section.
const hero=(html:string)=>/<section class="hero[^"]*"[\s\S]*?<\/section>/.exec(html)![0];
test('hero answers used, remaining and reset first and labels the forecast status in plain words',()=>{
 const h=visible(hero(render(10).html));
 for(const t of ['On track','Credits used','Remaining reported capacity','Next reset','Last account update','Regular forecast']) assert.match(h,new RegExp(t));
 assert.match(h,/will use about \d+ of 1000 reported credits/);
 assert.match(hero(render(10).html),/role="img" aria-label="\d+% of the reported credit limit used"/);
 assert.match(visible(hero(render(10,'321').html)),/At risk/);assert.match(visible(hero(render(10,'321').html)),/within 10% of the daily budget/);
 assert.match(visible(hero(render(10,'100').html)),/Likely to exceed/);
 assert.ok(!/Tight budget|Over budget/.test(render(10,'321').html+render(10,'100').html));
 // Status carries an icon glyph as well as colour, and the hero is a labelled landmark.
 assert.match(hero(render(10).html),/class="status-icon" aria-hidden="true"/);assert.match(render(10).html,/aria-labelledby="status-heading"/);
});
test('uncertain states are never styled as on track and keep their warning in the hero',()=>{
 for(const [r,label] of [[render(10,'1000',8,'2030-06-09T00:00:00.001Z'),'Stale data'],[render(10,'1000',1),'Collecting data'],[render(10,'1000',3),'Provisional estimate – limited history']] as const){
  const h=hero(r.html);assert.match(visible(h),new RegExp(label));assert.ok(!/class="hero ok"/.test(h));
 }
 assert.match(hero(render(10,'1000',8,'2030-06-09T00:00:00.001Z').html),/class="hero warn"/);
 assert.match(hero(render(10,'1000',3).html),/may not represent future usage/);
 assert.match(visible(hero(render(10,'60').html)),/Above reported limit/);
});
test('chart key and caveats are one click away, collapsed, and only one top-level advanced section exists',()=>{
 const {primary}=split(render(10).html);
 assert.match(primary,/<details class="chart-help">/);assert.ok(!/<details[^>]*\bopen\b/.test(primary));
 assert.match(primary,/class="zone"[^>]*>Forecast<\/text>/);
 assert.match(primary,/class="split"/);
 assert.equal((render(10).html.match(/<h1>/g)??[]).length,1);
});

test('provisional on-track forecasts are neutral, passed resets are labelled, usage bar is clamped',()=>{
 const prov=hero(render(10,'1000',3).html);
 assert.match(prov,/class="hero neutral"/);assert.match(visible(prov),/Looks on track so far/);assert.ok(!/On track/.test(visible(prov)));
 assert.ok(!/class="status-icon"[^>]*>✓/.test(hero(render(10,'1000',1).html)));
 assert.match(hero(render(10,'1000',8,'2030-07-01T00:00:00Z').html),/class="hero warn"/);
 assert.ok(!/class="hero ok"/.test(hero(render(10,'1000',8,'2030-07-01T00:00:00Z').html)));
 assert.match(hero(render(10,'60').html),/aria-label="100% of the reported credit limit used"/);
});
