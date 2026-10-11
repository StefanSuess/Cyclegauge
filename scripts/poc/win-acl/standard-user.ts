// Platform-verification feasibility PoC: run the Windows ACL proof-of-concept under a genuinely
// separate, temporary local STANDARD user on a GitHub-hosted Windows runner.
//
//   node scripts/poc/win-acl/standard-user.ts --i-understand-this-creates-a-local-account [--skip-profile] [--markdown-file <path>]
//
// Unlike nonelevated.ts (which only strips rights from a copy of the administrator's own token), this
// creates a new local account that is a member of Users only, starts privilege-probe.ts as that account
// and decides from what the CHILD measured about itself. It refuses to run anywhere but a GitHub-hosted
// runner, so it can never create an account on a developer machine. The account and its profile are
// removed afterwards. Nothing real is read; all data is synthetic and the report holds fixed tokens only.
//
//   STANDARD_USER_RESULT=obtained      separate account, medium integrity, no powerful privilege, writes denied
//   STANDARD_USER_RESULT=not_obtained  anything else (the report is NOT standard-user evidence)
//   STANDARD_USER_RESULT=refused       not a GitHub-hosted Windows runner
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../is-main.ts';
import { renderMarkdown, type Report } from './poc.ts';
import { isUsableReport } from './nonelevated.ts';
import { encodeScript, icacls, powershellExe, runTool, tokenFacts, currentUser } from './tools.ts';

export const ACCOUNT = 'synthetic-ekg-std';

/** Only a GitHub-hosted Windows runner may create an account. */
export function hostedWindowsRunner(env: NodeJS.ProcessEnv, platform: string = process.platform): boolean {
 return platform === 'win32' && env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted';
}

export const CREATE_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 '$pw = ConvertTo-SecureString $env:EKG_PW -AsPlainText -Force',
 'New-LocalUser -Name $env:EKG_USER -Password $pw -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword | Out-Null',
 "Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $env:EKG_USER",
 "Write-Output 'C|ok'",
].join('\n');

export const LAUNCH_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 '$pw = ConvertTo-SecureString $env:EKG_PW -AsPlainText -Force',
 "$cred = New-Object System.Management.Automation.PSCredential('.\\' + $env:EKG_USER, $pw)",
 '$p = Start-Process -FilePath $env:EKG_NODE -ArgumentList $env:EKG_ARGS -Credential $cred -LoadUserProfile -WindowStyle Hidden -WorkingDirectory $env:EKG_STAGE -PassThru -Wait',
 "Write-Output ('X|' + $p.ExitCode)",
].join('\n');

export const REMOVE_SCRIPT = [
 "$ErrorActionPreference = 'SilentlyContinue'",
 'Remove-LocalUser -Name $env:EKG_USER',
 "Get-CimInstance Win32_UserProfile | Where-Object { $_.LocalPath -like ('*\\' + $env:EKG_USER) } | Remove-CimInstance",
 'Write-Output "D|done"',
].join('\n');

