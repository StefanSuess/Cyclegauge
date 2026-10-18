import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, symlink, utimes, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { readBounded, type BoundedMode, type ReadFs } from '../../src/audit/read-ignore.ts';
import { READER_LIMITS, defaultFs, readSession, type SessionFs } from '../../src/session/reader.ts';
import { LIMITS } from '../../src/session/parse.ts';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const FOLDER = '/synthetic/project';
const ctx = (ts: number, pct: number) => JSON.stringify({ timestamp: iso(ts), payload: { type: 'session_metadata', key: 'contextUsage', value: { usagePercentage: pct } } }) + '\n';
const temp = async () => { const base = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'synthetic-session-'))); const home = join(base, 'synthetic-home'); await mkdir(join(home, '.kiro', 'sessions'), { recursive: true }); return { base, home }; };
interface Put { model?: string | null; last?: number; mtime?: number; paths?: unknown; messages?: string | Buffer; schema?: string; raw?: string; lastText?: string }
async function put(home: string, ws: string, sess: string, o: Put = {}) {
 const dir = join(home, '.kiro', 'sessions', ws, sess); await mkdir(dir, { recursive: true });
 const last = o.last ?? NOW - 120_000;
 const body = o.raw ?? JSON.stringify({ schemaVersion: o.schema ?? '1.0.0', dataModelVersion: 1, ...(o.model === null ? {} : { modelId: o.model ?? 'claude-sonnet-4.5' }), lastModifiedAt: o.lastText ?? iso(last), workspacePaths: o.paths ?? [FOLDER],
  title: 'synthetic-title-sentinel', rootPaths: ['/synthetic-root-sentinel'], contextSnapshotModelDisplay: { modelId: 'x', display: 'synthetic-display-sentinel' } });
 const file = join(dir, 'session.json'); await writeFile(file, body);
 const when = new Date(o.mtime ?? last); await utimes(file, when, when);
 if (o.messages !== undefined) await writeFile(join(dir, 'messages.jsonl'), o.messages);
 return dir;
}
const read = (home: string, extra: Partial<Parameters<typeof readSession>[0]> = {}) => readSession({ home, folders: [FOLDER], now: NOW, ...extra });
const clean = (base: string) => rm(base, { recursive: true, force: true });
const spyFs = (log: string[]): SessionFs => ({
 ...defaultFs,
 lstat: p => { log.push(`lstat ${p}`); return defaultFs.lstat(p); },
 readdir: p => { log.push(`readdir ${p}`); return defaultFs.readdir(p); },
 open: async (p, flags) => { log.push(`open ${p} ${flags & 3}`); return defaultFs.open(p, flags); },
});

test('reads the model and the newest context value of the newest matching session', async () => {
 const { base, home } = await temp();
 await put(home, 'synthetic-ws-1', 'synthetic-old', { model: 'auto', last: NOW - 7_200_000, messages: ctx(NOW - 7_200_000, 50) });
 await put(home, 'synthetic-ws-1', 'synthetic-new', { model: 'claude-sonnet-4.5', messages: ctx(NOW - 300_000, 4) + ctx(NOW - 130_000, 9) + ctx(NOW - 200_000, 6.5) + JSON.stringify({ timestamp: iso(NOW - 100_000), payload: { type: 'usage_summary', text: 'synthetic-prompt-sentinel' } }) + '\n' });
 await put(home, 'synthetic-ws-2', 'synthetic-other', { model: 'auto', paths: ['/synthetic/other'], messages: ctx(NOW - 60_000, 99) });
 const r = await read(home);
 assert.equal(r.code, 'ok');
 assert.deepEqual(r.code === 'ok' && r.observation, { key: 'synthetic-ws-1/synthetic-new', modelId: 'claude-sonnet-4.5', sessionAsOf: NOW - 120_000, context: { percent: 9, asOf: NOW - 130_000 } });
 assert.ok(!JSON.stringify(r).includes('sentinel') && !JSON.stringify(r).includes('synthetic-title'));
 await clean(base);
});

