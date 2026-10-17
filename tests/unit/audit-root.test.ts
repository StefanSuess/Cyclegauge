import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, parse } from 'node:path';
import { refusal } from '../../src/extension/audit-root.ts';

const base = resolve(parse(process.cwd()).root, 'synthetic-audit-root'), p = (...s: string[]) => join(base, ...s);
const home = p('home'), kiro = p('home', 'kiro-data'), own = p('home', 'storage'), cfgSource = p('elsewhere', 'source'), cfgStorage = p('elsewhere', 'storage');
const check = (root: string | string[], k = [kiro, ''], o = [own, '']) => refusal(Array.isArray(root) ? root : [root], k, o, home);
test('allows an ordinary project folder', () => {
 assert.equal(check(p('work', 'synthetic-project')), undefined); assert.equal(check(p('home', 'synthetic-project')), undefined); assert.equal(check(p('home', 'kiro-data-copy')), undefined);
});
test('refuses the filesystem root, the home folder and its ancestors', () => {
 assert.match(check(parse(base).root)!, /filesystem root/); assert.match(check(home)!, /home folder/); assert.match(check(base)!, /home folder/);
});
test('refuses folders that overlap Kiro data or Cyclegauge storage, in both directions', () => {
 for (const root of [kiro, join(kiro, 'logs'), join(kiro, 'a', 'b')]) assert.match(check(root)!, /Kiro data/);
 for (const root of [own, join(own, 'x')]) assert.match(check(root)!, /Cyclegauge storage/);
 assert.match(refusal([p('home')], [kiro], [own], p('elsewhere'))!, /Kiro data/);
});
test('refuses configured source and storage roots when set, and ignores empty settings', () => {
 const k = [kiro, cfgSource], o = [own, cfgStorage];
 assert.match(check(cfgSource, k, o)!, /Kiro data/); assert.match(check(join(cfgSource, 'logs'), k, o)!, /Kiro data/); assert.match(check(p('elsewhere'), k, o)!, /Kiro data/);
 assert.match(check(cfgStorage, k, o)!, /Cyclegauge storage/); assert.match(check(join(cfgStorage, 'x'), k, o)!, /Cyclegauge storage/);
 assert.equal(check(p('elsewhere', 'synthetic-project'), k, o), undefined); assert.equal(check(cfgSource, [kiro, ''], [own, '']), undefined);
 assert.equal(check(p('work'), ['', ''], ['', '']), undefined);
});
test('refuses anything inside a .kiro folder', () => {
 assert.match(check(p('work', '.kiro'))!, /\.kiro/); assert.match(check(p('work', '.kiro', 'steering'))!, /\.kiro/); assert.equal(check(p('work', 'synthetic.kiro')), undefined);
 if (process.platform === 'darwin' || process.platform === 'win32') { assert.match(check(p('work', '.KIRO', 'x'))!, /\.kiro/); assert.match(check(kiro.toUpperCase())!, /Kiro data/); }
});
test('refuses when any spelling of the root overlaps any spelling of a protected path', async () => {
 assert.match(check([p('alias', 'project'), join(kiro, 'project')])!, /Kiro data/);
 assert.match(check([p('alias', 'project'), join(own, 'project')])!, /Cyclegauge storage/); assert.match(refusal([p('work')], [kiro], [own], [p('elsewhere'), p('work', 'real-home')])!, /home folder/);
 assert.equal(check([p('work', 'a'), p('work', 'b')]), undefined);
 // A real symlinked ancestor: the textual root looks harmless, its resolved form lies inside the protected folder.
 const dir = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-audit-root-')); const protectedDir = join(dir, 'synthetic-kiro-data'), project = join(protectedDir, 'synthetic-project');
 await mkdir(project, { recursive: true }); const alias = join(dir, 'synthetic-alias'); await symlink(protectedDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
 const viaAlias = join(alias, 'synthetic-project'), real = realpathSync.native(viaAlias);
 assert.notEqual(real, viaAlias); assert.equal(refusal([viaAlias], [protectedDir], [], home), undefined);
 assert.match(refusal([viaAlias, real], [protectedDir], [], home)!, /Kiro data/);
 assert.match(refusal([viaAlias, real], [join(alias)], [], home)!, /Kiro data/); await rm(dir, { recursive: true });
});
test('refuses folders inside scanner-pruned or Kiro CLI folders, at any depth', () => {
 for (const name of ['.git', '.hg', '.svn', 'node_modules', 'bower_components', 'jspm_packages', '.terraform', '.pnpm-store', '.ssh', '.gnupg', '.aws', 'Node_Modules']) assert.match(check(p('work', name, 'synthetic-project'))!, /never audited/, name);
 assert.match(check(p('work', 'kiro-cli', 'x'))!, /never audited/); assert.match(check([p('work', 'ok'), p('real', '.ssh')])!, /never audited/);
 assert.equal(check(p('work', 'synthetic-node_modules-copy')), undefined); assert.equal(check(p('work', 'kiro-cli-copy')), undefined);
 // Folded into a dependency entry by the audit, but walked, so a project inside them may still be audited.
 assert.equal(check(p('work', 'Pods', 'synthetic-project')), undefined); assert.equal(check(p('work', '.yarn', 'cache', 'synthetic-project')), undefined);
 if (process.platform === 'darwin' || process.platform === 'win32') assert.match(check(p('work', 'Kiro-CLI', 'x'))!, /never audited/); else assert.equal(check(p('work', 'Kiro-CLI', 'x')), undefined);
});
test('storage defaults are protected like any other storage path', () => { assert.match(refusal([p('cyclegauge-default', 'x')], [], [p('cyclegauge-default')], home)!, /Cyclegauge storage/); });
