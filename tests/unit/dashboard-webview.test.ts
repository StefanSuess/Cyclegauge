import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { buildDomModel, renderDashboardShell, type DomNode } from '../../src/extension/dashboard-shell.ts';
import { present, inlineAdvisorForm } from '../../src/extension/presentation.ts';
import { presentAdvisor } from '../../src/extension/advisor-presentation.ts';
import { planHint, type AdvisorContext } from '../../src/cost/advisor.ts';
import { reviewedCatalog } from '../../src/cost/catalog.ts';
import { view } from '../../src/view.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';
import { BRAND, CARD_HEIGHT, CARD_WIDTH } from '../../src/extension/recap-card.ts';
import { decodeCardPng } from '../../src/extension/recap-png.ts';
import { ACTION_TEXT } from '../../src/extension/recap-actions.ts';
import type { Recap } from '../../src/extension/recap.ts';

class FakeNode {
 nodeType: number;
 localName = '';
 childNodes: FakeNode[] = [];
 parentNode?: FakeNode;
 focusCount = 0;
 textWrites = 0;
 value = '';
 private attrs = new Map<string, string>();
 constructor(tag: string, value = '') { this.nodeType = tag === '#text' ? 3 : 1; this.localName = tag; this.value = value; }
 get textContent(): string { return this.nodeType === 3 ? this.value : this.childNodes.map(n => n.textContent).join(''); }
 set textContent(value: string) { this.textWrites++; if (this.nodeType === 3) this.value = value; else this.childNodes = [new FakeNode('#text', value)]; }
 get elements() { return { namedItem: (name: string) => find(this, n => n.getAttribute('name') === name) ?? null }; }
 querySelector(selector: string) { return selector.startsWith('#') ? find(this, n => n.getAttribute('id') === selector.slice(1)) ?? null : null; }
 get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
 get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null; }
 setAttribute(name: string, value: string) { this.attrs.set(name, value); }
 getAttribute(name: string) { return this.attrs.get(name) ?? null; }
 removeAttribute(name: string) { this.attrs.delete(name); }
 contains(node: FakeNode): boolean { return this === node || this.childNodes.some(child => child.contains(node)); }
 focus() { this.focusCount++; }
 appendChild(child: FakeNode) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
 insertBefore(child: FakeNode, before: FakeNode) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(before), 0, child); return child; }
 removeChild(child: FakeNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = undefined; return child; }
 replaceChild(next: FakeNode, old: FakeNode) { if (next.parentNode) next.parentNode.removeChild(next); next.parentNode = this; this.childNodes[this.childNodes.indexOf(old)] = next; old.parentNode = undefined; return old; }
}
const e = (tag: string, ...children: FakeNode[]) => { const n = new FakeNode(tag); children.forEach(c => n.appendChild(c)); return n; };
const t = (text: string) => new FakeNode('#text', text);
const fromModel = (node: DomNode): FakeNode => {
 if (node.kind === 'text') return t(node.text);
 const result = e(node.tag, ...node.children.map(fromModel));
 for (const [name, value] of Object.entries(node.attrs)) result.setAttribute(name, value);
 return result;
};
const find = (node: FakeNode, predicate: (n: FakeNode) => boolean): FakeNode | undefined => predicate(node) ? node : node.childNodes.map(n => find(n, predicate)).find(Boolean);
const all = (node: FakeNode, predicate: (n: FakeNode) => boolean): FakeNode[] => [node, ...node.childNodes.flatMap(child => all(child, predicate))].filter(predicate);
const anchors = (node: FakeNode): FakeNode[] => [node, ...node.childNodes.flatMap(anchors)].filter(n => n.localName === 'a');
const html = (rows: string) => `<!doctype html><html><body><main><details><summary>History</summary><table>${rows}</table><a href="command:cyclegauge.share">Share</a></details></main></body></html>`;
const script = async () => (await build({ entryPoints: ['src/extension/dashboard-webview.ts'], bundle: true, platform: 'browser', format: 'iife', write: false, logLevel: 'silent' })).outputFiles[0]!.text;

