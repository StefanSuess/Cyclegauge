import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHookEdit, planSteeringEdit, type ConfigEditPlan, type ConfigEditResult } from '../../src/audit/config-edit.ts';

// Synthetic inputs only. `apply` performs the planned edit on a string, the way the editor would, after checking the verify text.
const bytes = (s: string) => new TextEncoder().encode(s);
const plan = (r: ConfigEditResult): ConfigEditPlan => { assert.ok('plan' in r, JSON.stringify(r)); return r.plan; };
const apply = (text: string, p: ConfigEditPlan): string => {
 assert.equal(text.slice(p.verify.start, p.verify.end), p.verify.text, 'verify text matches the document');
 return p.kind === 'replace' ? text.slice(0, p.start) + p.text + text.slice(p.end) : text;
};
const steer = (text: string, action: 'manual' | 'select_pattern' = 'manual', eol: '\n' | '\r\n' = '\n') => planSteeringEdit(bytes(text.slice(0, 2048)), bytes(text).length, action, eol);

test('steering without front matter gets the exact manual block at the start, in the document line ending', () => {
 const body = 'synthetic body\nsecond line\n';
 assert.equal(apply(body, plan(steer(body))), '---\ninclusion: manual\n---\n' + body);
 assert.equal(apply(body, plan(steer(body, 'manual', '\r\n'))), '---\r\ninclusion: manual\r\n---\r\n' + body);
 const p = plan(steer(body));
 assert.deepEqual([p.kind, 'start' in p && p.start], ['replace', 0]);
});

test('steering with inclusion: always has only that value replaced, quoted or not, and nothing else moves', () => {
 for (const value of ['always', '"always"', "'always'", 'always   ']) {
  const text = `---\ninclusion: ${value}\nname: synthetic-name\n---\nsynthetic body\n`;
  assert.equal(apply(text, plan(steer(text))), text.replace(value.trim(), 'manual'), value); // trailing blanks stay: only the value token changes
 }
 const spaced = '---\nname: synthetic\ninclusion:    always\n---\nbody\n';
 assert.equal(apply(spaced, plan(steer(spaced))), '---\nname: synthetic\ninclusion:    manual\n---\nbody\n');
});

test('steering with other front matter keys gets an inclusion line right after the opener, using its line ending', () => {
 const text = '---\nname: synthetic-name\ndescription: synthetic description\n---\nbody\n';
 assert.equal(apply(text, plan(steer(text))), '---\ninclusion: manual\nname: synthetic-name\ndescription: synthetic description\n---\nbody\n');
 const empty = '---\n---\nbody\n';
 assert.equal(apply(empty, plan(steer(empty))), '---\ninclusion: manual\n---\nbody\n');
 const crlf = '---\r\nname: synthetic-name\r\n---\r\nbody\r\n';
 assert.equal(apply(crlf, plan(steer(crlf, 'manual', '\n'))), '---\r\ninclusion: manual\r\nname: synthetic-name\r\n---\r\nbody\r\n', 'a CRLF opener decides, not the argument');
 const crlfAlways = '---\r\ninclusion: always\r\n---\r\nbody\r\n';
 assert.equal(apply(crlfAlways, plan(steer(crlfAlways))), '---\r\ninclusion: manual\r\n---\r\nbody\r\n');
});

test('steering the edit does not apply to: other modes, unrecognised front matter, a comment line and files with a long body', () => {
 const none = { code: 'unsupported' };
 for (const text of ['---\ninclusion: manual\n---\nb\n', '---\ninclusion: auto\nname: a\ndescription: b\n---\nb\n', '---\ninclusion: fileMatch\nfileMatchPattern: src/**\n---\nb\n',
  '---\ninclusion: always\n', '---\n\tinclusion: always\n---\n', '﻿---\ninclusion: always\n---\n', '---\ninclusion: sometimes\n---\n', '---\ninclusion: always\ninclusion: manual\n---\n']) assert.deepEqual(steer(text), none, JSON.stringify(text));
 const commented = '---\n# inclusion: always\nname: synthetic\n---\nb\n';
 assert.equal(apply(commented, plan(steer(commented))), '---\ninclusion: manual\n# inclusion: always\nname: synthetic\n---\nb\n', 'a comment is not the value');
 const long = '---\ninclusion: always\n---\n' + 'x'.repeat(5000);
 assert.equal(apply(long, plan(steer(long))), '---\ninclusion: manual\n---\n' + 'x'.repeat(5000));
 const unclosed = '---\ninclusion: always\n' + 'x'.repeat(3000);
 assert.deepEqual(steer(unclosed), none);
});

