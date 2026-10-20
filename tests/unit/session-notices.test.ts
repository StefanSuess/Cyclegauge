import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LONG_SESSION_PERCENT, MAX_PER_SESSION, budgetTightFrom, MIN_GAP_MS, clock, contextText, evaluate, hintText, newHintState, type Observation } from '../../src/session/notices.ts';
import { modelHint, type ModelRow } from '../../src/session/models.ts';

const T0 = Date.parse('2026-10-18T09:00:00Z');
const GAP = MIN_GAP_MS + 60_000;
const table: ModelRow[] = [{ id: 'synthetic-model-x', name: 'Synthetic X', multiplier: '2.0', basis: 'observed' }, { id: 'synthetic-model-pattern', name: 'Synthetic P', multiplier: '1.5', basis: 'pattern' }];
// tick i happens i * 31 minutes after the start of the run and observes an event one minute old
const at = (i: number) => T0 + 120_000 + i * GAP;
const seen = (state: ReturnType<typeof newHintState>, i: number, percent: number | undefined, model: string | null = null, key = 'synthetic-session-a', asOf = at(i) - 60_000) =>
 evaluate(state, { key, modelId: model, sessionAsOf: asOf, context: percent === undefined ? undefined : { percent, asOf } }, at(i), T0, table);

test('thresholds fire once per crossing: 69 silent, 70 fires, 71 silent, 85 fires', () => {
 const s = newHintState();
 const kinds = [69, 70, 71, 72, 85, 90].map((v, i) => { const n = seen(s, i, v); return n?.kind === 'context' ? n.threshold : undefined; });
 assert.deepEqual(kinds, [undefined, 70, undefined, undefined, 85, undefined]);
 assert.equal([10, 20].filter((v, i) => seen(newHintState(), i, v)).length, 0);
});

test('a first value above both thresholds fires only the higher one, and the lower stays spent', () => {
 const s = newHintState();
 const n = seen(s, 0, 90); assert.ok(n && n.kind === 'context' && n.threshold === 85);
 assert.equal(seen(s, 1, 91), undefined); assert.equal(seen(s, 2, 71), undefined); // 85 re-armed (below 75) but 70 is spent
});

test('hysteresis: re-armed only below the threshold minus ten points', () => {
 const s = newHintState();
 assert.ok(seen(s, 0, 72)); // 70
 assert.equal(seen(s, 1, 62), undefined); assert.equal(seen(s, 2, 71), undefined); // 62 is not below 60: still spent
 assert.equal(seen(s, 3, 59), undefined); // re-armed here
 assert.equal((seen(s, 4, 70) as { threshold: number }).threshold, 70);
 // invented compaction drop 80 to 12, then again 72
 const c = newHintState(); assert.equal((seen(c, 0, 80) as { threshold: number }).threshold, 70); assert.equal(seen(c, 1, 12), undefined);
 assert.equal((seen(c, 2, 72) as { threshold: number }).threshold, 70);
 // invented model-switch drop 16 to 3.5 changes nothing; the jump up at a switch (3.7 to 18.7) stays below the thresholds
 const m = newHintState(); assert.equal(seen(m, 0, 16), undefined); assert.equal(seen(m, 1, 3.5), undefined); assert.equal(seen(m, 2, 18.7), undefined);
 // a switch to a smaller window can cross a threshold without growth in the conversation: it fires like any crossing
 assert.equal((seen(m, 3, 88) as { threshold: number }).threshold, 85);
 assert.equal(seen(m, 4, 76), undefined); assert.equal(seen(m, 5, 74), undefined); assert.equal((seen(m, 6, 86) as { threshold: number }).threshold, 85);
});

test('a restart resets the state (a new state fires again)', () => {
 const a = newHintState(); assert.ok(seen(a, 0, 75)); assert.equal(seen(a, 1, 75), undefined);
 assert.ok(seen(newHintState(), 1, 75));
});

