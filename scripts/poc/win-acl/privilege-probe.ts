// Platform-verification feasibility PoC: measure what the CURRENT token can actually do, then run the
// Windows ACL proof-of-concept in the same process context and embed its report.
//
//   node scripts/poc/win-acl/privilege-probe.ts --out <file> --sid-out <file> [--skip-profile]
//
// It is started by standard-user.ts under a freshly created local standard account, but it only
// measures and never assumes: the integrity level, the Administrators group state, the privileges the
// token holds and three denied-write probes all come from the running process. Output is fixed tokens,
// booleans and counts; no SID, user name or path is ever written.
import { spawnSync } from 'node:child_process';
import { arch, release } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { isMain } from '../../is-main.ts';
import { ToolError, currentUser, encodeScript, parseWhoamiGroups, powershellExe, runTool, systemExe } from './tools.ts';

/** Privileges a default standard-user token carries. Anything else is reported, not silently accepted. */
export const STANDARD_PRIVILEGES = [
 'SeChangeNotifyPrivilege', 'SeIncreaseWorkingSetPrivilege', 'SeShutdownPrivilege', 'SeTimeZonePrivilege', 'SeUndockPrivilege',
] as const;

/** Privileges whose presence means the token is not a plain standard user, whatever its integrity level. */
export const POWERFUL_PRIVILEGES = [
 'SeDebugPrivilege', 'SeTakeOwnershipPrivilege', 'SeBackupPrivilege', 'SeRestorePrivilege', 'SeLoadDriverPrivilege', 'SeTcbPrivilege',
 'SeImpersonatePrivilege', 'SeAssignPrimaryTokenPrivilege', 'SeSecurityPrivilege', 'SeSystemEnvironmentPrivilege', 'SeManageVolumePrivilege',
 'SeCreateSymbolicLinkPrivilege', 'SeCreateTokenPrivilege', 'SeSystemtimePrivilege', 'SeRemoteShutdownPrivilege', 'SeCreateGlobalPrivilege',
] as const;

export type AdminGroup = 'absent' | 'deny_only' | 'enabled' | 'unknown';
export type Denied = 'denied' | 'allowed' | 'error';

/** `whoami /priv /fo csv /nh`: only the first column (the invariant constant name) is read. */
export function parsePrivileges(stdout: string): string[] {
 const names = [...stdout.matchAll(/^"(Se[A-Za-z]{3,60}Privilege)"/gm)].map(m => m[1]);
 if (names.length === 0) throw new ToolError('ACL_UNPARSEABLE');
 return [...new Set(names)].sort();
}

export function classifyPrivileges(names: string[]) {
 const powerful = names.filter(n => (POWERFUL_PRIVILEGES as readonly string[]).includes(n));
 const unlisted = names.filter(n => !(STANDARD_PRIVILEGES as readonly string[]).includes(n) && !powerful.includes(n));
 return { count: names.length, powerful, unlisted };
}

export function adminGroupState(listed: boolean, isInRole: boolean | undefined): AdminGroup {
 if (!listed) return 'absent';
 if (isInRole === undefined) return 'unknown';
 return isInRole ? 'enabled' : 'deny_only';
}

export interface Measured {
 integrity: string;
 adminGroup: AdminGroup;
 privileges: ReturnType<typeof classifyPrivileges>;
 probes: { system32_write: Denied; program_files_write: Denied; net_session: 'denied' | 'allowed' | 'unavailable' };
}

/** A standard user needs every signal: medium integrity, no enabled Administrators group, no powerful privilege and denied writes. */
export function verdictOf(m: Measured): 'standard_user' | 'not_standard' {
 const ok = m.integrity === 'medium'
  && (m.adminGroup === 'absent' || m.adminGroup === 'deny_only')
  && m.privileges.powerful.length === 0
  && m.probes.system32_write === 'denied'
  && m.probes.program_files_write === 'denied'
  && m.probes.net_session === 'denied';
 return ok ? 'standard_user' : 'not_standard';
}

const ROLE_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 '$p = New-Object System.Security.Principal.WindowsPrincipal([System.Security.Principal.WindowsIdentity]::GetCurrent())',
 "$sid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')",
 "Write-Output ('R|' + $p.IsInRole($sid))",
 "$r = $env:SystemRoot; $pf = $env:ProgramFiles",
 "foreach ($t in @(@('S', $r + '\\System32'), @('F', $pf))) {",
 "  $f = Join-Path $t[1] 'synthetic-ekg-probe.tmp'",
 '  try {',
 "    [System.IO.File]::WriteAllText($f, 'x'); Remove-Item -LiteralPath $f -Force",
 "    Write-Output ($t[0] + '|allowed')",
 '  } catch [System.UnauthorizedAccessException] {',
 "    Write-Output ($t[0] + '|denied')",
 "  } catch { Write-Output ($t[0] + '|error') }",
 '}',
].join('\n');