test('the session without messages still gives the model; missing and malformed messages give only a context code', async () => {
 const { base, home } = await temp();
 const dir = await put(home, 'ws', 'a', { model: 'auto' });
 let r = await read(home); assert.equal(r.code, 'ok'); assert.deepEqual(r.code === 'ok' && [r.observation.modelId, r.observation.context, r.contextCode], ['auto', undefined, 'error']);
 await writeFile(join(dir, 'messages.jsonl'), ''); r = await read(home); assert.deepEqual(r.code === 'ok' && r.contextCode, 'no_candidate');
 await writeFile(join(dir, 'messages.jsonl'), 'not json {"a":"session_metadata","b":"contextUsage"}\n'); r = await read(home); assert.deepEqual(r.code === 'ok' && r.contextCode, 'invalid_shape');
 await writeFile(join(dir, 'messages.jsonl'), ctx(NOW - 100_000, 106)); r = await read(home); assert.deepEqual(r.code === 'ok' && r.contextCode, 'out_of_range');
 await writeFile(join(dir, 'messages.jsonl'), ctx(NOW - 100_000, 104)); r = await read(home); assert.deepEqual(r.code === 'ok' && r.observation.context?.percent, 100);
 await writeFile(join(dir, 'messages.jsonl'), ctx(NOW - 100_000, 5).trimEnd()); r = await read(home); assert.deepEqual(r.code === 'ok' && r.contextCode, 'no_candidate'); // unterminated last line
 await clean(base);
});

test('selection: newest by modification time wherever it sits in the listing; ties are deterministic; the cli folder is skipped', async () => {
 const { base, home } = await temp();
 for (const n of ['a', 'b', 'c']) await put(home, 'ws', `synthetic-${n}`, { model: `synthetic-${n}`, last: NOW - 600_000, mtime: NOW - 600_000 });
 await put(home, 'ws', 'synthetic-0-newest-but-listed-first', { model: 'synthetic-first', last: NOW - 900_000 });
 await put(home, 'ws', 'zzz-newest', { model: 'synthetic-newest', last: NOW - 60_000 });
 await put(home, 'cli', 'synthetic-cli', { model: 'synthetic-cli', last: NOW - 1_000 }); // the cli folder is never listed
 const r = await read(home); assert.equal(r.code === 'ok' && r.observation.modelId, 'synthetic-newest');
 await rm(join(home, '.kiro', 'sessions', 'ws', 'zzz-newest'), { recursive: true });
 await rm(join(home, '.kiro', 'sessions', 'ws', 'synthetic-0-newest-but-listed-first'), { recursive: true });
 const t1 = await read(home), t2 = await read(home); assert.deepEqual(t1, t2); assert.equal(t1.code === 'ok' && t1.observation.modelId, 'synthetic-c'); // equal times: greatest folder name
 await clean(base);
});

