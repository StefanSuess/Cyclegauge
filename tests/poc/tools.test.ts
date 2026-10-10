import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
 ToolError, checkPaths, currentUser, parseBatch, parseFacts, parseSampler, parseWhoamiGroups, parseWhoamiUser,
 powershellExe, readDescriptors, runTool, systemExe, systemRoot, type Runner, type ToolResult,
} from '../../scripts/poc/win-acl/tools.ts';

const node = process.execPath;
const ENV = { SystemRoot: 'C:\\Windows', __PSLockdownPolicy: '4' } as NodeJS.ProcessEnv;
const fake = (stdout: string, calls: { exe: string; args: string[]; env?: NodeJS.ProcessEnv }[] = []): Runner => async (exe, args, opts) => {
 calls.push({ exe, args, env: opts.env });
 return { code: 'OK', exit: 0, stdout, ms: 1 } satisfies ToolResult;
};
const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le');

test('whoami output is parsed by column, not by locale-dependent text', () => {
 const sid = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
 assert.equal(parseWhoamiUser(`"SYNTHETIC\\synthetic-user","${sid}"\r\n`), sid);
 assert.throws(() => parseWhoamiUser(''), (e: unknown) => e instanceof ToolError && e.code === 'ACL_UNPARSEABLE');
 assert.throws(() => parseWhoamiUser('"a","not-a-sid"'), /ACL_UNPARSEABLE/);
 assert.throws(() => parseWhoamiUser(`"a","${sid}"\n"b","${sid}"`), /ACL_UNPARSEABLE/);
});

test('integrity level and administrators membership come from SID columns only', () => {
 const groups = (rid: number, admin: boolean) => [
  '"Synthetisch\\Gruppe","Wohlbekannte Gruppe","S-1-1-0","Pflichtgruppe, Standardmäßig aktiviert"',
  ...(admin ? ['"BUILTIN\\Administratoren","Alias","S-1-5-32-544","Gruppe nur für Verweigerung"'] : []),
  `"Mandatory Label\\Level","Label","S-1-16-${rid}","Pflichtgruppe"`,
 ].join('\r\n');
 assert.deepEqual(parseWhoamiGroups(groups(12288, true)), { integrity: 'high', administratorsListed: true });
 assert.deepEqual(parseWhoamiGroups(groups(8192, false)), { integrity: 'medium', administratorsListed: false });
 assert.deepEqual(parseWhoamiGroups('"x","y","S-1-1-0","z"'), { integrity: 'unknown', administratorsListed: false });
});

test('batch output must match the requested paths one-to-one', () => {
 const out = 'M|ConstrainedLanguage\nP|0|16|O:SYD:(A;;FA;;;BA)\nE|1\n';
 assert.deepEqual(parseBatch(out, 2), {
  languageMode: 'ConstrainedLanguage',
  entries: [{ attrs: 16, sddl: 'O:SYD:(A;;FA;;;BA)' }, { error: 'READ_FAILED' }],
 });
 for (const bad of ['', 'garbage', 'M|Full\nP|1|16|x', 'M|Full\nP|0|16|x\nP|1|16|y', 'M|Full\nX|0']) {
  assert.throws(() => parseBatch(bad, 1), /ACL_UNPARSEABLE/);
 }
});

test('only absolute drive-letter paths without separators of the transport are accepted', () => {
 checkPaths(['C:\\Synthetic\\Ünï cödé 日本']);
 for (const bad of ['', 'relative\\x', '\\\\synthetic-host\\share', 'C:\\a|b', 'C:\\a\nb', '\\\\?\\C:\\a']) {
  assert.throws(() => checkPaths([bad]), (e: unknown) => e instanceof ToolError && e.code === 'PATH_UNSUPPORTED', bad);
 }
 assert.throws(() => checkPaths([]), /PATH_UNSUPPORTED/);
});

