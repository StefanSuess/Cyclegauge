import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configTree, configPreview, CONFIG_BASIS, CONFIG_CREDITS, type ConfigNode } from '../../src/extension/config-model.ts';
import { evaluateConfigRules } from '../../src/audit/config-rules.ts';
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
test('previews contain fixed relative filenames and ordinals only, with exact manual snippet and no unsafe filename previews', () => {
 const r=review();
 const s1=r.findings.find(f=>f.id==='S1')!;
 assert.equal(configPreview(r,s1), '# Suggested by Cyclegauge - review before saving; nothing was changed\n# .kiro/steering/synthetic-architecture.md\n\n---\ninclusion: manual\n---\n\nThis is a preview, not a replacement for the existing file.\nFor fileMatch, choose a pattern for the files it applies to.\nFor auto, write a name and a description.\nKiro CLI V1/V2 loads only always-included files automatically.\n');
 for (const f of r.findings) {
  const p=configPreview(r,f)!;
  assert.ok(!p.includes('synthetic-second-name')); assert.ok(!p.includes('😀')); assert.ok(!p.includes('synthetic-root'));
  assert.ok(!/\d+\s+credits?/.test(p));
 }
 assert.match(configPreview(r,r.findings.find(f=>f.id==='H1')!)!, /hook 1 of 2/);
 assert.match(configPreview(r,r.findings.find(f=>f.id==='H5')!)!, /hook 2 of 2/);
 assert.equal(configPreview(r,{...s1,rel:'.kiro/steering/synthetic-\u202E.md'}),undefined);
 assert.equal(configPreview(r,{...s1,rel:'../../synthetic.md'}),undefined);
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
