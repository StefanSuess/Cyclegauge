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
 for (const href of ['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', 'https://github.com/StefanSuess/Cyclegauge', 'https://ko-fi.com/stefansuess', 'command:cyclegauge.costAdvisor', 'command:cyclegauge.auditWorkspace', 'command:cyclegauge.audit.show', 'command:cyclegauge.share']) {
  const link = e('a');link.setAttribute('href', href);reserve.appendChild(link);
 }
 const root = e('html');root.setAttribute('data-cg-load', '7');
 const sent: unknown[] = [], created: string[] = []; const timers = new Map<number, () => void>(); let nextTimer = 0; const handlers = new Map<string, (event: any) => void>(); let scroll: [number, number] | undefined;
 const document = { documentElement: root, activeElement: undefined as FakeNode | undefined,
  querySelector: (selector: string) => selector === 'main' ? main : selector === '#cg-link-reserve' ? reserve : selector.startsWith('#') ? find(main, n => n.getAttribute('id') === selector.slice(1)) ?? null : null,
  querySelectorAll: (selector: string) => selector === '[data-chart-point]' ? all(main, n => n.getAttribute('data-chart-point') !== null) : [],
  createTextNode: t, createElement: (tag: string) => { assert.notEqual(tag, 'a', 'browser must never create an anchor');created.push(tag);return e(tag); }, createElementNS: (ns: string, tag: string) => { assert.equal(ns, 'http://www.w3.org/2000/svg');created.push(`svg:${tag}`);return e(tag); } };
 const window = { scrollX: 4, scrollY: 80, scrollTo(x: number, y: number) { scroll = [x, y]; }, addEventListener(type: string, fn: (event: any) => void) { handlers.set(type, fn); } };
 runInNewContext(await script(), { document, window, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, acquireVsCodeApi: () => ({ postMessage: (m: unknown) => sent.push(m) }), setTimeout: (fn: () => void) => {const id=++nextTimer;timers.set(id,fn);return id;}, clearTimeout: (id: number) => timers.delete(id), Object, Number, Set, Array });
 return { main, reserve, document, sent, created, scroll: () => scroll, tick() { for(const fn of timers.values())fn();timers.clear(); }, emit(type: string, event: object) { handlers.get(type)!({ ...event }); }, send(model: unknown, version = 1, schema = 1) { handlers.get('message')!({ data: { type: 'model', schema, version, model } }); } };
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
 assert.match(find(form,n=>n.getAttribute('id')==='advisor-status')!.textContent,/review and submit again/i);
 assert.equal(find(form,n=>n.getAttribute('id')==='advisor-review-again')!.getAttribute('hidden'),null);
});

test('Advisor timeout and host busy reply explain the wait and allow a later retry', async () => {
 const observed=view([],'2030-01-01T00:00:00Z');
 const answers={plan:'pro' as const,billing:'consumer_prepaid' as const,addOns:'none' as const,addOnCredits:null};
 const page=present(observed,[],'','<section id="cost-advisor"></section>',undefined,'2030-01-01T00:00:00Z',false,undefined,inlineAdvisorForm(answers,1)).html;
 const app=await start(page);const form=find(app.main,n=>n.getAttribute('id')==='advisor-form')!;
 const status=find(form,n=>n.getAttribute('id')==='advisor-status')!;
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
 const error=find(form,n=>n.getAttribute('id')==='advisor-error')!;
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
