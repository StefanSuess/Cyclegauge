import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSourceFor, defaultStorageFor, hostLogUri, inside, isWindowsNetworkPath, resolveSourceRoot, rootFromLogUri, samePath } from '../../src/paths.ts';

// All paths are invented. Functions are pure, so every platform is exercised on every host.
const MAC = '/Users/synthetic-user';
const LIN = '/home/synthetic-user';
const WIN = 'C:\\Users\\synthetic-user';

test('platform defaults match the 0.5.1 locations for valid environments', () => {
 assert.equal(defaultSourceFor('darwin', {}, MAC), `${MAC}/Library/Application Support/Kiro`);
 assert.equal(defaultStorageFor('darwin', {}, MAC), `${MAC}/Library/Application Support/EasyKiroGauge`);
 assert.equal(defaultSourceFor('linux', {}, LIN), `${LIN}/.config/Kiro`);
 assert.equal(defaultStorageFor('linux', {}, LIN), `${LIN}/.local/share/EasyKiroGauge`);
 assert.equal(defaultSourceFor('linux', { XDG_CONFIG_HOME: '/synthetic/config' }, LIN), '/synthetic/config/Kiro');
 assert.equal(defaultStorageFor('linux', { XDG_DATA_HOME: '/synthetic/data' }, LIN), '/synthetic/data/EasyKiroGauge');
 assert.equal(defaultSourceFor('win32', {}, WIN), `${WIN}\\AppData\\Roaming\\Kiro`);
 assert.equal(defaultStorageFor('win32', {}, WIN), `${WIN}\\AppData\\Local\\EasyKiroGauge`);
 assert.equal(defaultSourceFor('win32', { APPDATA: 'D:\\Synthetic\\Roaming' }, WIN), 'D:\\Synthetic\\Roaming\\Kiro');
 assert.equal(defaultStorageFor('win32', { LOCALAPPDATA: 'D:\\Synthetic\\Local' }, WIN), 'D:\\Synthetic\\Local\\EasyKiroGauge');
});

test('empty, relative and non-local environment values are ignored, never used', () => {
 for (const bad of ['', 'relative/dir', '.', '~/x', '  ']) {
  assert.equal(defaultSourceFor('linux', { XDG_CONFIG_HOME: bad }, LIN), `${LIN}/.config/Kiro`, JSON.stringify(bad));
  assert.equal(defaultStorageFor('linux', { XDG_DATA_HOME: bad }, LIN), `${LIN}/.local/share/EasyKiroGauge`);
 }
 for (const bad of ['', 'Roaming', '\\rooted-without-drive', 'C:drive-relative']) {
  assert.equal(defaultSourceFor('win32', { APPDATA: bad }, WIN), `${WIN}\\AppData\\Roaming\\Kiro`, bad);
  assert.equal(defaultStorageFor('win32', { LOCALAPPDATA: bad }, WIN), `${WIN}\\AppData\\Local\\EasyKiroGauge`, bad);
 }
 // A UNC LOCALAPPDATA is never a storage candidate; a UNC APPDATA is acceptable read-only source.
 assert.equal(defaultStorageFor('win32', { LOCALAPPDATA: '\\\\synthetic-host\\share\\Local' }, WIN), `${WIN}\\AppData\\Local\\EasyKiroGauge`);
 assert.equal(defaultSourceFor('win32', { APPDATA: '\\\\synthetic-host\\share\\Roaming' }, WIN), '\\\\synthetic-host\\share\\Roaming\\Kiro');
});

test('rootFromLogUri derives the IDE data root only from the validated log directory shape', () => {
 assert.equal(rootFromLogUri('/synthetic/data/Kiro/logs/20300101T000000/window1/exthost/synthetic.extension', 'linux'), '/synthetic/data/Kiro');
 assert.equal(rootFromLogUri('/synthetic/data/Kiro/logs/20300101T000000/window1/exthost/synthetic.extension/', 'darwin'), '/synthetic/data/Kiro');
 assert.equal(rootFromLogUri('C:\\Synthetic\\Kiro\\logs\\20300101T000000\\window1\\exthost\\synthetic.extension', 'win32'), 'C:\\Synthetic\\Kiro');
 for (const bad of ['', 'relative/logs/a/b/exthost/c', '/x/logs/a/exthost/c', '/x/notlogs/a/b/exthost/c', '/x/logs/a/b/other/c',
  '/x/logs/../b/exthost/c', '/logs/a/b/exthost/c/..', '/x/logs/a/b/exthost', '/', '/x/logs/a/b/exthost/c/d']) {
  assert.equal(rootFromLogUri(bad, 'linux'), undefined, bad);
 }
 assert.equal(rootFromLogUri('\\Synthetic\\logs\\a\\b\\exthost\\c', 'win32'), undefined);
});