/** Plain printable ASCII paths without quotes: they are placed inside one quoted argument string. */
export const argSafe = (value: string) => /^[A-Za-z]:\\[\x20-\x7e]+$/.test(value) && !/["%&|<>^!`$]/.test(value) && value.length < 260;

export function childArguments(probe: string, out: string, extra: string[]): string {
 for (const p of [probe, out]) if (!argSafe(p)) throw new Error('PATH_UNSUPPORTED');
 for (const a of extra) if (!/^--[a-z-]+$/.test(a)) throw new Error('ARGUMENT_UNSUPPORTED');
 return ['--disable-warning=ExperimentalWarning', `"${probe}"`, '--out', `"${out}"`, ...extra].join(' ');
}

export function generatePassword(): string {
 return `Ekg-${randomBytes(18).toString('base64url')}-9a!`;
}

interface ChildReport { verdict?: unknown; token?: { integrity?: unknown }; poc?: unknown; error?: unknown }

/** The verdict needs the child's own measurement AND a different account than the launcher. */
export function classifyRun(child: unknown, launcherSid: string | undefined, childSid: string | undefined): { verdict: 'obtained' | 'not_obtained'; reason: string } {
 const c = child as ChildReport | undefined;
 if (!c || typeof c !== 'object') return { verdict: 'not_obtained', reason: 'NO_CHILD_REPORT' };
 if (c.error !== undefined) return { verdict: 'not_obtained', reason: 'CHILD_ERROR' };
 if (!launcherSid || !childSid) return { verdict: 'not_obtained', reason: 'IDENTITY_UNKNOWN' };
 if (launcherSid === childSid) return { verdict: 'not_obtained', reason: 'SAME_ACCOUNT' };
 if (c.verdict !== 'standard_user' || c.token?.integrity !== 'medium') return { verdict: 'not_obtained', reason: 'TOKEN_NOT_STANDARD' };
 const poc = c.poc as Partial<Report> | undefined;
 if (!isUsableReport(poc) || poc.environment.integrity_level !== 'medium') return { verdict: 'not_obtained', reason: 'POC_REPORT_UNUSABLE' };
 return { verdict: 'obtained', reason: 'MEASURED' };
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = realpathSync.native(join(here, '..', '..', '..'));

async function ps(script: string, env: NodeJS.ProcessEnv, timeoutMs: number) {
 return runTool(powershellExe(env), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeScript(script)], { timeoutMs, env });
}

async function main(): Promise<number> {
 const argv = process.argv.slice(2);
 if (!argv.includes('--i-understand-this-creates-a-local-account')) { console.log('STANDARD_USER_RESULT=refused'); return 2; }
 if (!hostedWindowsRunner(process.env)) { console.log('STANDARD_USER_RESULT=refused'); return 2; }
 const mdIndex = argv.indexOf('--markdown-file');
 const markdownFile = mdIndex >= 0 ? argv[mdIndex + 1] : undefined;
 const extra = argv.includes('--skip-profile') ? ['--skip-profile'] : [];

 const launcher = await tokenFacts().catch(() => undefined);
 const launcherSid = (await currentUser().catch(() => undefined))?.sid;
 const password = generatePassword();
 const env = { ...process.env, EKG_USER: ACCOUNT, EKG_PW: password };
 let stage: string | undefined;
 let created = false;
 let report: unknown;
 let childSid: string | undefined;
 let stageCode = 'START';
 try {
  if (launcher?.integrity !== 'high' && launcher?.integrity !== 'system') { stageCode = 'LAUNCHER_NOT_ELEVATED'; throw new Error(stageCode); }
  stage = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-ekg-std-')));
  const c = await ps(CREATE_SCRIPT, env, 60_000);
  if (c.code !== 'OK') { stageCode = 'ACCOUNT_CREATE_FAILED'; throw new Error(stageCode); }
  created = true;
  // The new account needs to read the repository (scripts only run, nothing is written there) and to write its own output.
  await icacls([repoRoot, '/grant', `${ACCOUNT}:(OI)(CI)RX`]).catch(() => { stageCode = 'REPO_GRANT_FAILED'; });
  await icacls([stage, '/grant', `${ACCOUNT}:(OI)(CI)M`]).catch(() => { stageCode = 'STAGE_GRANT_FAILED'; });
  const out = join(stage, 'probe.json');
  const probe = join(here, 'privilege-probe.ts');
  const launchEnv = { ...env, EKG_NODE: process.execPath, EKG_ARGS: childArguments(probe, out, extra), EKG_STAGE: stage };
  const l = await ps(LAUNCH_SCRIPT, launchEnv, 300_000);
  stageCode = l.code === 'OK' ? 'LAUNCHED' : `LAUNCH_${l.code}`;
  try { report = JSON.parse(readFileSync(out, 'utf8').replace(/^﻿/, '')); } catch { report = undefined; }
  // The child's identity is compared privately here and never printed: the probe records no SID.
  const who = await ps(
   "$ErrorActionPreference='Stop'; $n = New-Object System.Security.Principal.NTAccount($env:EKG_USER); Write-Output ('S|' + $n.Translate([System.Security.Principal.SecurityIdentifier]).Value)",
   env, 30_000);
  childSid = who.code === 'OK' ? /S\|(S-1-[\d-]+)/.exec(who.stdout)?.[1] : undefined;
 } catch {
  // stageCode already names the step; nothing else is recorded.
 } finally {
  if (created) await ps(REMOVE_SCRIPT, env, 60_000).catch(() => undefined);
  if (stage) { try { rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ } }
 }

 const c = classifyRun(report, launcherSid, childSid);
 const r = report as { token?: unknown; probes?: unknown; environment?: unknown; poc?: unknown } | undefined;
 console.log(`STANDARD_USER_RESULT=${c.verdict}`);
 console.log(`STANDARD_USER_REASON=${c.reason}`);
 console.log(`STANDARD_USER_STAGE=${stageCode}`);
 console.log('EVIDENCE_SCOPE=github_hosted_runner_temporary_local_standard_account');
 if (r) console.log(JSON.stringify({ environment: r.environment, token: r.token, probes: r.probes }, null, 1));
 if (markdownFile) {
  const env2 = (r?.environment ?? {}) as Record<string, unknown>;
  const head = `### Temporary standard user: ${c.verdict} (${c.reason}). arch=${String(env2.arch ?? 'unknown')}, product=${String(env2.product ?? 'unknown')}.\n\n`;
  const detail = r ? '```json\n' + JSON.stringify({ environment: r.environment, token: r.token, probes: r.probes }, null, 1) + '\n```\n\n' : '';
  const poc = r?.poc;
  appendFileSync(markdownFile, head + detail + (isUsableReport(poc) ? renderMarkdown(poc) : 'No usable PoC report was produced.\n'));
 }
 return 0;
}
if (isMain(import.meta.url)) process.exitCode = await main();
