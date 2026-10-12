// Milestone 6, Task 1A proof-of-concept ONLY.
// Pure SDDL parsing and allowlist decisions used to judge what the Windows system tools report.
// The production module (src/sddl.ts, Task 4) is a separate deliverable that starts only after
// Security Checkpoint SC1. Nothing under src/ imports this file.
// Every failure is a fixed code; no input text, SID or path ever ends up in an error message.

export class SddlError extends Error {
 readonly code: string;
 constructor(code: string) { super(code); this.code = code; }
}

export const RIGHT = {
 FILE_WRITE_DATA: 0x2, FILE_APPEND_DATA: 0x4, FILE_DELETE_CHILD: 0x40,
 DELETE: 0x10000, READ_CONTROL: 0x20000, WRITE_DAC: 0x40000, WRITE_OWNER: 0x80000,
 FILE_ALL: 0x1f01ff,
} as const;
const GENERIC = { GA: 0x10000000, GR: 0x80000000, GW: 0x40000000, GX: 0x20000000 } as const;
const FILE_GENERIC = { GA: 0x1f01ff, GR: 0x120089, GW: 0x120116, GX: 0x1200a0 } as const;
// Two-letter SDDL right names. Bit values are what matters: the directory-service names (CC..CR)
// share bits with file rights, and `DT` is the bit that file ACLs call FILE_DELETE_CHILD.
const NAMED_RIGHTS: Record<string, number> = {
 GA: GENERIC.GA, GR: GENERIC.GR, GW: GENERIC.GW, GX: GENERIC.GX,
 FA: 0x1f01ff, FR: 0x120089, FW: 0x120116, FX: 0x1200a0,
 SD: 0x10000, RC: 0x20000, WD: 0x40000, WO: 0x80000,
 CC: 0x1, DC: 0x2, LC: 0x4, SW: 0x8, RP: 0x10, WP: 0x20, DT: 0x40, LO: 0x80, CR: 0x100,
};
// Rights that let a principal replace a path component or re-secure it.
export const REPLACE_MASK = RIGHT.DELETE | RIGHT.FILE_DELETE_CHILD | RIGHT.WRITE_DAC | RIGHT.WRITE_OWNER;

export const SID_SYSTEM = 'S-1-5-18';
export const SID_ADMINISTRATORS = 'S-1-5-32-544';
export const SID_TRUSTED_INSTALLER = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const SID_CREATOR_OWNER = 'S-1-3-0';
const SID_OWNER_RIGHTS = 'S-1-3-4';

// Aliases that resolve to one fixed SID on every machine.
const FIXED_ALIASES: Record<string, string> = {
 WD: 'S-1-1-0', CO: SID_CREATOR_OWNER, CG: 'S-1-3-1', OW: SID_OWNER_RIGHTS,
 NU: 'S-1-5-2', IU: 'S-1-5-4', SU: 'S-1-5-6', AN: 'S-1-5-7', ED: 'S-1-5-9', PS: 'S-1-5-10',
 AU: 'S-1-5-11', RC: 'S-1-5-12', SY: SID_SYSTEM, LS: 'S-1-5-19', NS: 'S-1-5-20',
 BA: SID_ADMINISTRATORS, BU: 'S-1-5-32-545', BG: 'S-1-5-32-546', PU: 'S-1-5-32-547',
 AO: 'S-1-5-32-548', SO: 'S-1-5-32-549', PO: 'S-1-5-32-550', BO: 'S-1-5-32-551', RE: 'S-1-5-32-552',
 RS: 'S-1-5-32-553', RU: 'S-1-5-32-554', RD: 'S-1-5-32-555', NO: 'S-1-5-32-556', MU: 'S-1-5-32-558',
 LU: 'S-1-5-32-559', CY: 'S-1-5-32-569', ER: 'S-1-5-32-573', CD: 'S-1-5-32-574', RA: 'S-1-5-32-575',
 ES: 'S-1-5-32-576', HA: 'S-1-5-32-578', AA: 'S-1-5-32-579', WR: 'S-1-5-33', UD: 'S-1-5-84-0-0-0-0-0',
 AC: 'S-1-15-2-1',
};
// Aliases relative to a machine or domain; recognised, never resolvable to one SID here.
const RELATIVE_ALIASES = new Set(['LA', 'LG', 'DA', 'DU', 'DG', 'DC', 'DD', 'EA', 'SA', 'PA', 'CA', 'AP', 'RO', 'KA', 'EK', 'RM']);
// Mandatory-label and similar aliases that may appear as trustees but are never principals we trust.
const LABEL_ALIASES = new Set(['LW', 'ME', 'MP', 'HI', 'SI']);

