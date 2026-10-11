import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWLIST, comparePayload, parseArgs, verifyVsix } from '../../scripts/release/verify-vsix.ts';
import { readZip, safeEntryName, writeZip, ZipError } from '../../scripts/release/zip.ts';

// Archives here are built from scratch with invented content; no real build output is needed.
const manifest = (extra: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({
 name: 'synthetic', version: '1.2.3', main: './dist/extension.cjs', engines: { vscode: '^1.90.0' },
 contributes: { configuration: { properties: {
  'easykirogauge.sourceRoot': { type: 'string', scope: 'machine' }, 'easykirogauge.storageRoot': { type: 'string', scope: 'machine' } } } }, ...extra }));
const BUNDLE = 'const vscode=require("vscode");exports.activate=function activate(){};exports.deactivate=function deactivate(){};';
const files = (over: Record<string, Buffer | null> = {}) => {
 const base: Record<string, Buffer> = {
  '[Content_Types].xml': Buffer.from('<Types/>'),
  'extension.vsixmanifest': Buffer.from('<PackageManifest><Identity Version="1.2.3"/></PackageManifest>'),
  'extension/dist/extension.cjs': Buffer.from(BUNDLE),
  'extension/package.json': manifest(),
  'extension/readme.md': Buffer.from('# synthetic'),
 };
 for (const [k, v] of Object.entries(over)) { if (v === null) delete base[k]; else base[k] = v; }
 return Object.entries(base).map(([name, data]) => ({ name, data }));
};
const problems = (list: ReturnType<typeof files>) => verifyVsix(writeZip(list)).problems;

test('an archive with exactly the allowlisted entries passes and every file is hashed', () => {
 const r = verifyVsix(writeZip(files()));
 assert.deepEqual(r.problems, []); assert.equal(r.ok, true); assert.equal(r.version, '1.2.3');
 assert.deepEqual(r.files.map(f => f.name), [...ALLOWLIST].sort((a, b) => a.localeCompare(b)));
 for (const f of r.files) assert.match(f.sha256, /^[a-f0-9]{64}$/);
});

test('extra, missing and renamed entries are reported', () => {
 assert.deepEqual(problems([...files(), { name: 'extension/secrets.txt', data: Buffer.from('x') }]), ['UNEXPECTED_ENTRY']);
 assert.ok(problems(files({ 'extension/readme.md': null })).includes('MISSING_ENTRY:extension/readme.md'));
 assert.ok(problems(files({ 'extension/README.md': Buffer.from('x'), 'extension/readme.md': null })).includes('UNEXPECTED_ENTRY'));
});

test('unsafe entry names, duplicates, encryption, links and bad checksums are rejected before any content is trusted', () => {
 const code = (buf: Buffer) => { try { readZip(buf); return 'NO_ERROR'; } catch (e) { return e instanceof ZipError ? e.code : 'OTHER'; } };
 const data = Buffer.from('x');
 assert.equal(code(writeZip([{ name: '../escape', data }])), 'ZIP_UNSAFE_NAME');
 assert.equal(code(writeZip([{ name: '/abs/file', data }])), 'ZIP_UNSAFE_NAME');
 assert.equal(code(writeZip([{ name: 'C:/windows', data }])), 'ZIP_UNSAFE_NAME');
 assert.equal(code(writeZip([{ name: 'a\\b', data }])), 'ZIP_UNSAFE_NAME');
 assert.equal(code(writeZip([{ name: 'a/../b', data }])), 'ZIP_UNSAFE_NAME');
 assert.equal(code(writeZip([{ name: 'same', data }, { name: 'same', data }])), 'ZIP_DUPLICATE');
 assert.equal(code(writeZip([{ name: 'enc', data, flags: 1 }])), 'ZIP_ENCRYPTED');
 assert.equal(code(writeZip([{ name: 'link', data, attributes: (0o120777 << 16) >>> 0 }])), 'ZIP_SYMLINK');
 const stored = writeZip([{ name: 'file', data: Buffer.from('payload'), method: 0 }]);
 stored[stored.indexOf(Buffer.from('payload'))] ^= 0xff;
 assert.equal(code(stored), 'ZIP_CRC');
 assert.equal(code(Buffer.from('too short')), 'ZIP_SIZE');
 assert.equal(code(Buffer.from('not a zip at all, just plain text of some length')), 'ZIP_NO_DIRECTORY');
 assert.equal(code(Buffer.alloc(100)), 'ZIP_NO_DIRECTORY');
});