test('the fileMatch pattern selection covers exactly the value, quoted, bare or in an array, and is never an edit', () => {
 for (const value of ['"**/*"', '**', "'**'", '["**/*"]', '["**", "**/*"]']) {
  const text = `---\ninclusion: fileMatch\nfileMatchPattern: ${value}\nname: synthetic\n---\nbody\n`;
  const p = plan(steer(text, 'select_pattern'));
  assert.equal(p.kind, 'select'); assert.equal(text.slice(p.start, p.end), value, value);
  assert.equal(apply(text, p), text);
 }
 const crlf = '---\r\nfileMatchPattern:   "**"  \r\ninclusion: fileMatch\r\n---\r\nbody\r\n';
 const q = plan(steer(crlf, 'select_pattern')); assert.equal(crlf.slice(q.start, q.end), '"**"');
 const emoji = '---\r\nname: synthetic-😀\r\ninclusion: fileMatch\r\nfileMatchPattern: **\r\n---\r\nbody\r\n';
 const r = plan(steer(emoji, 'select_pattern')); assert.equal(emoji.slice(r.start, r.end), '**', 'offsets count UTF-16 units, as the editor does');
 const none = { code: 'unsupported' };
 assert.deepEqual(steer('---\ninclusion: fileMatch\nfileMatchPattern: src/**\n---\n', 'select_pattern'), none, 'not a match-all pattern');
 assert.deepEqual(steer('---\ninclusion: always\n---\n', 'select_pattern'), none);
 assert.deepEqual(steer('no front matter\n', 'select_pattern'), none);
});

const json = (hooks: unknown[], indent: string | number = 2) => JSON.stringify({ version: 'v1', hooks }, null, indent);
const agent = (name: string, extra: Record<string, unknown> = {}) => ({ name, trigger: 'PostFileSave', matcher: '*', action: { type: 'agent', prompt: 'synthetic prompt' }, ...extra });
const hook = (text: string, index: number, action: 'run_manually' | 'disable') => planHookEdit(bytes(text), index, action);
const parsed = (text: string) => JSON.parse(text) as { hooks: Record<string, unknown>[] };

test('a single hook: trigger becomes "Manual" and the new JSON differs only in that value', () => {
 const text = json([agent('synthetic-one')]);
 const out = apply(text, plan(hook(text, 0, 'run_manually')));
 assert.equal(out, text.replace('"PostFileSave"', '"Manual"'));
 assert.equal(parsed(out).hooks[0]!.trigger, 'Manual');
});

test('several hooks: only the addressed entry changes, whatever the formatting', () => {
 const hooks = [agent('synthetic-a'), agent('synthetic-b', { trigger: 'PreToolUse' }), agent('synthetic-c')];
 for (const indent of [2, 4, '\t', 0]) {
  const text = json(hooks, indent);
  for (const index of [0, 1, 2]) {
   const out = apply(text, plan(hook(text, index, 'run_manually')));
   const result = parsed(out).hooks;
   assert.deepEqual(result.map(h => h.trigger), hooks.map((h, i) => i === index ? 'Manual' : h.trigger), `${indent} ${index}`);
   assert.deepEqual(result.map((h, i) => i === index ? { ...h, trigger: 'x' } : h), hooks.map((h, i) => i === index ? { ...h, trigger: 'x' } : h));
   assert.equal(out.length - text.length, '"Manual"'.length - JSON.stringify(hooks[index]!.trigger).length);
  }
 }
 const crlf = json(hooks).replaceAll('\n', '\r\n');
 assert.equal(apply(crlf, plan(hook(crlf, 1, 'run_manually'))), crlf.replace('"PreToolUse"', '"Manual"'));
});

