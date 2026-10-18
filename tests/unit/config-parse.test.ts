import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSteering, parseHooks } from '../../src/audit/config-parse.ts';
const bytes = (s: string) => new TextEncoder().encode(s);
const fm = (s: string) => bytes(`---\n${s}\n---\nSYNTHETIC-INJECT-IGNORE-PREVIOUS`);
const hook = (extra: object = {}) => ({ name: 'synthetic-hook', trigger: 'PostFileSave', action: { type: 'agent', prompt: 'synthetic-prompt' }, ...extra });
const json = (hooks: unknown[], version: unknown = 'v1') => bytes(JSON.stringify({ version, hooks }));

test('steering keeps only modes, counts, lexical match-all and size', () => {
 for (const mode of ['always', 'manual', 'auto', 'fileMatch']) {
  const r = parseSteering(fm(`inclusion: ${mode}\nname: synthetic-name\ndescription: synthetic-description\nfileMatchPattern: ["**", "./**/*"]`), 9000);
  assert.deepEqual(r, { mode, matchAll: true, patternCount: 2, size: 9000 });
 }
 assert.deepEqual(parseSteering(bytes('synthetic body'), 14), { mode: 'always', matchAll: false, patternCount: 0, size: 14 });
 assert.equal(parseSteering(bytes('---\r\ninclusion: manual\r\n---\r\n'), 30).mode, 'manual');
 for (const pattern of ['*', '*.*', 'synthetic-(a+)+$']) assert.equal(parseSteering(fm(`inclusion: fileMatch\nfileMatchPattern: '${pattern}'`), 100).matchAll, false);
});
test('malformed or unsupported front matter fails closed without exposing values', () => {
 for (const s of ['\ufeff---\ninclusion: always\n---\n', '\n---\ninclusion: always\n---\n', '---\rinclusion: always\r---\r', '---\ninclusion: manual', '---\n\tinclusion: always\n---\n', '---\ninclusion: &synthetic always\n---\n', '---\ninclusion: unknown\n---\n', '---\ninclusion: auto\n---\n', '---\ninclusion: always\nunknown: synthetic\n---\n', '---\ninclusion: manual\ninclusion: always\n---\n']) {
  const r = parseSteering(bytes(s), 100); assert.equal(r.mode, 'unrecognised'); assert.ok(!JSON.stringify(r).includes('synthetic'));
 }
 assert.equal(parseSteering(fm('inclusion: fileMatch\nfileMatchPattern: [' + Array(21).fill('"**"').join(',') + ']'), 100).matchAll, 'unknown');
 assert.equal(parseSteering(fm(`inclusion: fileMatch\nfileMatchPattern: '${'x'.repeat(257)}'`), 100).matchAll, 'unknown');
 const r = parseSteering(bytes('---\ninclusion: manual\n---\n\xff'), 100); assert.equal(r.mode, 'manual');
});
test('hook schema, triggers, alias, matcher classes and lengths are projected without content', () => {
 const triggers = ['PostFileSave', 'PostFileCreate', 'PostFileDelete', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'SessionEnd', 'PreTaskExec', 'PostTaskExec', 'Manual', 'AgentSpawn', 'agentSpawn'];
 const r = parseHooks(json(triggers.map(trigger => hook({ trigger })))); assert.ok('hooks' in r);
 assert.deepEqual(r.hooks.map(h => h.trigger), triggers.map(t => t === 'AgentSpawn' || t === 'agentSpawn' ? 'SessionStart' : t));
 assert.ok(r.hooks.every(h => Object.getPrototypeOf(h) === null && h.promptBytes === 16 && h.commandBytes === 0 && h.enabled === true));
 for (const matcher of [undefined, '', '  ', '*', '**', '**/*', '.*', '.+', '^.*$', 'synthetic-(a+)+$', 'x'.repeat(513)]) {
  const h = parseHooks(json([hook({ matcher })])); assert.ok('hooks' in h);
  assert.equal(h.hooks[0]!.matcher, matcher === undefined || !matcher.trim() ? 'none' : matcher.length > 512 ? 'not_analysed' : matcher.startsWith('synthetic') ? 'specific' : 'broad');
 }
 const sentinel = 'SYNTHETIC-INJECT-IGNORE-PREVIOUS';
 const secret = parseHooks(json([hook({ matcher: sentinel, action: { type: 'command', command: sentinel, prompt: sentinel }, description: sentinel })]));
 assert.ok(!JSON.stringify(secret).includes(sentinel));
});
test('hook inputs fail closed and never throw or echo malformed content', () => {
 for (const input of [bytes('{"SYNTHETIC-INJECT-IGNORE-PREVIOUS"'), bytes('\ufeff{}'), new Uint8Array([255]), bytes('['.repeat(10000) + ']'.repeat(10000))]) {
  const r = parseHooks(input); assert.ok('code' in r); assert.ok(!JSON.stringify(r).includes('SYNTHETIC'));
 }
 for (const version of [false, 1, 'v2', null]) assert.deepEqual(parseHooks(json([hook()], version)), { code: 'schema_unknown' });
 const r = parseHooks(json([hook({ enabled: 'yes', trigger: 'synthetic-unknown' }), hook({ enabled: false }), ...Array.from({ length: 201 }, () => hook())]));
 assert.ok('hooks' in r); assert.equal(r.hooks.length, 200); assert.equal(r.omitted, 3); assert.equal(r.hooks[0]!.trigger, 'unrecognised'); assert.equal(r.hooks[0]!.enabled, 'unrecognised'); assert.equal(r.hooks[1]!.enabled, false);
 const polluted = parseHooks(bytes('{"version":"v1","hooks":[{"__proto__":{"trigger":"Stop"},"constructor":{},"name":"synthetic-hook","action":{"type":"agent","prompt":"synthetic"}}]}'));
 assert.ok('hooks' in polluted); assert.equal(polluted.hooks[0]!.trigger, 'unrecognised');
});
test('ordinary leading whitespace body stays always; body and bytes beyond closing line are never decoded', () => {
 assert.equal(parseSteering(bytes('\nsynthetic body'), 15).mode, 'always');
 const prefix = bytes('---\ninclusion: manual\n---\n'), invalidBody = new Uint8Array(prefix.length + 1); invalidBody.set(prefix); invalidBody[prefix.length] = 255;
 assert.equal(parseSteering(invalidBody, invalidBody.length).mode, 'manual');
 assert.equal(parseSteering(bytes('---\n' + '# synthetic\n'.repeat(200) + '---\n'), 3000).mode, 'unrecognised');
 const a = parseHooks(json([hook({ name: 'synthetic-' + 'x'.repeat(300), trigger: 'x'.repeat(65), matcher: '(synthetic-a+)+'.repeat(10000) })])); assert.ok('code' in a || a.hooks[0]!.name === '');
});
