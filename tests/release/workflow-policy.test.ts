import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('CI names the candidate by version and commit and passes the name only through env and validated outputs', () => {
  const ci = read('../../.github/workflows/ci.yml');
  assert.doesNotMatch(ci, /(?<![\w${}"-])candidate\.vsix/);
  assert.doesNotMatch(ci, /release\/candidate\.vsix/);
  assert.match(ci, /name="bobert-v\$\{version\}-\$\{short\}-candidate\.vsix"/);
  assert.match(ci, /short="\$\{GITHUB_SHA:0:12\}"/);
  assert.match(ci, /^      vsix_name: \$\{\{ steps\.build\.outputs\.vsix_name \}\}$/m);
  assert.match(ci, /echo "\$sha  \$name" > release\/SHA256SUMS\.txt/);
  // The job output is never interpolated into a run script; it reaches shell only as an environment variable.
  for (const match of ci.matchAll(/^ *run: ([\s\S]*?)(?=^ {6}- |^ {2}\S|(?![\s\S]))/gm)) {
    assert.doesNotMatch(match[1], /\$\{\{[^}]*(?:vsix_name|steps\.candidate|steps\.build)/);
  }
  const consumers = ci.split(/^  candidate-host:\s*$/m)[1];
  assert.equal((consumers.match(/CANDIDATE_VSIX: \$\{\{ needs\.candidate\.outputs\.vsix_name \}\}/g) || []).length, 2);
  assert.equal((consumers.match(/\^bobert-v\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)\\\.\(0\|\[1-9\]\[0-9\]\*\)-\[0-9a-f\]\{12\}-candidate\\\.vsix\$/g) || []).length, 2);
  assert.equal((consumers.match(/needs\.candidate\.outputs\.vsix_name/g) || []).length, 2);
  // Windows defaults to PowerShell. Only the validation, verify-vsix and macOS host steps pin bash; the Windows
  // host test stays in PowerShell (no Git Bash TEMP/8.3 path rewriting) and reads the path from $env:.
  const hostJob = consumers.split(/^  attest:\s*$/m)[0];
  const steps = hostJob.split(/^      - /m);
  for (const step of steps.filter(entry => /CANDIDATE_(?:VSIX|PATH)/.test(entry) && !/\(Windows\)/.test(entry))) assert.match(step, /^ {8}shell: bash$/m);
  const windowsHost = steps.filter(entry => /\(Windows\)/.test(entry));
  assert.equal(windowsHost.length, 1);
  assert.match(windowsHost[0], /^ {8}if: runner\.os == 'Windows'$/m);
  assert.doesNotMatch(windowsHost[0], /shell:/);
  assert.match(windowsHost[0], /run: pnpm test:host "\$env:CANDIDATE_PATH"$/m);
  assert.match(steps.find(entry => /\(macOS\)/.test(entry)) ?? '', /^ {8}if: runner\.os == 'macOS'$/m);
  // The attestation subject is the validated single path, not a glob.
  assert.match(ci, /subject-path: \$\{\{ steps\.candidate\.outputs\.path \}\}/);
});

const validationScripts = (): string[] => {
  const ci = read('../../.github/workflows/ci.yml');
  return ci.split('      - name: Validate the downloaded candidate file name and directory\n').slice(1).map(part => {
    const lines = part.split('\n');
    const start = lines.indexOf('        run: |') + 1;
    const body: string[] = [];
    for (const line of lines.slice(start)) {
      if (line !== '' && !line.startsWith('          ')) break;
      body.push(line.slice(10));
    }
    return body.join('\n');
  });
};

test('both candidate validation steps run the same strict pure-bash script', () => {
  const [hostScript, attestScript, ...rest] = validationScripts();
  assert.equal(rest.length, 0);
  assert.ok(hostScript && hostScript === attestScript);
  for (const needle of ['${GITHUB_SHA:0:12}', 'CANDIDATE_ARTIFACT_CONTENTS_INVALID', 'CANDIDATE_NAME_INVALID', '-L', 'export LC_ALL=C', 'shopt -s dotglob nullglob']) {
    assert.ok(hostScript.includes(needle), needle);
  }
  assert.doesNotMatch(hostScript, /\bls\b/);
  assert.ok(hostScript.includes('(0|[1-9][0-9]*)'));
});

test('the candidate validation script accepts only the exact artifact directory', { skip: process.platform === 'win32' }, () => {
  const [script] = validationScripts();
  const sha = 'abcdef0123456789abcdef0123456789abcdef01';
  const good = 'bobert-v1.0.0-abcdef012345-candidate.vsix';
  const root = mkdtempSync(join(tmpdir(), 'synthetic-validate-'));
  try {
    const run = (tag: string, build: (dir: string) => void, env: Record<string, string> = {}) => {
      const cwd = join(root, tag);
      mkdirSync(join(cwd, 'release'), { recursive: true });
      build(join(cwd, 'release'));
      const output = join(cwd, 'output');
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-c', script], {
        cwd, encoding: 'utf8',
        env: { PATH: process.env.PATH, GITHUB_SHA: sha, CANDIDATE_VSIX: good, GITHUB_OUTPUT: output, ...env },
      });
      return { result, output: readFileSync(output, 'utf8') };
    };
    const layout = (dir: string, name = good) => {
      for (const file of [name, 'manifest-linux.json', 'SHA256SUMS.txt']) writeFileSync(join(dir, file), 'synthetic');
    };
    const ok = run('good', layout);
    assert.equal(ok.result.status, 0, String(ok.result.stderr));
    assert.equal(ok.output, `path=release/${good}\n`);

    const bad = (tag: string, code: string, build: (dir: string) => void, env?: Record<string, string>) => {
      const { result, output } = run(tag, build, env);
      assert.equal(result.status, 1, tag);
      assert.equal(String(result.stdout).trim(), code, tag);
      assert.equal(output, '', tag);
    };
    const wrongSha = 'bobert-v1.0.0-abcdef012346-candidate.vsix';
    bad('wrong-sha', 'CANDIDATE_NAME_INVALID', dir => layout(dir, wrongSha), { CANDIDATE_VSIX: wrongSha });
    bad('old-name', 'CANDIDATE_NAME_INVALID', dir => layout(dir, 'candidate.vsix'), { CANDIDATE_VSIX: 'candidate.vsix' });
    bad('leading-zero', 'CANDIDATE_NAME_INVALID', dir => layout(dir, 'bobert-v01.0.0-abcdef012345-candidate.vsix'), { CANDIDATE_VSIX: 'bobert-v01.0.0-abcdef012345-candidate.vsix' });
    bad('injected', 'CANDIDATE_NAME_INVALID', layout, { CANDIDATE_VSIX: `${good}; echo synthetic-injected` });
    bad('extra', 'CANDIDATE_ARTIFACT_CONTENTS_INVALID', dir => { layout(dir); writeFileSync(join(dir, '.synthetic-hidden'), 'x'); });
    bad('missing', 'CANDIDATE_ARTIFACT_CONTENTS_INVALID', dir => { layout(dir); rmSync(join(dir, 'manifest-linux.json')); });
    bad('renamed', 'CANDIDATE_ARTIFACT_CONTENTS_INVALID', dir => { layout(dir); renameSync(join(dir, 'SHA256SUMS.txt'), join(dir, 'SHA256SUMS.bak')); });
    bad('symlinked-vsix', 'CANDIDATE_ARTIFACT_CONTENTS_INVALID', dir => {
      layout(dir);
      rmSync(join(dir, good));
      symlinkSync(join(dir, 'SHA256SUMS.txt'), join(dir, good));
    });
    bad('directory', 'CANDIDATE_ARTIFACT_CONTENTS_INVALID', dir => { layout(dir); rmSync(join(dir, good)); mkdirSync(join(dir, good)); });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
