import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFailures, parseExpected, parseTap } from '../../scripts/release/expected-failures.ts';
import { parseArgs as parseSmokeArgs } from '../../scripts/release/smoke-bundle.ts';
import { checkWorkflow } from '../../scripts/release/workflow-policy.ts';

// Gates that decide whether a CI step may pass. Each test first shows the gate accepting the real
// input, then shows it rejecting the specific failure it exists to catch.
const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
const expectedList = readFileSync(fileURLToPath(new URL('../windows-expected-failures.txt', import.meta.url)), 'utf8');

const tap = (lines: string[], tests = lines.length) => [...lines, `# tests ${tests}`, '# pass 0'].join('\n');

test('expected-failure gate: only top-level, non-TODO failures count, and escaped names are restored', () => {
 const summary = parseTap(tap([
  'not ok 1 - store opens \\# twice', '    not ok 1 - a subtest', 'not ok 2 - parent', 'ok 3 - skipped # SKIP reason',
  'not ok 4 - unfinished # TODO', 'not ok 5 - store opens \\# twice',
 ]));
 assert.equal(summary.tests, 6);
 assert.deepEqual(summary.failures, ['parent', 'store opens # twice']);
});

test('expected-failure gate: a new failure, a stale entry or a run with no test count all fail', () => {
 const expected = ['alpha', 'beta'];
 assert.equal(compareFailures(parseTap(tap(['not ok 1 - alpha', 'not ok 2 - beta'])), expected).ok, true);
 // The 47bbf89 case: a new, non-storage failure on Windows previously left the run green.
 const extra = compareFailures(parseTap(tap(['not ok 1 - alpha', 'not ok 2 - beta', 'not ok 3 - gamma'])), expected);
 assert.deepEqual([extra.ok, extra.unexpected], [false, ['gamma']]);
 const stale = compareFailures(parseTap(tap(['not ok 1 - alpha', 'ok 2 - beta'])), expected);
 assert.deepEqual([stale.ok, stale.noLongerFailing], [false, ['beta']]);
 const crashed = compareFailures(parseTap('not ok 1 - alpha\nnot ok 2 - beta\n'), expected);
 assert.deepEqual([crashed.ok, crashed.problems], [false, ['TAP_NO_TEST_COUNT']]);
 // A load failure names the file, which is never on the list.
 assert.equal(compareFailures(parseTap(tap(['not ok 1 - tests/unit/x.test.ts'])), []).ok, false);
});

test('the Windows expected-failure list is non-empty, unique and names only existing test titles', () => {
 const names = parseExpected(expectedList);
 assert.ok(names.length > 0);
 assert.equal(names.length, expectedList.split('\n').filter(l => l.trim() && !l.startsWith('#')).length);
 const unitDir = fileURLToPath(new URL('../unit/', import.meta.url));
 const all = readdirSync(unitDir).filter(f => f.endsWith('.test.ts')).map(f => readFileSync(join(unitDir, f), 'utf8')).join('\n');
 for (const name of names) assert.ok(all.includes(name), 'listed name not found among unit test titles');
});

test('smoke command line: an unknown flag, a repeated option or a second file is a usage error', () => {
 assert.deepEqual(parseSmokeArgs(['c.vsix']), { file: 'c.vsix', simulate: 'none' });
 assert.deepEqual(parseSmokeArgs(['--simulate', 'no-sqlite', 'c.vsix']), { file: 'c.vsix', simulate: 'no-sqlite' });
 for (const argv of [[], ['c.vsix', '--simulat', 'no-sqlite'], ['c.vsix', '--simulate'], ['c.vsix', '--simulate', 'bogus'],
  ['c.vsix', '--simulate', 'no-sqlite', '--simulate', 'none'], ['c.vsix', 'd.vsix'], ['--simulate', 'none']]) {
  assert.equal(parseSmokeArgs(argv), undefined, argv.join(' '));
 }
});

test('SC3: the CI workflow keeps a read-only token, no secrets, SHA-pinned actions and digest-pinned images', () => {
 assert.deepEqual(checkWorkflow(workflow), []);
});

test('SC3: the workflow policy rejects each widening it exists to catch', () => {
 const cases: [string, string, string][] = [
  ['contents: read', 'contents: write', 'PERMISSIONS_NOT_READ_ONLY'],
  ['permissions:\n  contents: read', 'permissions: write-all', 'PERMISSIONS_NOT_SINGLE_TOP_LEVEL'],
  ['    runs-on: ubuntu-24.04\n', '    runs-on: ubuntu-24.04\n    permissions:\n      id-token: write\n', 'PERMISSIONS_NOT_SINGLE_TOP_LEVEL'],
  ['  pull_request:\n', '  pull_request_target:\n', 'PRIVILEGED_TRIGGER'],
  ['          node-version: \'24.13.0\'\n', '          node-version: \'24.13.0\'\n          token: ${{ secrets.SYNTHETIC_NAME }}\n', 'SECRET_REFERENCE'],
  ['actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', 'actions/setup-node@v4', 'ACTION_NOT_PINNED_BY_SHA'],
  ['@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0', '@49933ea5288caeca8642d1e84afbd3f7d6820020', 'ACTION_PIN_WITHOUT_VERSION_COMMENT'],
  ['          persist-credentials: false\n', '', 'CHECKOUT_PERSISTS_CREDENTIALS'],
  ['ubi9/ubi@sha256:5858f9ace07316e3b12caab62f6c2481a5030bb6bafdca5a9ea324c321ef36df', 'ubi9/ubi:latest', 'IMAGE_NOT_PINNED_BY_DIGEST'],
  ['pnpm install --frozen-lockfile', 'pnpm install', 'INSTALL_NOT_FROZEN'],
  ['npm install --global pnpm@${{ env.PNPM_VERSION }}', 'npm install --global pnpm', 'NPM_INSTALL_NOT_PINNED'],
  ["PNPM_VERSION: '12.10.1'", "PNPM_VERSION: '12'", 'PNPM_VERSION_NOT_EXACT'],
 ];
 for (const [from, to, code] of cases) {
  assert.ok(workflow.includes(from), `fixture anchor missing for ${code}`);
  assert.ok(checkWorkflow(workflow.replace(from, to)).includes(code), code);
 }
});