test('system tools are addressed by absolute System32 path from a validated root', () => {
 assert.equal(systemExe('whoami.exe', ENV), 'C:\\Windows\\System32\\whoami.exe');
 assert.equal(powershellExe(ENV), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 for (const bad of ['', 'Windows', '..\\Windows', 'C:\\Windows\\..\\x', 'C:Windows', '\\\\host\\share']) {
  assert.throws(() => systemRoot({ SystemRoot: bad }), (e: unknown) => e instanceof ToolError && e.code === 'TOOL_ENV_INVALID', bad);
 }
});

test('system root is found regardless of variable-name case', () => {
 assert.equal(systemRoot({ SYSTEMROOT: 'C:\\Windows' }), 'C:\\Windows');
 assert.equal(systemRoot({ WINDIR: 'D:\\WINNT' }), 'D:\\WINNT');
});

test('descriptor read passes paths through the environment, never through the script text', async () => {
 const calls: { exe: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
 const paths = ['C:\\Synthetic\\one', 'C:\\Synthetic\\two space'];
 const r = await readDescriptors(paths, { runner: fake('M|FullLanguage\nP|0|16|O:SYD:(A;;FA;;;BA)\nP|1|32|O:SYD:(A;;FA;;;BA)\n', calls), env: ENV, clm: true });
 assert.equal(r.entries.length, 2);
 const [call] = calls;
 assert.equal(call.exe, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.deepEqual(call.args.slice(0, 4), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand']);
 const script = decode(call.args[4]);
 for (const p of paths) assert.ok(!script.includes(p) && !call.args.join(' ').includes(p));
 assert.ok(!script.includes('ExecutionPolicy') && !script.includes('Invoke-Expression') && !/\biex\b/i.test(script));
 assert.equal(call.env?.EKG_PATHS, paths.join('|'));
 assert.equal(call.env?.EKG_CLM, '1');
 assert.equal(call.env?.__PSLockdownPolicy, undefined);
});

test('tool failures surface as fixed codes', async () => {
 const failing = (code: ToolResult['code']): Runner => async () => ({ code, exit: null, stdout: '', ms: 1 });
 for (const code of ['TOOL_MISSING', 'TOOL_TIMEOUT', 'TOOL_FAILED', 'TOOL_OUTPUT_LIMIT'] as const) {
  await assert.rejects(readDescriptors(['C:\\Synthetic'], { runner: failing(code), env: ENV }), (e: unknown) => e instanceof ToolError && e.code === code);
  await assert.rejects(currentUser(failing(code), ENV), (e: unknown) => e instanceof ToolError && e.code === code);
 }
 await assert.rejects(readDescriptors(['C:\\Synthetic'], { runner: fake('nonsense'), env: ENV }), /ACL_UNPARSEABLE/);
});

test('runner: missing executable, timeout, output cap and exit status are distinct fixed codes', async () => {
 assert.equal((await runTool(node + '.synthetic-missing', [], { timeoutMs: 2000 })).code, 'TOOL_MISSING');
 assert.equal((await runTool(node, ['-e', 'setTimeout(()=>{}, 10000)'], { timeoutMs: 150 })).code, 'TOOL_TIMEOUT');
 assert.equal((await runTool(node, ['-e', 'setInterval(()=>process.stdout.write("x".repeat(4096)),1)'], { timeoutMs: 5000, maxBytes: 8192 })).code, 'TOOL_OUTPUT_LIMIT');
 assert.equal((await runTool(node, ['-e', 'process.exit(3)'], { timeoutMs: 5000 })).code, 'TOOL_FAILED');
 const ok = await runTool(node, ['-e', 'process.stdout.write("synthetic-output")'], { timeoutMs: 5000 });
 assert.deepEqual([ok.code, ok.stdout], ['OK', 'synthetic-output']);
});

test('runner does not interpret shell syntax in arguments', async () => {
 const r = await runTool(node, ['-p', 'process.argv.length', '&& echo injected', '| more', '%SYNTHETIC%'], { timeoutMs: 5000 });
 assert.equal(r.stdout.trim(), '4');
});

test('facts and sampler output parsers are strict', () => {
 const facts = parseFacts('M|ConstrainedLanguage\nC|de-DE\nV|5.1\nD|3|NTFS\nN|blocked\n');
 assert.deepEqual(facts, { languageMode: 'ConstrainedLanguage', uiCulture: 'de-DE', psVersion: '5.1', driveType: '3', fileSystem: 'NTFS', dotnetMethods: 'blocked' });
 assert.throws(() => parseFacts('C|de-DE'), /ACL_UNPARSEABLE/);
 assert.deepEqual(parseSampler('READY\nN|120\nS|100|O:SYD:(A;;FA;;;BA)\nS|20|O:SYD:PAI(A;;FA;;;BA)\n'),
  { samples: 120, states: [{ count: 100, sddl: 'O:SYD:(A;;FA;;;BA)' }, { count: 20, sddl: 'O:SYD:PAI(A;;FA;;;BA)' }] });
 assert.throws(() => parseSampler('N|1'), /ACL_UNPARSEABLE/);
});