test('at most 20 session.json files are opened per tick; a session outside the newest 20 is silent; listing caps give a fixed code', async () => {
 const { base, home } = await temp();
 for (let i = 0; i < 25; i++) await put(home, 'ws', `synthetic-${String(i).padStart(2, '0')}`, { model: 'auto', paths: ['/synthetic/elsewhere'], last: NOW - 60_000 - i * 1_000 });
 const mine = await put(home, 'ws', 'synthetic-mine-oldest', { model: 'auto', last: NOW - 3_000_000 });
 const log: string[] = [];
 const r = await read(home, { fs: spyFs(log) });
 assert.deepEqual(r, { code: 'no_match', opened: READER_LIMITS.openPerTick, capped: 0 });
 assert.equal(log.filter(l => l.startsWith('open ')).length, 20); assert.ok(!log.some(l => l.startsWith('open ') && l.includes(mine)));
 assert.ok(log.filter(l => l.startsWith('open ')).every(l => l.endsWith(' 0'))); // O_RDONLY only
 await clean(base);
 const big = await temp();
 for (let i = 0; i < READER_LIMITS.entriesPerLevel + 1; i++) await mkdir(join(big.home, '.kiro', 'sessions', `synthetic-ws-${i}`));
 assert.deepEqual(await read(big.home), { code: 'listing_capped', opened: 0, capped: 0 });
 await clean(big.base);
 const deep = await temp();
 for (let i = 0; i < READER_LIMITS.entriesPerLevel + 1; i++) await mkdir(join(deep.home, '.kiro', 'sessions', 'ws', `synthetic-${i}`), { recursive: true });
 const skipped = await read(deep.home); assert.deepEqual([skipped.code, skipped.capped], ['listing_capped', 1]); // an over-full folder is skipped and counted
 await put(deep.home, 'ws-other', 'fine', { model: 'auto' }); // ... and the other folders are still checked
 const others = await read(deep.home); assert.deepEqual([others.code, others.capped], ['ok', 1]);
 await rm(join(deep.home, '.kiro', 'sessions', 'ws', 'synthetic-200'), { recursive: true }); // exactly at the cap is fine
 assert.deepEqual([(await read(deep.home)).code, (await read(deep.home)).capped], ['ok', 0]);
 await clean(deep.base);
});

test('timestamps are strict: future, far from the file time, non-ISO and offset-less values reject the candidate; old sessions are inactive', async () => {
 for (const [o, code] of [
  [{ last: NOW + 6 * 60_000 }, 'no_match'], [{ last: NOW - 120_000, mtime: NOW - 120_000 - 11 * 60_000 }, 'no_match'], [{ last: NOW - 120_000, mtime: NOW - 120_000 + 11 * 60_000 }, 'no_match'],
  [{ lastText: '2026-10-18 11:58:00' }, 'no_match'], [{ lastText: '2026-10-18T11:58:00' }, 'no_match'], [{ lastText: 'yesterday' }, 'no_match'],
  [{ last: NOW - 13 * 3_600_000 }, 'stale'], [{ last: NOW - 11 * 3_600_000 }, 'ok'], [{ last: NOW + 4 * 60_000, mtime: NOW + 4 * 60_000 }, 'ok'], [{ last: NOW - 120_000, mtime: NOW - 120_000 + 9 * 60_000 }, 'ok'],
  [{ schema: '9.9.9' }, 'no_match'], [{ raw: '{not json' }, 'no_match'], [{ raw: '' }, 'no_match'], [{ raw: 'x'.repeat(LIMITS.sessionJsonBytes + 1) }, 'no_match'], [{ raw: '[]' }, 'no_match'],
  [{ paths: ['/synthetic/project/'] }, 'ok'], [{ paths: ['/SYNTHETIC/Project'] }, 'ok'], [{ paths: ['/synthetic/project/sub'] }, 'no_match'], [{ paths: [] }, 'no_match'], [{ paths: 'x' }, 'no_match'],
  [{ paths: [FOLDER, 3] }, 'no_match'], [{ paths: Array.from({ length: 9 }, () => FOLDER) }, 'no_match'], [{ paths: ['/a'.padEnd(5000, 'a')] }, 'no_match'],
 ] as [Put, string][]) {
  const { base, home } = await temp();
  await put(home, 'ws', 'only', { messages: ctx(NOW - 100_000, 5), ...o });
  assert.equal((await read(home)).code, code, JSON.stringify(o).slice(0, 80));
  await clean(base);
 }
 const { base, home } = await temp();
 await put(home, 'ws', 'multi', { paths: ['/synthetic/one', '/synthetic/two'] });
 assert.equal((await readSession({ home, folders: ['/synthetic/zero', '/synthetic/two'], now: NOW })).code, 'ok'); // multi-root: any folder
 assert.equal((await readSession({ home, folders: ['/synthetic/zero'], now: NOW })).code, 'no_match');
 await clean(base);
});

