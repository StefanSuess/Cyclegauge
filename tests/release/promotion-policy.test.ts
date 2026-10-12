import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYLOAD } from '../../scripts/release/verify-vsix.ts';
import {
  extractChangelogSection,
  renderReleaseNotesForApproval,
  selectCandidateArtifact,
  selectTrustedCiRun,
  validateCiJobs,
  validateReleaseRequest,
  verifyCandidateIntegrity,
} from '../../scripts/release/promotion-policy.ts';

const sha = (letter: string) => letter.repeat(40);
const hash = (letter: string) => letter.repeat(64);

test('renders the exact release notes safely in the pre-approval summary', () => {
  assert.equal(
    renderReleaseNotesForApproval('## Changes\n\nKeep <tag> & `code`.'),
    '<details><summary>Verified release notes for approval</summary>\n\n<pre>## Changes\n\nKeep &lt;tag&gt; &amp; `code`.</pre>\n\n</details>',
  );
});

const run = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: sha('a'),
  status: 'completed',
  conclusion: 'success',
  run_number: 14,
  run_attempt: 1,
  pull_requests: [],
  ...overrides,
});
const artifact = (overrides: Record<string, unknown> = {}) => ({
  id: 9001,
  name: 'release-candidate',
  expired: false,
  digest: `sha256:${hash('b')}`,
  workflow_run: {
    id: 101,
    repository_id: 123,
    head_repository_id: 123,
    head_branch: 'main',
    head_sha: sha('a'),
  },
  ...overrides,
});
const expectCode = (action: () => unknown, code: string) => {
  assert.throws(action, (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === code,
  );
};

test('selects the newest trusted CI run for the exact current main commit', () => {
  const older = run({ id: 100, run_number: 13 });
  const newest = run({ id: 101, run_number: 14, event: 'workflow_dispatch' });
  assert.equal(selectTrustedCiRun([older, newest], { mainSha: sha('a'), dispatchSha: sha('a') }), newest);
});

test('fails closed when dispatch SHA differs from current main', () => {
  expectCode(() => selectTrustedCiRun([run()], { mainSha: sha('a'), dispatchSha: sha('c') }), 'MAIN_SHA_MISMATCH');
});

test('fails closed if main advances while the release awaits approval', () => {
  return import('../../scripts/release/promotion-policy.ts').then(policy => {
    const verify = (policy as Record<string, unknown>).verifyCurrentMainSha;
    assert.equal(typeof verify, 'function');
    if (typeof verify !== 'function') return;
    const check = verify as (actual: string, expected: string) => void;
    assert.doesNotThrow(() => check(sha('a'), sha('a')));
    expectCode(() => check(sha('b'), sha('a')), 'MAIN_SHA_ADVANCED');
    expectCode(() => check('invalid', sha('a')), 'MAIN_STATE_UNAVAILABLE');
  });
});

test('does not fall back when the newest matching main CI run failed or is still running', () => {
  const older = run({ id: 100, run_number: 13 });
  expectCode(() => selectTrustedCiRun([older, run({ id: 102, run_number: 15, conclusion: 'failure' })], {
    mainSha: sha('a'), dispatchSha: sha('a'),
  }), 'CI_RUN_UNSUCCESSFUL');
  expectCode(() => selectTrustedCiRun([older, run({ id: 102, run_number: 15, status: 'in_progress', conclusion: null })], {
    mainSha: sha('a'), dispatchSha: sha('a'),
  }), 'CI_RUN_UNSUCCESSFUL');
});

test('rejects PR, non-main, and wrong-workflow runs as promotion sources', () => {
  const cases = [
    run({ event: 'pull_request' }),
    run({ head_branch: 'feature/synthetic' }),
    run({ path: '.github/workflows/other.yml' }),
  ];
  for (const candidate of cases.slice(1)) {
    expectCode(() => selectTrustedCiRun([candidate], { mainSha: sha('a'), dispatchSha: sha('a') }), 'CI_RUN_NOT_FOUND');
  }
  expectCode(() => selectTrustedCiRun([run({ event: 'pull_request' })], {
    mainSha: sha('a'), dispatchSha: sha('a'),
  }), 'CI_RUN_UNTRUSTED');
});

test('trusts a main push run even when GitHub includes associated merged-PR metadata', () => {
  const candidate = run({ pull_requests: [{ number: 55 }] });
  assert.equal(selectTrustedCiRun([candidate], {
    mainSha: sha('a'), dispatchSha: sha('a'),
  }).id, candidate.id);
});

test('requires every known CI verification and candidate job to succeed', () => {
  const jobs = [
    { name: 'verify (macos-latest)', status: 'completed', conclusion: 'success' },
    { name: 'verify (ubuntu-24.04)', status: 'completed', conclusion: 'success' },
    { name: 'release candidate (built once)', status: 'completed', conclusion: 'success' },
    { name: 'release candidate on macOS', status: 'completed', conclusion: 'success' },
  ];
  assert.equal(validateCiJobs(jobs), true);
  expectCode(() => validateCiJobs([...jobs, { name: 'verify (synthetic-os)', status: 'completed', conclusion: 'failure' }]), 'CI_JOB_UNSUCCESSFUL');
  expectCode(() => validateCiJobs(jobs.slice(0, 3)), 'CI_JOB_MISSING');
  expectCode(() => validateCiJobs(jobs.map((job, index) => index === 1 ? { ...job, conclusion: 'failure' } : job)), 'CI_JOB_UNSUCCESSFUL');
});

test('selects only one unexpired candidate artifact associated with the exact run and repository', () => {
  const selected = selectCandidateArtifact([artifact()], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  });
  assert.equal(selected.id, 9001);
  expectCode(() => selectCandidateArtifact([artifact(), artifact({ id: 9002 })], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  }), 'ARTIFACT_AMBIGUOUS');
  expectCode(() => selectCandidateArtifact([artifact({ expired: true })], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  }), 'ARTIFACT_EXPIRED');
  expectCode(() => selectCandidateArtifact([artifact({ workflow_run: { ...artifact().workflow_run, id: 999 } })], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  }), 'ARTIFACT_PROVENANCE_MISMATCH');
  expectCode(() => selectCandidateArtifact([artifact({ workflow_run: { ...artifact().workflow_run, repository_id: 456 } })], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  }), 'ARTIFACT_PROVENANCE_MISMATCH');
  expectCode(() => selectCandidateArtifact([artifact({ workflow_run: { ...artifact().workflow_run, head_sha: sha('c') } })], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  }), 'ARTIFACT_PROVENANCE_MISMATCH');
  expectCode(() => selectCandidateArtifact([artifact({ digest: 'sha256:bad' })], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  }), 'ARTIFACT_DIGEST_INVALID');
  expectCode(() => selectCandidateArtifact([artifact({ name: 'synthetic-unrelated' })], {
    runId: 101, repositoryId: 123, headSha: sha('a'), branch: 'main',
  }), 'ARTIFACT_NOT_FOUND');
});

