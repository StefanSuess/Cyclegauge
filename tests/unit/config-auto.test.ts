import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { evaluateConfigRules, type ConfigFinding, type FindingId } from '../../src/audit/config-rules.ts';
import type { ConfigReview, ConfigReviewRoot } from '../../src/audit/config-review.ts';
import { CONFIG_NOTICE_TEXT, CONFIG_OFFER_KEY, CONFIG_OFFER_TEXT, registerConfigReview } from '../../src/extension/config-review.ts';
import { CONFIG_DEBOUNCE_MS, CONFIG_MAX_AUTO_RUNS, CONFIG_MIN_INTERVAL_MS, CONFIG_REVIEW_DELAY_MS, CONFIG_WATCH_GLOB } from '../../src/extension/config-schedule.ts';
import { reviewTree, type ConfigNode } from '../../src/extension/config-model.ts';

function fakeClock() {
 let t = Date.UTC(2030, 0, 1), seq = 0;
 const queue: { at: number; fn: () => void; id: number }[] = [];
 const flush = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve)); };
 return {
  now: () => t,
  set(fn: () => void, ms: number) { const h = { at: t + ms, fn, id: ++seq }; queue.push(h); return h; },
  clear(h: unknown) { const i = queue.indexOf(h as never); if (i >= 0) queue.splice(i, 1); },
  flush,
  async advance(ms: number) {
   const end = t + ms;
   for (;;) {
    queue.sort((a, b) => a.at - b.at || a.id - b.id);
    const next = queue[0];
    if (!next || next.at > end) break;
    queue.shift(); t = next.at; next.fn(); await flush();
   }
   t = end; await flush();
  },
 };
}
const finding = (id: FindingId, rel = '.kiro/steering/synthetic.md'): ConfigFinding => ({ id, root: 0, rel, severity: 'notice', behaviour: 'documented', threshold: 'heuristic', size: 26_000 });
const review = (ids: FindingId[]): ConfigReview => ({ ...evaluateConfigRules([]), findings: ids.map(id => finding(id, `.kiro/steering/synthetic-${id}.md`)), roots: [{ root: 0, steering: [], hooks: [], nestedNotChecked: 0 }], status: 'complete', bytesRead: 0 });
type Handler = (uri: { scheme: string; fsPath: string }) => void;
function setup(o: { mode?: unknown; workspaceMode?: unknown; supportPrompts?: boolean; offered?: unknown; trusted?: boolean; platform?: NodeJS.Platform; folders?: [string, string][]; support?: { open?: boolean; last?: number } } = {}) {
 const clock = fakeClock();
 const reads: ConfigReviewRoot[][] = [], signals: AbortSignal[] = [], messages: { text: string; items: string[] }[] = [], commands = new Map<string, (...a: unknown[]) => unknown>(), executed: string[] = [];
 const updates: { key: string; value: unknown; target: unknown }[] = [], globalWrites: [string, unknown][] = [], watchers: { pattern: { base: unknown; glob: string }; handlers: Handler[]; disposed: boolean; flags: boolean[] }[] = [];
 const listeners = { config: [] as ((e: { affectsConfiguration(k: string): boolean }) => void)[], folders: [] as (() => void)[], trust: [] as (() => void)[] };
 let ids: FindingId[] = ['S1'], checks = 0, refreshes = 0, gate: ((roots: readonly ConfigReviewRoot[], signal?: AbortSignal) => Promise<ConfigReview>) | undefined;
 let answer: string | undefined = undefined, offerOpen: boolean[] = [];
 const state = { mode: o.mode, workspaceMode: o.workspaceMode, offered: o.offered };
 const folder = (name: string, path: string) => ({ name, index: 0, uri: { scheme: 'file', fsPath: path } });
 const workspace = {
  isTrusted: o.trusted ?? true,
  workspaceFolders: (o.folders ?? [['synthetic-root', '/synthetic/root']]).map(([n, p]) => folder(n, p)),
  getConfiguration: () => ({
   inspect: (key: string) => key === 'configReviewAutomatically' ? { defaultValue: 'off', globalValue: state.mode, workspaceValue: state.workspaceMode } : undefined,
   get: (key: string) => key === 'supportPrompts' ? o.supportPrompts : key === 'configReviewAutomatically' ? state.workspaceMode ?? state.mode : undefined,
   update: async (key: string, value: unknown, target: unknown) => { updates.push({ key, value, target }); },
  }),
  createFileSystemWatcher(pattern: { base: unknown; glob: string }, ...flags: boolean[]) {
   const w = { pattern, handlers: [] as Handler[], disposed: false, flags };
   watchers.push(w);
   const on = (fn: Handler) => { w.handlers.push(fn); return { dispose() {} }; };
   return { onDidCreate: on, onDidChange: on, onDidDelete: on, dispose() { w.disposed = true; } };
  },
  onDidChangeConfiguration: (fn: (e: { affectsConfiguration(k: string): boolean }) => void) => { listeners.config.push(fn); return { dispose() {} }; },
  onDidChangeWorkspaceFolders: (fn: () => void) => { listeners.folders.push(fn); return { dispose() {} }; },
  onDidGrantWorkspaceTrust: (fn: () => void) => { listeners.trust.push(fn); return { dispose() {} }; },
  openTextDocument: async (v: unknown) => v,
 };
 const editor = {
  workspace,
  window: { showInformationMessage: async (text: string, ...items: string[]) => { messages.push({ text, items }); return text === CONFIG_OFFER_TEXT ? answer : undefined; }, showTextDocument: async () => undefined },
  commands: { registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async (id: string) => { executed.push(id); } },
  RelativePattern: class { base: unknown; glob: string; constructor(base: unknown, glob: string) { this.base = base; this.glob = glob; } },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
 } as unknown as typeof vscode;
 const subscriptions: { dispose(): unknown }[] = [];
 const context = { subscriptions,
  globalState: { get: (key: string) => key === CONFIG_OFFER_KEY ? state.offered : undefined, update: async (key: string, value: unknown) => { globalWrites.push([key, value]); if (key === CONFIG_OFFER_KEY) state.offered = value; } },
  workspaceState: { get() { throw Error('audit storage touched'); }, update() { throw Error('audit storage touched'); } } } as unknown as vscode.ExtensionContext;
 const refusedNow = new Set<string>();
 const check = (f: vscode.WorkspaceFolder) => { checks++; return f.uri.fsPath.includes('refused') || refusedNow.has(f.uri.fsPath) ? { reason: 'it overlaps Kiro data' } : { chosen: f.uri.fsPath, resolved: f.uri.fsPath }; };
 const reviewer = { async review(roots: readonly ConfigReviewRoot[], opts?: { signal?: AbortSignal }) { reads.push([...roots]); if (opts?.signal) signals.push(opts.signal); return gate ? gate(roots, opts?.signal) : review(ids); } };
 const support = { promptOpen: () => o.support?.open ?? false, lastPromptAt: () => o.support?.last, offerOpen: (v: boolean) => { offerOpen.push(v); } };
 const link = registerConfigReview(context, editor, check, () => { refreshes++; }, { reviewer, timers: clock, platform: o.platform ?? 'linux', support });
 const live = () => watchers.filter(w => !w.disposed);
 const emit = (rel: string, scheme = 'file', w = live()[0]!) => { for (const h of w.handlers) h({ scheme, fsPath: rel.startsWith('/') ? rel : `${(w.pattern.base as { uri: { fsPath: string } }).uri.fsPath}/${rel}` }); };
 const changeMode = (mode: unknown) => { state.mode = mode; for (const fn of listeners.config) fn({ affectsConfiguration: k => k === 'cyclegauge.configReviewAutomatically' }); };
 const flatten = (nodes: ConfigNode[]): ConfigNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
 return { refusedNow, clock, reads, signals, messages, executed, updates, globalWrites, watchers, live, emit, changeMode, listeners, workspace, link, subscriptions, offerOpen, flatten,
  // The status line the Audit view shows for the review alone (no filename audit result).
  header: () => { const line = reviewTree(undefined, link.summary(), link.nodes(), { audit: 'off', config: 'off' }, new Date(clock.now()))[0]; return line ? `${line.label} ${line.description ?? ''}` : ''; },
  run: () => commands.get('cyclegauge.reviewKiroConfig')!() as Promise<void>,
  set ids(v: FindingId[]) { ids = v; }, set gate(v: typeof gate) { gate = v; }, set answer(v: string | undefined) { answer = v; },
  get checks() { return checks; }, get refreshes() { return refreshes; } };
}
const notices = (s: ReturnType<typeof setup>) => s.messages.filter(m => m.text === CONFIG_NOTICE_TEXT);