async function start(initial: string) {
 const main = fromModel(buildDomModel(initial));
 const reserve = e('div');
 for (const href of ['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', 'https://github.com/StefanSuess/Cyclegauge', 'https://ko-fi.com/stefansuess', 'command:cyclegauge.costAdvisor', 'command:cyclegauge.auditWorkspace', 'command:cyclegauge.audit.show', 'command:cyclegauge.share', 'command:cyclegauge.reportProblem']) {
  const link = e('a');link.setAttribute('href', href);reserve.appendChild(link);
 }
 const root = e('html');root.setAttribute('data-cg-load', '7');
 const sent: unknown[] = [], created: string[] = []; const timers = new Map<number, () => void>(); let nextTimer = 0; const handlers = new Map<string, ((event: any) => void)[]>(); let scroll: [number, number] | undefined;
 const document = { documentElement: root, activeElement: undefined as FakeNode | undefined,
  querySelector: (selector: string) => selector === 'main' ? main : selector === '#cg-link-reserve' ? reserve : selector.startsWith('#') ? find(main, n => n.getAttribute('id') === selector.slice(1)) ?? null : null,
  querySelectorAll: (selector: string) => selector === '[data-chart-point]' ? all(main, n => n.getAttribute('data-chart-point') !== null) : [],
  createTextNode: t, createElement: (tag: string) => { assert.notEqual(tag, 'a', 'browser must never create an anchor');created.push(tag);return e(tag); }, createElementNS: (ns: string, tag: string) => { assert.equal(ns, 'http://www.w3.org/2000/svg');created.push(`svg:${tag}`);return e(tag); } };
 const window = { scrollX: 4, scrollY: 80, scrollTo(x: number, y: number) { scroll = [x, y]; }, addEventListener(type: string, fn: (event: any) => void) { handlers.set(type, [...(handlers.get(type) ?? []), fn]); } };
 runInNewContext(await script(), { document, window, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, acquireVsCodeApi: () => ({ postMessage: (m: unknown) => sent.push(m) }), setTimeout: (fn: () => void) => {const id=++nextTimer;timers.set(id,fn);return id;}, clearTimeout: (id: number) => timers.delete(id), Object, Number, Set, Array, Blob, Response, CompressionStream, btoa });
 return { main, reserve, document, sent, created, scroll: () => scroll, tick() { for(const fn of timers.values())fn();timers.clear(); }, emit(type: string, event: object) { for (const fn of handlers.get(type)!) fn({ ...event }); }, send(model: unknown, version = 1, schema = 1) { for (const fn of handlers.get('message')!) fn({ data: { type: 'model', schema, version, model } }); } };
}

test('chart keyboard and hover keep one tab stop and a dismissible hoverable tooltip', async () => {
 const points = [snapshot('2030-06-08T00:00:00Z', '1'), snapshot('2030-06-08T01:00:00Z', '2')];
 const app = await start(present(view(points, '2030-06-08T01:00:00Z')).html);
 const markers = () => all(app.main, n => n.getAttribute('data-chart-point') !== null);
 const tooltip = find(app.main, n => n.getAttribute('id') === 'chart-tooltip')!;
 assert.deepEqual(markers().map(n => n.getAttribute('tabindex')), ['0', '-1']);
 app.document.activeElement = markers()[0]; app.emit('focusin', { target: markers()[0] });
 assert.equal(tooltip.getAttribute('hidden'), null); assert.match(tooltip.textContent, /1 credits used.*not comparable/);
 app.emit('keydown', { target: markers()[0], key: 'ArrowRight', preventDefault() {} });
 assert.deepEqual(markers().map(n => n.getAttribute('tabindex')), ['-1', '0']);
 assert.equal(markers()[1].focusCount, 1); assert.match(tooltip.textContent, /2 credits used.*1 credits/);
 app.emit('keydown', { target: markers()[1], key: 'Escape', preventDefault() {} });
 assert.equal(tooltip.getAttribute('hidden'), '');
 app.document.activeElement = undefined;
 app.emit('pointerover', { target: markers()[1] });
 const svg = markers()[1].parentNode!;
 app.emit('pointerout', { target: markers()[1], relatedTarget: svg });
 assert.equal(tooltip.getAttribute('hidden'), null, 'tooltip survives the blank SVG area');
 app.emit('pointerout', { target: svg, relatedTarget: tooltip });
 assert.equal(tooltip.getAttribute('hidden'), null);
 app.emit('pointerout', { target: tooltip, relatedTarget: null });
 assert.equal(tooltip.getAttribute('hidden'), '');
});

test('Escape dismisses a hovered chart tooltip even with focus outside the chart', async () => {
 const points = [snapshot('2030-06-08T00:00:00Z', '1'), snapshot('2030-06-08T01:00:00Z', '2')];
 const app = await start(present(view(points, '2030-06-08T01:00:00Z')).html);
 const marker = all(app.main, n => n.getAttribute('data-chart-point') !== null)[0]!;
 const tooltip = find(app.main, n => n.getAttribute('id') === 'chart-tooltip')!;
 app.document.activeElement = app.main;
 app.emit('pointerover', { target: marker });
 assert.equal(tooltip.getAttribute('hidden'), null);
 let prevented = false;
 app.emit('keydown', { target: app.main, key: 'Escape', preventDefault() { prevented = true; } });
 assert.equal(tooltip.getAttribute('hidden'), '');
 assert.equal(prevented, true);
});

