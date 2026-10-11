// Milestone 6 Workstream B: run the ACL proof-of-concept under a NON-ELEVATED token when the current
// token is elevated, and say plainly whether that actually happened.
//
//   node scripts/poc/win-acl/nonelevated.ts [--skip-profile] [--markdown-file <path>]
//
// Mechanism: `runas /trustlevel:0x20000` (Safer "Basic User"). It only REMOVES privileges from a copy
// of the caller's own token (administrator groups become deny-only); it creates no account, changes no
// setting, and cannot be used to gain rights. The result is never assumed: the child measures its own
// integrity level (`whoami /groups`, SID column) and the verdict below comes from that measurement.
//
//   NONELEVATED_RESULT=obtained      the child ran at medium or low integrity
//   NONELEVATED_RESULT=not_obtained  the child still ran elevated (or could not be launched): not evidence
//   NONELEVATED_RESULT=already       the launcher itself was not elevated; the report is direct
//
// Evidence from a hosted Windows Server runner is Windows Server evidence. It is not Windows 11 client
// evidence and not a managed-profile result.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../is-main.ts';
import { renderMarkdown, type Report } from './poc.ts';
import { systemExe, tokenFacts } from './tools.ts';

export type Verdict = 'obtained' | 'not_obtained' | 'already';

/** The verdict comes only from the integrity level the child measured about itself. */
export function classify(report: unknown): { verdict: 'obtained' | 'not_obtained'; integrity: string } {
 const environment = (report as { environment?: Record<string, unknown> } | undefined)?.environment;
 const integrity = typeof environment?.integrity_level === 'string' ? environment.integrity_level : 'unknown';
 return { verdict: integrity === 'medium' || integrity === 'low' ? 'obtained' : 'not_obtained', integrity };
}

/** A report that can be rendered: the proof-of-concept also prints `{"error": ...}` objects on failure. */
export function isUsableReport(report: unknown): report is Report {
 const r = report as Partial<Report> | undefined;
 return !!r && typeof r === 'object' && !!r.environment && typeof r.environment === 'object' && !!r.items && typeof r.items === 'object';
}

/** Batch files are parsed by cmd.exe in the OEM code page: plain printable ASCII paths only. */
export function batchSafe(value: string): boolean {
 return /^[A-Za-z]:\\[\x20-\x7e]+$/.test(value) && !/["%&|<>^!]/.test(value) && value.length < 260;
}

export function commandFile(node: string, script: string, args: string[], stage: string): string {
 for (const p of [node, script, stage]) if (!batchSafe(p)) throw new Error('PATH_UNSUPPORTED');
 for (const a of args) if (!/^--[a-z-]+$/.test(a)) throw new Error('ARGUMENT_UNSUPPORTED');
 return [
  '@echo off',
  `"${node}" --disable-warning=ExperimentalWarning "${script}" ${args.join(' ')} > "${stage}\\report.json" 2> "${stage}\\stderr.txt"`,
  `echo %ERRORLEVEL% > "${stage}\\exit.txt"`,
  `echo done > "${stage}\\done.txt"`,
  '',
 ].join('\r\n');
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const here = dirname(fileURLToPath(import.meta.url));
const level = (value: string) => (/^[a-z]+$/.test(value) ? value : 'unknown');

async function main(): Promise<number> {
 const argv = process.argv.slice(2);
 const forwarded = argv.includes('--skip-profile') ? ['--skip-profile'] : [];
 const mdIndex = argv.indexOf('--markdown-file');
 const markdownFile = mdIndex >= 0 ? argv[mdIndex + 1] : undefined;
 if (process.platform !== 'win32') { console.log('NONELEVATED_RESULT=not_applicable'); return 2; }
 const poc = join(here, 'poc.ts');

 let report: unknown;
 let verdict: Verdict = 'not_obtained';
 let integrity = 'unknown';
 const facts = await tokenFacts().catch(() => undefined);
 if (facts && (facts.integrity === 'medium' || facts.integrity === 'low')) {
  // Already a standard token: run directly, and still decide from what the report measured.
  const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', poc, ...forwarded], { encoding: 'utf8', timeout: 240_000, killSignal: 'SIGKILL' });
  try { report = JSON.parse(run.stdout); } catch { report = undefined; }
  const c = classify(report);
  integrity = c.integrity;
  verdict = c.verdict === 'obtained' ? 'already' : 'not_obtained';
 } else {
  let stage: string | undefined;
  try {
   stage = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-ekg-nonelev-')));
   const batch = join(stage, 'run.cmd');
   writeFileSync(batch, commandFile(process.execPath, poc, forwarded, stage));
   // Verbatim arguments: runas parses its own command line, so the inner quotes are escaped for it.
   const child = spawn(systemExe('runas.exe'), ['/trustlevel:0x20000', `"\\"${batch}\\""`], { windowsVerbatimArguments: true, stdio: 'ignore', windowsHide: true });
   let launchFailed = false, exited = false;
   child.on('error', () => { launchFailed = true; });
   child.on('exit', () => { exited = true; });
   const deadline = Date.now() + 180_000;
   while (!existsSync(join(stage, 'done.txt')) && !launchFailed && Date.now() < deadline) {
    // runas returns once it has started the batch; give a vanished launcher a short grace period.
    if (exited && Date.now() > deadline - 170_000 && !existsSync(join(stage, 'report.json'))) await sleep(1000);
    await sleep(500);
   }
   if (!exited) { try { child.kill(); } catch { /* already gone */ } }
   try { report = JSON.parse(readFileSync(join(stage, 'report.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { report = undefined; }
  } catch {
   report = undefined;
  } finally {
   if (stage) { try { rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ } }
  }
  const c = classify(report);
  verdict = c.verdict;
  integrity = c.integrity;
 }

 console.log(`NONELEVATED_RESULT=${verdict}`);
 console.log(`MEASURED_INTEGRITY=${level(integrity)}`);
 console.log('EVIDENCE_SCOPE=windows_server_runner_not_windows_11');
 const usable = isUsableReport(report) ? report : undefined;
 if (report !== undefined) console.log(JSON.stringify(report, null, 1));
 if (markdownFile) {
  const head = `### Non-elevated run: ${verdict} (measured integrity: ${level(integrity)}). Windows Server runner, not Windows 11.\n\n`;
  appendFileSync(markdownFile, head + (usable ? renderMarkdown(usable) : 'No usable report was produced.\n'));
 }
 return 0;
}
if (isMain(import.meta.url)) process.exitCode = await main();
