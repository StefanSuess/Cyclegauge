import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAncestor, evaluateDirectory, evaluateFile, fileRights, parseSddl, SddlError, type Context } from '../../scripts/poc/win-acl/sddl.ts';

// Every identifier here is invented. The shapes follow the documented default layouts of a
// Windows volume root, C:\Users and a user profile [inferred, not copied from any machine].
const USER = 'S-1-5-21-1111111111-2222222222-3333333333-1001';
const OTHER = 'S-1-5-21-1111111111-2222222222-3333333333-1002';
const DOMAIN_ADMINS = 'S-1-5-21-1111111111-2222222222-3333333333-512';
const ctx: Context = { user: USER };
const parse = (s: string) => parseSddl(s);
const rejects = (s: string, code: string) => assert.throws(() => parseSddl(s), (e: unknown) => e instanceof SddlError && e.code === code);

const ROOT = 'O:SYG:SYD:PAI(A;OICI;FA;;;BA)(A;OICI;FA;;;SY)(A;OICI;0x1200a9;;;BU)(A;OICIIO;0x1301bf;;;AU)(A;;0x4;;;AU)';
const USERS = 'O:SYG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;;0x1200a9;;;BU)(A;OICIIO;GXGR;;;BU)(A;;0x1200a9;;;WD)(A;OICIIO;GXGR;;;WD)';
const PROFILE = `O:${USER}G:S-1-5-21-1111111111-2222222222-3333333333-513D:PAI(A;OICI;FA;;;${USER})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;
const LOCAL = `O:${USER}G:S-1-5-21-1111111111-2222222222-3333333333-513D:AI(A;OICIID;FA;;;${USER})(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)`;
const PRIVATE_DIR = `O:${USER}G:SYD:PAI(A;OICI;FA;;;${USER})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;
const KEY_FILE = `O:${USER}G:SYD:AI(A;ID;FA;;;${USER})(A;ID;FA;;;SY)(A;ID;FA;;;BA)`;

test('parser reads owner, group, DACL flags and ACE fields', () => {
 const d = parse(PROFILE);
 assert.equal(d.owner, USER);
 assert.equal(d.dacl.present, true);
 assert.equal(d.dacl.protectedDacl, true);
 assert.equal(d.dacl.aces.length, 3);
 assert.deepEqual(d.dacl.aces[0].flags, ['OI', 'CI']);
 assert.equal(d.dacl.aces[0].plain, true);
 assert.equal(parse(LOCAL).dacl.protectedDacl, false);
 assert.deepEqual(parse(LOCAL).dacl.aces[0].flags, ['OI', 'CI', 'ID']);
});

test('parser maps named rights to bit values and expands generic rights for files', () => {
 assert.equal(parse('O:SYD:(A;;FA;;;BA)').dacl.aces[0].rights, 0x1f01ff);
 assert.equal(parse('O:SYD:(A;;0x1200a9;;;BU)').dacl.aces[0].rights, 0x1200a9);
 assert.equal(parse('O:SYD:(A;;SDWDWO;;;BU)').dacl.aces[0].rights, 0x10000 | 0x40000 | 0x80000);
 assert.equal(fileRights(0x10000000), 0x1f01ff);
 assert.equal(fileRights(0x80000000 | 0x20000000), (0x120089 | 0x1200a0) >>> 0);
});

test('parser fails closed with fixed codes and no input text', () => {
 rejects('', 'ACL_MALFORMED');
 rejects('garbage', 'ACL_MALFORMED');
 rejects('O:SYD:(A;;FA;;;ZZ)', 'ACL_UNKNOWN_TOKEN');
 rejects('O:SYD:(A;;QQ;;;BA)', 'ACL_UNKNOWN_TOKEN');
 rejects('O:SYD:(A;XX;FA;;;BA)', 'ACL_UNKNOWN_TOKEN');
 rejects('O:SYD:(Q;;FA;;;BA)', 'ACL_UNKNOWN_TOKEN');
 rejects('O:SYD:(A;;FA;;;BA', 'ACL_MALFORMED');
 rejects('O:SYO:SY', 'ACL_MALFORMED');
 rejects('O:SYD:(A;;FA;;;BA)\nD:', 'ACL_MALFORMED');
 try { parse(`O:SYD:(A;;FA;;;${USER}ZZ)`); assert.fail('must throw'); } catch (e) { assert.ok(!String((e as Error).message).includes(USER)); }
});