test('NFC and NFD folder names match; no filesystem call happens during matching', async () => {
 const { base, home } = await temp();
 await put(home, 'ws', 'one', { paths: ['/synthetic/pröject'] });
 const log: string[] = [];
 const r = await readSession({ home, folders: ['/synthetic/pröject'], now: NOW, fs: spyFs(log) });
 assert.equal(r.code, 'ok');
 assert.ok(log.every(l => /^(lstat|readdir|open) /.test(l)) && !log.some(l => l.includes('pro')), 'no path derived from workspacePaths is ever touched');
 await clean(base);
});

test('a missing, symlinked or non-directory root fails closed', async () => {
 const none = await temp(); await rm(join(none.home, '.kiro'), { recursive: true });
 assert.deepEqual(await read(none.home), { code: 'no_root', opened: 0, capped: 0 }); await clean(none.base);
 const link = await temp(); const real = join(link.base, 'synthetic-real-kiro'); await mkdir(real); await rm(join(link.home, '.kiro'), { recursive: true }); await symlink(join(link.base, 'synthetic-elsewhere'), join(link.home, '.kiro'), 'dir');
 assert.equal((await read(link.home)).code, 'unsafe'); // a dangling symlink is still a symlink
 await rm(join(link.home, '.kiro')); await mkdir(join(real, 'sessions', 'ws', 's'), { recursive: true }); await symlink(real, join(link.home, '.kiro'), 'dir');
 assert.deepEqual(await read(link.home), { code: 'unsafe', opened: 0, capped: 0 }); // ~/.kiro is a symlink: silent
 await clean(link.base);
 const sess = await temp(); const target = join(sess.base, 'synthetic-target'); await mkdir(target);
 await rm(join(sess.home, '.kiro', 'sessions'), { recursive: true }); await symlink(target, join(sess.home, '.kiro', 'sessions'), 'dir');
 assert.equal((await read(sess.home)).code, 'unsafe'); await clean(sess.base);
 const file = await temp(); await rm(join(file.home, '.kiro', 'sessions'), { recursive: true }); await writeFile(join(file.home, '.kiro', 'sessions'), 'x');
 assert.equal((await read(file.home)).code, 'no_root'); await clean(file.base);
 const homeLink = await temp(); const alias = join(homeLink.base, 'synthetic-home-alias'); await symlink(homeLink.home, alias, 'dir');
 assert.equal((await read(alias)).code, 'unsafe'); await clean(homeLink.base);
});

test('symlinks inside the tree are never followed: session folder, workspace folder, session.json, messages.jsonl', async () => {
 const { base, home } = await temp();
 const outside = join(base, 'synthetic-outside'); await mkdir(outside);
 const realDir = await put(outside, 'ws', 'real', { model: 'claude-sonnet-4.5', messages: ctx(NOW - 60_000, 77) });
 const sessions = join(home, '.kiro', 'sessions');
 await mkdir(join(sessions, 'ws-direct'), { recursive: true });
 await symlink(realDir, join(sessions, 'ws-direct', 'linked-session'), 'dir'); // symlinked session folder
 await symlink(join(outside, '.kiro', 'sessions', 'ws'), join(sessions, 'linked-ws'), 'dir'); // symlinked workspace folder
 await mkdir(join(sessions, 'ws-file', 'sess'), { recursive: true }); await symlink(join(realDir, 'session.json'), join(sessions, 'ws-file', 'sess', 'session.json')); // symlinked session.json
 // the symlinked session folder is refused while listing: no session.json is opened at all
 assert.deepEqual(await read(home), { code: 'no_match', opened: 0, capped: 0 });
 // a valid session whose messages.jsonl is a symlink: the model is kept, the context is refused with a fixed code
 const ok = await put(home, 'ws-ok', 'sess', { model: 'auto' });
 await symlink(join(realDir, 'messages.jsonl'), join(ok, 'messages.jsonl'));
 const r = await read(home); assert.equal(r.code, 'ok'); assert.deepEqual(r.code === 'ok' && [r.observation.context, r.contextCode], [undefined, 'unsafe']);
 await clean(base);
});

