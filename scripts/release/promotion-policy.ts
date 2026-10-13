import { PAYLOAD, type FileHash } from './verify-vsix.ts';

const VERSION = /^\d+\.\d+\.\d+$/;
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
const TRUSTED_EVENTS = new Set(['push', 'workflow_dispatch']);
const REQUIRED_CI_JOBS = [
  'verify (macos-latest)',
  'verify (ubuntu-24.04)',
  'verify (windows-2025)',
  'release candidate (built once)',
  'release candidate on macOS',
  'release candidate on Windows',
  'release candidate on Ubuntu',
  'attest release candidate',
];

export class PromotionPolicyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'PromotionPolicyError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new PromotionPolicyError(code); };
const validSha1 = (value: unknown): value is string => typeof value === 'string' && SHA1.test(value);
const validSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);

export function verifyCurrentMainSha(actual: string, approved: string): true {
  if (!validSha1(actual) || !validSha1(approved)) return fail('MAIN_STATE_UNAVAILABLE');
  if (actual.toLowerCase() !== approved.toLowerCase()) return fail('MAIN_SHA_ADVANCED');
  return true;
}

export interface CiRun {
  id: number;
  path: string;
  event: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  run_number: number;
  run_attempt: number;
}

export function selectTrustedCiRun(
  runs: CiRun[],
  expected: { mainSha: string; dispatchSha: string },
): CiRun {
  if (!validSha1(expected.mainSha) || !validSha1(expected.dispatchSha) || expected.mainSha.toLowerCase() !== expected.dispatchSha.toLowerCase()) {
    return fail('MAIN_SHA_MISMATCH');
  }

  const matching = runs.filter(run =>
    run.path === CI_WORKFLOW_PATH &&
    run.head_branch === 'main' &&
    typeof run.head_sha === 'string' && run.head_sha.toLowerCase() === expected.mainSha.toLowerCase(),
  );
  if (matching.length === 0) return fail('CI_RUN_NOT_FOUND');
  matching.sort((a, b) =>
    b.run_number - a.run_number || b.run_attempt - a.run_attempt || b.id - a.id,
  );

  const newest = matching[0];
  if (!Number.isSafeInteger(newest.id) || newest.id < 1 ||
      !Number.isSafeInteger(newest.run_number) || newest.run_number < 1 ||
      !Number.isSafeInteger(newest.run_attempt) || newest.run_attempt < 1) {
    return fail('CI_RUN_METADATA_INVALID');
  }
  if (!TRUSTED_EVENTS.has(newest.event)) return fail('CI_RUN_UNTRUSTED');
  if (newest.status !== 'completed' || newest.conclusion !== 'success') return fail('CI_RUN_UNSUCCESSFUL');
  return newest;
}

export function validateCiJobs(jobs: Array<{ name: string; status: string; conclusion: string | null }>): true {
  const verificationJobs = jobs.filter(job => /^verify \(.+\)$/.test(job.name));
  if (verificationJobs.length === 0) return fail('CI_JOB_MISSING');
  if (verificationJobs.some(job => job.status !== 'completed' || job.conclusion !== 'success')) return fail('CI_JOB_UNSUCCESSFUL');
  for (const requiredName of REQUIRED_CI_JOBS) {
    const matching = jobs.filter(job => job.name === requiredName);
    if (matching.length === 0) return fail('CI_JOB_MISSING');
    if (matching.length !== 1) return fail('CI_JOB_AMBIGUOUS');
    const [job] = matching;
    if (job.status !== 'completed' || job.conclusion !== 'success') return fail('CI_JOB_UNSUCCESSFUL');
  }
  return true;
}

export interface CandidateArtifact {
  id: number;
  name: string;
  expired: boolean;
  digest?: string | null;
  workflow_run?: {
    id: number;
    repository_id: number;
    head_repository_id: number | null;
    head_branch: string;
    head_sha: string;
  };
}

export function selectCandidateArtifact(
  artifacts: CandidateArtifact[],
  expected: { runId: number; repositoryId: number; headSha: string; branch: 'main' },
): CandidateArtifact {
  const candidates = artifacts.filter(artifact => artifact.name === 'release-candidate');
  if (candidates.length === 0) return fail('ARTIFACT_NOT_FOUND');
  if (candidates.length !== 1) return fail('ARTIFACT_AMBIGUOUS');
  const [artifact] = candidates;
  if (artifact.expired) return fail('ARTIFACT_EXPIRED');
  if (!Number.isSafeInteger(artifact.id) || artifact.id < 1) return fail('ARTIFACT_ID_INVALID');
  if (artifact.digest !== undefined && artifact.digest !== null && !/^sha256:[0-9a-f]{64}$/i.test(artifact.digest)) {
    return fail('ARTIFACT_DIGEST_INVALID');
  }
  const run = artifact.workflow_run;
  if (!run ||
      run.id !== expected.runId ||
      run.repository_id !== expected.repositoryId ||
      run.head_repository_id !== expected.repositoryId ||
      run.head_branch !== expected.branch ||
      !validSha1(run.head_sha) || run.head_sha.toLowerCase() !== expected.headSha.toLowerCase()) {
    return fail('ARTIFACT_PROVENANCE_MISMATCH');
  }
  return artifact;
}

