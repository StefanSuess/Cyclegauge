import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise the exact inline verifier with synthetic API responses and no PR checkout.
const workflow = readFileSync(new URL('../../.github/workflows/dependabot-auto-merge.yml', import.meta.url), 'utf8');
const match = workflow.match(/          node <<'NODE'\r?\n([\s\S]*?)\r?\n          NODE/);
assert.ok(match, 'The verification script must remain present');
const script = match[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
const repository = 'StefanSuess/Bobert';
const sha = 'a'.repeat(40);

function verify(options: {
 update?: string; group?: string; branch?: string; headSha?: string;
 signed?: boolean; fileName?: string; linked?: boolean; author?: string;
 commitCount?: number;
} = {}): { permitted: boolean; requests: string[] } {
 const number = 123;
 const prUrl = '/repos/' + repository + '/pulls/' + number;
 const metadata = 'chore(deps): synthetic update\n\nupdated-dependencies:\n' +
  '- dependency-name: "synthetic-package"\n' +
  '  dependency-version: 1.2.4\n' +
  '  dependency-type: direct:development\n' +
  '  update-type: ' + (options.update ?? 'version-update:semver-patch') + '\n' +
  '  dependency-group: ' + (options.group ?? 'npm-patch') + '\n...\n';
 const pr = {
  number, state: 'open', draft: false, user: { login: options.author ?? 'dependabot[bot]' },
  base: { ref: 'main' }, head: { repo: { full_name: repository },
   ref: options.branch ?? 'dependabot/npm_and_yarn/npm-patch-synthetic', sha: options.headSha ?? sha },
  commits: options.commitCount ?? 1, changed_files: 2,
 };
 const apis: Record<string, unknown> = {
  [prUrl]: pr,
  [prUrl + '/commits?per_page=100']: [{
   sha, author: { login: 'dependabot[bot]' },
   commit: { verification: { verified: options.signed ?? true }, message: metadata },
  }],
  [prUrl + '/files?per_page=100']: [
   { filename: options.fileName ?? 'package.json', status: 'modified' },
   { filename: 'pnpm-lock.yaml', status: 'modified' },
  ],
 };
 const requests: string[] = [];
 let output = '';
 const context = {
  process: {
   env: {
    REPOSITORY: repository, CI_HEAD_SHA: sha,
    CI_PULL_REQUESTS: JSON.stringify(options.linked === false ? [] : [{ number }]),
    GITHUB_OUTPUT: 'synthetic-github-output',
   },
   exit(code: number) {
    assert.equal(code, 0);
    throw new Error('SYNTHETIC_EXIT');
   },
  },
  console: { log: (_message: string) => {} },
  require(module: string) {
   if (module === 'node:child_process') return {
    execFileSync(command: string, args: string[]) {
     assert.equal(command, 'gh');
     assert.equal(args.slice(0, 3).join('|'), 'api|--method|GET');
     const url = args[3];
     requests.push(url);
     assert.ok(Object.hasOwn(apis, url), 'Unexpected API endpoint: ' + url);
     return JSON.stringify(apis[url]);
    },
   };
   if (module === 'node:fs') return {
    appendFileSync(file: string, value: string) {
     assert.equal(file, 'synthetic-github-output');
     output += value;
    },
   };
   throw new Error('Unexpected module: ' + module);
  },
 };
 try {
  runInNewContext(script, context, { timeout: 1_000 });
 } catch (error) {
  if (!(error instanceof Error && error.message === 'SYNTHETIC_EXIT')) throw error;
 }
 const permitted = output.includes('eligible=true\n');
 assert.equal(permitted, output.includes('number=123\n'));
 return { permitted, requests };
}

test('one signed Dependabot patch PR at the exact CI head is eligible', () => {
 const result = verify();
 assert.equal(result.permitted, true);
 assert.equal(result.requests.length, 3);
});

test('minor, major and unrelated groups are rejected', () => {
 assert.equal(verify({ update: 'version-update:semver-minor' }).permitted, false);
 assert.equal(verify({ update: 'version-update:semver-major' }).permitted, false);
 assert.equal(verify({ group: 'npm-minor' }).permitted, false);
 assert.equal(verify({ group: 'actions-minor-patch' }).permitted, false);
});

test('changed head, non-Dependabot author, missing PR and unrelated branches are rejected', () => {
 assert.equal(verify({ headSha: 'b'.repeat(40) }).permitted, false);
 assert.equal(verify({ author: 'someone-else' }).permitted, false);
 assert.equal(verify({ linked: false }).permitted, false);
 assert.equal(verify({ branch: 'dependabot/npm_and_yarn/typescript-7.0.2' }).permitted, false);
});

test('unverified commits, extra commits and extra files are rejected', () => {
 assert.equal(verify({ signed: false }).permitted, false);
 assert.equal(verify({ commitCount: 2 }).permitted, false);
 assert.equal(verify({ fileName: '.github/workflows/release.yml' }).permitted, false);
});

test('privileged job checks source workflow and never runs untrusted code', () => {
 const preflight = workflow.split('      - name: Enable squash auto-merge after required checks')[0];
 assert.doesNotMatch(preflight, /DEPENDABOT_AUTOMERGE_TOKEN|actions\/checkout|download-artifact|gh pr merge/);
 assert.match(workflow, /github\.event\.workflow_run\.event == 'pull_request'/);
 assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
 assert.match(workflow, /github\.event\.workflow_run\.actor\.login == 'dependabot\[bot\]'/);
 assert.match(workflow, /gh pr merge --auto --squash/);
});