test('a NULL DACL and an absent DACL are both reported as missing', () => {
 assert.equal(parse('O:SYG:SYD:NO_ACCESS_CONTROL').dacl.present, false);
 assert.equal(parse('O:SYG:SY').dacl.present, false);
 for (const text of ['O:SYG:SYD:NO_ACCESS_CONTROL', 'O:SYG:SY']) {
  const d = parse(text);
  for (const v of [evaluateAncestor(d, ctx), evaluateDirectory(d, ctx, { requireProtected: false }), evaluateFile(d, ctx)]) {
   assert.equal(v.ok, false); assert.equal(!v.ok && v.code, 'ACL_DACL_MISSING');
  }
 }
});

test('documented default volume, Users and profile chain satisfies the ancestor rule', () => {
 for (const s of [ROOT, USERS, PROFILE, LOCAL]) {
  const v = evaluateAncestor(parse(s), ctx);
  assert.equal(v.ok, true, JSON.stringify(v));
 }
});

test('an inherited, unprotected %LOCALAPPDATA% passes as parent but not under a literal protected rule', () => {
 const local = parse(LOCAL);
 assert.equal(evaluateDirectory(local, ctx, { requireProtected: false }).ok, true);
 const strict = evaluateDirectory(local, ctx, { requireProtected: true });
 assert.equal(!strict.ok && strict.code, 'ACL_NOT_PROTECTED');
});

test('private storage directory and key file pass; look-alike tampering is rejected with its category', () => {
 assert.equal(evaluateDirectory(parse(PRIVATE_DIR), ctx, { requireProtected: true }).ok, true);
 assert.equal(evaluateFile(parse(KEY_FILE), ctx).ok, true);

 const extra = evaluateDirectory(parse(PRIVATE_DIR.replace(')', ')(A;OICI;0x1200a9;;;BU)')), ctx, { requireProtected: true });
 assert.deepEqual(!extra.ok && [extra.code, extra.offenders], ['ACL_TRUSTEE_OUTSIDE_T', { builtin_users: 1 }]);

 const foreign = evaluateFile(parse(KEY_FILE.replace(')', `)(A;ID;FA;;;${OTHER})`)), ctx);
 assert.deepEqual(!foreign.ok && [foreign.code, foreign.offenders], ['ACL_TRUSTEE_OUTSIDE_T', { account_or_group: 1 }]);

 const deny = evaluateDirectory(parse(PRIVATE_DIR.replace('D:PAI', 'D:PAI(D;OICI;0x10;;;BU)')), ctx, { requireProtected: true });
 assert.equal(!deny.ok && deny.code, 'ACL_DENY_ACE');

 const owner = evaluateFile(parse(KEY_FILE.replace(`O:${USER}`, `O:${OTHER}`)), ctx);
 assert.equal(!owner.ok && owner.code, 'ACL_OWNER_UNTRUSTED');

 const everyone = evaluateFile(parse(KEY_FILE.replace(')', ')(A;ID;FR;;;WD)')), ctx);
 assert.deepEqual(!everyone.ok && everyone.offenders, { everyone: 1 });
});

test('directory must give the current user inheritable full control', () => {
 const noInherit = `O:${USER}G:SYD:PAI(A;;FA;;;${USER})(A;OICI;FA;;;SY)`;
 const v = evaluateDirectory(parse(noInherit), ctx, { requireProtected: true });
 assert.equal(!v.ok && v.code, 'ACL_NOT_INHERITABLE');
 const readOnly = `O:${USER}G:SYD:PAI(A;OICI;FR;;;${USER})(A;OICI;FA;;;SY)`;
 const w = evaluateDirectory(parse(readOnly), ctx, { requireProtected: true });
 assert.equal(!w.ok && w.code, 'ACL_USER_NO_FULL_CONTROL');
 const fileNoUser = `O:${USER}G:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)`;
 const x = evaluateFile(parse(fileNoUser), ctx);
 assert.equal(!x.ok && x.code, 'ACL_USER_NO_FULL_CONTROL');
 assert.equal(!evaluateFile(parse(`O:${USER}G:SYD:AI`), ctx).ok, true);
});

