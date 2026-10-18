import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG_DEBOUNCE_MS, CONFIG_MAX_AUTO_RUNS, CONFIG_MAX_WAIT_MS, CONFIG_MIN_INTERVAL_MS, CONFIG_REVIEW_DELAY_MS, CONFIG_WATCH_GLOB, createConfigScheduler, createNoticeState, noticeDecision, offerDue, readConfigReviewMode, watchShape, type RunOutcome, type RunTrigger } from '../../src/extension/config-schedule.ts';

// A fake clock with ordered timers; `advance` runs due timers and lets their promises settle.
function fakeClock() {
 let t = 0, seq = 0;
 const queue: { at: number; fn: () => void; id: number }[] = [];
 const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
 return {
  now: () => t,
  set(fn: () => void, ms: number) { const h = { at: t + ms, fn, id: ++seq }; queue.push(h); return h; },
  clear(h: unknown) { const i = queue.indexOf(h as never); if (i >= 0) queue.splice(i, 1); },
  pending: () => queue.length,
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
function harness(outcome: (trigger: RunTrigger) => RunOutcome | Promise<RunOutcome> = () => 'ran') {
 const clock = fakeClock(), runs: { trigger: RunTrigger; at: number }[] = [];
 let paused = 0;
 const s = createConfigScheduler({ now: clock.now, setTimer: clock.set, clearTimer: clock.clear, run: async trigger => { runs.push({ trigger, at: clock.now() }); return outcome(trigger); }, onPause: () => { paused++; } });
 return { clock, runs, s, get paused() { return paused; } };
}

test('the setting counts only as the user global value; unknown, malformed and workspace values are off', () => {
 assert.equal(readConfigReviewMode(undefined), 'off');
 for (const globalValue of [undefined, 'off', 'manual', true, 1, 'ONOPEN', null, {}]) assert.equal(readConfigReviewMode({ globalValue }), 'off');
 assert.equal(readConfigReviewMode({ globalValue: 'onOpen' }), 'onOpen');
 assert.equal(readConfigReviewMode({ globalValue: 'onOpenAndChanges' }), 'onOpenAndChanges');
 assert.equal(readConfigReviewMode({ workspaceValue: 'onOpenAndChanges' } as never), 'off');
 assert.equal(CONFIG_WATCH_GLOB, '{AGENTS.md,.kiro/steering/*.md,.kiro/hooks/*.json}');
});
test('watcher paths must have exactly one allowlisted shape; case-insensitive only where asked', () => {
 for (const rel of ['AGENTS.md', '.kiro/steering/synthetic.md', '.kiro/hooks/synthetic.json']) { assert.equal(watchShape(rel, false), true, rel); assert.equal(watchShape(rel, true), true, rel); }
 for (const rel of ['', 'agents.md.bak', 'sub/AGENTS.md', '.kiro/steering/sub/x.md', '.kiro/steering/x.json', '.kiro/hooks/x.md', '.kiro/x.md', '../AGENTS.md', '.kiro/steering/.md', '.kiro/hooks/.json', '.kiro/steering/..', '.kiro\\steering\\x.md', 'x/.kiro/steering/a.md', '.kiro/settings/x.json'])
  { assert.equal(watchShape(rel, false), false, rel); assert.equal(watchShape(rel, true), false, rel); }
 for (const rel of ['agents.md', '.KIRO/Steering/X.MD', '.kiro/HOOKS/x.JSON']) { assert.equal(watchShape(rel, true), true, rel); assert.equal(watchShape(rel, false), false, rel); }
});
test('the open run fires once after its staggered delay', async () => {
 const h = harness();
 h.s.open();
 await h.clock.advance(CONFIG_REVIEW_DELAY_MS - 1); assert.equal(h.runs.length, 0);
 await h.clock.advance(1); assert.deepEqual(h.runs, [{ trigger: 'open', at: CONFIG_REVIEW_DELAY_MS }]);
 await h.clock.advance(10 * 60_000); assert.equal(h.runs.length, 1);
 assert.equal(CONFIG_REVIEW_DELAY_MS, 45_000);
});
test('an event storm gives one run after the debounce; a continuous stream is forced at 60 s', async () => {
 const h = harness();
 for (let i = 0; i < 10_000; i++) h.s.event();
 assert.equal(h.clock.pending(), 1);
 await h.clock.advance(CONFIG_DEBOUNCE_MS - 1); assert.equal(h.runs.length, 0);
 await h.clock.advance(1); assert.deepEqual(h.runs.map(r => r.trigger), ['watch']);
 const g = harness();
 for (let i = 0; i < 70; i++) { g.s.event(); await g.clock.advance(1_000); }
 assert.equal(g.runs[0]!.at, CONFIG_MAX_WAIT_MS);
});
test('a trigger during a run yields exactly one follow-up, after the minimum interval', async () => {
 let release: (() => void) | undefined;
 const h = harness(() => new Promise<RunOutcome>(resolve => { release = () => resolve('ran'); }));
 h.s.event(); await h.clock.advance(CONFIG_DEBOUNCE_MS); assert.equal(h.runs.length, 1);
 for (let i = 0; i < 50; i++) h.s.event();
 await h.clock.advance(20_000); assert.equal(h.runs.length, 1, 'never alongside a running review');
 release!(); await h.clock.flush();
 const ended = h.clock.now();
 await h.clock.advance(CONFIG_MIN_INTERVAL_MS - 1); assert.equal(h.runs.length, 1);
 await h.clock.advance(1); assert.equal(h.runs.length, 2); assert.equal(h.runs[1]!.at, ended + CONFIG_MIN_INTERVAL_MS);
 release!(); await h.clock.advance(5 * 60_000); assert.equal(h.runs.length, 2);
});
test('twenty counted runs pause the window; skipped runs do not count; deferred runs retry', async () => {
 let next: RunOutcome = 'skipped';
 const h = harness(() => next);
 h.s.event(); await h.clock.advance(CONFIG_DEBOUNCE_MS); assert.equal(h.s.runs, 0);
 next = 'deferred'; h.s.event(); await h.clock.advance(CONFIG_DEBOUNCE_MS); assert.equal(h.runs.length, 2);
 next = 'ran'; await h.clock.advance(CONFIG_DEBOUNCE_MS); assert.equal(h.runs.length, 3); assert.equal(h.s.runs, 1);
 for (let i = 0; i < 40; i++) { h.s.event(); await h.clock.advance(CONFIG_MIN_INTERVAL_MS); }
 assert.equal(h.s.runs, CONFIG_MAX_AUTO_RUNS); assert.equal(h.s.paused, true); assert.equal(h.paused, 1);
 const before = h.runs.length; h.s.event(); h.s.open(); await h.clock.advance(10 * 60_000); assert.equal(h.runs.length, before);
});
test('cancel forgets pending open and watch triggers', async () => {
 const h = harness();
 h.s.open(); h.s.event(); h.s.cancel();
 await h.clock.advance(10 * 60_000); assert.equal(h.runs.length, 0); assert.equal(h.clock.pending(), 0);
 h.s.dispose(); h.s.event(); await h.clock.advance(10 * 60_000); assert.equal(h.runs.length, 0);
});
test('notices: seeding, manual runs, new classes, H3, limits and held-back classes', () => {
 const s = createNoticeState();
 assert.equal(noticeDecision(s, ['S1'], 'manual', 0), false); assert.deepEqual([...s.seen], ['S1']); assert.equal(s.seeded, false);
 assert.equal(noticeDecision(s, ['S2', 'H1'], 'watch', 1_000), false, 'the first automatic run only seeds'); assert.equal(s.seeded, true);
 assert.equal(noticeDecision(s, ['S1', 'S2', 'H1'], 'watch', 2_000), false);
 assert.equal(noticeDecision(s, ['H3'], 'watch', 3_000), false, 'H3 is information');
 assert.equal(noticeDecision(s, ['H2', 'H2'], 'watch', 4_000), true); assert.equal(s.notices, 1);
 assert.equal(noticeDecision(s, ['H4'], 'watch', 4_000 + 59_999), false, 'held back by the 60 s spacing'); assert.ok(!s.seen.has('H4'));
 assert.equal(noticeDecision(s, ['H4'], 'watch', 4_000 + 60_000), true, 'announced later');
 assert.equal(noticeDecision(s, ['H5'], 'open', 500_000), false, 'open runs never notify'); assert.ok(s.seen.has('H5'));
 assert.equal(noticeDecision(s, ['S3'], 'watch', 600_000), true); assert.equal(s.notices, 3);
 assert.equal(noticeDecision(s, ['S4'], 'watch', 900_000), false, 'at most three per window'); assert.ok(!s.seen.has('S4'));
 assert.equal(noticeDecision(s, [], 'watch', 1_000_000), false);
 assert.equal(noticeDecision(s, ['S1'], 'watch', 1_000_000), false, 'a class that disappears and returns stays silent');
});
test('the enable offer: support prompts, any global value, the stored mark and support timing', () => {
 const base = { supportPrompts: true, globalValue: undefined, offered: undefined, supportOpen: false, now: 100_000 };
 assert.equal(offerDue(base), true);
 assert.equal(offerDue({ ...base, supportPrompts: false }), false);
 for (const globalValue of ['off', 'onOpen', 'malformed', false]) assert.equal(offerDue({ ...base, globalValue }), false);
 for (const offered of [true, false, 'unknown-shape', 0]) assert.equal(offerDue({ ...base, offered }), false);
 assert.equal(offerDue({ ...base, supportOpen: true }), false);
 assert.equal(offerDue({ ...base, lastSupportAt: 100_000 - 59_999 }), false);
 assert.equal(offerDue({ ...base, lastSupportAt: 100_000 - 60_000 }), true);
});
