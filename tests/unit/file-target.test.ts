import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTarget, defaultFolder, foldedInside, protectedRoots, realish, writeAtomically } from '../../src/extension/file-target.ts';

const sandbox = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-file-target-')));
const ok = (r: ReturnType<typeof checkTarget>) => { assert.equal(r.ok, true); return r as Extract<typeof r, { ok: true }>; };

test('an ordinary new or existing regular file in an existing folder is accepted', () => {
 const root = sandbox();
 try {
  mkdirSync(join(root, 'downloads'));
  const fresh = ok(checkTarget(join(root, 'downloads', 'cycle.png'), []));
  assert.deepEqual([fresh.dir, fresh.name, fresh.path], [join(root, 'downloads'), 'cycle.png', join(root, 'downloads', 'cycle.png')]);
  writeFileSync(join(root, 'downloads', 'old.png'), 'synthetic-old');
  ok(checkTarget(join(root, 'downloads', 'old.png'), []));
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('relative, empty, oversized, NUL-bearing and missing-folder targets are invalid', () => {
 const root = sandbox();
 try {
  for (const bad of ['', 'cycle.png', './cycle.png', join(root, 'missing', 'cycle.png'), join(root, 'a\0b.png'), join(root, 'x'.repeat(300)), join(root, 'x'.repeat(5000)), root + '/', '/', root + '/..', root + '/.'])
  {
   const r = checkTarget(bad, []) as { ok: boolean; code: string };
   // Windows resolves a trailing separator or "." to an existing folder, refused as a non-regular final name; either way nothing is written.
   assert.equal(r.ok, false, bad.slice(0, 30));
   assert.ok(r.code === 'invalid_target' || (process.platform === 'win32' && r.code === 'not_regular'), `${bad.slice(0, 30)}: ${r.code}`);
  }
  for (const hostile of [undefined, null, 5, {}, []]) assert.equal((checkTarget(hostile as never, []) as { ok: boolean }).ok, false);
  writeFileSync(join(root, 'plain'), 'x');
  assert.deepEqual(checkTarget(join(root, 'plain', 'cycle.png'), []), { ok: false, code: 'invalid_target' }, 'parent is a file');
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('targets inside a protected root are refused, including by sibling spelling through a symlink', { skip: process.platform === 'win32' }, () => {
 const root = sandbox();
 try {
  const kiro = join(root, 'kiro-data'), storage = join(root, 'owned'), other = join(root, 'other');
  for (const d of [kiro, storage, other, join(kiro, 'logs')]) mkdirSync(d, { recursive: true });
  assert.deepEqual(checkTarget(join(kiro, 'cycle.png'), [kiro]), { ok: false, code: 'forbidden_target' });
  assert.deepEqual(checkTarget(join(kiro, 'logs', 'cycle.png'), [kiro]), { ok: false, code: 'forbidden_target' });
  assert.deepEqual(checkTarget(join(storage, 'cycle.png'), [kiro, storage]), { ok: false, code: 'forbidden_target' });
  ok(checkTarget(join(other, 'cycle.png'), [kiro, storage]));
  ok(checkTarget(join(root, 'kiro-data-sibling.png'), [kiro]));
  // A link to the protected folder is resolved before it is compared.
  symlinkSync(kiro, join(other, 'link'));
  assert.deepEqual(checkTarget(join(other, 'link', 'cycle.png'), [kiro]), { ok: false, code: 'forbidden_target' });
  // A protected root that is itself reached through a link is compared by its real location too.
  symlinkSync(storage, join(root, 'storage-link'));
  assert.deepEqual(checkTarget(join(storage, 'cycle.png'), [join(root, 'storage-link')]), { ok: false, code: 'forbidden_target' });
  // A protected root that does not exist yet is still honoured.
  assert.deepEqual(checkTarget(join(other, 'cycle.png'), [other, join(root, 'not-created')]), { ok: false, code: 'forbidden_target' });
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Kiro-named folders anywhere are refused, as are the per-platform default Kiro folders', () => {
 const root = sandbox();
 const keys = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME'], saved = keys.map(k => process.env[k]);
 try {
  for (const name of ['.kiro', 'kiro-cli', '.KIRO']) {
   mkdirSync(join(root, name, 'inner'), { recursive: true });
   assert.deepEqual(checkTarget(join(root, name, 'inner', 'cycle.png'), []), { ok: false, code: 'forbidden_target' }, name);
  }
  mkdirSync(join(root, 'kiro-notes'));
  ok(checkTarget(join(root, 'kiro-notes', 'cycle.png'), []));
  // The default Kiro data folder follows the same platform defaults as the collector.
  for (const k of keys) process.env[k] = root;
  const expected = process.platform === 'darwin' ? join(root, 'Library', 'Application Support', 'Kiro') : process.platform === 'win32' ? join(root, 'Kiro') : join(root, 'Kiro');
  const roots = protectedRoots(['/synthetic/extra', 'relative-is-dropped', '']);
  assert.ok(roots.includes(expected), expected);
  assert.ok(roots.includes(join(root, '.kiro')));
  assert.ok(roots.includes('/synthetic/extra') || process.platform === 'win32');
  assert.ok(!roots.includes('relative-is-dropped') && !roots.includes(''));
  mkdirSync(expected, { recursive: true });
  assert.deepEqual(checkTarget(join(expected, 'cycle.png'), roots), { ok: false, code: 'forbidden_target' });
 } finally { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); rmSync(root, { recursive: true, force: true }); }
});

test('comparison folds case on macOS and Windows only', () => {
 assert.equal(foldedInside('/synthetic/Kiro/a', '/synthetic/kiro', 'darwin'), true);
 assert.equal(foldedInside('/synthetic/Kiro/a', '/synthetic/kiro', 'linux'), process.platform === 'win32'); // inside() follows the host's path semantics; the platform argument only controls the extra folding
 assert.equal(foldedInside('/synthetic/kiro-other/a', '/synthetic/kiro', 'darwin'), false);
 assert.equal(foldedInside('/synthetic/KIRO', '/synthetic/kiro', 'darwin'), true);
});

test('on a case-insensitive file system a differently spelled folder is still refused', { skip: process.platform !== 'darwin' && process.platform !== 'win32' }, () => {
 const root = sandbox();
 try {
  mkdirSync(join(root, 'SyntheticKiroData'));
  if (!existsSync(join(root, 'syntheticKIRODATA'))) return; // a case-sensitive volume: nothing to prove here
  assert.deepEqual(checkTarget(join(root, 'syntheticKIRODATA', 'cycle.png'), [join(root, 'SyntheticKiroData')]), { ok: false, code: 'forbidden_target' });
  assert.deepEqual(checkTarget(join(root, 'SyntheticKiroData', 'cycle.png'), [join(root, 'syntheticKIRODATA')]), { ok: false, code: 'forbidden_target' });
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('symlinks and non-regular files are refused as the final name', { skip: process.platform === 'win32' }, () => {
 const root = sandbox();
 try {
  writeFileSync(join(root, 'real.png'), 'synthetic');
  symlinkSync(join(root, 'real.png'), join(root, 'link.png'));
  symlinkSync(join(root, 'nowhere'), join(root, 'dangling.png'));
  mkdirSync(join(root, 'dir.png'));
  for (const name of ['link.png', 'dangling.png', 'dir.png']) assert.deepEqual(checkTarget(join(root, name), []), { ok: false, code: 'not_regular' }, name);
  assert.equal(readFileSync(join(root, 'real.png'), 'utf8'), 'synthetic');
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('atomic write replaces the target and leaves no temporary file', async () => {
 const root = sandbox();
 try {
  const target = ok(checkTarget(join(root, 'cycle.png'), []));
  assert.equal(await writeAtomically(target, new Uint8Array([1, 2, 3]), []), 'saved');
  assert.deepEqual([...readFileSync(target.path)], [1, 2, 3]);
  const again = ok(checkTarget(target.path, []));
  assert.equal(await writeAtomically(again, 'second', []), 'saved');
  assert.equal(readFileSync(target.path, 'utf8'), 'second');
  assert.deepEqual(readdirSync(root), ['cycle.png']);
  if (process.platform !== 'win32') assert.equal(realpathSync.native(root), root);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a target that becomes a symlink or a protected folder between the dialog and the rename is not written, and the temp file is removed', { skip: process.platform === 'win32' }, async () => {
 const root = sandbox();
 try {
  const outside = join(root, 'outside.txt');
  writeFileSync(outside, 'synthetic-victim');
  const target = ok(checkTarget(join(root, 'cycle.png'), []));
  symlinkSync(outside, target.path); // appears after the check
  assert.equal(await writeAtomically(target, 'x', []), 'not_regular');
  assert.equal(readFileSync(outside, 'utf8'), 'synthetic-victim', 'the link target is untouched');
  assert.deepEqual(readdirSync(root).sort(), ['cycle.png', 'outside.txt']);
  rmSync(target.path);
  const fresh = ok(checkTarget(join(root, 'cycle.png'), []));
  assert.equal(await writeAtomically(fresh, 'x', [root]), 'forbidden_target');
  assert.deepEqual(readdirSync(root), ['outside.txt']);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failed write removes the temporary file and reports a fixed code', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
 const root = sandbox();
 try {
  mkdirSync(join(root, 'readonly'));
  const target = ok(checkTarget(join(root, 'readonly', 'cycle.png'), []));
  chmodSync(join(root, 'readonly'), 0o500);
  assert.equal(await writeAtomically(target, 'x', []), 'write_failed');
  chmodSync(join(root, 'readonly'), 0o700);
  assert.deepEqual(readdirSync(join(root, 'readonly')), []);
  // Renaming over a directory fails after the temp file exists; it must still be cleaned up.
  const dirTarget = ok(checkTarget(join(root, 'cycle.png'), []));
  mkdirSync(dirTarget.path);
  assert.equal(await writeAtomically(dirTarget, 'x', []), 'not_regular');
  assert.deepEqual(readdirSync(root).sort(), ['cycle.png', 'readonly']);
 } finally { try { chmodSync(join(root, 'readonly'), 0o700); } catch { /* may not exist */ } rmSync(root, { recursive: true, force: true }); }
});

test('the default folder is Downloads when it exists, otherwise the home folder', () => {
 const home = sandbox();
 try {
  assert.equal(defaultFolder(home), home);
  mkdirSync(join(home, 'Downloads'));
  assert.equal(defaultFolder(home), join(home, 'Downloads'));
  rmSync(join(home, 'Downloads'), { recursive: true });
  writeFileSync(join(home, 'Downloads'), 'a file, not a folder');
  assert.equal(defaultFolder(home), home);
  assert.equal(realish(join(home, 'not', 'yet', 'there')), join(home, 'not', 'yet', 'there'));
 } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the same folder reached by another spelling is refused by file identity', { skip: process.platform === 'win32' }, () => {
 const root = sandbox();
 try {
  mkdirSync(join(root, 'real', 'inner'), { recursive: true });
  // A protected root that only resolves to the folder through a link, and a target given through a different link: identity catches both.
  symlinkSync(join(root, 'real'), join(root, 'alias-a')); symlinkSync(join(root, 'real'), join(root, 'alias-b'));
  assert.deepEqual(checkTarget(join(root, 'alias-a', 'inner', 'cycle.png'), [join(root, 'alias-b')]), { ok: false, code: 'forbidden_target' });
  assert.deepEqual(checkTarget(join(root, 'real', 'cycle.png'), [join(root, 'alias-b', 'inner')]), { ok: true, dir: join(root, 'real'), name: 'cycle.png', path: join(root, 'real', 'cycle.png') });
  // A protected root that does not exist yet has no identity and falls back to the path comparison.
  assert.equal(checkTarget(join(root, 'real', 'cycle.png'), [join(root, 'not-created')]).ok, true);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('credential folders are refused like Kiro folders', () => {
 const root = sandbox();
 try {
  for (const name of ['.aws', '.SSH', '.gnupg']) { mkdirSync(join(root, name)); assert.deepEqual(checkTarget(join(root, name, 'cycle.png'), []), { ok: false, code: 'forbidden_target' }, name); }
  mkdirSync(join(root, 'ssh-notes')); assert.equal(checkTarget(join(root, 'ssh-notes', 'cycle.png'), []).ok, true);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test('final names with a colon, Windows device names or trailing dots and spaces are refused', () => {
 const root = sandbox();
 try {
  const bad = (name: string, platform: NodeJS.Platform) => checkTarget(join(root, name), [], platform);
  for (const name of ['a:b.png', 'file.png:stream', 'C:x.png']) for (const p of ['linux', 'darwin', 'win32'] as const) assert.deepEqual(bad(name, p), { ok: false, code: 'invalid_target' }, `${name} ${p}`);
  const reserved = ['NUL', 'nul.png', 'CON', 'con.csv', 'PRN', 'AUX.txt', 'COM1', 'com9.png', 'LPT1', 'lpt9.csv', 'Nul.tar.gz', 'NUL .png'];
  for (const name of reserved) assert.deepEqual(bad(name, 'win32'), { ok: false, code: 'invalid_target' }, name);
  for (const name of ['cycle.', 'cycle ']) assert.deepEqual(bad(name, 'win32'), { ok: false, code: 'invalid_target' }, name);
  // Only Windows treats these as special; elsewhere they are ordinary names, and look-alikes are fine everywhere.
  for (const name of ['NUL', 'con.png', 'COM1.csv']) assert.equal(bad(name, 'linux').ok, true, name);
  for (const name of ['null.png', 'console.png', 'COM10.png', 'COM0.png', 'LPT.png', 'aux1.png', 'cycle.png']) assert.equal(bad(name, 'win32').ok, true, name);
 } finally { rmSync(root, { recursive: true, force: true }); }
});
