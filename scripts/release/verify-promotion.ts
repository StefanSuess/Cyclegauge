import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { isMain } from '../is-main.ts';
import { ALLOWLIST, PAYLOAD, verifyVsix, type FileHash } from './verify-vsix.ts';
import { buildReleaseNotes, renderReleaseNotesForApproval, verifyCandidateIntegrity } from './promotion-policy.ts';

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const fail = (code: string): never => { throw new Error(code); };

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) return fail('CONFIG_INVALID');
  return value;
}

function appendOutput(name: string, value: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /[\r\n]/.test(value)) return fail('OUTPUT_INVALID');
  appendFileSync(requiredEnv('GITHUB_OUTPUT'), `${name.toLowerCase()}=${value}\n`, { encoding: 'utf8' });
}

function parseManifest(text: string): { version: string; files: FileHash[] } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail('CI_MANIFEST_INVALID'); }
  if (typeof value !== 'object' || value === null || !('version' in value) || !('files' in value)) return fail('CI_MANIFEST_INVALID');
  const manifest = value as { version: unknown; files: unknown };
  if (typeof manifest.version !== 'string' || !Array.isArray(manifest.files)) return fail('CI_MANIFEST_INVALID');
  const files = manifest.files as FileHash[];
  if (files.length !== ALLOWLIST.length ||
      files.some(file => !file || typeof file.name !== 'string' || !ALLOWLIST.includes(file.name) ||
        !/^[0-9a-f]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) ||
      new Set(files.map(file => file.name)).size !== ALLOWLIST.length ||
      ALLOWLIST.some(name => !files.some(file => file.name === name))) return fail('CI_MANIFEST_INVALID');
  return { version: manifest.version, files };
}

function run(): void {
  const version = requiredEnv('VERSION');
  const commit = requiredEnv('SOURCE_SHA');
  const runId = requiredEnv('RUN_ID');
  const artifactId = requiredEnv('ARTIFACT_ID');
  // Downstream readiness and publish checks compare these as numbers.
  const runIdNumber = Number(runId);
  const artifactIdNumber = Number(artifactId);
  if (!/^[1-9]\d*$/.test(runId) || !/^[1-9]\d*$/.test(artifactId) || !Number.isSafeInteger(runIdNumber) || runIdNumber < 1 || !Number.isSafeInteger(artifactIdNumber) || artifactIdNumber < 1) return fail('CONFIG_INVALID');
  const artifactDigest = process.env.ARTIFACT_DIGEST || 'unavailable';
  const sourceDir = process.env.CANDIDATE_DIR || 'release/input';
  const bundleDir = process.env.BUNDLE_DIR || 'release/promotion-bundle';
  if (commit.toLowerCase() !== requiredEnv('GITHUB_SHA').toLowerCase()) return fail('MAIN_SHA_MISMATCH');
  const entries = readdirSync(sourceDir, { withFileTypes: true });
  const expectedNames = ['candidate.vsix', 'manifest-linux.json', 'SHA256SUMS.txt'];
  if (entries.length !== expectedNames.length ||
      entries.some(entry => !entry.isFile() || !expectedNames.includes(entry.name)) ||
      expectedNames.some(name => !entries.some(entry => entry.name === name))) return fail('CI_ARTIFACT_CONTENTS_INVALID');

  const vsixPath = join(sourceDir, 'candidate.vsix');
  const vsix = readFileSync(vsixPath);
  const verification = verifyVsix(vsix);
  if (!verification.ok) return fail('VSIX_VERIFICATION_FAILED');
  const packageManifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown };
  if (typeof packageManifest.version !== 'string') return fail('PACKAGE_MANIFEST_INVALID');
  const ciManifest = parseManifest(readFileSync(join(sourceDir, 'manifest-linux.json'), 'utf8'));
  if (ciManifest.version !== verification.version) return fail('CI_MANIFEST_VERSION_MISMATCH');
  const verifiedPayload = verification.files.filter(file => PAYLOAD.includes(file.name));
  const ciPayload = ciManifest.files.filter(file => PAYLOAD.includes(file.name));
  const result = verifyCandidateIntegrity({
    requestedVersion: version,
    packageVersion: packageManifest.version,
    vsixVersion: verification.version,
    preRelease: verification.preRelease,
    actualSha256: sha256(vsix),
    checksumText: readFileSync(join(sourceDir, 'SHA256SUMS.txt'), 'utf8'),
    verifiedPayload,
    ciPayload,
  });
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  const notes = buildReleaseNotes({ changelog, version, commit, sha256: result.sha256 });

  mkdirSync(bundleDir);
  const assetName = `cyclegauge-v${version}.vsix`;
  copyFileSync(vsixPath, join(bundleDir, assetName), constants.COPYFILE_EXCL);
  writeFileSync(join(bundleDir, 'SHA256SUMS.txt'), `${result.sha256}  ${assetName}\n`, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(join(bundleDir, 'release-notes.md'), notes, { encoding: 'utf8', flag: 'wx' });
  writeFileSync(join(bundleDir, 'promotion.json'), JSON.stringify({
    version,
    commit,
    runId: runIdNumber,
    artifactId: artifactIdNumber,
    artifactName: 'release-candidate',
    artifactDigest,
    sha256: result.sha256,
    releaseNotesSha256: sha256(Buffer.from(notes)),
    checksumFileSha256: sha256(Buffer.from(`${result.sha256}  ${assetName}\n`)),
    vsixAssetName: assetName,
    checksumAssetName: 'SHA256SUMS.txt',
    releaseName: `Cyclegauge v${version}`,
  }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });

  appendOutput('VSIX_SHA256', result.sha256);
  appendOutput('BUNDLE_DIR', bundleDir);
  appendFileSync(requiredEnv('GITHUB_STEP_SUMMARY'), [
    '### Candidate integrity checks passed',
    '',
    `- Version: \`${version}\`; package and VSIX versions match`,
    `- Release channel: ${verification.channel}; pre-release flag matches the version`,
    `- Exact VSIX SHA-256: \`${result.sha256}\``,
    `- Allowlisted payload files compared with CI manifest: ${verifiedPayload.length}`,
    '- CI checksum entry and package manifest match',
    '- Release notes are derived from this commit\'s changelog section and shown below',
    '',
    renderReleaseNotesForApproval(notes),
    'The VSIX bytes were copied without rebuilding or repackaging.',
    '',
  ].join('\n'), { encoding: 'utf8' });
}

function main(): number {
  try {
    run();
    return 0;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROMOTION_VERIFICATION_FAILED';
    console.error(`RELEASE_PROMOTION ${code}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main();
