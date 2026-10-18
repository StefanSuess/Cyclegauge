import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDomModel, renderDashboardShell, acceptMessage } from '../../src/extension/dashboard-shell.ts';
import { present } from '../../src/extension/presentation.ts';
import { view } from '../../src/view.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

test('current static dashboard converts to the constrained DOM model', () => {
 const html = present(view([], '2030-01-01T00:00:00Z')).html;
 assert.equal(buildDomModel(html).tag, 'main');
});

test('observed update can add a chart point and history row to the DOM model', () => {
 const points = Array.from({ length: 8 }, (_, i) => snapshot(`2030-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`, String(i * 10), { limit: '1000' }));
 const before = buildDomModel(present(view(points, '2030-06-08T00:00:00Z')).html);
 points.push(snapshot('2030-06-09T00:00:00Z', '80', { limit: '1000' }));
 const after = buildDomModel(present(view(points, '2030-06-09T00:00:00Z')).html);
 assert.notDeepEqual(before, after);
 assert.ok(JSON.stringify(after).includes('80 CREDIT'));
});

test('dashboard model keeps new table rows and SVG points as typed DOM nodes', () => {
 const first = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>p{color:red}</style></head><body><main><details open><summary>History</summary><table><tr><td>10</td></tr></table><svg><circle cx="1" cy="2"/></svg></details></main></body></html>';
 const second = first.replace('<tr><td>10</td></tr>', '<tr><td>10</td></tr><tr><td>20</td></tr>').replace('<circle cx="1" cy="2"/>', '<circle cx="1" cy="2"/><circle cx="3" cy="4"/>');
 const a = buildDomModel(first), b = buildDomModel(second);
 assert.equal(a.tag, 'main');
 assert.equal(b.children[0]?.kind, 'element');
 assert.ok(JSON.stringify(b).includes('20'));
 assert.ok(JSON.stringify(b).includes('"cx":"3"'));
 assert.notDeepEqual(a, b);
});

test('dashboard model rejects attributes and URLs outside the fixed allowlist', () => {
 const body = (s: string) => `<!doctype html><html><body><main>${s}</main></body></html>`;
 assert.throws(() => buildDomModel(body('<img src="https://synthetic.invalid/x">')));
 assert.throws(() => buildDomModel(body('<a href="https://synthetic.invalid/x">go</a>')));
 assert.throws(() => buildDomModel(body('<p style="color:red">bad</p>')));
 assert.throws(() => buildDomModel(body('<p onclick="bad()">bad</p>')));
});

test('shell has one nonce for style and script and no inline style attributes', () => {
 const staticHtml = '<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>p{color:red}</style></head><body><main><p>safe</p></main></body></html>';
 const html = renderDashboardShell(staticHtml, 'syntheticNonce123', 7, 'console.log(1)');
 assert.match(html, /script-src 'nonce-syntheticNonce123'; style-src 'nonce-syntheticNonce123'/);
 assert.match(html, /require-trusted-types-for 'script'; trusted-types 'none'/);
 assert.match(html, /<style nonce="syntheticNonce123">/);
 assert.match(html, /<script nonce="syntheticNonce123">/);
 assert.match(html, /data-cg-load="7"/);
 assert.ok(!/\sstyle=/i.test(html));
});

test('ready and ack accept only exact plain current-load messages', () => {
 const allowed = (raw: unknown) => acceptMessage(raw, 7, 4);
 assert.deepEqual(allowed({ type: 'ready', load: 7 }), { type: 'ready' });
 assert.deepEqual(allowed({ type: 'ack', version: 4 }), { type: 'ack' });
 for (const raw of [{ type: 'ready', load: 6 }, { type: 'ready', load: 7, extra: 1 }, { type: 'run' }, { type: '__proto__' }, { type: 'ack', version: 3 }, Object.assign(Object.create(null), { type: 'ready', load: 7 }), []]) assert.equal(allowed(raw), null);
});
