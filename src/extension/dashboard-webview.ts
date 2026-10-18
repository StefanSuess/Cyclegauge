// Bundled separately into one nonce'd inline script. No Node or extension APIs are available here.
type DomNode = { kind: 'text'; text: string } | DomElement;
interface DomElement { kind: 'element'; tag: string; attrs: Record<string, string>; children: DomNode[] }

declare function acquireVsCodeApi(): { postMessage(message: object): void };
const vscode = acquireVsCodeApi();
const load = Number(document.documentElement.getAttribute('data-cg-load'));
const TAGS = new Set('main section article div h1 h2 h3 h4 p span dl dt dd details summary table caption thead tbody tr th td footer a svg defs pattern line rect circle polygon path text title desc ul li figure figcaption strong em small br'.split(' '));
const ATTRS = new Set('id class role aria-label aria-hidden aria-labelledby aria-describedby aria-live aria-atomic scope data-kind data-chart-point tabindex hidden x y x1 x2 y1 y2 cx cy r width height viewBox preserveAspectRatio d points text-anchor patternUnits patternTransform stroke-dasharray stroke-width stroke-opacity stroke-linecap fill-opacity'.split(' '));
const SAFE_LINKS = new Set(['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', 'https://github.com/StefanSuess/Cyclegauge', 'https://ko-fi.com/stefansuess', 'command:cyclegauge.costAdvisor', 'command:cyclegauge.auditWorkspace', 'command:cyclegauge.audit.show', 'command:cyclegauge.share']);
const SVG = 'http://www.w3.org/2000/svg';
// Literal DOM sinks make the permitted grammar explicit even if an inbound model is hostile.
const HTML_ELEMENTS: Record<string, () => Element> = {
 main: () => document.createElement('main'), section: () => document.createElement('section'), article: () => document.createElement('article'), div: () => document.createElement('div'),
 h1: () => document.createElement('h1'), h2: () => document.createElement('h2'), h3: () => document.createElement('h3'), h4: () => document.createElement('h4'),
 p: () => document.createElement('p'), span: () => document.createElement('span'), dl: () => document.createElement('dl'), dt: () => document.createElement('dt'), dd: () => document.createElement('dd'),
 details: () => document.createElement('details'), summary: () => document.createElement('summary'), table: () => document.createElement('table'), caption: () => document.createElement('caption'),
 thead: () => document.createElement('thead'), tbody: () => document.createElement('tbody'), tr: () => document.createElement('tr'), th: () => document.createElement('th'), td: () => document.createElement('td'),
 footer: () => document.createElement('footer'), ul: () => document.createElement('ul'), li: () => document.createElement('li'), figure: () => document.createElement('figure'),
 figcaption: () => document.createElement('figcaption'), strong: () => document.createElement('strong'), em: () => document.createElement('em'), small: () => document.createElement('small'), br: () => document.createElement('br'),
};
const SVG_ELEMENTS: Record<string, () => Element> = {
 svg: () => document.createElementNS(SVG, 'svg'), defs: () => document.createElementNS(SVG, 'defs'), pattern: () => document.createElementNS(SVG, 'pattern'),
 line: () => document.createElementNS(SVG, 'line'), rect: () => document.createElementNS(SVG, 'rect'), circle: () => document.createElementNS(SVG, 'circle'),
 polygon: () => document.createElementNS(SVG, 'polygon'), path: () => document.createElementNS(SVG, 'path'), text: () => document.createElementNS(SVG, 'text'),
 title: () => document.createElementNS(SVG, 'title'), desc: () => document.createElementNS(SVG, 'desc'),
};

