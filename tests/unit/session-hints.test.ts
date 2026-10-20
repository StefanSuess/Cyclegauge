import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HINT_CODES } from '../../src/session/codes.ts';
import { gate, tick, type TickRequest } from '../../src/session/hints.ts';
import { newHintState } from '../../src/session/notices.ts';
import { defaultFs, type SessionFs } from '../../src/session/reader.ts';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const STARTED = NOW - 3_600_000;
const FOLDER = '/synthetic/project';
const iso = (ms: number) => new Date(ms).toISOString();
const ctx = (ts: number, pct: number) => JSON.stringify({ timestamp: iso(ts), payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: pct } } }) + '\n';
async function home(o: { model?: string; pct?: number; sentinel?: boolean } = {}) {
 const base = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'synthetic-hints-')));
 const h = join(base, 'synthetic-home'), dir = join(h, '.kiro', 'sessions', 'synthetic-ws', 'synthetic-session');
 await mkdir(dir, { recursive: true });
 const last = NOW - 120_000;
 await writeFile(join(dir, 'session.json'), JSON.stringify({ schemaVersion: '1.0.0', dataModelVersion: 1, modelId: o.model ?? 'claude-sonnet-4.5', lastModifiedAt: iso(last), workspacePaths: [FOLDER], title: 'synthetic-title-sentinel' }));
 await utimes(join(dir, 'session.json'), new Date(last), new Date(last));
 await writeFile(join(dir, 'messages.jsonl'), ctx(NOW - 130_000, o.pct ?? 20));
 return { base, home: h };
}
const request = (home: () => string, over: Partial<TickRequest> = {}): TickRequest => ({ enabled: true, platform: 'darwin', remote: false, folders: [FOLDER], home, now: NOW, started: STARTED, state: newHintState(), ...over });

test('the gate: disabled, unsupported platform, remote or no file folder is closed with a fixed code', () => {
 const ok = { enabled: true, platform: 'darwin', remote: false, folders: [FOLDER] };
 assert.equal(gate(ok), undefined);
 assert.equal(gate({ ...ok, enabled: false }), 'disabled');
 for (const platform of ['darwin', 'win32', 'linux']) assert.equal(gate({ ...ok, platform }), undefined, platform);
 for (const platform of ['freebsd', 'aix', 'sunos', 'android', '']) assert.equal(gate({ ...ok, platform }), 'unsupported_platform', platform);
 for (const platform of ['darwin', 'win32', 'linux']) assert.equal(gate({ ...ok, platform, remote: true }), 'unsupported_platform', platform);
 assert.equal(gate({ ...ok, remote: true }), 'unsupported_platform');
 assert.equal(gate({ ...ok, folders: [] }), 'no_match');
});

// An fs-spy over every function of node:fs and node:fs/promises (and the callback and sync forms): the ESM named imports are live bindings, so a
// patched export is seen by the code under test after syncBuiltinESMExports().
function spyOnFs(): { calls: string[]; restore(): void } {
 const calls: string[] = [], originals: [Record<string, unknown>, string, unknown][] = [];
 for (const [name, target] of [['fs', fsSync], ['fs/promises', fsp], ['fs.promises', fsSync.promises]] as const) {
  const holder = target as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(holder)) {
   const original = holder[key];
   if (typeof original !== 'function' || /^[A-Z]/.test(key) || key === 'constructor') continue;
   const descriptor = Object.getOwnPropertyDescriptor(holder, key);
   if (!descriptor || !descriptor.writable || !descriptor.configurable) continue;
   originals.push([holder, key, original]);
   holder[key] = function (this: unknown, ...args: unknown[]) { calls.push(`${name}.${key}`); return (original as (...a: unknown[]) => unknown).apply(this, args); };
  }
 }
 syncBuiltinESMExports();
 return { calls, restore() { for (const [holder, key, original] of originals) holder[key] = original; syncBuiltinESMExports(); } };
}

