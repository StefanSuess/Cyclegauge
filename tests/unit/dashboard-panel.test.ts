import test from 'node:test';
import assert from 'node:assert/strict';
import { DashboardPanel } from '../../src/extension/dashboard-panel.ts';

const page = (rows: string) => `<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>p{color:red}</style></head><body><main><details><summary>History</summary><table>${rows}</table></details></main></body></html>`;
const one = page('<tr><td>10</td></tr>'), two = page('<tr><td>10</td></tr><tr><td>20</td></tr>');

test('new observed row is delivered in place after current-load ready and ACK', async () => {
 const sent: unknown[] = []; let htmlSets = 0, content = '';
 let now = 1000;
 const webview = { get html() { return content; }, set html(v: string) { content = v; htmlSets++; }, postMessage(m: unknown) { sent.push(m); return Promise.resolve(true); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => {}, () => now);
 panel.set(one); const load = Number(/data-cg-load="(\d+)"/.exec(content)![1]);const initialHtml=content;panel.set(one);assert.equal(htmlSets,1);assert.equal(content,initialHtml);
 panel.set(two); assert.equal(htmlSets, 2, 'static HTML stays current before ready');
 const current = Number(/data-cg-load="(\d+)"/.exec(content)![1]);
 assert.notEqual(load, current);
 await panel.receive({ type: 'ready', load: current });
 assert.equal(sent.length, 1);
 const first = sent[0] as { version: number }; await panel.receive({ type: 'ack', version: first.version });
 now += 2100;
 panel.set(one); assert.equal(htmlSets, 2, 'routine DOM update keeps the document');
 assert.equal(sent.length, 2);
 panel.dispose();
});

test('wrong-load and unsupported messages are rejected without sending models', async () => {
 const sent: unknown[] = []; let rejected = 0;
 const webview = { html: '', postMessage(m: unknown) { sent.push(m); return Promise.resolve(true); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => { rejected++; }, () => 1000);
 panel.set(one);
 await panel.receive({ type: 'ready', load: 0 });
 await panel.receive({ type: 'run' });
 assert.equal(rejected, 2); assert.equal(sent.length, 0);
 panel.dispose();
});

test('missing ACK restores latest static HTML at five seconds, and dispose stops the timer', t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 let htmlSets = 0, content = '';
 const webview = { get html() { return content; }, set html(v: string) { content = v; htmlSets++; }, postMessage() { return Promise.resolve(true); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => {}, () => 1000);
 panel.set(one);const load = Number(/data-cg-load="(\d+)"/.exec(content)![1]);panel.receive({ type: 'ready', load });
 t.mock.timers.tick(4999);assert.equal(htmlSets, 1);
 t.mock.timers.tick(1);assert.equal(htmlSets, 2);assert.match(content, /<td>10<\/td>/);
 panel.dispose();t.mock.timers.tick(5000);assert.equal(htmlSets, 2);
});

test('failed delivery reloads static HTML and a reveal starts a fresh document', async () => {
 let htmlSets = 0, content = '';
 const webview = { get html() { return content; }, set html(v: string) { content = v; htmlSets++; }, postMessage() { return Promise.resolve(false); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => {}, () => 1000);
 panel.set(one);const load = Number(/data-cg-load="(\d+)"/.exec(content)![1]);panel.receive({ type: 'ready', load });
 await Promise.resolve();await Promise.resolve();assert.equal(htmlSets, 2);
 const nonce = /script-src 'nonce-([^']+)'/.exec(content)![1];
 panel.reveal(two);assert.equal(htmlSets, 3);assert.notEqual(/script-src 'nonce-([^']+)'/.exec(content)![1], nonce);assert.match(content, /<td>20<\/td>/);
 panel.dispose();
});

test('thrown and rejected postMessage also restore static HTML', async () => {
 for (const postMessage of [() => { throw new Error('synthetic-send'); }, () => Promise.reject(new Error('synthetic-send'))]) {
  let sets = 0, content = '';
  const webview = { get html() { return content; }, set html(v: string) { content = v; sets++; }, postMessage };
  const panel = new DashboardPanel(webview, 'console.log(1)', () => {});
  panel.set(one);panel.receive({ type: 'ready', load: 1 });
  await Promise.resolve();await Promise.resolve();assert.equal(sets, 2);
  panel.dispose();
 }
});

