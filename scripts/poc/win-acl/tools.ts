// Milestone 6, Task 1A proof-of-concept ONLY: the Windows system-tool shim the plan calls D1.
// System executables are addressed by absolute System32 path, never through a shell, with a
// timeout and an output cap. Every failure is a fixed code; no argument, path, SID or tool
// output is ever copied into an error.
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

export type ToolCode = 'OK' | 'TOOL_MISSING' | 'TOOL_TIMEOUT' | 'TOOL_FAILED' | 'TOOL_OUTPUT_LIMIT';
export interface ToolResult { code: ToolCode; exit: number | null; stdout: string; ms: number }
export interface ToolOptions { timeoutMs: number; env?: NodeJS.ProcessEnv; maxBytes?: number }
export type Runner = (exe: string, args: string[], opts: ToolOptions) => Promise<ToolResult>;

export class ToolError extends Error {
 readonly code: string;
 constructor(code: string) { super(code); this.code = code; }
}

export const runTool: Runner = (exe, args, opts) => new Promise(resolve => {
 const started = process.hrtime.bigint();
 const done = (code: ToolCode, exit: number | null, stdout: string) =>
  resolve({ code, exit, stdout, ms: Number((process.hrtime.bigint() - started) / 1_000_000n) });
 const cap = opts.maxBytes ?? 1 << 20;
 let out = '', size = 0, settled = false;
 const finish = (code: ToolCode, exit: number | null) => { if (!settled) { settled = true; clearTimeout(timer); done(code, exit, code === 'OK' ? out : ''); } };
 let child;
 try {
  child = spawn(exe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: opts.env ?? process.env });
 } catch { done('TOOL_MISSING', null, ''); return; }
 const timer = setTimeout(() => { child.kill(); finish('TOOL_TIMEOUT', null); }, opts.timeoutMs);
 child.stdout.setEncoding('utf8');
 child.stdout.on('data', (chunk: string) => {
  size += Buffer.byteLength(chunk);
  if (size > cap) { child.kill(); finish('TOOL_OUTPUT_LIMIT', null); return; }
  out += chunk;
 });
 child.on('error', () => finish('TOOL_MISSING', null));
 child.on('close', code => finish(code === 0 ? 'OK' : 'TOOL_FAILED', code));
});

// --- Windows locations ------------------------------------------------------------------------