test('special files are not opened: a FIFO as session.json or messages.jsonl does not block', { skip: process.platform === 'win32' }, async () => {
 const { base, home } = await temp();
 const dir = join(home, '.kiro', 'sessions', 'ws', 'fifo'); await mkdir(dir, { recursive: true });
 execFileSync('mkfifo', [join(dir, 'session.json')]);
 const log: string[] = [];
 assert.equal((await read(home, { fs: spyFs(log) })).code, 'no_match'); assert.ok(!log.some(l => l.startsWith('open ')));
 const good = await put(home, 'ws', 'good'); execFileSync('mkfifo', [join(good, 'messages.jsonl')]);
 const r = await read(home, { fs: spyFs(log) }); assert.equal(r.code, 'ok'); assert.deepEqual(r.code === 'ok' && r.contextCode, 'unsafe');
 await clean(base);
});

test('nothing is created or modified under the root, and files are opened read-only', async () => {
 const { base, home } = await temp();
 await put(home, 'ws', 'a', { messages: ctx(NOW - 100_000, 12) }); await put(home, 'ws', 'b', { model: 'auto', messages: ctx(NOW - 100_000, 13) });
 const snap = async (dir: string): Promise<string[]> => { const out: string[] = []; for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) { const p = join(e.parentPath, e.name); const s = await lstat(p); out.push(`${relative(home, p)} ${s.size} ${s.mtimeMs} ${s.ino}`); } return out.sort(); };
 const before = await snap(home), content = await readFile(join(home, '.kiro', 'sessions', 'ws', 'a', 'session.json'), 'utf8');
 const log: string[] = [];
 for (let i = 0; i < 3; i++) await read(home, { fs: spyFs(log) });
 assert.deepEqual(await snap(home), before); assert.equal(await readFile(join(home, '.kiro', 'sessions', 'ws', 'a', 'session.json'), 'utf8'), content);
 const opens = log.filter(l => l.startsWith('open ')); assert.ok(opens.length > 0 && opens.every(l => l.endsWith(' 0')));
 await clean(base);
});

test('sentinels: titles, display text, workspace paths, folder names, message content and thrown error messages never reach a result', async () => {
 const { base, home } = await temp();
 await put(home, 'synthetic-folder-sentinel', 'synthetic-session-sentinel', { model: 'claude-sonnet-4.5', paths: [FOLDER, '/synthetic-path-sentinel'],
  messages: JSON.stringify({ timestamp: iso(NOW - 90_000), payload: { type: 'user', text: 'synthetic-prompt-sentinel', key: 'contextUsage' }, tag: 'session_metadata' }) + '\n' + ctx(NOW - 80_000, 31) });
 const r = await read(home);
 assert.equal(r.code, 'ok');
 const text = JSON.stringify(r);
 for (const word of ['title', 'display', 'path-sentinel', 'prompt-sentinel']) assert.ok(!text.includes(word), word);
 assert.deepEqual(Object.keys(r.code === 'ok' ? r.observation : {}).sort(), ['context', 'key', 'modelId', 'sessionAsOf']);
 const boom: SessionFs = { ...defaultFs, readdir: async () => { throw new Error('synthetic-error-sentinel /synthetic/secret/path'); } };
 const failed = await read(home, { fs: boom }); assert.deepEqual(failed, { code: 'error', opened: 0, capped: 0 }); assert.ok(!JSON.stringify(failed).includes('sentinel'));
 const boomOpen: SessionFs = { ...defaultFs, open: async () => { throw Object.assign(new Error('synthetic-error-sentinel'), { path: '/synthetic/secret/path' }); } };
 const noOpen = await read(home, { fs: boomOpen }); assert.ok(!JSON.stringify(noOpen).includes('sentinel')); assert.equal(noOpen.code, 'no_match');
 await clean(base);
});

test('abort: an aborted signal ends the read with a fixed code', async () => {
 const { base, home } = await temp();
 await put(home, 'ws', 'a', { messages: ctx(NOW - 60_000, 12) });
 const c = new AbortController(); c.abort();
 assert.equal((await read(home, { signal: c.signal })).code, 'aborted');
 await clean(base);
});