test('requires an explicit valid version and supported auth mode; dry run defaults are safe', () => {
  assert.deepEqual(validateReleaseRequest({ version: '0.6.0', dryRun: true, authMode: 'trusted-publishing' }), {
    version: '0.6.0', dryRun: true, authMode: 'trusted-publishing',
  });
  assert.equal(validateReleaseRequest({
    version: '0.6.0', dryRun: false, authMode: 'pat',
  }).dryRun, false);
  expectCode(() => validateReleaseRequest({
    version: '0.6.0-beta.1', dryRun: true, authMode: 'trusted-publishing',
  }), 'VERSION_INVALID');
  expectCode(() => validateReleaseRequest({
    version: '0.6.0', dryRun: true, authMode: 'repository-secret',
  }), 'AUTH_MODE_INVALID');
});

test('checks package/VSIX version, pre-release marker, full-file checksum, and unchanged CI payload', () => {
  const payload = PAYLOAD.map((name, index) => ({ name, bytes: index + 1, sha256: hash(String.fromCharCode(97 + index)) }));
  const expected = {
    requestedVersion: '0.6.0',
    packageVersion: '0.6.0',
    vsixVersion: '0.6.0',
    preRelease: true,
    actualSha256: hash('e'),
    checksumText: `${hash('e')}  candidate.vsix\n`,
    verifiedPayload: payload,
    ciPayload: payload,
  };
  assert.equal(verifyCandidateIntegrity(expected).sha256, hash('e'));
  expectCode(() => verifyCandidateIntegrity({ ...expected, packageVersion: '0.6.1' }), 'PACKAGE_VERSION_MISMATCH');
  expectCode(() => verifyCandidateIntegrity({ ...expected, vsixVersion: '0.6.1' }), 'VSIX_VERSION_MISMATCH');
  expectCode(() => verifyCandidateIntegrity({ ...expected, preRelease: false }), 'VSIX_NOT_PRERELEASE');
  expectCode(() => verifyCandidateIntegrity({ ...expected, actualSha256: hash('f') }), 'CHECKSUM_MISMATCH');
  expectCode(() => verifyCandidateIntegrity({ ...expected, actualSha256: 'g'.repeat(64) }), 'CHECKSUM_MALFORMED');
  expectCode(() => verifyCandidateIntegrity({
    ...expected,
    verifiedPayload: payload.map((entry, index) => index === 1 ? { ...entry, sha256: hash('f') } : entry),
  }), 'PAYLOAD_MISMATCH');
  expectCode(() => verifyCandidateIntegrity({
    ...expected,
    ciPayload: payload.map((entry, index) => index === 1 ? { ...entry, sha256: 'g'.repeat(64) } : entry),
  }), 'PAYLOAD_MANIFEST_MALFORMED');
  expectCode(() => verifyCandidateIntegrity({ ...expected, checksumText: `${hash('e')}  candidate.vsix\nextra\n` }), 'CHECKSUM_MALFORMED');
});

test('extracts only the requested changelog section and builds stable release notes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## 0.6.0 (beta)',
    '',
    'Synthetic release change.',
    '',
    '## 0.5.2 (beta, macOS)',
    '',
    'Historical release detail.',
  ].join('\n');
  assert.equal(extractChangelogSection(changelog, '0.6.0'), 'Synthetic release change.');
  expectCode(() => extractChangelogSection(changelog, '0.7.0'), 'CHANGELOG_SECTION_MISSING');
});
