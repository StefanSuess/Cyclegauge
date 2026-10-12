import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVsix } from '../../scripts/release/build-vsix.ts';
import { verifyVsix } from '../../scripts/release/verify-vsix.ts';

// Simulates the release preflight job on synthetic data: the CI candidate layout is fed to
// verify-promotion.ts exactly as release.yml does, and its output is then consumed by the
// downstream readiness and publish scripts. The GitHub API base is a closed local port; check-readiness
// may still read public Open VSX state, which only changes which fail-closed code it reports.
const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'synthetic-preflight-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version;
const GITHUB_SHA = 'a'.repeat(40);

async function simulate(): Promise<{ bundle: string; output: string; result: ReturnType<typeof spawnSync> }> {
  const input = join(dir, 'input');
  mkdirSync(input);
  const vsix = join(input, 'candidate.vsix');
  await buildVsix(vsix, true);
  const bytes = readFileSync(vsix);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const verified = verifyVsix(bytes, { expectPreRelease: true });
  writeFileSync(join(input, 'manifest-linux.json'), JSON.stringify({ version: verified.version, files: verified.files }));
  writeFileSync(join(input, 'SHA256SUMS.txt'), `${sha}  candidate.vsix\n`);
  const bundle = join(dir, 'bundle');
  const output = join(dir, 'github-output');
  const summary = join(dir, 'summary');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/release/verify-promotion.ts'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      VERSION: version, SOURCE_SHA: GITHUB_SHA, GITHUB_SHA, RUN_ID: '123456789', ARTIFACT_ID: '987654321',
      ARTIFACT_DIGEST: `sha256:${'b'.repeat(64)}`, CANDIDATE_DIR: input, BUNDLE_DIR: bundle,
      GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
    },
  });
  return { bundle, output, result };
}

test('verify-promotion succeeds on a CI-shaped candidate and emits digit-bearing outputs', async () => {
  const { bundle, output, result } = await simulate();
  assert.equal(result.status, 0, String(result.stderr));
  const lines = readFileSync(output, 'utf8').trim().split('\n');
  assert.ok(lines.some(line => /^vsix_sha256=[0-9a-f]{64}$/.test(line)));
  assert.ok(lines.includes(`bundle_dir=${bundle}`));
  const metadata = JSON.parse(readFileSync(join(bundle, 'promotion.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(metadata.runId, 123456789);
  assert.equal(metadata.artifactId, 987654321);
  assert.equal(metadata.artifactName, 'release-candidate');
});

test('readiness and publish scripts accept the promotion metadata and fail only at the unreachable remote', async () => {
  const bundle = join(dir, 'bundle');
  assert.ok(existsSync(join(bundle, 'promotion.json')), 'bundle from the previous test is missing');
  const base = {
    PATH: process.env.PATH,
    GITHUB_TOKEN: 'synthetic-token', GITHUB_REPOSITORY: 'synthetic-owner/synthetic-repo', GITHUB_API_URL: 'https://127.0.0.1:9',
    VERSION: version, SOURCE_SHA: GITHUB_SHA, GITHUB_SHA, RUN_ID: '123456789', ARTIFACT_ID: '987654321',
    PROMOTION_BUNDLE_DIR: bundle, GITHUB_STEP_SUMMARY: join(dir, 'summary'),
  };
  const readiness = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/release/check-readiness.ts'], {
    cwd: root, encoding: 'utf8', env: { ...base, AUTH_MODE: 'pat' },
  });
  assert.equal(readiness.status, 1);
  assert.doesNotMatch(readiness.stderr, /PROMOTION_METADATA_(MISMATCH|INVALID)|CONFIG_INVALID|READINESS_CHECK_FAILED/);
  assert.match(readiness.stderr, /^RELEASE_READINESS [A-Z0-9_]+$/m);

  // Publishing is never reached: the unreachable API base stops it at the first remote read.
  const publish = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/release/publish-candidate.ts'], {
    cwd: root, encoding: 'utf8',
    env: { ...base, INPUT_VERSION: version, INPUT_AUTH_MODE: 'pat', EXPECTED_RUN_ID: '123456789', EXPECTED_ARTIFACT_ID: '987654321' },
  });
  assert.equal(publish.status, 1);
  assert.doesNotMatch(publish.stderr, /PROMOTION_(METADATA|BUNDLE)_|PROMOTION_VSIX_INVALID|CONFIG_INVALID/);
  assert.match(publish.stderr, /MAIN_STATE_UNAVAILABLE/);
});
