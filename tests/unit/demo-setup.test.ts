import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
// @ts-expect-error -- plain .mjs helper without a declaration file
import { demoParentDir } from '../../scripts/demo/base.mjs';

const longDarwinTmp = '/private/var/folders/aa/bbbbbbbbbbbbbbbbbbbbbbbbbbbb/T';
const shortDarwinTmp = '/var/t';
const identity = (path: string) => path;
const realpathStub = (path: string) => (path === '/tmp' ? '/private/tmp' : path);

test('darwin with a long temp directory uses the /tmp fallback', () => {
 assert.ok(join(longDarwinTmp, 'synthetic-cyclegauge-demo-XXXXXX', 'user-data', '1.000-main.sock').length > 100);
 assert.equal(demoParentDir({ platform: 'darwin', tmp: longDarwinTmp, realpath: realpathStub }), '/private/tmp');
});

test('darwin with a short temp directory keeps tmpdir()', () => {
 assert.equal(demoParentDir({ platform: 'darwin', tmp: shortDarwinTmp, realpath: identity }), shortDarwinTmp);
});

test('non-darwin platforms always keep tmpdir()', () => {
 for (const platform of ['linux', 'win32']) {
  assert.equal(demoParentDir({ platform, tmp: longDarwinTmp, realpath: realpathStub }), longDarwinTmp);
 }
});
