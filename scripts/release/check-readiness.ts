import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../is-main.ts';
import { validateReleaseRequest } from './promotion-policy.ts';
import { createAdapterFromEnv } from './release-state.ts';
import { promoteCandidate, type PromotionCandidate } from './promotion-state.ts';

const fail = (code: string): never => { throw new Error(code); };
const requiredEnv = (name: string) => process.env[name] || fail('CONFIG_INVALID');

async function run(): Promise<void> {
  const root = process.env.PROMOTION_BUNDLE_DIR || 'release/promotion-bundle';
  const metadata = JSON.parse(readFileSync(join(root, 'promotion.json'), 'utf8')) as Record<string, unknown>;
  const version = requiredEnv('VERSION');
  if (metadata.version !== version || metadata.commit !== requiredEnv('SOURCE_SHA') ||
      metadata.runId !== Number(requiredEnv('RUN_ID')) || metadata.artifactId !== Number(requiredEnv('ARTIFACT_ID'))) {
    return fail('PROMOTION_METADATA_MISMATCH');
  }
  if (metadata.artifactName !== 'release-candidate' || typeof metadata.sha256 !== 'string' ||
      metadata.vsixAssetName !== `bobert-v${version}.vsix` || metadata.checksumAssetName !== 'SHA256SUMS.txt' ||
      typeof metadata.releaseName !== 'string') return fail('PROMOTION_METADATA_INVALID');
  const request = validateReleaseRequest({ version, dryRun: true, authMode: requiredEnv('AUTH_MODE') });
  const candidate: PromotionCandidate = {
    version,
    commit: String(metadata.commit),
    sha256: String(metadata.sha256),
    vsixBytes: readFileSync(join(root, String(metadata.vsixAssetName))),
    checksumBytes: readFileSync(join(root, String(metadata.checksumAssetName))),
    vsixAssetName: String(metadata.vsixAssetName),
    checksumAssetName: String(metadata.checksumAssetName),
    releaseName: String(metadata.releaseName),
    releaseNotes: readFileSync(join(root, 'release-notes.md'), 'utf8'),
  };
  const adapter = createAdapterFromEnv(join(root, 'scripts/release/publisher-tools'), 'limited');
  const result = await promoteCandidate(adapter, candidate, {
    dryRun: true,
    authMode: request.authMode,
  });
  appendFileSync(requiredEnv('GITHUB_STEP_SUMMARY'), [
    '### Read-only publication readiness',
    '',
    `- Remote state: \`${result.status}\`; visible conflicts and unverifiable records were rejected`,
    '- Draft visibility may be limited here; the protected publishing job checks drafts again before any release creation',
    '- No Open VSX, tag, or GitHub release write was made',
    '- Credential readiness not tested; this job has no publishing secret or OIDC permission',
    '',
  ].join('\n'), { encoding: 'utf8' });
}

async function main(): Promise<number> {
  try {
    await run();
    return 0;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'READINESS_CHECK_FAILED';
    console.error(`RELEASE_READINESS ${code}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