export function systemRoot(env: NodeJS.ProcessEnv = process.env): string {
 // A spread copy of process.env loses Windows' case-insensitive lookup, and Git Bash exports SYSTEMROOT.
 const find = (name: string) => Object.entries(env).find(([k]) => k.toLowerCase() === name)?.[1];
 const root = find('systemroot') ?? find('windir') ?? '';
 if (!/^[A-Za-z]:\\[^\\/:*?"<>|]+$/.test(root)) throw new ToolError('TOOL_ENV_INVALID');
 return root;
}
export const systemExe = (name: string, env?: NodeJS.ProcessEnv) => win32.join(systemRoot(env), 'System32', name);
export const powershellExe = (env?: NodeJS.ProcessEnv) => win32.join(systemRoot(env), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// --- whoami -----------------------------------------------------------------------------------

const SID_RE = /^S-1-\d+(?:-\d+)+$/;
export const isSid = (s: string) => SID_RE.test(s);

/** `whoami /user /fo csv /nh` prints one CSV row whose second column is the SID; the heading is suppressed. */
export function parseWhoamiUser(stdout: string): string {
 const lines = stdout.split(/\r?\n/).filter(l => l.trim() !== '');
 if (lines.length !== 1) throw new ToolError('ACL_UNPARSEABLE');
 const m = /^"[^"]*","(S-1-\d+(?:-\d+)+)"$/.exec(lines[0].trim());
 if (!m) throw new ToolError('ACL_UNPARSEABLE');
 return m[1];
}

/** Group names and attributes are localised; only the SID column and the integrity-label SID are read. */
export function parseWhoamiGroups(stdout: string): { integrity: string; administratorsListed: boolean } {
 const sids = [...stdout.matchAll(/"(S-1-\d+(?:-\d+)+)"/g)].map(m => m[1]);
 if (sids.length === 0) throw new ToolError('ACL_UNPARSEABLE');
 const label = sids.find(s => s.startsWith('S-1-16-'));
 const rid = label ? Number(label.slice('S-1-16-'.length)) : -1;
 const integrity = rid >= 16384 ? 'system' : rid >= 12288 ? 'high' : rid >= 8192 ? 'medium' : rid >= 4096 ? 'low' : rid >= 0 ? 'untrusted' : 'unknown';
 return { integrity, administratorsListed: sids.includes('S-1-5-32-544') };
}

// --- PowerShell batch descriptor read ---------------------------------------------------------

export interface DescriptorRead { attrs: number; sddl: string }
export type DescriptorEntry = DescriptorRead | { error: 'READ_FAILED' };
export interface BatchResult { languageMode: string; entries: DescriptorEntry[]; ms: number }

// Cmdlets and property reads only; the one assignment downgrades the session when `clm` is requested.
// Paths arrive through one environment variable ('|' cannot occur in a Windows path) and are never
// interpolated into the script text.
const READ_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 "if ($env:EKG_CLM -eq '1') { $ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage' }",
 "Write-Output ('M|' + $ExecutionContext.SessionState.LanguageMode)",
 '$i = 0',
 "foreach ($p in ($env:EKG_PATHS -split '\\|')) {",
 '  try {',
 '    $item = Get-Item -LiteralPath $p -Force',
 '    $attrs = [int]$item.Attributes',
 '    $acl = Get-Acl -LiteralPath $p',
 "    Write-Output ('P|' + $i + '|' + $attrs + '|' + $acl.Sddl)",
 "  } catch { Write-Output ('E|' + $i) }",
 '  $i++',
 '}',
].join('\n');

export const encodeScript = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

export function checkPaths(paths: string[]): void {
 if (paths.length === 0 || paths.length > 64) throw new ToolError('PATH_UNSUPPORTED');
 for (const p of paths) {
  if (!/^[A-Za-z]:\\/.test(p) || /[|\0\r\n]/.test(p) || p.length > 1024) throw new ToolError('PATH_UNSUPPORTED');
 }
}

export function parseBatch(stdout: string, count: number): { languageMode: string; entries: DescriptorEntry[] } {
 const lines = stdout.split(/\r?\n/).filter(l => l !== '');
 const mode = /^M\|([A-Za-z]+)$/.exec(lines[0] ?? '');
 if (!mode || lines.length !== count + 1) throw new ToolError('ACL_UNPARSEABLE');
 const entries: DescriptorEntry[] = [];
 for (let i = 0; i < count; i++) {
  const line = lines[i + 1];
  const ok = /^P\|(\d+)\|(\d+)\|(.+)$/.exec(line);
  const bad = /^E\|(\d+)$/.exec(line);
  const idx = ok ? Number(ok[1]) : bad ? Number(bad[1]) : -1;
  if (idx !== i) throw new ToolError('ACL_UNPARSEABLE');
  entries.push(ok ? { attrs: Number(ok[2]), sddl: ok[3] } : { error: 'READ_FAILED' });
 }
 return { languageMode: mode[1], entries };
}

export interface ReadOptions { clm?: boolean; runner?: Runner; env?: NodeJS.ProcessEnv; timeoutMs?: number }

export async function readDescriptors(paths: string[], opts: ReadOptions = {}): Promise<BatchResult> {
 checkPaths(paths);
 const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), EKG_PATHS: paths.join('|'), EKG_CLM: opts.clm ? '1' : '0' };
 delete env.__PSLockdownPolicy;
 const run = opts.runner ?? runTool;
 const r = await run(powershellExe(env), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeScript(READ_SCRIPT)], { timeoutMs: opts.timeoutMs ?? 20000, env });
 if (r.code !== 'OK') throw new ToolError(r.code);
 return { ...parseBatch(r.stdout, paths.length), ms: r.ms };
}

export async function currentUser(runner: Runner = runTool, env: NodeJS.ProcessEnv = process.env): Promise<{ sid: string; ms: number }> {
 const r = await runner(systemExe('whoami.exe', env), ['/user', '/fo', 'csv', '/nh'], { timeoutMs: 10000, env });
 if (r.code !== 'OK') throw new ToolError(r.code);
 return { sid: parseWhoamiUser(r.stdout), ms: r.ms };
}

export async function tokenFacts(runner: Runner = runTool, env: NodeJS.ProcessEnv = process.env) {
 const r = await runner(systemExe('whoami.exe', env), ['/groups', '/fo', 'csv', '/nh'], { timeoutMs: 10000, env });
 if (r.code !== 'OK') throw new ToolError(r.code);
 return parseWhoamiGroups(r.stdout);
}

/** icacls is used for fixture set-up and for the protect step; arguments are fixed tokens plus a path. */
export async function icacls(args: string[], runner: Runner = runTool, env: NodeJS.ProcessEnv = process.env): Promise<number> {
 const r = await runner(systemExe('icacls.exe', env), args, { timeoutMs: 20000, env });
 if (r.code !== 'OK') throw new ToolError(r.code);
 return r.ms;
}

