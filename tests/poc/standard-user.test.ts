import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminGroupState, classifyPrivileges, parsePrivileges, parseRoleOutput, verdictOf, type Measured } from '../../scripts/poc/win-acl/privilege-probe.ts';
import { ACCOUNT, argSafe, childArguments, classifyRun, generatePassword, hostedWindowsRunner, parseLaunch } from '../../scripts/poc/win-acl/standard-user.ts';

const standard: Measured = {
 integrity: 'medium', adminGroup: 'absent',
 privileges: { count: 5, powerful: [], unlisted: [] },
 probes: { system32_write: 'denied', program_files_write: 'denied', net_session: 'denied' },
};

test('an account is only created on a GitHub-hosted Windows runner', () => {
 const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
 assert.equal(hostedWindowsRunner(hosted, 'win32'), true);
 assert.equal(hostedWindowsRunner(hosted, 'linux'), false);
 assert.equal(hostedWindowsRunner({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }, 'win32'), false);
 assert.equal(hostedWindowsRunner({}, 'win32'), false);
 assert.match(ACCOUNT, /^synthetic-ekg-[a-z]+$/);
 assert.ok(ACCOUNT.length <= 20, 'Windows account names are limited to 20 characters');
});

test('privileges are read from the invariant constant names only', () => {
 const out = ['"SeChangeNotifyPrivilege","Bypass traverse checking","Enabled"', '"SeShutdownPrivilege","Shut down the system","Disabled"', '"SeDebugPrivilege","Debug programs","Enabled"'].join('\r\n');
 assert.deepEqual(parsePrivileges(out), ['SeChangeNotifyPrivilege', 'SeDebugPrivilege', 'SeShutdownPrivilege']);
 assert.throws(() => parsePrivileges('no table'), /ACL_UNPARSEABLE/);
 const c = classifyPrivileges(parsePrivileges(out));
 assert.deepEqual(c.powerful, ['SeDebugPrivilege']);
 assert.deepEqual(c.unlisted, []);
 assert.deepEqual(classifyPrivileges(['SeWeirdNewPrivilege']).unlisted, ['SeWeirdNewPrivilege']);
});

test('the administrators group state separates absent, deny-only and enabled', () => {
 assert.equal(adminGroupState(false, false), 'absent');
 assert.equal(adminGroupState(true, false), 'deny_only');
 assert.equal(adminGroupState(true, true), 'enabled');
 assert.equal(adminGroupState(true, undefined), 'unknown');
});

test('the token verdict needs every signal, not only the integrity level', () => {
 assert.equal(verdictOf(standard), 'standard_user');
 assert.equal(verdictOf({ ...standard, adminGroup: 'deny_only' }), 'standard_user');
 for (const bad of [
  { integrity: 'high' }, { adminGroup: 'enabled' }, { adminGroup: 'unknown' },
  { privileges: { count: 6, powerful: ['SeDebugPrivilege'], unlisted: [] } },
  { probes: { ...standard.probes, system32_write: 'allowed' } },
  { probes: { ...standard.probes, program_files_write: 'error' } },
  { probes: { ...standard.probes, net_session: 'allowed' } },
 ] as Partial<Measured>[]) assert.equal(verdictOf({ ...standard, ...bad }), 'not_standard', JSON.stringify(bad));
});

test('role output is parsed per tag and an unknown value is an error', () => {
 assert.deepEqual(parseRoleOutput('R|False\r\nS|denied\r\nF|denied\r\n'), { isInRole: false, system32: 'denied', programFiles: 'denied' });
 assert.deepEqual(parseRoleOutput('R|True\nS|allowed\nF|weird\n'), { isInRole: true, system32: 'allowed', programFiles: 'error' });
 assert.equal(parseRoleOutput('').isInRole, undefined);
});

test('the run is standard-user evidence only when the child measured it and the account differs', () => {
 const child = { verdict: 'standard_user', token: { integrity: 'medium' }, poc: { environment: { integrity_level: 'medium' }, items: {} } };
 assert.deepEqual(classifyRun(child, 'S-1-5-21-1-1000', 'S-1-5-21-1-1001'), { verdict: 'obtained', reason: 'MEASURED' });
 assert.equal(classifyRun(child, 'S-1-5-21-1-1000', 'S-1-5-21-1-1000').reason, 'SAME_ACCOUNT');
 assert.equal(classifyRun(child, undefined, 'S-1-5-21-1-1001').reason, 'IDENTITY_UNKNOWN');
 assert.equal(classifyRun({ ...child, verdict: 'not_standard' }, 'a', 'b').reason, 'TOKEN_NOT_STANDARD');
 assert.equal(classifyRun({ ...child, poc: { environment: { integrity_level: 'high' }, items: {} } }, 'a', 'b').reason, 'POC_REPORT_UNUSABLE');
 assert.equal(classifyRun({ error: 'X' }, 'a', 'b').reason, 'CHILD_ERROR');
 assert.equal(classifyRun(undefined, 'a', 'b').reason, 'NO_CHILD_REPORT');
});

test('child arguments accept plain paths and flags only; the password is random and well formed', () => {
 assert.equal(childArguments('C:\\r\\privilege-probe.ts', 'C:\\s\\probe.json', ['--skip-profile']), '--disable-warning=ExperimentalWarning "C:\\r\\privilege-probe.ts" --out "C:\\s\\probe.json" --skip-profile');
 for (const bad of ['rel\\p', 'C:\\a"b', 'C:\\a$b', 'C:\\a`b', 'C:\\a%b', 'C:\\a;b\n']) assert.equal(argSafe(bad), false, bad);
 assert.throws(() => childArguments('C:\\a"b', 'C:\\s\\o.json', []), /PATH_UNSUPPORTED/);
 assert.throws(() => childArguments('C:\\a', 'C:\\s\\o.json', ['; calc']), /ARGUMENT_UNSUPPORTED/);
 const a = generatePassword(), b = generatePassword();
 assert.notEqual(a, b);
 assert.match(a, /^Ekg-[A-Za-z0-9_-]{24}-9a!$/);
});

test('launcher output is reduced to fixed tokens', () => {
 assert.equal(parseLaunch('X|0\r\n'), 'exit_0');
 assert.equal(parseLaunch('E|InvalidOperationException|CouldNotStartProcess,Microsoft.PowerShell.Commands.StartProcessCommand|-2146233079'), 'error_InvalidOperationException_CouldNotStartProcess,Microsoft.PowerShell.Commands.StartProcessCommand_-2146233079');
 assert.equal(parseLaunch('E|Bad Type with C:\\path|x|1'), 'no_outcome_line');
 assert.equal(parseLaunch(''), 'no_outcome_line');
});
