import { test } from 'node:test';
import assert from 'node:assert/strict';
import { view } from '../../src/view.ts';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { present } from '../../src/extension/presentation.ts';
import { largerPlanText, rightSizeText } from '../../src/extension/budget-warning.ts';
import { startExtension } from '../../src/extension/controller.ts';
import type { AuditSummary } from '../../src/extension/audit-model.ts';
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
const visible=(html:string)=>{
 let current=html,previous:string;
 do{
  previous=current;
  current=current.replace(/<(title|desc|style)\b[\s\S]*?<\/\1>/g,'');
 }while(current!==previous);
 return current.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
};

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
 assert.ok(!/<script/i.test(full));assert.ok(!/\sstyle=/i.test(full));
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
 assert.match(primary,/class="split"/);
 const late=split(render(10,'1000',20).html).primary;assert.match(late,/>Observed<\/text>/);assert.match(late,/>Forecast<\/text>/);
 assert.ok(!/class="zone"/.test(primary),'zone labels are omitted when they would collide with the limit label');
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

// Workspace-check card: counts and times only; its two links are the only links in the view and carry no arguments.
const card = (audit: AuditSummary | undefined, now = '2030-06-15T12:00:00.000Z') => present(view(series(10), '2030-06-08T00:00:00Z'), [], '', '', audit, now).html;
const allHrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
// The footer is covered by its own test; the card tests look at the command links only.
const hrefs = (html: string) => allHrefs(html).filter(h => h!.startsWith('command:') && h !== 'command:cyclegauge.share');
const ADVISOR = 'command:cyclegauge.costAdvisor';
const ALLOWED = ['command:cyclegauge.auditWorkspace', 'command:cyclegauge.audit.show'];
const cardHrefs = (html: string) => hrefs(html).filter(h => h !== ADVISOR);
test('workspace-check card: never checked offers only Check now', () => {
 const html = card({ state: 'never' });
 assert.match(html, /<h3 id="audit-heading">Workspace check<\/h3>/); assert.match(html, /Check which files Kiro can read but probably doesn&#39;t need\./);
 assert.deepEqual(cardHrefs(html), ['command:cyclegauge.auditWorkspace']); assert.match(html, />Check now<\/a>/); assert.ok(!html.includes('>Show</a>'));
 assert.ok(html.indexOf('class="stats"') < html.indexOf('class="audit-card"'));
 assert.match(card({ state: 'never', lastDate: '2030-03-01' }), /Last checked 2030-03-01 \(UTC\)\./);
 assert.ok(!card({ state: 'never', lastDate: '<b>synthetic</b>' }).includes('Last checked'));
});
test('workspace-check card: checked states show the count and a relative time, plus Show', () => {
 const now = new Date(2030, 5, 15, 12, 0, 0), ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
 const some = card({ state: 'checked', items: 3, checkedAt: ago(5 * 60_000) }, now.toISOString());
 assert.match(some, /3 items Kiro may read · checked 5 min ago/); assert.deepEqual(cardHrefs(some), ALLOWED); assert.match(some, /<a class="button primary" href="command:cyclegauge\.auditWorkspace">Check now<\/a>/); assert.match(some, /<a class="button secondary" href="[^"]+">Show<\/a>/);
 assert.match(card({ state: 'checked', items: 1, checkedAt: ago(0) }, now.toISOString()), /1 item Kiro may read · checked just now/);
 const none = card({ state: 'checked', items: 0, checkedAt: ago(26 * 3_600_000) }, now.toISOString());
 assert.match(none, /No risky files found · checked (yesterday|2 days ago|today)/); assert.deepEqual(cardHrefs(none), ALLOWED);
 const mixedCard = card({ state: 'checked', items: 2, unclear: 3, checkedAt: ago(0) }, now.toISOString());
 assert.match(mixedCard, /2 items Kiro may read · 3 unclear · checked just now/);
 assert.match(card({ state: 'checked', items: 0, unclear: 4, checkedAt: ago(0) }, now.toISOString()), /4 items to review · checked just now/);
 assert.match(card({ state: 'checked', items: 2 }), /2 items Kiro may read<\/p>/); // no usable time: no relative part
});
test('workspace-check card: the size total sits after the count, escaped and only for checked states', () => {
 const now = new Date(2030, 5, 15, 12, 0, 0), ago = (ms: number) => new Date(now.getTime() - ms).toISOString(), MB = 1024 * 1024;
 assert.match(card({ state: 'checked', items: 4, bytes: 240.3 * MB, lowerBound: false, checkedAt: ago(0) }, now.toISOString()), /4 items Kiro may read \(about 240\.3 MiB\) · checked just now/);
 assert.match(card({ state: 'checked', items: 2, unclear: 3, bytes: 1.2 * 1024 * MB, lowerBound: true, checkedAt: ago(0) }, now.toISOString()), /2 items Kiro may read \(at least 1\.2 GiB\) · 3 unclear · checked just now/);
 assert.match(card({ state: 'checked', items: 1, bytes: 512 * 1024, checkedAt: ago(0) }, now.toISOString()), /1 item Kiro may read \(about 512 KiB\) · checked just now/);
 assert.match(card({ state: 'checked', items: 1, bytes: 0, checkedAt: ago(0) }, now.toISOString()), /1 item Kiro may read · checked just now/);
 assert.match(card({ state: 'checked', items: 1, bytes: Number.NaN, checkedAt: ago(0) }, now.toISOString()), /1 item Kiro may read · checked just now/);
 assert.match(card({ state: 'never', bytes: 5 }), /Check which files Kiro can read/);
 const hostile = card({ state: 'checked', items: 1, bytes: 1024, lowerBound: true, checkedAt: 'synthetic-not-a-time' });
 assert.match(hostile, /1 item Kiro may read \(at least 1 KiB\)<\/p>/);
});
test('workspace-check card: unavailable asks for a trusted local folder; no claims of savings', () => {
 const html = card({ state: 'unavailable' });
 assert.match(html, /This folder can&#39;t be checked\. Run Check now to see why\./); assert.deepEqual(cardHrefs(html), ['command:cyclegauge.auditWorkspace']);
 for (const state of ['never', 'checked', 'unavailable'] as const) assert.ok(!/sav(e|ing)|reduc|cheaper|measured/i.test(card({ state, items: 2, bytes: 2048, lowerBound: true, checkedAt: '2030-06-15T11:00:00Z' }).match(/<section class="audit-card".*?<\/section>/s)![0]), state);
});
test('the view has one Open Cost Advisor button, inside the Cost Advisor section and below the figures, in every state', () => {
 const section = '<section id="cost-advisor" aria-labelledby="advisor-heading"><h2 id="advisor-heading">Cost Advisor</h2><p>synthetic</p></section>';
 for (const s of [undefined, { state: 'never' }, { state: 'checked', items: 1 }, { state: 'unavailable' }] as (AuditSummary | undefined)[]) {
  for (const html of [card(s), present(view(series(10), '2030-06-08T00:00:00Z'), [], '', section, s, '2030-06-15T12:00:00.000Z').html]) {
   assert.equal(hrefs(html).filter(h => h === ADVISOR).length, 1);
   assert.match(html, /<p class="advisor-actions"><a class="button primary" href="command:cyclegauge\.costAdvisor">Open Cost Advisor<\/a><\/p>/);
   assert.ok(html.indexOf('class="hero') < html.indexOf('advisor-actions"')); assert.ok(!html.includes('top-actions'));
  }
  assert.match(present(view(series(10), '2030-06-08T00:00:00Z'), [], '', section, s).html, /<p>synthetic<\/p><p class="advisor-actions">.*?<\/p><\/section>/);
 }
});
test('workspace-check card: only the three allowed command links, none with arguments, no other href, no path or folder name, script-free', () => {
 const states: AuditSummary[] = [{ state: 'never' }, { state: 'checked', items: 4, checkedAt: '2030-06-15T11:59:00Z' }, { state: 'checked', items: 0 }, { state: 'unavailable' }];
 for (const s of states) {
  const html = card(s); for (const h of hrefs(html)) { assert.ok([ADVISOR, ...ALLOWED].includes(h!), h); assert.ok(!/[?#%&=({\[]/.test(h!.slice('command:'.length)), h); }
  assert.ok(!/<script|javascript:|src=|\sonclick=|<form|<iframe/i.test(html)); assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
 }
 // Even a malicious summary cannot put a name or path into the card: only the number and the time are used.
 const evil = card({ state: 'checked', items: 2, checkedAt: '2030-06-15T11:59:00Z', folder: '/synthetic/private/folder', name: 'synthetic-folder' } as AuditSummary & Record<string, unknown>);
 assert.ok(!evil.includes('synthetic-folder') && !evil.includes('/synthetic/private'));
 assert.deepEqual(hrefs(card(undefined)), [ADVISOR]); assert.ok(!card(undefined).includes('class="audit-card"'));
 // Garbage never throws and never removes the figures.
 const garbage = card({ state: 'checked', items: Number.NaN, checkedAt: 'synthetic-not-a-time' }); assert.match(garbage, /No risky files found<\/p>/); assert.match(garbage, /id="status-heading"/);
});
test('the controller reads the summary on every render, re-renders on request and drops the card when the getter throws', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-audit-card-')));
 const htmls: string[] = []; let summary: () => AuditSummary = () => ({ state: 'never' });
 const ui = { setStatus(_t: string, html: string) { htmls.push(html); }, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: join(base, 'synthetic-missing'), storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-06-15T12:00:00.000Z', auditSummary: () => summary() });
  assert.match(htmls.at(-1)!, /Workspace check/);
  summary = () => ({ state: 'checked', items: 7, checkedAt: '2030-06-15T11:58:00.000Z' }); const count = htmls.length; extension.rerender();
  assert.equal(htmls.length, count + 1); assert.match(htmls.at(-1)!, /7 items Kiro may read · checked 2 min ago/);
  summary = () => { throw new Error('synthetic-failure'); }; extension.rerender();
  assert.ok(!htmls.at(-1)!.includes('Workspace check')); assert.match(htmls.at(-1)!, /id="status-heading"/); assert.deepEqual(hrefs(htmls.at(-1)!), [ADVISOR]);
  extension.dispose(); const after = htmls.length; extension.rerender(); assert.equal(htmls.length, after);
 } finally { await rm(base, { recursive: true, force: true }); }
});

// Community footer: three fixed https constants plus the Share command, in every state; nothing else is linked, no arguments, no scripts.
const FOOTER_LINKS = ['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', 'https://github.com/StefanSuess/Cyclegauge', 'https://ko-fi.com/stefansuess', 'command:cyclegauge.share'];
test('the footer links exactly the three web constants and the share command, below the main content', () => {
 for (const s of [undefined, { state: 'never' }, { state: 'checked', items: 2, checkedAt: '2030-06-15T11:59:00Z' }, { state: 'unavailable' }] as (AuditSummary | undefined)[]) {
  const html = card(s);
  assert.deepEqual(allHrefs(html).filter(h => !h!.startsWith('command:cyclegauge.') || h === 'command:cyclegauge.share'), FOOTER_LINKS);
  for (const h of allHrefs(html)) assert.ok([ADVISOR, ...ALLOWED, ...FOOTER_LINKS].includes(h!), h);
  assert.match(html, /<footer class="community muted small"><a href="https:\/\/open-vsx\.org[^"]*">★ Rate on Open VSX<\/a> · <a href="https:\/\/github\.com[^"]*">Star on GitHub<\/a> · <a href="https:\/\/ko-fi\.com[^"]*">☕ Support<\/a> · <a href="command:cyclegauge\.share">Share<\/a><\/footer><\/main>/);
  assert.ok(html.indexOf('<footer') > html.indexOf('id="advanced-details"'));
  assert.equal((html.match(/<footer/g) ?? []).length, 1);
  assert.ok(!/<script|javascript:|\?utm_|[?&]ref=|\sonclick=/i.test(html)); assert.match(html, /default-src 'none'; style-src 'unsafe-inline'/);
 }
 for (const h of FOOTER_LINKS) assert.ok(!/[?#%&=({\[]/.test(h.replace(/^https:\/\//, '').replace(/^command:/, '')), h);
});

// Outside Kiro without a chosen source, the empty source is expected and says so; everywhere else nothing changes.
const empty = (notKiro: boolean, codes: string[] = ['no_source_logs']) => present(view([], '2030-06-08T00:00:00Z'), codes, '', '', undefined, '2030-06-08T00:00:00Z', notKiro);
test('not in Kiro and no source logs: "Kiro not detected" in the status bar and the detail view', () => {
 const r = empty(true);
 assert.equal(r.text, '$(info) Kiro not detected'); assert.equal(r.warning, false);
 assert.equal(r.tooltip, 'Cyclegauge is built for Kiro IDE. This editor has no Kiro credit logs, so the credit view stays empty. The workspace audit still works.');
 assert.match(r.html, /Cyclegauge is built for Kiro IDE\. This editor has no Kiro credit logs, so the credit view stays empty\. The workspace audit still works\./);
 assert.match(r.html, /Kiro not detected<\/h2>/); assert.match(r.html, /class="hero neutral"/); assert.equal(r.forecast, false);
 assert.match(r.html, /<footer class="community/);
});
test('the notice does not apply inside Kiro, with other codes or when the flag is off', () => {
 assert.equal(empty(false).text, '$(warning) Kiro: Unavailable'); assert.ok(!empty(false).html.includes('Kiro not detected'));
 assert.equal(present(view([], '2030-06-08T00:00:00Z'), ['no_source_logs']).text, empty(false).text);
 assert.ok(!empty(true, ['source_unavailable']).text.includes('not detected'));
 assert.ok(!empty(true, []).text.includes('not detected'));
 assert.match(empty(true, ['no_source_logs', 'runtime_unsupported']).text, /update needed/);
 // With data present the normal view is unchanged even if the flag is set.
 const withData = present(view(series(10), '2030-06-08T00:00:00Z'), [], '', '', undefined, '2030-06-08T00:00:00Z', true);
 assert.equal(withData.text, render(10).text); assert.equal(withData.forecast, true);
});
test('a throwing forecast hook never stops the gauge from rendering a forecast', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-forecast-throw-')));
 const dir = join(base, 'source', 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent'); await mkdir(dir, { recursive: true });
 const line = (day: number) => `2030-01-0${day} 00:00:00.000 [info] synthetic-envelope ` + JSON.stringify({ commandName: 'GetUsageLimitsCommand', input: {}, output: { userInfo: { userId: 'synthetic-hook-account' }, nextDateReset: '2030-02-01T00:00:00Z', usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS', currentUsageWithPrecision: day * 10, usageLimitWithPrecision: 5000, nextDateReset: '2030-02-01T00:00:00Z', bonuses: [], overageCredits: [] }] }, metadata: { httpStatusCode: 200 } }) + '\n';
 await writeFile(join(dir, 'q-client.log'), [1, 2, 3, 4].map(line).join(''));
 const texts: string[] = []; let calls = 0;
 const ui = { setStatus(t: string) { texts.push(t); }, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: join(base, 'source'), storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-01-04T00:00:00.000Z', onForecast: () => { calls++; throw new Error('synthetic-failure'); } });
  assert.ok(calls >= 1); assert.match(texts.at(-1)!, /Kiro: (Provisional|On track|At risk)/);
  extension.rerender(); assert.ok(calls >= 2); assert.match(texts.at(-1)!, /Kiro: /); extension.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});
test('a throwing absent hook never stops the gauge from showing "Kiro not detected"', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-absent-throw-')));
 const texts: string[] = []; let calls = 0;
 const ui = { setStatus(t: string) { texts.push(t); }, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: join(base, 'synthetic-missing'), storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-01-04T00:00:00.000Z', notKiro: true, onAbsent: () => { calls++; throw new Error('synthetic-failure'); } });
  assert.ok(calls >= 1); assert.equal(texts.at(-1), '$(info) Kiro not detected'); extension.dispose();
  const normal = await startExtension(ui, { source: join(base, 'synthetic-missing'), storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-01-04T00:00:00.000Z', onAbsent: () => { calls += 100; } });
  assert.ok(calls < 100); normal.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});
test('the controller passes the not-Kiro flag through and does not report a forecast when there is none', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-forecast-hook-')));
 const texts: string[] = []; let calls = 0;
 const ui = { setStatus(t: string) { texts.push(t); }, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: join(base, 'synthetic-missing'), storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-06-15T12:00:00.000Z', notKiro: true, onForecast: () => { calls++; throw new Error('synthetic-failure'); } });
  assert.equal(calls, 0); assert.equal(texts.at(-1), '$(info) Kiro not detected');
  extension.rerender(); assert.equal(texts.at(-1), '$(info) Kiro not detected');
  extension.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});

// Modelled overage cost lines and the status bar severity.
const NOW = '2030-06-08T00:00:00Z';
const at = (v: ReturnType<typeof view>, now = NOW) => present(v, [], '', '', undefined, now);
const heroText = (html: string) => html.slice(html.indexOf('class="hero'), html.indexOf('<dl class="stats">'));
const PROJECTED = 'If you continue at this pace: about 200 credits over the reported limit ≈ $8.00 at $0.04 per credit (price list 2026-10-10, reviewed 10 Oct 2026). This is a modelled scenario, not an invoice; whether overage applies depends on your plan and settings.';
test('a forecast beyond the reported limit shows the modelled overage below the outlook, with the catalog price and review date', () => {
 const r = at(view(series(10, '100'), NOW));
 const hero = heroText(r.html);
 assert.ok(hero.includes(`<p class="small overage">${PROJECTED}</p>`), hero);
 assert.ok(hero.indexOf('class="lead"') < hero.indexOf('class="small overage"'));
 assert.ok(!r.html.includes('at the last update ≈')); // nothing is above the limit yet
 assert.ok(!/\$\d/.test(r.text) && !/\$\d/.test(r.tooltip)); // the status bar stays short
});
test('already-observed overage gets its own modelled line; the projected line stays separate', () => {
 const hero = heroText(at(view(series(10, '60'), NOW)).html);
 assert.ok(hero.includes('<p class="small overage">10 credits above the reported limit at the last update ≈ $0.40 at $0.04 per credit (modelled; whether overage applies depends on your plan and settings).</p>'), hero);
 assert.match(hero, /If you continue at this pace: about 240 credits over the reported limit ≈ \$9\.60 /);
 // Exactly at the limit is not above it.
 assert.ok(!heroText(at(view(series(10, '70'), NOW)).html).includes('above the reported limit at the last update'));
});
test('no overage line when the forecast stays below the limit, is unavailable or stale', () => {
 for (const html of [at(view(series(10, '1000'), NOW)).html, at(view(series(0, '1000'), NOW)).html, at(view(series(10, '1000', 1), '2030-06-01T00:00:00Z'), '2030-06-01T00:00:00Z').html, at(view(series(10, '100'), '2030-06-12T00:00:00Z')).html, at(view([], NOW)).html]) assert.ok(!html.includes('class="small overage"') && !html.includes('over the reported limit'), 'no line');
});
test('without a validated price the credits are shown but never a money figure', () => {
 const hero = heroText(at(view(series(10, '100'), NOW), '2020-01-01T00:00:00Z').html); // before the catalog was verified
 assert.ok(hero.includes('If you continue at this pace: about 200 credits over the reported limit. This is a modelled scenario, not an invoice;'), hero);
 assert.ok(!/\$\d/.test(hero));
 assert.ok(heroText(at(view(series(10, '60'), NOW), 'not-a-time').html).includes('10 credits above the reported limit at the last update.'));
});
test('the status bar severity: error when the limit is reached or will be before the reset, warning when at risk, stale or unavailable', () => {
 const severity = (rate: number, limit: string, count = 8, now = `2030-06-${String(count).padStart(2, '0')}T00:00:00Z`) => { const r = present(view(series(rate, limit, count), now)); return [r.severity, r.warning]; };
 assert.deepEqual(severity(10, '100'), ['error', true]); // likely to exceed
 assert.deepEqual(severity(10, '70'), ['error', true]); // limit reached
 assert.deepEqual(severity(10, '60'), ['error', true]); // above the limit
 assert.deepEqual(severity(10, '25', 3), ['warning', true]); // provisional "Likely to exceed" stays a warning
 assert.deepEqual(severity(10, '20', 3), ['error', true]); // provisional, but the observed usage has reached the limit
 assert.deepEqual(severity(10, '321'), ['warning', true]); // at risk
 assert.deepEqual(severity(10, '1000'), ['none', false]);
 assert.deepEqual(severity(0, '1000'), ['none', false]);
 assert.deepEqual(severity(10, '1000', 1), ['none', false]); // collecting
 assert.deepEqual(severity(10, '1000', 8, '2030-06-09T00:00:00.001Z'), ['warning', true]); // stale
 assert.deepEqual(severity(10, '1000', 8, '2030-07-01T00:00:00Z'), ['warning', true]); // unavailable
 assert.equal(present(view([], NOW), ['no_source_logs'], '', '', undefined, NOW, true).severity, 'none'); // Kiro not detected
 assert.equal(present(view([], NOW), ['runtime_unsupported']).severity, 'warning');
});
test('the controller hands the render to the budget hook with the eligibility and survives a throwing hook', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-budget-hook-')));
 const dir = join(base, 'source', 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent'); await mkdir(dir, { recursive: true });
 const line = (day: number) => `2030-01-0${day} 00:00:00.000 [info] synthetic-envelope ` + JSON.stringify({ commandName: 'GetUsageLimitsCommand', input: {}, output: { userInfo: { userId: 'synthetic-budget-account' }, nextDateReset: '2030-02-01T00:00:00Z', usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS', currentUsageWithPrecision: day * 10, usageLimitWithPrecision: 5000, nextDateReset: '2030-02-01T00:00:00Z', bonuses: [], overageCredits: [] }] }, metadata: { httpStatusCode: 200 } }) + '\n';
 await writeFile(join(dir, 'q-client.log'), [1, 2, 3, 4].map(line).join(''));
 const texts: string[] = [], metas: unknown[] = [], seen: { status: string; eligible: boolean; now: string }[] = [];
 const ui = { setStatus(t: string, _h: string, m?: unknown) { texts.push(t); metas.push(m); }, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: join(base, 'source'), storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-01-04T00:00:00.000Z', onBudget: (o, eligible, now) => { seen.push({ status: o.status, eligible, now }); throw new Error('synthetic-failure'); } });
  assert.ok(seen.length >= 1); assert.deepEqual(seen.at(-1), { status: 'observed', eligible: true, now: '2030-01-04T00:00:00.000Z' });
  assert.match(texts.at(-1)!, /Kiro: /); assert.ok(['none', 'warning', 'error'].includes((metas.at(-1) as { severity: string }).severity));
  const before = seen.length; extension.rerender(); assert.equal(seen.length, before + 1); extension.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});
test('no budget hook call for Kiro not detected', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-budget-absent-')));
 let calls = 0;
 const ui = { setStatus() {}, showDetails() {}, onClick() {}, onChange() {}, everyMinute() {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: join(base, 'synthetic-missing'), storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-06-15T12:00:00.000Z', notKiro: true, onBudget: () => { calls++; } });
  assert.equal(calls, 0); extension.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});

test('no observed-overage line for accounts with unsupported extra credits', () => {
 const flagged = series(10, '60').map(p => ({ ...p, flags: ['unsupported_extra_credits'] }));
 const html = at(view(flagged, NOW)).html;
 assert.ok(!html.includes('above the reported limit at the last update') && !html.includes('class="small overage"'));
 assert.ok(at(view(series(10, '60'), NOW)).html.includes('above the reported limit at the last update')); // control
});

// Plan hints (computed by the controller) shown in the credit view.
const LARGER_LINE = 'For comparison, if you are on Pro: Pro+ costs $20 a month more than Pro and includes 1000 more credits (list prices, price list reviewed 10 Oct 2026).';
const RIGHTSIZE_LINE = 'If you are on Pro+: You will likely leave about 1444 credits unused this cycle, and the last cycle also fit within Pro. Pro would cost about $20 a month less (modelled).';
const larger = { current: 'pro', next: 'pro_plus', feeDiff: '20', creditDiff: '1000', hint: true, reviewedOn: '2026-10-10T00:00:00Z' } as const;
const rightsize = { current: 'pro_plus', plan: 'pro', saving: '20', unusedCredits: '1444.5', hint: true } as const;
const withHints = (v: ReturnType<typeof view>, insights: Parameters<typeof present>[7]) => present(v, [], '', '', undefined, NOW, false, insights);
test('the next-larger-plan comparison follows the projected overage line; observed overage comes after it', () => {
 const hero = heroText(withHints(view(series(10, '60'), NOW), { larger, rightsize: null }).html);
 const lines = [...hero.matchAll(/<p class="small overage">([^<]*)<\/p>/g)].map(m => m[1]!);
 assert.equal(lines.length, 3);
 assert.ok(lines[0]!.startsWith('If you continue at this pace: about 240 credits over the reported limit'), lines[0]);
 assert.equal(lines[1], LARGER_LINE);
 assert.ok(lines[2]!.startsWith('10 credits above the reported limit at the last update'));
 // A confirmed plan has no prefix; no hints, or no projected overage line, means no comparison.
 assert.ok(heroText(withHints(view(series(10, '100'), NOW), { larger: { ...larger, hint: false }, rightsize: null }).html).includes('<p class="small overage">For comparison: Pro+ costs $20 a month more than Pro and includes 1000 more credits'));
 assert.ok(!heroText(at(view(series(10, '100'), NOW)).html).includes('For comparison'));
 assert.ok(!heroText(withHints(view(series(10, '100'), NOW), { larger: null, rightsize: null }).html).includes('For comparison'));
 assert.ok(!heroText(withHints(view(series(10, '1000'), NOW), { larger, rightsize: null }).html).includes('For comparison')); // no projected overage line
 assert.ok(!/save|cheaper|recommend/i.test(lines[1]!));
});
test('the right-sizing line is shown whenever the condition holds, not only near the reset, and a confirmed plan has no prefix', () => {
 const early = withHints(view(series(10, '1000'), NOW), { larger: null, rightsize }); // 23 days before the reset
 assert.ok(heroText(early.html).includes(`<p class="small overage">${RIGHTSIZE_LINE}</p>`));
 const confirmed = withHints(view(series(10, '1000'), NOW), { larger: null, rightsize: { ...rightsize, hint: false } });
 assert.ok(heroText(confirmed.html).includes('<p class="small overage">You will likely leave about 1444 credits unused this cycle, and the last cycle also fit within Pro. Pro would cost about $20 a month less (modelled).</p>'));
 assert.ok(!heroText(at(view(series(10, '1000'), NOW)).html).includes('You will likely leave'));
});
test('plan hint lines hold only constants and formatted decimals, go through the same escaping, and a malformed hint is left out', async () => {
 const plans = ['free', 'pro', 'pro_plus', 'pro_max', 'power'] as const;
 for (const hint of [true, false]) for (let k = 0; k < plans.length - 1; k++) {
  const texts = [largerPlanText({ current: plans[k]!, next: plans[k + 1]!, feeDiff: '20.5', creditDiff: '1000', hint, reviewedOn: '2026-10-10T00:00:00Z' }), largerPlanText({ current: plans[k]!, next: plans[k + 1]!, feeDiff: '20', creditDiff: '1000', hint, reviewedOn: '2026-10-10T00:00:00Z' }, true), rightSizeText({ current: plans[k + 1]!, plan: plans[k]!, saving: '20', unusedCredits: '1444.5', hint })];
  for (const t of texts) assert.ok(!/[<>"&']/.test(t), t);
 }
 // The view escapes every note line the same way as the rest of its text.
 const source = await readFile(new URL('../../src/extension/presentation.ts', import.meta.url), 'utf8');
 assert.ok(source.includes('noteLines.map(l=>`<p class="small overage">${safe(l)}</p>`)'));
 // A hint that cannot be formatted (never produced by the controller) is omitted instead of breaking or injecting anything into the view.
 const odd = { ...larger, next: '<img src=x onerror=synthetic>' as never, feeDiff: '"><script>' };
 const html = withHints(view(series(10, '100'), NOW), { larger: odd, rightsize: null }).html;
 assert.ok(!html.includes('<img') && !html.includes('<script') && !html.includes('For comparison'));
 assert.ok(heroText(html).includes('about 200 credits over the reported limit')); // the rest of the view is intact
});
