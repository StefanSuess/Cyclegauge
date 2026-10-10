// Milestone 6, Task 1A: Windows ACL proof-of-concept (plan section 3, items 1-7).
//
//   node scripts/poc/win-acl/poc.ts [--skip-profile] [--markdown-file <path>]
//
// Everything is synthetic: fixtures are created under a fresh directory in the OS temp location and
// removed afterwards. The only other thing read is the *directory descriptors* (never contents) of
// the %LOCALAPPDATA% ancestor chain, which `--skip-profile` turns off. No Kiro path is touched.
//
// The report contains fixed tokens, counts and booleans only: no SID, user name or path. Every
// string is checked against a strict pattern and the final text is scanned for the process's own
// private values before anything is printed.
import { appendFileSync, linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { arch, homedir, release, tmpdir, userInfo } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noSymlinks, inside } from '../../../src/paths.ts';
import {
 SID_ADMINISTRATORS, SID_SYSTEM, evaluateAncestor, evaluateDirectory, evaluateFile, isTrusted, tryParse,
 type Context, type Descriptor, type Verdict,
} from './sddl.ts';
import {
 ToolError, currentUser, icacls, parseBatch, powershellExe, readDescriptors, readFacts, runTool, startSampler, systemExe, tokenFacts,
 type DescriptorEntry, type Facts,
} from './tools.ts';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Status = 'established' | 'partial' | 'not_established' | 'not_applicable' | 'error';
export interface Item { status: Status; code: string; data: Record<string, Json> }
export interface Report { schema: string; environment: Record<string, Json>; items: Record<string, Item> }

const REPARSE = 0x400, DIRECTORY = 0x10;
const SAFE_STRING = /^[A-Za-z0-9_.:+\-]{0,64}$/;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const fixedCode = (e: unknown): string => {
 if (e instanceof ToolError) return e.code;
 const c = (e as { code?: unknown })?.code;
 if (typeof c === 'string' && /^[A-Z0-9_]{2,24}$/.test(c)) return c.startsWith('ACL_') || c.startsWith('TOOL_') || c.startsWith('PATH_') ? c : `FS_${c}`;
 return 'POC_INTERNAL_ERROR';
};

/** Refuse to emit any string that is not a short fixed token. */
export function sanitize(value: Json): Json {
 if (typeof value === 'string') { if (!SAFE_STRING.test(value) || /S-\d+-\d+/.test(value)) throw new ToolError('REPORT_VALUE_REJECTED'); return value; }
 if (Array.isArray(value)) return value.map(sanitize);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => { sanitize(k); return [k, sanitize(v)]; }));
 return value;
}

/**
 * Evidence-preserving variant used by the CLI: a value that is not a fixed token is replaced by
 * `REJECTED` and its key path is listed, so one odd value cannot discard the whole report.
 */
export function sanitizeLenient(value: Json, path = '', rejected: string[] = []): { value: Json; rejected: string[] } {
 if (typeof value === 'string') {
  if (SAFE_STRING.test(value) && !/S-\d+-\d+/.test(value)) return { value, rejected };
  rejected.push(path || 'root');
  return { value: 'REJECTED', rejected };
 }
 if (Array.isArray(value)) return { value: value.map((v, i) => sanitizeLenient(v, `${path}[${i}]`, rejected).value), rejected };
 if (value && typeof value === 'object') {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value)) {
   const key = SAFE_STRING.test(k) ? k : 'REJECTED_KEY';
   out[key] = sanitizeLenient(v, path ? `${path}.${key}` : key, rejected).value;
  }
  return { value: out, rejected };
 }
 return { value, rejected };
}