export interface Ace { type: string; flags: string[]; rights: number; trustee: string; plain: boolean }
export interface Dacl { present: boolean; protectedDacl: boolean; aces: Ace[] }
export interface Descriptor { owner?: string; group?: string; dacl: Dacl }

const SID_RE = /^S-1-\d+(?:-\d+)+$/;
const ACE_FLAGS = new Set(['CI', 'OI', 'NP', 'IO', 'ID']);
// Audit and critical flags are valid SDDL but never appear on a plain access-allowed ACE.
const KNOWN_FLAGS = new Set([...ACE_FLAGS, 'SA', 'FA', 'CR']);

function parseTrustee(raw: string): string {
 if (SID_RE.test(raw)) return raw;
 if (Object.hasOwn(FIXED_ALIASES, raw)) return FIXED_ALIASES[raw];
 if (RELATIVE_ALIASES.has(raw)) return `relative:${raw}`;
 if (LABEL_ALIASES.has(raw)) return `label:${raw}`;
 throw new SddlError('ACL_UNKNOWN_TOKEN');
}

function parseRights(raw: string): number {
 if (/^0x[0-9a-fA-F]{1,8}$/.test(raw)) return Number.parseInt(raw, 16);
 if (/^[0-9]{1,10}$/.test(raw)) return Number(raw);
 if (raw === '' || raw.length % 2) throw new SddlError('ACL_UNKNOWN_TOKEN');
 let mask = 0;
 for (let i = 0; i < raw.length; i += 2) {
  const name = raw.slice(i, i + 2);
  if (!Object.hasOwn(NAMED_RIGHTS, name)) throw new SddlError('ACL_UNKNOWN_TOKEN');
  mask |= NAMED_RIGHTS[name];
 }
 return mask >>> 0;
}

function parseAce(body: string, nested: boolean): Ace {
 const fields = body.split(';');
 // Reject ACEs we cannot parse safely; a zero-right placeholder could hide a conditional allow grant.
 if (nested || fields.length < 6 || fields.length > 7) throw new SddlError('ACL_UNKNOWN_TOKEN');
 const [type, flagText, rightsText, objectGuid, inheritGuid, trusteeText, extra] = fields;
 if (flagText.length % 2) throw new SddlError('ACL_UNKNOWN_TOKEN');
 const flags: string[] = [];
 for (let i = 0; i < flagText.length; i += 2) {
  const flag = flagText.slice(i, i + 2);
  if (!KNOWN_FLAGS.has(flag)) throw new SddlError('ACL_UNKNOWN_TOKEN');
  flags.push(flag);
 }
 const plainType = type === 'A' || type === 'D';
 const known = plainType || ['OA', 'OD', 'XA', 'XD', 'AU', 'AL', 'OU', 'OL', 'ML', 'ZA', 'SP', 'RA'].includes(type);
 if (!known) throw new SddlError('ACL_UNKNOWN_TOKEN');
 const plain = plainType && objectGuid === '' && inheritGuid === '' && (extra ?? '') === '' && flags.every(f => ACE_FLAGS.has(f));
 if (type === 'A' || type === 'D' || type === 'OA' || type === 'OD' || type === 'XA' || type === 'XD') {
  return { type, flags, rights: parseRights(rightsText), trustee: parseTrustee(trusteeText), plain };
 }
 // Audit, label and attribute ACEs are not access grants; they are kept only so DACL presence is explicit.
 return { type, flags, rights: 0, trustee: '', plain: false };
}

function readAces(text: string, start: number): { aces: Ace[]; end: number } {
 const aces: Ace[] = [];
 let i = start;
 while (text[i] === '(') {
  let depth = 0, j = i;
  for (; j < text.length; j++) {
   if (text[j] === '(') depth++;
   else if (text[j] === ')' && --depth === 0) break;
  }
  if (depth !== 0) throw new SddlError('ACL_MALFORMED');
  const inner = text.slice(i + 1, j);
  aces.push(parseAce(inner, inner.includes('(')));
  i = j + 1;
 }
 return { aces, end: i };
}

