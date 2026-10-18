import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startExtension, type ExtensionOptions } from '../../src/extension/controller.ts';
import type { StoredRecap } from '../../src/extension/recap.ts';

const line = (when: string, usage: number, reset: string) => `${when} [info] synthetic-envelope ` + JSON.stringify({ commandName: 'GetUsageLimitsCommand', input: {}, output: { userInfo: { userId: 'synthetic-recap-account' }, nextDateReset: reset, usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS', currentUsageWithPrecision: usage, usageLimitWithPrecision: 1000, nextDateReset: reset, bonuses: [], overageCredits: [] }] }, metadata: { httpStatusCode: 200 } }) + '\n';
const R0 = '2030-06-01T00:00:00Z', R1 = '2030-07-01T00:00:00Z', R2 = '2030-08-01T00:00:00Z';
const LOG = line('2030-05-20 00:00:00.000', 100, R0) + line('2030-06-01 06:00:00.000', 30, R1) + line('2030-06-10 00:00:00.000', 300, R1) + line('2030-06-30 20:00:00.000', 900, R1) + line('2030-07-01 06:00:00.000', 10, R2);

async function harness(recapState: () => StoredRecap, extra: Partial<ExtensionOptions> = {}) {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-recap-controller-')));
 const root = join(base, 'Kiro'), dir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 await mkdir(dir, { recursive: true });
 await writeFile(join(dir, 'q-client.log'), LOG);
 let html = '';
 const ui = { setStatus(_t: string, h: string) { html = h; }, showDetails(_h: string) {}, onClick(_fn: () => void) {}, onChange(_fn: () => void) {}, everyMinute(_fn: () => void) {}, dispose() {} };
 const shown: string[] = [];
 const controller = await startExtension(ui, { source: root, storage: join(base, 'owned'), timezone: 'UTC', now: () => '2030-07-01T12:00:00.000Z', recapState, recapShown: c => { shown.push(c); }, ...extra });
 return { controller, shown, html: () => html, done: () => { controller.dispose(); return rm(base, { recursive: true, force: true }); } };
}

test('the first time a new cycle is observed the card appears once and is marked shown', async () => {
 const h = await harness(() => ({ status: 'ok', value: null }));
 try {
  assert.match(h.html(), /<h2 id="recap-title">Your Kiro cycle<\/h2>/);
  assert.match(h.html(), /Credits used: 900 of 1000 reported credits/);
  assert.match(h.html(), /Lasted until the reset: yes\./);
  assert.match(h.html(), /Exclusions you saved in that cycle: not available because the saved summary could not be read\./, 'no summary source wired');
  assert.deepEqual(h.shown, ['2030-08-01T00:00:00.000Z']);
  await h.controller.refresh(); h.controller.rerender();
  assert.equal(h.shown.length, 1, 'asked once per cycle and session');
  assert.match(h.controller.recapText()!, /^Your Kiro cycle\nCycle that ended 1 Jul 2030 \(UTC\)\./);
  assert.ok(!/synthetic-recap-account|synthetic-run/.test(h.html() + h.controller.recapText()!));
 } finally { await h.done(); }
});

test('the card is hidden when dismissed, unknown or not wired, and the link follows its switch', async () => {
 for (const state of [{ status: 'ok', value: { cycle: '2030-08-01T00:00:00.000Z', state: 'dismissed' } }, { status: 'unknown' }] as StoredRecap[]) {
  const h = await harness(() => state);
  try { assert.ok(!h.html().includes('id="recap-card"')); assert.equal(h.controller.recapText(), null); assert.deepEqual(h.shown, []); } finally { await h.done(); }
 }
 const shownCard = await harness(() => ({ status: 'ok', value: { cycle: '2030-08-01T00:00:00.000Z', state: 'shown' } }), { recapLink: () => false });
 try { assert.match(shownCard.html(), /id="recap-card"/); assert.ok(!shownCard.html().includes('Cyclegauge for Kiro IDE: https://')); assert.deepEqual(shownCard.shown, []); } finally { await shownCard.done(); }
 const withLink = await harness(() => ({ status: 'ok', value: null }), { recapLink: () => true });
 try { assert.match(withLink.controller.recapText()!, /Cyclegauge for Kiro IDE: https:\/\/open-vsx\.org\/extension\/StefanSuess\/cyclegauge$/); } finally { await withLink.done(); }
});

test('dismissal goes through the validated writer and removes the card; a failed write keeps it', async () => {
 let stored: StoredRecap = { status: 'ok', value: null }, succeed = true;
 const h = await harness(() => stored, { recapDismiss: async cycle => { if (!succeed) return false; stored = { status: 'ok', value: { cycle, state: 'dismissed' } }; return true; } });
 try {
  succeed = false; assert.equal(await h.controller.dismissRecap(), false); assert.match(h.html(), /id="recap-card"/);
  succeed = true; assert.equal(await h.controller.dismissRecap(), true);
  assert.ok(!h.html().includes('id="recap-card"')); assert.equal(h.controller.recapText(), null);
  assert.equal(await h.controller.dismissRecap(), false, 'nothing left to dismiss');
 } finally { await h.done(); }
});

test('the CSV export source is the refreshed retained snapshots and nothing else', async () => {
 const h = await harness(() => ({ status: 'ok', value: null }));
 try {
  const snapshots = await h.controller.exportSnapshots();
  assert.equal(snapshots.length, 5);
  assert.deepEqual(snapshots.map(s => s.usage), ['100', '30', '300', '900', '10']);
 } finally { await h.done(); }
});