test('disable replaces an existing true or inserts an enabled member before the first member, keeping the entry layout', () => {
 const existing = json([agent('synthetic-a', { enabled: true }), agent('synthetic-b')]);
 const first = apply(existing, plan(hook(existing, 0, 'disable')));
 assert.equal(first, existing.replace('"enabled": true', '"enabled": false'));
 const added = apply(existing, plan(hook(existing, 1, 'disable')));
 const result = parsed(added).hooks;
 assert.deepEqual(result.map(h => h.enabled), [true, false]);
 assert.deepEqual({ ...result[1]!, enabled: undefined }, { ...agent('synthetic-b'), enabled: undefined });
 assert.match(added, /\{\n {6}"enabled": false,\n {6}"name": "synthetic-b"/, 'the new member copies the entry indentation');
 const crlf = json([agent('synthetic-a')]).replaceAll('\n', '\r\n');
 const out = apply(crlf, plan(hook(crlf, 0, 'disable')));
 assert.equal(out.replaceAll('\r\n', '').includes('\n'), false, 'no bare newline is introduced into a CRLF file');
 assert.equal(parsed(out).hooks[0]!.enabled, false);
 const compact = json([agent('synthetic-a'), agent('synthetic-b')], 0);
 assert.deepEqual(parsed(apply(compact, plan(hook(compact, 1, 'disable')))).hooks.map(h => h.enabled), [undefined, false]);
 const tabs = json([{ name: 'synthetic-a', trigger: 'Stop', action: { type: 'agent', prompt: 'p' } }], '\t');
 assert.equal(parsed(apply(tabs, plan(hook(tabs, 0, 'disable')))).hooks[0]!.enabled, false);
});

test('strings that look like keys, braces inside strings and deeply nested values do not confuse the locator', () => {
 const tricky = { name: 'synthetic {"trigger": "Stop"} \\" ] ,', trigger: 'PostFileSave', action: { type: 'agent', prompt: '{"enabled": true}', nested: { a: [{ b: [1, 2, { trigger: 'x' }] }] } }, matcher: '*' };
 const text = json([tricky, agent('synthetic-after')]);
 const out = apply(text, plan(hook(text, 0, 'run_manually')));
 assert.deepEqual(parsed(out).hooks[0], { ...tricky, trigger: 'Manual' });
 assert.deepEqual(parsed(out).hooks[1], agent('synthetic-after'));
 const off = apply(text, plan(hook(text, 0, 'disable')));
 assert.deepEqual(parsed(off).hooks[0], { enabled: false, ...tricky });
 const deep = '['.repeat(20000) + ']'.repeat(20000);
 const nested = `{"version":"v1","hooks":[{"name":"synthetic","trigger":"Stop","deep":${deep}}]}`;
 assert.equal(apply(nested, plan(hook(nested, 0, 'run_manually'))), nested.replace('"Stop"', '"Manual"'), 'no recursion over the nesting');
});

test('unusual or ambiguous JSON falls back (unsupported) instead of guessing', () => {
 const none = { code: 'unsupported' };
 const good = json([agent('synthetic-a')]);
 const cases: [string, string, number, 'run_manually' | 'disable'][] = [
  ['duplicate trigger', good.replace('"trigger": "PostFileSave"', '"trigger": "PostFileSave", "trigger": "Stop"'), 0, 'run_manually'],
  ['duplicate enabled', json([agent('synthetic-a', { enabled: true })]).replace('"enabled": true', '"enabled": true, "enabled": false'), 0, 'disable'],
  ['escaped key', good.replace('"trigger"', '"trig\\u0067er"'), 0, 'run_manually'],
  ['escaped top-level key', good.replace('"hooks"', '"hook\\u0073"'), 0, 'run_manually'],
  ['duplicate hooks key', good.replace('"hooks"', '"hooks": [], "hooks"'), 0, 'run_manually'],
  ['escaped trigger value', good.replace('"PostFileSave"', '"PostFile\\u0053ave"'), 0, 'run_manually'],
  ['trigger is not a string', good.replace('"PostFileSave"', '3'), 0, 'run_manually'],
  ['no trigger', json([{ name: 'synthetic-a', action: { type: 'agent' } }]), 0, 'run_manually'],
  ['already Manual', json([agent('synthetic-a', { trigger: 'Manual' })]), 0, 'run_manually'],
  ['enabled is not true', json([agent('synthetic-a', { enabled: 'yes' })]), 0, 'disable'],
  ['enabled already false', json([agent('synthetic-a', { enabled: false })]), 0, 'disable'],
  ['empty entry', json([{}]), 0, 'disable'],
  ['entry is not an object', json([5]), 0, 'run_manually'],
  ['index past the end', good, 3, 'run_manually'],
  ['negative index', good, -1, 'run_manually'],
  ['hooks is not an array', '{"version":"v1","hooks":{}}', 0, 'run_manually'],
  ['truncated', good.slice(0, 60), 0, 'run_manually'],
  ['not an object', '[]', 0, 'run_manually'],
  ['BOM', '﻿' + good, 0, 'run_manually'],
 ];
 for (const [label, text, index, action] of cases) assert.deepEqual(hook(text, index, action), none, label);
 assert.deepEqual(planHookEdit(Uint8Array.of(0xff, 0xfe, 0x7b), 0, 'disable'), none, 'invalid UTF-8');
});

test('the planner is linear on large input and never writes: it returns data only', () => {
 const many = Array.from({ length: 205 }, (_, i) => agent(`synthetic-${i}`));
 const text = json(many);
 const started = Date.now();
 for (let i = 0; i < 199; i += 40) assert.ok('plan' in hook(text, i, 'disable'));
 assert.ok(Date.now() - started < 2000);
 assert.deepEqual(hook(text, 200, 'run_manually'), { code: 'unsupported' }, 'entries past the review limit are not edited');
});
