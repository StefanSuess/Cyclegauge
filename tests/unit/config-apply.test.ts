import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as vscode from 'vscode';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, utimes, stat } from 'node:fs/promises';
import { readFileSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfigReviewer } from '../../src/audit/config-review.ts';
import { stampKey } from '../../src/audit/config-read.ts';
import { registerConfigReview } from '../../src/extension/config-review.ts';
import { APPLY_TEXT, preparedText, skippedText, autoSaveSkippedText } from '../../src/extension/config-apply.ts';
import type { ConfigNode } from '../../src/extension/config-model.ts';

// Synthetic workspaces on disk, a minimal editor double that keeps documents in memory, and the real reviewer.
const SENTINEL = 'SYNTHETIC-INJECT-IGNORE-PREVIOUS';
const flatten = (nodes: ConfigNode[]): ConfigNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
interface Doc { languageId: string; uri: { scheme: string; fsPath: string }; text: string; isDirty: boolean; eol: number; getText(range?: { start: { offset: number }; end: { offset: number } }): string; positionAt(offset: number): { offset: number }; save(): Promise<boolean> }
async function workspace(t: { after(fn: () => unknown): void }, files: Record<string, string>) {
 const root = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-config-apply-')));
 t.after(() => rm(root, { recursive: true, force: true }));
 for (const [rel, text] of Object.entries(files)) { await mkdir(join(root, rel, '..'), { recursive: true }); await writeFile(join(root, rel), text); await utimes(join(root, rel), FIXED, FIXED); }
 return root;
}
function setup(root: string, options: { autoSave?: string } = {}) {
 const commands = new Map<string, (...a: unknown[]) => unknown>(), subscriptions: { dispose(): unknown }[] = [];
 const log = { messages: [] as string[], errors: [] as string[], opened: [] as string[], shown: [] as Doc[], edits: [] as { inserts: unknown[]; replaces: unknown[] }[], saves: 0, selections: [] as { start: number; end: number }[], reads: [] as string[] };
 const docs = new Map<string, Doc>();
 const state = { trusted: true, autoSave: options.autoSave ?? 'off', applyResult: true, applyThrows: false, failOpen: false, failShow: false, languageAutoSave: undefined as string | undefined, dirtyNext: false, onOpen: undefined as undefined | (() => void | Promise<void>) };
 class Range { start: { offset: number }; end: { offset: number }; constructor(a: { offset: number }, b: { offset: number }) { this.start = a; this.end = b; } }
 class Selection { start: { offset: number }; end: { offset: number }; constructor(a: { offset: number }, b: { offset: number }) { this.start = a; this.end = b; } }
 class WorkspaceEdit { inserts: unknown[] = []; replaces: unknown[] = []; insert(uri: unknown, position: unknown, text: string, metadata?: unknown) { this.inserts.push({ uri, position, text, metadata }); } replace(uri: unknown, range: unknown, text: string, metadata?: unknown) { this.replaces.push({ uri, range, text, metadata }); } }
 const folder = { name: 'synthetic-root', index: 0, uri: { scheme: 'file', fsPath: root } };
 const workspaceApi = {
  get isTrusted() { return state.trusted; }, workspaceFolders: [folder] as typeof folder[],
  // A per-language override only resolves when the opened document (not a Uri) is the scope, as in the editor.
  getConfiguration: (section: string, scope?: { languageId?: string }) => ({ get: (key: string) => section === 'files' && key === 'autoSave' ? (scope?.languageId !== undefined && state.languageAutoSave !== undefined ? state.languageAutoSave : state.autoSave) : undefined, inspect: () => undefined }),
  async openTextDocument(uri: { fsPath: string }): Promise<Doc> {
   log.opened.push(uri.fsPath);
   if (state.failOpen) throw new Error('synthetic-open-failure');
   await state.onOpen?.(); state.onOpen = undefined;
   const known = docs.get(uri.fsPath);
   const text = known?.isDirty ? known.text : readFileSync(uri.fsPath, 'utf8');
   const doc: Doc = known ?? { languageId: 'markdown', uri: { scheme: 'file', fsPath: uri.fsPath }, text, isDirty: false, eol: text.includes('\r\n') ? 2 : 1,
    getText(range) { return range ? this.text.slice(range.start.offset, range.end.offset) : this.text; }, async save() { log.saves++; return true; }, positionAt: offset => ({ offset: Math.max(0, Math.min(offset, doc.text.length)) }) };
   if (!doc.isDirty) doc.text = text;
   if (state.dirtyNext) { doc.isDirty = true; state.dirtyNext = false; }
   docs.set(uri.fsPath, doc); return doc;
  },
  async applyEdit(edit: WorkspaceEdit) {
   log.edits.push({ inserts: edit.inserts, replaces: edit.replaces });
   if (state.applyThrows) throw new Error('synthetic-edit-failure');
   if (!state.applyResult) return false;
   // Like the editor, every change of one edit refers to the document as it was before the edit, so they are applied from the end of the text to the start.
   const changes = [...(edit.inserts as { uri: { fsPath: string }; position: { offset: number }; text: string }[]).map(i => ({ uri: i.uri, start: i.position.offset, end: i.position.offset, text: i.text })),
    ...(edit.replaces as { uri: { fsPath: string }; range: Range; text: string }[]).map(r => ({ uri: r.uri, start: r.range.start.offset, end: r.range.end.offset, text: r.text }))].sort((a, b) => b.start - a.start);
   for (const c of changes) { const d = docs.get(c.uri.fsPath)!; d.text = d.text.slice(0, c.start) + c.text + d.text.slice(c.end); d.isDirty = true; }
   return true;
  },
 };
 const window = {
  async showInformationMessage(text: string) { log.messages.push(text); },
  async showErrorMessage(text: string) { log.errors.push(text); },
  async showTextDocument(doc: Doc) { if (state.failShow) throw new Error('synthetic-show-failure'); log.shown.push(doc); return { set selection(s: Selection) { log.selections.push({ start: s.start.offset, end: s.end.offset }); }, revealRange() {} }; },
 };
 const editor = { workspace: workspaceApi, window, Range, Selection, WorkspaceEdit, EndOfLine: { LF: 1, CRLF: 2 }, Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
  commands: { registerCommand: (id: string, fn: (...a: unknown[]) => unknown) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async () => undefined } } as unknown as typeof vscode;
 const context = { subscriptions, globalState: { get: () => true, update: async () => { throw new Error('storage touched'); } }, workspaceState: { get: () => undefined, update: async () => { throw new Error('storage touched'); } } } as unknown as vscode.ExtensionContext;
 const link = registerConfigReview(context, editor, f => ({ chosen: f.uri.fsPath, resolved: f.uri.fsPath }), () => undefined, { reviewer: createConfigReviewer(), reportError: text => { log.errors.push(text); } });
 const node = (id: string, rel?: string, hook?: number) => flatten(link.nodes()).find(n => n.finding?.id === id && (rel === undefined || n.finding.rel === rel) && (hook === undefined || n.finding.hook === hook))!;
 const act = (action: string, arg: unknown) => commands.get(`cyclegauge.config.${action}`)!(arg);
 const doc = (rel: string) => docs.get(join(root, rel))!;
 return { commands, link, log, state, workspace: workspaceApi, folder, node, act, doc, run: () => commands.get('cyclegauge.reviewKiroConfig')!(), subscriptions, docs };
}
const FIXED = 1_900_000_000; // seconds: exact in every file system, so a restored time is bit-identical
const pad = (n = 9000) => 'x'.repeat(n);
const disk = (root: string, rel: string) => readFile(join(root, rel), 'utf8');
const hooks = (...items: Record<string, unknown>[]) => JSON.stringify({ version: 'v1', hooks: items }, null, 2);
const agent = (name: string, extra: Record<string, unknown> = {}) => ({ name, trigger: 'PostFileSave', action: { type: 'agent', prompt: SENTINEL }, ...extra });
const ALLOWED = new Set<string>(Object.values(APPLY_TEXT));
const allowed = (message: string): boolean => ALLOWED.has(message) || /^Changes prepared in \d+ files? — review and save\.( (?:\d+ items skipped because they changed or are unsaved|1 item skipped because it changed or is unsaved)\.)?( \d+ items? not changed because your editor saves files automatically\. Open (?:the files? to edit (?:it|them)) yourself\.)?$/.test(message);

