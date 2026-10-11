import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startExtension } from '../../src/extension/controller.ts';

const syntheticLine = '2026-10-10 10:00:00.000 [info] synthetic-envelope ' + JSON.stringify({ commandName: 'GetUsageLimitsCommand', input: {}, output: { userInfo: { userId: 'synthetic-account' }, nextDateReset: '2026-11-01T00:00:00.000Z', usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS', currentUsageWithPrecision: 4.35, usageLimitWithPrecision: 50, nextDateReset: '2026-11-01T00:00:00.000Z', bonuses: [], overageCredits: [] }] }, metadata: { httpStatusCode: 200 } }) + '\n';

test('activation imports a synthetic account snapshot and click opens details', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-easykiro-extension-')));
 const root = join(base, 'Kiro'); const store = join(base, 'owned');
 const logDir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 await mkdir(logDir, { recursive: true });
 const log = join(logDir, 'q-client.log');
 await writeFile(log, syntheticLine);
 let text = ''; let detail = ''; let command: (() => void) | undefined; let timer: (() => void) | undefined;
 const ui = { setStatus(value: string) { text = value; }, showDetails(value: string) { detail = value; }, onClick(fn: () => void) { command = fn; }, onChange(_fn: () => void) {}, everyMinute(fn: () => void) { timer = fn; }, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: root, storage: store, timezone: 'Europe/Berlin', now: () => '2026-10-10T09:00:00.000Z' });
  assert.match(text, /Collecting data/);
  command?.();
  assert.match(detail, /4\.35/);
  assert.match(detail, /45\.65/);
  assert.match(detail, /2026-11-01/);
  assert.match(detail, /Forecast/);
  assert.match(detail, /Forecast not ready yet — more history needed/);
  assert.match(detail, /Observed history/);
  assert.ok(!detail.includes('synthetic-account'));
  assert.ok(timer);
  extension.dispose();
  assert.doesNotThrow(() => extension.dispose());
 } finally { await rm(base, { recursive: true, force: true }); }
});

test('unchanged snapshot becomes stale without a new observation', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-easykiro-stale-')));
 const root = join(base, 'Kiro'); const store = join(base, 'owned');
 const logDir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 await mkdir(logDir, { recursive: true });
 await writeFile(join(logDir, 'q-client.log'), syntheticLine);
 let text = ''; let now = '2026-10-10T09:00:00.000Z';
 const ui = { setStatus(value: string) { text = value; }, showDetails(_value: string) {}, onClick(_fn: () => void) {}, onChange(_fn: () => void) {}, everyMinute(_fn: () => void) {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: root, storage: store, timezone: 'Europe/Berlin', now: () => now });
  assert.match(text, /Collecting data/);
  now = '2026-10-12T09:00:00.000Z';
  await extension.refresh();
  assert.match(text, /stale/i);
  extension.dispose();
 } finally { await rm(base, { recursive: true, force: true }); }
});

test('log change refreshes the status and disposal stops later updates', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-easykiro-change-')));
 const root = join(base, 'Kiro'); const store = join(base, 'owned');
 const dir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 await mkdir(dir, { recursive: true });
 const log = join(dir, 'q-client.log'); await writeFile(log, syntheticLine);
 let text = ''; let html = ''; let changed: (() => void) | undefined;
 const ui = { setStatus(value: string, detail: string) { text = value; html = detail; }, showDetails(_value: string) {}, onClick(_fn: () => void) {}, onChange(fn: () => void) { changed = fn; }, everyMinute(_fn: () => void) {}, dispose() {} };
 try {
  const extension = await startExtension(ui, { source: root, storage: store, timezone: 'Europe/Berlin', now: () => '2026-10-10T09:03:00.000Z' });
  assert.match(text, /Collecting data/);
  await appendFile(log, syntheticLine.replace('10:00:00.000', '10:02:00.000').replace('4.35', '4.63'));
  changed?.();
  await extension.refresh();
  assert.match(text, /Collecting data/); assert.match(html, /45\.37/);
  extension.dispose();
  await appendFile(log, syntheticLine.replace('10:00:00.000', '10:03:00.000').replace('4.35', '5.00'));
  changed?.();
  await extension.refresh();
  assert.match(text, /Collecting data/); assert.match(html, /45\.37/);
 } finally { await rm(base, { recursive: true, force: true }); }
});

