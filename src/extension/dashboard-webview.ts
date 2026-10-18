import {reconcileAdvisorDraft} from './advisor-draft.js';
// Bundled separately into one nonce'd inline script. No Node or extension APIs are available here.
type DomNode = { kind: 'text'; text: string } | DomElement;
interface DomElement { kind: 'element'; tag: string; attrs: Record<string, string>; children: DomNode[] }

declare function acquireVsCodeApi(): { postMessage(message: object): void };
const vscode = acquireVsCodeApi();
const load = Number(document.documentElement.getAttribute('data-cg-load'));
const TAGS = new Set('main section article div h1 h2 h3 h4 p span dl dt dd details summary table caption thead tbody tr th td footer form fieldset legend label select option input button a svg defs pattern line rect circle polygon path text title desc ul li figure figcaption strong em small br'.split(' '));
const ATTRS = new Set('id class role aria-label aria-hidden aria-labelledby aria-describedby aria-live aria-atomic aria-invalid scope type name for value data-advisor-epoch data-plan data-billing data-add-ons data-add-on-credits data-kind data-chart-point tabindex hidden x y x1 x2 y1 y2 cx cy r width height viewBox preserveAspectRatio d points text-anchor patternUnits patternTransform stroke-dasharray stroke-width stroke-opacity stroke-linecap fill-opacity'.split(' '));
const SAFE_LINKS = new Set(['https://open-vsx.org/extension/StefanSuess/cyclegauge/reviews', 'https://github.com/StefanSuess/Cyclegauge', 'https://ko-fi.com/stefansuess', 'command:cyclegauge.costAdvisor', 'command:cyclegauge.auditWorkspace', 'command:cyclegauge.audit.show', 'command:cyclegauge.share']);
const SVG = 'http://www.w3.org/2000/svg';
// Literal DOM sinks make the permitted grammar explicit even if an inbound model is hostile.
const HTML_ELEMENTS: Record<string, () => Element> = {
 main: () => document.createElement('main'), section: () => document.createElement('section'), article: () => document.createElement('article'), div: () => document.createElement('div'),
 h1: () => document.createElement('h1'), h2: () => document.createElement('h2'), h3: () => document.createElement('h3'), h4: () => document.createElement('h4'),
 p: () => document.createElement('p'), span: () => document.createElement('span'), dl: () => document.createElement('dl'), dt: () => document.createElement('dt'), dd: () => document.createElement('dd'),
 details: () => document.createElement('details'), summary: () => document.createElement('summary'), table: () => document.createElement('table'), caption: () => document.createElement('caption'),
 thead: () => document.createElement('thead'), tbody: () => document.createElement('tbody'), tr: () => document.createElement('tr'), th: () => document.createElement('th'), td: () => document.createElement('td'),
 footer: () => document.createElement('footer'), form: () => document.createElement('form'), fieldset: () => document.createElement('fieldset'), legend: () => document.createElement('legend'), label: () => document.createElement('label'), select: () => document.createElement('select'), option: () => document.createElement('option'), input: () => document.createElement('input'), button: () => document.createElement('button'), ul: () => document.createElement('ul'), li: () => document.createElement('li'), figure: () => document.createElement('figure'),
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
 const tag = n.tag as string;
 if (Object.entries(attrs as Record<string,string>).some(([name,value]) =>
  ['data-advisor-epoch','data-plan','data-billing','data-add-ons','data-add-on-credits'].includes(name) && tag !== 'form' ||
  name === 'value' && (tag !== 'option' || !['unsure','free','pro','pro_plus','pro_max','power','reset','consumer_prepaid','enterprise_postpaid','none','some'].includes(value)) ||
  name === 'type' && !(tag === 'input' && value === 'text' || tag === 'button' && ['submit','button'].includes(value)) ||
  name === 'name' && (!['input','select'].includes(tag) || !['plan','billing','addOns','addOnCredits'].includes(value)) ||
  name === 'for' && (tag !== 'label' || !['advisor-plan','advisor-billing','advisor-add-ons','advisor-credits'].includes(value)) ||
  name === 'aria-invalid' && (!['input','select'].includes(tag) || !['true','false'].includes(value)))) return false;
 if (Object.hasOwn(attrs, 'data-chart-point') && (!['circle', 'polygon'].includes(n.tag) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(attrs['data-chart-point']!))) return false;
 if (Object.hasOwn(attrs, 'tabindex') && (!['circle', 'polygon'].includes(n.tag) || !['0', '-1'].includes(attrs.tabindex!))) return false;
 if (Object.hasOwn(attrs, 'aria-live') && (!['dd','p'].includes(n.tag) || attrs['aria-live'] !== 'polite')) return false;
 if (Object.hasOwn(attrs, 'aria-atomic') && (n.tag !== 'dd' || attrs['aria-atomic'] !== 'true')) return false;
 if (Object.hasOwn(attrs, 'hidden') && (!['p','button'].includes(n.tag) || !['chart-tooltip','advisor-review-again'].includes(attrs.id) || attrs.hidden !== '')) return false;
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

type AdvisorDraft={plan:string;billing:string;addOns:string;addOnCredits:string};
let advisorDraft:AdvisorDraft|null=null, advisorTicket:number|null=null, advisorPending=false;
let advisorHostEpoch:number|null=null, advisorAwaitingEpoch:number|null=null, advisorEditVersion=0, advisorSavedVersion=0, advisorSubmittedVersion=0, advisorSubmissionUnresolved=false;
let advisorTimer:ReturnType<typeof setTimeout>|undefined;
const advisorForm=()=>document.querySelector('#advisor-form') as HTMLFormElement|null;
const advisorEpoch=():number=>Math.max(advisorHostEpoch??0,Number(advisorForm()?.getAttribute('data-advisor-epoch')));
function advisorFields(form:HTMLFormElement):AdvisorDraft {
 const value=(name:string)=>(form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|null)?.value??'';
 return {plan:value('plan'),billing:value('billing'),addOns:value('addOns'),addOnCredits:value('addOnCredits')};
}
function applyAdvisor(form:HTMLFormElement, draft:AdvisorDraft):void {
 for(const [name,value] of Object.entries(draft)) {
  const field=form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|null;
  if(field)field.value=value;
 }
}
function advisorStatus(text:string,fields:string[]=[]):void {
 const form=advisorForm();if(!form)return;
 const status=form.querySelector('#advisor-status'),error=form.querySelector('#advisor-error');
 if(status)status.textContent=text;
 if(error)error.textContent=fields.length?'Check the marked Cost Advisor answer.':'';
 for(const name of ['plan','billing','addOns','addOnCredits']) {
  const field=form.elements.namedItem(name) as Element|null;
  if(!field)continue;
  if(fields.includes(name)){field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby','advisor-error');}
  else {field.removeAttribute('aria-invalid');if(name!=='addOnCredits')field.removeAttribute('aria-describedby');}
 }
}
function syncAdvisor():void {
 const form=advisorForm();if(!form)return;
 const next=reconcileAdvisorDraft({hasDraft:advisorDraft!==null,ticket:advisorTicket,awaitingEpoch:advisorAwaitingEpoch,editVersion:advisorEditVersion,savedVersion:advisorSavedVersion,modelEpoch:Number(form.getAttribute('data-advisor-epoch')),hostEpoch:advisorHostEpoch});
 advisorAwaitingEpoch=next.awaitingEpoch;
 if(!next.keepDraft)advisorDraft=null;
 if(advisorDraft){
  applyAdvisor(form,advisorDraft);
  if(next.stale){advisorStatus('These answers changed or were reopened elsewhere; review and submit again.');form.querySelector('#advisor-review-again')?.removeAttribute('hidden');}
 }else{
  applyAdvisor(form,{plan:form.getAttribute('data-plan')??'unsure',billing:form.getAttribute('data-billing')??'unsure',addOns:form.getAttribute('data-add-ons')??'unsure',addOnCredits:form.getAttribute('data-add-on-credits')??''});
  advisorTicket=next.epoch;
 }
}
window.addEventListener('input',event=>{const form=advisorForm();if(form&&event.isTrusted&&form.contains(event.target as Node)){if(!advisorDraft)advisorTicket=advisorEpoch();advisorDraft=advisorFields(form);advisorEditVersion++;}});
window.addEventListener('change',event=>{const form=advisorForm();if(form&&event.isTrusted&&form.contains(event.target as Node)){if(!advisorDraft)advisorTicket=advisorEpoch();advisorDraft=advisorFields(form);advisorEditVersion++;}});
window.addEventListener('click',event=>{
 const form=advisorForm();if(!form||!event.isTrusted||event.target!==form.querySelector('#advisor-review-again'))return;
 advisorTicket=advisorEpoch();form.querySelector('#advisor-review-again')?.setAttribute('hidden','');advisorStatus('Review your answers, then submit again.');
});
window.addEventListener('submit',event=>{
 const form=advisorForm();if(!form||event.target!==form)return;
 event.preventDefault();if(!event.isTrusted||advisorPending)return;
 if(advisorTicket!==advisorEpoch()){advisorStatus('Your answers changed elsewhere; review and submit again.');form.querySelector('#advisor-review-again')?.removeAttribute('hidden');return;}
 const draft=advisorFields(form);advisorDraft=draft;if(!advisorSubmissionUnresolved){advisorSubmittedVersion=advisorEditVersion;advisorSubmissionUnresolved=true;}advisorPending=true;advisorStatus('Reviewing Cost Advisor answers…');
 advisorTimer=setTimeout(()=>{if(advisorPending){advisorPending=false;advisorStatus('The review has not finished. Try again later.');}},15000);
 vscode.postMessage({type:'advisorSubmit',ticket:advisorTicket, ...draft});
});

window.addEventListener('message', event => {
 const message = event.data as { type?: unknown; schema?: unknown; version?: unknown; model?: unknown; status?: unknown; fields?: unknown; epoch?: unknown; reason?: unknown } | null;
 if(message?.type==='advisorResult') {
  advisorPending=false;if(advisorTimer)clearTimeout(advisorTimer);advisorTimer=undefined;
  if(Number.isSafeInteger(message.epoch)&&(message.epoch as number)>=0)advisorHostEpoch=message.epoch as number;
  if(message.status==='ok'){advisorSubmissionUnresolved=false;advisorAwaitingEpoch=advisorHostEpoch;advisorTicket=advisorHostEpoch;advisorSavedVersion=advisorSubmittedVersion;advisorForm()?.querySelector('#advisor-review-again')?.setAttribute('hidden','');advisorStatus('Cost Advisor review saved for this session.');syncAdvisor();}
  else if(message.status==='stale'){advisorSubmissionUnresolved=false;advisorStatus('Your answers changed elsewhere; review and submit again.');advisorForm()?.querySelector('#advisor-review-again')?.removeAttribute('hidden');}
  else if(message.status==='invalid'){const fields=message.reason==='busy'?[]:Array.isArray(message.fields)?message.fields.filter((x):x is string=>['plan','billing','addOns','addOnCredits'].includes(x)):['plan','billing','addOns','addOnCredits'];if(fields.length)advisorSubmissionUnresolved=false;advisorStatus(message.reason==='busy'?'A Cost Advisor review is still running. Try again later.':fields.length?'Check your Cost Advisor answers and submit again.':'Please wait two seconds and submit again.',fields);}
  return;
 }
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
  syncAdvisor();
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
syncAdvisor();
if (Number.isSafeInteger(load) && load > 0) vscode.postMessage({ type: 'ready', load });
