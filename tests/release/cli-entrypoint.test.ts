import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from '../../scripts/release/zip.ts';

const verifier = fileURLToPath(new URL('../../scripts/release/verify-vsix.ts', import.meta.url));
const scripts = fileURLToPath(new URL('../../scripts', import.meta.url));
const skip = process.platform === 'win32' ? 'symlinks need privilege on Windows runners' : false;

test('a release gate started through a symlinked path still runs and fails a bad archive', { skip }, () => {
 const base = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-entry-')));
 const link = join(base, 'scripts-link');
 symlinkSync(scripts, link);
 const bad = join(base, 'bad.vsix');
 writeFileSync(bad, writeZip([{ name: 'extension/other.txt', data: Buffer.from('x') }]));
 const direct = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', verifier, bad], { encoding: 'utf8' });
 const linked = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(link, 'release', 'verify-vsix.ts'), bad], { encoding: 'utf8' });
 for (const r of [direct, linked]) {
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^VSIX_VERIFY FAIL/);
 }
 rmSync(base, { recursive: true, force: true });
});

test('missing argument values are a usage error, not a pass', () => {
 const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', verifier, 'x.vsix', '--compare'], { encoding: 'utf8' });
 assert.equal(r.status, 2);
 assert.equal(r.stdout.trim(), 'USAGE');
});