export type AuthMode = 'trusted-publishing' | 'pat';

export function validateReleaseRequest(input: {
  version: string;
  dryRun: boolean;
  authMode: string;
}): { version: string; dryRun: boolean; authMode: AuthMode } {
  if (typeof input.version !== 'string' || !VERSION.test(input.version)) return fail('VERSION_INVALID');
  if (typeof input.dryRun !== 'boolean') return fail('DRY_RUN_INVALID');
  if (input.authMode !== 'trusted-publishing' && input.authMode !== 'pat') return fail('AUTH_MODE_INVALID');
  return { version: input.version, dryRun: input.dryRun, authMode: input.authMode };
}

function validPayload(files: FileHash[]): Map<string, string> {
  if (!Array.isArray(files)) return fail('PAYLOAD_MANIFEST_MALFORMED');
  const result = new Map<string, string>();
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !validSha256(file.sha256) || result.has(file.name)) {
      return fail('PAYLOAD_MANIFEST_MALFORMED');
    }
    result.set(file.name, file.sha256);
  }
  if (result.size !== PAYLOAD.length || PAYLOAD.some(name => !result.has(name))) return fail('PAYLOAD_MANIFEST_MALFORMED');
  return result;
}

export function verifyCandidateIntegrity(input: {
  requestedVersion: string;
  packageVersion: string;
  vsixVersion: string;
  preRelease: boolean;
  actualSha256: string;
  checksumText: string;
  verifiedPayload: FileHash[];
  ciPayload: FileHash[];
}): { sha256: string; version: string } {
  if (!VERSION.test(input.requestedVersion)) return fail('VERSION_INVALID');
  if (input.packageVersion !== input.requestedVersion) return fail('PACKAGE_VERSION_MISMATCH');
  if (input.vsixVersion !== input.requestedVersion) return fail('VSIX_VERSION_MISMATCH');
  if (input.preRelease !== true) return fail('VSIX_NOT_PRERELEASE');
  if (!validSha256(input.actualSha256)) return fail('CHECKSUM_MALFORMED');

  const lines = input.checksumText.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 1) return fail('CHECKSUM_MALFORMED');
  const match = /^([0-9a-f]{64})  candidate\.vsix$/.exec(lines[0]);
  if (!match) return fail('CHECKSUM_MALFORMED');
  if (match[1] !== input.actualSha256) return fail('CHECKSUM_MISMATCH');

  const verified = validPayload(input.verifiedPayload);
  const ci = validPayload(input.ciPayload);
  if (PAYLOAD.some(name => verified.get(name) !== ci.get(name))) return fail('PAYLOAD_MISMATCH');
  return { sha256: input.actualSha256, version: input.requestedVersion };
}

export function extractChangelogSection(changelog: string, version: string): string {
  if (!VERSION.test(version)) return fail('VERSION_INVALID');
  const escaped = version.replaceAll('.', '\\.');
  const heading = new RegExp(`^##[ \\t]+(?:\\[)?${escaped}(?:\\])?(?:[ \\t].*)?$`);
  const lines = changelog.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => heading.test(line) ? [index] : []);
  if (starts.length === 0) return fail('CHANGELOG_SECTION_MISSING');
  if (starts.length !== 1) return fail('CHANGELOG_SECTION_AMBIGUOUS');
  const start = starts[0] + 1;
  let end = lines.findIndex((line, index) => index >= start && /^##[ 	]+/.test(line));
  if (end === -1) end = lines.length;
  const section = lines.slice(start, end).join('\n').trim();
  if (!section) return fail('CHANGELOG_SECTION_EMPTY');
  return section;
}

export function buildReleaseNotes(input: { changelog: string; version: string; commit: string; sha256: string }): string {
  if (!validSha1(input.commit)) return fail('COMMIT_INVALID');
  if (!validSha256(input.sha256)) return fail('CHECKSUM_MALFORMED');
  const notes = extractChangelogSection(input.changelog, input.version);
  return `${notes}\n\n---\n\nSource commit: \`${input.commit.toLowerCase()}\`\n\nVSIX SHA-256: \`${input.sha256}\`\n`;
}

export function renderReleaseNotesForApproval(notes: string): string {
  const escaped = notes.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<details><summary>Verified release notes for approval</summary>\n\n<pre>${escaped}</pre>\n\n</details>`;
}

export function isVersion(value: string): boolean {
  return VERSION.test(value);
}