function valid(node: unknown, depth = 0, budget = { n: 0 }): node is DomNode {
 if (!node || typeof node !== 'object' || ++budget.n > 20_000 || depth > 80) return false;
 const n = node as Record<string, unknown>;
 if (n.kind === 'text') return Object.keys(n).length === 2 && typeof n.text === 'string' && n.text.length <= 4096;
 if (n.kind !== 'element' || typeof n.tag !== 'string' || !TAGS.has(n.tag) || !n.attrs || typeof n.attrs !== 'object' || Array.isArray(n.attrs) || !Array.isArray(n.children)) return false;
 if (Object.keys(n).length !== 4 || n.children.length > 10_000) return false;
 for (const [name, value] of Object.entries(n.attrs)) if (!ATTRS.has(name) || typeof value !== 'string' || value.length > 4096) {
  // Links are fixed in the static document; the script never writes URL attributes.
  if (name !== 'href' || n.tag !== 'a' || typeof value !== 'string' || !SAFE_LINKS.has(value)) return false;
 }
 const attrs = n.attrs as Record<string, string>;
 if (Object.hasOwn(attrs, 'data-chart-point') && (!['circle', 'polygon'].includes(n.tag) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(attrs['data-chart-point']!))) return false;
 if (Object.hasOwn(attrs, 'tabindex') && (!['circle', 'polygon'].includes(n.tag) || !['0', '-1'].includes(attrs.tabindex!))) return false;
 if (Object.hasOwn(attrs, 'aria-live') && (n.tag !== 'dd' || attrs['aria-live'] !== 'polite')) return false;
 if (Object.hasOwn(attrs, 'aria-atomic') && (n.tag !== 'dd' || attrs['aria-atomic'] !== 'true')) return false;
 if (Object.hasOwn(attrs, 'hidden') && (n.tag !== 'p' || attrs.id !== 'chart-tooltip' || attrs.hidden !== '')) return false;
 return n.children.every(child => valid(child, depth + 1, budget));
}

function anchors(node: Node): Element[] {
 const found: Element[] = [];
 for (const child of Array.from(node.childNodes)) {
  if (child.nodeType === Node.ELEMENT_NODE && (child as Element).localName === 'a') found.push(child as Element);
  found.push(...anchors(child));
 }
 return found;
}

function create(node: DomNode, svg: boolean, links: Element[]): Node {
 if (node.kind === 'text') return document.createTextNode(node.text);
 if (node.tag === 'a') {
  const index = links.findIndex(link => link.getAttribute('href') === node.attrs.href);
  if (index < 0) throw new Error('DASHBOARD_ANCHOR');
  const anchor = links.splice(index, 1)[0]!;
  update(anchor, node, false, links);
  return anchor;
 }
 const inSvg = svg || node.tag === 'svg';
 const factories = inSvg ? SVG_ELEMENTS : HTML_ELEMENTS;
 if (!Object.hasOwn(factories, node.tag)) throw new Error('DASHBOARD_TAG');
 const element = factories[node.tag]!();
 for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, value);
 for (const child of node.children) element.appendChild(create(child, inSvg, links));
 return element;
}

function update(element: Element, next: DomElement, svg: boolean, links: Element[]): void {
 if (next.tag === 'a' && element.getAttribute('href') !== next.attrs.href) throw new Error('DASHBOARD_LINK_CHANGED');
 for (const attr of Array.from(element.attributes)) if (attr.name !== 'open' && attr.name !== 'href' && !Object.hasOwn(next.attrs, attr.name)) element.removeAttribute(attr.name);
 for (const [name, value] of Object.entries(next.attrs)) {
  if (name !== 'href' && element.getAttribute(name) !== value) element.setAttribute(name, value);
 }
 reconcile(element, next.children, svg || next.tag === 'svg', links);
}

function reconcile(parent: Node, wanted: DomNode[], svg: boolean, links: Element[]): void {
 for (let i = 0; i < wanted.length; i++) {
  const next = wanted[i]!, old = parent.childNodes[i];
  if (!old) { parent.appendChild(create(next, svg, links)); continue; }
  if (next.kind === 'text') {
   if (old.nodeType !== Node.TEXT_NODE) parent.insertBefore(create(next, svg, links), old);
   else if (old.textContent !== next.text) old.textContent = next.text;
   continue;
  }
  if (old.nodeType !== Node.ELEMENT_NODE || (old as Element).localName !== next.tag) { parent.insertBefore(create(next, svg, links), old); continue; }
  const element = old as Element;
  update(element, next, svg, links);
 }
 while (parent.childNodes.length > wanted.length) parent.removeChild(parent.lastChild!);
}

