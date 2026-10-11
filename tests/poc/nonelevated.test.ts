import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchSafe, classify, commandFile, isUsableReport } from '../../scripts/poc/win-acl/nonelevated.ts';

test('the verdict is derived only from the measured integrity level', () => {
 const report = (integrity: unknown) => ({ environment: { integrity_level: integrity }, items: {} });
 assert.deepEqual(classify(report('medium')), { verdict: 'obtained', integrity: 'medium' });
 assert.deepEqual(classify(report('low')), { verdict: 'obtained', integrity: 'low' });
 for (const level of ['high', 'system', 'unknown', 'untrusted', 7, undefined]) {
  assert.equal(classify(report(level)).verdict, 'not_obtained', String(level));
 }
 assert.equal(classify(undefined).verdict, 'not_obtained');
 assert.equal(classify({}).verdict, 'not_obtained');
 assert.equal(classify('medium').verdict, 'not_obtained', 'a bare string is not a report');
});

test('batch files accept plain absolute paths only', () => {
 assert.equal(batchSafe('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\synthetic-run'), true);
 assert.equal(batchSafe('C:\\Program Files\\nodejs\\node.exe'), true);
 for (const bad of ['relative\\p', 'C:\\a"b', 'C:\\a%PATH%', 'C:\\a&calc', 'C:\\a|b', 'C:\\a^b', 'C:\\a\nb', 'C:\\a!b', '\\\\host\\share\\x', '']) {
  assert.equal(batchSafe(bad), false, JSON.stringify(bad));
 }
});

test('the generated command file redirects output into the stage and signals completion last', () => {
 const text = commandFile('C:\\node\\node.exe', 'C:\\repo\\poc.ts', ['--skip-profile'], 'C:\\stage');
 const lines = text.split('\r\n');
 assert.equal(lines[0], '@echo off');
 assert.match(lines[1], /^"C:\\node\\node\.exe" --disable-warning=ExperimentalWarning "C:\\repo\\poc\.ts" --skip-profile > "C:\\stage\\report\.json" 2> "C:\\stage\\stderr\.txt"$/);
 assert.equal(lines.at(-2), 'echo done > "C:\\stage\\done.txt"');
 assert.throws(() => commandFile('C:\\node\\n"ode.exe', 'C:\\repo\\poc.ts', [], 'C:\\stage'), /PATH_UNSUPPORTED/);
 assert.throws(() => commandFile('C:\\node\\node.exe', 'C:\\repo\\poc.ts', ['& calc'], 'C:\\stage'), /ARGUMENT_UNSUPPORTED/);
});

test('failure objects and partial reports are not rendered as results', () => {
 assert.equal(isUsableReport({ schema: 'ekg-win-acl-poc.1', error: 'ACL_UNPARSEABLE' }), false);
 assert.equal(isUsableReport(undefined), false);
 assert.equal(isUsableReport('text'), false);
 assert.equal(isUsableReport({ environment: {}, items: {} }), true);
});

test('batch paths must be printable ASCII without shell metacharacters', () => {
 for (const bad of ['C:\\a\u001ab', 'C:\\Users\\J\u00fcrgen\\x', 'C:\\a\u007fb']) assert.equal(batchSafe(bad), false, JSON.stringify(bad));
});