test('Steering without front matter: Load only when needed prepares the exact front matter as an unsaved edit and writes nothing', async t => {
 const body = 'synthetic body\n' + pad();
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': body });
 const s = setup(root), before = await stat(join(root, '.kiro/steering/synthetic-a.md'));
 await s.run();
 const node = s.node('S1');
 assert.equal(node.contextValue, 'config-steering-always'); assert.equal(node.action, undefined, 'a finding with apply actions has no read-only preview');
 await s.act('loadWhenNeeded', { ...node }); // the menu passes the tree element
 assert.equal(s.log.edits.length, 1); assert.deepEqual(s.log.messages.slice(-1), [preparedText(1)]);
 assert.equal(s.doc('.kiro/steering/synthetic-a.md').text, '---\ninclusion: manual\n---\n' + body);
 assert.equal(s.doc('.kiro/steering/synthetic-a.md').isDirty, true); assert.equal(s.log.shown.length, 1);
 assert.equal(await disk(root, '.kiro/steering/synthetic-a.md'), body, 'Cyclegauge wrote nothing');
 assert.equal((await stat(join(root, '.kiro/steering/synthetic-a.md'))).mtimeMs, before.mtimeMs);
 // The file is now an unsaved edit: a second click refuses instead of stacking edits.
 await s.act('loadWhenNeeded', node); assert.equal(s.log.edits.length, 1); assert.equal(s.log.messages.at(-1), APPLY_TEXT.unsaved);
});