/** Locale-independent facts that need no descriptor: UI culture name, volume file system and drive type. */
const FACTS_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 "if ($env:EKG_CLM -eq '1') { $ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage' }",
 "Write-Output ('M|' + $ExecutionContext.SessionState.LanguageMode)",
 "Write-Output ('C|' + (Get-UICulture).Name)",
 "Write-Output ('V|' + $PSVersionTable.PSVersion.Major + '.' + $PSVersionTable.PSVersion.Minor)",
 '$d = $env:EKG_DRIVE',
 "$f = 'DeviceID=' + [char]39 + $d + [char]39",
 'try {',
 '  $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter $f',
 "  Write-Output ('D|' + $disk.DriveType + '|' + $disk.FileSystem)",
 "} catch { Write-Output 'D|?|?' }",
 'try {',
 "  $null = [System.IO.Directory]::GetCurrentDirectory()",
 "  Write-Output 'N|allowed'",
 "} catch { Write-Output 'N|blocked' }",
].join('\n');

export interface Facts { languageMode: string; uiCulture: string; psVersion: string; driveType: string; fileSystem: string; dotnetMethods: string }
export function parseFacts(stdout: string): Facts {
 const get = (tag: string) => stdout.split(/\r?\n/).find(l => l.startsWith(tag + '|'))?.slice(tag.length + 1);
 const m = get('M'), c = get('C'), v = get('V'), d = get('D'), n = get('N');
 if (m === undefined || c === undefined || v === undefined || d === undefined || n === undefined) throw new ToolError('ACL_UNPARSEABLE');
 const [driveType, fileSystem] = d.split('|');
 return { languageMode: m.trim(), uiCulture: c.trim(), psVersion: v.trim(), driveType: driveType ?? '?', fileSystem: fileSystem ?? '?', dotnetMethods: n.trim() };
}

export async function readFacts(drive: string, opts: ReadOptions = {}): Promise<Facts> {
 if (!/^[A-Za-z]:$/.test(drive)) throw new ToolError('PATH_UNSUPPORTED');
 const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), EKG_DRIVE: drive.toUpperCase(), EKG_CLM: opts.clm ? '1' : '0' };
 delete env.__PSLockdownPolicy;
 const run = opts.runner ?? runTool;
 const r = await run(powershellExe(env), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeScript(FACTS_SCRIPT)], { timeoutMs: opts.timeoutMs ?? 20000, env });
 if (r.code !== 'OK') throw new ToolError(r.code);
 return parseFacts(r.stdout);
}

/** Descriptor sampler: reads one path in a tight loop and reports each distinct state with its count. */
const SAMPLER_SCRIPT = [
 "$ErrorActionPreference = 'Stop'",
 '$p = $env:EKG_PATHS',
 '$end = (Get-Date).AddSeconds([double]$env:EKG_SECONDS)',
 '$seen = @{}',
 '$n = 0',
 "Write-Output 'READY'",
 'while ((Get-Date) -lt $end) {',
 "  try { $s = (Get-Acl -LiteralPath $p).Sddl } catch { $s = 'ERR' }",
 '  $seen[$s] = 1 + [int]$seen[$s]',
 '  $n++',
 '}',
 "Write-Output ('N|' + $n)",
 "foreach ($k in $seen.Keys) { Write-Output ('S|' + $seen[$k] + '|' + $k) }",
].join('\n');

export interface SamplerOutput { samples: number; states: { count: number; sddl: string }[] }
export function parseSampler(stdout: string): SamplerOutput {
 const lines = stdout.split(/\r?\n/).filter(l => l !== '');
 if (lines[0] !== 'READY') throw new ToolError('ACL_UNPARSEABLE');
 const n = /^N\|(\d+)$/.exec(lines[1] ?? '');
 if (!n) throw new ToolError('ACL_UNPARSEABLE');
 const states = lines.slice(2).map(l => {
  const m = /^S\|(\d+)\|(.+)$/.exec(l);
  if (!m) throw new ToolError('ACL_UNPARSEABLE');
  return { count: Number(m[1]), sddl: m[2] };
 });
 return { samples: Number(n[1]), states };
}

/** Starts the sampler and resolves after it printed READY, returning a promise for its final output. */
export function startSampler(path: string, seconds: number, env: NodeJS.ProcessEnv = process.env) {
 checkPaths([path]);
 const e: NodeJS.ProcessEnv = { ...env, EKG_PATHS: path, EKG_SECONDS: String(seconds) };
 delete e.__PSLockdownPolicy;
 const child = spawn(powershellExe(e), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', encodeScript(SAMPLER_SCRIPT)], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: e });
 let out = '';
 let ready!: () => void;
 const readyPromise = new Promise<void>(r => { ready = r; });
 const result = new Promise<SamplerOutput>((resolve, reject) => {
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => { out += c; if (out.includes('READY')) ready(); });
  child.on('error', () => { ready(); reject(new ToolError('TOOL_MISSING')); });
  child.on('close', () => { ready(); try { resolve(parseSampler(out)); } catch (err) { reject(err); } });
 });
 return { ready: readyPromise, result };
}
