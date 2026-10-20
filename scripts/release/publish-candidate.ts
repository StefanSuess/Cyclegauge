import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../is-main.ts';
import { validateReleaseRequest, verifyCurrentMainSha } from './promotion-policy.ts';
import { promoteCandidate, type PromotionCandidate } from './promotion-state.ts';
import { createAdapterFromEnv } from './release-state.ts';
import { verifyVsix } from './verify-vsix.ts';

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const fail = (code: string): never => { throw new Error(code); };
const requiredEnv = (name: string) => process.env[name] || fail('CONFIG_INVALID');

function assertDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

async function run(): Promise<void> {
  const bundleDir = process.env.PROMOTION_BUNDLE_DIR || 'release/promotion-bundle';
  const metadata = JSON.parse(readFileSync(join(bundleDir, 'promotion.json'), 'utf8')) as Record<string, unknown>;
  const version = requiredEnv('INPUT_VERSION');
  const request = validateReleaseRequest({ version, dryRun: false, authMode: requiredEnv('INPUT_AUTH_MODE') });
  const sourceSha = requiredEnv('SOURCE_SHA');
  if (metadata.version !== version || metadata.commit !== sourceSha || metadata.commit !== requiredEnv('GITHUB_SHA') ||
      metadata.runId !== Number(requiredEnv('EXPECTED_RUN_ID')) ||
      metadata.artifactId !== Number(requiredEnv('EXPECTED_ARTIFACT_ID')) || metadata.artifactName !== 'release-candidate') {
    return fail('PROMOTION_METADATA_MISMATCH');
  }
  if (!assertDigest(metadata.sha256) || !assertDigest(metadata.releaseNotesSha256) || !assertDigest(metadata.checksumFileSha256) ||
      typeof metadata.vsixAssetName !== 'string' || metadata.vsixAssetName !== `bobert-v${version}.vsix` ||
      metadata.checksumAssetName !== 'SHA256SUMS.txt' || metadata.releaseName !== `Bobert v${version}`) {
    return fail('PROMOTION_METADATA_INVALID');
  }

  const notes = readFileSync(join(bundleDir, 'release-notes.md'));
  const checksums = readFileSync(join(bundleDir, String(metadata.checksumAssetName)));
  const vsix = readFileSync(join(bundleDir, String(metadata.vsixAssetName)));
  if (sha256(notes) !== metadata.releaseNotesSha256 || sha256(checksums) !== metadata.checksumFileSha256 ||
      checksums.toString('utf8') !== `${metadata.sha256}  ${metadata.vsixAssetName}\n` || sha256(vsix) !== metadata.sha256) {
    return fail('PROMOTION_BUNDLE_INTEGRITY_FAILED');
  }
  const verified = verifyVsix(vsix);
  if (!verified.ok || verified.version !== version) return fail('PROMOTION_VSIX_INVALID');

  const candidate: PromotionCandidate = {
    version,
    commit: String(metadata.commit),
    sha256: String(metadata.sha256),
    vsixBytes: vsix,
    checksumBytes: checksums,
    vsixAssetName: String(metadata.vsixAssetName),
    checksumAssetName: String(metadata.checksumAssetName),
    releaseName: String(metadata.releaseName),
    releaseNotes: notes.toString('utf8'),
  };
  const publisherToolsDir = join(bundleDir, 'publisher-runtime/publisher-tools');
  const adapter = createAdapterFromEnv(publisherToolsDir, 'full');
  verifyCurrentMainSha(await adapter.readMainSha(), candidate.commit);
  const result = await promoteCandidate(adapter, candidate, { dryRun: false, authMode: request.authMode });
  appendFileSync(requiredEnv('GITHUB_STEP_SUMMARY'), [
    '### Release promotion completed',
    '',
    `- Version: \`${version}\``,
    `- Source commit: \`${sourceSha}\``,
    `- VSIX SHA-256: \`${candidate.sha256}\``,
    `- Result: \`${result.status}\``,
    '- Open VSX, tag, and GitHub release states were verified before and after applicable writes',
    '',
  ].join('\n'), { encoding: 'utf8' });
}

async function main(): Promise<number> {
  try {
    await run();
    return 0;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROMOTION_FAILED';
    console.error(`RELEASE_PUBLISH ${code}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
