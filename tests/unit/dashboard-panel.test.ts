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