test('Steering with inclusion: always or other keys, and a CRLF document', async t => {
 const root = await workspace(t, {
  '.kiro/steering/synthetic-always.md': '---\ninclusion: always\nname: synthetic\n---\n' + pad(),
  '.kiro/steering/synthetic-keys.md': '---\nname: synthetic\n---\n' + pad(),
  '.kiro/steering/synthetic-crlf.md': '---\r\ninclusion: "always"\r\n---\r\n' + pad(),
  '.kiro/steering/synthetic-plain-crlf.md': 'line one\r\nline two\r\n' + pad(),
 });
 const s = setup(root); await s.run();
 const each = (rel: string) => s.node('S1', `.kiro/steering/${rel}`);
 await s.act('loadWhenNeeded', each('synthetic-always.md')); await s.act('loadWhenNeeded', each('synthetic-keys.md'));
 await s.act('loadWhenNeeded', each('synthetic-crlf.md')); await s.act('loadWhenNeeded', each('synthetic-plain-crlf.md'));
 assert.equal(s.doc('.kiro/steering/synthetic-always.md').text, '---\ninclusion: manual\nname: synthetic\n---\n' + pad());
 assert.equal(s.doc('.kiro/steering/synthetic-keys.md').text, '---\ninclusion: manual\nname: synthetic\n---\n' + pad());
 assert.equal(s.doc('.kiro/steering/synthetic-crlf.md').text, '---\r\ninclusion: manual\r\n---\r\n' + pad());
 assert.equal(s.doc('.kiro/steering/synthetic-plain-crlf.md').text, '---\r\ninclusion: manual\r\n---\r\nline one\r\nline two\r\n' + pad(), 'a CRLF document gets CRLF line endings');
 assert.equal(s.log.edits.length, 4);
});

test('Narrow the pattern selects the fileMatchPattern value and prepares no edit', async t => {
 const text = `---\ninclusion: fileMatch\nfileMatchPattern: "**/*"\n---\n${pad()}`;
 const root = await workspace(t, { '.kiro/steering/synthetic-all.md': text });
 const s = setup(root); await s.run();
 const node = s.node('S4'); assert.equal(node.contextValue, 'config-steering-match');
 await s.act('narrowPattern', node);
 assert.equal(s.log.edits.length, 0); assert.equal(s.log.selections.length, 1);
 const [sel] = s.log.selections; assert.equal(text.slice(sel!.start, sel!.end), '"**/*"');
 assert.equal(s.log.messages.at(-1), APPLY_TEXT.selected); assert.equal(await disk(root, '.kiro/steering/synthetic-all.md'), text);
});

test('hooks: Run only manually and Disable edit only the addressed entry, with and without an existing enabled member', async t => {
 const text = hooks(agent('synthetic-one'), agent('synthetic-two', { trigger: 'PreToolUse', enabled: true, matcher: '*' }), agent('synthetic-three', { matcher: '**' }));
 const root = await workspace(t, { '.kiro/hooks/synthetic.json': text });
 const s = setup(root); await s.run();
 const h = (i: number) => s.node('H1', undefined, i) ?? s.node('H2', undefined, i);
 assert.equal(h(1).finding!.id, 'H2'); assert.equal(h(0).contextValue, 'config-hook');
 await s.act('runManually', h(0));
 const manual = s.doc('.kiro/hooks/synthetic.json'); assert.equal(manual.text, text.replace('"PostFileSave"', '"Manual"')); // first occurrence is entry 0
 manual.isDirty = false; manual.text = text; // the user reverted the edit
 await s.act('disable', h(1));
 assert.equal(manual.text, text.replace('"enabled": true', '"enabled": false'));
 manual.isDirty = false; manual.text = text;
 await s.act('disable', h(2));
 const result = JSON.parse(manual.text).hooks; assert.deepEqual(result.map((x: Record<string, unknown>) => x.enabled), [undefined, true, false]);
 assert.deepEqual({ ...result[2], enabled: undefined }, { ...agent('synthetic-three', { matcher: '**' }), enabled: undefined });
 assert.equal(await disk(root, '.kiro/hooks/synthetic.json'), text, 'Cyclegauge wrote nothing');
 assert.equal(s.log.edits.length, 3);
});

test('odd formatting falls back to opening the file with a fixed message and no edit', async t => {
 const good = hooks(agent('synthetic-one'));
 const root = await workspace(t, { '.kiro/hooks/synthetic.json': good.replace('"trigger": "PostFileSave"', '"trigger": "Stop", "trigger": "PostFileSave"') });
 const s = setup(root); await s.run();
 const node = s.node('H1'); assert.ok(node);
 await s.act('runManually', node);
 assert.equal(s.log.edits.length, 0); assert.equal(s.log.shown.length, 1); assert.equal(s.log.messages.at(-1), APPLY_TEXT.notLocated);
});

