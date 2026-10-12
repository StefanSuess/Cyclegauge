import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyVsceFailure } from '../../scripts/release/build-vsix.ts';

test('VSCE incompatibility reports an actionable, fixed diagnostic code', () => {
 const privateDetails = '/Users/synthetic-user/private-workspace TOKEN=synthetic-private-token';
 const code = classifyVsceFailure({
  status: 1,
  stdout: `@types/vscode version 1.140.0 is incompatible with engines.vscode ^1.90.0: ${privateDetails}`,
  stderr: 'failed',
 });
 assert.equal(code, 'VSCE_TYPES_ENGINE_MISMATCH');
 assert.doesNotMatch(code, /synthetic-private|Users\/|TOKEN=/);
});

test('unexpected VSCE errors do not expose paths, credentials, or child output', () => {
 const code = classifyVsceFailure({
  status: 1, stdout: '/Users/synthetic-private/project',
  stderr: 'authorization=Bearer synthetic-secret-at-remote',
 });
 assert.equal(code, 'VSCE_PACKAGE_FAILED');
 assert.doesNotMatch(code, /synthetic|Bearer|Users/);
});

test('spawn and termination failures remain distinguishable without raw errors', () => {
 assert.equal(classifyVsceFailure({
  status: null, error: new Error('/Users/private-user/EACCES'), stderr: 'synthetic-secret',
 }), 'VSCE_SPAWN_FAILED');
 assert.equal(classifyVsceFailure({
  status: null, signal: 'SIGKILL', stdout: 'synthetic-private',
 }), 'VSCE_TERMINATED');
});

test('a terminated VSCE timeout remains a termination when spawnSync also returns an error', () => {
 const code = classifyVsceFailure({
  status: null, signal: 'SIGKILL',
  error: Object.assign(new Error('synthetic-timeout'), { code: 'ETIMEDOUT' }),
  stdout: 'synthetic-private-output', stderr: 'synthetic-private-error',
 });
 assert.equal(code, 'VSCE_TERMINATED');
});
