import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYLOAD } from '../../scripts/release/verify-vsix.ts';
import {
  candidateFileName,
  extractChangelogSection,
  isVersion,
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
    { name: 'verify (windows-2025)', status: 'completed', conclusion: 'success' },
    { name: 'release candidate (built once)', status: 'completed', conclusion: 'success' },
    { name: 'release candidate on macOS', status: 'completed', conclusion: 'success' },
    { name: 'release candidate on Windows', status: 'completed', conclusion: 'success' },
    { name: 'release candidate on Ubuntu', status: 'completed', conclusion: 'success' },
    { name: 'attest release candidate', status: 'completed', conclusion: 'success' },
  ];
  assert.equal(validateCiJobs(jobs), true);
  for (const job of jobs) {
    expectCode(() => validateCiJobs(jobs.filter(candidate => candidate !== job)), 'CI_JOB_MISSING');
    expectCode(() => validateCiJobs(jobs.map(candidate => candidate === job ? { ...candidate, conclusion: 'skipped' } : candidate)), 'CI_JOB_UNSUCCESSFUL');
  }
  expectCode(() => validateCiJobs([...jobs, { name: 'verify (synthetic-os)', status: 'completed', conclusion: 'failure' }]), 'CI_JOB_UNSUCCESSFUL');
  expectCode(() => validateCiJobs(jobs.slice(0, 3)), 'CI_JOB_MISSING');
  expectCode(() => validateCiJobs(jobs.map((job, index) => index === 1 ? { ...job, conclusion: 'failure' } : job)), 'CI_JOB_UNSUCCESSFUL');
  expectCode(() => validateCiJobs([...jobs, jobs.at(-1)!]), 'CI_JOB_AMBIGUOUS');
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
  assert.deepEqual(validateReleaseRequest({ version: '0.7.0', dryRun: true, authMode: 'trusted-publishing' }), {
    version: '0.7.0', dryRun: true, authMode: 'trusted-publishing',
  });
  assert.equal(validateReleaseRequest({
    version: '0.7.0', dryRun: false, authMode: 'pat',
  }).dryRun, false);
  expectCode(() => validateReleaseRequest({
    version: '0.7.0-beta.1', dryRun: true, authMode: 'trusted-publishing',
  }), 'VERSION_INVALID');
  expectCode(() => validateReleaseRequest({
    version: '0.7.0', dryRun: true, authMode: 'repository-secret',
  }), 'AUTH_MODE_INVALID');
});

