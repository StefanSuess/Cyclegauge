import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigRules, CONFIG_RULES, type ConfigRootEntries, type HookEntry } from '../../src/audit/config-rules.ts';
import type { HookConfig, HookTrigger, SteeringConfig } from '../../src/audit/config-parse.ts';
const steering = (size: number, mode: SteeringConfig['mode'] = 'always', matchAll: boolean | 'unknown' = false) => ({ rel: '.kiro/steering/synthetic.md', size, mode, matchAll, patternCount: 1 });
const hook = (changes: Partial<HookConfig> = {}, rel = '.kiro/hooks/synthetic.json'): HookEntry => ({ rel, index: 0, name: '', trigger: 'PostFileSave', action: 'agent', matcher: 'none', enabled: true, promptBytes: 0, commandBytes: 0, ...changes });
const root = (changes: Partial<ConfigRootEntries> = {}): ConfigRootEntries => ({ root: 0, steering: [], hooks: [], ...changes });
test('S1 and S2 enforce both byte thresholds and severity boundaries', () => {
 for (const [size, severity] of [[8191, undefined], [8192, 'info'], [8193, 'info'], [24575, 'info'], [24576, 'notice'], [24577, 'notice']] as const) {
  const result = evaluateConfigRules([root({ steering: [steering(size)], agents: { size } })]);
  for (const id of ['S1', 'S2']) assert.equal(result.findings.find(f => f.id === id)?.severity, severity);
 }
 assert.deepEqual(evaluateConfigRules([root({ steering: [steering(30000, 'manual'), steering(30000, 'auto'), steering(30000, 'fileMatch')] })]).findings, []);
 assert.equal(CONFIG_RULES.S1.threshold, 'heuristic'); assert.equal(CONFIG_RULES.S4.behaviour, 'inferred');
});
test('S3 sums roots, includes S4 and AGENTS, stays lower-bound, and marks cross-root inference', () => {
 for (const size of [32767, 32768, 32769]) {
  const result = evaluateConfigRules([root({ agents: { size } })]);
  assert.equal(result.findings.some(f => f.id === 'S3'), size >= 32768);
  assert.equal(result.alwaysIncluded.lowerBound, true);
 }
 const result = evaluateConfigRules([root({ steering: [steering(16384, 'fileMatch', true)] }), root({ root: 1, agents: { size: 16384 }, incomplete: true })]);
 assert.equal(result.alwaysIncluded.bytes, 32768); assert.equal(result.alwaysIncluded.incomplete, true);
 assert.equal(result.findings.find(f => f.id === 'S3')?.behaviour, 'inferred');
 assert.equal(result.findings.find(f => f.id === 'S4')?.behaviour, 'inferred');
 assert.deepEqual(result.alwaysIncluded.contributors.map(c => c.size), [16384, 16384]);
});
test('unrecognised steering and patterns are unknown, never always-included or findings', () => {
 const result = evaluateConfigRules([root({ steering: [steering(100000, 'unrecognised'), steering(100000, 'fileMatch', 'unknown')] })]);
 assert.equal(result.alwaysIncluded.bytes, 0); assert.equal(result.alwaysIncluded.incomplete, true);
 assert.deepEqual(result.notChecked, { fm_unrecognised: 1, field_unrecognised: 1 }); assert.deepEqual(result.findings, []);
});
test('H1 to H4 matrix: trigger class, matcher, action, disabled and unknown states', () => {
 const triggers: [HookTrigger, string | undefined][] = [['PostFileSave','H1'],['PostFileCreate','H1'],['PostFileDelete','H1'],['PreToolUse','H2'],['PostToolUse','H2'],['UserPromptSubmit','H3'],['Stop','H3'],['SessionStart',undefined],['SessionEnd',undefined],['PreTaskExec',undefined],['PostTaskExec',undefined],['Manual',undefined]];
 for (const [trigger, expected] of triggers) for (const matcher of ['none','broad','specific','not_analysed'] as const) for (const action of ['agent','command'] as const) {
  const result = evaluateConfigRules([root({ hooks: [hook({ trigger, matcher, action, promptBytes: 2048 })] })]);
  const unchecked = matcher === 'not_analysed' && trigger !== 'UserPromptSubmit' && trigger !== 'Stop';
  const broad = matcher === 'none' || matcher === 'broad' || expected === 'H3';
  assert.equal(result.findings.some(f => f.id === expected), action === 'agent' && !!expected && broad && !unchecked, `${trigger}/${matcher}/${action}`);
  assert.equal(result.findings.some(f => f.id === 'H4'), action === 'agent' && !!expected && !unchecked);
  if (expected === 'H3' && action === 'agent') assert.equal(result.findings.find(f => f.id === 'H3')?.severity, 'info');
 }
 for (const promptBytes of [2047,2048,2049]) assert.equal(evaluateConfigRules([root({ hooks: [hook({promptBytes})] })]).findings.some(f => f.id === 'H4'), promptBytes >= 2048);
 for (const changes of [{ enabled: false }, { enabled: 'unrecognised' }, { action: 'unrecognised' }, { trigger: 'unrecognised' }] as Partial<HookConfig>[]) assert.deepEqual(evaluateConfigRules([root({ hooks: [hook(changes)] })]).findings, []);
 const unknown = evaluateConfigRules([root({ hooks: [hook({trigger:'unrecognised'}), hook({action:'unrecognised'}), hook({enabled:'unrecognised'}), hook({matcher:'not_analysed'}), hook({enabled:false,trigger:'unrecognised'})] })]);
 assert.deepEqual(unknown.notChecked, { trigger_unknown: 1, field_unrecognised: 3 });
});
test('H5 groups exact triggers and lexical equality only, across files and roots', () => {
 const first = hook({matcher:'specific',matcherKey:0}), second = hook({matcher:'specific',matcherKey:0,index:1}, '.kiro/hooks/synthetic-other.json');
 let result = evaluateConfigRules([root({hooks:[first]}),root({root:1,hooks:[second]})]);
 assert.equal(result.findings.filter(f => f.id === 'H5').length, 1);
 assert.equal(result.findings.find(f => f.id === 'H5')?.agentHooks, 2);
 for (const changed of [{matcherKey:1},{matcherKey:undefined},{enabled:false},{trigger:'PostFileCreate'},{matcher:'not_analysed'}] as Partial<HookConfig>[]) {
  result = evaluateConfigRules([root({hooks:[first,{...second,...changed}]})]); assert.equal(result.findings.some(f=>f.id==='H5'), false);
 }
 result = evaluateConfigRules([root({hooks:[hook({action:'command'}),hook({action:'command',index:1,matcher:'specific'})]})]);
 const overlap = result.findings.find(f=>f.id==='H5'); assert.equal(overlap?.agentHooks,0); assert.equal(overlap?.commandHooks,2); assert.equal(overlap?.severity,'info');
 assert.equal(result.findings.some(f=>['H1','H2','H3','H4'].includes(f.id)),false);
});
test('ambiguous broad patterns are information only, with unknown total coverage and no S4 claim',()=>{
 const result=evaluateConfigRules([root({steering:[{...steering(40000,'fileMatch',false),broadUncertain:true}]})]);
 assert.deepEqual(result.findings,[]);assert.equal(result.alwaysIncluded.bytes,0);assert.equal(result.alwaysIncluded.incomplete,true);assert.deepEqual(result.patternNotAnalysed,[{root:0,rel:'.kiro/steering/synthetic.md'}]);
});
