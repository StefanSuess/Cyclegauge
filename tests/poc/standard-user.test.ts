import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminGroupState, classifyPrivileges, parsePrivileges, parseRoleOutput, verdictOf, type Measured } from '../../scripts/poc/win-acl/privilege-probe.ts';
import { readFileSync } from 'node:fs';
import {
 ACCOUNT, CREATE_SCRIPT, LAUNCH_SCRIPT, PSI_SCRIPT, REMOVE_SCRIPT, REQUIRED_ITEMS, STATE_SCRIPT, TASK_SCRIPT,
 argSafe, childArguments, classifyRun, exitCodeOf, generatePassword, looksLikeHostedWindowsRunner, parseCreate, parseLaunch, parseState, pocProblems,
 runStandardUser, runVerdict, summaryLines, type Host,
} from '../../scripts/poc/win-acl/standard-user.ts';

const standard: Measured = {
 integrity: 'medium', adminGroup: 'absent',
 privileges: { count: 5, powerful: [], unlisted: [] },
 probes: { system32_write: 'denied', program_files_write: 'denied', net_session: 'denied' },
};

test('the accidental-use guard recognises hosted Windows runners only (it is not a security boundary)', () => {
 const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
 assert.equal(looksLikeHostedWindowsRunner(hosted, 'win32'), true);
 assert.equal(looksLikeHostedWindowsRunner(hosted, 'linux'), false);
 assert.equal(looksLikeHostedWindowsRunner({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' }, 'win32'), false);
 assert.equal(looksLikeHostedWindowsRunner({}, 'win32'), false);
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
  { probes: { ...standard.probes, net_session: 'unavailable' } },
  { probes: { ...standard.probes, system32_write: 'error' } },
 ] as Partial<Measured>[]) assert.equal(verdictOf({ ...standard, ...bad }), 'not_standard', JSON.stringify(bad));
});

test('role output is parsed per tag and an unknown value is an error', () => {
 assert.deepEqual(parseRoleOutput('R|False\r\nS|denied\r\nF|denied\r\n'), { isInRole: false, system32: 'denied', programFiles: 'denied' });
 assert.deepEqual(parseRoleOutput('R|True\nS|allowed\nF|weird\n'), { isInRole: true, system32: 'allowed', programFiles: 'error' });
 assert.equal(parseRoleOutput('').isInRole, undefined);
});


// --- orchestration with an injected host -----------------------------------------------------------------

const SID_LAUNCHER = 'S-1-5-21-1-1000';
const SID_NEW = 'S-1-5-21-1-1001';
const ok = (stdout: string) => ({ code: 'OK' as const, exit: 0, stdout, ms: 1 });
const ABSENT = 'U|absent\nT|absent\nP|absent\n';
const PRESENT = 'U|present\nT|absent\nP|present\n';

function goodPoc() {
 const items: Record<string, { status: string; code: string; data: Record<string, unknown> }> = {};
 for (const name of REQUIRED_ITEMS) items[name] = { status: 'established', code: 'OK', data: {} };
 items['1_current_user_sid'].data = { integrity_level: 'medium', administrators_group_listed: false };
 items['2_descriptor_reads'].data = { elevated: false };
 return { schema: 'ekg-win-acl-poc.1', environment: { integrity_level: 'medium' }, items, rejected_values: [] as string[] };
}
const goodReport = () => ({ verdict: 'standard_user', token: { integrity: 'medium' }, environment: { arch: 'arm64' }, probes: {}, poc: goodPoc() });

interface Scenario {
 report?: unknown;           // what the child writes as probe.json; undefined = nothing
 childSid?: string | null;   // what the child writes as sid.txt; null = nothing
 create?: string;
 pre?: string;
 states?: string[];          // answers to the state queries AFTER the first (pre-check); the last repeats
 stageRemovable?: boolean;
 launcher?: { sid?: string; integrity?: string };
 platform?: string;
}

function fake(sc: Scenario = {}) {
 const calls: string[] = [];
 const files = new Map<string, string>();
 const states = [sc.pre ?? ABSENT, ...(sc.states ?? [ABSENT])];
 let stateCalls = 0;
 const host: Host = {
  platform: sc.platform ?? 'win32',
  env: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' },
  node: 'C:\\node\\node.exe',
  probe: 'C:\\repo\\scripts\\poc\\win-acl\\privilege-probe.ts',
  repoRoot: 'C:\\repo',
  launcher: async () => sc.launcher ?? { sid: SID_LAUNCHER, integrity: 'high' },
  ps: async script => {
   if (script === STATE_SCRIPT) { calls.push('state'); return ok(states[Math.min(stateCalls++, states.length - 1)]); }
   if (script === CREATE_SCRIPT) { calls.push('create'); return ok(sc.create ?? `C|${SID_NEW}\n`); }
   if (script === REMOVE_SCRIPT) { calls.push('remove'); return ok('D|done\n'); }
   if (script === PSI_SCRIPT) {
    calls.push('launch');
    if (sc.report !== undefined) files.set('probe.json', JSON.stringify(sc.report));
    if (sc.childSid !== null) files.set('sid.txt', sc.childSid ?? SID_NEW);
    return ok('X|0\n');
   }
   if (script === LAUNCH_SCRIPT || script === TASK_SCRIPT) { calls.push('fallback'); return ok('E|X|Y|1\n'); }
   throw new Error('unexpected script');
  },
  grant: async () => true,
  makeStage: () => 'C:\\stage',
  readStage: (_stage, name) => files.get(name),
  removeStage: () => sc.stageRemovable ?? true,
  sleep: async () => undefined,
 };
 return { host, calls };
}
const run = (sc: Scenario = {}) => { const f = fake(sc); return runStandardUser(f.host, { retryDelayMs: 0 }).then(o => ({ o, calls: f.calls })); };

test('a clean run passes only when execution, PoC evidence and cleanup are all good', async () => {
 const { o, calls } = await run({ report: goodReport() });
 assert.equal(o.execution, 'obtained');
 assert.equal(o.poc, 'established');
 assert.equal(o.cleanup, 'confirmed');
 assert.equal(runVerdict(o), 'pass');
 assert.equal(exitCodeOf(o), 0);
 assert.deepEqual(calls.slice(0, 3), ['state', 'create', 'launch']);
 assert.equal(calls.at(-2), 'remove');
});

test('the child process identity must equal the created account and differ from the launcher', async () => {
 const other = await run({ report: goodReport(), childSid: 'S-1-5-21-1-1002' });
 assert.equal(other.o.reason, 'IDENTITY_MISMATCH');
 const same = await run({ report: goodReport(), childSid: SID_LAUNCHER });
 assert.equal(same.o.reason, 'SAME_ACCOUNT');
 const none = await run({ report: goodReport(), childSid: null });
 assert.equal(none.o.reason, 'IDENTITY_UNKNOWN');
 const noLauncher = await run({ report: goodReport(), launcher: { integrity: 'high' } });
 assert.equal(noLauncher.o.reason, 'IDENTITY_UNKNOWN');
 for (const r of [other, same, none, noLauncher]) {
  assert.equal(r.o.execution, 'not_obtained');
  assert.equal(r.o.poc, 'not_run');
  assert.equal(exitCodeOf(r.o), 1);
  assert.equal(r.o.cleanup, 'confirmed', 'the account is still removed');
 }
});

test('SIDs and the password never reach the printed summary', async () => {
 const { o } = await run({ report: goodReport() });
 const text = summaryLines(o).join('\n') + JSON.stringify(o);
 assert.doesNotMatch(text, /S-1-\d/);
 assert.doesNotMatch(text, /Ekg-/);
});

test('missing or non-established PoC items make the evidence incomplete, not just structurally present', async () => {
 const missing = goodReport();
 delete (missing.poc.items as Record<string, unknown>)['4_protect_step'];
 const a = await run({ report: missing });
 assert.equal(a.o.execution, 'obtained');
 assert.equal(a.o.poc, 'incomplete');
 assert.ok(a.o.pocProblems.includes('MISSING_4_protect_step'));
 assert.equal(exitCodeOf(a.o), 1);

 const partial = goodReport();
 partial.poc.items['5_safe_path_rules'].status = 'partial';
 assert.deepEqual(pocProblems(partial.poc), ['NOT_ESTABLISHED_5_safe_path_rules_partial']);

 const elevated = goodReport();
 elevated.poc.items['1_current_user_sid'].data.administrators_group_listed = true;
 elevated.poc.items['2_descriptor_reads'].data.elevated = true;
 assert.deepEqual(pocProblems(elevated.poc), ['ITEM1_TOKEN_DATA', 'ITEM2_ELEVATED']);
 assert.deepEqual(pocProblems({ error: 'POC_INTERNAL_ERROR' }), ['POC_UNUSABLE']);
 const rejected = goodReport();
 rejected.poc.rejected_values = ['items.x'];
 assert.deepEqual(pocProblems(rejected.poc), ['POC_REJECTED_VALUES']);
 assert.deepEqual(pocProblems(goodPoc()), []);
});

test('a failed or negative privilege measurement is never standard-user evidence', async () => {
 const failed = await run({ report: { schema: 'ekg-win-privilege-probe.1', error: 'TOOL_FAILED' } });
 assert.equal(failed.o.reason, 'CHILD_ERROR');
 const notStandard = await run({ report: { ...goodReport(), verdict: 'not_standard' } });
 assert.equal(notStandard.o.reason, 'TOKEN_NOT_STANDARD');
 const high = await run({ report: { ...goodReport(), token: { integrity: 'high' } } });
 assert.equal(high.o.reason, 'TOKEN_NOT_STANDARD');
 const nothing = await run({});
 assert.equal(nothing.o.reason, 'NO_CHILD_REPORT');
 assert.equal(nothing.o.stage, 'LAUNCH_NO_REPORT');
 assert.ok(nothing.calls.includes('fallback'), 'the fallback launchers are tried before giving up');
 for (const r of [failed, notStandard, high, nothing]) assert.equal(exitCodeOf(r.o), 1);
});

test('a partially created account is still removed and confirmed gone', async () => {
 const { o, calls } = await run({ create: 'E|InvalidOperationException\n', states: [PRESENT, ABSENT] });
 assert.equal(o.reason, 'ACCOUNT_CREATE_FAILED');
 assert.equal(o.execution, 'not_obtained');
 assert.deepEqual(calls.filter(c => c === 'remove'), ['remove', 'remove'], 'removal is retried until the state query says absent');
 assert.equal(calls.includes('launch'), false);
 assert.equal(o.cleanup, 'confirmed');
 assert.equal(exitCodeOf(o), 1);
});

test('unconfirmed cleanup makes the run invalid and exits 3', async () => {
 const stuck = await run({ report: goodReport(), states: [PRESENT] });
 assert.equal(stuck.o.cleanup, 'unconfirmed');
 assert.equal(runVerdict(stuck.o), 'invalid');
 assert.equal(exitCodeOf(stuck.o), 3);
 assert.equal(stuck.calls.filter(c => c === 'remove').length, 3);
 const taskLeft = await run({ report: goodReport(), states: ['U|absent\nT|present\nP|absent\n'] });
 assert.equal(exitCodeOf(taskLeft.o), 3);
 const stage = await run({ report: goodReport(), stageRemovable: false });
 assert.equal(exitCodeOf(stage.o), 3);
 const unknown = await run({ report: goodReport(), states: ['Q|error\n'] });
 assert.equal(exitCodeOf(unknown.o), 3, 'an unreadable state is not confirmation');
});

test('nothing is created or deleted when the account already exists, the runner is not recognised or the launcher is not elevated', async () => {
 const dirty = await run({ report: goodReport(), pre: PRESENT });
 assert.equal(dirty.o.reason, 'PRECHECK_NOT_CLEAN');
 assert.deepEqual(dirty.calls, ['state']);
 const linux = await run({ report: goodReport(), platform: 'linux' });
 assert.equal(linux.o.execution, 'refused');
 assert.equal(exitCodeOf(linux.o), 2);
 assert.deepEqual(linux.calls, []);
 const user = await run({ report: goodReport(), launcher: { sid: SID_LAUNCHER, integrity: 'medium' } });
 assert.equal(user.o.reason, 'LAUNCHER_NOT_ELEVATED');
 assert.deepEqual(user.calls, []);
});

test('parsers reduce PowerShell output to fixed tokens', () => {
 assert.deepEqual(parseState(ABSENT), { user: 'absent', task: 'absent', profile: 'absent' });
 assert.deepEqual(parseState('Q|error'), { user: 'unknown', task: 'unknown', profile: 'unknown' });
 assert.equal(parseCreate(`C|${SID_NEW}`), SID_NEW);
 assert.equal(parseCreate('E|InvalidOperationException'), undefined);
 assert.equal(parseCreate('C|not-a-sid'), undefined);
});

test('the workflow is manual or push-only, never pull_request, and the job guard excludes forks', () => {
 const text = readFileSync(new URL('../../.github/workflows/platform-poc.yml', import.meta.url), 'utf8').split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n');
 const start = text.indexOf('\non:\n');
 const on = text.slice(start, text.indexOf('\npermissions:', start));
 assert.ok(start > 0 && on.length > 10, 'the on: block is found');
 assert.match(on, /workflow_dispatch:/);
 assert.doesNotMatch(on, /pull_request/);
 assert.doesNotMatch(text, /pull_request_target|workflow_run/);
 assert.match(text, /!github\.event\.repository\.fork/);
 assert.match(text, /if: \$\{\{ always\(\) \}\}/);
});
