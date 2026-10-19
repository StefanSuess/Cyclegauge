import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configTree, configPreview, configActions, configAnnotation, configSummary, reviewTree, CONFIG_BASIS, CONFIG_CREDITS, CONFIG_EXCLUSIONS, type ConfigNode } from '../../src/extension/config-model.ts';
import { auditTree, dismissHash, NOTHING_CHANGES, PREPARED_DESCRIPTION } from '../../src/extension/audit-model.ts';
import type { AuditResult } from '../../src/audit/audit.ts';
import { evaluateConfigRules, type FindingId } from '../../src/audit/config-rules.ts';
import type { ConfigReview } from '../../src/audit/config-review.ts';

const name = 'synthetic-\u202E' + '😀'.repeat(65) + 'SYNTHETIC-NAME-TAIL';
function review(): ConfigReview {
 const roots = [{ root: 0, steering: [{ rel: '.kiro/steering/synthetic-architecture.md', mode: 'always' as const, size: 26000, matchAll: false as const, patternCount: 0 }], agents: {size: 9000}, nestedNotChecked: 0,
  hooks: [0,1].map(index => ({ rel: '.kiro/hooks/synthetic-hooks.json', index, name: index ? 'synthetic-second-name' : name, trigger: 'PostFileSave' as const, action: 'agent' as const, matcher: 'none' as const, enabled: true as const, promptBytes: 2100, commandBytes: 0 })) }];
 return {...evaluateConfigRules(roots), roots, status: 'complete', bytesRead: 0};
}
const flatten = (nodes: ConfigNode[]): ConfigNode[] => nodes.flatMap(n => [n, ...flatten(n.children ?? [])]);
test('native tree has fixed groups, opaque ids and precise basis/credit text; names appear only in sidebar labels', () => {
 const r = review(), nodes = flatten(configTree(r, ['synthetic-root\u202E']));
 for (const label of ['Load only when needed (1)', 'Run only manually (4)', 'Worth a look (3)']) assert.ok(nodes.some(n => n.label === label), label);
 const named = nodes.filter(n => n.label.includes('synthetic-\\u{202E}'));
 assert.ok(named.length > 0);
 const suffix = 'synthetic-\\u{202E}' + '😀'.repeat(49); // 10 prefix code points, bidi, then 49 emoji = 60
 assert.ok(named.some(n => n.label.endsWith(suffix)));
 for (const n of nodes) {
  assert.ok(!n.id.includes('synthetic')); assert.ok(!n.id.includes('/'));
  assert.ok(!n.tooltip?.includes('synthetic-second-name')); assert.ok(!n.tooltip?.includes('😀'));
  assert.ok(!n.description?.includes('😀')); assert.ok(!JSON.stringify(n).includes('SYNTHETIC-NAME-TAIL'));
  if (n.finding) {
   assert.ok(CONFIG_BASIS.some(text => n.tooltip?.includes(text)));
   assert.ok(CONFIG_CREDITS.some(text => n.tooltip?.includes(text)));
   assert.match(n.tooltip!, /Being listed does not mean the setting is wrong/);
  }
 }
 assert.match(JSON.stringify(nodes), /synthetic-root\\\\u\{202E\}/);
});
test('only findings without an apply action keep a read-only suggestion; it holds fixed relative filenames and ordinals only', () => {
 const r=review();
 const s3=r.findings.find(f=>f.id==='S3')!, h5=r.findings.find(f=>f.id==='H5')!;
 for (const f of r.findings) {
  const p=configPreview(r,f);
  assert.equal(p===undefined, configActions(f).length>0, f.id);
  if (!p) continue;
  assert.ok(!p.includes('synthetic-second-name')); assert.ok(!p.includes('😀')); assert.ok(!p.includes('synthetic-root'));
  assert.ok(!/\d+\s+credits?/.test(p));
 }
 assert.match(configPreview(r,s3)!, /Review the listed Steering contributors individually/);
 assert.match(configPreview(r,h5)!, /hook 2 of 2/);
 assert.equal(configPreview(r,{...s3,rel:'.kiro/steering/synthetic-\u202E.md'}),configPreview(r,s3),'S3 lists its contributors, not its own location');
 const unsafe={...r,alwaysIncluded:{...r.alwaysIncluded,contributors:[{root:0,rel:'../../synthetic.md',size:40000}]}};
 assert.equal(configPreview(unsafe,s3),undefined);
});
test('apply actions per finding kind, their context values and the closed tree wiring', () => {
 assert.deepEqual(['S1','S2','S3','S4','H1','H2','H3','H4','H5'].map(id=>configActions({id} as {id:FindingId})),[
  ['loadWhenNeeded','open'],['open'],[],['narrowPattern','open'],
  ['runManually','disable','open'],['runManually','disable','open'],['runManually','disable','open'],['runManually','disable','open'],[]]);
 assert.deepEqual(configActions({id:'X9'} as unknown as {id:FindingId}),[]);
 const r=review(), ns=flatten(configTree(r,['synthetic-root'])).filter(n=>n.finding);
 const context=(id:string)=>ns.find(n=>n.finding!.id===id)!;
 assert.equal(context('S1').contextValue,'config-steering-always'); assert.equal(context('S2').contextValue,'config-agents');
 assert.equal(context('H1').contextValue,'config-hook'); assert.equal(context('S3').contextValue,'config-finding'); assert.equal(context('H5').contextValue,'config-finding');
 for (const n of ns) {
  assert.equal(n.action==='previewKiroConfig', configActions(n.finding!).length===0, n.finding!.id);
  assert.equal(n.tooltip!.includes('Review changes…'), ['S1','H1','H2','H3','H4'].includes(n.finding!.id), n.finding!.id);
  assert.equal(n.tooltip!.includes('Cyclegauge writes nothing itself'), configActions(n.finding!).length>0, n.finding!.id);
  assert.ok(!/preview/i.test(n.description!), n.finding!.id);
 }
});
test('cross-root total is explicitly inference and gaps are counted, never success',()=>{
 const r=review(); r.findings.find(f=>f.id==='S3')!.behaviour='inferred'; r.status='partial';r.notChecked={schema_unknown:2, root_not_local:1};
 const ns=flatten(configTree(r,['synthetic-root']));
 assert.match(ns.find(n=>n.finding?.id==='S3')!.tooltip!, /Cyclegauge inference from Kiro's documentation/);
 assert.ok(ns.some(n=>n.label==='Not checked'));
 assert.match(JSON.stringify(ns), /unknown schema version/);
 const status=reviewTree(undefined,configSummary(r,'2030-01-01T00:00:00Z'),configTree(r,['synthetic-root']),{audit:'off',config:'off'},new Date('2030-01-01T00:30:00Z'))[0]!;assert.match(status.description!, /partial check/);assert.equal(status.icon,'warning');
 const commandOnly={...r.findings.find(f=>f.id==='H5')!,agentHooks:0,commandHooks:2};
 const copy={...r,findings:[commandOnly]};
 assert.match(flatten(configTree(copy,['synthetic-root'])).find(n=>n.finding)!.tooltip!, /Kiro documents that command actions do not use credits/);
});

test('S3 size is always a lower bound and AGENTS-only totals have a text-only preview',()=>{
 const r=review(), f=r.findings.find(f=>f.id==='S3')!;
 const ns=flatten(configTree(r,['synthetic-root']));
 assert.match(ns.find(n=>n.finding?.id==='S3')!.description!, /at least/);
 const agentsOnly={...r,alwaysIncluded:{...r.alwaysIncluded,contributors:[{root:0,rel:'AGENTS.md',size:40000}]}};
 const text=configPreview(agentsOnly,f)!;assert.match(text,/AGENTS.md/);assert.ok(!text.includes('inclusion: manual'));
});

const OFF = { audit: 'off', config: 'off' } as const;
const top = (r: ConfigReview, state = {}) => configTree(r, ['synthetic-root'], [], 0, state);
test('three collapsed groups by action with fixed verbs, plain headings, no note row (the sentence is in the tooltips) and group context values', () => {
 const groups = top(review());
 assert.deepEqual(groups.map(g => g.label), ['Load only when needed (1)', 'Run only manually (4)', 'Worth a look (3)']);
 assert.deepEqual(groups.map(g => g.description), ['Kiro loads the file only when you reference it', 'the hook runs only when you start it', 'no automatic change']);
 assert.deepEqual(groups.map(g => g.contextValue), ['config-group-load', 'config-group-run', 'config-group']);
 assert.ok(groups.every(g => g.expanded === false));
 for (const g of groups) assert.ok(g.children!.every(n => n.finding && n.label !== NOTHING_CHANGES), 'no note row');
 assert.deepEqual(groups[0]!.children!.map(n => n.finding!.id), ['S1']);
 assert.deepEqual(groups[1]!.children!.map(n => n.finding!.id).sort(), ['H1', 'H1', 'H4', 'H4']);
 assert.deepEqual(groups[2]!.children!.map(n => n.finding!.id).sort(), ['H5', 'S2', 'S3']);
 // Headings stay plain: technical terms only in tooltips.
 for (const n of flatten(groups)) { assert.ok(!/inclusion: |trigger: |matcher|front matter/i.test(`${n.label} ${n.description ?? ''}`), n.label); }
 assert.ok(groups[0]!.tooltip!.includes('inclusion: manual')); assert.ok(groups[1]!.tooltip!.includes('trigger: Manual'));
 for (const g of groups.slice(0, 2)) assert.ok(g.tooltip!.includes('Alternatives:') && g.tooltip!.includes('Nothing changes until you save.'));
 for (const n of flatten(groups).filter(x => x.finding)) assert.match(n.tooltip!, /Alternatives?:|Optional:/, n.finding!.id);
});
test('items are sorted by size (largest first), then the more important notice, then review order', () => {
 const roots = [{ root: 0, nestedNotChecked: 0, steering: [9000, 40000, 26000].map((size, i) => ({ rel: `.kiro/steering/synthetic-${i}.md`, mode: 'always' as const, size, matchAll: false as const, patternCount: 0 })), hooks: [
  { rel: '.kiro/hooks/synthetic.json', index: 0, name: 'synthetic-a', trigger: 'PostFileSave' as const, action: 'agent' as const, matcher: 'none' as const, enabled: true as const, promptBytes: 10, commandBytes: 0 },
  { rel: '.kiro/hooks/synthetic.json', index: 1, name: 'synthetic-b', trigger: 'PostFileSave' as const, action: 'agent' as const, matcher: 'none' as const, enabled: true as const, promptBytes: 5000, commandBytes: 0 },
  { rel: '.kiro/hooks/synthetic.json', index: 2, name: 'synthetic-c', trigger: 'UserPromptSubmit' as const, action: 'agent' as const, matcher: 'none' as const, enabled: true as const, promptBytes: 10, commandBytes: 0 }] }];
 const r: ConfigReview = { ...evaluateConfigRules(roots), roots, status: 'complete', bytesRead: 0 };
 const [load, run] = top(r);
 assert.deepEqual(load!.children!.map(n => n.finding!.size), [40000, 26000, 9000]);
 // H4 (5000 bytes) first, then the notices without a size (H1 twice in review order), then the info finding H3.
 assert.deepEqual(run!.children!.map(n => n.finding!.id + ':' + (n.finding!.hook ?? '')), ['H4:1', 'H1:0', 'H1:1', 'H3:2']);
});
test('annotations carry the short why and the alternatives; fixed text and a size only', () => {
 const s1 = configAnnotation('loadWhenNeeded', { id: 'S1', size: 32.5 * 1024 });
 assert.deepEqual(s1, { label: 'Load only when needed', description: 'Always-included Steering is added to every request (32.5 KiB). With inclusion: manual Kiro loads it only when you reference it with #. Alternatives: fileMatch for specific files, or split the file.' });
 const h1 = configAnnotation('runManually', { id: 'H1' });
 assert.equal(h1.label, 'Run only manually');
 assert.equal(h1.description, 'This hook starts agent work on every matching file change, and each run uses credits. With trigger: Manual it runs only when you start it. Alternatives: narrow the matcher, use a shell command action, or Disable.');
 assert.ok(configAnnotation('runManually', { id: 'H2' }).description.includes('on every matching tool use'));
 assert.deepEqual(configAnnotation('disable', { id: 'H1' }), { label: 'Disable hook', description: 'The hook stays in its file but is turned off (enabled: false). Alternative: Run only manually.' });
 assert.ok(!configAnnotation('loadWhenNeeded', { id: 'S1' }).description.includes('undefined'));
});
test('the whole view: status line, notes, then Exclude, Load, Run, Worth a look, footers and Not checked, in this order', () => {
 const counts = { files: 1, dirs: 1, ignored: 0, ignoreFiles: 1, ignoreFilesUnavailable: 0, symlinks: 0, unreadable: 0, unknown: 0 };
 const finding = (path: string, size: number) => ({ path, isDir: false, category: 'secret' as const, coverage: 'not_covered' as const, suggestion: `/${path}`, size });
 const result: AuditResult = { status: 'complete', ignore: 'disabled', findings: [finding('synthetic-a.pem', 100), finding('synthetic-b.pem', 200)], omitted: 0, counts, reasons: [] };
 const hash = (c: string, p: string) => dismissHash('synthetic-salt', c, p);
 const audit = auditTree(result, 'synthetic-folder', [hash('secret', 'synthetic-b.pem')], hash, new Set(), '2030-01-01T10:15:00');
 const r = review(); r.status = 'partial'; r.notChecked = { schema_unknown: 1 };
 const view = reviewTree(audit, configSummary(r, '2030-01-01T10:16:00', { paused: true }), top(r), { audit: 'onOpenAndChanges', config: 'onOpenAndChanges' }, new Date('2030-01-01T12:00:00'));
 assert.deepEqual(view.map(n => n.id.replace(/:0$/, '')), ['status', 'group:exclude', 'config:g:load', 'config:g:run', 'config:g:look', 'footer:dismissed', 'config:unchecked']);
 assert.equal(view[0]!.label, 'Checked 10:15 · 9 suggestions'); // 1 visible filename finding + 8 configuration findings
 assert.equal(view[0]!.description, 'Kiro may read about 100 B · checks again on open and on changes · partial check · automatic review paused (many changes)');
 assert.ok(view[0]!.tooltip!.includes(CONFIG_EXCLUSIONS));
 assert.equal(view[1]!.label, 'Exclude from Kiro (1)'); assert.equal(view[1]!.description, "won't take effect yet — add .kiroignore to Agent Ignore Files");
 // Only the configuration has run: the status line still appears; with nothing at all the view is empty (welcome text).
 assert.equal(reviewTree(undefined, configSummary(r, '2030-01-01T10:16:00'), top(r), OFF, new Date('2030-01-01T12:00:00'))[0]!.label, 'Checked 10:16 · 8 suggestions');
 assert.deepEqual(reviewTree(undefined, configSummary(), [], OFF), []);
});

test('group ids stay the same across redraws so the editor keeps what the user expanded; items and elements carry the generation', () => {
 const first = configTree(review(), ['synthetic-root'], [], 1), second = configTree(review(), ['synthetic-root'], [], 2);
 assert.deepEqual(first.map(g => g.id), second.map(g => g.id));
 assert.ok(first.every(g => g.id.startsWith('config:g:') || g.id === 'config:unchecked'));
 assert.ok(first.every(g => g.expanded === false));
 assert.notEqual(first[0]!.children![0]!.id, second[0]!.children![0]!.id);
 assert.ok(first.every(g => g.generation === 1) && second.every(g => g.generation === 2));
});
test('an item whose file has a prepared, unsaved edit says "prepared — save the file to apply" with another icon; the status line counts the files', () => {
 const r = review(), plain = flatten(configTree(r, ['synthetic-root'])), index = r.findings.findIndex(f => f.id === 'S1');
 const marked = flatten(configTree(r, ['synthetic-root'], [], 0, { prepared: new Set([index]) }));
 const item = (nodes: ConfigNode[]) => nodes.find(n => n.finding?.id === 'S1')!;
 assert.equal(item(marked).description, PREPARED_DESCRIPTION); assert.notEqual(item(plain).description, PREPARED_DESCRIPTION);
 assert.equal(item(marked).icon, 'edit'); assert.notEqual(item(plain).icon, 'edit');
 assert.ok(item(marked).tooltip!.includes('prepared but not saved'));
 assert.equal(marked.filter(n => n.description === PREPARED_DESCRIPTION).length, 1);
 const view = (count: number) => reviewTree(undefined, configSummary(r, '2030-01-01T10:16:00'), top(r), OFF, new Date('2030-01-01T12:00:00'), count);
 assert.ok(!view(0)[0]!.description?.includes('unsaved'));
 assert.ok(view(1)[0]!.description!.includes('1 file with unsaved prepared changes'));
 assert.ok(view(2)[0]!.description!.includes('2 files with unsaved prepared changes'));
});