test('stale or pre-start observations are silent, but still update the hysteresis', () => {
 const s = newHintState();
 const oldAsOf = at(0) - 11 * 60_000;
 assert.equal(seen(s, 0, 80, null, 'synthetic-session-a', oldAsOf), undefined); // older than about ten minutes
 assert.equal(seen(s, 0, 80, null, 'synthetic-session-a', T0 - 1), undefined); // before the extension started
 assert.equal(seen(s, 0, 80, null, 'synthetic-session-a', T0), undefined); // not after it
 assert.equal(seen(s, 0, 80, null, 'synthetic-session-a', at(0) + 6 * 60_000), undefined); // future
 assert.ok(seen(s, 0, 80, null, 'synthetic-session-a', at(0) - 90_000)); // fresh and after the start: fine
 // the model hint is gated by the session time in the same way
 assert.equal(evaluate(newHintState(), { key: 'k', modelId: 'synthetic-model-x', sessionAsOf: at(0) - 11 * 60_000 }, at(0), T0, table, true), undefined);
 assert.equal(evaluate(newHintState(), { key: 'k', modelId: 'synthetic-model-x', sessionAsOf: T0 - 1 }, at(0), T0, table, true), undefined);
});

test('only one notice per tick: the context threshold wins, the model hint follows later', () => {
 const s = newHintState();
 const first = seen(s, 0, 88, 'synthetic-model-x'); assert.equal(first?.kind, 'context');
 assert.equal(seen(s, 0, 88, 'synthetic-model-x'), undefined); // rate limit: same instant
 const later = seen(s, 1, 88, 'synthetic-model-x'); assert.equal(later?.kind, 'model');
 assert.equal(seen(s, 2, 88, 'synthetic-model-x'), undefined); // once per model per session and run
});

test('rate limits: one notice per session per 30 minutes and three per run; sessions are independent', () => {
 const s = newHintState();
 assert.ok(seen(s, 0, 72, null, 'synthetic-session-a'));
 const soon = evaluate(s, { key: 'synthetic-session-a', modelId: null, sessionAsOf: at(0), context: { percent: 90, asOf: at(0) } }, at(0) + MIN_GAP_MS - 1, T0, table);
 assert.equal(soon, undefined); // within 30 minutes: held back (still armed)
 const after = evaluate(s, { key: 'synthetic-session-a', modelId: null, sessionAsOf: at(0) + MIN_GAP_MS, context: { percent: 90, asOf: at(0) + MIN_GAP_MS } }, at(0) + MIN_GAP_MS, T0, table);
 assert.equal((after as { threshold: number }).threshold, 85);
 assert.ok(seen(s, 0, 72, null, 'synthetic-session-b')); // another session is not limited by the first
 // three per run
 const r = newHintState(); const fired: number[] = [];
 for (let i = 0; i < 8; i++) { if (seen(r, i * 2, 80)) fired.push(i); seen(r, i * 2 + 1, 10); }
 assert.equal(fired.length, MAX_PER_SESSION);
});

test('model hint: once per model per run, across sessions; Auto, unlisted and rows at or below 1.0 are silent; pattern rows may hint', () => {
 const s = newHintState(), long = LONG_SESSION_PERCENT + 5; // a long session gives the reason here
 for (const [i, id] of ['auto', 'synthetic-unlisted', null].entries()) assert.equal(seen(s, i, long, id), undefined, String(id));
 assert.equal(seen(s, 3, long, 'synthetic-model-pattern')?.kind, 'model');
 assert.equal(seen(s, 4, long, 'synthetic-model-pattern'), undefined);
 assert.equal(seen(s, 5, long, 'synthetic-model-x')?.kind, 'model'); // a switch to another listed model, after the gap
 assert.equal(seen(s, 6, long, 'synthetic-model-x', 'synthetic-session-b'), undefined); // the same model in another session: not again in this run
 assert.equal(seen(s, 7, long, 'synthetic-model-pattern', 'synthetic-session-b'), undefined);
});