/** Parse the O:/G:/D:/S: string that PowerShell Get-Acl reports. Unknown tokens throw. */
export function parseSddl(text: string): Descriptor {
 if (typeof text !== 'string' || text.length === 0 || text.length > 65536 || /[\0\r\n]/.test(text)) throw new SddlError('ACL_MALFORMED');
 const d: Descriptor = { dacl: { present: false, protectedDacl: false, aces: [] } };
 const seen = new Set<string>();
 let i = 0;
 while (i < text.length) {
  const tag = text[i], colon = text[i + 1];
  if (!'OGDS'.includes(tag) || colon !== ':' || seen.has(tag)) throw new SddlError('ACL_MALFORMED');
  seen.add(tag); i += 2;
  if (tag === 'O' || tag === 'G') {
   const m = /^(S-1-\d+(?:-\d+)+|[A-Z]{2})/.exec(text.slice(i));
   if (!m) throw new SddlError('ACL_MALFORMED');
   const principal = parseTrustee(m[1]);
   if (tag === 'O') d.owner = principal; else d.group = principal;
   i += m[1].length;
   continue;
  }
  const m = /^(?:NO_ACCESS_CONTROL|P|AR|AI)*/.exec(text.slice(i))!;
  const flagText = m[0];
  i += flagText.length;
  const { aces, end } = readAces(text, i);
  i = end;
  if (tag === 'D') {
   // NO_ACCESS_CONTROL is the NULL DACL: everyone has every right.
   // The flag alphabet is P, AR, AI: a bare 'P' can only be the protected flag.
   d.dacl = { present: !flagText.includes('NO_ACCESS_CONTROL'), protectedDacl: flagText.replace('NO_ACCESS_CONTROL', '').includes('P'), aces };
  }
 }
 if (!seen.has('D')) d.dacl = { present: false, protectedDacl: false, aces: [] };
 return d;
}

/** Expand generic bits with the file-system generic mapping. */
export function fileRights(mask: number): number {
 let out = mask & ~(GENERIC.GA | GENERIC.GR | GENERIC.GW | GENERIC.GX);
 if (mask & GENERIC.GA) out |= FILE_GENERIC.GA;
 if (mask & GENERIC.GR) out |= FILE_GENERIC.GR;
 if (mask & GENERIC.GW) out |= FILE_GENERIC.GW;
 if (mask & GENERIC.GX) out |= FILE_GENERIC.GX;
 return out >>> 0;
}

export interface Context { user: string }
/**
 * SDDL renders the built-in RID-500 account as the alias `LA`. It is resolved only when the current
 * user's own SID has RID 500, in which case the alias can only mean that account.
 */
export function canonical(sid: string, ctx: Context): string {
 return sid === 'relative:LA' && /-500$/.test(ctx.user) ? ctx.user : sid;
}
export function isTrusted(sid: string, ctx: Context): boolean {
 sid = canonical(sid, ctx);
 return sid === ctx.user || sid === SID_SYSTEM || sid === SID_ADMINISTRATORS;
}

/** Fixed, non-identifying category of a trustee for diagnostics (never the SID itself). */
export function category(sid: string, ctx: Context): string {
 sid = canonical(sid, ctx);
 if (sid === ctx.user) return 'current_user';
 const named: Record<string, string> = {
  [SID_SYSTEM]: 'system', [SID_ADMINISTRATORS]: 'administrators', 'S-1-1-0': 'everyone', 'S-1-5-11': 'authenticated_users',
  'S-1-5-32-545': 'builtin_users', [SID_CREATOR_OWNER]: 'creator_owner', [SID_OWNER_RIGHTS]: 'owner_rights',
  'S-1-5-4': 'interactive', [SID_TRUSTED_INSTALLER]: 'trusted_installer', 'S-1-15-2-1': 'all_app_packages',
 };
 if (Object.hasOwn(named, sid)) return named[sid];
 if (sid.startsWith('relative:')) return 'account_group_relative';
 if (sid.startsWith('label:')) return 'integrity_label';
 if (/^S-1-5-32-/.test(sid)) return 'builtin_other';
 if (/^S-1-5-80-/.test(sid)) return 'service_sid';
 if (/^S-1-5-21-/.test(sid)) return 'account_or_group';
 if (/^S-1-15-/.test(sid)) return 'app_container';
 return 'other';
}

export type Verdict = { ok: true; notes: string[] } | { ok: false; code: string; offenders: Record<string, number> };
const pass = (notes: string[] = []): Verdict => ({ ok: true, notes });
const fail = (code: string, offenders: Record<string, number> = {}): Verdict => ({ ok: false, code, offenders });
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };

// CREATOR OWNER and OWNER RIGHTS resolve to the object's owner, which is checked separately.
function effectiveTrusted(sid: string, d: Descriptor, ctx: Context): boolean {
 if (sid === SID_CREATOR_OWNER || sid === SID_OWNER_RIGHTS) return d.owner !== undefined && isTrusted(d.owner, ctx);
 return isTrusted(sid, ctx);
}

function commonChecks(d: Descriptor, ctx: Context, ownerSet: (sid: string) => boolean): Verdict | undefined {
 if (d.owner === undefined || !ownerSet(d.owner)) return fail('ACL_OWNER_UNTRUSTED', { [category(d.owner ?? 'none', ctx)]: 1 });
 if (!d.dacl.present) return fail('ACL_DACL_MISSING');
 return undefined;
}