test('flood, replayed ACK and unsupported action never reach the transport', () => {
 let rejected = 0;const sent: unknown[] = [];
 const webview = { html: '', postMessage(m: unknown) { sent.push(m);return Promise.resolve(true); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => { rejected++; }, () => 1000);
 panel.set(one);for(let i=0;i<11;i++)panel.receive({type:'run'});
 panel.receive({type:'ready',load:1});assert.equal(sent.length,0);assert.equal(rejected,12);
 panel.dispose();
});

test('ACK replay is rejected and cannot confirm a later model version', () => {
 let rejected = 0;const sent: { version: number }[] = [];
 let now = 1000;
 const webview = { html: '', postMessage(m: { version: number }) { sent.push(m);return Promise.resolve(true); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => { rejected++; }, () => now);
 panel.set(one);panel.receive({type:'ready',load:1});const first=sent[0]!.version;
 panel.receive({type:'ack',version:first});panel.receive({type:'ack',version:first});
 now += 2100;
 panel.set(two);assert.equal(sent.length,2);panel.receive({type:'ack',version:first});
 assert.equal(rejected,2);panel.receive({type:'ack',version:sent[1]!.version});panel.dispose();
});

test('changes within the ACK cooldown coalesce until the next ACK can be accepted', t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 let now = 1000; const sent: { version: number }[] = [];
 const webview = { html: '', postMessage(m: { version: number }) { sent.push(m); return Promise.resolve(true); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => {}, () => now);
 panel.set(one);panel.receive({ type: 'ready', load: 1 });panel.receive({ type: 'ack', version: sent[0]!.version });
 panel.set(two);panel.set(one);panel.set(two);
 assert.equal(sent.length, 1);
 now += 1999;t.mock.timers.tick(1999);assert.equal(sent.length, 1);
 now++;t.mock.timers.tick(1);assert.equal(sent.length, 2);
 panel.receive({ type: 'ack', version: sent[1]!.version });panel.dispose();
});

test('late delivery failure after disposal cannot write another document', async () => {
 let resolveDelivery!: (ok: boolean) => void;
 let sets = 0;
 const webview = { get html() { return ''; }, set html(_value: string) { sets++; }, postMessage() { return new Promise<boolean>(resolve => { resolveDelivery = resolve; }); } };
 const panel = new DashboardPanel(webview, 'console.log(1)', () => {});
 panel.set(one);panel.receive({ type: 'ready', load: 1 });assert.equal(sets, 1);
 panel.dispose();resolveDelivery(false);await Promise.resolve();await Promise.resolve();
 assert.equal(sets, 1);
});

test('Advisor submit is one in flight, cooldown guarded, and replies with fixed result', async () => {
 const sent: object[]=[];let rejected=0,now=1000,finish!: (v:{status:'ok'|'stale'|'invalid'})=>void;
 const webview={html:'',postMessage(m:object){sent.push(m);return Promise.resolve(true);}};
 const panel=new DashboardPanel(webview,'console.log(1)',()=>{rejected++;},()=>now,()=>new Promise(resolve=>{finish=resolve;}));
 panel.set(one);const load=Number(/data-cg-load="(\d+)"/.exec(webview.html)![1]);panel.receive({type:'ready',load});
 const submit={type:'advisorSubmit',ticket:1,plan:'pro',billing:'consumer_prepaid',addOns:'none',addOnCredits:''};
 panel.receive(submit);panel.receive(submit);assert.equal(rejected,1);
 finish({status:'ok'});await Promise.resolve();await Promise.resolve();
 assert.ok(sent.some(m=>(m as {type?:string;status?:string}).type==='advisorResult'&&(m as {status?:string}).status==='ok'));
 panel.receive(submit);assert.equal(rejected,2);
 now+=2001;panel.receive(submit);finish({status:'stale'});await Promise.resolve();await Promise.resolve();
 assert.ok(sent.some(m=>(m as {type?:string;status?:string}).type==='advisorResult'&&(m as {status?:string}).status==='stale'));
 panel.dispose();
});

test('a never-settling Advisor remains single flight and gives an explicit busy response', () => {
 const sent: object[]=[];let now=1000,calls=0;
 const panel=new DashboardPanel({html:'',postMessage(m:object){sent.push(m);return true;}},'console.log(1)',()=>{},()=>now,()=>{calls++;return new Promise(()=>{});});
 panel.set(one);panel.receive({type:'ready',load:1});
 const submit={type:'advisorSubmit',ticket:1,plan:'pro',billing:'consumer_prepaid',addOns:'none',addOnCredits:''};
 panel.receive(submit);now+=16000;panel.receive(submit);
 assert.ok(sent.some(m=>(m as {type?:string;reason?:string}).type==='advisorResult'&&(m as {reason?:string}).reason==='busy'));
 assert.equal(calls,1,'a hanging review never starts a parallel refresh');
 panel.dispose();
});

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function actionPanel(overrides: Partial<import('../../src/extension/dashboard-panel.ts').DashboardActions> = {}) {
 const sent: any[] = [], calls: string[] = []; let rejected = 0, now = 1000;
 const actions = {
  exportCsv: async () => { calls.push('exportCsv'); return 'saved' as const; }, copyRecapText: async () => { calls.push('copyRecapText'); return 'copied' as const; },
  dismissRecap: async () => { calls.push('dismissRecap'); return 'dismissed' as const; }, saveRecapImage: async (png: string) => { calls.push(`saveRecapImage:${png}`); return 'saved' as const; }, ...overrides,
 };
 const panel = new DashboardPanel({ html: '', postMessage(m: object) { sent.push(m); return true; } }, 'console.log(1)', () => { rejected++; }, () => now, undefined, actions);
 panel.set(one); panel.receive({ type: 'ready', load: 1 });
 const results = () => sent.filter(m => m.type === 'actionResult');
 return { panel, sent, calls, results, rejected: () => rejected, advance: (ms: number) => { now += ms; }, setNow: (t: number) => { now = t; } };
}

test('each action runs once, answers with a fixed code and passes only the image text on', async () => {
 const t = actionPanel();
 t.panel.receive({ type: 'exportCsv' }); await flush();
 t.advance(0); t.panel.receive({ type: 'copyRecapText' }); t.panel.receive({ type: 'dismissRecap' }); t.panel.receive({ type: 'saveRecapImage', png: 'AAAA' }); await flush();
 assert.deepEqual(t.calls, ['exportCsv', 'copyRecapText', 'dismissRecap', 'saveRecapImage:AAAA']);
 assert.deepEqual(t.results(), [{ type: 'actionResult', action: 'exportCsv', code: 'saved' }, { type: 'actionResult', action: 'copyRecapText', code: 'copied' }, { type: 'actionResult', action: 'dismissRecap', code: 'dismissed' }, { type: 'actionResult', action: 'saveRecapImage', code: 'saved' }]);
 assert.equal(t.rejected(), 0); t.panel.dispose();
});

test('one of each type in flight, including while a save dialog is open, then a 2 s cooldown per type', async () => {
 let finish!: (code: 'saved') => void; let started = 0;
 const t = actionPanel({ saveRecapImage: () => { started++; return new Promise(resolve => { finish = resolve; }); } });
 t.panel.receive({ type: 'saveRecapImage', png: 'AAAA' }); await flush();
 t.advance(5000); // the dialog stays open for a long time: still one in flight
 t.panel.receive({ type: 'saveRecapImage', png: 'BBBB' }); await flush();
 assert.equal(started, 1); assert.equal(t.rejected(), 1);
 assert.deepEqual(t.results(), [{ type: 'actionResult', action: 'saveRecapImage', code: 'busy' }]);
 t.panel.receive({ type: 'exportCsv' }); await flush(); // another type is independent
 assert.deepEqual(t.calls, ['exportCsv']);
 finish('saved'); await flush();
 t.panel.receive({ type: 'saveRecapImage', png: 'CCCC' }); await flush();
 assert.equal(started, 1, 'cooldown starts when the dialog closes'); assert.equal(t.rejected(), 2);
 t.advance(1999); t.panel.receive({ type: 'saveRecapImage', png: 'CCCC' }); await flush(); assert.equal(started, 1);
 t.advance(1); t.panel.receive({ type: 'saveRecapImage', png: 'DDDD' }); await flush(); assert.equal(started, 2);
 t.panel.dispose();
});

test('an action that throws or rejects ends with a fixed failure and frees its slot after the cooldown', async () => {
 for (const boom of [() => { throw new Error('synthetic-failure /private/synthetic-path'); }, () => Promise.reject(new Error('synthetic-failure /private/synthetic-path'))]) {
  const t = actionPanel({ exportCsv: boom as never });
  t.panel.receive({ type: 'exportCsv' }); await flush();
  assert.deepEqual(t.results(), [{ type: 'actionResult', action: 'exportCsv', code: 'failed' }]);
  assert.ok(!JSON.stringify(t.sent).includes('synthetic-path'));
  t.advance(2001); t.panel.receive({ type: 'exportCsv' }); await flush(); assert.equal(t.results().length, 2);
  t.panel.dispose();
 }
});

test('actions are refused before ready, without handlers, after disposal and above ten messages a second', async () => {
 const early = new DashboardPanel({ html: '', postMessage() { return true; } }, 'x', () => {}, () => 1000, undefined, { exportCsv: async () => { throw new Error('must not run'); }, copyRecapText: async () => 'copied', dismissRecap: async () => 'dismissed', saveRecapImage: async () => 'saved' });
 let rejected = 0; const calls: string[] = [];
 const make = (actions?: any) => new DashboardPanel({ html: '', postMessage() { return true; } }, 'x', () => { rejected++; }, () => 1000, undefined, actions);
 const notReady = make({ exportCsv: async () => { calls.push('x'); return 'saved'; } }); notReady.set(one); notReady.receive({ type: 'exportCsv' }); await flush();
 const none = make(); none.set(one); none.receive({ type: 'ready', load: 1 }); none.receive({ type: 'exportCsv' }); await flush();
 assert.equal(rejected, 2); assert.deepEqual(calls, []);
 const t = actionPanel(); t.panel.dispose(); t.panel.receive({ type: 'exportCsv' }); await flush(); assert.deepEqual(t.calls, []);
 const flood = actionPanel();
 for (let i = 0; i < 12; i++) flood.panel.receive({ type: 'copyRecapText' });
 await flush(); assert.deepEqual(flood.calls, ['copyRecapText']); assert.ok(flood.rejected() >= 10);
 for (const hostile of [{ type: 'saveRecapImage' }, { type: 'exportCsv', png: 'AAAA' }, { type: 'dismissRecap', extra: 1 }, { type: '__proto__' }]) { flood.advance(1500); flood.panel.receive(hostile); }
 await flush(); assert.deepEqual(flood.calls, ['copyRecapText'], 'invalid action messages never reach a handler');
 early.dispose(); notReady.dispose(); none.dispose(); flood.panel.dispose();
});
