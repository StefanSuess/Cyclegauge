import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the existing Ubuntu verification job enforces and reports loaded-source coverage once', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const verify = ci.split('  candidate:\n')[0];
  assert.match(verify, /name: verify \(\$\{\{ matrix\.os \}\}\)/);
  assert.match(verify, /- name: Unit suite\n\s+if: \$\{\{ !cancelled\(\) && runner\.os != 'Linux' \}\}\n\s+run: pnpm test/);
  assert.match(verify, /- name: Unit suite with coverage\n\s+if: \$\{\{ !cancelled\(\) && runner\.os == 'Linux' \}\}/);
  assert.match(verify, /pnpm test:coverage \| tee coverage\.txt/);
  assert.match(verify, /coverage_status=\$\?/);
  assert.match(verify, /GITHUB_STEP_SUMMARY/);
  assert.match(verify, /exit "\$\{coverage_status:-0\}"/);
  assert.equal((verify.match(/pnpm test:coverage/g) ?? []).length, 1);
  assert.equal((verify.match(/run: pnpm test\n/g) ?? []).length, 1);
  assert.equal(existsSync(new URL('../../.github/workflows/coverage.yml', import.meta.url)), false);

  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.doesNotMatch(readme, /actions\/workflows\/coverage\.yml/);
  assert.match(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'), /"test:coverage":/);
});
