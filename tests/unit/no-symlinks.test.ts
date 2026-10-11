import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noSymlinks } from '../../src/paths.ts';

// Contract of the link check that every storage and source path goes through.
const skip = process.platform === 'win32' ? 'symlink creation needs privilege on Windows runners' : false;
const work = () => mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-links-'));

test('plain, missing and nested paths pass', { skip }, () => {
 const base = work();
 mkdirSync(join(base, 'a', 'b'), { recursive: true });
 writeFileSync(join(base, 'a', 'b', 'file'), 'x');
 noSymlinks(join(base, 'a', 'b', 'file'));
 noSymlinks(join(base, 'a', 'missing', 'deeper'));
 assert.throws(() => noSymlinks(join(base, 'a', 'b', 'file', 'child')), /ENOTDIR/, 'a file used as a directory is an error, not a pass');
 noSymlinks(base);
 rmSync(base, { recursive: true });
});

test('links are rejected at any level, including dangling ones and links to links', { skip }, () => {
 const base = work();
 mkdirSync(join(base, 'real'));
 symlinkSync(join(base, 'real'), join(base, 'link'));
 symlinkSync(join(base, 'link'), join(base, 'link2'));
 symlinkSync(join(base, 'nowhere'), join(base, 'dangling'));
 for (const p of ['link', 'link2', 'dangling', 'link/child', 'dangling/child']) {
  assert.throws(() => noSymlinks(join(base, p)), /^Error: UNSAFE_PATH$/, p);
 }
 rmSync(base, { recursive: true });
});
