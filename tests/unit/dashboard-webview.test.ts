import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { buildDomModel, renderDashboardShell, type DomNode } from '../../src/extension/dashboard-shell.ts';
import { present } from '../../src/extension/presentation.ts';
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
 private value = '';
 private attrs = new Map<string, string>();
 constructor(tag: string, value = '') { this.nodeType = tag === '#text' ? 3 : 1; this.localName = tag; this.value = value; }
 get textContent(): string { return this.nodeType === 3 ? this.value : this.childNodes.map(n => n.textContent).join(''); }
 set textContent(value: string) { if (this.nodeType === 3) this.value = value; else this.childNodes = [new FakeNode('#text', value)]; }
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
 const sent: unknown[] = []; let onMessage: ((event: { data: unknown }) => void) | undefined, scroll: [number, number] | undefined;
 const document = { documentElement: root, activeElement: undefined as FakeNode | undefined,
  querySelector: (selector: string) => selector === 'main' ? main : selector === '#cg-link-reserve' ? reserve : null,
  createTextNode: t, createElement: (tag: string) => { assert.notEqual(tag, 'a', 'browser must never create an anchor');return e(tag); }, createElementNS: (_ns: string, tag: string) => e(tag) };
 const window = { scrollX: 4, scrollY: 80, scrollTo(x: number, y: number) { scroll = [x, y]; }, addEventListener(_type: string, fn: typeof onMessage) { onMessage = fn; } };
 runInNewContext(await script(), { document, window, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, acquireVsCodeApi: () => ({ postMessage: (m: unknown) => sent.push(m) }), Object, Number, Set, Array });
 return { main, reserve, document, sent, scroll: () => scroll, send(model: unknown, version = 1, schema = 1) { onMessage!({ data: { type: 'model', schema, version, model } }); } };
}

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
