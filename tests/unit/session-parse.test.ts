import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, contextPercent, normalizePath, notFuture, projectSession, scanContext, strictIso, workspaceMatches } from '../../src/session/parse.ts';
import { MODELS, modelHint, multiplierText, type ModelRow } from '../../src/session/models.ts';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const enc = (s: string) => new TextEncoder().encode(s);
const line = (ts: string, pct: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ timestamp: ts, payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: pct }, ...extra } }) + '\n';
const scan = (text: string, now = NOW, decode?: (b: Uint8Array) => string) => scanContext(enc(text), now, decode);

test('strict timestamps need a numeric offset or Z and a real date', () => {
 assert.equal(strictIso('2026-10-18T12:00:00Z'), NOW);
 assert.equal(strictIso('2026-10-18T14:00:00+02:00'), NOW);
 assert.equal(strictIso('2026-10-18T14:00:00+0200'), NOW);
 assert.equal(strictIso('2026-10-18T07:00:00-05:00'), NOW);
 assert.equal(strictIso('2026-10-18T12:00:00.123456789Z'), NOW + 123);
 assert.equal(strictIso('2026-10-18T12:00:00.5Z'), NOW + 500);
 for (const bad of ['2026-10-18T12:00:00', '2026-10-18 12:00:00Z', 'Oct 18 2026', '2026-10-18', '2026-02-30T12:00:00Z', '2026-13-01T12:00:00Z', '2026-10-18T24:00:00Z', '2026-10-18T12:60:00Z',
  '2026-10-18T12:00:00+24:00', '2026-10-18T12:00:00+01:60', '', 'x'.repeat(100), 12, null, {}, undefined]) assert.equal(strictIso(bad), undefined, String(bad));
 assert.equal(notFuture(NOW + 299_000, NOW), true); assert.equal(notFuture(NOW + 301_000, NOW), false);
});

test('session projection keeps only the allowlisted fields and checks versions and shapes', () => {
 const ok = { schemaVersion: '1.0.0', dataModelVersion: 1, modelId: 'claude-sonnet-4.5', lastModifiedAt: '2026-10-18T12:00:00Z', workspacePaths: ['/synthetic/one'], title: 'synthetic-title-sentinel', rootPaths: ['synthetic-root-sentinel'], contextSnapshotModelDisplay: { display: 'synthetic-display-sentinel' } };
 const p = projectSession(ok);
 assert.deepEqual(p, { modelId: 'claude-sonnet-4.5', lastModifiedAt: NOW, workspacePaths: ['/synthetic/one'] });
 assert.ok(!JSON.stringify(p).includes('sentinel'));
 assert.equal(projectSession({ ...ok, schemaVersion: '2.0.0' }), 'unsupported_schema');
 assert.equal(projectSession({ ...ok, dataModelVersion: 2 }), 'unsupported_schema'); assert.equal(projectSession({ ...ok, dataModelVersion: '1' }), 'unsupported_schema');
 for (const bad of [null, [], 'x', 1, undefined]) assert.equal(projectSession(bad), 'invalid_shape');
 assert.equal(projectSession({ ...ok, lastModifiedAt: '2026-10-18 12:00' }), 'invalid_shape'); assert.equal(projectSession({ ...ok, lastModifiedAt: undefined }), 'invalid_shape');
 assert.equal(projectSession({ ...ok, workspacePaths: 'x' }), 'invalid_shape');
 assert.equal(projectSession({ ...ok, workspacePaths: Array.from({ length: LIMITS.maxWorkspacePaths + 1 }, () => '/a') }), 'invalid_shape');
 assert.notEqual(projectSession({ ...ok, workspacePaths: Array.from({ length: LIMITS.maxWorkspacePaths }, () => '/a') }), 'invalid_shape');
 assert.equal(projectSession({ ...ok, workspacePaths: ['/a'.padEnd(LIMITS.maxPathChars + 1, 'a')] }), 'invalid_shape');
 assert.equal(projectSession({ ...ok, workspacePaths: ['/a', 5] }), 'invalid_shape');
 // modelId: absent, wrong type, over-long, uppercase, path-like, spaces, control characters -> null (no hint), never a failure
 for (const id of [undefined, 5, null, {}, [], '', 'x'.repeat(41), 'Claude-Sonnet', '../x', 'a/b', 'a b', 'a\u0000b', 'a\nb', '-lead', '.lead', 'synthetic-sentinel‮']) {
  const q = projectSession({ ...ok, modelId: id }); assert.ok(typeof q === 'object' && q.modelId === null, String(id));
 }
 assert.equal((projectSession({ ...ok, modelId: 'x'.repeat(40) }) as { modelId: string }).modelId, 'x'.repeat(40));
 assert.equal((projectSession({ ...ok, modelId: 'auto' }) as { modelId: string }).modelId, 'auto');
});

