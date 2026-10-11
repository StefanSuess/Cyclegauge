import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSourceFor, defaultStorageFor, isWindowsNetworkPath, resolveSourceRoot, rootFromLogUri, samePath } from '../../src/paths.ts';

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
 assert.equal(resolveSourceRoot({ ...base, configured: ' /synthetic/space-prefixed' }).method, 'configured');
 assert.equal(samePath('\\\\?\\UNC\\synthetic-host\\share\\Dir', '\\\\synthetic-host\\share\\dir', 'win32'), true);
});