/** Last line of defence: the serialised report must not contain this process's private values. */
export function assertNoLeak(text: string, forbidden: string[]): void {
 for (const f of forbidden) {
  if (f.length < 3) continue;
  // Values are matched as whole tokens so a user named `admin` does not trip on `administrators`.
  const token = new RegExp(`(?<![A-Za-z0-9_])${f.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i');
  if (token.test(text) || (f.includes('\\') && text.includes(f.replaceAll('\\', '\\\\')))) throw new ToolError('REPORT_LEAK_GUARD');
 }
 if (/S-1-5-21-\d/.test(text) || /[A-Za-z]:\\/.test(text) || /[A-Za-z]:\\\\/.test(text)) throw new ToolError('REPORT_LEAK_GUARD');
}

interface Judged { ok: boolean; code: string; offenders: Record<string, number>; notes: string[] }
type Role = 'ancestor' | 'parent' | 'dir' | 'file';

function judgeDescriptor(d: Descriptor, role: Role, ctx: Context): Verdict {
 if (role === 'ancestor') return evaluateAncestor(d, ctx);
 if (role === 'file') return evaluateFile(d, ctx);
 return evaluateDirectory(d, ctx, { requireProtected: role === 'dir' });
}

function judge(entry: DescriptorEntry, role: Role, ctx: Context): Judged {
 const bad = (code: string): Judged => ({ ok: false, code, offenders: {}, notes: [] });
 if ('error' in entry) return bad('ACL_READ_FAILED');
 if (entry.attrs & REPARSE) return bad('PATH_REPARSE_POINT');
 if (role !== 'file' && !(entry.attrs & DIRECTORY)) return bad('PATH_NOT_DIRECTORY');
 if (role === 'file' && (entry.attrs & DIRECTORY)) return bad('PATH_NOT_FILE');
 const d = tryParse(entry.sddl);
 if ('error' in d) return bad(d.error);
 const v = judgeDescriptor(d, role, ctx);
 return v.ok ? { ok: true, code: 'OK', offenders: {}, notes: v.notes } : { ok: false, code: v.code, offenders: v.offenders, notes: [] };
}

const descriptorOf = (e: DescriptorEntry): Descriptor | undefined => {
 if ('error' in e) return undefined;
 const d = tryParse(e.sddl);
 return 'error' in d ? undefined : d;
};
const aceKey = (d: Descriptor) => d.dacl.aces.map(a => `${a.type}:${a.trustee}:${a.rights}`).sort().join('|');
const ancestorsOf = (path: string): string[] => {
 const out: string[] = [];
 for (let p = win32.resolve(path); ; p = win32.dirname(p)) { out.unshift(p); if (win32.dirname(p) === p) break; }
 return out;
};
const pct = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, p50_ms: pct(s, 0.5), p95_ms: pct(s, 0.95), max_ms: s[s.length - 1] }; };

interface Run { root: string; user: string; ctx: Context; skipProfile: boolean }

// Fixture helper: a directory whose DACL is protected and holds only T entries (explicit, inheritable).
async function lockdown(dir: string, user: string): Promise<void> {
 await icacls([dir, '/inheritance:r', '/grant:r', `*${SID_SYSTEM}:(OI)(CI)F`, `*${SID_ADMINISTRATORS}:(OI)(CI)F`, `*${user}:(OI)(CI)F`]);
}
const BUILTIN_USERS = '*S-1-5-32-545';

async function item1(run: Run): Promise<Item> {
 const { sid } = await currentUser();
 const token = await tokenFacts();
 const probe = join(run.root, 'sid-probe.bin');
 writeFileSync(probe, Buffer.alloc(8), { flag: 'wx' });
 const read = await readDescriptors([probe]);
 const d = descriptorOf(read.entries[0]);
 const ownerOk = d?.owner !== undefined && (d.owner === sid || d.owner === SID_ADMINISTRATORS);
 const facts = await readFacts(win32.parse(run.root).root.slice(0, 2));
 return {
  status: ownerOk ? 'established' : 'not_established', code: ownerOk ? 'OK' : 'ACL_OWNER_MISMATCH',
  data: {
   sid_parsed: true, owner_is_user_or_administrators: ownerOk, integrity_level: token.integrity,
   administrators_group_listed: token.administratorsListed, ui_culture: facts.uiCulture, locales_observed: 1,
   locale_independence: 'structural_only', method: 'whoami_csv_sid_column',
  },
 };
}

async function item2(run: Run): Promise<Item> {
 const probe = join(run.root, 'sid-probe.bin');
 const paths = [run.root, probe];
 const full = await readDescriptors(paths);
 const clm = await readDescriptors(paths, { clm: true });
 const drive = win32.parse(run.root).root.slice(0, 2);
 const facts: Facts = await readFacts(drive, { clm: true });
 const token = await tokenFacts();
 const okAll = (r: typeof full) => r.entries.every(e => !('error' in e));
 const same = okAll(full) && okAll(clm) && full.entries.every((e, i) => JSON.stringify(e) === JSON.stringify(clm.entries[i]));
 const clmEffective = clm.languageMode === 'ConstrainedLanguage' && facts.languageMode === 'ConstrainedLanguage';
 const elevated = token.integrity === 'high' || token.integrity === 'system';
 let status: Status = 'established', code = 'OK';
 if (!okAll(full) || !okAll(clm)) { status = 'not_established'; code = 'ACL_READ_FAILED'; }
 else if (!clmEffective) { status = 'not_established'; code = 'CLM_NOT_EFFECTIVE'; }
 else if (elevated) { status = 'partial'; code = 'RUNNER_ELEVATED'; }
 return {
  status, code,
  data: {
   full_language_ok: okAll(full), constrained_language_ok: okAll(clm), constrained_mode_effective: clmEffective,
   results_identical: same, dotnet_methods_in_constrained_mode: facts.dotnetMethods, elevated,
   without_elevation: elevated ? 'not_observed' : 'observed', powershell_major_minor: facts.psVersion,
   volume_file_system: facts.fileSystem, drive_type: facts.driveType,
  },
 };
}

async function item3(run: Run): Promise<Item> {
 const parent = join(run.root, 'private-parent');
 mkdirSync(parent);
 await lockdown(parent, run.user);
 const count = 20;
 const paths = [parent];
 for (let i = 0; i < count; i++) {
  const child = join(parent, `synthetic-store-${i}`);
  mkdirSync(child); // single level, non-recursive: never adopts an existing name
  const key = join(child, 'device.key');
  writeFileSync(key, Buffer.alloc(32), { flag: 'wx' });
  paths.push(child, key);
 }
 const loose = join(run.root, 'loose-parent');
 mkdirSync(loose);
 await lockdown(loose, run.user);
 await icacls([loose, '/grant', `${BUILTIN_USERS}:(OI)(CI)M`]);
 const looseChild = join(loose, 'synthetic-store');
 mkdirSync(looseChild);
 paths.push(loose, looseChild);
 const read = await readDescriptors(paths);
 const e = read.entries;
 const parentJudged = judge(e[0], 'dir', run.ctx);
 let dirsOk = 0, filesOk = 0, allInherited = true;
 for (let i = 0; i < count; i++) {
  const dir = e[1 + 2 * i], file = e[2 + 2 * i];
  if (judge(dir, 'parent', run.ctx).ok) dirsOk++;
  if (judge(file, 'file', run.ctx).ok) filesOk++;
  for (const entry of [dir, file]) {
   const d = descriptorOf(entry);
   if (!d || d.dacl.aces.length === 0 || !d.dacl.aces.every(a => a.flags.includes('ID'))) allInherited = false;
  }
 }
 const looseParentVerdict = judge(e[e.length - 2], 'dir', run.ctx);
 const looseChildVerdict = judge(e[e.length - 1], 'parent', run.ctx);
 const ok = parentJudged.ok && dirsOk === count && filesOk === count && allInherited && !looseParentVerdict.ok && !looseChildVerdict.ok;
 return {
  status: ok ? 'established' : 'not_established', code: ok ? 'OK' : parentJudged.ok ? 'CHILD_NOT_T_ONLY' : 'PARENT_PRECONDITION_FAILED',
  data: {
   parent_passes_t_only_rule: parentJudged.ok, children_created: count, directories_t_only: dirsOk, files_t_only: filesOk,
   every_ace_inherited: allInherited, control_loose_parent_rejected: !looseParentVerdict.ok,
   control_child_of_loose_parent_rejected: !looseChildVerdict.ok, control_child_code: looseChildVerdict.code,
  },
 };
}

async function item4(run: Run): Promise<Item> {
 const parent = join(run.root, 'private-parent');
 const child = join(parent, 'synthetic-protect');
 mkdirSync(child);
 const [s0] = (await readDescriptors([child])).entries;
 const protectMs = await icacls([child, '/inheritance:d']);
 const [s1] = (await readDescriptors([child])).entries;
 const d0 = descriptorOf(s0), d1 = descriptorOf(s1);
 const v0 = judge(s0, 'parent', run.ctx), v1 = judge(s1, 'dir', run.ctx);
 const sameRights = !!d0 && !!d1 && aceKey(d0) === aceKey(d1);
 const explicitAfter = !!d1 && d1.dacl.aces.every(a => !a.flags.includes('ID'));

 // Later change of the parent must not propagate into the protected child, but does into an unprotected one.
 const parentB = join(run.root, 'private-parent-b');
 mkdirSync(parentB);
 await lockdown(parentB, run.user);
 const prot = join(parentB, 'protected'), open = join(parentB, 'unprotected');
 mkdirSync(prot); mkdirSync(open);
 await icacls([prot, '/inheritance:d']);
 await icacls([parentB, '/grant', `${BUILTIN_USERS}:(OI)(CI)M`]);
 const [protAfter, openAfter] = (await readDescriptors([prot, open])).entries;
 const protHolds = judge(protAfter, 'dir', run.ctx).ok;
 const openBroadened = !judge(openAfter, 'parent', run.ctx).ok;

 // Sample the descriptor from a second process while the protect step runs.
 const watched = join(parent, 'synthetic-sampled');
 mkdirSync(watched);
 const sampler = startSampler(watched, 4);
 await sampler.ready;
 await sleep(500);
 await icacls([watched, '/inheritance:d']);
 const out = await sampler.result;
 let failing = 0, protectedStates = 0, unprotectedStates = 0, readErrors = 0;
 for (const s of out.states) {
  if (s.sddl === 'ERR') { readErrors += s.count; continue; } // transient read failure, not a state
  const d = tryParse(s.sddl);
  const ok = !('error' in d) && evaluateDirectory(d, run.ctx, { requireProtected: false }).ok;
  if (!ok) failing++;
  else if (d.dacl.protectedDacl) protectedStates++; else unprotectedStates++;
 }
 const ok = v0.ok && v1.ok && sameRights && explicitAfter && protHolds && openBroadened && failing === 0;
 return {
  status: ok ? 'established' : 'not_established', code: ok ? 'OK' : 'PROTECT_STEP_VIOLATION',
  data: {
   before_t_only: v0.ok, after_t_only_and_protected: v1.ok, same_entries_before_after: sameRights, all_entries_explicit_after: explicitAfter,
   later_parent_change_blocked: protHolds, control_unprotected_child_broadened: openBroadened,
   sampler_samples: out.samples, sampler_distinct_states: out.states.length, sampler_states_failing: failing, sampler_read_errors: readErrors,
   sampler_unprotected_states: unprotectedStates, sampler_protected_states: protectedStates, protect_call_ms: protectMs,
   instant_observation: 'not_possible', atomicity_basis: 'documented_single_set_security_call',
  },
 };
}

async function item5(run: Run): Promise<Item> {
 const data: Record<string, Json> = {};
 let status: Status = 'established', code = 'OK';

 // Negative controls on synthetic directories: each must be judged as expected.
 const controls: { name: string; role: Role; expect: boolean; setup: (dir: string) => Promise<void> }[] = [
  ...(['D', 'DC', 'WDAC', 'WO', 'F', 'M'] as const).map(right => ({
   name: `ancestor_grant_${right.toLowerCase()}`, role: 'ancestor' as Role, expect: false,
   setup: async (dir: string) => { await lockdown(dir, run.user); await icacls([dir, '/grant', `${BUILTIN_USERS}:(${right})`]); },
  })),
  ...(['R', 'W'] as const).map(right => ({
   name: `ancestor_grant_${right.toLowerCase()}`, role: 'ancestor' as Role, expect: true,
   setup: async (dir: string) => { await lockdown(dir, run.user); await icacls([dir, '/grant', `${BUILTIN_USERS}:(${right})`]); },
  })),
  { name: 'directory_extra_trustee_read', role: 'dir', expect: false,
   setup: async dir => { await lockdown(dir, run.user); await icacls([dir, '/grant', `${BUILTIN_USERS}:(OI)(CI)R`]); } },
  { name: 'directory_deny_ace', role: 'dir', expect: false,
   setup: async dir => { await lockdown(dir, run.user); await icacls([dir, '/deny', `${BUILTIN_USERS}:(WEA)`]); } },
  { name: 'directory_inheritance_reenabled', role: 'dir', expect: false,
   setup: async dir => { await lockdown(dir, run.user); await icacls([dir, '/inheritance:e']); } },
  { name: 'directory_t_only_control', role: 'dir', expect: true, setup: async dir => lockdown(dir, run.user) },
 ];
 const base = join(run.root, 'controls');
 mkdirSync(base);
 const dirs = controls.map((c, i) => join(base, `c${i}`));
 for (let i = 0; i < controls.length; i++) { mkdirSync(dirs[i]); await controls[i].setup(dirs[i]); }
 const read = await readDescriptors(dirs);
 const wrong: string[] = [];
 controls.forEach((c, i) => { if (judge(read.entries[i], c.role, run.ctx).ok !== c.expect) wrong.push(c.name); });
 data.negative_controls = controls.length;
 data.negative_controls_as_expected = controls.length - wrong.length;
 data.negative_controls_mismatched = wrong;
 if (wrong.length) { status = 'not_established'; code = 'CONTROL_MISMATCH'; }

 // The real default-profile chain: descriptors of directories only.
 const local = process.env.LOCALAPPDATA;
 if (run.skipProfile || !local || !/^[A-Za-z]:\\/.test(local)) {
  data.profile_chain = 'skipped';
  return { status: status === 'established' ? 'partial' : status, code: status === 'established' ? 'PROFILE_NOT_READ' : code, data };
 }
 const chain = ancestorsOf(local);
 const prof = (await readDescriptors(chain)).entries;
 const levels = chain.length;
 const results = prof.map(e => judge(e, 'ancestor', run.ctx));
 const last = prof[prof.length - 1];
 data.profile_levels = levels;
 data.profile_ancestors_ok = results.filter(r => r.ok).length;
 data.profile_failing_levels = results.flatMap((r, i) => (r.ok ? [] : [`${i}:${r.code}`]));
 data.profile_failing_offender_categories = Object.fromEntries(results.flatMap(r => Object.entries(r.offenders)).reduce((m, [k, v]) => m.set(k, (m.get(k) ?? 0) + v), new Map<string, number>()));
 data.profile_levels_protected = prof.map(e => { const d = descriptorOf(e); return d?.dacl.protectedDacl ? 'P' : 'u'; }).join('');
 data.profile_leaf_as_parent_t_only = judge(last, 'parent', run.ctx).ok;
 data.profile_leaf_as_parent_t_only_code = judge(last, 'parent', run.ctx).code;
 data.profile_leaf_as_dir_protected = judge(last, 'dir', run.ctx).ok;
 data.profile_leaf_as_dir_protected_code = judge(last, 'dir', run.ctx).code;
 data.profile_reparse_levels = prof.filter(e => !('error' in e) && (e.attrs & REPARSE)).length;
 data.profile_scope = 'ci_runner_profile_not_win11_client';
 if (results.some(r => !r.ok) && status === 'established') { status = 'partial'; code = 'PROFILE_CHAIN_REJECTED'; }
 return { status, code, data };
}

async function item6(run: Run): Promise<Item> {
 const base = join(run.root, 'identity');
 mkdirSync(base);
 const data: Record<string, Json> = {};

 // Junction (no privilege needed) and a path that passes through one.
 const target = join(base, 'target-dir');
 mkdirSync(target);
 const junction = join(base, 'junction-link');
 symlinkSync(target, junction, 'junction');
 let strictRejects = false;
 try { noSymlinks(join(junction, 'child')); } catch { strictRejects = true; }
 const [junctionEntry] = (await readDescriptors([junction])).entries;
 data.junction_lstat_reports_link = lstatSync(junction).isSymbolicLink();
 data.junction_reparse_attribute = !('error' in junctionEntry) && (junctionEntry.attrs & REPARSE) !== 0;
 data.existing_guard_rejects_path_through_junction = strictRejects;
 let dirSymlink = 'not_testable_privilege';
 try { symlinkSync(target, join(base, 'dir-symlink'), 'dir'); dirSymlink = lstatSync(join(base, 'dir-symlink')).isSymbolicLink() ? 'lstat_reports_link' : 'lstat_misses_link'; } catch { /* needs privilege */ }
 data.directory_symlink = dirSymlink;

 // Hard link and file identity.
 const file = join(base, 'file.bin'), twin = join(base, 'twin.bin');
 writeFileSync(file, Buffer.alloc(4), { flag: 'wx' });
 const before = statSync(file, { bigint: true });
 linkSync(file, twin);
 const after = statSync(file, { bigint: true });
 const viaTwin = statSync(twin, { bigint: true });
 const upper = statSync(file.toUpperCase(), { bigint: true });
 data.nlink_new_file = Number(before.nlink);
 data.nlink_after_hard_link = Number(after.nlink);
 data.identity_same_through_hard_link = after.ino === viaTwin.ino && after.dev === viaTwin.dev;
 data.identity_same_through_case_variant = after.ino === upper.ino && after.dev === upper.dev;
 data.ino_bit_length = after.ino.toString(2).length;
 data.ino_exceeds_2_pow_53 = after.ino > 2n ** 53n;
 data.ino_survives_number_roundtrip = BigInt(Number(after.ino)) === after.ino;
 data.dev_is_bigint = typeof after.dev === 'bigint';

 // 8.3 names.
 const longDir = join(base, 'EasyKiroGaugeLongDirectoryName');
 mkdirSync(longDir);
 const sh = await runTool(powershellExe(), ['-NoProfile', '-NonInteractive', '-NoLogo', '-EncodedCommand', Buffer.from(
  "$f = New-Object -ComObject Scripting.FileSystemObject; Write-Output ('S|' + $f.GetFolder($env:EKG_PATHS).ShortPath)", 'utf16le').toString('base64')],
  { timeoutMs: 20000, env: { ...process.env, EKG_PATHS: longDir } });
 const shortPath = sh.code === 'OK' ? /^S\|(.+)$/m.exec(sh.stdout)?.[1]?.trim() : undefined;
 if (shortPath && shortPath.toLowerCase() !== longDir.toLowerCase()) {
  const a = statSync(longDir, { bigint: true }), b = statSync(shortPath, { bigint: true });
  data.short_names = 'enabled';
  data.identity_same_through_8dot3 = a.ino === b.ino && a.dev === b.dev;
  data.string_containment_misses_8dot3 = !inside(join(shortPath, 'x'), longDir);
  data.realpath_native_expands_8dot3 = realpathSync.native(shortPath).toLowerCase() === realpathSync.native(longDir).toLowerCase();
 } else {
  data.short_names = shortPath ? 'disabled_on_volume' : 'not_determined';
 }
 data.os_tmpdir_in_8dot3_form = tmpdir().toLowerCase() !== realpathSync.native(tmpdir()).toLowerCase();

 // Non-ASCII, space-containing names must survive the environment-variable transport.
 const odd = join(base, 'Ünï cödé 日本 space');
 mkdirSync(odd);
 const [oddEntry] = (await readDescriptors([odd])).entries;
 data.unicode_path_descriptor_read = !('error' in oddEntry);

 const ok = data.junction_lstat_reports_link === true && data.junction_reparse_attribute === true && strictRejects &&
  data.nlink_new_file === 1 && data.nlink_after_hard_link === 2 && data.identity_same_through_hard_link === true &&
  data.unicode_path_descriptor_read === true;
 return { status: ok ? 'established' : 'not_established', code: ok ? 'OK' : 'IDENTITY_ASSUMPTION_FAILED', data };
}

async function item7(run: Run): Promise<Item> {
 const paths = [run.root, join(run.root, 'private-parent'), join(run.root, 'identity'), join(run.root, 'controls')];
 const whoami: number[] = [], batch: number[] = [], batchClm: number[] = [], acl: number[] = [];
 for (let i = 0; i < 10; i++) {
  whoami.push((await currentUser()).ms);
  batch.push((await readDescriptors(paths)).ms);
  batchClm.push((await readDescriptors(paths, { clm: true })).ms);
  acl.push((await runTool(systemExe('icacls.exe'), [run.root], { timeoutMs: 20000 })).ms);
 }
 const open = stats(whoami).p95_ms + stats(batch).p95_ms;
 return {
  status: open < 1000 ? 'established' : 'partial', code: open < 1000 ? 'OK' : 'ASYNC_OPEN_REQUIRED',
  data: {
   whoami: stats(whoami), powershell_batch: stats(batch), powershell_batch_constrained: stats(batchClm), icacls_read: stats(acl),
   first_powershell_call_ms: batch[0], store_open_p95_estimate_ms: open, budget_ms: 1000, paths_per_batch: paths.length,
  },
 };
}

async function failureModes(run: Run): Promise<Item> {
 const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'NO_ERROR'; } catch (e) { return fixedCode(e); } };
 const missing = await runTool(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'no-such-tool.exe'), [], { timeoutMs: 5000 });
 const timeout = await runTool(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 5'], { timeoutMs: 100 });
 const limited = await runTool(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', "'x' * 5000000"], { timeoutMs: 20000, maxBytes: 1000 });
 const data: Record<string, Json> = {
  tool_missing: missing.code, tool_timeout: timeout.code, tool_output_limit: limited.code,
  garbage_output: await code(Promise.resolve().then(() => parseBatch('garbage', 1))),
  index_mismatch: await code(Promise.resolve().then(() => parseBatch('M|FullLanguage\nE|5', 1))),
  pipe_in_path: await code(readDescriptors([`${win32.parse(run.root).root}a|b`])),
  unc_path: await code(readDescriptors(['\\\\synthetic-host\\share\\dir'])),
  relative_path: await code(readDescriptors(['relative\\dir'])),
 };
 const ok = missing.code === 'TOOL_MISSING' && timeout.code === 'TOOL_TIMEOUT' && limited.code === 'TOOL_OUTPUT_LIMIT' &&
  data.garbage_output === 'ACL_UNPARSEABLE' && data.pipe_in_path === 'PATH_UNSUPPORTED' && data.unc_path === 'PATH_UNSUPPORTED';
 return { status: ok ? 'established' : 'not_established', code: ok ? 'OK' : 'FAILURE_MODE_MISMATCH', data };
}

export async function runEvidence(opts: { skipProfile?: boolean } = {}): Promise<{ report: Report; forbidden: string[] }> {
 if (process.platform !== 'win32') throw new ToolError('POC_NOT_WINDOWS');
 const { sid } = await currentUser();
 const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'synthetic-ekg-acl-'));
 const run: Run = { root, user: sid, ctx: { user: sid }, skipProfile: !!opts.skipProfile };
 const forbidden = [sid, root, tmpdir(), homedir(), userInfo().username, process.env.LOCALAPPDATA ?? '', process.env.USERPROFILE ?? ''];
 const items: Record<string, Item> = {};
 const step = async (name: string, fn: () => Promise<Item>) => {
  try { items[name] = await fn(); } catch (e) { items[name] = { status: 'error', code: fixedCode(e), data: {} }; }
 };
 await step('1_current_user_sid', () => item1(run));
 await step('2_descriptor_reads', () => item2(run));
 await step('3_creation_in_private_parent', () => item3(run));
 await step('4_protect_step', () => item4(run));
 await step('5_safe_path_rules', () => item5(run));
 await step('6_links_and_identity', () => item6(run));
 await step('7_launch_cost', () => item7(run));
 await step('8_failure_modes', () => failureModes(run));
 let cleanup = 'removed';
 try { rmSync(root, { recursive: true, force: true }); } catch { cleanup = 'left_behind'; }
 const facts = await readFacts(win32.parse(root).root.slice(0, 2)).catch(() => undefined);
 const token = await tokenFacts().catch(() => undefined);
 const report: Report = {
  schema: 'ekg-win-acl-poc.1',
  environment: {
   platform: process.platform, arch: arch(), node: process.version, os_release: release(),
   powershell_major_minor: facts?.psVersion ?? 'unknown', ui_culture: facts?.uiCulture ?? 'unknown',
   integrity_level: token?.integrity ?? 'unknown', volume_file_system: facts?.fileSystem ?? 'unknown', cleanup,
   github_runner_image: process.env.ImageOS ?? 'none',
  },
  items,
 };
 return { report, forbidden };
}

export function renderMarkdown(report: Report): string {
 const lines = ['### Windows ACL proof-of-concept (Task 1A)', '', `Environment: ${Object.entries(report.environment).map(([k, v]) => `${k}=${v}`).join(', ')}`, '', '| Item | Status | Code |', '| --- | --- | --- |'];
 for (const [name, item] of Object.entries(report.items)) lines.push(`| ${name} | ${item.status} | ${item.code} |`);
 lines.push('', '```json', JSON.stringify(report.items, null, 1), '```', '');
 return lines.join('\n');
}

async function main(): Promise<number> {
 const argv = process.argv.slice(2);
 const mdIndex = argv.indexOf('--markdown-file');
 try {
  const { report, forbidden } = await runEvidence({ skipProfile: argv.includes('--skip-profile') });
  const lenient = sanitizeLenient(report as unknown as Json);
  const clean = { ...(lenient.value as object), rejected_values: lenient.rejected } as unknown as Report;
  const text = JSON.stringify(clean, null, 1);
  assertNoLeak(text, forbidden);
  const markdown = renderMarkdown(clean);
  assertNoLeak(markdown, forbidden);
  process.stdout.write(text + '\n');
  if (mdIndex >= 0 && argv[mdIndex + 1]) appendFileSync(argv[mdIndex + 1], markdown);
  return 0;
 } catch (e) {
  process.stdout.write(JSON.stringify({ schema: 'ekg-win-acl-poc.1', error: fixedCode(e) }) + '\n');
  return e instanceof ToolError && e.code === 'POC_NOT_WINDOWS' ? 2 : 3;
 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 process.exitCode = await main();
}