test('workspace matching is a pure string comparison', () => {
 assert.equal(normalizePath('/Users/Synthetic/Pröject/'), normalizePath('/users/synthetic/pröject')); // NFC versus NFD, case, trailing separator
 assert.equal(normalizePath('/'), '/');
 assert.equal(workspaceMatches(['/synthetic/a', '/synthetic/b'], ['/synthetic/b/']), true);
 assert.equal(workspaceMatches(['/synthetic/A'], ['/synthetic/a']), true);
 assert.equal(workspaceMatches(['/synthetic/a'], ['/synthetic/ab']), false);
 assert.equal(workspaceMatches(['/synthetic/a/b'], ['/synthetic/a']), false); // no prefix or parent matching
 assert.equal(workspaceMatches(['/synthetic/x'], ['/synthetic/y', '/synthetic/x']), true); // multi-root: any folder
 assert.equal(workspaceMatches([], ['/synthetic/x']), false); assert.equal(workspaceMatches(['/synthetic/x'], []), false); assert.equal(workspaceMatches([''], ['']), false);
});

test('context scanning: newest by timestamp, not by line; ties go to the later line', () => {
 const out = scan(line('2026-10-18T11:50:00Z', 4) + line('2026-10-18T11:58:00Z', 9) + line('2026-10-18T11:54:00Z', 6.5));
 assert.deepEqual(out.event, { percent: 9, at: Date.parse('2026-10-18T11:58:00Z') });
 assert.equal(scan(line('2026-10-18T11:50:00Z', 4) + line('2026-10-18T11:50:00Z', 5)).event?.percent, 5);
 // a drop (compaction or a model switch) is accepted as the newest value
 assert.equal(scan(line('2026-10-18T11:50:00Z', 80) + line('2026-10-18T11:51:00Z', 12)).event?.percent, 12);
 assert.equal(scan(line('2026-10-18T11:50:00Z', 9.0) + line('2026-10-18T11:51:00+00:00', 8.95)).event?.percent, 8.95);
});

test('context scanning drops anything that is not the exact event shape', () => {
 const t = '2026-10-18T11:50:00Z';
 const bad = [
  line(t, 9, { type: 'user' }), line(t, 9, { key: 'other' }), line('2026-10-18T11:50:00', 9), line('not a date', 9), line(t, '9'), line(t, null), line(t, { x: 1 }),
  JSON.stringify({ timestamp: t, payload: { type: 'session_metadata', key: 'contextUsage' } }) + '\n', JSON.stringify({ timestamp: t, payload: { type: 'session_metadata', key: 'contextUsage', value: [] } }) + '\n',
  JSON.stringify({ payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: 9 } } }) + '\n', JSON.stringify([t, 'session_metadata', 'contextUsage']) + '\n',
  JSON.stringify({ timestamp: t, payload: 'session_metadata contextUsage' }) + '\n', '{"timestamp":"' + t + '","payload":{"type":"session_metadata","key":"contextUsage","value":{"usagePercentage":9}\n',
  line('2026-10-18T12:06:00Z', 9), // more than five minutes in the future
 ];
 for (const b of bad) { const out = scan(b); assert.equal(out.event, undefined, b); }
 const user = JSON.stringify({ timestamp: t, payload: { type: 'user' }, session_metadata: 'synthetic-prompt-sentinel', contextUsage: 1 }) + '\n';
 const out = scan(user + line(t, 7));
 assert.equal(out.candidates, 2); assert.equal(out.rejected, 1); assert.equal(out.event?.percent, 7);
 assert.ok(!JSON.stringify(out).includes('sentinel'));
 assert.equal(scan(line('2026-10-18T12:04:00Z', 9)).event?.percent, 9); // within five minutes is fine
});

