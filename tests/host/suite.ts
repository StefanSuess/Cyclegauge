import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.CYCLEGAUGE_SYNTHETIC_TEST_ROOT!;
const source = join(base, 'synthetic source ü');
// No storage setting: the store must appear in the editor's own per-extension storage folder.
const globalStorage = join(base, 'profile', 'User', 'globalStorage');
const owned = () => join(globalStorage, readdirSync(globalStorage).find(name => name.toLowerCase() === 'stefansuess.cyclegauge')!);
const log = join(source, 'logs', 'synthetic-run', 'synthetic-window', 'exthost', 'kiro.kiroAgent', 'q-client.log');
function state() {
 const db = new DatabaseSync(join(owned(), 'usage.sqlite'), { readOnly: true });
 try {
  return {
   rows: db.prepare('SELECT body FROM snapshots ORDER BY observed').all().map(r => JSON.parse(r.body as string)),
   imports: (db.prepare('SELECT COUNT(*) AS n FROM imports').get() as { n: number }).n,
  };
 } finally { db.close(); }
}
async function until(check: () => boolean, milliseconds: number): Promise<void> {
 const deadline = Date.now() + milliseconds;
 while (!check()) {
  if (Date.now() >= deadline) throw new Error('SYNTHETIC_HOST_TIMEOUT');
  await new Promise(resolve => setTimeout(resolve, 100));
 }
}
export async function run(): Promise<void> {
 let phase = 'activation';
 const metadata = { platform: process.platform, arch: process.arch, vscode: vscode.version, node: process.versions.node, electron: process.versions.electron };
 const report = (ok: boolean) => writeFileSync(join(base, 'report.json'), JSON.stringify({ ok, phase, ...metadata }));
 try {
  const before = readFileSync(log), modified = statSync(log).mtimeMs;
  const extension = vscode.extensions.getExtension('StefanSuess.cyclegauge');
  assert.ok(extension); await extension.activate(); assert.ok(extension.isActive);
  phase = 'log-layout';
  // The collector's default discovery assumes this editor layout beneath the user-data root.
  const sessions = readdirSync(join(base, 'profile', 'logs')).filter(name => /^\d{8}T\d{6}$/.test(name));
  assert.ok(sessions.length > 0);
  assert.ok(sessions.some(name => statSync(join(base, 'profile', 'logs', name, 'window1', 'exthost')).isDirectory()));
  phase = 'commands';
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('cyclegauge.showUsage')); assert.ok(commands.includes('cyclegauge.costAdvisor'));
  phase = 'panel';
  await vscode.commands.executeCommand('cyclegauge.showUsage');
  await until(() => vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.label === 'Your credit budget')), 5_000);
  phase = 'sqlite';
  const restart = process.env.CYCLEGAUGE_SYNTHETIC_RESTART === '1';
  assert.equal(state().rows.length, restart ? 2 : 1);
  assert.equal(state().rows[0].usage, '1.25');
  assert.deepEqual(readFileSync(log), before); assert.equal(statSync(log).mtimeMs, modified);
  if (!restart) {
   phase = 'watcher';
   // An external source (outside the open workspace) must refresh before the 60s timer.
   // A missing watcher cannot silently pass because polling eventually imported the record.
   await new Promise(resolve => setTimeout(resolve, 2_000));
   appendFileSync(log, before.toString().replace('00:00:00', '00:01:00').replace('1.25', '2.25'));
   await until(() => state().rows.length === 2, 20_000);
   assert.equal(state().rows[1].usage, '2.25');
   phase = 'polling-timer';
   const imports = state().imports;
   // No further filesystem changes: the real minute timer must perform another import.
   await until(() => state().imports > imports, 75_000);
   phase = 'polling-deduplication';
   assert.equal(state().rows.length, 2);
  } else {
   phase = 'restart'; assert.equal(state().rows[1].usage, '2.25');
  }
  phase = 'privacy';
  assert.deepEqual(readdirSync(join(log, '..')), ['q-client.log']);
  assert.deepEqual(readdirSync(owned()).filter(name => !name.startsWith('usage.sqlite')), ['device.key']);
  for (const name of readdirSync(owned())) {
   const bytes = readFileSync(join(owned(), name));
   for (const marker of ['synthetic-host-account', 'SYNTHETIC_CONTENT_SENTINEL', source]) assert.ok(!bytes.includes(marker));
  }
  phase = 'complete'; report(true);
 } catch { report(false); throw new Error('SYNTHETIC_HOST_TEST_FAILED'); }
}
