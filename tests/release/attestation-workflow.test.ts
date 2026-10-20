import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('release preflight verifies the unchanged candidate provenance before remote checks', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const preflight = workflow.split('  publish-trusted:\n')[0];
  const integrity = preflight.indexOf('- name: Verify the exact candidate and prepare release metadata');
  const attestation = preflight.indexOf('- name: Verify the exact candidate attestation');
  const readiness = preflight.indexOf('- name: Check public version, tag, and release state without writes');
  assert.ok(integrity >= 0 && integrity < attestation && attestation < readiness);
  assert.match(preflight, /^      attestations: read$/m);
  const step = preflight.slice(attestation, readiness);
  assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step, /VERSION: \$\{\{ steps\.select\.outputs\.version \}\}/);
  assert.match(step, /SOURCE_SHA: \$\{\{ steps\.select\.outputs\.source_sha \}\}/);
  assert.match(step, /gh attestation verify "release\/promotion-bundle\/bobert-v\$\{VERSION\}\.vsix"/);
  assert.match(step, /--repo "\$GITHUB_REPOSITORY"/);
  assert.match(step, /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/ci\.yml"/);
  assert.match(step, /--source-ref refs\/heads\/main/);
  assert.match(step, /--source-digest "\$SOURCE_SHA"/);
  assert.match(step, /--deny-self-hosted-runners/);
  assert.match(step, /--predicate-type https:\/\/slsa\.dev\/provenance\/v1/);
  assert.match(step, />\/dev\/null 2>&1/);
  assert.match(step, /ATTESTATION_VERIFICATION_FAILED/);
  assert.doesNotMatch(step, /\|\| true/);
});
