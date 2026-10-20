import type { ConfigReview } from '../audit/config-review.ts';
import { configPathAllowed } from '../audit/config-read.ts';
import { NOT_CHECKED_CODES, type ConfigFinding, type ConfigLocation, type FindingId, type NotCheckedCode } from '../audit/config-rules.ts';
import { PREPARED_DESCRIPTION, checkedLabel, escapeText, formatSize, unsavedFilesText, type AuditNode, type AuditParts } from './audit-model.ts';

export const CONFIG_BASIS = ["Kiro documents this behavior.", "Kiro documents this behavior; the threshold is a Bobert heuristic.", "Bobert inference from Kiro's documentation."] as const;
export const CONFIG_CREDITS = ['Kiro documents that agent prompt actions use credits.', 'A larger always-included context is sent with every interaction; Kiro does not publish how this maps to credits.', 'Kiro documents that command actions do not use credits.'] as const;
export const CONFIG_EXCLUSIONS = 'Global Steering and Hooks in your home folder, AGENTS.md in subfolders, legacy hook files, custom agent resources and cloud configuration are not checked.';
const CLI_NOTE = 'Kiro CLI V1/V2 loads only always-included files automatically.';
const PREVIEW_HEADER = '# Suggested by Bobert - review before saving; nothing was changed';
const MANUAL = '---\ninclusion: manual\n---\n\nThis is a preview, not a replacement for the existing file.\nFor fileMatch, choose a pattern for the files it applies to.\nFor auto, write a name and a description.\n' + CLI_NOTE;
const EDIT_NOTE = 'The action shows the edit in a change preview you can accept or discard, then leaves it unsaved in the file for you to review and save. Bobert writes nothing itself.';
const OPEN_NOTE = 'The action opens the file or selects the value for you to edit. Bobert writes nothing itself.';
/** Apply actions (approved 2026-10-18). Each prepares an unsaved edit in the real file, or only opens it; Bobert writes nothing itself. */
export type ConfigApplyAction = 'loadWhenNeeded' | 'narrowPattern' | 'runManually' | 'disable' | 'open';
const ACTIONS: Record<FindingId, readonly ConfigApplyAction[]> = {
 S1: ['loadWhenNeeded', 'open'], S2: ['open'], S3: [], S4: ['narrowPattern', 'open'],
 H1: ['runManually', 'disable', 'open'], H2: ['runManually', 'disable', 'open'], H3: ['runManually', 'disable', 'open'], H4: ['runManually', 'disable', 'open'], H5: [],
};
/** The apply actions for a finding. A finding without any (S3 and H5 span several files or hooks) keeps the read-only suggestion. */
export const configActions = (finding: Pick<ConfigFinding, 'id'>): readonly ConfigApplyAction[] => ACTIONS[finding.id] ?? [];
const CONTEXT: Record<FindingId, string> = { S1: 'config-steering-always', S2: 'config-agents', S3: 'config-finding', S4: 'config-steering-match', H1: 'config-hook', H2: 'config-hook', H3: 'config-hook', H4: 'config-hook', H5: 'config-finding' };
export interface ConfigNode {
 id: string; kind: 'config'; label: string; description?: string; tooltip?: string; icon: string; contextValue: string;
 children?: ConfigNode[]; action?: 'previewKiroConfig'; finding?: ConfigFinding; expanded?: boolean;
 /** The review this node was drawn from; a command given an element from an older drawing does nothing. */
 generation?: number;
}
export interface RefusedConfigRoot { name: string; code: 'untrusted' | 'root_refused' | 'root_not_local' | 'limit_roots'; reason?: string }
const NOT_CHECKED: Record<NotCheckedCode, string> = {
 untrusted: 'The workspace is not trusted.', root_refused: 'The folder was refused by the workspace safety guard.', root_not_local: 'The folder is not a local file folder.',
 no_kiro_config: 'Nothing to review: no supported Kiro configuration found.', folder_symlink: 'A symbolic-link folder was not followed.', folder_unreadable: 'A folder could not be read.', too_many_entries: 'A folder has too many entries.',
 file_unsafe: 'A file was not safe to read.', link_not_followed: 'A symbolic-link file was not followed.', file_too_large: 'A hook file exceeds the size limit.', file_unreadable: 'A file could not be read.', name_unsafe: 'A file name was not safe to use.',
 fm_unrecognised: 'Steering front matter was not recognised.', json_invalid: 'Hook JSON could not be parsed.', schema_unknown: 'Hook files have an unknown schema version.', trigger_unknown: 'A hook trigger was not recognised.', field_unrecognised: 'A configuration field was not recognised.',
 limit_files: 'The file limit was reached.', limit_hooks: 'The hook limit was reached.', limit_roots: 'The root limit was reached; at most 8 local folders are checked.', limit_bytes: 'The read-byte limit was reached.', limit_time: 'The review time limit was reached.', cancelled: 'The review was cancelled.',
};
const TITLES: Record<FindingId, string> = { S1: 'Large Steering file is always included', S2: 'Large AGENTS.md is always included', S3: 'Always-included files add up', S4: 'Steering file matches every file', H1: 'Hook runs on every file change', H2: 'Hook runs on every tool use', H3: 'Hook runs on every prompt or stop', H4: 'Hook has a large prompt', H5: 'Hooks may overlap' };
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
 S1: 'Load only when needed', S2: 'Open the file to move detail into focused Steering files', S3: 'Review narrower inclusion for contributors', S4: 'Narrow the pattern',
 H1: 'Run only manually or disable', H2: 'Run only manually or disable', H3: 'Run only manually or disable (optional)', H4: 'Keep the agent prompt concise, run it only manually or disable it', H5: 'Review the overlapping automation',
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
/** Only fixed text and validated relative file names reach an untitled document. Never a root or a hook name. Only S3 and H5, which have no apply action, have a suggestion. */
export function configPreview(review: ConfigReview, finding: ConfigFinding): string | undefined {
 if (finding.id !== 'S3' && finding.id !== 'H5') return undefined;
 const locations = finding.id === 'S3' ? review.alwaysIncluded.contributors.slice(0, 3) : finding.related ?? [finding];
 if (!locations.length || locations.some(loc => !safeFile(loc.rel))) return undefined;
 const header = `${PREVIEW_HEADER}\n# ${locations.map(loc => location(review, loc)).join('; ')}\n\n`;
 if (finding.id === 'H5') return header + 'Review whether these hooks need to run for the same event. Keep the automation you need and review disabling or narrowing any redundant hook. No matcher is generated.\n';
 return locations.every(loc => loc.rel === 'AGENTS.md') ? header + 'AGENTS.md has no inclusion modes. Review moving detailed sections into focused Steering files with manual or fileMatch inclusion. The combined size is a lower bound; cross-root aggregation is an inference from Kiro documentation.\n' : header + 'Review the listed Steering contributors individually; AGENTS.md has no inclusion modes. The combined size is a lower bound; cross-root aggregation is an inference from Kiro documentation.\n\n' + MANUAL + '\n';
}