// ---- the shared bounded reader (tail and whole modes), with the real filesystem
const tailOf = async (content: Buffer | string, window: number) => {
 const { base, home } = await temp(); const dir = join(home, 'd'); await mkdir(dir); await writeFile(join(dir, 'm.jsonl'), content);
 const r = await readBounded(home, 'd/m.jsonl', { kind: 'tail', window }, { strict: true }); await clean(base);
 return r;
};
const text = (r: Awaited<ReturnType<typeof tailOf>>) => 'bytes' in r ? Buffer.from(r.bytes).toString('utf8') : r.code;
test('tail mode: smaller, equal and larger than the window; a partial first line is dropped, a complete one is kept', async () => {
 const six = Array.from({ length: 6 }, (_, i) => `line-${i}\n`).join(''); // seven bytes per line, 42 in all
 assert.equal(text(await tailOf(six.slice(0, 21), 1000)), six.slice(0, 21));
 assert.equal(text(await tailOf(six, 42)), six); // exactly the window
 assert.equal(text(await tailOf('', 100)), '');
 assert.equal(text(await tailOf(six, 21)), 'line-3\nline-4\nline-5\n'); // the byte before the window is "\n": the first line is complete and kept
 assert.equal(text(await tailOf(six, 20)), 'line-4\nline-5\n'); // the window starts inside a line: that line is dropped
 assert.equal(text(await tailOf(six, 22)), 'line-3\nline-4\nline-5\n'); // the byte before the window is the last character of line-2: dropped up to its newline
 assert.equal(text(await tailOf('x'.repeat(100), 10)), ''); // no newline: nothing complete
 assert.equal(text(await tailOf('a\n' + 'y'.repeat(50) + '\n', 10)), ''); // the window lies inside one long line
 assert.equal(text(await tailOf('a\n' + 'y'.repeat(9) + '\n', 10)), 'yyyyyyyyy\n');
 // a multi-byte character straddling the window start goes away with its partial line, never as a replacement character
 const multi = Buffer.from('ä€😀 partial\nfull-line\n');
 for (let w = 10; w < multi.length; w++) { const out = text(await tailOf(multi, w)); assert.equal(out, 'full-line\n', String(w)); }
 assert.equal(text(await tailOf(multi, multi.length)), multi.toString('utf8'));
});
const sessionWith = async (messages: string) => { const t = await temp(); await put(t.home, 'ws', 'a', { messages }); return t; };
test('tail mode: a file larger than 256 KiB is read by its tail only, wipe() zero-fills, and a missing candidate is not "too large"', async () => {
 const filler = ('x'.repeat(99) + '\n').repeat(4000); // about 400 KB
 const content = filler + ctx(NOW - 1000, 55);
 const t = await sessionWith(content);
 const r = await readBounded(t.home, '.kiro/sessions/ws/a/messages.jsonl', { kind: 'tail', window: LIMITS.tailWindowBytes }, { strict: true });
 assert.ok('bytes' in r && r.bytes.length <= LIMITS.tailWindowBytes && r.bytes.length > LIMITS.tailWindowBytes - 200);
 if ('bytes' in r) { assert.ok(Buffer.from(r.bytes).toString().endsWith(ctx(NOW - 1000, 55))); const view = r.bytes; r.wipe(); assert.ok(view.every(b => b === 0)); }
 const out = await read(t.home); assert.deepEqual(out.code === 'ok' && out.observation.context, { percent: 55, asOf: NOW - 1000 });
 await clean(t.base);
 const u = await sessionWith(ctx(NOW - 5000, 40) + filler);
 const none = await read(u.home);
 assert.deepEqual(none.code === 'ok' && [none.contextCode, none.observation.context], ['no_candidate', undefined]);
 await clean(u.base);
});
test('whole mode keeps its byte cap and path rules', async () => {
 const { base, home } = await temp(); await writeFile(join(home, 'f.json'), 'a'.repeat(11));
 assert.deepEqual(await readBounded(home, 'f.json', { kind: 'whole', maxBytes: 10 }, { strict: true }), { code: 'oversized' });
 const ok = await readBounded(home, 'f.json', { kind: 'whole', maxBytes: 11 }, { strict: true }); assert.ok('bytes' in ok && ok.bytes.length === 11);
 assert.deepEqual(await readBounded(home, 'f.json', { kind: 'whole', maxBytes: 11 }, { names: ['other.json'] }), { code: 'not_allowed' });
 assert.deepEqual(await readBounded(home, '../f.json', { kind: 'whole', maxBytes: 11 }), { code: 'not_allowed' });
 assert.deepEqual(await readBounded('relative', 'f.json', { kind: 'whole', maxBytes: 11 }), { code: 'not_allowed' });
 assert.deepEqual(await readBounded(home, 'missing.json', { kind: 'whole', maxBytes: 11 }, { strict: true }), { code: 'unreadable' });
 await clean(base);
});