test('size and entry-count limits stop oversized or bomb-like archives', () => {
 const big = writeZip([{ name: 'big', data: Buffer.alloc(9 * 1024 * 1024) }]);
 assert.throws(() => readZip(big), (e: unknown) => e instanceof ZipError && e.code === 'ZIP_ENTRY_TOO_LARGE');
 const many = writeZip(Array.from({ length: 65 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x') })));
 assert.throws(() => readZip(many), (e: unknown) => e instanceof ZipError && e.code === 'ZIP_TOO_MANY_ENTRIES');
 assert.equal(safeEntryName('extension/dist/extension.cjs'), true);
 assert.equal(safeEntryName(''), false);
});

test('a header that lies about the size cannot bypass the inflation cap', () => {
 const bomb = writeZip([{ name: 'bomb', data: Buffer.alloc(9 * 1024 * 1024) }]);
 // Patch the declared uncompressed size to 10 bytes in both the central and the local header.
 const central = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
 bomb.writeUInt32LE(10, central + 24); bomb.writeUInt32LE(10, 22);
 assert.throws(() => readZip(bomb), (e: unknown) => e instanceof ZipError && e.code === 'ZIP_INFLATE');
});

test('manifest and bundle defects are reported with fixed codes', () => {
 assert.ok(problems(files({ 'extension/package.json': manifest({ main: './out/other.js' }) })).includes('MANIFEST_MAIN'));
 assert.ok(problems(files({ 'extension/package.json': manifest({ dependencies: { left: '1.0.0' } }) })).includes('MANIFEST_RUNTIME_DEPENDENCIES'));
 assert.ok(problems(files({ 'extension/package.json': manifest({ contributes: { configuration: { properties: { 'easykirogauge.sourceRoot': { scope: 'window' }, 'easykirogauge.storageRoot': { scope: 'machine' } } } } }) })).includes('MANIFEST_ROOT_SETTING_SCOPE'));
 assert.ok(problems(files({ 'extension/package.json': Buffer.from('{not json') })).includes('MANIFEST_JSON'));
 assert.ok(problems(files({ 'extension.vsixmanifest': Buffer.from('<Identity Version="9.9.9"/>') })).includes('VSIXMANIFEST_VERSION'));
 const leak = (text: string) => problems(files({ 'extension/dist/extension.cjs': Buffer.from(BUNDLE + text) }));
 assert.ok(leak('//build at /Users/synthetic-builder/work/src').includes('BUNDLE_HOME_PATH'));
 assert.ok(leak('//build at /home/synthetic-builder/work/src').includes('BUNDLE_HOME_PATH'));
 assert.ok(leak('//build at C:\\Users\\synthetic-builder\\work').includes('BUNDLE_WINDOWS_PROFILE_PATH'));
 assert.ok(leak('\n//# sourceMappingURL=extension.cjs.map').includes('BUNDLE_SOURCEMAP'));
 assert.ok(leak('const k="-----BEGIN RSA PRIVATE KEY-----"').includes('BUNDLE_CREDENTIAL_MARKER'));
 assert.ok(leak('const s=require("node:sqlite");').includes('BUNDLE_STATIC_SQLITE'));
 assert.ok(problems(files({ 'extension/dist/extension.cjs': Buffer.from('exports.other=1;') })).includes('BUNDLE_ENTRYPOINTS'));
});

test('payload comparison ignores container metadata and flags any payload byte difference', () => {
 const a = verifyVsix(writeZip(files())).files;
 const reordered = verifyVsix(writeZip(files().reverse())).files;
 assert.deepEqual(comparePayload(a, reordered), []);
 const changedManifestXml = verifyVsix(writeZip(files({ 'extension.vsixmanifest': Buffer.from('<PackageManifest><Identity Version="1.2.3"/><!-- other timestamp --></PackageManifest>') }))).files;
 assert.deepEqual(comparePayload(a, changedManifestXml), [], 'vsix manifest metadata is not payload');
 const changedBundle = verifyVsix(writeZip(files({ 'extension/dist/extension.cjs': Buffer.from(BUNDLE + ';') }))).files;
 assert.deepEqual(comparePayload(a, changedBundle), ['extension/dist/extension.cjs']);
});

test('the directory must match the end record exactly: no hidden entries, trailing data or comments', () => {
 const code = (buf: Buffer) => { try { readZip(buf); return 'NO_ERROR'; } catch (e) { return e instanceof ZipError ? e.code : 'OTHER'; } };
 const six = writeZip([...files(), { name: 'extension/evil.js', data: Buffer.from('x') }]);
 const hidden = Buffer.from(six);
 hidden.writeUInt16LE(5, hidden.length - 22 + 10); // end record claims five entries
 assert.equal(code(hidden), 'ZIP_COUNT_MISMATCH');
 const both = Buffer.from(six);
 both.writeUInt16LE(5, both.length - 22 + 8); both.writeUInt16LE(5, both.length - 22 + 10);
 assert.equal(code(both), 'ZIP_DIRECTORY_GAP');
 assert.equal(code(Buffer.concat([writeZip(files()), Buffer.from('trailing junk')])), 'ZIP_TRAILING_DATA');
 const commented = Buffer.concat([writeZip(files()), Buffer.from('c')]);
 commented.writeUInt16LE(1, commented.length - 1 - 22 + 20);
 assert.equal(code(commented), 'ZIP_TRAILING_DATA');
 assert.equal(code(writeZip(files())), 'NO_ERROR');
});

test('payload comparison treats a missing side as a difference, never as equal', () => {
 assert.deepEqual(comparePayload([], []), ['extension/dist/extension.cjs', 'extension/package.json', 'extension/readme.md']);
});

test('command line parsing rejects missing values and extra arguments instead of skipping checks', () => {
 assert.deepEqual(parseArgs(['a.vsix']), { file: 'a.vsix', out: undefined, compare: undefined });
 assert.deepEqual(parseArgs(['a.vsix', '--compare', 'b.json', '--out', 'c.json']), { file: 'a.vsix', out: 'c.json', compare: 'b.json' });
 for (const bad of [[], ['--compare'], ['a.vsix', '--compare'], ['a.vsix', '--out', '--compare', 'x'], ['a', 'b'], ['a.vsix', '--unknown']]) {
  assert.equal(parseArgs(bad), undefined, JSON.stringify(bad));
 }
});

test('bundle leak patterns cover hidden directories, CI workspaces and more credential shapes', () => {
 const leak = (text: string) => problems(files({ 'extension/dist/extension.cjs': Buffer.from(BUNDLE + text) }));
 assert.ok(leak('//x /home/synthetic-runner/.cache/tool').includes('BUNDLE_HOME_PATH'));
 assert.ok(leak('//x /Users/synthetic/.nvm/versions').includes('BUNDLE_HOME_PATH'));
 assert.ok(leak('//x D:\\a\\synthetic-repo\\src').includes('BUNDLE_CI_WORKSPACE_PATH'));
 for (const secret of ['github_pat_' + 'A'.repeat(30), 'gho_' + 'a'.repeat(30), 'xoxb-' + '1'.repeat(12), 'AS' + 'IA' + 'A'.repeat(16)]) {
  assert.ok(leak('const t="' + secret + '"').includes('BUNDLE_CREDENTIAL_MARKER'), secret.slice(0, 6));
 }
 assert.deepEqual(leak('// a normal comment about /logs/ and credit usage'), []);
});