// Why and alternatives in plain words, for tooltips only; technical terms (inclusion: manual, trigger: Manual) appear here and in the change preview, never in headings.
const ALT: Record<FindingId, string> = {
 S1: 'Load only when needed sets inclusion: manual, so Kiro loads the file only when you reference it with #. Alternatives: fileMatch for specific files, or split the file.',
 S2: 'Alternative: move detailed sections into focused Steering files with manual or fileMatch inclusion.',
 S3: 'Alternative: review narrower inclusion for the listed files, or split large files.',
 S4: 'Narrow the pattern selects the value so you can type the files it should apply to. Alternative: load the file only when needed (inclusion: manual).',
 H1: 'Run only manually sets trigger: Manual, so the hook runs only when you start it. Alternatives: narrow the matcher, use a shell command action (Kiro documents that command actions do not use credits), or disable the hook.',
 H2: 'Run only manually sets trigger: Manual, so the hook runs only when you start it. Alternatives: narrow the matcher, use a shell command action (Kiro documents that command actions do not use credits), or disable the hook.',
 H3: 'Optional: Run only manually sets trigger: Manual, so the hook runs only when you start it. Alternatives: use a shell command action (Kiro documents that command actions do not use credits), or disable the hook.',
 H4: 'Run only manually sets trigger: Manual, so the hook runs only when you start it. Alternatives: keep the prompt shorter, use a shell command action, or disable the hook.',
 H5: 'Alternative: keep the automation you need and narrow or disable the redundant hook.',
};
const RUN_WHEN: Partial<Record<FindingId, string>> = { H1: 'on every matching file change', H2: 'on every matching tool use', H3: 'whenever you submit a prompt or the agent stops', H4: 'with a large prompt' };
/** The annotation of one change in the editor's change preview: the short why and the alternatives. Fixed text and a size only, never a name or a path. */
export function configAnnotation(action: ConfigApplyAction, finding: Pick<ConfigFinding, 'id' | 'size'>): { label: string; description: string } {
 if (action === 'loadWhenNeeded') return { label: 'Load only when needed', description: `Always-included Steering is added to every request${finding.size === undefined ? '' : ` (${formatSize(finding.size)})`}. With inclusion: manual Kiro loads it only when you reference it with #. Alternatives: fileMatch for specific files, or split the file.` };
 if (action === 'runManually') return { label: 'Run only manually', description: `This hook starts agent work ${RUN_WHEN[finding.id] ?? 'automatically'}, and each run uses credits. With trigger: Manual it runs only when you start it. Alternatives: narrow the matcher, use a shell command action, or disable the hook.` };
 return { label: 'Disable hook', description: 'The hook stays in its file but is turned off (enabled: false). Alternative: Run only manually.' };
}
type GroupKey = 'load' | 'run' | 'look';
/** Large always-included Steering loads only when needed; agent hooks run only manually; everything else gets no automatic change. */
const groupOf = (id: FindingId): GroupKey => id === 'S1' ? 'load' : id === 'H1' || id === 'H2' || id === 'H3' || id === 'H4' ? 'run' : 'look';
const GROUPS: Record<GroupKey, { label: string; description: string; tooltip: string; icon: string; context: string }> = {
 load: { label: 'Load only when needed', description: 'Kiro loads the file only when you reference it', icon: 'cloud-download', context: 'config-group-load',
  tooltip: 'Always-included Steering is added to every request. Load only when needed… shows a change preview that makes a file load only when you reference it with # (inclusion: manual). Alternatives: fileMatch for specific files, or split the file. Nothing changes until you save.' },
 run: { label: 'Run only manually', description: 'the hook runs only when you start it', icon: 'play', context: 'config-group-run',
  tooltip: 'These hooks start agent work automatically, and each run uses credits. Run only manually… shows a change preview that makes a hook run only when you start it (trigger: Manual). Alternatives: narrow the matcher, use a shell command action, or disable the hook. Nothing changes until you save.' },
 look: { label: 'Worth a look', description: 'no automatic change', icon: 'search', context: 'config-group', tooltip: 'Bobert makes no automatic change for these. Open an item for the reason and what you could do.' },
};
/** Largest first (bytes), then the more important notice, then the order of the review. */
const byImpact = (a: { f: ConfigFinding; i: number }, b: { f: ConfigFinding; i: number }): number => (b.f.size ?? -1) - (a.f.size ?? -1) || Number(b.f.severity === 'notice') - Number(a.f.severity === 'notice') || a.i - b.i;
function findingNode(review: ConfigReview, f: ConfigFinding, index: number, names: readonly string[], fresh = false, pending = false): ConfigNode {
 const ordinal = f.id === 'S3' ? 'Across checked roots' : location(review, f);
 const hook = f.hook === undefined ? undefined : review.roots.find(r => r.root === f.root)?.hooks.find(h => h.rel === f.rel && h.index === f.hook);
 const suffix = hook?.name ? ` · ${escapeText(Array.from(hook.name).slice(0, 60).join(''))}` : '';
 const basis = f.behaviour === 'inferred' ? CONFIG_BASIS[2] : f.threshold === 'heuristic' ? CONFIG_BASIS[1] : CONFIG_BASIS[0];
 const credit = f.id.startsWith('S') ? CONFIG_CREDITS[1] : f.id === 'H5' && f.agentHooks === 0 ? CONFIG_CREDITS[2] : CONFIG_CREDITS[0];
 const preview = configPreview(review, f), actions = configActions(f), applies = groupOf(f.id) !== 'look';
 const gaps = f.id === 'S3' && review.alwaysIncluded.incomplete ? ['Some configuration was not checked; the lower bound may omit additional always-included files.'] : [];
 const details = f.id === 'S3' ? review.alwaysIncluded.contributors.slice(0,3).map(c => `${escapeText(names[c.root] ?? '')}: ${location(review,c)} · ${formatSize(c.size)}`) : (f.related ?? []).map(c => `${escapeText(names[c.root] ?? '')}: ${location(review,c)}`);
 return node(`config:f:${index}`, `${TITLES[f.id]} · ${ordinal}${suffix}`, {
  description: pending ? PREPARED_DESCRIPTION : [fresh ? 'new this session' : '', names[f.root] === undefined ? '' : escapeText(names[f.root]!), f.size === undefined ? '' : `${f.id === 'S3' ? 'at least' : 'about'} ${formatSize(f.size)}`, applies ? '' : NEXT[f.id]].filter(Boolean).join(' · '),
  tooltip: [TITLES[f.id], ordinal, ...(pending ? ['The change is prepared but not saved. Save the file to apply it.'] : []), WHY[f.id], ALT[f.id], basis, credit, 'Being listed does not mean the setting is wrong.', ...details, ...gaps, ...(applies ? [] : [NEXT[f.id]]), ...(actions.length ? [applies ? EDIT_NOTE : OPEN_NOTE] : []), ...(['S1','S3'].includes(f.id) ? [CLI_NOTE] : [])].join('\n'),
  icon: pending ? 'edit' : 'info', contextValue: CONTEXT[f.id], finding: f, ...(preview ? {action:'previewKiroConfig' as const} : {}),
 });
}
/** How a result was produced (automatic mode, section 4.1). `fresh` holds finding indices first seen after this window's first review. In memory only. */
/** `prepared` holds finding indices whose file has a prepared edit that is still unsaved. */
export interface ConfigTreeState { automatic?: boolean; paused?: boolean; fresh?: ReadonlySet<number>; prepared?: ReadonlySet<number> }
/** What the combined status line may say about the review: counts and times only. */
export interface ConfigSummary { reviewed: boolean; findings: number; checkedAt?: string; partial: boolean; paused: boolean; automatic: boolean }
export function configSummary(review?: ConfigReview, checkedAt?: string, state: ConfigTreeState = {}): ConfigSummary {
 return { reviewed: !!review, findings: review?.findings.length ?? 0, checkedAt, partial: !!review && review.status !== 'complete', paused: !!state.paused, automatic: !!state.automatic };
}
/** The top-level nodes of the review in display order: the three groups, then Not checked. Its own native plain-text section; no audit result, summary, clipboard or persistence state. */
export function configTree(review?: ConfigReview, names: readonly string[] = [], refused: readonly RefusedConfigRoot[] = [], generation = 0, state: ConfigTreeState = {}): ConfigNode[] {
 const top: ConfigNode[] = [];
 if (review) {
  const indexed = review.findings.map((f,i) => ({f,i}));
  for (const key of ['load','run','look'] as const) {
   const found = indexed.filter(x => groupOf(x.f.id) === key).sort(byImpact), g = GROUPS[key];
   if (!found.length) continue;
   const items = found.map(x => findingNode(review,x.f,x.i,names,state.fresh?.has(x.i),state.prepared?.has(x.i)));
   top.push(node(`config:g:${key}`, `${g.label} (${found.length})`, { description: g.description, tooltip: g.tooltip, icon: g.icon, contextValue: g.context, expanded: false, children: items }));
  }
  const gaps = NOT_CHECKED_CODES.filter(code => review.notChecked[code]).map((code,index) => node(`config:n:${index}`,NOT_CHECKED[code],{description:`${review.notChecked[code]}`,tooltip:NOT_CHECKED[code]}));
  for (const [i,r] of refused.entries()) gaps.push(node(`config:r:${i}`,escapeText(r.name),{description:NOT_CHECKED[r.code],tooltip: r.reason ? `Not checked: ${r.reason}.` : NOT_CHECKED[r.code],icon:'warning'}));
  const nested = review.roots.reduce((sum,r)=>sum+r.nestedNotChecked,0);
  if (nested) gaps.push(node('config:nested','Nested configuration folders are not checked.',{description:`${nested}`}));
  for (const [i,loc] of review.patternNotAnalysed.entries()) gaps.push(node(`config:p:${i}`,`${location(review,loc)} · Pattern too broad to judge`,{tooltip:'The pattern was not analysed. Its text is not shown.'}));
  if (gaps.length) top.push(node('config:unchecked','Not checked',{description:`${Object.values(review.notChecked).reduce((sum,n)=>sum+(n??0),0)+refused.length+nested+review.patternNotAnalysed.length} items`,children:gaps,icon:'warning',contextValue:'config-group',expanded:false}));
 }
 // Group ids stay the same across refreshes, so the editor keeps what the user expanded or collapsed; items carry the generation.
 const identify = (nodes: ConfigNode[]): void => { for (const n of nodes) { n.generation = generation; if (!n.id.startsWith('config:g:') && n.id !== 'config:unchecked') n.id += `:${generation}`; if (n.children) identify(n.children); } };
 identify(top);
 return top;
}