/** Reject anything that is not a plain allow ACE for a trusted trustee. */
function onlyPlainTrusted(d: Descriptor, ctx: Context): Verdict | undefined {
 const offenders: Record<string, number> = {};
 let code: string | undefined;
 for (const ace of d.dacl.aces) {
  if (ace.type === 'D' || ace.type === 'OD' || ace.type === 'XD') { code ??= 'ACL_DENY_ACE'; bump(offenders, 'deny_ace'); continue; }
  if (!ace.plain) { code ??= 'ACL_COMPLEX_ACE'; bump(offenders, 'complex_ace'); continue; }
  if (!effectiveTrusted(ace.trustee, d, ctx)) { code = code === undefined || code === 'ACL_TRUSTEE_OUTSIDE_T' ? 'ACL_TRUSTEE_OUTSIDE_T' : code; bump(offenders, category(ace.trustee, ctx)); }
 }
 return code ? fail(code, offenders) : undefined;
}

function userRights(d: Descriptor, ctx: Context) {
 let self = 0, objectInherit = 0, containerInherit = 0;
 for (const ace of d.dacl.aces) {
  if (ace.type !== 'A' || canonical(ace.trustee, ctx) !== ctx.user) continue;
  const r = fileRights(ace.rights);
  if (!ace.flags.includes('IO')) self |= r;
  if (ace.flags.includes('OI')) objectInherit |= r;
  if (ace.flags.includes('CI')) containerInherit |= r;
 }
 return { self, objectInherit, containerInherit };
}
const full = (r: number) => (r & RIGHT.FILE_ALL) === RIGHT.FILE_ALL;

/**
 * The storage directory rule of plan section 3. `requireProtected` is false when judging the
 * immediate parent, so the proof-of-concept can report both variants (an inherited, unprotected
 * %LOCALAPPDATA% would otherwise fail the literal wording).
 */
export function evaluateDirectory(d: Descriptor, ctx: Context, opts: { requireProtected: boolean }): Verdict {
 const early = commonChecks(d, ctx, sid => isTrusted(sid, ctx));
 if (early) return early;
 if (d.dacl.aces.length === 0) return fail('ACL_DACL_EMPTY');
 if (opts.requireProtected && !d.dacl.protectedDacl) return fail('ACL_NOT_PROTECTED');
 const rejected = onlyPlainTrusted(d, ctx);
 if (rejected) return rejected;
 const r = userRights(d, ctx);
 if (!full(r.self)) return fail('ACL_USER_NO_FULL_CONTROL');
 if (!full(r.objectInherit) || !full(r.containerInherit)) return fail('ACL_NOT_INHERITABLE');
 return pass();
}

/** Key, database and sidecar rule: any ACE (explicit or inherited) must be plain allow for T. */
export function evaluateFile(d: Descriptor, ctx: Context): Verdict {
 const early = commonChecks(d, ctx, sid => isTrusted(sid, ctx));
 if (early) return early;
 if (d.dacl.aces.length === 0) return fail('ACL_DACL_EMPTY');
 const rejected = onlyPlainTrusted(d, ctx);
 if (rejected) return rejected;
 return full(userRights(d, ctx).self) ? pass() : fail('ACL_USER_NO_FULL_CONTROL');
}

/**
 * Ancestor rule: no principal outside T may delete, delete-child, write-DAC or write-owner on a
 * component of the path. Inherit-only ACEs do not apply to the object itself; deny ACEs get no credit.
 */
export function evaluateAncestor(d: Descriptor, ctx: Context): Verdict {
 const early = commonChecks(d, ctx, sid => isTrusted(sid, ctx) || sid === SID_TRUSTED_INSTALLER);
 if (early) return early;
 const offenders: Record<string, number> = {};
 const notes: string[] = [];
 for (const ace of d.dacl.aces) {
  if (ace.type === 'D' || ace.type === 'OD' || ace.type === 'XD') { notes.push('deny_ace_ignored'); continue; }
  if (ace.type !== 'A' && ace.type !== 'OA' && ace.type !== 'XA') continue;
  if (ace.flags.includes('IO')) continue;
  if (effectiveTrusted(ace.trustee, d, ctx)) continue;
  if (fileRights(ace.rights) & REPLACE_MASK) bump(offenders, category(ace.trustee, ctx));
 }
 return Object.keys(offenders).length ? fail('ACL_ANCESTOR_WRITABLE', offenders) : pass(notes);
}

export function tryParse(text: string): Descriptor | { error: string } {
 try { return parseSddl(text); } catch (e) { return { error: e instanceof SddlError ? e.code : 'ACL_MALFORMED' }; }
}
