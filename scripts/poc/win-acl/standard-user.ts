// Platform-verification feasibility PoC: run the Windows ACL proof-of-concept under a genuinely
// separate, temporary local STANDARD user on a GitHub-hosted Windows runner.
//
//   node scripts/poc/win-acl/standard-user.ts --i-understand-this-creates-a-local-account [--skip-profile] [--markdown-file <path>]
//
// Unlike nonelevated.ts (which only strips rights from a copy of the administrator's own token), this
// creates a new local account that is a member of Users only, starts privilege-probe.ts as that account
// and decides from what the CHILD measured about itself. Nothing real is read; all data is synthetic and
// the report holds fixed tokens only. SIDs are compared in memory and never printed, logged or written
// anywhere but a private stage directory that is deleted afterwards.
//
// Guard: the explicit flag plus GITHUB_ACTIONS/RUNNER_ENVIRONMENT only protects against ACCIDENTAL use.
// Environment variables can be set by anyone, so this is NOT a security boundary and this script must
// not be run on a machine you care about. What limits the damage is that it only ever creates and
// deletes one fixed, synthetic account name, refuses to start if that account (or its task or profile)
// already exists, and is meant to run only on ephemeral hosted runners (see platform-poc.yml, which is
// manual or trusted-branch only).
//
// Three separate outcomes, each reported on its own line:
//   STANDARD_USER_RESULT  obtained | not_obtained | refused    the child really ran as the intended standard user
//   POC_EVIDENCE          established | incomplete | not_run   the expected PoC items are `established` with the expected data
//   CLEANUP               confirmed | unconfirmed | not_needed  account, scheduled task, profile and stage are gone
// RUN_VERDICT=pass only when all three are good; unconfirmed cleanup makes the run `invalid`.
// Exit codes: 0 pass, 1 fail, 2 refused, 3 invalid (cleanup unconfirmed).
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../is-main.ts';
import { renderMarkdown, type Report } from './poc.ts';
import { isUsableReport } from './nonelevated.ts';
import { encodeScript, icacls, powershellExe, runTool, tokenFacts, currentUser, type ToolResult } from './tools.ts';

export const ACCOUNT = 'synthetic-ekg-std';
export const TASK_NAME = 'synthetic-ekg-std-task';
export const REQUIRED_ITEMS = [
 '1_current_user_sid', '2_descriptor_reads', '3_creation_in_private_parent', '4_protect_step',
 '5_safe_path_rules', '6_links_and_identity', '7_launch_cost', '8_failure_modes',
] as const;

/** Accidental-use guard only (see header): the variables can be set by anyone. */
export function looksLikeHostedWindowsRunner(env: NodeJS.ProcessEnv, platform: string = process.platform): boolean {
 return platform === 'win32' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted';
}

// --- PowerShell scripts (static text; parameters travel through environment variables) -------------

/** Present/absent state of the three things this script may create. Used before creation and to confirm cleanup. */
export const STATE_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 'try {',
 "  $u = @(Get-LocalUser | Where-Object { $_.Name -eq $env:EKG_USER }).Count",
 "  Write-Output ('U|' + $(if ($u -gt 0) { 'present' } else { 'absent' }))",
 "  $t = @(Get-ScheduledTask | Where-Object { $_.TaskName -eq 'synthetic-ekg-std-task' }).Count",
 "  Write-Output ('T|' + $(if ($t -gt 0) { 'present' } else { 'absent' }))",
 "  $p = @(Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like ('*\\' + $env:EKG_USER + '*') }).Count",
 "  $d = Test-Path -LiteralPath (Join-Path $env:SystemDrive ('Users\\' + $env:EKG_USER))",
 "  Write-Output ('P|' + $(if ($p -gt 0 -or $d) { 'present' } else { 'absent' }))",
 "} catch { Write-Output 'Q|error' }",
 'exit 0',
].join('\n');

