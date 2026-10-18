import type { ConfigReview } from '../audit/config-review.ts';
import { configPathAllowed } from '../audit/config-read.ts';
import { NOT_CHECKED_CODES, type ConfigFinding, type ConfigLocation, type FindingId, type NotCheckedCode } from '../audit/config-rules.ts';
import { escapeText, formatSize, relativeTime } from './audit-model.ts';

export const CONFIG_BASIS = ["Kiro documents this behavior.", "Kiro documents this behavior; the threshold is a Cyclegauge heuristic.", "Cyclegauge inference from Kiro's documentation."] as const;
export const CONFIG_CREDITS = ['Kiro documents that agent prompt actions use credits.', 'A larger always-included context is sent with every interaction; Kiro does not publish how this maps to credits.', 'Kiro documents that command actions do not use credits.'] as const;
export const CONFIG_EXCLUSIONS = 'Global Steering and Hooks in your home folder, AGENTS.md in subfolders, legacy hook files, custom agent resources and cloud configuration are not checked.';
const CLI_NOTE = 'Kiro CLI V1/V2 loads only always-included files automatically.';
const PREVIEW_HEADER = '# Suggested by Cyclegauge - review before saving; nothing was changed';
const MANUAL = '---\ninclusion: manual\n---\n\nThis is a preview, not a replacement for the existing file.\nFor fileMatch, choose a pattern for the files it applies to.\nFor auto, write a name and a description.\n' + CLI_NOTE;
export interface ConfigNode {
 id: string; kind: 'config'; label: string; description?: string; tooltip?: string; icon: string; contextValue: string;
 children?: ConfigNode[]; action?: 'reviewKiroConfig' | 'previewKiroConfig'; finding?: ConfigFinding;
}
export interface RefusedConfigRoot { name: string; code: 'untrusted' | 'root_refused' | 'root_not_local' | 'limit_roots'; reason?: string }
const NOT_CHECKED: Record<NotCheckedCode, string> = {
 untrusted: 'The workspace is not trusted.', root_refused: 'The folder was refused by the workspace safety guard.', root_not_local: 'The folder is not a local file folder.',
 no_kiro_config: 'Nothing to review: no supported Kiro configuration found.', folder_symlink: 'A symbolic-link folder was not followed.', folder_unreadable: 'A folder could not be read.', too_many_entries: 'A folder has too many entries.',
 file_unsafe: 'A file was not safe to read.', link_not_followed: 'A symbolic-link file was not followed.', file_too_large: 'A hook file exceeds the size limit.', file_unreadable: 'A file could not be read.', name_unsafe: 'A file name was not safe to use.',
 fm_unrecognised: 'Steering front matter was not recognised.', json_invalid: 'Hook JSON could not be parsed.', schema_unknown: 'Hook files have an unknown schema version.', trigger_unknown: 'A hook trigger was not recognised.', field_unrecognised: 'A configuration field was not recognised.',
 limit_files: 'The file limit was reached.', limit_hooks: 'The hook limit was reached.', limit_roots: 'The root limit was reached; at most 8 local folders are checked.', limit_bytes: 'The read-byte limit was reached.', limit_time: 'The review time limit was reached.', cancelled: 'The review was cancelled.',
};
const TITLES: Record<FindingId, string> = { S1: 'Large always-included Steering', S2: 'Large AGENTS.md', S3: 'Combined always-included context', S4: 'Steering effectively always included', H1: 'Agent work on file changes', H2: 'Agent work on tool use', H3: 'Agent hook information', H4: 'Large agent prompt', H5: 'Hooks may overlap' };
const WHY: Record<FindingId, string> = {
 S1: 'Kiro includes this Steering file with every interaction. A large file may add unnecessary context.',
 S2: 'Kiro always includes AGENTS.md and it has no inclusion modes. Detailed sections may fit better in focused Steering files.',
 S3: 'The measured always-included files may add a large context to every interaction. This is a lower bound; file references are not expanded.',
 S4: 'The recognised match-all setting may load this file like an always-included file.',
 H1: 'This agent action may run for every matching agent-made file change because its matcher is absent or broad.',
 H2: 'This agent action may run for every matching tool use because its matcher is absent or broad.',
 H3: 'This agent action runs on Prompt Submit or Stop. This is information, not a recommendation to disable it.',
 H4: 'This agent action has a large prompt. A shorter prompt may keep the automation focused.',
 H5: 'These enabled hooks share an event and have broad or lexically identical matchers. They may overlap; this does not prove duplicate work.',
};
const NEXT: Record<FindingId, string> = {
 S1: 'Preview manual inclusion', S2: 'Review moving detail to focused Steering files', S3: 'Review narrower inclusion for contributors', S4: 'Review replacing the match-all pattern',
 H1: 'Preview disabling or narrowing the automation', H2: 'Preview disabling or narrowing the automation', H3: 'Preview the optional disable setting', H4: 'Review keeping the agent prompt concise', H5: 'Review the overlapping automation',
};
const node = (id: string, label: string, extra: Partial<ConfigNode> = {}): ConfigNode => ({id, kind: 'config', label, icon: 'info', contextValue: 'config-info', ...extra});
// Ordinals are positions in the projected hook array; they reveal no name, matcher or action text.
function location(review: ConfigReview, loc: ConfigLocation): string {
 const file = escapeText(loc.rel);
 if (loc.hook === undefined) return file;
 const hooks = review.roots.find(r => r.root === loc.root)?.hooks.filter(h => h.rel === loc.rel) ?? [];
 const position = hooks.findIndex(h => h.index === loc.hook);
 return `hook ${position < 0 ? loc.hook + 1 : position + 1} of ${hooks.length} in ${file}`;
}
const safeFile = (rel: string): boolean => rel === 'AGENTS.md' || configPathAllowed(rel, 'steering') || configPathAllowed(rel, 'hooks');
/** Only fixed text and validated relative file names reach an untitled document. Never a root or a hook name. */
export function configPreview(review: ConfigReview, finding: ConfigFinding): string | undefined {
 const locations = finding.id === 'S3' ? review.alwaysIncluded.contributors.slice(0, 3) : finding.related ?? [finding];
 if (!locations.length || locations.some(loc => !safeFile(loc.rel))) return undefined;
 const header = `${PREVIEW_HEADER}\n# ${locations.map(loc => location(review, loc)).join('; ')}\n\n`;
 switch (finding.id) {
  case 'S1': return header + MANUAL + '\n';
  case 'S3': return locations.every(loc => loc.rel === 'AGENTS.md') ? header + 'AGENTS.md has no inclusion modes. Review moving detailed sections into focused Steering files with manual or fileMatch inclusion. The combined size is a lower bound; cross-root aggregation is an inference from Kiro documentation.\n' : header + 'Review the listed Steering contributors individually; AGENTS.md has no inclusion modes. The combined size is a lower bound; cross-root aggregation is an inference from Kiro documentation.\n\n' + MANUAL + '\n';
  case 'S2': return header + 'AGENTS.md has no inclusion modes. Review moving detailed sections into focused Steering files with manual or fileMatch inclusion. Choose any pattern yourself.\n';
  case 'S4': return header + 'Review replacing the match-all pattern with one specific to the files it applies to. No pattern is generated.\n';
  case 'H1': case 'H2': case 'H3': return header + 'Optional setting for the listed hook:\n"enabled": false\n\nDisabling loses the automation. Review whether a command action suits a deterministic task, or choose a more specific matcher. No matcher or command is generated.\n';
  case 'H4': return header + 'Review keeping the agent prompt concise and focused on the automation it needs to perform. No prompt text is included here.\n';
  case 'H5': return header + 'Review whether these hooks need to run for the same event. Keep the automation you need and review disabling or narrowing any redundant hook. No matcher is generated.\n';
 }
}
function findingNode(review: ConfigReview, f: ConfigFinding, index: number, names: readonly string[], fresh = false): ConfigNode {
 const ordinal = f.id === 'S3' ? 'Across checked roots' : location(review, f);
 const hook = f.hook === undefined ? undefined : review.roots.find(r => r.root === f.root)?.hooks.find(h => h.rel === f.rel && h.index === f.hook);
 const suffix = hook?.name ? ` · ${escapeText(Array.from(hook.name).slice(0, 60).join(''))}` : '';
 const basis = f.behaviour === 'inferred' ? CONFIG_BASIS[2] : f.threshold === 'heuristic' ? CONFIG_BASIS[1] : CONFIG_BASIS[0];
 const credit = f.id.startsWith('S') ? CONFIG_CREDITS[1] : f.id === 'H5' && f.agentHooks === 0 ? CONFIG_CREDITS[2] : CONFIG_CREDITS[0];
 const preview = configPreview(review, f);
 const gaps = f.id === 'S3' && review.alwaysIncluded.incomplete ? ['Some configuration was not checked; the lower bound may omit additional always-included files.'] : [];
 const details = f.id === 'S3' ? review.alwaysIncluded.contributors.slice(0,3).map(c => `${escapeText(names[c.root] ?? '')}: ${location(review,c)} · ${formatSize(c.size)}`) : (f.related ?? []).map(c => `${escapeText(names[c.root] ?? '')}: ${location(review,c)}`);
 return node(`config:f:${index}`, `${TITLES[f.id]} · ${ordinal}${suffix}`, {
  description: [fresh ? 'new this session' : '', names[f.root] === undefined ? '' : escapeText(names[f.root]!), f.size === undefined ? '' : `${f.id === 'S3' ? 'at least' : 'about'} ${formatSize(f.size)}`, NEXT[f.id]].filter(Boolean).join(' · '),
  tooltip: [TITLES[f.id], ordinal, WHY[f.id], basis, credit, 'Being listed does not mean the setting is wrong.', ...details, ...gaps, NEXT[f.id], ...(['S1','S3'].includes(f.id) ? [CLI_NOTE] : [])].join('\n'),
  icon: f.severity === 'notice' ? 'lightbulb' : 'info', contextValue: 'config-finding', finding: f, ...(preview ? {action:'previewKiroConfig' as const} : {}),
 });
}
/** How a result was produced (automatic mode, section 4.1). `fresh` holds finding indices first seen after this window's first review. In memory only. */
export interface ConfigTreeState { automatic?: boolean; paused?: boolean; fresh?: ReadonlySet<number> }
/** Its own native plain-text section; no audit result, summary, clipboard or persistence state. */
export function configTree(review?: ConfigReview, names: readonly string[] = [], checkedAt?: string, now = new Date(), refused: readonly RefusedConfigRoot[] = [], generation = 0, state: ConfigTreeState = {}): ConfigNode[] {
 const entry = node('config:run', 'Review Kiro Steering and Hooks', {action:'reviewKiroConfig', icon:'refresh',contextValue:'config-run'});
 const children = [entry];
 if (review) {
  const indexed = review.findings.map((f,i) => ({f,i}));
  const groups: [string, FindingId[]][] = [['Always-included Steering',['S1','S3','S4']], ['AGENTS.md',['S2']], ['Hooks that start agent work',['H1','H2','H3','H4']], ['Overlapping hooks',['H5']]];
  for (const [group, ids] of groups) {
   const found = indexed.filter(x=>ids.includes(x.f.id));
   if (found.length) children.push(node(`config:g:${children.length}`,group,{children:found.map(x=>findingNode(review,x.f,x.i,names,state.fresh?.has(x.i))),icon:'list-unordered',contextValue:'config-group'}));
  }
  const gaps = NOT_CHECKED_CODES.filter(code => review.notChecked[code]).map((code,index) => node(`config:n:${index}`,NOT_CHECKED[code],{description:`${review.notChecked[code]}`,tooltip:NOT_CHECKED[code]}));
  for (const [i,r] of refused.entries()) gaps.push(node(`config:r:${i}`,escapeText(r.name),{description:NOT_CHECKED[r.code],tooltip: r.reason ? `Not checked: ${r.reason}.` : NOT_CHECKED[r.code],icon:'warning'}));
  const nested = review.roots.reduce((sum,r)=>sum+r.nestedNotChecked,0);
  if (nested) gaps.push(node('config:nested','Nested configuration folders are not checked.',{description:`${nested}`}));
  for (const [i,loc] of review.patternNotAnalysed.entries()) gaps.push(node(`config:p:${i}`,`${location(review,loc)} · Pattern too broad to judge`,{tooltip:'The pattern was not analysed. Its text is not shown.'}));
  if (gaps.length) children.push(node('config:unchecked','Not checked',{description:`${Object.values(review.notChecked).reduce((sum,n)=>sum+(n??0),0)+refused.length+nested+review.patternNotAnalysed.length} items`,children:gaps,icon:'warning',contextValue:'config-group'}));
  if (!review.findings.length && !gaps.length) children.push(node('config:none','No findings in the checked configuration.',{tooltip:'This does not prove that every setting is appropriate.'}));
 }
 children.push(node('config:exclusions',CONFIG_EXCLUSIONS));
 const age = relativeTime(checkedAt,now);
 const header = node('config:header','Kiro Steering and Hooks',{description:review ? [`${review.findings.length} findings`,age ? `checked ${state.automatic ? 'automatically · ' : ''}${age}` : '',review.status==='complete'?'':'partial check',state.paused ? 'automatic review paused (many changes)' : ''].filter(Boolean).join(' · ') : 'Run a separate configuration review',tooltip:CONFIG_EXCLUSIONS,children,icon:'settings-gear',contextValue:'config-header'});
 const identify = (nodes: ConfigNode[]): void => { for (const n of nodes) { n.id += `:${generation}`; if (n.children) identify(n.children); } };
 identify([header]);
 return [header];
}
