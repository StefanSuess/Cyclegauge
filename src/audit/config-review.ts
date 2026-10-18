import { CONFIG_LIMITS, createConfigBudget, listConfigFiles, readHookFile, readSteeringFile, statAgents, type ConfigFs, type ConfigReadCode } from './config-read.ts';
import { countNotChecked, evaluateConfigRules, hookNotCheckedCodes, type ConfigRootEntries, type HookEntry, type NotChecked, type NotCheckedCode } from './config-rules.ts';
export const CONFIG_MAX_ROOTS = 8;
export type ConfigReviewRoot = string | { code: 'untrusted' | 'root_refused' | 'root_not_local' };
export interface RootReview extends Omit<ConfigRootEntries, 'hooks'> { hooks: Omit<HookEntry, 'matcherKey'>[]; nestedNotChecked: number }
export interface ConfigReview extends ReturnType<typeof evaluateConfigRules> { status: 'complete' | 'partial' | 'unavailable'; roots: RootReview[]; bytesRead: number }
interface Options { fs?: ConfigFs; now?: () => number; yield?: () => Promise<void> }
// Strings must already pass the caller's trust, local-root, refusal and real-path deduplication guards.
// This module owns no editor state. Concurrent calls join the current run, including its signal/roots.
export function createConfigReviewer(options: Options = {}): { review(roots: readonly ConfigReviewRoot[], options?: { signal?: AbortSignal }): Promise<ConfigReview> } {
 let inFlight: Promise<ConfigReview> | undefined;
 const now = options.now ?? Date.now, yieldFile = options.yield ?? (() => new Promise<void>(resolve => setImmediate(resolve)));
 async function run(inputs: readonly ConfigReviewRoot[], signal?: AbortSignal): Promise<ConfigReview> {
  const budget = createConfigBudget({ now }), roots: (ConfigRootEntries & { nestedNotChecked: number })[] = [], notChecked: NotChecked = {};
  let halted = false, present = false;
  const note = (code: NotCheckedCode, count = 1) => { countNotChecked(notChecked, code, count); };
  const fail = (code: ConfigReadCode | 'json_invalid' | 'schema_unknown', root: ConfigRootEntries) => {
   const mapped = code === 'time_limit' ? 'limit_time' : code === 'not_allowed' ? 'file_unsafe' : code;
   note(mapped); root.incomplete = true;
   if (mapped === 'cancelled' || mapped === 'limit_time' || mapped === 'limit_bytes') halted = true;
  };
  const stop = () => {
   if (halted) return true;
   if (signal?.aborted) { note('cancelled'); halted = true; }
   else if (now() - budget.started > CONFIG_LIMITS.timeMs) { note('limit_time'); halted = true; }
   return halted;
  };
  note('limit_roots', Math.max(0, inputs.length - CONFIG_MAX_ROOTS));
  const io = { fs: options.fs, signal, now, budget };
  for (const [index, input] of inputs.slice(0, CONFIG_MAX_ROOTS).entries()) {
   if (stop()) break;
   if (typeof input !== 'string') { note(input.code); continue; }
   const root: ConfigRootEntries & { nestedNotChecked: number } = { root: index, steering: [], hooks: [], nestedNotChecked: 0 };
   roots.push(root); let absent = 0;
   try {
    const agents = await statAgents(input, io);
    if ('size' in agents) { root.agents = agents; present = true; }
    else if ('code' in agents) fail(agents.code, root); else absent++;
    for (const kind of ['steering', 'hooks'] as const) {
     if (stop()) break;
     const listing = await listConfigFiles(input, kind, io);
     if ('absent' in listing) { absent++; continue; }
     present = true;
     if ('code' in listing) { fail(listing.code, root); continue; }
     note('limit_files', listing.omitted); note('name_unsafe', listing.unsafe);
     root.nestedNotChecked += listing.nested;
     if (listing.omitted || listing.unsafe || listing.nested) root.incomplete = true;
     for (const rel of listing.files) {
      if (stop()) break;
      if (kind === 'steering') {
       const result = await readSteeringFile(input, rel, budget, io);
       if ('entry' in result) { root.steering.push({ rel, ...result.entry }); if (result.entry.mode === 'unrecognised' || (result.entry.mode === 'fileMatch' && (result.entry.matchAll === 'unknown' || result.entry.broadUncertain))) root.incomplete = true; }
       else fail('code' in result ? result.code : 'file_unreadable', root);
      } else {
       const result = await readHookFile(input, rel, budget, io);
       if ('hooks' in result) { root.hooks.push(...result.hooks.map(hook => ({ rel, ...hook }))); note('limit_hooks', result.omitted); if (result.omitted || result.hooks.some(hook => hookNotCheckedCodes(hook).length > 0)) root.incomplete = true; }
       else if ('code' in result && (result.code === 'json_invalid' || result.code === 'schema_unknown')) { note(result.code); root.incomplete = true; }
       else fail('code' in result ? result.code : 'file_unreadable', root);
      }
      await yieldFile();
     }
    }
   } catch { note('file_unreadable'); root.incomplete = true; }
   if (stop()) root.incomplete = true;
   if (absent === 3) note('no_kiro_config');
  }
  stop();
  const evaluated = evaluateConfigRules(roots);
  for (const [code, count] of Object.entries(evaluated.notChecked)) note(code as NotCheckedCode, count);
  const partial = roots.some(root => root.incomplete) || Object.keys(notChecked).some(code => code !== 'no_kiro_config');
  evaluated.alwaysIncluded.incomplete ||= partial;
  // Only the sidebar projection survives. Equality keys and the run-local interner stay here.
  const projected: RootReview[] = roots.map(root => ({ ...root, hooks: root.hooks.map(({ matcherKey: _key, ...hook }) => hook) }));
  return { ...evaluated, notChecked, roots: projected, bytesRead: budget.bytesRead, status: !roots.length && !present && partial && !halted ? 'unavailable' : partial ? 'partial' : 'complete' };
 }
 return { review(inputs, options = {}) {
  if (inFlight) return inFlight;
  inFlight = run(inputs, options.signal).finally(() => { inFlight = undefined; });
  return inFlight;
 } };
}