test('a file changed since the review is never edited: size, time or content', async t => {
 const rel = '.kiro/steering/synthetic-a.md', original = '---\ninclusion: always\n---\n' + pad();
 for (const change of ['size', 'content-same-size-and-time', 'time', 'removed', 'replaced by a link']) {
  const root = await workspace(t, { [rel]: original });
  const s = setup(root); await s.run(); const node = s.node('S1');
  const path = join(root, rel);
  if (change === 'size') await writeFile(path, original + 'more');
  if (change === 'content-same-size-and-time') { await writeFile(path, original.replace('always', 'ALWAYS')); await utimes(path, FIXED, FIXED); }
  if (change === 'time') await utimes(path, FIXED, FIXED + 5);
  if (change === 'removed') await rm(path);
  if (change === 'replaced by a link') { await writeFile(join(root, 'synthetic-target.md'), original); await rm(path); await symlink(join(root, 'synthetic-target.md'), path); }
  await s.act('loadWhenNeeded', node);
  assert.equal(s.log.edits.length, 0, change); assert.equal(s.log.shown.length, 0, change);
  if (change === 'removed' || change === 'replaced by a link') assert.equal(s.log.messages.at(-1), APPLY_TEXT.unsafe, change);
  else assert.equal(s.log.messages.at(-1), APPLY_TEXT.stale, change);
 }
 // The digest of a hook file covers the whole file, so a same-size, same-time change to it is caught too.
 const hookRel = '.kiro/hooks/synthetic.json', text = hooks(agent('synthetic-one'));
 const root = await workspace(t, { [hookRel]: text });
 const s = setup(root); await s.run(); const node = s.node('H1');
 await writeFile(join(root, hookRel), text.replace('synthetic-one', 'synthetic-two')); await utimes(join(root, hookRel), FIXED, FIXED);
 await s.act('disable', node); assert.equal(s.log.edits.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.stale);
});

test('a change between the first check and the editor loading the file is caught by the second check', async t => {
 const rel = '.kiro/hooks/synthetic.json', text = hooks(agent('synthetic-one'));
 const root = await workspace(t, { [rel]: text });
 const s = setup(root); await s.run(); const node = s.node('H1');
 s.state.onOpen = async () => { await writeFile(join(root, rel), text.replace('synthetic-one', 'synthetic-two')); await utimes(join(root, rel), FIXED, FIXED); };
 await s.act('runManually', node);
 assert.equal(s.log.edits.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.stale);
});

test('untrusted workspace, changed folders, dirty document and auto save all refuse without an edit', async t => {
 const rel = '.kiro/steering/synthetic-a.md';
 const root = await workspace(t, { [rel]: 'synthetic body\n' + pad() });
 let s = setup(root); await s.run(); let node = s.node('S1');
 s.state.trusted = false; const opened = s.log.opened.length;
 await s.act('loadWhenNeeded', node); await s.act('open', node);
 assert.equal(s.log.opened.length, opened, 'nothing is read or opened'); assert.equal(s.log.edits.length, 0); assert.deepEqual(s.log.messages.slice(-2), [APPLY_TEXT.untrusted, APPLY_TEXT.untrusted]);
 s = setup(root); await s.run(); node = s.node('S1');
 s.workspace.workspaceFolders = [{ ...s.folder, uri: { scheme: 'file', fsPath: join(root, 'elsewhere') } }];
 await s.act('loadWhenNeeded', node); assert.equal(s.log.opened.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.outdated);
 s = setup(root); await s.run(); node = s.node('S1'); s.state.dirtyNext = true;
 await s.act('loadWhenNeeded', node); assert.equal(s.log.edits.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.unsaved); assert.equal(s.log.shown.length, 1);
 s = setup(root, { autoSave: 'afterDelay' }); await s.run(); node = s.node('S1');
 await s.act('loadWhenNeeded', node); assert.equal(s.log.edits.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.autoSave); assert.equal(s.log.shown.length, 1, 'the file is opened for the user');
 s = setup(root, { autoSave: undefined as unknown as string }); s.state.autoSave = undefined as unknown as string; await s.run(); node = s.node('S1');
 await s.act('loadWhenNeeded', node); assert.equal(s.log.edits.length, 0, 'an unknown auto save value counts as on');
});

test('AGENTS.md only opens the file; there is no inclusion edit for it', async t => {
 const root = await workspace(t, { 'AGENTS.md': pad(30000) });
 const s = setup(root); await s.run(); const node = s.node('S2');
 assert.equal(node.contextValue, 'config-agents'); assert.equal(node.action, undefined);
 await s.act('loadWhenNeeded', node); await s.act('runManually', node); await s.act('disable', node); await s.act('narrowPattern', node);
 assert.equal(s.log.opened.length, 0, 'actions that do not belong to the finding do nothing');
 await s.act('open', node);
 assert.deepEqual([s.log.opened, s.log.edits.length, s.log.shown.length], [[join(root, 'AGENTS.md')], 0, 1]);
 assert.equal(s.log.messages.length, 0);
});

test('findings without an apply action keep the read-only suggestion; forged or stale arguments do nothing', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': 'b\n' + pad(20000), '.kiro/steering/synthetic-b.md': 'b\n' + pad(20000), '.kiro/hooks/synthetic.json': hooks(agent('synthetic-one'), agent('synthetic-two')) });
 const s = setup(root); await s.run();
 const s3 = s.node('S3'), h5 = s.node('H5');
 for (const n of [s3, h5]) { assert.equal(n.contextValue, 'config-finding'); assert.equal(n.action, 'previewKiroConfig'); }
 for (const action of ['loadWhenNeeded', 'narrowPattern', 'runManually', 'disable', 'open']) { await s.act(action, s3); await s.act(action, h5); }
 for (const forged of [undefined, null, 5, {}, { id: 'config:f:0:0' }, 'config:f:0:0', { id: { toString: () => 'x' } }]) for (const action of ['loadWhenNeeded', 'runManually', 'open']) await s.act(action, forged);
 await s.act('runManually', s.node('S1')); await s.act('loadWhenNeeded', s.node('H1'));
 assert.deepEqual([s.log.opened.length, s.log.edits.length, s.log.messages.length], [0, 0, 0]);
 const old = s.node('H1'); await s.run(); await s.act('disable', old);
 assert.deepEqual([s.log.opened.length, s.log.edits.length], [0, 0], 'a node from before the last review is stale');
 await s.act('disable', s.node('H1')); assert.equal(s.log.edits.length, 1);
});

