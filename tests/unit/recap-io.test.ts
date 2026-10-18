import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { CARD_HEIGHT, CARD_WIDTH, encodePng } from '../../src/extension/recap-card.ts';
import { CSV_FILE, PNG_FILE, exportCsv, saveRecapImage, type SaveDeps } from '../../src/extension/recap-io.ts';
import { syntheticSnapshot as snapshot } from './synthetic.ts';

const png = async () => Buffer.from(await encodePng(new Uint8Array(CARD_WIDTH * CARD_HEIGHT * 4).fill(7), async raw => new Uint8Array(deflateSync(raw))));
function fixture() {
 const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'synthetic-recap-io-')));
 mkdirSync(join(root, 'out')); mkdirSync(join(root, 'kiro-data')); mkdirSync(join(root, 'Downloads'));
 const dialogs: { path: string; filter: { name: string; extension: string } }[] = []; let protectedReads = 0;
 let answer: { scheme: string; fsPath: string } | undefined;
 const deps: SaveDeps = { async dialog(path, filter) { dialogs.push({ path, filter }); return answer; }, protectedPaths: () => { protectedReads++; return [join(root, 'kiro-data')]; }, folder: () => join(root, 'Downloads') };
 return { root, deps, dialogs, reads: () => protectedReads, answer: (a: typeof answer) => { answer = a; }, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('the image is validated before any dialog, then saved atomically through the chosen file target', async () => {
 const f = fixture();
 try {
  const good = (await png()).toString('base64');
  for (const bad of ['', 'AAAA', 5, null, undefined, good.slice(4), good + 'AA']) assert.equal(await saveRecapImage(f.deps, bad), 'invalid_image');
  assert.equal(f.dialogs.length, 0, 'an invalid image never asks for a location');
  f.answer(undefined); assert.equal(await saveRecapImage(f.deps, good), 'cancelled');
  assert.deepEqual(f.dialogs[0], { path: join(f.root, 'Downloads', PNG_FILE), filter: { name: 'PNG image', extension: 'png' } });
  f.answer({ scheme: 'file', fsPath: join(f.root, 'out', 'card.png') });
  assert.equal(await saveRecapImage(f.deps, good), 'saved');
  assert.deepEqual(readFileSync(join(f.root, 'out', 'card.png')), await png());
  assert.deepEqual(readdirSync(join(f.root, 'out')), ['card.png']);
 } finally { f.done(); }
});

test('non-file schemes, protected folders and missing folders are refused with one fixed code and nothing is written', async () => {
 const f = fixture();
 try {
  const good = (await png()).toString('base64');
  for (const answer of [{ scheme: 'vscode-vfs', fsPath: join(f.root, 'out', 'a.png') }, { scheme: 'untitled', fsPath: join(f.root, 'out', 'a.png') }, { scheme: 'file', fsPath: join(f.root, 'kiro-data', 'a.png') }, { scheme: 'file', fsPath: join(f.root, 'missing', 'a.png') }, { scheme: 'file', fsPath: 'relative.png' }, { scheme: 'file', fsPath: undefined as never }]) {
   f.answer(answer); assert.equal(await saveRecapImage(f.deps, good), 'refused_target', JSON.stringify(answer));
  }
  assert.deepEqual(readdirSync(join(f.root, 'out')), []); assert.deepEqual(readdirSync(join(f.root, 'kiro-data')), []);
  assert.ok(f.reads() >= 2, 'the protected folders are read at each save');
 } finally { f.done(); }
});

test('CSV export refuses without a dialog when there is nothing to export and writes the exact CSV otherwise', async () => {
 const f = fixture();
 try {
  assert.equal(await exportCsv(f.deps, []), 'no_history');
  assert.equal(await exportCsv(f.deps, [snapshot('2030-06-01T00:00:00.000Z', '1'), snapshot('2030-06-02T00:00:00.000Z', '2', { partition: 'synthetic-other-account' })]), 'multiple_accounts');
  assert.equal(f.dialogs.length, 0);
  f.answer({ scheme: 'file', fsPath: join(f.root, 'out', 'history.csv') });
  assert.equal(await exportCsv(f.deps, [snapshot('2030-06-01T00:00:00.000Z', '1.5')]), 'saved');
  assert.equal(f.dialogs[0]!.path, join(f.root, 'Downloads', CSV_FILE)); assert.deepEqual(f.dialogs[0]!.filter, { name: 'CSV file', extension: 'csv' });
  assert.equal(readFileSync(join(f.root, 'out', 'history.csv'), 'utf8'), 'observed_at_source,observed_at_utc,credits_used,credit_limit,reset_at_utc,flags,conflict\r\n2030-06-01T00:00:00.000Z,2030-06-01T00:00:00.000Z,1.5,1000,2030-07-01T00:00:00.000Z,none,no\r\n');
 } finally { f.done(); }
});
