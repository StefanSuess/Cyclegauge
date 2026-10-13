import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('normal CI retains read-only permissions and has no publishing credentials', () => {
  const ci = read('../../.github/workflows/ci.yml');
  const [normalCi, attestationJob] = ci.split(/^  attest:\s*$/m);
  assert.ok(attestationJob);
  assert.match(ci, /^permissions:\s*\n  contents: read\s*$/m);
  assert.doesNotMatch(normalCi, /id-token:\s*write|attestations:\s*write/);
  assert.match(attestationJob, /if: \$\{\{ github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\) \}\}/);
  assert.match(attestationJob, /needs: \[verify, candidate, candidate-host\]/);
  assert.match(attestationJob, /id-token: write/);
  assert.match(attestationJob, /attestations: write/);
  assert.doesNotMatch(ci, /contents:\s*write|OPENVSX_PAT|ovsx publish/);
});

test('release is manual-only and separates protected OIDC and PAT publishing permissions', () => {
  const workflow = read('../../.github/workflows/release.yml');
  assert.match(workflow, /^on:\s*\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|release|schedule):/m);
  assert.match(workflow, /^permissions:\s*\{\s*\}/m);
  assert.match(workflow, /^  publish-trusted:/m);
  assert.match(workflow, /^  publish-pat:/m);
  const preflight = workflow.split('  publish-trusted:\n')[0];
  const trusted = `  publish-trusted:\n${workflow.split('  publish-trusted:\n')[1].split('  publish-pat:\n')[0]}`;
  const pat = `  publish-pat:\n${workflow.split('  publish-pat:\n')[1]}`;
  assert.match(preflight, /actions: read/);
  assert.match(preflight, /contents: read/);
  assert.doesNotMatch(preflight, /contents: write|id-token: write|environment:\s*\n\s+name: release|secrets\.OPENVSX_PAT/);
  assert.match(trusted, /environment:\s*\n\s+name: release/);
  assert.match(trusted, /contents: write/);
  assert.match(trusted, /id-token: write/);
  assert.doesNotMatch(trusted, /secrets\.OPENVSX_PAT/);
  assert.doesNotMatch(pat, /id-token: write/);
  assert.match(pat, /environment:\s*\n\s+name: release/);
  assert.match(pat, /contents: write/);
  assert.match(pat, /secrets\.OPENVSX_PAT/);
  assert.equal((workflow.match(/secrets\.OPENVSX_PAT/g) || []).length, 1);
  assert.doesNotMatch(trusted + pat, /pnpm install|npm install|git .*fetch/);
  assert.match(preflight, /working-directory: scripts\/release\/package-manager\s+run: \|\n\s+npm ci --ignore-scripts/);
  assert.match(preflight, /--dir \.\.\/publisher-tools install --frozen-lockfile --ignore-scripts/);
  assert.doesNotMatch(preflight, /npm install --global pnpm/);
  const managerPackage = JSON.parse(read('../../scripts/release/package-manager/package.json')) as {
    dependencies: { pnpm: string };
  };
  const managerLock = JSON.parse(read('../../scripts/release/package-manager/package-lock.json')) as {
    packages: Record<string, { version?: string; resolved?: string; integrity?: string }>;
  };
  const pinnedPnpm = managerLock.packages['node_modules/pnpm'];
  assert.equal(managerPackage.dependencies.pnpm, '12.10.1');
  assert.equal(pinnedPnpm.version, managerPackage.dependencies.pnpm);
  assert.match(pinnedPnpm.resolved ?? '', /^https:\/\/registry\.npmjs\.org\/pnpm\//);
  assert.match(pinnedPnpm.integrity ?? '', /^sha512-[A-Za-z0-9+/]+=*$/);
  const publisher = read('../../scripts/release/publish-candidate.ts');
  assert.match(publisher, /verifyCurrentMainSha\(await adapter\.readMainSha\(\), candidate\.commit\)/);
});

test('release workflow exposes only version, dry-run, and auth-mode inputs', () => {
  const workflow = read('../../.github/workflows/release.yml');
  const dispatch = workflow.split('permissions:')[0];
  for (const input of ['version:', 'dry_run:', 'auth_mode:']) assert.ok(dispatch.includes(`      ${input}`));
  assert.doesNotMatch(dispatch, /run_id:|artifact_id:|sha256:|confirmation:/);
});

test('every external action is pinned to a full commit SHA', () => {
  const workflow = read('../../.github/workflows/release.yml');
  const actions = workflow.split('\n').filter(line => /^\s*uses:\s/.test(line));
  assert.ok(actions.length >= 5);
  for (const action of actions) assert.match(action, /^\s*uses:\s*[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/);
});

test('preflight extracts the single ID-selected CI artifact directly into the verified candidate directory', () => {
  const workflow = read('../../.github/workflows/release.yml');
  const preflight = workflow.split('  publish-trusted:\n')[0];
  const step = preflight.split('- name: Download the selected artifact by immutable artifact ID\n')[1].split('\n      - name:')[0];
  // download-artifact@v4 puts artifact-ids downloads in release/input/<artifact name>/ unless merge-multiple is true,
  // while verify-promotion.ts requires exactly the three candidate files directly under CANDIDATE_DIR.
  assert.match(step, /artifact-ids: \$\{\{ steps\.select\.outputs\.artifact_id \}\}/);
  assert.doesNotMatch(step, /^\s+(?:name|pattern):/m);
  assert.match(step, /^\s+path: release\/input$/m);
  assert.match(step, /^\s+merge-multiple: true$/m);
  assert.match(preflight, /CANDIDATE_DIR: release\/input$/m);
});