test('expected refusals (rejected edit, document that cannot be opened) show fixed text without the Report a problem button; unexpected failures use it', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': 'synthetic body\n' + pad() });
 let s = setup(root); await s.run(); s.state.applyResult = false;
 await s.act('loadWhenNeeded', s.node('S1'));
 assert.deepEqual(s.log.errors, [], 'discarding the preview is not an error'); assert.equal(s.log.messages.at(-1), APPLY_TEXT.discarded); assert.equal(s.log.shown.length, 0); assert.equal(s.doc('.kiro/steering/synthetic-a.md').isDirty, false);
 s = setup(root); await s.run(); s.state.applyThrows = true;
 await s.act('loadWhenNeeded', s.node('S1')); assert.deepEqual(s.log.errors, []); assert.equal(s.log.messages.at(-1), APPLY_TEXT.rejected);
 s = setup(root); await s.run(); s.state.failOpen = true;
 for (const action of ['loadWhenNeeded', 'open']) await s.act(action, s.node('S1'));
 assert.deepEqual(s.log.errors, []); assert.deepEqual(s.log.messages, [APPLY_TEXT.notOpened, APPLY_TEXT.notOpened]); assert.equal(s.log.edits.length, 0);
 s = setup(root); await s.run(); s.state.failShow = true;
 await s.act('loadWhenNeeded', s.node('S1'));
 assert.deepEqual(s.log.errors, [APPLY_TEXT.failed], 'a genuinely unexpected failure is reported with fixed text only');
});

test('auto save is read with the opened document as scope, so a per-language override counts', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': 'synthetic body\n' + pad() });
 const s = setup(root); await s.run(); s.state.autoSave = 'off'; s.state.languageAutoSave = 'afterDelay';
 await s.act('loadWhenNeeded', s.node('S1'));
 assert.equal(s.log.edits.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.autoSave); assert.equal(s.log.shown.length, 1);
 const source = await readFile(new URL('../../src/extension/config-apply.ts', import.meta.url), 'utf8');
 assert.match(source, /getConfiguration\('files', document\)/);
});

test('a hard-linked file is never edited (it may point outside the folder) but can still be opened', async t => {
 const rel = '.kiro/steering/synthetic-a.md';
 const root = await workspace(t, { [rel]: 'synthetic body\n' + pad() });
 try { linkSync(join(root, rel), join(root, 'synthetic-other-name.md')); } catch { t.skip('hard links are not supported here'); return; }
 const s = setup(root); await s.run(); const node = s.node('S1');
 await s.act('loadWhenNeeded', node);
 assert.equal(s.log.edits.length, 0); assert.equal(s.log.opened.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.unsafe);
 await s.act('open', node); assert.equal(s.log.opened.length, 1);
});

test('hostile file text reaches no message, selection or document title; every message is fixed text', async t => {
 const name = 'synthetic-‮' + SENTINEL;
 const root = await workspace(t, {
  '.kiro/steering/synthetic-a.md': `---\ninclusion: fileMatch\nfileMatchPattern: "**"\nname: ${SENTINEL}\n---\n${SENTINEL}${pad()}`,
  '.kiro/steering/synthetic-b.md': `${SENTINEL}\n${pad()}`,
  '.kiro/hooks/synthetic.json': hooks(agent(name, { matcher: '*' })),
 });
 const s = setup(root); await s.run();
 for (const [action, id] of [['narrowPattern', 'S4'], ['loadWhenNeeded', 'S1'], ['runManually', 'H1'], ['disable', 'H1'], ['open', 'S4']] as const) await s.act(action, s.node(id));
 for (const message of [...s.log.messages, ...s.log.errors]) { assert.ok(allowed(message), message); assert.ok(!message.includes(SENTINEL)); }
 assert.ok(s.log.messages.length >= 4);
});

test('the review keeps only a size, time and digest per read file, and no text', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': SENTINEL + pad(), '.kiro/hooks/synthetic.json': hooks(agent(SENTINEL)) });
 const review = await createConfigReviewer().review([root]);
 const keys = [...review.stamps!.keys()].sort();
 assert.deepEqual(keys, [stampKey(0, '.kiro/hooks/synthetic.json'), stampKey(0, '.kiro/steering/synthetic-a.md')].sort());
 for (const stamp of review.stamps!.values()) { assert.match(stamp.digest, /^[0-9a-f]{64}$/); assert.equal(typeof stamp.size, 'number'); assert.ok(!JSON.stringify(stamp).includes(SENTINEL)); }
 assert.ok(!JSON.stringify([...review.stamps!.values()]).includes('synthetic'), 'not even a file name is in a stamp');
});

