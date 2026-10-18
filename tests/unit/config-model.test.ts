import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configTree, configPreview, configActions, CONFIG_BASIS, CONFIG_CREDITS, type ConfigNode } from '../../src/extension/config-model.ts';
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
 const r = review(), nodes = flatten(configTree(r, ['synthetic-root\u202E'], '2030-01-01T00:00:00Z', new Date('2030-01-01T00:00:00Z')));
 assert.equal(nodes[0]!.label, 'Kiro Steering and Hooks');
 for (const label of ['Always-included Steering', 'AGENTS.md', 'Hooks that start agent work', 'Overlapping hooks']) assert.ok(nodes.some(n => n.label === label));
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
  assert.equal(n.tooltip!.includes('prepare an unsaved edit'), configActions(n.finding!).length>0, n.finding!.id);
  assert.ok(!/preview/i.test(n.description!), n.finding!.id);
 }
});
test('cross-root total is explicitly inference and gaps are counted, never success',()=>{
 const r=review(); r.findings.find(f=>f.id==='S3')!.behaviour='inferred'; r.status='partial';r.notChecked={schema_unknown:2, root_not_local:1};
 const ns=flatten(configTree(r,['synthetic-root']));
 assert.match(ns.find(n=>n.finding?.id==='S3')!.tooltip!, /Cyclegauge inference from Kiro's documentation/);
 assert.ok(ns.some(n=>n.label==='Not checked'));
 assert.match(JSON.stringify(ns), /unknown schema version/);assert.match(ns[0]!.description!, /partial check/);
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