test('live model preserves selected chart point and leaves an unchanged headline figure untouched', async () => {
 const points = [snapshot('2030-06-08T00:00:00Z', '1'), snapshot('2030-06-08T01:00:00Z', '2')];
 const before = present(view(points, '2030-06-08T01:00:00Z')).html;
 const after = present(view(points, '2030-06-08T01:01:00Z')).html;
 const app = await start(before);
 const markers = () => all(app.main, n => n.getAttribute('data-chart-point') !== null);
 const figure = find(app.main, n => n.getAttribute('id') === 'usage-live')!;
 app.document.activeElement = markers()[1]; app.emit('focusin', { target: markers()[1] });
 app.send(buildDomModel(after));
 assert.deepEqual(markers().map(n => n.getAttribute('tabindex')), ['-1', '0']);
 assert.equal(figure.textWrites, 0);
 assert.equal(markers()[1].focusCount, 1);
});

test('hostile tags never reach element creation or receive an ACK; allowed SVG stays namespaced', async () => {
 const initial = '<!doctype html><html><body><main><svg><circle cx="1" cy="2"/></svg></main></body></html>';
 const app = await start(initial);
 for (const tag of ['script', 'iframe', 'img', 'foreignObject']) {
  app.send({ kind: 'element', tag: 'main', attrs: {}, children: [{ kind: 'element', tag, attrs: {}, children: [] }] });
 }
 assert.equal(app.sent.length, 1, 'unsafe models receive no ACK');
 assert.deepEqual(app.created, [], 'unsafe models create no nodes');
 app.send(buildDomModel(initial.replace('</svg>', '<rect width="3" height="4"/></svg>')));
 assert.deepEqual(app.created, ['svg:rect']);
 assert.deepEqual(JSON.parse(JSON.stringify(app.sent.at(-1))), { type: 'ack', version: 1 });
});

test('browser bundle reconciles added rows without replacing details, focus or scroll', async () => {
 const initial = html('<tr><td>10</td></tr>');
 const app = await start(initial);
 const details = app.main.childNodes[0]!, summary = details.childNodes[0]!;
 details.setAttribute('open', '');app.document.activeElement = summary;
 assert.deepEqual(JSON.parse(JSON.stringify(app.sent[0])), { type: 'ready', load: 7 });
 const model = buildDomModel(html('<tr><td>10</td></tr><tr><td>20</td></tr>'));
 app.send(model);
 assert.equal(app.main.childNodes[0], details);
 assert.equal(details.childNodes[0], summary);
 assert.equal(details.getAttribute('open'), '');
 assert.equal(app.document.activeElement, summary);
 assert.deepEqual(app.scroll(), [4, 80]);
 assert.equal(details.textContent, 'History1020Share');
 assert.deepEqual(JSON.parse(JSON.stringify(app.sent[1])), { type: 'ack', version: 1 });
 app.send(model, 2, 2);
 assert.equal(app.sent.length, 2, 'unsupported schema is left static and unacknowledged');
});

test('real audit never-to-checked render moves the reserved Show link and preserves open details', async () => {
 const snapshots = [snapshot('2030-06-08T00:00:00Z', '70', { limit: '1000' })];
 const observed = view(snapshots, '2030-06-08T00:00:00Z');
 const before = present(observed, [], '', '', { state: 'never' }, '2030-06-08T00:00:00Z').html;
 const after = present(observed, [], '', '', { state: 'checked', items: 2, checkedAt: '2030-06-08T00:00:00Z' }, '2030-06-08T00:00:00Z').html;
 const app = await start(before);
 const show = anchors(app.reserve).find(a => a.getAttribute('href') === 'command:cyclegauge.audit.show')!;
 const check = anchors(app.main).find(a => a.getAttribute('href') === 'command:cyclegauge.auditWorkspace')!;
 const advanced = find(app.main, n => n.localName === 'details' && n.parentNode?.getAttribute('id') === 'advanced-details')!;
 advanced.setAttribute('open', '');app.document.activeElement = check;
 app.send(buildDomModel(after));
 assert.deepEqual(JSON.parse(JSON.stringify(app.sent.at(-1))), { type: 'ack', version: 1 });
 assert.equal(anchors(app.main).find(a => a.getAttribute('href') === 'command:cyclegauge.audit.show'), show);
 assert.equal(advanced.getAttribute('open'), '');assert.equal(app.document.activeElement, check);assert.equal(check.focusCount, 1);
 assert.deepEqual(app.scroll(), [4, 80]);
 assert.match(app.main.textContent, /2 items Kiro may read/);
});