test('off (the default), unknown values and workspace-only values create no watcher, resolve no folder and read nothing', async () => {
 for (const o of [{}, { mode: 'off' }, { mode: 'sometimes' }, { workspaceMode: 'onOpenAndChanges' }]) {
  const s = setup(o);
  await s.clock.advance(30 * 60_000);
  assert.equal(s.watchers.length, 0); assert.equal(s.checks, 0); assert.equal(s.reads.length, 0); assert.equal(s.refreshes, 0);
  s.listeners.trust.forEach(fn => fn()); s.listeners.folders.forEach(fn => fn()); await s.clock.advance(30 * 60_000);
  assert.equal(s.reads.length, 0);
 }
});
test('onOpen: one silent run per window after the staggered delay, no watcher, no focus change, not when untrusted', async () => {
 const s = setup({ mode: 'onOpen' });
 assert.equal(s.watchers.length, 0);
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS - 1); assert.equal(s.reads.length, 0);
 await s.clock.advance(1); assert.deepEqual(s.reads, [['/synthetic/root']]);
 assert.match(s.header(), /^Checked \d\d:\d\d · \d+ suggestions? checked automatically/);
 s.ids = ['S1', 'H1', 'H2']; s.changeMode('onOpen'); await s.clock.advance(30 * 60_000);
 assert.equal(s.reads.length, 1, 'once per window'); assert.equal(s.messages.length, 0); assert.deepEqual(s.executed, []);
 const u = setup({ mode: 'onOpen', trusted: false });
 await u.clock.advance(10 * 60_000); assert.equal(u.reads.length, 0); assert.equal(u.checks, 0);
 u.workspace.isTrusted = true; u.listeners.trust.forEach(fn => fn());
 await u.clock.advance(CONFIG_REVIEW_DELAY_MS); assert.equal(u.reads.length, 1, 'trust granted later starts it');
});
test('onOpenAndChanges watches only checked roots with the exact pattern and ignores other shapes without filesystem work', async () => {
 const s = setup({ mode: 'onOpenAndChanges', folders: [['synthetic-a', '/synthetic/a'], ['synthetic-refused', '/synthetic/refused'], ['synthetic-b', '/synthetic/b']] });
 assert.equal(s.watchers.length, 2);
 for (const w of s.watchers) { assert.equal(w.pattern.glob, CONFIG_WATCH_GLOB); assert.deepEqual(w.flags, [false, false, false]); }
 assert.deepEqual(s.watchers.map(w => (w.pattern.base as { name: string }).name), ['synthetic-a', 'synthetic-b']);
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS); assert.equal(s.reads.length, 1);
 const checks = s.checks;
 for (const rel of ['.kiro/steering/sub/synthetic.md', 'synthetic.md', 'agents.md', '.kiro/hooks/synthetic.md', '/synthetic/elsewhere/AGENTS.md', '/synthetic/a/../b/AGENTS.md', '/synthetic/a']) s.emit(rel);
 s.emit('AGENTS.md', 'vscode-remote');
 await s.clock.advance(5 * 60_000);
 assert.equal(s.reads.length, 1); assert.equal(s.checks, checks, 'the event handler resolves no folder');
 for (let i = 0; i < 10_000; i++) s.emit(i % 2 ? '.kiro/steering/synthetic.md' : '.kiro/hooks/synthetic.json');
 await s.clock.advance(CONFIG_DEBOUNCE_MS); assert.equal(s.reads.length, 2, 'a storm gives one run');
 assert.deepEqual(s.reads[1], ['/synthetic/a', '/synthetic/b']);
 const mac = setup({ mode: 'onOpenAndChanges', platform: 'darwin' });
 await mac.clock.advance(CONFIG_REVIEW_DELAY_MS); mac.emit('agents.md'); await mac.clock.advance(CONFIG_MIN_INTERVAL_MS);
 assert.equal(mac.reads.length, 2, 'case-insensitive shape on darwin');
});
test('a rebuild ignores events from disposed watchers; turning the mode off during the debounce reads nothing', async () => {
 const s = setup({ mode: 'onOpenAndChanges' });
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS);
 const old = s.live()[0]!;
 s.changeMode('onOpenAndChanges');
 assert.equal(old.disposed, true); assert.equal(s.live().length, 1);
 s.emit('AGENTS.md', 'file', old); await s.clock.advance(CONFIG_MIN_INTERVAL_MS + CONFIG_DEBOUNCE_MS);
 assert.equal(s.reads.length, 1, 'stale generation ignored');
 s.emit('AGENTS.md'); await s.clock.advance(1_000); s.changeMode('off');
 await s.clock.advance(10 * 60_000); assert.equal(s.reads.length, 1); assert.equal(s.live().length, 0);
});
test('setting off, trust loss or a root change during a run aborts it and discards its result', async () => {
 for (const change of ['off', 'trust', 'roots'] as const) {
  const s = setup({ mode: 'onOpen' });
  let release: (() => void) | undefined;
  s.gate = () => new Promise<ConfigReview>(resolve => { release = () => resolve(review(['S1'])); });
  await s.clock.advance(CONFIG_REVIEW_DELAY_MS); assert.equal(s.reads.length, 1);
  if (change === 'off') s.changeMode('off');
  if (change === 'trust') s.workspace.isTrusted = false;
  if (change === 'roots') { s.workspace.workspaceFolders = [{ name: 'synthetic-other', index: 0, uri: { scheme: 'file', fsPath: '/synthetic/other' } }]; s.listeners.folders.forEach(fn => fn()); }
  if (change !== 'trust') assert.equal(s.signals[0]!.aborted, true);
  release!(); await s.clock.flush();
  assert.equal(s.refreshes, 0, change); assert.equal(s.messages.length, 0);
 }
});
test('a manual run wins over an automatic run, does not count toward the cap and works after the pause', async () => {
 const s = setup({ mode: 'onOpenAndChanges' });
 let release: (() => void) | undefined;
 s.gate = (_r, signal) => new Promise<ConfigReview>(resolve => { release = () => resolve(review(['S1'])); signal?.addEventListener('abort', () => resolve(review(['S1']))); });
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS); assert.equal(s.reads.length, 1);
 s.gate = undefined;
 await s.run();
 assert.equal(s.signals[0]!.aborted, true); assert.equal(s.reads.length, 2); assert.equal(s.refreshes, 1, 'only the manual result is shown');
 assert.doesNotMatch(s.header(), /automatically/); assert.ok(s.executed.includes('cyclegauge.auditView.focus'));
 void release;
 for (let i = 0; i < 30; i++) { s.emit('AGENTS.md'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS); }
 assert.equal(s.reads.length, 2 + CONFIG_MAX_AUTO_RUNS - 1, 'the aborted open run counted; the manual run did not');
 assert.match(s.header(), /automatic review paused \(many changes\)/);
 s.emit('AGENTS.md'); await s.clock.advance(10 * 60_000); assert.equal(s.reads.length, 2 + CONFIG_MAX_AUTO_RUNS - 1);
 await s.run(); assert.equal(s.reads.length, 2 + CONFIG_MAX_AUTO_RUNS, 'manual runs keep working after the cap');
});
test('notices: the first automatic run is silent; a new class later gives one fixed message; repeats are silent', async () => {
 const s = setup({ mode: 'onOpenAndChanges' });
 s.ids = ['S1', 'H1'];
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS); assert.equal(notices(s).length, 0);
 s.ids = ['S1', 'H1', 'H3']; s.emit('AGENTS.md'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS); assert.equal(notices(s).length, 0, 'H3 never notifies');
 s.ids = ['S1', 'H1', 'H2']; s.emit('.kiro/hooks/synthetic.json'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS);
 assert.deepEqual(notices(s), [{ text: CONFIG_NOTICE_TEXT, items: ['Show'] }]);
 assert.match(JSON.stringify(s.flatten(s.link.nodes())), /new this session/);
 s.emit('.kiro/hooks/synthetic.json'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS); assert.equal(notices(s).length, 1);
 s.ids = ['S2']; s.emit('AGENTS.md'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS); assert.equal(notices(s).length, 2);
 s.ids = ['S1']; s.emit('AGENTS.md'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS); assert.equal(notices(s).length, 2, 'a returning class stays silent');
 for (const m of notices(s)) assert.doesNotMatch(m.text, /\d|synthetic|\.kiro|AGENTS/);
 assert.deepEqual(s.executed, [], 'no focus change without a click');
});
test('the enable offer appears once after a manual run, writes only the approved key and the global setting', async () => {
 const s = setup();
 s.answer = 'Turn on';
 await s.run(); await s.clock.flush();
 assert.deepEqual(s.messages.filter(m => m.text === CONFIG_OFFER_TEXT), [{ text: CONFIG_OFFER_TEXT, items: ['Turn on', 'Not now'] }]);
 assert.deepEqual(s.globalWrites, [[CONFIG_OFFER_KEY, true]]);
 assert.deepEqual(s.updates, [{ key: 'configReviewAutomatically', value: 'onOpenAndChanges', target: 1 }]);
 assert.deepEqual(s.offerOpen, [true, false]);
 await s.run(); await s.clock.flush();
 assert.equal(s.messages.filter(m => m.text === CONFIG_OFFER_TEXT).length, 1, 'once ever');
 const n = setup({ workspaceMode: 'off' }); n.answer = 'Not now';
 await n.run(); await n.clock.flush();
 assert.equal(n.messages.length, 1, 'a workspace value does not suppress the offer'); assert.deepEqual(n.globalWrites, [[CONFIG_OFFER_KEY, true]]); assert.deepEqual(n.updates, []);
 for (const o of [{ supportPrompts: false }, { mode: 'off' }, { offered: 'unknown-shape' }, { support: { open: true } }, { support: { last: Date.UTC(2030, 0, 1) - 30_000 } }, { trusted: false }]) {
  const x = setup(o); await x.run(); await x.clock.flush();
  assert.equal(x.messages.filter(m => m.text === CONFIG_OFFER_TEXT).length, 0, JSON.stringify(o)); assert.deepEqual(x.globalWrites, []); assert.deepEqual(x.updates, []);
 }
 const a = setup({ mode: 'onOpen' });
 await a.clock.advance(CONFIG_REVIEW_DELAY_MS); assert.equal(a.messages.length, 0, 'never after an automatic run');
});
test('automatic runs never touch audit or support state: no workspace state, no other global key, no audit command', async () => {
 const s = setup({ mode: 'onOpenAndChanges' });
 s.ids = ['S1', 'S2', 'H1'];
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS);
 s.ids = ['H5']; s.emit('AGENTS.md'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS);
 assert.deepEqual(s.globalWrites, []); assert.deepEqual(s.updates, []);
 assert.ok(s.executed.every(id => id === 'cyclegauge.auditView.focus'));
 const w = s.live()[0]!;
 for (const d of s.subscriptions) d.dispose();
 assert.equal(w.disposed, true);
 s.emit('AGENTS.md', 'file', w); await s.clock.advance(10 * 60_000); assert.equal(s.reads.length, 2, 'nothing runs after disposal');
});
test('a manual run clears dirty flags; a root refused at fire time is never read and the watchers are rebuilt', async () => {
 const s = setup({ mode: 'onOpenAndChanges', folders: [['synthetic-a', '/synthetic/a'], ['synthetic-b', '/synthetic/b']] });
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS); assert.equal(s.reads.length, 1);
 s.emit('AGENTS.md'); await s.run(); assert.equal(s.reads.length, 2);
 await s.clock.advance(10 * 60_000); assert.equal(s.reads.length, 2, 'the manual run covered the change');
 s.refusedNow.add('/synthetic/b'); const before = s.watchers.length;
 s.emit('AGENTS.md'); await s.clock.advance(CONFIG_DEBOUNCE_MS);
 assert.equal(s.reads.length, 2, 'nothing is read when a guard answer changed');
 assert.equal(s.live().length, 1); assert.ok(s.watchers.length > before, 'watchers rebuilt for the roots that pass');
 s.emit('AGENTS.md'); await s.clock.advance(CONFIG_MIN_INTERVAL_MS);
 assert.deepEqual(s.reads.at(-1), ['/synthetic/a']); assert.ok(s.reads.every(r => !r.includes('/synthetic/b') || s.reads.indexOf(r) < 2));
});
test('a discarded open run does not use up the window open run', async () => {
 const s = setup({ mode: 'onOpen' });
 let release: (() => void) | undefined;
 s.gate = () => new Promise<ConfigReview>(resolve => { release = () => resolve(review(['S1'])); });
 await s.clock.advance(CONFIG_REVIEW_DELAY_MS); s.changeMode('off'); release!(); await s.clock.flush();
 s.gate = undefined; s.changeMode('onOpen'); await s.clock.advance(CONFIG_REVIEW_DELAY_MS);
 assert.equal(s.reads.length, 2); assert.equal(s.refreshes, 1);
});