test('source root resolution order is configured, then log directory, then platform default', () => {
 const base = { platform: 'linux' as const, env: {}, home: LIN };
 const logUri = '/synthetic/ide/logs/r/w/exthost/synthetic.extension';
 assert.deepEqual(resolveSourceRoot({ ...base, configured: '/synthetic/chosen', logUri }), { root: '/synthetic/chosen', method: 'configured' });
 assert.deepEqual(resolveSourceRoot({ ...base, configured: '', logUri }), { root: '/synthetic/ide', method: 'log_uri' });
 assert.deepEqual(resolveSourceRoot({ ...base, logUri: '/synthetic/ide/not-a-log-dir' }), { root: `${LIN}/.config/Kiro`, method: 'platform_default' });
 assert.deepEqual(resolveSourceRoot({ ...base }), { root: `${LIN}/.config/Kiro`, method: 'platform_default' });
});

test('path equivalence is case-insensitive only on Windows and tolerates the extended prefix there', () => {
 assert.equal(samePath('C:\\Synthetic\\Dir', 'c:\\synthetic\\DIR', 'win32'), true);
 assert.equal(samePath('\\\\?\\C:\\Synthetic\\Dir', 'C:\\Synthetic\\Dir', 'win32'), true);
 assert.equal(samePath('C:\\Synthetic\\Dir', 'C:\\Synthetic\\Other', 'win32'), false);
 assert.equal(samePath('/synthetic/Dir', '/synthetic/dir', 'linux'), false);
 assert.equal(samePath('/synthetic/Dir', '/synthetic/dir', 'darwin'), false);
 assert.equal(samePath('/synthetic/dir', '/synthetic/dir', 'darwin'), true);
});

test('Windows network paths are recognised, drive paths are not', () => {
 for (const p of ['\\\\synthetic-host\\share\\dir', '//synthetic-host/share/dir', '\\\\?\\UNC\\synthetic-host\\share']) assert.equal(isWindowsNetworkPath(p), true, p);
 for (const p of ['C:\\Synthetic', 'D:/Synthetic', '\\\\?\\C:\\Synthetic', 'relative\\dir']) assert.equal(isWindowsNetworkPath(p), false, p);
});

test('review regressions: control characters, whitespace-only settings and the extended UNC prefix', () => {
 assert.equal(rootFromLogUri('/synthetic/Kiro/logs/r/w/exthost/synthetic.extension\u0000', 'linux'), undefined);
 assert.equal(rootFromLogUri('/synthetic/Kiro/logs/r/w/exthost/synthetic.ext\nension', 'linux'), undefined);
 assert.equal(rootFromLogUri('C:\\Synthetic\\Kiro\\logs\\r\\w\\exthost\\synthetic.extension\u0007', 'win32'), undefined);
 const base = { platform: 'linux' as const, env: {}, home: '/home/synthetic-user' };
 assert.equal(resolveSourceRoot({ ...base, configured: '   ' }).method, 'platform_default');
 assert.equal(resolveSourceRoot({ ...base, configured: ' /synthetic/space-prefixed' }).method, 'platform_default');
 assert.equal(resolveSourceRoot({ ...base, configured: 'relative/dir' }).method, 'platform_default');
 assert.equal(resolveSourceRoot({ ...base, platform: 'win32', configured: 'Roaming\\Kiro', home: 'C:\\Users\\synthetic-user' }).method, 'platform_default');
 assert.equal(samePath('\\\\?\\UNC\\synthetic-host\\share\\Dir', '\\\\synthetic-host\\share\\dir', 'win32'), true);
});