test('real Advisor unconfirmed-to-confirmed render keeps the command anchor through variable content', async () => {
 const observed = view([snapshot('2030-06-08T00:00:00Z', '70', { limit: '1000' })], '2030-06-08T00:00:00Z');
 const hint = planHint('1000', reviewedCatalog);
 const context = (confirmed: boolean): AdvisorContext => ({ planSource: confirmed ? 'confirmed' : 'hint', plan: 'pro', billingConfirmed: confirmed, addOns: confirmed ? 'none' : 'assumed_none', assumptions: confirmed ? [] : ['plan_is_hint', 'billing_assumed_consumer', 'add_ons_assumed_none'] });
 const advisor = (confirmed: boolean) => presentAdvisor({ hint, context: context(confirmed), horizons: [], advice: [], singleAccount: true, limit: '1000' });
 const before = present(observed, [], '', advisor(false), { state: 'never' }, '2030-06-08T00:00:00Z').html;
 const after = present(observed, [], '', advisor(true), { state: 'never' }, '2030-06-08T00:00:00Z').html;
 assert.notEqual(before, after);
 const app = await start(before);
 const advisorLink = anchors(app.main).find(a => a.getAttribute('href') === 'command:cyclegauge.costAdvisor')!;
 const advanced = find(app.main, n => n.localName === 'details' && n.parentNode?.getAttribute('id') === 'advanced-details')!;
 advanced.setAttribute('open', '');app.document.activeElement = advanced.childNodes[0]!;
 app.send(buildDomModel(after));
 assert.deepEqual(JSON.parse(JSON.stringify(app.sent.at(-1))), { type: 'ack', version: 1 });
 assert.equal(anchors(app.main).find(a => a.getAttribute('href') === 'command:cyclegauge.costAdvisor'), advisorLink);
 assert.equal(advanced.getAttribute('open'), '');assert.equal(app.document.activeElement, advanced.childNodes[0]);
 assert.deepEqual(app.scroll(), [4, 80]);
 assert.match(app.main.textContent, /confirmed/i);
});

test('the page is marked live only after the first model is applied, which swaps the Advisor link fallback for the form', async () => {
 const observed = view([snapshot('2030-06-08T00:00:00Z', '70', { limit: '1000' })], '2030-06-08T00:00:00Z');
 const page = present(observed, [], '', '<section id="cost-advisor"></section>', undefined, '2030-06-08T00:00:00Z', false, undefined, inlineAdvisorForm({ plan: null, billing: null, addOns: null, addOnCredits: null }, 1)).html;
 const app = await start(page);
 assert.equal(app.document.documentElement.getAttribute('data-cg-live'), null);
 app.send(buildDomModel(page));
 assert.equal(app.document.documentElement.getAttribute('data-cg-live'), '');
});

test('the Advisor disclosure keeps its open state and the saved status stays visible across a real unconfirmed-to-confirmed render', async () => {
 const observed = view([snapshot('2030-06-08T00:00:00Z', '70', { limit: '1000' })], '2030-06-08T00:00:00Z');
 const hint = planHint('1000', reviewedCatalog);
 const context = (confirmed: boolean): AdvisorContext => ({ planSource: confirmed ? 'confirmed' : 'hint', plan: 'pro', billingConfirmed: confirmed, addOns: confirmed ? 'none' : 'assumed_none', assumptions: confirmed ? [] : ['plan_is_hint', 'billing_assumed_consumer', 'add_ons_assumed_none'] });
 const page = (confirmed: boolean) => present(observed, [], '', presentAdvisor({ hint, context: context(confirmed), horizons: [], advice: [], singleAccount: true, limit: '1000' }), { state: 'never' }, '2030-06-08T00:00:00Z', false, undefined, inlineAdvisorForm({ plan: confirmed ? 'pro' : null, billing: null, addOns: null, addOnCredits: '' }, confirmed ? 2 : 1)).html;
 const disclosure = (app: Awaited<ReturnType<typeof start>>) => find(app.main, n => n.getAttribute('id') === 'advisor-change')!;
 const status = (app: Awaited<ReturnType<typeof start>>) => find(app.main, n => n.getAttribute('id') === 'advisor-status')!;
 // Open (the static page is open while unconfirmed): it stays open after the form is saved and the page re-renders as confirmed.
 const app = await start(page(false));
 disclosure(app).setAttribute('open', '');
 app.send(buildDomModel(page(true)));
 assert.equal(disclosure(app).getAttribute('open'), '');
 assert.equal(find(disclosure(app), n => n.getAttribute('id') === 'advisor-status'), undefined, 'the status line is outside the disclosure');
 app.emit('message', { data: { type: 'advisorResult', status: 'ok', epoch: 2 } });
 assert.match(status(app).textContent, /Cost Advisor review saved/);
 assert.equal(disclosure(app).getAttribute('open'), '');
 // Closed by the user: a later render does not reopen it.
 const closed = await start(page(false));
 closed.send(buildDomModel(page(true)));
 assert.equal(disclosure(closed).getAttribute('open'), null);
 // A submit result keeps a closed disclosure's message visible by opening it.
 closed.emit('message', { data: { type: 'advisorResult', status: 'stale' } });
 assert.equal(disclosure(closed).getAttribute('open'), '');
});