test('fs-spy: disabled, unsupported platform, remote host and a window without a file folder make zero filesystem calls', async () => {
 const fixture = await home();
 let homeCalls = 0;
 const spy = spyOnFs();
 const results = [];
 try {
  const lazyHome = () => { homeCalls++; return fixture.home; };
  for (const over of [{ enabled: false }, { platform: 'freebsd' }, { platform: 'aix' }, { remote: true }, { folders: [] }] as Partial<TickRequest>[]) results.push(await tick(request(lazyHome, over)));
 } finally { spy.restore(); }
 assert.deepEqual(results.map(r => r.code), ['disabled', 'unsupported_platform', 'unsupported_platform', 'unsupported_platform', 'no_match']);
 assert.deepEqual(spy.calls, []); assert.equal(homeCalls, 0, 'the home folder is not even resolved');
 // positive control: the same spy sees the calls of an enabled tick
 const control = spyOnFs();
 try { const r = await tick(request(() => fixture.home)); assert.equal(r.code, 'ok'); } finally { control.restore(); }
 assert.ok(control.calls.length > 0 && control.calls.some(c => c.endsWith('lstat')) && control.calls.some(c => c.endsWith('open')), control.calls.join());
 await rm(fixture.base, { recursive: true, force: true });
});

test('an enabled tick produces one fixed-text notice, then stays silent for the same crossing', async () => {
 const f = await home({ pct: 72 });
 const state = newHintState();
 const first = await tick(request(() => f.home, { state }));
 assert.equal(first.code, 'ok'); assert.equal(first.kind, 'context'); assert.match(first.text!, /^Your most recent Kiro session in this workspace was about 72% full as of \d\d:\d\d\. Kiro may compact it soon/);
 const second = await tick(request(() => f.home, { state, now: NOW + 31 * 60_000 }));
 assert.equal(second.code, 'ok'); assert.equal(second.text, undefined); // the Sonnet hint would be due, but the session is now older than ten minutes
 const hintOnly = await home({ pct: 10 });
 assert.equal((await tick(request(() => hintOnly.home))).text, undefined); // a short session with the budget on track: no reason for the model hint
 const hint = await tick(request(() => hintOnly.home, { budgetTight: true }));
 assert.equal(hint.kind, 'model'); assert.match(hint.text!, /^Your Kiro credit budget is tight, and your most recent session in this workspace uses Claude Sonnet 4\.5 \(as of \d\d:\d\d\), which Kiro lists at about 1\.3x the credits of Auto \(Kiro model table, as of 2026-10-18\)/);
 const auto = await home({ model: 'auto', pct: 10 }); assert.equal((await tick(request(() => auto.home, { budgetTight: true }))).text, undefined);
 const unlisted = await home({ model: 'synthetic-unlisted', pct: 10 }); assert.equal((await tick(request(() => unlisted.home, { budgetTight: true }))).text, undefined);
 for (const x of [f, hintOnly, auto, unlisted]) await rm(x.base, { recursive: true, force: true });
});

test('a session older than the extension start gives no notice', async () => {
 const f = await home({ pct: 90 });
 const r = await tick(request(() => f.home, { started: NOW })); assert.equal(r.code, 'ok'); assert.equal(r.text, undefined);
 await rm(f.base, { recursive: true, force: true });
});

test('time budget and abort give the fixed code aborted and no notice', async () => {
 const f = await home({ pct: 90 });
 const slow: SessionFs = { ...defaultFs, readdir: async p => { await new Promise(r => setTimeout(r, 120)); return defaultFs.readdir(p); } };
 const r = await tick(request(() => f.home, { fs: slow, budgetMs: 20 })); assert.deepEqual([r.code, r.text], ['aborted', undefined]);
 const c = new AbortController(); c.abort();
 assert.equal((await tick(request(() => f.home, { signal: c.signal }))).code, 'aborted');
 await rm(f.base, { recursive: true, force: true });
});

