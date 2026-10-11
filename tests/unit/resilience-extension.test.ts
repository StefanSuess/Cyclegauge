import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startExtension } from '../../src/extension/controller.ts';

// Milestone 6 Task 8, extension side: missing or unreliable watchers, polling fallback, refresh
// storms, disposal while collecting, and a source that appears late. Synthetic data only; skipped
// on Windows while storage there stays refused.
const cleanups: (() => Promise<void> | void)[] = [];
const test = (name: string, fn: () => Promise<void>) => baseTest(name, { skip: process.platform === 'win32', timeout: 60_000 }, async () => {
 try { await fn(); } finally { for (const c of cleanups.splice(0).reverse()) { try { await c(); } catch { /* best effort */ } } }
});
/** Waits for a condition driven by the code under test, so a missing trigger fails instead of passing vacuously. */
async function until(condition: () => boolean, ms = 5000) {
 for (const end = Date.now() + ms; !condition() && Date.now() < end;) await new Promise(r => setTimeout(r, 10));
 assert.ok(condition(), 'condition not reached in time');
}
const entry = (minute: string, usage: string) => '2026-10-10 10:' + minute + ':00.000 [info] synthetic-envelope ' + JSON.stringify({
 commandName: 'GetUsageLimitsCommand', output: { userInfo: { userId: 'synthetic-account' }, nextDateReset: '2026-11-01T00:00:00.000Z',
  usageBreakdownList: [{ resourceType: 'CREDIT', currentUsageWithPrecision: Number(usage), usageLimitWithPrecision: 50 }] },
 metadata: { httpStatusCode: 200 } }) + '\n';
async function fixture() {
 const base = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-easykiro-resilience-')));
 const root = join(base, 'Kiro');
 const dir = join(root, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent');
 cleanups.push(() => rm(base, { recursive: true, force: true }));
 return { base, root, dir, log: join(dir, 'q-client.log'), storage: join(base, 'owned') };
}
const NOW = () => '2026-10-10T10:30:00.000Z';
interface Seen { text: string; html: string; calls: number }
function recorder(extra: Record<string, unknown> = {}) {
 const seen: Seen = { text: '', html: '', calls: 0 };
 let poll: (() => void) | undefined, change: (() => void) | undefined, disposed = 0;
 const ui = {
  setStatus(text: string, html: string) { seen.text = text; seen.html = html; seen.calls++; },
  showDetails(_html: string) {}, onClick(_fn: () => void) {},
  onChange(fn: () => void) { change = fn; }, everyMinute(fn: () => void) { poll = fn; },
  dispose() { disposed++; }, ...extra,
 };
 return { ui, seen, poll: () => poll, change: () => change, disposed: () => disposed };
}

test('polling alone picks up new observations when no watcher event ever arrives', async () => {
 const f = await fixture(); await mkdir(f.dir, { recursive: true }); await writeFile(f.log, entry('00', '4.35'));
 const r = recorder();
 const ext = await startExtension(r.ui, { source: f.root, storage: f.storage, timezone: 'UTC', now: NOW });
 assert.match(r.seen.html, /45\.65/);
 cleanups.push(() => ext.dispose());
 const before = r.seen.calls;
 await appendFile(f.log, entry('20', '5.25'));
 r.poll()!();
 await until(() => r.seen.calls > before);
 assert.match(r.seen.html, /44\.75/);
});

test('a watcher that throws on registration does not prevent activation or polling', async () => {
 const f = await fixture(); await mkdir(f.dir, { recursive: true }); await writeFile(f.log, entry('00', '4.35'));
 const r = recorder({ onChange() { throw new Error('SYNTHETIC_WATCHER_FAILURE_PRIVATE_PATH'); } });
 const ext = await startExtension(r.ui, { source: f.root, storage: f.storage, timezone: 'UTC', now: NOW });
 assert.match(r.seen.html, /45\.65/);
 assert.ok(!r.seen.html.includes('SYNTHETIC_WATCHER_FAILURE'));
 cleanups.push(() => ext.dispose());
 const before = r.seen.calls;
 await appendFile(f.log, entry('20', '6.25'));
 r.poll()!();
 await until(() => r.seen.calls > before);
 assert.match(r.seen.html, /43\.75/);
});

test('a storm of change events coalesces and leaves one consistent history', async () => {
 const f = await fixture(); await mkdir(f.dir, { recursive: true }); await writeFile(f.log, entry('00', '4.35'));
 const r = recorder();
 const ext = await startExtension(r.ui, { source: f.root, storage: f.storage, timezone: 'UTC', now: NOW });
 const before = r.seen.calls;
 await appendFile(f.log, entry('10', '4.65'));
 for (let i = 0; i < 60; i++) r.change()!();
 await ext.refresh();
 assert.match(r.seen.html, /45\.35/);
 assert.ok(r.seen.calls - before <= 3, `60 events caused ${r.seen.calls - before} renders`);
 cleanups.push(() => ext.dispose());
});

test('disposal while a refresh is running neither throws nor updates the closed UI', async () => {
 const f = await fixture(); await mkdir(f.dir, { recursive: true }); await writeFile(f.log, entry('00', '4.35'));
 const r = recorder();
 const ext = await startExtension(r.ui, { source: f.root, storage: f.storage, timezone: 'UTC', now: NOW });
 await appendFile(f.log, entry('10', '4.60'));
 const calls = r.seen.calls;
 const running = ext.refresh();
 ext.dispose();
 await assert.doesNotReject(running);
 assert.equal(r.seen.calls, calls, 'no status update after disposal');
 assert.equal(r.disposed(), 1);
});


test('a source that does not exist yet shows the waiting state and recovers on the next poll', async () => {
 const f = await fixture();
 const r = recorder();
 const ext = await startExtension(r.ui, { source: f.root, storage: f.storage, timezone: 'UTC', now: NOW });
 assert.ok(!/45\.65/.test(r.seen.html));
 assert.match(r.seen.html, /Waiting for usable local account updates|unavailable/i);
 cleanups.push(() => ext.dispose());
 const before = r.seen.calls;
 await mkdir(f.dir, { recursive: true }); await writeFile(f.log, entry('00', '4.35'));
 r.poll()!();
 await until(() => r.seen.calls > before);
 assert.match(r.seen.html, /45\.65/);
});
