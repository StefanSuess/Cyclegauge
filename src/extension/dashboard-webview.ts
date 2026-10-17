// Bundled separately into one nonce'd inline script. No Node or extension APIs are available here.
type DomNode = { kind: 'text'; text: string } | DomElement;
interface DomElement { kind: 'element'; tag: string; attrs: Record<string, string>; children: DomNode[] }

declare function acquireVsCodeApi(): { postMessage(message: object): void };
const vscode = acquireVsCodeApi();
const load = Number(document.documentElement.getAttribute('data-cg-load'));
const TAGS = new Set('main section article div h1 h2 h3 h4 p span dl dt dd details summary table caption thead tbody tr th td footer a svg defs pattern line rect circle polygon path text title desc ul li figure figcaption strong em small br'.split(' '));
const ATTRS = new Set('id class role aria-label aria-hidden aria-labelledby aria-describedby scope data-kind x y x1 x2 y1 y2 cx cy r width height viewBox preserveAspectRatio d points text-anchor patternUnits patternTransform stroke-dasharray stroke-width stroke-opacity stroke-linecap fill-opacity'.split(' '));
const SAFE_LINKS = new Set(['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', 'https://github.com/StefanSuess/Cyclegauge', 'https://ko-fi.com/stefansuess', 'command:cyclegauge.costAdvisor', 'command:cyclegauge.auditWorkspace', 'command:cyclegauge.audit.show', 'command:cyclegauge.share']);
const SVG = 'http://www.w3.org/2000/svg';

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
 const element = inSvg ? document.createElementNS(SVG, node.tag) : document.createElement(node.tag);
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
 try {
  const links = [...anchors(main), ...anchors(reserve)];
  if (links.some(link => !SAFE_LINKS.has(link.getAttribute('href') ?? ''))) return;
  for (const link of anchors(main)) reserve.appendChild(link);
  reconcile(main, model.children, false, links);
  if (focused?.localName === 'a' && main.contains(focused)) (focused as HTMLElement).focus();
  window.scrollTo(x, y);
  vscode.postMessage({ type: 'ack', version: message.version });
 } catch { /* The host's 5-second timer restores a fresh static document. */ }
});
if (Number.isSafeInteger(load) && load > 0) vscode.postMessage({ type: 'ready', load });