test('every failure is a code from the closed list; thrown messages, paths and sentinels never leave the module', async () => {
 const f = await home({ pct: 90 });
 const boom = (what: keyof SessionFs): SessionFs => ({ ...defaultFs, [what]: async () => { throw Object.assign(new Error('synthetic-error-sentinel'), { path: '/synthetic/private/path' }); } }) as SessionFs;
 for (const what of ['lstat', 'readdir', 'open'] as const) {
  const r = await tick(request(() => f.home, { fs: boom(what) }));
  assert.ok((HINT_CODES as readonly string[]).includes(r.code), r.code); assert.equal(r.text, undefined); assert.ok(!JSON.stringify(r).includes('sentinel') && !JSON.stringify(r).includes('private'));
 }
 const thrown = await tick(request(() => { throw new Error('synthetic-error-sentinel'); })); assert.deepEqual(thrown, { code: 'error', opened: 0, capped: 0 });
 const textBearing = await tick(request(() => f.home, { decode: () => { throw new Error('synthetic-error-sentinel'); } })); assert.ok(!JSON.stringify(textBearing).includes('sentinel'));
 // notices carry no session, folder or title text
 const ok = await tick(request(() => f.home)); assert.ok(!/synthetic-(ws|session|title)|sentinel|\/Users|\.kiro/.test(JSON.stringify(ok)));
 await rm(f.base, { recursive: true, force: true });
});

test('module boundaries: the session modules import no editor API, Store, history or network, and contain no write path', async () => {
 const dir = fileURLToPath(new URL('../../src/session/', import.meta.url));
 for (const name of ['codes.ts', 'hints.ts', 'models.ts', 'notices.ts', 'parse.ts', 'reader.ts']) {
  const src = await readFile(join(dir, name), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]!);
  for (const i of imports) assert.ok(i.startsWith('./') || i === '../audit/read-ignore.ts' || i === 'node:path' || i === 'node:fs/promises', `${name} imports ${i}`);
  assert.ok(!/\b(writeFile|appendFile|mkdir|rm|rmdir|unlink|rename|copyFile|truncate|chmod|chown|utimes|symlink|createWriteStream|writeFileSync|fetch|XMLHttpRequest|console)\b\(/.test(src.replace(/\/\/.*$/gm, '')), name);
  assert.ok(!/O_WRONLY|O_RDWR|O_CREAT|O_APPEND|O_TRUNC/.test(src), name);
 }
 assert.deepEqual([...(await readFile(join(dir, 'reader.ts'), 'utf8')).matchAll(/from 'node:fs[^']*'/g)].map(m => m[0]), ["from 'node:fs/promises'"]);
 assert.ok(!/node:fs/.test(await readFile(join(dir, 'parse.ts'), 'utf8')) && !/node:fs/.test(await readFile(join(dir, 'notices.ts'), 'utf8')));
 const wiring = await readFile(fileURLToPath(new URL('../../src/extension/session-hints.ts', import.meta.url)), 'utf8');
 assert.ok(!/node:fs/.test(wiring) && !/globalState|workspaceState|\.update\('(?!sessionHints)/.test(wiring), 'the wiring touches no filesystem and persists nothing');
 assert.ok(/inspect<boolean>\('sessionHints'\)/.test(wiring) && /remoteName/.test(wiring));
});

test('windows and linux ticks run the same bounded read; an unmatched layout is silent with a fixed code', async () => {
 const fixture = await home();
 for (const platform of ['win32', 'linux']) {
  const r = await tick(request(() => fixture.home, { platform }));
  assert.equal(r.code, 'ok', platform); // FOLDER is a POSIX path: it matches as a string on both rules
  const other = await tick(request(() => fixture.home, { platform, folders: ['C:\\synthetic\\other'] }));
  assert.equal(other.code, 'no_match', platform);
  assert.equal((await tick(request(() => join(fixture.home, 'synthetic-missing'), { platform }))).code, 'no_root', platform);
 }
});

test('the session hint notice names exactly what its buttons do; the model hint adds Show credit budget and the fixed Tips page', async () => {
 const code = await readFile(fileURLToPath(new URL('../../src/extension/session-hints.ts', import.meta.url)), 'utf8');
 assert.ok(code.includes("const TURN_OFF = 'Turn off session hints', SHOW_BUDGET = 'Show credit budget', TIPS = 'Tips';"));
 assert.ok(code.includes("result.kind === 'model' ? [SHOW_BUDGET, TIPS, TURN_OFF] : [TURN_OFF]") && code.includes('choice === TURN_OFF'));
 assert.ok(code.includes("executeCommand(commandId('showUsage'))") && code.includes('openExternal(vscode.Uri.parse(LINKS.tips))'));
 assert.ok(!/'Turn off'/.test(code));
});