// ---- strict checks with an in-memory filesystem
interface St { size: number; ino: number; dev: number; mtimeMs: number; ancestorLink: boolean; fileDev: number }
interface Hooks { afterOpen?: () => void; duringRead?: () => void; afterRead?: () => void }
function fake(setup: (st: St) => Hooks = () => ({})) {
 const st: St = { size: 16, ino: 5, dev: 1, mtimeMs: 1000, ancestorLink: false, fileDev: 1 };
 const h = setup(st), log = { closed: 0, opened: 0, closeCalls: 0 }, pending = new Set<Promise<unknown>>(), data = Buffer.from('{"a":1}\n{"b":2}\n');
 const info = (isFile: boolean) => ({ isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => !isFile && st.ancestorLink, size: isFile ? st.size : 0, ino: isFile ? st.ino : 9, dev: isFile ? st.fileDev : st.dev, mtimeMs: isFile ? st.mtimeMs : 1 });
 const fs: ReadFs = {
  async lstat(p) { return info(p.endsWith('.jsonl')); },
  async open() {
   log.opened++; h.afterOpen?.();
   return {
    async stat() { return info(true); },
    read(buf, off, len, pos) { const p = (async () => { h.duringRead?.(); const n = Math.min(len, Math.max(0, st.size - pos), data.length - pos); if (n <= 0) return { bytesRead: 0 }; data.copy(buf, off, pos, pos + n); h.afterRead?.(); return { bytesRead: n }; })(); pending.add(p); void p.finally(() => pending.delete(p)).catch(() => undefined); return p; },
    async close() { log.closeCalls++; await Promise.allSettled([...pending]); log.closed++; }, // like Node, close waits for a pending read
   };
  },
 };
 return { fs, st, log };
}
const run = (f: ReturnType<typeof fake>, signal?: AbortSignal) => readBounded('/synthetic-root', 'a/m.jsonl', { kind: 'tail', window: 100 }, { fs: f.fs, strict: true, signal });
test('strict mode: any change between the checks, an unsafe ancestor or another device gives a fixed code, and the handle is always closed', async () => {
 const good = fake(); const r = await run(good); assert.ok('bytes' in r && r.bytes.length === 16); assert.equal(good.log.closed, 1);
 const cases: [string, (st: St) => Hooks, string][] = [
  ['size grows during the read', st => ({ duringRead: () => { st.size = 20; } }), 'changed'],
  ['mtime changes during the read', st => ({ afterRead: () => { st.mtimeMs = 2000; } }), 'changed'],
  ['inode swapped during the read', st => ({ afterRead: () => { st.ino = 6; } }), 'changed'],
  ['an ancestor becomes a symlink after the read', st => ({ afterRead: () => { st.ancestorLink = true; } }), 'changed'],
  ['inode swapped between lstat and open', st => ({ afterOpen: () => { st.ino = 7; } }), 'unsafe'],
  ['file on another device than the root', st => { st.fileDev = 2; return {}; }, 'unsafe'],
  ['device changes after open', st => ({ afterOpen: () => { st.fileDev = 2; } }), 'unsafe'],
 ];
 for (const [name, setup, code] of cases) { const f = fake(setup); assert.deepEqual(await run(f), { code }, name); assert.equal(f.log.closed, f.log.opened, name); }
});
test('abort in the middle of a read closes the handle and returns a fixed code; an already aborted signal opens nothing', async () => {
 const c = new AbortController();
 const f = fake(() => ({ duringRead: () => c.abort() }));
 assert.deepEqual(await run(f, c.signal), { code: 'aborted' }); assert.equal(f.log.opened, 1); await new Promise(r => setTimeout(r, 10)); assert.deepEqual([f.log.closeCalls, f.log.closed], [1, 1]);
 const pre = new AbortController(); pre.abort(); const g = fake();
 assert.deepEqual(await run(g, pre.signal), { code: 'aborted' }); assert.equal(g.log.opened, 0);
 // a read that is still pending at the abort is abandoned at once; the handle is closed exactly once, and only after the read has finished (as Node does)
 const k = new AbortController(); const h = fake(); let finish!: () => void; const hung = new Promise<void>(r => { finish = r; });
 const slow: ReadFs = { ...h.fs, open: async (p: string, fl: number) => { const handle = await h.fs.open(p, fl); return { ...handle, read: async () => { await hung; return { bytesRead: 0 }; }, close: async () => { await hung; await handle.close(); } }; } };
 const wait = readBounded('/synthetic-root', 'a/m.jsonl', { kind: 'tail', window: 100 }, { fs: slow, strict: true, signal: k.signal });
 setTimeout(() => k.abort(), 10); assert.deepEqual(await wait, { code: 'aborted' });
 assert.equal(h.log.closed, 0); // the abort did not wait for the close, which waits for the hung read
 finish(); await new Promise(r => setTimeout(r, 20)); assert.deepEqual([h.log.closeCalls, h.log.closed], [1, 1]);
});
test('a zero-length or growing file in tail mode is handled without reading beyond what fstat reported', async () => {
 const f = fake(st => { st.size = 0; return {}; }); const r = await run(f); assert.ok('bytes' in r && r.bytes.length === 0);
});