test('manifest: the apply commands are contributed, hidden from the palette and shown on the matching group and item kinds only', async () => {
 const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
 const commands = new Map<string, { title: string; icon: string }>(manifest.contributes.commands.map((c: { command: string; title: string; icon: string }) => [c.command, c]));
 const expected: Record<string, string> = { loadWhenNeeded: 'Review changes…', loadWhenNeededAll: 'Review changes…', narrowPattern: 'Narrow the pattern', runManually: 'Review changes…', runManuallyAll: 'Review changes…', disable: 'Disable', open: 'Show file', preview: 'Show suggestion' };
 for (const [id, title] of Object.entries(expected)) { const c = commands.get(`cyclegauge.config.${id}`)!; assert.equal(c.title, title); assert.match(c.icon, /^\$\([a-z-]+\)$/); }
 for (const id of ['loadWhenNeeded', 'loadWhenNeededAll', 'runManually', 'runManuallyAll']) assert.equal(commands.get(`cyclegauge.config.${id}`)!.icon, '$(check)');
 const hidden = manifest.contributes.menus.commandPalette.filter((c: { when: string }) => c.when === 'false').map((c: { command: string }) => c.command);
 for (const id of Object.keys(expected)) assert.ok(hidden.includes(`cyclegauge.config.${id}`), id);
 const items = manifest.contributes.menus['view/item/context'] as { command: string; when: string; group: string }[];
 const on = (id: string) => items.filter(i => i.command === `cyclegauge.config.${id}`);
 const values = (id: string) => new Set(on(id).map(i => /viewItem (?:==|=~) (\S+)/.exec(i.when)![1]));
 assert.deepEqual([...values('loadWhenNeeded')], ['config-steering-always']); assert.deepEqual([...values('loadWhenNeededAll')], ['config-group-load']);
 assert.deepEqual([...values('narrowPattern')], ['config-steering-match']); assert.deepEqual([...values('runManually')], ['config-hook']); assert.deepEqual([...values('runManuallyAll')], ['config-group-run']);
 assert.deepEqual([...values('disable')], ['config-hook']); assert.deepEqual([...values('preview')], ['config-finding']);
 assert.deepEqual([...values('open')].sort(), ['config-agents', 'config-hook', 'config-steering-always', 'config-steering-match']);
 for (const i of items.filter(x => x.command.startsWith('cyclegauge.config.'))) assert.match(i.when, /^view == cyclegauge\.auditView && viewItem /);
 assert.ok(items.filter(i => i.group.startsWith('inline')).every(i => /^inline@\d$/.test(i.group)));
 // Group and item buttons do the group's verb; Disable is only the alternative in the item's context menu.
 for (const id of ['loadWhenNeeded', 'loadWhenNeededAll', 'narrowPattern', 'runManually', 'runManuallyAll']) assert.ok(on(id).some(i => i.group.startsWith('inline')), `${id} has an inline button`);
 assert.ok(on('disable').every(i => !i.group.startsWith('inline')), 'Disable is in the context menu only');
 assert.ok(on('open').some(i => i.group.startsWith('inline') && i.when.endsWith('viewItem == config-agents')));
 assert.ok(on('loadWhenNeededAll').some(i => !i.group.startsWith('inline')) && on('runManuallyAll').some(i => !i.group.startsWith('inline')), 'the group verb is in the context menu too');
 // The audit menu entries: the Exclude group (button, context menu, copy) and the three item buttons.
 assert.deepEqual(items.filter(i => i.command.startsWith('cyclegauge.audit.')).map(i => i.command), ['cyclegauge.audit.acceptAll', 'cyclegauge.audit.acceptAll', 'cyclegauge.audit.copy', 'cyclegauge.audit.accept', 'cyclegauge.audit.dismiss', 'cyclegauge.audit.reveal']);
});

