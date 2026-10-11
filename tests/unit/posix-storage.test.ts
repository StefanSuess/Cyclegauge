import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardFor, PosixGuard } from '../../src/guard.ts';
import { prepareStorage } from '../../src/paths.ts';

const posix = process.platform !== 'win32';
const work = () => mkdtempSync(join(realpathSync(tmpdir()), 'synthetic-guard-'));

test('POSIX guard creates 0700 directories and verifies exact mode and owner', { skip: !posix }, () => {
 const base = work(), guard = new PosixGuard();
 const dir = join(base, 'gauge');
 guard.createDirectory(dir);
 assert.equal(statSync(dir).mode & 0o777, 0o700);
 guard.verifyDirectory(dir);
 chmodSync(dir, 0o755);
 assert.throws(() => guard.verifyDirectory(dir), /^Error: UNSAFE_STORAGE$/);
 chmodSync(dir, 0o750);
 assert.throws(() => guard.verifyDirectory(dir), /^Error: UNSAFE_STORAGE$/);
 rmSync(base, { recursive: true });
});

test('POSIX guard verifies files: exact 0600, single link, regular file', { skip: !posix }, () => {
 const base = work(), guard = new PosixGuard();
 const file = join(base, 'device.key');
 writeFileSync(file, 'x', { mode: 0o600 });
 guard.verifyFile(file);
 chmodSync(file, 0o644);
 assert.throws(() => guard.verifyFile(file), /^Error: UNSAFE_STORAGE$/);
 chmodSync(file, 0o600);
 linkSync(file, join(base, 'twin'));
 assert.throws(() => guard.verifyFile(file), /^Error: UNSAFE_STORAGE$/);
 mkdirSync(join(base, 'dir'), { mode: 0o600 });
 assert.throws(() => guard.verifyFile(join(base, 'dir')), /^Error: UNSAFE_STORAGE$/);
 rmSync(base, { recursive: true });
});

test('POSIX guard sidecars: absent is fine, any group or world bit is not', { skip: !posix }, () => {
 const base = work(), guard = new PosixGuard();
 guard.verifySidecar(join(base, 'usage.sqlite-wal'));
 const wal = join(base, 'usage.sqlite-wal');
 writeFileSync(wal, 'x', { mode: 0o600 });
 guard.verifySidecar(wal);
 chmodSync(wal, 0o640);
 assert.throws(() => guard.verifySidecar(wal), /^Error: UNSAFE_STORAGE$/);
 chmodSync(wal, 0o600);
 linkSync(wal, join(base, 'twin'));
 assert.throws(() => guard.verifySidecar(wal), /^Error: UNSAFE_STORAGE$/);
 rmSync(base, { recursive: true });
});

test('the win32 guard stays fail-closed and creates nothing', () => {
 const base = work();
 const dir = join(base, 'gauge');
 assert.throws(() => guardFor('win32').createDirectory(dir), /^Error: STORAGE_PERMISSIONS_UNSUPPORTED$/);
 assert.equal(existsSync(dir), false);
 assert.throws(() => guardFor('win32').verifyFile(join(base, 'x')), /^Error: STORAGE_PERMISSIONS_UNSUPPORTED$/);
 assert.throws(() => prepareStorage(dir, join(base, 'source'), 'win32'), /^Error: STORAGE_PERMISSIONS_UNSUPPORTED$/);
 // A repository directory is rejected by the ordinary check before the guard is consulted.
 mkdirSync(join(base, 'repo', '.git'), { recursive: true });
 assert.throws(() => prepareStorage(join(base, 'repo', 'gauge'), join(base, 'source'), 'win32'), /^Error: UNSAFE_STORAGE$/);
 assert.equal(existsSync(dir), false);
 rmSync(base, { recursive: true });
});

test('every non-Windows platform selects the POSIX guard', () => {
 for (const p of ['darwin', 'linux', 'freebsd', 'openbsd', 'aix'] as const) assert.ok(guardFor(p) instanceof PosixGuard, p);
});