test('detail view renders a qualified forecast and observed daily coverage from synthetic account logs', async () => {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-easykiro-forecast-')));
 const root=join(base,'source'), storage=join(base,'owned');
 const dir=join(root,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 await mkdir(dir,{recursive:true});
 const lines=Array.from({length:8},(_,i)=>`2030-06-${String(i+1).padStart(2,'0')}T00:00:00Z [info] synthetic `+JSON.stringify({
  commandName:'GetUsageLimitsCommand', metadata:{httpStatusCode:200}, output:{userInfo:{userId:'synthetic-private-forecast-user'},
   nextDateReset:'2030-07-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',currentUsageWithPrecision:i*10,usageLimitWithPrecision:100,
    bonuses:[],overageCredits:[],prompt:'SYNTHETIC_CONTENT_MUST_DROP'}]}})+'\n').join('');
 await writeFile(join(dir,'q-client.log'),lines);
 let detail=''; let click: (()=>void)|undefined;
 const ui={setStatus(_s:string,_html:string){},showDetails(html:string){detail=html;},onClick(fn:()=>void){click=fn;},onChange(_fn:()=>void){},everyMinute(_fn:()=>void){},dispose(){}};
 try {
  const extension=await startExtension(ui,{source:root,storage,timezone:'UTC',now:()=> '2030-06-08T00:00:00Z'});
  click?.();
  assert.match(detail,/rolling 7 day/);assert.match(detail,/7 complete, 0 partial, 0 unknown UTC days/);
  assert.match(detail,/11 Jun 2030/);assert.match(detail,/-200/);assert.match(detail,/above budget/);
  for(const marker of [base,'synthetic-private','SYNTHETIC_CONTENT_MUST_DROP','partition']) assert.ok(!detail.includes(marker));
  extension.dispose();
 } finally {await rm(base,{recursive:true,force:true});}
});

test('detail view progresses from limited-history provisional to regular and stale unavailable', async () => {
 const base=await realpath(await mkdtemp(join(tmpdir(),'synthetic-progressive-ui-')));
 const root=join(base,'source'),storage=join(base,'owned');
 const dir=join(root,'logs','synthetic-run','synthetic-window','exthost','kiro.kiroAgent');
 await mkdir(dir,{recursive:true});
 const log=join(dir,'q-client.log');
 const lines=Array.from({length:8},(_,i)=>`2030-06-${String(i+1).padStart(2,'0')}T00:00:00Z [info] synthetic `+JSON.stringify({
  commandName:'GetUsageLimitsCommand',metadata:{httpStatusCode:200},output:{userInfo:{userId:'synthetic-progressive-user'},
   nextDateReset:'2030-07-01T00:00:00Z',usageBreakdownList:[{resourceType:'CREDIT',currentUsageWithPrecision:i*10,usageLimitWithPrecision:100,
    bonuses:[],overageCredits:[]}]}})+'\n');
 await writeFile(log,lines.slice(0,3).join(''));
 let html='',now='2030-06-03T00:00:00Z';
 const ui={setStatus(_s:string,detail:string){html=detail;},showDetails(_html:string){},onClick(_fn:()=>void){},onChange(_fn:()=>void){},everyMinute(_fn:()=>void){},dispose(){}};
 let extension: Awaited<ReturnType<typeof startExtension>> | undefined;
 try {
  extension=await startExtension(ui,{source:root,storage,timezone:'UTC',now:()=>now});
  assert.match(html,/Provisional estimate – limited history/);assert.match(html,/3 comparable snapshots over 2 UTC 24-hour days/);
  assert.match(html,/limited window may not represent future usage/i);assert.match(html,/2030-06-03/);
  assert.ok(!html.includes('Forecast status / confidence'));assert.ok(!html.includes('synthetic-progressive-user'));
  await appendFile(log,lines.slice(3).join(''));now='2030-06-08T00:00:00Z';await extension.refresh();
  assert.match(html,/Regular forecast/);assert.match(html,/8 comparable snapshots over 7 UTC 24-hour days/);
  now='2030-06-09T00:00:00.001Z';await extension.refresh();assert.match(html,/Forecast paused — stale data/);
 } finally {extension?.dispose();await rm(base,{recursive:true,force:true});}
});

test('data and storage roots cannot be set from workspace settings', async () => {
 const { readFile } = await import('node:fs/promises');
 const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
 const props = manifest.contributes.configuration.properties;
 assert.equal(props['easykirogauge.sourceRoot'].scope, 'machine');
 assert.equal(props['easykirogauge.storageRoot'].scope, 'machine');
});