/** The account SID is printed back to this process only (never logged) so the child's token can be compared with it. */
export const CREATE_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 'try {',
 '  $pw = ConvertTo-SecureString $env:EKG_PW -AsPlainText -Force',
 '  $u = New-LocalUser -Name $env:EKG_USER -Password $pw -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword',
 "  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $env:EKG_USER",
 "  Write-Output ('C|' + $u.SID.Value)",
 "} catch { Write-Output ('E|' + $_.Exception.GetType().Name) }",
 'exit 0',
].join('\n');

// Only the exception type, the error id and the numeric HRESULT are printed: all fixed tokens, never the message.
export const LAUNCH_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 'try {',
 '  $pw = ConvertTo-SecureString $env:EKG_PW -AsPlainText -Force',
 "  $cred = New-Object System.Management.Automation.PSCredential('.\\' + $env:EKG_USER, $pw)",
 '  $p = Start-Process -FilePath $env:EKG_NODE -ArgumentList $env:EKG_ARGS -Credential $cred -LoadUserProfile -WindowStyle Hidden -WorkingDirectory $env:EKG_STAGE -PassThru -Wait',
 "  Write-Output ('X|' + $p.ExitCode)",
 "} catch { Write-Output ('E|' + $_.Exception.GetType().Name + '|' + $_.FullyQualifiedErrorId + '|' + $_.Exception.HResult) }",
 'exit 0',
].join('\n');

// Fallback: a scheduled task registered for the account (limited run level), polled through the output file.
export const TASK_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 'try {',
 '  $a = New-ScheduledTaskAction -Execute $env:EKG_NODE -Argument $env:EKG_ARGS -WorkingDirectory $env:EKG_STAGE',
 "  $pr = New-ScheduledTaskPrincipal -UserId ('.\\' + $env:EKG_USER) -LogonType Password -RunLevel Limited",
 '  $t = New-ScheduledTask -Action $a -Principal $pr',
 "  Register-ScheduledTask -TaskName 'synthetic-ekg-std-task' -InputObject $t -User ('.\\' + $env:EKG_USER) -Password $env:EKG_PW | Out-Null",
 "  Start-ScheduledTask -TaskName 'synthetic-ekg-std-task'",
 '  $end = (Get-Date).AddSeconds(150)',
 "  while ((Get-Date) -lt $end -and (Get-ScheduledTask -TaskName 'synthetic-ekg-std-task').State -ne 'Ready') { Start-Sleep -Seconds 2 }",
 "  Write-Output ('X|' + (Get-ScheduledTaskInfo -TaskName 'synthetic-ekg-std-task').LastTaskResult)",
 "} catch { Write-Output ('E|' + $_.Exception.GetType().Name + '|' + $_.FullyQualifiedErrorId + '|' + $_.Exception.HResult) } finally {",
 "  Unregister-ScheduledTask -TaskName 'synthetic-ekg-std-task' -Confirm:$false -ErrorAction SilentlyContinue",
 '}',
 'exit 0',
].join('\n');

// First choice: the managed API directly (no console host quirks of Start-Process -Credential).
export const PSI_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 'try {',
 '  $pw = ConvertTo-SecureString $env:EKG_PW -AsPlainText -Force',
 '  $psi = New-Object System.Diagnostics.ProcessStartInfo',
 '  $psi.FileName = $env:EKG_NODE; $psi.Arguments = $env:EKG_ARGS; $psi.WorkingDirectory = $env:EKG_STAGE',
 '  $psi.UserName = $env:EKG_USER; $psi.Domain = $env:COMPUTERNAME; $psi.Password = $pw',
 '  $psi.LoadUserProfile = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true',
 '  $p = [System.Diagnostics.Process]::Start($psi)',
 '  if (-not $p.WaitForExit(240000)) { $p.Kill(); Write-Output "X|timeout" } else { Write-Output ("X|" + $p.ExitCode) }',
 "} catch { Write-Output ('E|' + $_.Exception.GetType().Name + '|' + $_.FullyQualifiedErrorId + '|' + $_.Exception.HResult) }",
 'exit 0',
].join('\n');

