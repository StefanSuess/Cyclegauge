// Turns an "expected to fail" suite run into a gate (Milestone 6, Task 9).
//
//   node scripts/release/expected-failures.ts <results.tap> <expected-failures.txt>
//
// The Windows baseline suite fails wherever a Store is opened, because win32 storage stays fail
// closed until SC1/SC2. Without this check that step could only be informational, so a new Windows
// failure (or a crash that ran nothing) still produced a green run. This compares the failing
// top-level tests, by name, with a reviewed list: any unlisted failure fails, and so does a listed
// test that no longer fails, so the list cannot silently go stale. Test names are synthetic titles
// from this repository; nothing else from the run is printed.
import { readFileSync } from 'node:fs';
import { isMain } from '../is-main.ts';

export interface TapSummary { tests: number; failures: string[] }
export interface FailureComparison { ok: boolean; unexpected: string[]; noLongerFailing: string[]; problems: string[] }

const unescapeName = (name: string) => name.replace(/\\([\\#])/g, '$1');

/** Top-level results only: subtests are indented, and a failing subtest also fails its parent. */
export function parseTap(text: string): TapSummary {
 const failures = new Set<string>();
 let tests = -1;
 for (const line of text.split(/\r?\n/)) {
  const result = /^not ok \d+ - (.*)$/.exec(line);
  if (result) {
   // A failing TODO test does not fail the run, so it is not a failure here either.
   if (/ # TODO(?:\s.*)?$/.test(result[1])) continue;
   failures.add(unescapeName(result[1].replace(/ # (?:SKIP|TODO)(?:\s.*)?$/, '')));
   continue;
  }
  const count = /^# tests (\d+)$/.exec(line);
  if (count) tests = Number(count[1]);
 }
 return { tests, failures: [...failures].sort() };
}

/** One test name per line; blank lines and lines starting with `#` are ignored. */
export function parseExpected(text: string): string[] {
 return [...new Set(text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')))].sort();
}

export function compareFailures(summary: TapSummary, expected: string[]): FailureComparison {
 const problems: string[] = [];
 if (summary.tests <= 0) problems.push('TAP_NO_TEST_COUNT');
 const want = new Set(expected), got = new Set(summary.failures);
 const unexpected = summary.failures.filter(name => !want.has(name));
 const noLongerFailing = expected.filter(name => !got.has(name));
 return { ok: !problems.length && !unexpected.length && !noLongerFailing.length, unexpected, noLongerFailing, problems };
}

function main(): number {
 const args = process.argv.slice(2);
 if (args.length !== 2 || args.some(a => a.startsWith('--'))) { console.log('USAGE'); return 2; }
 let summary: TapSummary, expected: string[];
 try {
  summary = parseTap(readFileSync(args[0], 'utf8'));
  expected = parseExpected(readFileSync(args[1], 'utf8'));
 } catch { console.log('EXPECTED_FAILURES UNREADABLE'); return 1; }
 const result = compareFailures(summary, expected);
 console.log(`EXPECTED_FAILURES ${result.ok ? 'PASS' : 'FAIL'} tests=${summary.tests} failing=${summary.failures.length} expected=${expected.length}`);
 for (const p of result.problems) console.log(`  PROBLEM ${p}`);
 for (const name of result.unexpected) console.log(`  UNEXPECTED_FAILURE ${name}`);
 for (const name of result.noLongerFailing) console.log(`  NO_LONGER_FAILING ${name}`);
 return result.ok ? 0 : 1;
}
if (isMain(import.meta.url)) process.exitCode = main();