export type ViewNode = AuditNode | ConfigNode;
export type AutoMode = 'off' | 'onOpen' | 'onOpenAndChanges';
const WHEN: Record<Exclude<AutoMode, 'off'>, string> = { onOpen: 'on open', onOpenAndChanges: 'on open and on changes' };
/** When the checks run again by themselves, from the two user settings ('' when neither does). */
export function recheckText(audit: AutoMode, config: AutoMode): string {
 if (audit === 'off' && config === 'off') return '';
 return audit === config ? `checks again ${WHEN[audit as Exclude<AutoMode, 'off'>]}` : 'some checks run again automatically';
}
const NO_CHANGES = 'No findings in the checked configuration.';
/**
 * The whole Audit view in display order: the status line (time of the check, number of suggestions, size Kiro may read, when it checks again), the filename audit's
 * notes, the groups by action (Exclude from Kiro, Load only when needed, Run only manually, Worth a look), the hidden/omitted footers and Not checked.
 * Empty (so the view's welcome text shows) when neither the audit nor the review has produced anything.
 */
export function reviewTree(audit: AuditParts | undefined, config: ConfigSummary | undefined, configNodes: readonly ConfigNode[], automatic: { audit: AutoMode; config: AutoMode }, now: Date = new Date(), preparedFiles = 0): ViewNode[] {
 const reviewed = !!config?.reviewed;
 if (!audit && !reviewed && configNodes.length === 0) return [];
 const out: ViewNode[] = [];
 if (audit?.unavailable) out.push(audit.unavailable);
 const stats = audit?.stats;
 if (stats || reviewed) {
  const suggestions = (stats?.suggestions ?? 0) + (config?.findings ?? 0);
  const time = checkedLabel(stats?.checkedAt ?? config?.checkedAt, now), again = recheckText(automatic.audit, automatic.config);
  const label = [time ? `Checked ${time}` : '', suggestions === 0 ? 'nothing to suggest' : `${suggestions} ${suggestions === 1 ? 'suggestion' : 'suggestions'}`].filter(Boolean).join(' · ');
  const partial = !!stats?.partial || !!config?.partial;
  out.push({ id: 'status', kind: 'header', label: label.charAt(0).toUpperCase() + label.slice(1),
   description: [stats?.size, !stats && config?.automatic ? 'checked automatically' : '', again, partial ? 'partial check' : '', preparedFiles > 0 ? unsavedFilesText(preparedFiles) : '', config?.paused ? 'automatic review paused (many changes)' : ''].filter(Boolean).join(' · ') || undefined,
   tooltip: [stats?.folder ? `Folder: ${stats.folder}` : '', ...(stats?.notes ?? []), ...(reviewed && config!.findings === 0 ? [NO_CHANGES] : []), CONFIG_EXCLUSIONS].filter(Boolean).join('\n'),
   icon: partial ? 'warning' : suggestions > 0 ? 'eye' : 'pass', contextValue: 'header' });
 }
 out.push(...(audit?.info ?? []));
 if (audit?.exclude) out.push(audit.exclude);
 const unchecked = configNodes.filter(n => n.id.startsWith('config:unchecked'));
 out.push(...configNodes.filter(n => !unchecked.includes(n)), ...(audit?.footers ?? []), ...unchecked);
 return out;
}