test('static: the apply modules only read the file system and never write, log or build dynamic expressions', async () => {
 for (const name of ['src/extension/config-apply.ts', 'src/audit/config-edit.ts']) {
  const code = await readFile(new URL(`../../${name}`, import.meta.url), 'utf8');
  assert.doesNotMatch(code, /RegExp\s*\(|new RegExp|console\.|(?:^|[}\s])catch\s*\(/, name);
  assert.doesNotMatch(code, /writeFile|appendFile|createWriteStream|copyFile|\brename|unlink|truncate|mkdir|chmod|utimes|\.write\(|\brm\(|writeSync/, name);
  assert.doesNotMatch(code, /globalState|workspaceState|clipboard|\.update\(/, name);
  for (const [, names] of code.matchAll(/import \{([^}]*)\} from 'node:fs(?:\/promises)?'/g)) assert.ok(names!.split(',').every(n => ['lstatSync', 'realpathSync'].includes(n.trim())), `${name}: ${names}`);
 }
 const apply = await readFile(new URL('../../src/extension/config-apply.ts', import.meta.url), 'utf8');
 assert.equal((apply.match(/applyEdit\(/g) ?? []).length, 1); assert.equal((apply.match(/new editor\.WorkspaceEdit/g) ?? []).length, 1);
 // The edit is prepared only after the stamp checks, the auto-save check and the dirty check.
 const order = ['sameStamp(request.stamp, first.stamp)', 'document.isDirty', "'autoSave'", 'planSteeringEdit(first.bytes', 'await fresh()', 'planned.verify', 'applyEdit('].map(x => apply.indexOf(x));
 assert.ok(order.every(i => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]!), JSON.stringify(order));
});

// ---- Review changes…: one annotated edit for an item or a whole group
const groupNode = (s: ReturnType<typeof setup>, contextValue: string) => flatten(s.link.nodes()).find(n => n.contextValue === contextValue)!;
const metadataOf = (edit: { inserts: unknown[]; replaces: unknown[] }) => [...edit.inserts, ...edit.replaces].map(e => (e as { metadata: { label: string; description: string; needsConfirmation: boolean } }).metadata);

test('one item: the edit carries an annotation that needs confirmation, with the label, the why and the alternatives; nothing is saved', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': 'synthetic body\n' + pad(33280) });
 const s = setup(root); await s.run();
 await s.act('loadWhenNeeded', s.node('S1'));
 assert.equal(s.log.edits.length, 1);
 const [meta] = metadataOf(s.log.edits[0]!);
 assert.equal(meta!.needsConfirmation, true); assert.equal(meta!.label, 'Load only when needed');
 assert.equal(meta!.description, 'Always-included Steering is added to every request (32.5 KiB). With inclusion: manual Kiro loads it only when you reference it with #. Alternatives: fileMatch for specific files, or split the file.');
 assert.equal(s.log.saves, 0); assert.ok(!JSON.stringify(metadataOf(s.log.edits[0]!)).includes(root), 'no path in the annotation');
 assert.deepEqual(s.log.messages, [preparedText(1)]);
 // Disable is the hook's alternative and goes through the same preview.
 const hookRoot = await workspace(t, { '.kiro/hooks/synthetic.json': hooks(agent('synthetic-one')) });
 const h = setup(hookRoot); await h.run();
 await h.act('disable', h.node('H1'));
 assert.deepEqual(metadataOf(h.log.edits[0]!).map(m => [m.label, m.needsConfirmation]), [['Disable hook', true]]);
 await h.act('runManually', h.node('H1')); // already an unsaved edit: refused, no second edit
 assert.equal(h.log.edits.length, 1);
});

test('a whole group: ONE edit with an annotated change per item across files, one notice with the counts, and no tab opened', async t => {
 const root = await workspace(t, {
  '.kiro/steering/synthetic-a.md': 'a\n' + pad(12000), '.kiro/steering/synthetic-b.md': 'b\n' + pad(30000), '.kiro/steering/synthetic-c.md': '---\ninclusion: always\n---\n' + pad(9000),
  '.kiro/hooks/synthetic.json': hooks(agent('synthetic-one'), agent('synthetic-two', { trigger: 'PreToolUse', matcher: '*' })),
 });
 const s = setup(root); await s.run();
 const load = groupNode(s, 'config-group-load');
 const sizes = load.children!.slice(1).map(n => n.finding!.size!);
 assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), 'sorted by size, largest first'); assert.equal(sizes.length, 3);
 await s.commands.get('cyclegauge.config.loadWhenNeededAll')!({ ...load }); // the menu passes the tree element
 assert.equal(s.log.edits.length, 1, 'one WorkspaceEdit');
 const metadata = metadataOf(s.log.edits[0]!);
 assert.equal(metadata.length, 3); assert.ok(metadata.every(m => m.needsConfirmation === true && m.label === 'Load only when needed' && m.description.length > 40));
 assert.deepEqual(s.log.messages, [preparedText(3)]); assert.equal(s.log.shown.length, 0); assert.equal(s.log.saves, 0);
 for (const rel of ['a', 'b', 'c']) assert.equal(s.doc(`.kiro/steering/synthetic-${rel}.md`).isDirty, true);
 for (const rel of ['a', 'b']) assert.ok(s.doc(`.kiro/steering/synthetic-${rel}.md`).text.startsWith('---\ninclusion: manual\n---\n'));
 // Two hooks of one file: two changes in one file.
 const run = groupNode(s, 'config-group-run');
 await s.commands.get('cyclegauge.config.runManuallyAll')!(run.id);
 assert.equal(s.log.edits.length, 2); assert.equal(metadataOf(s.log.edits[1]!).length, 2);
 assert.deepEqual(metadataOf(s.log.edits[1]!).map(m => m.label), ['Run only manually', 'Run only manually']);
 assert.equal(s.log.messages.at(-1), preparedText(1));
 assert.deepEqual(JSON.parse(s.doc('.kiro/hooks/synthetic.json').text).hooks.map((h: { trigger: string }) => h.trigger), ['Manual', 'Manual']);
 assert.equal(await disk(root, '.kiro/hooks/synthetic.json'), hooks(agent('synthetic-one'), agent('synthetic-two', { trigger: 'PreToolUse', matcher: '*' })), 'Cyclegauge wrote nothing');
});