test('Windows 8.3 aliases are equivalent to their long names, other differences are not', () => {
 assert.equal(samePath('C:\\Users\\synthetic-profile\\AppData\\Local\\Temp\\run', 'C:\\Users\\SYNTHE~1\\AppData\\Local\\Temp\\run', 'win32'), true);
 assert.equal(samePath('C:\\Program Files\\Synthetic', 'C:\\PROGRA~1\\Synthetic', 'win32'), true);
 assert.equal(samePath('C:\\Users\\synthetic-profile\\x', 'C:\\Users\\SYNTHE~2\\x', 'win32'), true, 'any numeric tail is a valid alias form');
 // An alias must share its prefix with the long name; unrelated names, other depths and other leaves differ.
 assert.equal(samePath('C:\\Users\\other-profile\\x', 'C:\\Users\\SYNTHE~1\\x', 'win32'), false);
 assert.equal(samePath('C:\\Users\\synthetic-profile\\x', 'C:\\Users\\SYNTHE~1\\y', 'win32'), false);
 assert.equal(samePath('C:\\Users\\synthetic-profile\\x', 'C:\\Users\\SYNTHE~1', 'win32'), false);
 assert.equal(samePath('C:\\Users\\synthetic~1\\x', 'C:\\Users\\other~1\\x', 'win32'), false);
 assert.equal(samePath('/synthetic/long-name', '/synthetic/LONG-N~1', 'linux'), false);
});

test('review regressions: device and UNC namespaces, case folding in containment', () => {
 for (const p of ['//?/UNC/synthetic-host/share/x', '\\\\.\\UNC\\synthetic-host\\share\\x', '//./UNC/synthetic-host/share/x', '\\\\.\\C:\\x', '\\\\?\\Volume{synthetic}\\x']) {
  assert.equal(isWindowsNetworkPath(p), true, p);
 }
 assert.equal(isWindowsNetworkPath('\\\\?\\C:\\Synthetic\\x'), false);
 assert.equal(inside('/Users/synthetic-user/KDATA/store', '/Users/synthetic-user/kdata', 'darwin'), true);
 assert.equal(inside('/Users/synthetic-user/KDATA/store', '/Users/synthetic-user/kdata', 'linux'), false);
 assert.equal(inside('/Users/synthetic-user/other', '/Users/synthetic-user/kdata', 'darwin'), false);
});

test('review regressions: lazy home, non-Kiro hosts, extended prefixes in containment, 8.3 punctuation', () => {
 const throwing = () => { throw new Error('SYNTHETIC_NO_HOME'); };
 assert.equal(defaultSourceFor('linux', { XDG_CONFIG_HOME: '/synthetic/cfg' }, throwing), '/synthetic/cfg/Kiro');
 assert.equal(defaultStorageFor('linux', { XDG_DATA_HOME: '/synthetic/data' }, throwing), '/synthetic/data/EasyKiroGauge');
 assert.equal(defaultSourceFor('win32', { APPDATA: 'D:\\Synthetic\\Roaming' }, throwing), 'D:\\Synthetic\\Roaming\\Kiro');
 assert.throws(() => defaultSourceFor('linux', {}, throwing), /SYNTHETIC_NO_HOME/);
 const log = '/synthetic/ide/logs/r/w/exthost/synthetic.extension';
 assert.equal(hostLogUri('Kiro', log), log);
 assert.equal(hostLogUri('kiro', log), log);
 for (const other of ['Visual Studio Code', 'Cursor', 'Code - OSS', 'Kirokiro-fork', undefined]) assert.equal(hostLogUri(other, log), undefined, String(other));
 assert.equal(inside('\\\\?\\C:\\Synthetic\\Kiro\\store', 'C:\\Synthetic\\Kiro', 'win32'), true);
 assert.equal(inside('\\\\?\\UNC\\host\\share\\Kiro\\store', '\\\\host\\share\\Kiro', 'win32'), true);
 assert.equal(samePath('C:\\Users\\ab+cdefgh\\x', 'C:\\Users\\AB_CDE~1\\x', 'win32'), true);
});
