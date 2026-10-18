import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPreReleaseVersion, releaseChannel } from '../../scripts/release/channel.ts';

test('odd minor is the pre-release channel, even minor is stable', () => {
  for (const version of ['0.9.0', '0.13.0', '0.1.5', '1.1.0', '2.11.3']) {
    assert.equal(releaseChannel(version), 'pre-release', version);
    assert.equal(isPreReleaseVersion(version), true, version);
  }
  for (const version of ['1.0.0', '0.10.2', '0.12.0', '1.2.7', '0.0.1', '12345678901234567890.100.0']) {
    assert.equal(releaseChannel(version), 'stable', version);
    assert.equal(isPreReleaseVersion(version), false, version);
  }
});

test('anything but plain major.minor.patch is rejected with a fixed code and no echo', () => {
  const invalid = ['', '1', '1.0', '1.0.0.0', 'v1.0.0', '1.0.0-beta.1', '1.0.0+build', '1.0.x', ' 1.0.0', '1.0.0\n', '01.0.0', '1.00.0', '1.0.00', '-1.0.0', '1.0.0 synthetic-secret'];
  for (const version of invalid) {
    assert.throws(() => releaseChannel(version), error => error instanceof Error && error.message === 'VERSION_INVALID', JSON.stringify(version));
  }
  for (const value of [undefined, null, 1, {}, ['1.0.0']]) assert.throws(() => isPreReleaseVersion(value), /^Error: VERSION_INVALID$/);
});

test('the CI candidate steps derive the channel instead of passing a hard-coded flag', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.equal(ci.includes('--pre-release'), false);
});