test('a hanging filesystem call during the listing is abandoned at the abort', async () => {
 const { base, home } = await temp();
 await put(home, 'ws', 'a');
 const c = new AbortController();
 const hang: SessionFs = { ...defaultFs, lstat: p => p.endsWith('session.json') ? new Promise(() => undefined) : defaultFs.lstat(p) };
 setTimeout(() => c.abort(), 20);
 assert.equal((await read(home, { fs: hang, signal: c.signal })).code, 'aborted');
 await clean(base);
});
test('an open that finishes after the abort is closed anyway; the buffer is wiped only after the close', async () => {
 const c = new AbortController(); const order: string[] = [];
 let release!: () => void;
 const late = new Promise<void>(r => { release = r; });
 const fs: ReadFs = {
  async lstat(p) { const f = p.endsWith('.jsonl'); return { isFile: () => f, isDirectory: () => !f, isSymbolicLink: () => false, size: 4, dev: 1, ino: f ? 5 : 9 }; },
  async open() { await late; order.push('opened'); return { async stat() { return { isFile: () => true, size: 4, dev: 1, ino: 5 }; }, async read() { return { bytesRead: 0 }; }, async close() { order.push('closed'); } }; },
 };
 const pending = readBounded('/synthetic-root', 'a/m.jsonl', { kind: 'whole', maxBytes: 100 }, { fs, strict: true, signal: c.signal });
 setTimeout(() => c.abort(), 10);
 assert.deepEqual(await pending, { code: 'aborted' });
 release(); await new Promise(r => setTimeout(r, 20));
 assert.deepEqual(order, ['opened', 'closed']);
});