test('checks package/VSIX version, pre-release marker, full-file checksum, and unchanged CI payload', () => {
  const payload = PAYLOAD.map((name, index) => ({ name, bytes: index + 1, sha256: hash(String.fromCharCode(97 + index)) }));
  const candidateName = candidateFileName('0.7.0', sha('c'));
  const expected = {
    requestedVersion: '0.7.0',
    packageVersion: '0.7.0',
    vsixVersion: '0.7.0',
    preRelease: true,
    actualSha256: hash('e'),
    candidateFileName: candidateName,
    checksumText: `${hash('e')}  ${candidateName}\n`,
    verifiedPayload: payload,
    ciPayload: payload,
  };
  assert.equal(verifyCandidateIntegrity(expected).sha256, hash('e'));
  expectCode(() => verifyCandidateIntegrity({ ...expected, packageVersion: '0.7.1' }), 'PACKAGE_VERSION_MISMATCH');
  expectCode(() => verifyCandidateIntegrity({ ...expected, vsixVersion: '0.7.1' }), 'VSIX_VERSION_MISMATCH');
  expectCode(() => verifyCandidateIntegrity({ ...expected, preRelease: false }), 'VSIX_CHANNEL_MISMATCH');
  // A stable (even minor) version must not carry the pre-release flag; the check works in both directions.
  // A leading zero is not a plain version: rejected by the same fixed code, never a channel guess.
  expectCode(() => verifyCandidateIntegrity({ ...expected, requestedVersion: '0.09.0', packageVersion: '0.09.0', vsixVersion: '0.09.0' }), 'VERSION_INVALID');
  expectCode(() => extractChangelogSection('## 0.09.0\n\nx', '0.09.0'), 'VERSION_INVALID');
  assert.equal(isVersion('0.09.0'), false);
  assert.equal(isVersion('0.9.0'), true);
  const stableName = candidateFileName('1.0.0', sha('c'));
  const stable = { ...expected, requestedVersion: '1.0.0', packageVersion: '1.0.0', vsixVersion: '1.0.0', preRelease: false, candidateFileName: stableName, checksumText: `${hash('e')}  ${stableName}\n` };
  assert.equal(verifyCandidateIntegrity(stable).version, '1.0.0');
  expectCode(() => verifyCandidateIntegrity({ ...stable, preRelease: true }), 'VSIX_CHANNEL_MISMATCH');
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
  expectCode(() => verifyCandidateIntegrity({ ...expected, checksumText: `${hash('e')}  ${candidateName}\nextra\n` }), 'CHECKSUM_MALFORMED');
  // The single checksum line must name exactly the expected candidate file.
  expectCode(() => verifyCandidateIntegrity({ ...expected, checksumText: `${hash('e')}  candidate.vsix\n` }), 'CHECKSUM_MALFORMED');
  expectCode(() => verifyCandidateIntegrity({ ...expected, checksumText: `${hash('e')}  ${candidateFileName('0.7.0', sha('d'))}\n` }), 'CHECKSUM_MALFORMED');
  expectCode(() => verifyCandidateIntegrity({ ...expected, checksumText: `${hash('e')}  ${candidateFileName('0.7.1', sha('c'))}\n` }), 'CHECKSUM_MALFORMED');
  // The expected name itself must have the candidate shape and carry the requested version.
  expectCode(() => verifyCandidateIntegrity({ ...expected, candidateFileName: 'candidate.vsix', checksumText: `${hash('e')}  candidate.vsix\n` }), 'CANDIDATE_NAME_INVALID');
  const otherVersion = candidateFileName('0.7.1', sha('c'));
  expectCode(() => verifyCandidateIntegrity({ ...expected, candidateFileName: otherVersion, checksumText: `${hash('e')}  ${otherVersion}\n` }), 'CANDIDATE_NAME_INVALID');
  expectCode(() => verifyCandidateIntegrity({ ...expected, candidateFileName: `${candidateName}x`, checksumText: `${hash('e')}  ${candidateName}x\n` }), 'CANDIDATE_NAME_INVALID');
  expectCode(() => verifyCandidateIntegrity({ ...expected, checksumText: `${hash('e')} *${candidateName}\n` }), 'CHECKSUM_MALFORMED');
});

test('derives the candidate file name from the plain version and the first 12 characters of the full commit', () => {
  assert.equal(candidateFileName('0.7.0', 'ABCDEF0123456789abcdef0123456789abcdef01'), 'bobert-v0.7.0-abcdef012345-candidate.vsix');
  assert.equal(candidateFileName('1.0.0', sha('a')), 'bobert-v1.0.0-aaaaaaaaaaaa-candidate.vsix');
  for (const bad of ['0.7.0-beta.1', '0.09.0', '', 'v0.7.0', '0.7']) expectCode(() => candidateFileName(bad, sha('a')), 'VERSION_INVALID');
  for (const bad of ['', 'a'.repeat(12), 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40)]) expectCode(() => candidateFileName('0.7.0', bad), 'COMMIT_INVALID');
});

test('extracts only the requested changelog section and builds stable release notes', () => {
  const changelog = [
    '# Changelog',
    '',
    '## 0.7.0 (beta)',
    '',
    'Synthetic release change.',
    '',
    '## 0.5.2 (beta, macOS)',
    '',
    'Historical release detail.',
  ].join('\n');
  assert.equal(extractChangelogSection(changelog, '0.7.0'), 'Synthetic release change.');
  expectCode(() => extractChangelogSection(changelog, '0.8.0'), 'CHANGELOG_SECTION_MISSING');
});