test('a group skips and counts the items whose guard fails and applies the rest; skipped files are not opened', async t => {
 const files = { '.kiro/steering/synthetic-a.md': 'a\n' + pad(12000), '.kiro/steering/synthetic-b.md': 'b\n' + pad(30000), '.kiro/steering/synthetic-c.md': 'c\n' + pad(9000) };
 const root = await workspace(t, files);
 const s = setup(root); await s.run(); const load = groupNode(s, 'config-group-load');
 await writeFile(join(root, '.kiro/steering/synthetic-b.md'), 'changed\n' + pad(30000)); // changed since the review
 await s.commands.get('cyclegauge.config.loadWhenNeededAll')!(load);
 assert.equal(s.log.edits.length, 1); assert.equal(metadataOf(s.log.edits[0]!).length, 2);
 assert.deepEqual(s.log.messages, [`${preparedText(2)} ${skippedText(1)}`]); assert.equal(s.log.shown.length, 0); assert.equal(s.log.saves, 0);
 assert.equal(s.doc('.kiro/steering/synthetic-b.md'), undefined, 'the changed file is never opened by the group');
 // A document with unsaved changes is skipped too.
 const again = setup(root, {}); await again.run(); const group = groupNode(again, 'config-group-load'); again.state.dirtyNext = true;
 await again.commands.get('cyclegauge.config.loadWhenNeededAll')!(group);
 assert.equal(again.log.messages.at(-1), `${preparedText(2)} ${skippedText(1)}`); assert.ok(allowed(again.log.messages.at(-1)!)); assert.equal(again.log.saves, 0);
 // When nothing can be prepared, only the fixed skipped text is shown.
 const none = setup(root); await none.run(); const all = groupNode(none, 'config-group-load');
 for (const rel of Object.keys(files)) await writeFile(join(root, rel), 'changed again\n' + pad(9000));
 await none.commands.get('cyclegauge.config.loadWhenNeededAll')!(all);
 assert.equal(none.log.edits.length, 0); assert.deepEqual(none.log.messages, [skippedText(3)]); assert.equal(none.log.shown.length, 0);
});

test('a group with auto save on prepares nothing, opens nothing and says why with a count', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': 'a\n' + pad(12000), '.kiro/steering/synthetic-b.md': 'b\n' + pad(30000) });
 const s = setup(root, { autoSave: 'afterDelay' }); await s.run();
 await s.commands.get('cyclegauge.config.loadWhenNeededAll')!(groupNode(s, 'config-group-load'));
 assert.equal(s.log.edits.length, 0); assert.equal(s.log.shown.length, 0); assert.deepEqual(s.log.messages, [autoSaveSkippedText(2)]);
 // Auto save is checked per document: with a per-language override the files are skipped as well.
 const lang = setup(root); await lang.run(); lang.state.languageAutoSave = 'afterDelay';
 await lang.commands.get('cyclegauge.config.loadWhenNeededAll')!(groupNode(lang, 'config-group-load'));
 assert.equal(lang.log.edits.length, 0);
});

test('a group edit that the user discards (or unchecks entirely) leaves every file untouched and says nothing alarming', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': 'a\n' + pad(12000), '.kiro/steering/synthetic-b.md': 'b\n' + pad(30000) });
 const s = setup(root); await s.run(); s.state.applyResult = false;
 await s.commands.get('cyclegauge.config.loadWhenNeededAll')!(groupNode(s, 'config-group-load'));
 assert.deepEqual(s.log.messages, [APPLY_TEXT.discarded]); assert.deepEqual(s.log.errors, []);
 for (const rel of ['a', 'b']) assert.equal(s.doc(`.kiro/steering/synthetic-${rel}.md`).isDirty, false);
});

test('group commands trust nothing the argument carries: forged, stale, wrong-kind or untrusted calls change nothing', async t => {
 const root = await workspace(t, { '.kiro/steering/synthetic-a.md': 'a\n' + pad(12000), '.kiro/hooks/synthetic.json': hooks(agent('synthetic-one')) });
 const s = setup(root); await s.run();
 const load = s.commands.get('cyclegauge.config.loadWhenNeededAll')!, run = s.commands.get('cyclegauge.config.runManuallyAll')!;
 for (const forged of [undefined, null, 5, {}, { id: 'config:g:load:0' }, 'config:g:load:0', { id: { toString: () => 'x' } }]) { await load(forged); await run(forged); }
 await load(groupNode(s, 'config-group-run')); await run(groupNode(s, 'config-group-load')); await load(s.node('S1')); // the wrong group or an item
 assert.deepEqual([s.log.opened.length, s.log.edits.length, s.log.messages.length], [0, 0, 0]);
 const old = groupNode(s, 'config-group-load'); await s.run(); await load(old);
 assert.deepEqual([s.log.opened.length, s.log.edits.length], [0, 0], 'a group from before the last review is stale');
 s.state.trusted = false; await load(groupNode(s, 'config-group-load'));
 assert.deepEqual([s.log.opened.length, s.log.edits.length, s.log.messages.at(-1)], [0, 0, APPLY_TEXT.untrusted]);
 s.state.trusted = true; s.workspace.workspaceFolders = [{ ...s.folder, uri: { scheme: 'file', fsPath: join(root, 'elsewhere') } }];
 await load(groupNode(s, 'config-group-load')); assert.equal(s.log.edits.length, 0); assert.equal(s.log.messages.at(-1), APPLY_TEXT.outdated);
});
