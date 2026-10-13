import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChangelogSection } from '../../scripts/release/promotion-policy.ts';

const repository = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(resolve(repository, file), 'utf8');
const version: string = JSON.parse(read('package.json')).version;

test('package version is an odd-minor pre-release version', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  // The release workflow publishes pre-releases only; see docs/release-process.md "Versioning".
  assert.equal(Number(version.split('.')[1]) % 2, 1);
});

test('CHANGELOG has a nonempty section for the version, as the release workflow reads it', () => {
  const changelog = read('CHANGELOG.md');
  const first = changelog.split('\n').find((line) => line.startsWith('## '));
  assert.ok(first === '## Unreleased' || first?.startsWith(`## ${version} `));
  assert.ok(extractChangelogSection(changelog, version).length > 0);
});

test('version history and README badge mention the version', () => {
  assert.ok(read('docs/version-history.md').includes(`**${version}**`));
  assert.ok(read('README.md').split('\n').some((line) => line.includes('img.shields.io/badge/development') && line.includes(version)));
});
