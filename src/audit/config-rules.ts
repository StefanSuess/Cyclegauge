import type { HookConfig, HookTrigger, SteeringConfig } from './config-parse.ts';
export const NOT_CHECKED_CODES = ['untrusted', 'root_refused', 'root_not_local', 'no_kiro_config', 'folder_symlink', 'folder_unreadable', 'too_many_entries', 'file_unsafe', 'link_not_followed', 'file_too_large', 'file_unreadable', 'name_unsafe', 'fm_unrecognised', 'json_invalid', 'schema_unknown', 'trigger_unknown', 'field_unrecognised', 'limit_files', 'limit_hooks', 'limit_roots', 'limit_bytes', 'limit_time', 'cancelled'] as const;
export type NotCheckedCode = typeof NOT_CHECKED_CODES[number];
export type NotChecked = Partial<Record<NotCheckedCode, number>>;
export type FindingId = 'S1' | 'S2' | 'S3' | 'S4' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5';
type Basis = { behaviour: 'documented' | 'inferred'; threshold: 'none' | 'heuristic'; source: string; checked: string };
// Single reviewed rule table. Kiro documents behavior, but publishes no byte thresholds.
const steeringBasis = { source: 'https://kiro.dev/docs/steering/', checked: '2026-10-18' };
const hookBasis = { source: 'https://kiro.dev/docs/hooks/', checked: '2026-10-18' };
export const CONFIG_RULES = {
 S1: { ...steeringBasis, behaviour: 'documented', threshold: 'heuristic', infoBytes: 8192, noticeBytes: 24576 },
 S2: { ...steeringBasis, behaviour: 'documented', threshold: 'heuristic', infoBytes: 8192, noticeBytes: 24576 },
 S3: { ...steeringBasis, behaviour: 'documented', threshold: 'heuristic', bytes: 32768 },
 S4: { ...steeringBasis, behaviour: 'inferred', threshold: 'none' },
 H1: { ...hookBasis, behaviour: 'documented', threshold: 'none' },
 H2: { ...hookBasis, behaviour: 'documented', threshold: 'none' },
 H3: { ...hookBasis, behaviour: 'documented', threshold: 'none' },
 H4: { ...hookBasis, behaviour: 'documented', threshold: 'heuristic', bytes: 2048 },
 H5: { ...hookBasis, behaviour: 'documented', threshold: 'none' },
} as const satisfies Record<FindingId, Basis & { infoBytes?: number; noticeBytes?: number; bytes?: number }>;
export const TRIGGER_CLASSES: Record<HookTrigger, 'file' | 'tool' | 'prompt' | 'stop' | 'once'> = {
 PostFileSave: 'file', PostFileCreate: 'file', PostFileDelete: 'file', PreToolUse: 'tool', PostToolUse: 'tool',
 UserPromptSubmit: 'prompt', Stop: 'stop', SessionStart: 'once', SessionEnd: 'once', PreTaskExec: 'once', PostTaskExec: 'once', Manual: 'once',
};
export interface SteeringEntry extends SteeringConfig { rel: string }
export interface HookEntry extends HookConfig { rel: string }
export interface ConfigRootEntries { root: number; steering: SteeringEntry[]; agents?: { size: number }; hooks: HookEntry[]; incomplete?: boolean }
export interface ConfigLocation { root: number; rel: string; hook?: number }
export interface ConfigFinding extends ConfigLocation {
 id: FindingId; severity: 'info' | 'notice'; behaviour: Basis['behaviour']; threshold: Basis['threshold']; size?: number;
 related?: ConfigLocation[]; agentHooks?: number; commandHooks?: number;
}
export interface AlwaysIncluded { bytes: number; lowerBound: true; incomplete: boolean; contributors: (ConfigLocation & { size: number })[] }
export function countNotChecked(counts: NotChecked, code: NotCheckedCode, count = 1): void { if (count > 0) counts[code] = (counts[code] ?? 0) + count; }
export function hookNotCheckedCodes(hook: HookConfig): NotCheckedCode[] {
 if (hook.enabled === false) return [];
 const codes: NotCheckedCode[] = [];
 if (hook.trigger === 'unrecognised') codes.push('trigger_unknown');
 const ignoresMatcher = hook.trigger === 'Stop' || hook.trigger === 'UserPromptSubmit';
 if (hook.enabled === 'unrecognised' || hook.action === 'unrecognised' || (!ignoresMatcher && hook.matcher === 'not_analysed')) codes.push('field_unrecognised');
 return codes;
}
export function evaluateConfigRules(roots: readonly ConfigRootEntries[]): { findings: ConfigFinding[]; notChecked: NotChecked; alwaysIncluded: AlwaysIncluded; patternNotAnalysed: ConfigLocation[] } {
 const patternNotAnalysed: ConfigLocation[] = [];
 const findings: ConfigFinding[] = [], notChecked: NotChecked = {}, contributors: AlwaysIncluded['contributors'] = [];
 let incomplete = roots.some(root => root.incomplete);
 const add = (id: FindingId, location: ConfigLocation, severity: ConfigFinding['severity'], extra: Partial<ConfigFinding> = {}) => {
  const rule = CONFIG_RULES[id]; findings.push({ id, ...location, severity, behaviour: rule.behaviour, threshold: rule.threshold, ...extra });
 };
 const groups = new Map<HookTrigger, { location: ConfigLocation; hook: HookEntry }[]>();
 for (const root of roots) {
  for (const entry of root.steering) {
   const location = { root: root.root, rel: entry.rel };
   if (entry.mode === 'unrecognised' || (entry.mode === 'fileMatch' && entry.matchAll === 'unknown')) {
    countNotChecked(notChecked, entry.mode === 'unrecognised' ? 'fm_unrecognised' : 'field_unrecognised'); incomplete = true; continue;
   }
   if (entry.mode === 'fileMatch' && entry.broadUncertain) { patternNotAnalysed.push(location); incomplete = true; }
   if (entry.mode === 'always' || (entry.mode === 'fileMatch' && entry.matchAll === true)) contributors.push({ ...location, size: entry.size });
   if (entry.mode === 'always' && entry.size >= CONFIG_RULES.S1.infoBytes) add('S1', location, entry.size >= CONFIG_RULES.S1.noticeBytes ? 'notice' : 'info', { size: entry.size });
   if (entry.mode === 'fileMatch' && entry.matchAll === true) add('S4', location, 'info', { size: entry.size });
  }
  if (root.agents) {
   const location = { root: root.root, rel: 'AGENTS.md' }, size = root.agents.size;
   contributors.push({ ...location, size });
   if (size >= CONFIG_RULES.S2.infoBytes) add('S2', location, size >= CONFIG_RULES.S2.noticeBytes ? 'notice' : 'info', { size });
  }
  for (const hook of root.hooks) {
   if (hook.enabled === false) continue;
   const codes = hookNotCheckedCodes(hook);
   for (const code of codes) countNotChecked(notChecked, code);
   if (codes.length || hook.trigger === 'unrecognised') continue;
   const ignoresMatcher = hook.trigger === 'Stop' || hook.trigger === 'UserPromptSubmit';
   const location = { root: root.root, rel: hook.rel, hook: hook.index }, kind = TRIGGER_CLASSES[hook.trigger];
   const broad = ignoresMatcher || hook.matcher === 'none' || hook.matcher === 'broad';
   if (hook.action === 'agent') {
    if (kind === 'file' && broad) add('H1', location, 'notice');
    if (kind === 'tool' && broad) add('H2', location, 'notice');
    if (kind === 'prompt' || kind === 'stop') add('H3', location, 'info');
    if (kind !== 'once' && hook.promptBytes >= CONFIG_RULES.H4.bytes) add('H4', location, 'notice', { size: hook.promptBytes });
   }
   const group = groups.get(hook.trigger) ?? []; group.push({ location, hook }); groups.set(hook.trigger, group);
  }
 }
 // One overlap component per broad trigger, otherwise one per identical lexical matcher.
 // This is linear in hook count; never compare every pair or interpret a matcher.
 for (const [trigger, group] of groups) {
  const broad = group.some(({hook}) => trigger === 'Stop' || trigger === 'UserPromptSubmit' || hook.matcher === 'none' || hook.matcher === 'broad');
  const equal = new Map<number, typeof group>();
  if (!broad) for (const entry of group) { const key = entry.hook.matcherKey; if (key === undefined) continue; const same = equal.get(key) ?? []; same.push(entry); equal.set(key, same); }
  for (const overlap of broad ? [group] : equal.values()) {
   if (overlap.length < 2) continue;
   const agentHooks = overlap.filter(entry => entry.hook.action === 'agent').length;
   add('H5', overlap[0]!.location, agentHooks ? 'notice' : 'info', { related: overlap.map(entry => entry.location), agentHooks, commandHooks: overlap.length - agentHooks });
  }
 }
 contributors.sort((a,b) => b.size-a.size || a.root-b.root || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
 const bytes = contributors.reduce((sum, entry) => sum + entry.size, 0);
 if (bytes >= CONFIG_RULES.S3.bytes) add('S3', { root: contributors[0]!.root, rel: '' }, 'notice', { size: bytes, ...(roots.length > 1 ? { behaviour: 'inferred' as const } : {}) });
 return { findings, notChecked, patternNotAnalysed, alwaysIncluded: { bytes, lowerBound: true, incomplete, contributors } };
}