test('focus on the fallback command link moves to the disclosure summary when the page goes live', async () => {
 const page = present(view([], '2030-01-01T00:00:00Z'), [], '', '<section id="cost-advisor"></section>', undefined, '2030-01-01T00:00:00Z', false, undefined, inlineAdvisorForm({ plan: null, billing: null, addOns: null, addOnCredits: '' }, 1)).html;
 const app = await start(page);
 const link = anchors(app.main).find(a => a.getAttribute('href') === 'command:cyclegauge.costAdvisor')!;
 app.document.activeElement = link;
 app.send(buildDomModel(page));
 const summary = find(app.main, n => n.localName === 'summary' && n.parentNode?.getAttribute('id') === 'advisor-change')!;
 assert.equal(summary.focusCount, 1);assert.equal(link.focusCount, 0);
});

test('shell includes inert copies of every reviewed fixed link', () => {
 const staticHtml = present(view([], '2030-01-01T00:00:00Z')).html;
 const shell = renderDashboardShell(staticHtml, 'syntheticNonce123', 7, 'console.log(1)');
 assert.match(shell, /<div id="cg-link-reserve" hidden aria-hidden="true">/);
 assert.match(shell, /<a href="command:cyclegauge\.audit\.show"><\/a>/);
});

test('Advisor keeps an edit made during host refresh when success precedes the committed model', async () => {
 const observed=view([],'2030-01-01T00:00:00Z');
 const answers={plan:'pro' as const,billing:'consumer_prepaid' as const,addOns:'some' as const,addOnCredits:'12'};
 const page=(epoch:number,credits:string)=>present(observed,[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,inlineAdvisorForm({...answers,addOnCredits:credits},epoch)).html;
 const app=await start(page(1,'12'));
 const form=find(app.main,n=>n.getAttribute('id')==='advisor-form')!;
 const credits=find(form,n=>n.getAttribute('name')==='addOnCredits')!;
 credits.value='15';app.emit('input',{target:credits,isTrusted:true});
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});
 assert.equal((app.sent.at(-1) as {type:string;ticket:number;addOnCredits:string}).addOnCredits,'15');
 credits.value='20';app.emit('input',{target:credits,isTrusted:true});
 app.emit('message',{data:{type:'advisorResult',status:'ok',epoch:2}});
 app.send(buildDomModel(page(2,'15')));
 assert.equal(credits.value,'20','edit during refresh survives success and the newer model');
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});
 assert.equal((app.sent.at(-1) as {ticket:number;addOnCredits:string}).ticket,2);
 assert.equal((app.sent.at(-1) as {ticket:number;addOnCredits:string}).addOnCredits,'20');
});

test('Advisor shows review warning when coalesced model skips the committed epoch', async () => {
 const observed=view([],'2030-01-01T00:00:00Z');
 const answers={plan:'pro' as const,billing:'consumer_prepaid' as const,addOns:'some' as const,addOnCredits:'12'};
 const page=(epoch:number)=>present(observed,[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,inlineAdvisorForm(answers,epoch)).html;
 const app=await start(page(1));const form=find(app.main,n=>n.getAttribute('id')==='advisor-form')!;
 const credits=find(form,n=>n.getAttribute('name')==='addOnCredits')!;credits.value='15';app.emit('input',{target:credits,isTrusted:true});
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});app.emit('message',{data:{type:'advisorResult',status:'ok',epoch:2}});
 app.send(buildDomModel(page(3)));
 assert.equal(credits.value,'15');
 assert.match(find(app.main,n=>n.getAttribute('id')==='advisor-status')!.textContent,/review and submit again/i);
 assert.equal(find(form,n=>n.getAttribute('id')==='advisor-review-again')!.getAttribute('hidden'),null);
});

test('Advisor timeout and host busy reply explain the wait and allow a later retry', async () => {
 const observed=view([],'2030-01-01T00:00:00Z');
 const answers={plan:'pro' as const,billing:'consumer_prepaid' as const,addOns:'none' as const,addOnCredits:null};
 const page=present(observed,[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,inlineAdvisorForm(answers,1)).html;
 const app=await start(page);const form=find(app.main,n=>n.getAttribute('id')==='advisor-form')!;
 const status=find(app.main,n=>n.getAttribute('id')==='advisor-status')!;
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});app.tick();
 assert.match(status.textContent,/not finished/i);
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});
 assert.equal((app.sent.at(-1) as {type:string}).type,'advisorSubmit');
 app.emit('message',{data:{type:'advisorResult',status:'invalid',reason:'busy'}});
 assert.match(status.textContent,/still running.*try again later/i);
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});
 assert.equal((app.sent.at(-1) as {type:string}).type,'advisorSubmit');
});