test('model hint needs a reason: a tight budget or a session at least 30 % full; otherwise silent and not spent', () => {
 const o = (percent?: number) => ({ key: 'synthetic-session-a', modelId: 'synthetic-model-x', sessionAsOf: at(0) - 60_000, context: percent === undefined ? undefined : { percent, asOf: at(0) - 60_000 } });
 const s = newHintState();
 assert.equal(evaluate(s, o(), at(0), T0, table, false), undefined); // no context, budget on track
 assert.equal(evaluate(s, o(LONG_SESSION_PERCENT - 1), at(0), T0, table, false), undefined); // short session
 const long = evaluate(s, o(LONG_SESSION_PERCENT), at(0), T0, table, false); // the model was not spent by the silent ticks
 assert.ok(long && long.kind === 'model' && long.text.startsWith('Your most recent Kiro session in this workspace is getting long and uses Synthetic X'));
 const tight = evaluate(newHintState(), o(), at(0), T0, table, true);
 assert.ok(tight && tight.kind === 'model' && tight.text.startsWith('Your Kiro credit budget is tight, and your most recent session in this workspace uses Synthetic X'));
 // Auto and unlisted models stay silent even with a reason
 assert.equal(evaluate(newHintState(), { ...o(90), modelId: 'auto' }, at(0), T0, table, true)?.kind, 'context');
 assert.equal(evaluate(newHintState(), { ...o(), modelId: 'auto' }, at(0), T0, table, true), undefined);
});

test('wording: fixed texts with the rounded percentage, local time, table name and date; never the raw identifier', () => {
 const asOf = Date.parse('2026-10-18T10:15:00Z'), hm = clock(asOf);
 assert.match(hm, /^\d\d:\d\d$/);
 assert.equal(contextText(70, 71.6, asOf), `Your most recent Kiro session in this workspace was about 72% full as of ${hm}. Kiro may compact it soon; consider starting a new session for unrelated work.`);
 assert.equal(contextText(85, 100, asOf), `Your most recent Kiro session in this workspace was about 100% full as of ${hm}, close to its limit.`);
 const now = Date.parse('2026-10-20T00:00:00Z');
 assert.equal(hintText(modelHint('claude-sonnet-4.5', now)!, asOf, 'long'), `Your most recent Kiro session in this workspace is getting long and uses Claude Sonnet 4.5 (as of ${hm}), which Kiro lists at about 1.3x the credits of Auto (Kiro model table, as of 2026-10-18). For routine steps, Auto or a lighter model uses fewer credits; actual credits per task vary.`);
 assert.equal(hintText(modelHint('claude-sonnet-4.5', now)!, asOf, 'budget'), `Your Kiro credit budget is tight, and your most recent session in this workspace uses Claude Sonnet 4.5 (as of ${hm}), which Kiro lists at about 1.3x the credits of Auto (Kiro model table, as of 2026-10-18). For routine steps, Auto or a lighter model uses fewer credits; actual credits per task vary.`);
 const luna = hintText(modelHint('gpt-5.6-sol', now)!, asOf, 'long'); assert.match(luna, /which Kiro lists from about 4\.4x the credits of Auto \(Kiro model table, as of 2026-10-18\)/);
 const x = hintText(modelHint('synthetic-model-x', now, table)!, asOf, 'budget'); assert.match(x, /about 2x the credits of Auto/); assert.ok(!x.includes('synthetic-model-x'));
 const stale = hintText(modelHint('claude-sonnet-4.5', Date.parse('2027-02-01T00:00:00Z'))!, asOf, 'long');
 assert.match(stale, /check Kiro's current model table; last retrieved 2026-10-18/); assert.ok(!/\d(\.\d)?x/.test(stale));
 for (const t of [contextText(70, 71.6, asOf), x, stale]) assert.ok(!/synthetic-session|\/Users|sentinel/.test(t));
 assert.ok(MIN_GAP_MS === 1_800_000);
});

test('the budget reason is the gauge warning or limit state only, and budget wins over a long session', async () => {
 assert.deepEqual(['none', 'warning', 'error', undefined, 'other'].map(budgetTightFrom), [false, true, true, false, false]);
 const code = await (await import('node:fs/promises')).readFile(new URL('../../src/extension/extension.ts', import.meta.url), 'utf8');
 assert.ok(code.includes('budgetTight = budgetTightFrom(meta?.severity);') && code.includes('() => support?.pause(), () => budgetTight)'));
 const both = evaluate(newHintState(), { key: 'k', modelId: 'synthetic-model-x', sessionAsOf: at(0) - 60_000, context: { percent: 50, asOf: at(0) - 60_000 } }, at(0), T0, table, true);
 assert.ok(both && both.kind === 'model' && both.text.startsWith('Your Kiro credit budget is tight'));
});