test('context scanning ignores an unterminated last line, long lines and never decodes other lines', () => {
 const seen: string[] = [];
 const decode = (b: Uint8Array) => { const s = new TextDecoder().decode(b); seen.push(s); return s; };
 const content = JSON.stringify({ timestamp: '2026-10-18T11:50:00Z', payload: { type: 'user', text: 'synthetic-prompt-sentinel only session_metadata here' } }) + '\n';
 const unterminated = line('2026-10-18T11:59:00Z', 50).trimEnd();
 const long = line('2026-10-18T11:58:00Z', 60, { pad: 'x'.repeat(LIMITS.maxLineBytes) });
 const out = scan(content + 'no literals at all\n' + long + line('2026-10-18T11:52:00Z', 7) + unterminated, NOW, decode);
 assert.equal(out.event?.percent, 7); assert.equal(seen.length, 1); assert.ok(seen[0]!.includes('"usagePercentage":7'));
 assert.equal(scan('', NOW).event, undefined); assert.equal(scan('\n\n', NOW).candidates, 0);
 assert.equal(scan(unterminated).event, undefined);
 // invalid UTF-8 in a candidate line is dropped, not thrown
 const badBytes = Uint8Array.from([...enc('{"a":"session_metadata","b":"contextUsage","c":"'), 0xff, 0xfe, ...enc('"}\n')]);
 assert.doesNotThrow(() => scanContext(badBytes, NOW)); assert.equal(scanContext(badBytes, NOW).rejected, 1);
});