test('timed-out submit followed by a busy retry keeps later edits when the first review succeeds', async () => {
 const observed=view([],'2030-01-01T00:00:00Z');
 const answers={plan:'pro' as const,billing:'consumer_prepaid' as const,addOns:'some' as const,addOnCredits:'12'};
 const page=(epoch:number,credits:string)=>present(observed,[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,inlineAdvisorForm({...answers,addOnCredits:credits},epoch)).html;
 const app=await start(page(1,'12'));const form=find(app.main,n=>n.getAttribute('id')==='advisor-form')!;
 const credits=find(form,n=>n.getAttribute('name')==='addOnCredits')!;
 const error=find(form,n=>n.getAttribute('id')==='advisor-credits-error')!;
 credits.value='15';app.emit('input',{target:credits,isTrusted:true});
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});app.tick();
 credits.value='20';app.emit('input',{target:credits,isTrusted:true});
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});
 app.emit('message',{data:{type:'advisorResult',status:'invalid',reason:'busy'}});
 assert.equal(credits.getAttribute('aria-invalid'),null,'busy is not a field validation error');
 assert.equal(error.textContent,'');
 app.emit('message',{data:{type:'advisorResult',status:'ok',epoch:2}});
 app.send(buildDomModel(page(2,'15')));
 assert.equal(credits.value,'20','late success for A cannot erase unsent B edit');
});

test('an invalid answer gets its own error line tied to the field, and other fields stay unmarked', async () => {
 const page=present(view([],'2030-01-01T00:00:00Z'),[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,inlineAdvisorForm({plan:'pro',billing:'consumer_prepaid',addOns:'some',addOnCredits:'12'},1)).html;
 const app=await start(page);const form=find(app.main,n=>n.getAttribute('id')==='advisor-form')!;
 const credits=find(form,n=>n.getAttribute('name')==='addOnCredits')!,plan=find(form,n=>n.getAttribute('name')==='plan')!;
 const error=(id:string)=>find(form,n=>n.getAttribute('id')===id)!;
 credits.value='-1';app.emit('input',{target:credits,isTrusted:true});
 app.emit('submit',{target:form,isTrusted:true,preventDefault(){}});
 app.emit('message',{data:{type:'advisorResult',status:'invalid',fields:['addOnCredits']}});
 assert.equal(credits.getAttribute('aria-invalid'),'true');assert.equal(credits.getAttribute('aria-describedby'),'advisor-credits-error');
 assert.match(error('advisor-credits-error').textContent,/Enter a number of credits, for example 250\./);
 assert.equal(plan.getAttribute('aria-invalid'),null);assert.equal(plan.getAttribute('aria-describedby'),null);assert.equal(error('advisor-plan-error').textContent,'');
 app.emit('message',{data:{type:'advisorResult',status:'ok',epoch:2}});
 assert.equal(credits.getAttribute('aria-invalid'),null);assert.equal(credits.getAttribute('aria-describedby'),null);assert.equal(error('advisor-credits-error').textContent,'');
});

// Recap card, image and CSV: the script reveals the buttons, draws the card and sends only fixed messages from trusted clicks.
const RECAP: Recap = { cycle: '2030-08-01T00:00:00.000Z', period: 'Cycle that ended 1 Jul 2030 (UTC). Figures are observed.', lines: ['Credits used: 900 of 1000 reported credits.', 'Lasted until the reset: yes.', 'Busiest observed day (partial observation): not observed.'] };
const recapPage = (recap?: Recap) => present(view([], '2030-01-01T00:00:00Z'), [], '', '', undefined, '2030-01-01T00:00:00Z', false, undefined, '', undefined, recap).html;
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
function canvasContext(node: FakeNode) {
 const calls: { fills: string[]; texts: string[]; rects: number[][]; styles: string[] } = { fills: [], texts: [], rects: [], styles: [] };
 let style = '';
 const ctx = { set fillStyle(v: string) { style = v; calls.styles.push(v); }, get fillStyle() { return style; }, set font(_v: string) {}, set textBaseline(_v: string) {},
  fillRect(...a: number[]) { calls.rects.push(a); calls.fills.push(style); }, fillText(t: string) { calls.texts.push(t); calls.fills.push(style); }, measureText: (t: string) => ({ width: t.length * 10 }),
  getImageData: (_x: number, _y: number, w: number, h: number) => { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < data.length; i += 4) { data[i] = 11; data[i + 1] = 37; data[i + 2] = 69; data[i + 3] = 255; } return { data }; } };
 (node as any).getContext = () => ctx;
 return calls;
}