const points = (): Element[] => Array.from(document.querySelectorAll('[data-chart-point]'));
const tooltip = (): Element | null => document.querySelector('#chart-tooltip');
let selectedAt: string | null = null, hoveredAt: string | null = null;
function point(target: EventTarget | null): Element | null {
 let node = target as Element | null;
 while (node && node !== document.querySelector('main')) {
  if (node.getAttribute?.('data-chart-point') !== null && node.getAttribute?.('data-chart-point') !== undefined) return node;
  node = node.parentNode as Element | null;
 }
 return null;
}
function show(p: Element): void {
 const tip = tooltip(); if (!tip) return;
 tip.textContent = p.getAttribute('aria-label') ?? '';
 tip.removeAttribute('hidden');
}
function hide(): void { tooltip()?.setAttribute('hidden', ''); }
function select(p: Element, focus: boolean): void {
 selectedAt = p.getAttribute('data-chart-point');
 for (const item of points()) item.setAttribute('tabindex', item === p ? '0' : '-1');
 if (focus) (p as HTMLElement).focus();
 show(p);
}
window.addEventListener('focusin', event => {
 const p = point(event.target); if (p) select(p, false);
});
window.addEventListener('focusout', event => {
 if (point(event.target) && !point(event.relatedTarget) && event.relatedTarget !== tooltip() && !hoveredAt) hide();
});
window.addEventListener('pointerover', event => {
 const p = point(event.target); if (p) { hoveredAt = p.getAttribute('data-chart-point'); show(p); }
});
window.addEventListener('pointerout', event => {
 const frame = tooltip()?.parentNode;
 if (!frame || !event.target || !frame.contains(event.target as Node)) return;
 if (event.relatedTarget && frame.contains(event.relatedTarget as Node)) return;
 hoveredAt = null;
 if (!point(document.activeElement)) hide();
});
window.addEventListener('keydown', event => {
 if (event.key === 'Escape' && tooltip()?.getAttribute('hidden') === null) {
  hoveredAt = null; hide(); event.preventDefault(); return;
 }
 const p = point(event.target); if (!p) return;
 const list = points(), index = list.indexOf(p);
 if (index < 0) return;
 const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? Math.min(index + 1, list.length - 1)
  : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? Math.max(index - 1, 0)
  : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : -1;
 if (next < 0) return;
 event.preventDefault(); select(list[next]!, true);
});

window.addEventListener('message', event => {
 const message = event.data as { type?: unknown; schema?: unknown; version?: unknown; model?: unknown } | null;
 if (!message || message.type !== 'model' || message.schema !== 1 || !Number.isSafeInteger(message.version) || (message.version as number) < 1 || !valid(message.model)) return;
 const model = message.model as DomElement;
 if (model.tag !== 'main') return;
 const main = document.querySelector('main');
 const reserve = document.querySelector('#cg-link-reserve');
 if (!main || !reserve) return;
 const x = window.scrollX, y = window.scrollY;
 const focused = document.activeElement;
 const focusedAt = point(focused)?.getAttribute('data-chart-point') ?? null;
 const tipOpen = tooltip()?.getAttribute('hidden') === null;
 try {
  const links = [...anchors(main), ...anchors(reserve)];
  if (links.some(link => !SAFE_LINKS.has(link.getAttribute('href') ?? ''))) return;
  for (const link of anchors(main)) reserve.appendChild(link);
  reconcile(main, model.children, false, links);
  const plotted = points();
  const selected = plotted.find(p => p.getAttribute('data-chart-point') === (focusedAt ?? selectedAt)) ?? plotted[0];
  if (selected) {
   selectedAt = selected.getAttribute('data-chart-point');
   for (const item of plotted) item.setAttribute('tabindex', item === selected ? '0' : '-1');
   if (focusedAt) (selected as HTMLElement).focus();
  }
  if (tipOpen) {
   const shown = plotted.find(p => p.getAttribute('data-chart-point') === (hoveredAt ?? focusedAt ?? selectedAt));
   if (shown) show(shown); else hide();
  }
  if (focused?.localName === 'a' && main.contains(focused)) (focused as HTMLElement).focus();
  window.scrollTo(x, y);
  vscode.postMessage({ type: 'ack', version: message.version });
 } catch { /* The host's 5-second timer restores a fresh static document. */ }
});
if (Number.isSafeInteger(load) && load > 0) vscode.postMessage({ type: 'ready', load });
