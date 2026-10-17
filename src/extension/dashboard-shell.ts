import { LINKS } from './identity.ts';

// The model is built only from our own escaped presentation, never from Kiro source data.
// Its element/attribute grammar is deliberately narrower than HTML. New markup must be reviewed here.
export type DomNode = { kind: 'text'; text: string } | DomElement;
export interface DomElement { kind: 'element'; tag: string; attrs: Record<string, string>; children: DomNode[] }
const TAGS = new Set('main section article div h1 h2 h3 h4 p span dl dt dd details summary table caption thead tbody tr th td footer a svg defs pattern line rect circle polygon path text title desc ul li figure figcaption strong em small br'.split(' '));
const ATTRS = new Set('id class role aria-label aria-hidden aria-labelledby aria-describedby scope data-kind x y x1 x2 y1 y2 cx cy r width height viewBox preserveAspectRatio d points text-anchor patternUnits patternTransform stroke-dasharray stroke-width stroke-opacity stroke-linecap fill-opacity'.split(' '));
const SAFE_LINKS = new Set([LINKS.rate, LINKS.star, LINKS.support, 'command:cyclegauge.costAdvisor', 'command:cyclegauge.auditWorkspace', 'command:cyclegauge.audit.show', 'command:cyclegauge.share']);
const decode = (value: string) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!);

export function buildDomModel(html: string): DomElement {
 const start = html.indexOf('<main>'), end = html.lastIndexOf('</main>');
 if (start < 0 || end < start || html.length > 1_000_000) throw new Error('DASHBOARD_MODEL_INVALID');
 const source = html.slice(start, end + 7);
 const tokens = source.match(/<[^>]*>|[^<]+/g) ?? [];
 const stack: DomElement[] = [];
 let root: DomElement | undefined, count = 0;
 for (const token of tokens) {
  if (++count > 20_000) throw new Error('DASHBOARD_MODEL_INVALID');
  if (token.startsWith('</')) {
   const tag = token.slice(2, -1).trim();
   if (stack.pop()?.tag !== tag) throw new Error('DASHBOARD_MODEL_INVALID');
   continue;
  }
  if (!token.startsWith('<')) {
   if (!stack.length || token.length > 4096) throw new Error('DASHBOARD_MODEL_INVALID');
   stack.at(-1)!.children.push({ kind: 'text', text: decode(token) });
   continue;
  }
  const match = /^<([A-Za-z][\w-]*)([\s\S]*?)\/?\s*>$/.exec(token);
  if (!match || !TAGS.has(match[1]!)) throw new Error('DASHBOARD_MODEL_INVALID');
  const tag = match[1]!, attrs: Record<string, string> = Object.create(null);
  let rest = match[2]!.trim();
  while (rest) {
   const attr = /^([A-Za-z][\w:-]*)(?:="([^"]*)")?(?:\s+|$)/.exec(rest);
   if (!attr) throw new Error('DASHBOARD_MODEL_INVALID');
   const name = attr[1]!, value = decode(attr[2] ?? '');
   if (name !== 'open' && name !== 'href' && name !== 'xmlns' && !ATTRS.has(name)) throw new Error('DASHBOARD_MODEL_INVALID');
   if (name === 'href' && (tag !== 'a' || !SAFE_LINKS.has(value))) throw new Error('DASHBOARD_MODEL_INVALID');
   if (name === 'open' && tag !== 'details') throw new Error('DASHBOARD_MODEL_INVALID');
   if (name === 'xmlns' && (tag !== 'svg' || value !== 'http://www.w3.org/2000/svg')) throw new Error('DASHBOARD_MODEL_INVALID');
   if (value.length > 4096 || Object.hasOwn(attrs, name)) throw new Error('DASHBOARD_MODEL_INVALID');
   if (name !== 'open' && name !== 'xmlns') attrs[name] = value; // open is UI state; SVG namespace comes from createElementNS
   rest = rest.slice(attr[0].length).trimStart();
  }
  const node: DomElement = { kind: 'element', tag, attrs, children: [] };
  if (stack.length) stack.at(-1)!.children.push(node);
  else if (!root && tag === 'main') root = node;
  else throw new Error('DASHBOARD_MODEL_INVALID');
  if (!token.endsWith('/>') && tag !== 'br') stack.push(node);
 }
 if (stack.length || !root) throw new Error('DASHBOARD_MODEL_INVALID');
 return root;
}

export function renderDashboardShell(staticHtml: string, nonce: string, load: number, script: string): string {
 if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(nonce) || !Number.isSafeInteger(load) || load < 1 || /\sstyle=/i.test(staticHtml) || /<script\b/i.test(staticHtml)) throw new Error('DASHBOARD_SHELL_INVALID');
 const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; require-trusted-types-for 'script'; trusted-types 'none'`;
 const old = 'default-src \'none\'; style-src \'unsafe-inline\'';
 if (!staticHtml.includes(old) || !staticHtml.includes('<style>') || !staticHtml.includes('<html lang="en">')) throw new Error('DASHBOARD_SHELL_INVALID');
 // These inert, host-defined anchors are the complete inventory for links that can appear later.
 // The browser may move an anchor, but cannot create one or assign its href.
 const reserve = `<div id="cg-link-reserve" hidden aria-hidden="true">${[...SAFE_LINKS].map(href => `<a href="${href}"></a>`).join('')}</div>`;
 return staticHtml.replace(old, csp).replace('<style>', `<style nonce="${nonce}">`).replace('<html lang="en">', `<html lang="en" data-cg-load="${load}">`).replace('</body>', `${reserve}<script nonce="${nonce}">${script}</script></body>`);
}

export type AcceptedMessage = { type: 'ready' } | { type: 'ack' };
export function acceptMessage(raw: unknown, load: number, version: number): AcceptedMessage | null {
 if (!raw || typeof raw !== 'object') return null;
 const proto = Object.getPrototypeOf(raw);
 if (!proto || Object.getPrototypeOf(proto) !== null || Object.prototype.toString.call(raw) !== '[object Object]') return null;
 const m = raw as Record<string, unknown>, keys = Object.keys(m);
 if (keys.length !== 2 || typeof m.type !== 'string' || !Number.isSafeInteger(m.load ?? m.version)) return null;
 if (m.type === 'ready' && keys.includes('load') && m.load === load) return { type: 'ready' };
 if (m.type === 'ack' && keys.includes('version') && m.version === version && version > 0) return { type: 'ack' };
 return null;
}