test('script reveals the card tools, draws the card text in brand colours and keeps one text alternative', async () => {
 const app = await start(recapPage(RECAP));
 const ids = ['recap-save', 'recap-copy', 'recap-dismiss', 'export-csv', 'recap-preview'];
 const node = (id: string) => find(app.main, n => n.getAttribute('id') === id)!;
 assert.ok(ids.slice(0, 4).every(id => node(id).getAttribute('hidden') === null), 'the buttons are revealed by the running script');
 assert.equal(node('recap-preview').getAttribute('hidden'), '', 'the preview waits for a canvas that can draw');
 const canvas = node('recap-canvas'); const calls = canvasContext(canvas);
 app.send(buildDomModel(recapPage({ ...RECAP, lines: [...RECAP.lines, 'Exclusions you saved in that cycle: none counted.'] })));
 assert.ok(ids.every(id => node(id).getAttribute('hidden') === null), 'a model update that re-hides them is undone in the same step');
 assert.equal(node('recap-canvas'), canvas, 'the canvas node survives the update');
 const drawn = calls.texts.join(' ');
 for (const text of ['Your Kiro cycle', 'Cycle that ended', 'Credits used: 900 of 1000', 'Lasted until the reset: yes.', 'none counted']) assert.ok(drawn.includes(text), text);
 const allowed = new Set<string>(Object.values(BRAND));
 assert.ok(calls.styles.length > 0 && calls.styles.every(c => allowed.has(c)), 'only brand colours are used');
 assert.deepEqual(calls.rects[0], [0, 0, CARD_WIDTH, CARD_HEIGHT]);
 assert.equal(canvas.getAttribute('aria-labelledby'), 'recap-title'); assert.equal(canvas.getAttribute('aria-describedby'), 'recap-lines');
 assert.match(app.main.textContent, /Credits used: 900 of 1000 reported credits\./, 'the text alternative is in the page');
 assert.deepEqual(JSON.parse(JSON.stringify(app.sent.at(-1))), { type: 'ack', version: 1 });
});

test('without a card the export button is still revealed and a new canvas without a context never breaks the update', async () => {
 const app = await start(recapPage());
 assert.equal(find(app.main, n => n.getAttribute('id') === 'export-csv')!.getAttribute('hidden'), null);
 assert.equal(find(app.main, n => n.getAttribute('id') === 'recap-card'), undefined);
 app.send(buildDomModel(recapPage(RECAP)));
 assert.deepEqual(JSON.parse(JSON.stringify(app.sent.at(-1))), { type: 'ack', version: 1 });
 assert.equal(find(app.main, n => n.getAttribute('id') === 'recap-preview')!.getAttribute('hidden'), '', 'no context: the preview stays hidden and the text remains the card');
});

test('only trusted clicks send the fixed messages, once at a time, and the answer is a fixed text', async () => {
 const app = await start(recapPage(RECAP));
 const node = (id: string) => find(app.main, n => n.getAttribute('id') === id)!;
 const messages = () => app.sent.slice(1).map(m => JSON.parse(JSON.stringify(m)));
 app.emit('click', { target: node('recap-copy'), isTrusted: false });
 app.emit('click', { target: node('recap-copy') });
 assert.deepEqual(messages(), [], 'synthetic clicks do nothing');
 app.emit('click', { target: node('recap-copy'), isTrusted: true });
 app.emit('click', { target: node('recap-copy'), isTrusted: true });
 await settle();
 assert.deepEqual(messages(), [{ type: 'copyRecapText' }], 'a second click while one is in flight is ignored');
 assert.equal(node('recap-status').textContent, 'Copying…');
 app.emit('message', { data: { type: 'actionResult', action: 'exportCsv', code: 'saved' } });
 assert.equal(node('recap-status').textContent, 'Copying…', 'a result for another action is ignored');
 for (const bad of [{ action: 'copyRecapText', code: 'synthetic-code' }, { action: 'synthetic', code: 'copied' }, { action: '__proto__', code: '__proto__' }, { action: ['copyRecapText'], code: 'copied' }, { code: 'copied' }])
  app.emit('message', { data: { type: 'actionResult', ...bad } });
 assert.equal(node('recap-status').textContent, 'Copying…', 'unknown actions and codes change nothing');
 app.emit('message', { data: { type: 'actionResult', action: 'copyRecapText', code: 'copied' } });
 assert.equal(node('recap-status').textContent, ACTION_TEXT.copied);
 app.emit('message', { data: { type: 'actionResult', action: 'copyRecapText', code: 'failed' } });
 assert.equal(node('recap-status').textContent, ACTION_TEXT.copied, 'a replayed answer is ignored');
 app.emit('click', { target: node('export-csv'), isTrusted: true }); await settle();
 assert.deepEqual(messages().at(-1), { type: 'exportCsv' });
 app.emit('message', { data: { type: 'actionResult', action: 'exportCsv', code: 'multiple_accounts' } });
 assert.equal(node('export-status').textContent, ACTION_TEXT.multiple_accounts);
 app.send(buildDomModel(recapPage(RECAP)), 2);
 assert.equal(node('export-status').textContent, ACTION_TEXT.multiple_accounts, 'status text survives a live update');
 app.emit('click', { target: node('recap-dismiss'), isTrusted: true }); await settle();
 assert.deepEqual(messages().at(-1), { type: 'dismissRecap' });
 app.emit('message', { data: { type: 'actionResult', action: 'dismissRecap', code: 'dismissed' } });
 assert.equal(node('export-status').textContent, ACTION_TEXT.dismissed); assert.equal(node('export-csv').focusCount, 0, 'the export button sits in the collapsed Advanced details, so it is not the target');
 const advancedSummary = find(find(app.main, n => n.getAttribute('id') === 'advanced-details')!, n => n.localName === 'summary')!;
 assert.equal(advancedSummary.focusCount, 1, 'focus moves to a visible control that remains');
});