test('percentage range: 0 to 100 as is, up to 105 shown as 100, the rest silent', () => {
 for (const [v, e] of [[0, 0], [100, 100], [104, 100], [105, 100], [42.5, 42.5], [100.0001, 100]] as const) assert.equal(contextPercent(v), e, String(v));
 for (const v of [105.1, -0.1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.equal(contextPercent(v), undefined, String(v));
 // JSON cannot carry NaN or Infinity; a string percentage never reaches contextPercent
 assert.equal(scan(line('2026-10-18T11:50:00Z', 'NaN')).event, undefined);
});

test('model table: every row by category; hints only above 1.0; Auto, unknown ids and silent rows stay silent', () => {
 const now = Date.parse('2026-10-20T00:00:00Z');
 for (const r of MODELS) { assert.match(r.id, /^[a-z0-9][a-z0-9._-]{0,39}$/); assert.ok(multiplierText(r.multiplier), r.id); assert.ok(['observed', 'documented', 'pattern'].includes(r.basis)); }
 assert.equal(new Set(MODELS.map(r => r.id)).size, MODELS.length);
 assert.ok(!MODELS.some(r => r.id === 'auto')); assert.equal(modelHint('auto', now), undefined);
 const basis = (b: string) => MODELS.filter(r => r.basis === b).map(r => r.id).sort();
 assert.deepEqual(basis('observed'), ['claude-sonnet-4.5', 'minimax-m2.1', 'minimax-m2.5']);
 assert.deepEqual(basis('documented'), ['claude-opus-4.8', 'claude-sonnet-4.6']);
 assert.equal(MODELS.length, 22); // every model of the table of 2026-10-18 except Auto
 // [id, published name, multiplier text shown or undefined for silent, "from about" wording]
 const rows: [string, string, string | undefined, boolean][] = [
  ['gpt-5.6-sol', 'GPT-5.6 Sol', '4.4', true], ['gpt-5.6-terra', 'GPT-5.6 Terra', '2.2', true], ['gpt-5.6-luna', 'GPT-5.6 Luna', undefined, true],
  ['claude-fable-5.1', 'Claude Fable 5.1', '6', false], ['claude-opus-5.5', 'Claude Opus 5.5', '2', false], ['claude-sonnet-5.5', 'Claude Sonnet 5.5', '1.3', false],
  ['claude-opus-5', 'Claude Opus 5', '2.2', false], ['claude-opus-4.8', 'Claude Opus 4.8', '2.2', false], ['claude-opus-4.7', 'Claude Opus 4.7', '2.2', false],
  ['claude-opus-4.6', 'Claude Opus 4.6', '2.2', false], ['claude-opus-4.5', 'Claude Opus 4.5', '2.2', false], ['claude-sonnet-5', 'Claude Sonnet 5', '1.3', false],
  ['claude-sonnet-4.6', 'Claude Sonnet 4.6', '1.3', false], ['claude-sonnet-4.5', 'Claude Sonnet 4.5', '1.3', false],
  ['claude-sonnet-4.0', 'Claude Sonnet 4.0', undefined, false], // end of life: silent on purpose
  ['claude-haiku-4.5', 'Claude Haiku 4.5', undefined, false], ['kimi-k3', 'Kimi K3', '2.4', false], ['deepseek-3.2', 'DeepSeek 3.2', undefined, false],
  ['minimax-m2.5', 'MiniMax M2.5', undefined, false], ['glm-5', 'GLM-5', undefined, false], ['minimax-m2.1', 'MiniMax M2.1', undefined, false], ['qwen3-coder-next', 'Qwen3 Coder Next', undefined, false],
 ];
 assert.deepEqual(rows.map(r => r[0]).sort(), MODELS.map(r => r.id).sort());
 for (const [id, name, shown, from] of rows) {
  assert.equal(MODELS.find(r => r.id === id)?.name, name);
  const hint = modelHint(id, now);
  if (shown === undefined) assert.equal(hint, undefined, id);
  else assert.deepEqual(hint, { name, multiplier: shown, from, stale: false, date: '2026-10-18' }, id);
 }
 for (const id of ['synthetic-unlisted', 'Claude-Sonnet-4.5', '../claude-sonnet-4.5', 'x'.repeat(41), '', null]) assert.equal(modelHint(id, now), undefined, String(id));
 const table: ModelRow[] = [{ id: 'synthetic-model-x', name: 'Synthetic X', multiplier: '2.0', basis: 'observed' }, { id: 'synthetic-model-one', name: 'Synthetic One', multiplier: '1.0', basis: 'observed' },
  { id: 'synthetic-model-edge', name: 'Synthetic Edge', multiplier: '1.04', basis: 'pattern' }, { id: 'synthetic-model-bad', name: 'Synthetic Bad', multiplier: 'abc', basis: 'pattern' }, { id: 'synthetic-model-neg', name: 'N', multiplier: '-2', basis: 'pattern' },
  { id: 'synthetic-model-off', name: 'Synthetic Off', multiplier: '9', basis: 'pattern', flag: 'silent' }];
 assert.equal(modelHint('synthetic-model-x', now, table)?.multiplier, '2'); assert.equal(modelHint('synthetic-model-one', now, table), undefined);
 assert.equal(modelHint('synthetic-model-edge', now, table)?.multiplier, '1'); // above 1.0 in the table, shown rounded to one decimal
 for (const id of ['synthetic-model-bad', 'synthetic-model-neg', 'synthetic-model-off']) assert.equal(modelHint(id, now, table), undefined, id);
 // a table older than 90 days says "check" instead of a number
 assert.equal(modelHint('claude-sonnet-4.5', Date.parse('2027-01-17T00:00:00Z'))?.stale, true); assert.equal(modelHint('claude-sonnet-4.5', Date.parse('2027-01-16T00:00:00Z'))?.stale, false);
 assert.equal(multiplierText('2.25'), '2.3'); assert.equal(multiplierText('0'), undefined); assert.equal(multiplierText('1e3'), undefined);
});
