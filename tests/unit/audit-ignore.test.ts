import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseIgnore, evaluate, IGNORE_LIMITS, type IgnoreSource, type ParsedIgnore } from '../../src/audit/ignore.ts';
import { readIgnoreFile, validIgnoreNames, READ_LIMITS, type ReadFs } from '../../src/audit/read-ignore.ts';
const temp = async () => { const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-audit-')); const root = join(base, 'synthetic-root'); await mkdir(root); return { base, root }; };
const put = async (root: string, rel: string, text: string | Buffer = '') => { const p = join(root, ...rel.split('/')); await mkdir(join(p, '..'), { recursive: true }); await writeFile(p, text); };
const parse = (t: string): ParsedIgnore => parseIgnore(t)!;
const src = (dir: string, text: string, file = dir ? `${dir}/.gitignore` : '.gitignore'): IgnoreSource => ({ dir, file, parsed: parse(text) });
const status = (p: string, isDir: boolean, ...s: IgnoreSource[]) => evaluate(p, isDir, s).status;
const hit = (pattern: string, p: string, isDir = false) => status(p, isDir, src('', pattern)) === 'ignored';

test('parses comments, blanks, escapes, trailing spaces and negation', () => {
 const r = parse('# comment\n\n   \nfoo\r\n\\#hash\n\\!bang\n!neg\nsp\\ \ntrail   \n');
 assert.deepEqual(r.rules.map(x => [x.line, x.negate]), [[4, false], [5, false], [6, false], [7, true], [8, false], [9, false]]); assert.equal(r.skipped, 0);
 assert.ok(hit('\\#hash', '#hash')); assert.ok(hit('\\!bang', '!bang')); assert.ok(!hit('\\!bang', 'bang'));
 assert.ok(hit('sp\\ ', 'sp ')); assert.ok(!hit('sp\\ ', 'sp')); assert.ok(hit('trail   ', 'trail')); assert.ok(!hit('# c', '# c')); assert.ok(hit('﻿bom', 'bom'));
});
test('derives anchored and dirOnly flags', () => {
 const f = (t: string) => { const x = parse(t).rules[0]!; return [x.anchored, x.dirOnly, x.negate]; };
 assert.deepEqual(f('a'), [false, false, false]); assert.deepEqual(f('/a'), [true, false, false]); assert.deepEqual(f('a/b'), [true, false, false]);
 assert.deepEqual(f('a/'), [false, true, false]); assert.deepEqual(f('!/a/b/'), [true, true, true]);
 assert.ok(hit('/a', 'a')); assert.ok(!hit('/a', 'x/a')); assert.ok(hit('a', 'x/y/a')); assert.ok(hit('a/b', 'a/b')); assert.ok(!hit('a/b', 'x/a/b'));
});
test('compiles wildcards, classes and double-star forms', () => {
 assert.ok(hit('a*c', 'abc')); assert.ok(hit('a*c', 'ac')); assert.ok(!hit('a*c', 'a/c')); assert.ok(hit('f?o', 'fxo')); assert.ok(!hit('f?o', 'f/o')); assert.ok(!hit('f?o', 'fo'));
 assert.ok(hit('[ab]x', 'ax')); assert.ok(!hit('[ab]x', 'cx')); assert.ok(hit('[!a]y', 'by')); assert.ok(!hit('[!a]y', 'ay')); assert.ok(hit('[a-c]z', 'bz')); assert.ok(!hit('[a-c]z', 'dz'));
 assert.ok(hit('[]a]q', ']q')); assert.ok(hit('[a\\]]w', ']w')); assert.ok(!hit('[?]k', 'xk')); assert.ok(hit('[?]k', '?k'));
 assert.ok(hit('**/x', 'x')); assert.ok(hit('**/x', 'a/x')); assert.ok(hit('**/x', 'a/b/x')); assert.ok(!hit('**/x', 'a/xy'));
 assert.ok(hit('x/**', 'x/a')); assert.ok(hit('x/**', 'x/a/b')); assert.ok(!hit('x/**', 'x')); assert.ok(!hit('x/**', 'y/x/a'));
 assert.ok(hit('a/**/b', 'a/b')); assert.ok(hit('a/**/b', 'a/x/b')); assert.ok(hit('a/**/b', 'a/x/y/b')); assert.ok(!hit('a/**/b', 'ab')); assert.ok(!hit('a/**/b', 'a/bb'));
 assert.ok(hit('app*.log', 'src/app/app-test.log')); assert.ok(hit('a/**/b*c', 'a/x/b/bzc')); assert.ok(hit('**/app*.log', 'src/app/app-test.log')); assert.ok(!hit('**/app*.log', 'src/app/pp.log')); assert.ok(hit('a**b', 'axb')); assert.ok(!hit('a**b', 'a/b')); assert.ok(hit('.env.*', 'x/.env.local')); assert.ok(!hit('a.b', 'axb')); assert.ok(hit('(x)+', '(x)+'));
});
test('counts lines that cannot be compiled and enforces the rule limit', () => {
 const r = parse('ok\nfoo\\\n[b-a]\n/\n!\n[:alpha:]x\n[[:digit:]]\n[x\na//b\nlast'); assert.deepEqual(r.rules.map(x => x.line), [1, 6, 10]); assert.equal(r.skipped, 7);
 assert.equal(parse('x'.repeat(5_000)).skipped, 1);
 const lines = (n: number) => Array.from({ length: n }, (_, i) => `synthetic-${i}`).join('\n');
 assert.equal(parse(lines(IGNORE_LIMITS.maxRules)).rules.length, 2_000); assert.equal(parseIgnore(lines(IGNORE_LIMITS.maxRules + 1)), undefined); assert.deepEqual(parse(''), { rules: [], skipped: 0 });
});
test('evaluates with no sources, source location and last-match-wins', () => {
 assert.deepEqual(evaluate('a/b', false, []), { status: 'not_covered' }); assert.equal(status('', true, src('', '*')), 'not_covered');
 assert.deepEqual(evaluate('x.log', false, [src('', '# c\n*.log', '.kiroignore')]), { status: 'ignored', source: { file: '.kiroignore', line: 2 } });
 assert.equal(status('keep.log', false, src('', '*.log\n!keep.log')), 'not_covered'); assert.deepEqual(evaluate('keep.log', false, [src('', '*.log\n!keep.log')]), { status: 'not_covered', source: { file: '.gitignore', line: 2 } });
 assert.equal(status('keep.log', false, src('', '*.log\n!keep.log\nkeep.log')), 'ignored'); assert.equal(status('x.txt', false, src('', '*.log')), 'not_covered');
});
test('deeper ignore files take precedence for paths below them', () => {
 const root = src('', '*.md\nlocal/'), sub = src('sub', '!*.md'), deep = src('sub/deep', '*.md');
 assert.deepEqual(evaluate('a.md', false, [root, sub]), { status: 'ignored', source: { file: '.gitignore', line: 1 } });
 assert.deepEqual(evaluate('sub/a.md', false, [root, sub]), { status: 'not_covered', source: { file: 'sub/.gitignore', line: 1 } });
 assert.equal(status('sub/deep/a.md', false, deep, sub, root), 'ignored'); assert.equal(status('other/a.md', false, sub), 'not_covered');
 assert.equal(status('sub/x/a.md', false, sub, src('sub2', '*.md')), 'not_covered'); assert.equal(status('sub/local/f.txt', false, root, sub), 'ignored');
 assert.equal(status('foo', false, src('', 'foo', '.gitignore'), src('', '!foo', '.kiroignore')), 'unknown'); assert.equal(status('foo', false, src('', 'foo', '.gitignore'), src('', 'foo', '.kiroignore')), 'ignored');
 assert.deepEqual(evaluate('sub/only', false, [src('sub', '/only')]), { status: 'ignored', source: { file: 'sub/.gitignore', line: 1 } }); assert.equal(status('sub/x/only', false, src('sub', '/only')), 'not_covered');
});
test('an excluded parent directory cannot be re-included', () => {
 const s = src('', 'secrets/\n!secrets/public.txt');
 assert.deepEqual(evaluate('secrets/public.txt', false, [s]), { status: 'ignored', source: { file: '.gitignore', line: 1 } }); assert.equal(status('secrets/a/b', false, s), 'ignored');
 assert.equal(status('secrets', true, s), 'ignored'); assert.equal(status('secrets', false, s), 'not_covered');
 const w = src('', 'out/*\n!out/keep.txt'); assert.equal(status('out/keep.txt', false, w), 'not_covered'); assert.equal(status('out/x.txt', false, w), 'ignored');
 assert.equal(status('x/secrets/f', false, s, src('x', '!f')), 'ignored');
});
test('directory-only rules match directories and everything beneath them', () => {
 const s = src('', 'build/\ndocs/*.tmp\n/dist');
 assert.equal(status('build', true, s), 'ignored'); assert.equal(status('build', false, s), 'not_covered'); assert.equal(status('lib/build', false, s), 'not_covered');
 assert.equal(status('build/out.txt', false, s), 'ignored'); assert.equal(status('lib/build/out.txt', false, s), 'ignored'); assert.equal(status('lib/build', true, s), 'ignored');
 assert.equal(status('docs/a.tmp', false, s), 'ignored'); assert.equal(status('docs/d/a.tmp', false, s), 'not_covered'); assert.equal(status('dist/a.js', false, s), 'ignored'); assert.equal(status('src/dist/a.js', false, s), 'not_covered');
});
test('an unavailable source makes the affected result unknown', () => {
 const none = (dir: string): IgnoreSource => ({ dir, file: `${dir}/.gitignore`, unavailable: true });
 assert.equal(status('a/b', false, none('')), 'unknown'); assert.equal(status('a', true, none('')), 'unknown'); assert.equal(status('a/b', false, none(''), src('', 'a/')), 'unknown');
 assert.equal(status('sub/x', false, none('sub')), 'unknown'); assert.equal(status('sub', true, none('sub')), 'not_covered'); assert.equal(status('other/x', false, none('sub')), 'not_covered');
 assert.equal(status('sub/x', false, src('', 'sub/'), none('sub')), 'ignored');
 assert.equal(status('sub/deep/x', false, src('', '!x'), none('sub')), 'unknown'); assert.equal(status('subx/y', false, none('sub')), 'not_covered'); assert.deepEqual(evaluate('a', false, [none('')]), { status: 'unknown' });
});
test('partially compiled sources, source order and letter case make results unknown', () => {
 assert.equal(status('a', false, src('', 'a\n[x')), 'unknown'); assert.equal(status('b/a', false, src('', 'a\n[x'), src('b', 'q')), 'unknown'); assert.equal(status('z', false, src('b', 'a\n[x')), 'not_covered');
 assert.equal(status('foo', false, src('', 'Foo')), 'unknown'); assert.equal(status('Foo', false, src('', 'Foo')), 'ignored'); assert.equal(status('bar', false, src('', 'Foo')), 'not_covered');
 assert.equal(status('x/Foo', false, src('', '*.log\n!foo')), 'not_covered'); assert.equal(status('X.LOG', false, src('', '*.log')), 'unknown');
});
test('combines star and double-star segments and negation correctly', () => {
 assert.equal(status('src/app/app-test.log', false, src('', '*.log\n!app*.log')), 'not_covered'); assert.equal(status('src/app/x.log', false, src('', '*.log\n!app*.log')), 'ignored');
 assert.ok(hit('a/**/**/b', 'a/b')); assert.ok(hit('a/**/**/b', 'a/x/y/b')); assert.ok(hit('**/a/**', 'q/a/b')); assert.ok(!hit('**/a/**', 'q/a')); assert.ok(hit('*/b', 'a/b')); assert.ok(!hit('*/b', 'x/a/b'));
});
test('pathological patterns evaluate in linear time', () => {
 const long = 'a'.repeat(10_000), t0 = Date.now();
 assert.equal(status(long, false, src('', 'a*a*a*a*a*a*a*b')), 'not_covered'); assert.equal(status(long, false, src('', '*a*a*a*a*a*a*b')), 'not_covered'); assert.equal(status(`${long}/${long}`, false, src('', '**/a**/a*a*a*a*a*a*b')), 'not_covered');
 assert.equal(status(`${long}b`, false, src('', 'a*a*a*a*a*a*a*b')), 'ignored'); assert.equal(status(long, false, src('', '[a][a]*[a]*[a]*[a]*[a]*[a]*c')), 'not_covered');
 assert.ok(Date.now() - t0 < 200);
});
// Differential test: compare against `git check-ignore --no-index` in an isolated synthetic repository.
const hasGit = spawnSync('git', ['--version']).status === 0;
test('matches git check-ignore for a synthetic tree', async t => {
 if (!hasGit) return t.skip('git is not available');
 const base = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-audit-')), repo = join(base, 'synthetic-repo'), empty = join(base, 'synthetic-empty-config');
 await mkdir(repo); await writeFile(empty, '');
 const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: base, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_SYSTEM: empty, GIT_CONFIG_NOSYSTEM: '1', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
 const git = (...args: string[]) => spawnSync('git', ['-c', 'core.excludesFile=', ...args], { cwd: repo, env, encoding: 'utf8' });
 try {
  assert.equal(git('init', '-q').status, 0);
  const files: Record<string, string> = {
   '': '# synthetic\n*.log\n!keep.log\nbuild/\n/dist\ndocs/*.tmp\n**/cache\nlogs/**\na/**/z\nsecrets/\n!secrets/public.txt\nfoo?.txt\n[ab]x.txt\n[!a]y.txt\n\\#hash.txt\n\\!bang.txt\n*.o\nnested/deep/*.md\nout/*\n!out/keep.txt\napp*.log\na2/**/b*c\n**/ap?.dat\nx*/y?/*.cfg\n*.trc\n!app*.trc\n',
   sub: '!other.log\n*.md\n/only-here.txt\n', 'sub/deep': '!*.md\nlocal/\n',
  };
  for (const [dir, text] of Object.entries(files)) await put(repo, dir ? `${dir}/.gitignore` : '.gitignore', text);
  const entries = ['src/app/app-test.log', 'src/app/pp.log', 'a2/x/b/bzc', 'a2/bc', 'a2/q/bxc', 'a2/q/zzz', 'ap1.dat', 'd/ap2.dat', 'd/bp.dat', 'x1/y1/z.cfg', 'x1/y1/w/z.cfg', 'x1/yy/z.cfg', 's.trc', 'app.trc', 'd/app9.trc', 'a.log', 'keep.log', 'x/debug.log', 'build/', 'build/out.txt', 'src/build.txt', 'lib/build', 'dist/', 'dist/a.js', 'src/dist/a.js', 'docs/a.tmp', 'docs/deep/b.tmp', 'cache/', 'cache/x', 'src/cache/', 'src/cache/y', 'logs/', 'logs/a.txt', 'logs/n/', 'logs/n/b.txt',
   'a/z', 'a/b/z', 'a/b/c/z', 'a/zz', 'secrets/', 'secrets/private.txt', 'secrets/public.txt', 'fooa.txt', 'foo.txt', 'ax.txt', 'bx.txt', 'cx.txt', 'ay.txt', 'by.txt', '#hash.txt', '!bang.txt', 'm.o', 'src/m.o', 'nested/deep/n.md', 'nested/n.md', 'out/x.txt', 'out/keep.txt',
   'sub/keep.log', 'sub/other.log', 'sub/a.log', 'sub/readme.md', 'sub/only-here.txt', 'sub/x/only-here.txt', 'sub/deep/readme.md', 'sub/deep/local/', 'sub/deep/local/f.txt', 'sub/deep/z.log', 'sub/deep/n.md', '.gitignore', 'sub/.gitignore', 'sub/deep/.gitignore'];
  for (const e of entries) { if (e.endsWith('/')) await mkdir(join(repo, ...e.slice(0, -1).split('/')), { recursive: true }); else if (!e.endsWith('.gitignore')) await put(repo, e, 'x'); }
  const sources = Object.entries(files).map(([dir, text]) => src(dir, text)); assert.ok(sources.every(s => 'parsed' in s && s.parsed.skipped === 0));
  assert.ok(entries.every(e => evaluate(e.replace(/\/$/, ''), e.endsWith('/'), sources).status !== 'unknown'));
  assert.ok(entries.length >= 30); let ignored = 0;
  for (const e of entries) {
   const isDir = e.endsWith('/'), p = isDir ? e.slice(0, -1) : e, r = git('check-ignore', '--no-index', '-q', '--', p);
   assert.ok(r.status === 0 || r.status === 1, `git failed for ${p}`);
   assert.equal(evaluate(p, isDir, sources).status, r.status === 0 ? 'ignored' : 'not_covered', `mismatch for ${p}`); if (r.status === 0) ignored++;
  }
  assert.ok(ignored > 10 && ignored < entries.length - 10);
 } finally { await rm(base, { recursive: true, force: true }); }
});
const allowed = ['.gitignore', '.kiroignore'];
test('reads an allowed ignore file, strips a BOM and reads nested files', async () => {
 const t = await temp(); await put(t.root, '.gitignore', 'synthetic-a\n'); await put(t.root, '.kiroignore', '﻿synthetic-b\n'); await put(t.root, 'sub/deep/.gitignore', 'synthetic-c'); await put(t.root, 'empty/.gitignore', '');
 assert.deepEqual(await readIgnoreFile(t.root, '.gitignore', allowed), { text: 'synthetic-a\n' }); assert.deepEqual(await readIgnoreFile(t.root, '.kiroignore', allowed), { text: 'synthetic-b\n' });
 assert.deepEqual(await readIgnoreFile(t.root, 'sub/deep/.gitignore', allowed), { text: 'synthetic-c' }); assert.deepEqual(await readIgnoreFile(t.root, 'empty/.gitignore', allowed), { text: '' });
 assert.deepEqual(await readIgnoreFile(t.root, 'sub/missing/.gitignore', allowed), { code: 'unreadable' }); await rm(t.base, { recursive: true });
});
test('refuses names and paths that are not allowed', async () => {
 const t = await temp(); await put(t.root, 'other.txt', 'x'); await put(t.root, '.gitignore', 'x');
 for (const rel of ['other.txt', 'a/../.gitignore', '../.gitignore', '/.gitignore', '/abs/.gitignore', 'a\\.gitignore', '', 'a//.gitignore', './.gitignore', 'a/./.gitignore', '.gitignore/', 'a\u0000/.gitignore'])
  assert.deepEqual(await readIgnoreFile(t.root, rel, allowed), { code: 'not_allowed' }, rel);
 assert.deepEqual(await readIgnoreFile(t.root, '.gitignore', []), { code: 'not_allowed' }); assert.deepEqual(await readIgnoreFile('synthetic-relative', '.gitignore', allowed), { code: 'not_allowed' });
 await rm(t.base, { recursive: true });
});
test('rejects reads through a symlinked ancestor directory or root', async () => {
 const t = await temp(); const outside = join(t.base, 'synthetic-outside'); await put(outside, '.gitignore', 'synthetic-x'); await put(t.root, 'ok/.gitignore', 'synthetic-y');
 const kind = process.platform === 'win32' ? 'junction' : 'dir';
 await symlink(outside, join(t.root, 'synthetic-linked'), kind); await mkdir(join(t.root, 'real')); await symlink(outside, join(t.root, 'real', 'synthetic-deep-linked'), kind);
 assert.deepEqual(await readIgnoreFile(t.root, 'synthetic-linked/.gitignore', allowed), { code: 'unsafe' }); assert.deepEqual(await readIgnoreFile(t.root, 'real/synthetic-deep-linked/.gitignore', allowed), { code: 'unsafe' });
 assert.deepEqual(await readIgnoreFile(t.root, 'ok/.gitignore', allowed), { text: 'synthetic-y' });
 const rootLink = join(t.base, 'synthetic-root-link'); await symlink(t.root, rootLink, kind); assert.deepEqual(await readIgnoreFile(rootLink, 'ok/.gitignore', allowed), { code: 'unsafe' });
 await rm(t.base, { recursive: true });
});
test('rejects symlinks, directories, oversized files and invalid UTF-8', async () => {
 const t = await temp(); await put(t.root, 'synthetic-target.txt', 'secret-sentinel'); await symlink(join(t.root, 'synthetic-target.txt'), join(t.root, '.gitignore'));
 await mkdir(join(t.root, 'd', '.gitignore'), { recursive: true }); await put(t.root, 'big/.gitignore', 'a'.repeat(READ_LIMITS.maxBytes + 1)); await put(t.root, 'exact/.gitignore', 'a'.repeat(READ_LIMITS.maxBytes));
 await put(t.root, 'bad/.gitignore', Buffer.from([0x61, 0xff, 0xfe, 0x41])); await mkdir(join(t.root, 'linkdir')); await symlink(join(t.root, 'd'), join(t.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
 assert.deepEqual(await readIgnoreFile(t.root, '.gitignore', allowed), { code: 'unsafe' }); assert.deepEqual(await readIgnoreFile(t.root, 'd/.gitignore', allowed), { code: 'unsafe' });
 assert.deepEqual(await readIgnoreFile(t.root, 'big/.gitignore', allowed), { code: 'oversized' }); assert.equal((await readIgnoreFile(t.root, 'exact/.gitignore', allowed) as { text: string }).text.length, READ_LIMITS.maxBytes);
 assert.deepEqual(await readIgnoreFile(t.root, 'bad/.gitignore', allowed), { code: 'unreadable' }); assert.equal(READ_LIMITS.maxFiles, 200);
 const r = await readIgnoreFile(t.root, '.gitignore', allowed); assert.deepEqual(Object.keys(r), ['code']); assert.ok(!JSON.stringify(r).includes('sentinel') && !JSON.stringify(r).includes(t.base));
 await rm(t.base, { recursive: true });
});
type FakeOpts = { size?: number; statIno?: number; statDev?: number; readThrows?: boolean; statFile?: boolean; openThrows?: boolean; statSize?: number; closeThrows?: boolean; swapAfterOpen?: boolean };
const fakeFs = (o: FakeOpts = {}) => {
 const log = { closed: 0, flags: [] as number[] }, data = Buffer.from('abc');
 const fs: ReadFs = {
  async lstat(p) { const f = p.endsWith('.gitignore'), swapped = o.swapAfterOpen && log.flags.length > 0 && !f; return { isFile: () => f, isDirectory: () => !f, isSymbolicLink: () => !!swapped, size: o.size ?? 3, dev: 1, ino: 1 }; },
  async open(_p, flags) {
   if (o.openThrows) throw new Error('synthetic-failure'); log.flags.push(flags);
   return {
    async stat() { return { isFile: () => o.statFile ?? true, size: o.statSize ?? 3, dev: o.statDev ?? 1, ino: o.statIno ?? 1 }; },
    async read(buf, off, len, pos) { if (o.readThrows) throw new Error('synthetic-failure'); const n = Math.min(len, Math.max(0, data.length - pos)); data.copy(buf, off, pos, pos + n); return { bytesRead: n }; },
    async close() { log.closed++; if (o.closeThrows) throw new Error('synthetic-failure'); },
   };
  },
 };
 return { fs, log };
};
test('verifies the opened handle and always closes it', async () => {
 const ok = fakeFs(); assert.deepEqual(await readIgnoreFile('/synthetic-root', '.gitignore', allowed, { fs: ok.fs }), { text: 'abc' }); assert.equal(ok.log.closed, 1);
 if (constants.O_NOFOLLOW !== undefined) assert.equal(ok.log.flags[0]! & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
 if (constants.O_NONBLOCK !== undefined) assert.equal(ok.log.flags[0]! & constants.O_NONBLOCK, constants.O_NONBLOCK);
 for (const [o, code] of [[{ statIno: 2 }, 'unsafe'], [{ statDev: 2 }, 'unsafe'], [{ statFile: false }, 'unsafe'], [{ statSize: READ_LIMITS.maxBytes + 1 }, 'oversized'], [{ readThrows: true }, 'unreadable'], [{ swapAfterOpen: true }, 'unsafe']] as [FakeOpts, string][]) {
  const f = fakeFs(o); assert.deepEqual(await readIgnoreFile('/synthetic-root', '.gitignore', allowed, { fs: f.fs }), { code }); assert.equal(f.log.closed, 1, code);
 }
 const big = fakeFs({ size: READ_LIMITS.maxBytes + 1 }); assert.deepEqual(await readIgnoreFile('/synthetic-root', '.gitignore', allowed, { fs: big.fs }), { code: 'oversized' }); assert.equal(big.log.closed, 0);
 assert.deepEqual(await readIgnoreFile('/synthetic-root', '.gitignore', allowed, { fs: fakeFs({ openThrows: true }).fs }), { code: 'unreadable' });
 const noisy = fakeFs({ closeThrows: true }); assert.deepEqual(await readIgnoreFile('/synthetic-root', '.gitignore', allowed, { fs: noisy.fs }), { text: 'abc' });
});
test('filters setting values down to plain basenames', () => {
 assert.deepEqual(validIgnoreNames(['.gitignore', '../x', 'a/b', 'a\\b', '', '.', '..', 'x\u0000', 1, null, {}, '.kiroignore', '.gitignore', 'a'.repeat(256), 'bell\u0007']), ['.gitignore', '.kiroignore']);
 assert.deepEqual(validIgnoreNames([]), []); assert.equal(validIgnoreNames('.gitignore'), undefined); assert.equal(validIgnoreNames(undefined), undefined); assert.equal(validIgnoreNames({ 0: 'a' }), undefined);
});
test('source guards: ignore.ts has no IO and read-ignore.ts only uses lstat, open and constants', async () => {
 const read = (n: string) => readFile(fileURLToPath(new URL(`../../src/audit/${n}`, import.meta.url)), 'utf8');
 const ig = await read('ignore.ts'); assert.ok(!/node:|\bimport\b|require\(/.test(ig)); assert.ok(!/\b(readFile|readdir|writeFile|console)\b/.test(ig));
 const ri = await read('read-ignore.ts'); assert.deepEqual(ri.split('\n').filter(l => /node:fs/.test(l)), ["import { lstat, open, constants } from 'node:fs/promises';"]);
 assert.ok(!/from 'node:fs'/.test(ri)); assert.ok(!/\b(readdir|writeFile|readFile|readFileSync|createReadStream|console)\b/.test(ri));
});