test('Save image sends a PNG of the drawn card that the extension validator accepts, and a lost answer re-enables the button', async () => {
 const app = await start(recapPage(RECAP));
 const node = (id: string) => find(app.main, n => n.getAttribute('id') === id)!;
 canvasContext(node('recap-canvas'));
 app.emit('click', { target: node('recap-save'), isTrusted: true });
 for (let i = 0; i < 300 && app.sent.length < 2; i++) await new Promise(r => setTimeout(r, 10));
 const message = JSON.parse(JSON.stringify(app.sent.at(-1))) as { type: string; png: string };
 assert.deepEqual(Object.keys(message).sort(), ['png', 'type']); assert.equal(message.type, 'saveRecapImage');
 assert.ok(message.png.length > 100 && message.png.length < 2 * 1024 * 1024);
 assert.ok(decodeCardPng(message.png), 'exactly IHDR, IDAT, IEND of the fixed card size');
 assert.equal(node('recap-status').textContent, 'Choose where to save the image…');
 app.emit('click', { target: node('recap-save'), isTrusted: true }); await settle();
 assert.equal(app.sent.length, 2, 'one save at a time');
 app.tick(); // the long safety timer ends a lost answer
 assert.equal(node('recap-status').textContent, ACTION_TEXT.unavailable);
 app.emit('click', { target: node('recap-save'), isTrusted: true });
 for (let i = 0; i < 300 && app.sent.length < 3; i++) await new Promise(r => setTimeout(r, 10));
 assert.equal(app.sent.length, 3);
});

test('Save image without a canvas context reports a fixed failure and sends nothing', async () => {
 const app = await start(recapPage(RECAP));
 const node = (id: string) => find(app.main, n => n.getAttribute('id') === id)!;
 app.emit('click', { target: node('recap-save'), isTrusted: true }); await settle();
 assert.equal(app.sent.length, 1);
 assert.equal(node('recap-status').textContent, ACTION_TEXT.failed);
});

test('a hostile model cannot hide other controls, resize the canvas or carry a second canvas', async () => {
 const app = await start(recapPage(RECAP));
 const model = JSON.parse(JSON.stringify(buildDomModel(recapPage(RECAP)))) as DomNode & { children: any[] };
 const tweak = (change: (n: any) => void) => { const copy = JSON.parse(JSON.stringify(model)); const walk = (n: any) => { change(n); (n.children ?? []).forEach(walk); }; walk(copy); return copy; };
 const before = app.sent.length;
 app.send(tweak(n => { if (n.attrs?.id === 'recap-canvas') n.attrs.width = '9000'; }), 2);
 app.send(tweak(n => { if (n.attrs?.id === 'recap-canvas') n.attrs.hidden = ''; }), 3);
 app.send(tweak(n => { if (n.attrs?.id === 'recap-title') n.attrs.hidden = ''; }), 4);
 app.send(tweak(n => { if (n.tag === 'button' && n.attrs.id === 'recap-save') n.tag = 'div'; }), 5);
 app.send(tweak(n => { if (n.attrs?.id === 'recap-canvas') n.attrs.id = 'other'; }), 6);
 app.send(tweak(n => { if (n.attrs?.id === 'recap-canvas') n.children = [{ kind: 'text', text: 'x' }]; }), 7);
 assert.equal(app.sent.length, before, 'none of them is acknowledged');
});

test('the dashboard script has no markup, navigation, network, storage or code-evaluation sink', async () => {
 const text = await script();
 for (const sink of [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /\bFunction\s*\(/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /createObjectURL/, /srcdoc/, /toDataURL/, /toBlob/,
  /\.src\s*=/, /\.href\s*=/, /setAttribute\(\s*["'`](href|src|xlink:href|on\w+)/i, /createElement\(\s*["'`](a|img|script|iframe|link|object|embed)["'`]/, /localStorage|sessionStorage|document\.cookie|indexedDB/, /window\.open|location\.(href|assign|replace)/, /importScripts|postMessage\([^)]*,\s*["'`]\*/])
  assert.ok(!sink.test(text), String(sink));
});