test('object, callback and unknown ACE kinds are never accepted', () => {
 const objectAce = parse(`O:${USER}G:SYD:PAI(OA;;FA;00000000-0000-0000-0000-000000000000;;${USER})(A;OICI;FA;;;SY)`);
 const callback = parse(`O:${USER}G:SYD:PAI(XA;;FA;;;${USER};(@User.synthetic==1))(A;OICI;FA;;;SY)`);
 for (const d of [objectAce, callback]) {
  const v = evaluateDirectory(d, ctx, { requireProtected: true });
  assert.equal(!v.ok && v.code, 'ACL_COMPLEX_ACE');
 }
});

test('ancestor rule: replace-capable rights for outsiders are rejected, other rights are not', () => {
 const withGrant = (rights: string, flags = '') => parse(`${USERS.replace(/\(A;;0x1200a9;;;BU\)/, `(A;${flags};${rights};;;BU)`)}`);
 const bad = ['SD', 'WD', 'WO', 'FA', '0x1301bf', 'GA', 'DT', '0x40', 'GWSD'];
 for (const r of bad) {
  const v = evaluateAncestor(withGrant(r), ctx);
  assert.equal(!v.ok && v.code, 'ACL_ANCESTOR_WRITABLE', r);
 }
 for (const r of ['0x1200a9', 'FR', 'FW', 'GR', 'GW', 'GX', '0x4', '0x2']) {
  assert.equal(evaluateAncestor(withGrant(r), ctx).ok, true, r);
 }
});

test('ancestor rule: inherit-only entries do not apply, deny entries earn no credit', () => {
 const inheritOnly = parse(USERS.replace('(A;OICIIO;GXGR;;;BU)', '(A;OICIIO;FA;;;BU)'));
 assert.equal(evaluateAncestor(inheritOnly, ctx).ok, true);
 const denyOnly = parse(USERS.replace('(A;;0x1200a9;;;BU)', '(A;;FA;;;BU)(D;;SD;;;BU)'));
 const v = evaluateAncestor(denyOnly, ctx);
 assert.equal(!v.ok && v.code, 'ACL_ANCESTOR_WRITABLE');
 const ignored = evaluateAncestor(parse(USERS.replace('(A;;0x1200a9;;;WD)', '(D;;SD;;;WD)')), ctx);
 assert.deepEqual(ignored.ok && ignored.notes, ['deny_ace_ignored']);
});

test('ancestor rule: owner must be trusted, TrustedInstaller may own system directories', () => {
 const ti = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
 assert.equal(evaluateAncestor(parse(ROOT.replace('O:SY', `O:${ti}`)), ctx).ok, true);
 const v = evaluateAncestor(parse(ROOT.replace('O:SY', `O:${OTHER}`)), ctx);
 assert.equal(!v.ok && v.code, 'ACL_OWNER_UNTRUSTED');
 const da = evaluateAncestor(parse(PROFILE.replace(')', `)(A;OICI;FA;;;${DOMAIN_ADMINS})`)), ctx);
 assert.deepEqual(!da.ok && [da.code, da.offenders], ['ACL_ANCESTOR_WRITABLE', { account_or_group: 1 }]);
});

test('CREATOR OWNER and OWNER RIGHTS are trusted only through a trusted owner', () => {
 const trustedOwner = parse(`O:${USER}G:SYD:PAI(A;OICI;FA;;;${USER})(A;OICI;FA;;;SY)(A;OICIIO;FA;;;CO)(A;;0x1200a9;;;OW)`);
 assert.equal(evaluateDirectory(trustedOwner, ctx, { requireProtected: true }).ok, true);
 const foreignOwner = parse(`O:${OTHER}G:SYD:PAI(A;OICI;FA;;;${USER})(A;OICI;FA;;;SY)(A;OICIIO;FA;;;CO)`);
 const v = evaluateDirectory(foreignOwner, ctx, { requireProtected: true });
 assert.equal(!v.ok && v.code, 'ACL_OWNER_UNTRUSTED');
});

test('verdicts never carry SIDs, only fixed codes and categories', () => {
 const v = evaluateDirectory(parse(PRIVATE_DIR.replace(')', `)(A;OICI;FA;;;${OTHER})`)), ctx, { requireProtected: true });
 const text = JSON.stringify(v);
 assert.ok(!text.includes(OTHER) && !text.includes(USER));
});
