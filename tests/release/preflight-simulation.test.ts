import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVsix } from '../../scripts/release/build-vsix.ts';
import { candidateFileName } from '../../scripts/release/promotion-policy.ts';
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
const CANDIDATE_NAME = candidateFileName(version, GITHUB_SHA);

let built: Promise<Buffer> | undefined;
const vsixBytes = () => built ??= (async () => {
  const vsix = join(dir, 'built.vsix');
  await buildVsix(vsix);
  return readFileSync(vsix);
})();

/** Lays out a CI-shaped artifact directory; `fileName` / `checksumName` / `extra` allow synthetic fail-closed variants. */
interface LayoutOptions {
  fileName?: string; checksumName?: string; extra?: string; omit?: string;
  /** Replace the VSIX entry by a symlink to the real file, or by a directory. */
  entryKind?: 'symlink' | 'directory';
  /** Build the checksum text from the digest, e.g. to add a binary-mode marker or CRLF. */
  checksumLine?: (sha: string, fileName: string) => string;
}

async function layout(name: string, options: LayoutOptions = {}): Promise<string> {
  const input = join(dir, name);
  mkdirSync(input);
  const bytes = await vsixBytes();
  const sha = createHash('sha256').update(bytes).digest('hex');
  const verified = verifyVsix(bytes);
  const fileName = options.fileName ?? CANDIDATE_NAME;
  const files: Record<string, string | Buffer> = {
    [fileName]: bytes,
    'manifest-linux.json': JSON.stringify({ version: verified.version, files: verified.files }),
    'SHA256SUMS.txt': options.checksumLine ? options.checksumLine(sha, fileName) : `${sha}  ${options.checksumName ?? fileName}\n`,
  };
  if (options.extra) files[options.extra] = 'synthetic-extra';
  for (const [file, content] of Object.entries(files)) {
    if (file === options.omit) continue;
    if (file === fileName && options.entryKind === 'directory') mkdirSync(join(input, file));
    else if (file === fileName && options.entryKind === 'symlink') {
      writeFileSync(join(input, 'real-target.bin'), content);
      symlinkSync(join(input, 'real-target.bin'), join(input, file));
    } else writeFileSync(join(input, file), content);
  }
  return input;
}

async function simulate(input?: string, tag = '', sourceSha = GITHUB_SHA): Promise<{ bundle: string; output: string; result: ReturnType<typeof spawnSync> }> {
  input ??= await layout('input');
  const bundle = join(dir, `bundle${tag}`);
  const output = join(dir, `github-output${tag}`);
  const summary = join(dir, `summary${tag}`);
  writeFileSync(output, '');
  writeFileSync(summary, '');
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/release/verify-promotion.ts'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      VERSION: version, SOURCE_SHA: sourceSha, GITHUB_SHA, RUN_ID: '123456789', ARTIFACT_ID: '987654321',
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
  assert.equal(metadata.candidateFileName, CANDIDATE_NAME);
  assert.equal(metadata.vsixAssetName, `bobert-v${version}.vsix`);
  assert.deepEqual(readFileSync(join(bundle, `bobert-v${version}.vsix`)), await vsixBytes());
});

test('verify-promotion fails closed on any deviation from the exact candidate artifact layout', async () => {
  const wrongVersion = candidateFileName('9.9.9', GITHUB_SHA);
  const wrongSha = candidateFileName(version, 'b'.repeat(40));
  const cases: Array<[string, LayoutOptions, string]> = [
    ['wrong-version', { fileName: wrongVersion }, 'CI_ARTIFACT_CONTENTS_INVALID'],
    ['wrong-sha', { fileName: wrongSha }, 'CI_ARTIFACT_CONTENTS_INVALID'],
    ['old-name', { fileName: 'candidate.vsix' }, 'CI_ARTIFACT_CONTENTS_INVALID'],
    ['missing', { omit: 'manifest-linux.json' }, 'CI_ARTIFACT_CONTENTS_INVALID'],
    ['extra', { extra: 'synthetic-extra.txt' }, 'CI_ARTIFACT_CONTENTS_INVALID'],
    ['checksum-wrong-file', { checksumName: 'candidate.vsix' }, 'CHECKSUM_MALFORMED'],
    ['checksum-binary-marker', { checksumLine: (sha, name) => `${sha} *${name}\n` }, 'CHECKSUM_MALFORMED'],
    ['directory-entry', { entryKind: 'directory' }, 'CI_ARTIFACT_CONTENTS_INVALID'],
    ...(process.platform === 'win32' ? [] : [['symlink-entry', { entryKind: 'symlink' }, 'CI_ARTIFACT_CONTENTS_INVALID'] as [string, LayoutOptions, string]]),
  ];
  for (const [tag, options, code] of cases) {
    const { result } = await simulate(await layout(`case-${tag}`, options), `-${tag}`);
    assert.equal(result.status, 1, tag);
    assert.match(String(result.stderr), new RegExp(`^RELEASE_PROMOTION ${code}$`, 'm'), tag);
    assert.equal(existsSync(join(dir, `bundle-${tag}`)), false, tag);
  }
});

test('verify-promotion accepts an uppercase source SHA and a CRLF checksum file', async () => {
  const upper = await simulate(await layout('case-upper'), '-upper', GITHUB_SHA.toUpperCase());
  assert.equal(upper.result.status, 0, String(upper.result.stderr));
  const crlf = await simulate(await layout('case-crlf', { checksumLine: (sha, name) => `${sha}  ${name}\r\n` }), '-crlf');
  assert.equal(crlf.result.status, 0, String(crlf.result.stderr));
  const metadata = JSON.parse(readFileSync(join(crlf.bundle, 'promotion.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(metadata.candidateFileName, CANDIDATE_NAME);
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