/** Best-effort removal; success is NEVER assumed from this script, STATE_SCRIPT confirms it. */
export const REMOVE_SCRIPT = [
 "$ErrorActionPreference = 'SilentlyContinue'",
 "Unregister-ScheduledTask -TaskName 'synthetic-ekg-std-task' -Confirm:$false",
 "Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like ('*\\' + $env:EKG_USER + '*') } | Remove-CimInstance",
 'Remove-LocalUser -Name $env:EKG_USER',
 "Get-ChildItem -LiteralPath (Join-Path $env:SystemDrive 'Users') -Directory -Force | Where-Object { $_.Name -like ($env:EKG_USER + '*') } | Remove-Item -Recurse -Force",
 "Write-Output 'D|done'",
 'exit 0',
].join('\n');

// --- pure helpers ---------------------------------------------------------------------------------

/** Plain printable ASCII paths without quotes: they are placed inside one quoted argument string. */
export const argSafe = (value: string) => /^[A-Za-z]:\\[\x20-\x7e]+$/.test(value) && !/["%&|<>^!`$]/.test(value) && value.length < 260;

export function childArguments(probe: string, out: string, sidOut: string, extra: string[]): string {
 for (const p of [probe, out, sidOut]) if (!argSafe(p)) throw new Error('PATH_UNSUPPORTED');
 for (const a of extra) if (!/^--[a-z-]+$/.test(a)) throw new Error('ARGUMENT_UNSUPPORTED');
 return ['--disable-warning=ExperimentalWarning', `"${probe}"`, '--out', `"${out}"`, '--sid-out', `"${sidOut}"`, ...extra].join(' ');
}

export function generatePassword(): string {
 return `Ekg-${randomBytes(18).toString('base64url')}-9a!`;
}

/** The launcher's fixed-token outcome line: `X|<exit>` or `E|<type>|<error id>|<hresult>`. */
export function parseLaunch(stdout: string): string {
 const line = stdout.split(/\r?\n/).find(l => /^[XE]\|/.test(l)) ?? '';
 const x = /^X\|(-?\d{1,10}|timeout)$/.exec(line.trim());
 if (x) return `exit_${x[1]}`;
 const e = /^E\|([A-Za-z0-9_.]{1,60})\|([A-Za-z0-9_.,]{1,160})\|(-?\d{1,11})$/.exec(line.trim());
 return e ? `error_${e[1]}_${e[2]}_${e[3]}` : 'no_outcome_line';
}

export type Presence = 'absent' | 'present' | 'unknown';
export interface State { user: Presence; task: Presence; profile: Presence }

export function parseState(stdout: string): State {
 const get = (tag: string): Presence => {
  const v = stdout.split(/\r?\n/).find(l => l.startsWith(tag + '|'))?.slice(2).trim();
  return v === 'absent' || v === 'present' ? v : 'unknown';
 };
 return { user: get('U'), task: get('T'), profile: get('P') };
}
export const allAbsent = (s: State) => s.user === 'absent' && s.task === 'absent' && s.profile === 'absent';

/** `C|<sid>` printed only after the account exists AND is in Users; anything else is a failed or partial creation. */
export function parseCreate(stdout: string): string | undefined {
 return /^C\|(S-1-5-21-[\d-]+)\s*$/m.exec(stdout)?.[1];
}

interface ChildReport { verdict?: unknown; token?: { integrity?: unknown }; poc?: unknown; error?: unknown }

/**
 * Execution verdict. It needs the child's own measurement AND a verified identity: the SID the child
 * read from its own token must equal the SID of the account that was created, and must differ from the
 * launcher's. SIDs are compared here and never leave this function.
 */
export function classifyRun(child: unknown, launcherSid: string | undefined, intendedSid: string | undefined, childSid: string | undefined): { verdict: 'obtained' | 'not_obtained'; reason: string } {
 const c = child as ChildReport | undefined;
 if (!c || typeof c !== 'object') return { verdict: 'not_obtained', reason: 'NO_CHILD_REPORT' };
 if (c.error !== undefined) return { verdict: 'not_obtained', reason: 'CHILD_ERROR' };
 if (!launcherSid || !intendedSid || !childSid) return { verdict: 'not_obtained', reason: 'IDENTITY_UNKNOWN' };
 if (childSid === launcherSid) return { verdict: 'not_obtained', reason: 'SAME_ACCOUNT' };
 if (childSid !== intendedSid) return { verdict: 'not_obtained', reason: 'IDENTITY_MISMATCH' };
 if (c.verdict !== 'standard_user' || c.token?.integrity !== 'medium') return { verdict: 'not_obtained', reason: 'TOKEN_NOT_STANDARD' };
 return { verdict: 'obtained', reason: 'MEASURED' };
}

const token = (v: unknown) => (typeof v === 'string' && /^[a-z_]{1,24}$/.test(v) ? v : 'invalid');

/** Fixed-token problems with the embedded ACL PoC report; empty means every expected item is established with the expected data. */
export function pocProblems(poc: unknown): string[] {
 if (!isUsableReport(poc)) return ['POC_UNUSABLE'];
 const problems: string[] = [];
 if (poc.environment.integrity_level !== 'medium') problems.push('POC_NOT_MEDIUM');
 const rejected = (poc as unknown as { rejected_values?: unknown }).rejected_values;
 if (Array.isArray(rejected) && rejected.length > 0) problems.push('POC_REJECTED_VALUES');
 for (const name of REQUIRED_ITEMS) {
  const item = (poc.items as Record<string, { status?: unknown; data?: Record<string, unknown> } | undefined>)[name];
  if (!item || typeof item !== 'object') { problems.push(`MISSING_${name}`); continue; }
  if (item.status !== 'established') problems.push(`NOT_ESTABLISHED_${name}_${token(item.status)}`);
 }
 const data = (name: string) => ((poc.items as Record<string, { data?: Record<string, unknown> } | undefined>)[name]?.data ?? {});
 if (data('1_current_user_sid').integrity_level !== 'medium' || data('1_current_user_sid').administrators_group_listed !== false) problems.push('ITEM1_TOKEN_DATA');
 if (data('2_descriptor_reads').elevated !== false) problems.push('ITEM2_ELEVATED');
 return problems;
}

// --- orchestration (host injected so failure paths can be tested) ------------------------------------

export interface Host {
 platform: string;
 env: NodeJS.ProcessEnv;
 node: string;
 probe: string;
 repoRoot: string;
 launcher(): Promise<{ sid?: string; integrity?: string }>;
 ps(script: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ToolResult>;
 grant(path: string, rights: string): Promise<boolean>;
 makeStage(): string;
 readStage(stage: string, name: string): string | undefined;
 /** Removes the stage directory and returns true only when it is confirmed gone. */
 removeStage(stage: string): boolean;
 sleep(ms: number): Promise<void>;
}

export interface Outcome {
 execution: 'obtained' | 'not_obtained' | 'refused';
 reason: string;
 poc: 'established' | 'incomplete' | 'not_run';
 pocProblems: string[];
 cleanup: 'confirmed' | 'unconfirmed' | 'not_needed';
 stage: string;
 method: string;
 note: string;
 report?: unknown;
}

export const runVerdict = (o: Outcome): 'pass' | 'fail' | 'invalid' =>
 o.cleanup === 'unconfirmed' ? 'invalid' : o.execution === 'obtained' && o.poc === 'established' ? 'pass' : 'fail';
export const exitCodeOf = (o: Outcome): number => (o.execution === 'refused' ? 2 : { pass: 0, fail: 1, invalid: 3 }[runVerdict(o)]);

export async function runStandardUser(host: Host, opts: { extra?: string[]; retryDelayMs?: number } = {}): Promise<Outcome> {
 const o: Outcome = { execution: 'not_obtained', reason: 'START', poc: 'not_run', pocProblems: [], cleanup: 'not_needed', stage: 'START', method: 'none', note: 'none' };
 if (!looksLikeHostedWindowsRunner(host.env, host.platform)) { o.execution = 'refused'; o.reason = 'NOT_HOSTED_WINDOWS'; return o; }

 const launcher = await host.launcher();
 if (launcher.integrity !== 'high' && launcher.integrity !== 'system') { o.reason = 'LAUNCHER_NOT_ELEVATED'; return o; }
 const env = { ...host.env, EKG_USER: ACCOUNT, EKG_PW: generatePassword() };

 // Never touch an account, task or profile that this run did not create.
 const pre = await host.ps(STATE_SCRIPT, env, 60_000);
 if (pre.code !== 'OK' || !allAbsent(parseState(pre.stdout))) { o.reason = 'PRECHECK_NOT_CLEAN'; return o; }

 let stage: string | undefined;
 let attempted = false;
 let intendedSid: string | undefined;
 let childSid: string | undefined;
 try {
  stage = host.makeStage();
  attempted = true; // from here on, cleanup is owed even if creation fails half way
  const created = await host.ps(CREATE_SCRIPT, env, 60_000);
  intendedSid = created.code === 'OK' ? parseCreate(created.stdout) : undefined;
  if (!intendedSid) { o.reason = 'ACCOUNT_CREATE_FAILED'; o.stage = 'ACCOUNT_CREATE_FAILED'; return finish(); }
  // The new account needs to read the repository (nothing is written there) and to write its own output.
  const grants = [await host.grant(host.repoRoot, `${ACCOUNT}:(OI)(CI)RX`), await host.grant(stage, `${ACCOUNT}:(OI)(CI)M`)];
  const out = join(stage, 'probe.json');
  const launchEnv = { ...env, EKG_NODE: host.node, EKG_ARGS: childArguments(host.probe, out, join(stage, 'sid.txt'), opts.extra ?? []), EKG_STAGE: stage };
  const readOut = (): unknown => { try { return JSON.parse((host.readStage(stage!, 'probe.json') ?? '').replace(/^﻿/, '')); } catch { return undefined; } };
  o.note = grants.every(Boolean) ? '' : 'GRANT_FAILED ';
  let report: unknown;
  for (const [name, script, timeout] of [['process_start_info', PSI_SCRIPT, 300_000], ['start_process', LAUNCH_SCRIPT, 300_000], ['scheduled_task', TASK_SCRIPT, 240_000]] as const) {
   o.method = name;
   const r = await host.ps(script, launchEnv, timeout);
   o.note += `${name}:${r.code}:${r.code === 'OK' ? parseLaunch(r.stdout) : 'none'} `;
   report = readOut();
   if (report !== undefined) break;
  }
  o.note = o.note.trim();
  o.stage = report === undefined ? 'LAUNCH_NO_REPORT' : 'LAUNCHED';
  childSid = host.readStage(stage, 'sid.txt')?.trim();
  const c = classifyRun(report, launcher.sid, intendedSid, childSid);
  o.execution = c.verdict;
  o.reason = c.reason;
  o.report = report;
  if (c.verdict === 'obtained') {
   o.pocProblems = pocProblems((report as ChildReport).poc);
   o.poc = o.pocProblems.length === 0 ? 'established' : 'incomplete';
  }
 } catch {
  if (o.reason === 'START') o.reason = 'UNEXPECTED_ERROR';
 }
 return finish();

 async function finish(): Promise<Outcome> {
  if (!attempted) return o;
  // Removal is best effort; only the independent state query decides. Retries cover a profile still locked by a just-exited process.
  let confirmed = false;
  for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
   await host.ps(REMOVE_SCRIPT, env, 90_000).catch(() => undefined);
   const s = await host.ps(STATE_SCRIPT, env, 60_000).catch(() => undefined);
   const gone = s?.code === 'OK' && allAbsent(parseState(s.stdout));
   const stageGone = stage ? host.removeStage(stage) : true;
   confirmed = gone && stageGone;
   if (!confirmed) await host.sleep(opts.retryDelayMs ?? 5000);
  }
  o.cleanup = confirmed ? 'confirmed' : 'unconfirmed';
  return o;
 }
}

export function summaryLines(o: Outcome): string[] {
 return [
  `STANDARD_USER_RESULT=${o.execution}`,
  `STANDARD_USER_REASON=${o.reason}`,
  `STANDARD_USER_STAGE=${o.stage}`,
  `STANDARD_USER_LAUNCH_METHOD=${o.method}`,
  `STANDARD_USER_LAUNCH_NOTE=${o.note.replace(/[^A-Za-z0-9_.,: -]/g, '?')}`,
  `POC_EVIDENCE=${o.poc}`,
  `POC_EVIDENCE_PROBLEMS=${o.pocProblems.length ? o.pocProblems.join(',') : 'none'}`,
  `CLEANUP=${o.cleanup}`,
  `RUN_VERDICT=${runVerdict(o)}`,
  'EVIDENCE_SCOPE=github_hosted_runner_temporary_local_standard_account',
 ];
}

// --- real host and CLI -------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));

function realHost(): Host {
 return {
  platform: process.platform,
  env: process.env,
  node: process.execPath,
  probe: join(here, 'privilege-probe.ts'),
  repoRoot: realpathSync.native(join(here, '..', '..', '..')),
  launcher: async () => ({
   sid: (await currentUser().catch(() => undefined))?.sid,
   integrity: (await tokenFacts().catch(() => undefined))?.integrity,
  }),
  ps: (script, env, timeoutMs) => runTool(powershellExe(env), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeScript(script)], { timeoutMs, env }),
  grant: (path, rights) => icacls([path, '/grant', rights]).then(() => true, () => false),
  makeStage: () => realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-ekg-std-'))),
  readStage: (stage, name) => { try { return readFileSync(join(stage, name), 'utf8'); } catch { return undefined; } },
  removeStage: stage => {
   try { rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* checked below */ }
   return !existsSync(stage);
  },
  sleep: ms => new Promise<void>(r => setTimeout(r, ms)),
 };
}