export function parseRoleOutput(stdout: string): { isInRole?: boolean; system32: Denied; programFiles: Denied } {
 const get = (tag: string) => stdout.split(/\r?\n/).find(l => l.startsWith(tag + '|'))?.slice(tag.length + 1).trim();
 const denied = (v: string | undefined): Denied => (v === 'denied' || v === 'allowed' ? v : 'error');
 const r = get('R');
 return { isInRole: r === 'True' ? true : r === 'False' ? false : undefined, system32: denied(get('S')), programFiles: denied(get('F')) };
}

export async function measure(): Promise<Measured> {
 const env = process.env;
 const groups = await runTool(systemExe('whoami.exe', env), ['/groups', '/fo', 'csv', '/nh'], { timeoutMs: 15000, env });
 const priv = await runTool(systemExe('whoami.exe', env), ['/priv', '/fo', 'csv', '/nh'], { timeoutMs: 15000, env });
 if (groups.code !== 'OK' || priv.code !== 'OK') throw new ToolError('TOOL_FAILED');
 const g = parseWhoamiGroups(groups.stdout);
 const role = await runTool(powershellExe(env), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeScript(ROLE_SCRIPT)], { timeoutMs: 30000, env });
 const parsed = role.code === 'OK' ? parseRoleOutput(role.stdout) : { isInRole: undefined, system32: 'error' as Denied, programFiles: 'error' as Denied };
 // `net session` needs administrator rights; any failure is recorded as unavailable, never as proof of either.
 const net = await runTool(systemExe('net.exe', env), ['session'], { timeoutMs: 15000, env });
 return {
  integrity: g.integrity,
  adminGroup: adminGroupState(g.administratorsListed, parsed.isInRole),
  privileges: classifyPrivileges(parsePrivileges(priv.stdout)),
  probes: { system32_write: parsed.system32, program_files_write: parsed.programFiles, net_session: net.code === 'OK' ? 'allowed' : net.code === 'TOOL_FAILED' ? 'denied' : 'unavailable' },
 };
}

/** Product type (client vs server) is the locale-independent way to tell Windows 11 from Windows Server. */
async function productType(): Promise<string> {
 const script = "$ErrorActionPreference='Stop'; Write-Output ('T|' + (Get-CimInstance Win32_OperatingSystem).ProductType + '|' + (Get-CimInstance Win32_OperatingSystem).BuildNumber)";
 const r = await runTool(powershellExe(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeScript(script)], { timeoutMs: 30000 });
 const m = r.code === 'OK' ? /T\|(\d)\|(\d{4,6})/.exec(r.stdout) : null;
 if (!m) return 'unknown';
 return `${m[1] === '1' ? 'client' : m[1] === '3' || m[1] === '2' ? 'server' : 'unknown'}_build${m[2]}`;
}

async function main(): Promise<number> {
 const argv = process.argv.slice(2);
 const outIndex = argv.indexOf('--out');
 const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
 const sidIndex = argv.indexOf('--sid-out');
 const sidOut = sidIndex >= 0 ? argv[sidIndex + 1] : undefined;
 if (process.platform !== 'win32' || !out || !win32.isAbsolute(out) || !sidOut || !win32.isAbsolute(sidOut)) { console.log('PROBE_RESULT=not_applicable'); return 2; }
 try {
  const m = await measure();
  // The identity of THIS process, read from its own token; the launcher compares it with the account it created.
  writeFileSync(sidOut, (await currentUser()).sid);
  const here = dirname(fileURLToPath(import.meta.url));
  const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, 'poc.ts'), ...(argv.includes('--skip-profile') ? ['--skip-profile'] : [])], { encoding: 'utf8', timeout: 240_000, killSignal: 'SIGKILL' });
  let poc: unknown;
  try { poc = JSON.parse(run.stdout); } catch { poc = undefined; }
  const result = {
   schema: 'ekg-win-privilege-probe.1',
   environment: { platform: process.platform, arch: arch(), node: process.version, os_release: release(), product: await productType(), github_runner_image: process.env.ImageOS ?? 'none' },
   token: { integrity: m.integrity, administrators_group: m.adminGroup, privilege_count: m.privileges.count, powerful_privileges: m.privileges.powerful, unlisted_privileges: m.privileges.unlisted },
   probes: m.probes,
   verdict: verdictOf(m),
   poc,
  };
  if (existsSync(out)) rmSync(out);
  writeFileSync(out, JSON.stringify(result, null, 1));
  return 0;
 } catch (e) {
  writeFileSync(out, JSON.stringify({ schema: 'ekg-win-privilege-probe.1', error: e instanceof ToolError ? e.code : 'PROBE_INTERNAL_ERROR' }));
  return 3;
 }
}
if (isMain(import.meta.url)) process.exitCode = await main();