async function main(): Promise<number> {
 const argv = process.argv.slice(2);
 if (!argv.includes('--i-understand-this-creates-a-local-account')) { console.log('STANDARD_USER_RESULT=refused'); return 2; }
 const mdIndex = argv.indexOf('--markdown-file');
 const markdownFile = mdIndex >= 0 ? argv[mdIndex + 1] : undefined;
 const host = realHost();
 const o = await runStandardUser(host, { extra: argv.includes('--skip-profile') ? ['--skip-profile'] : [] });

 const r = o.report as { token?: unknown; probes?: unknown; environment?: unknown; poc?: unknown } | undefined;
 for (const line of summaryLines(o)) console.log(line);
 const probe = r ? JSON.stringify({ environment: r.environment, token: r.token, probes: r.probes }, null, 1) : undefined;
 if (probe) console.log(probe);
 // The PoC's own report is already restricted to fixed tokens, counts and booleans (see poc.ts); print its items for the job log.
 if (isUsableReport(r?.poc)) {
  console.log(`POC_ENVIRONMENT=${JSON.stringify(r.poc.environment)}`);
  for (const [name, item] of Object.entries(r.poc.items)) console.log(`POC_ITEM ${name} ${item.status} ${item.code} ${JSON.stringify(item.data)}`);
 }
 if (markdownFile) {
  const env2 = (r?.environment ?? {}) as Record<string, unknown>;
  const head = `### Temporary standard user: RUN_VERDICT=${runVerdict(o)} (execution ${o.execution}/${o.reason}; PoC evidence ${o.poc}; cleanup ${o.cleanup}; method ${o.method}). arch=${String(env2.arch ?? 'unknown')}, product=${String(env2.product ?? 'unknown')}.\n\n` +
   (runVerdict(o) === 'invalid' ? '**INVALID RUN: cleanup of the temporary account could not be confirmed. Treat no result below as evidence.**\n\n' : '');
  const poc = r?.poc;
  appendFileSync(markdownFile, head + (probe ? '```json\n' + probe + '\n```\n\n' : '') + (isUsableReport(poc) ? renderMarkdown(poc as Report) : 'No usable PoC report was produced.\n'));
 }
 return exitCodeOf(o);
}
if (isMain(import.meta.url)) process.exitCode = await main();
