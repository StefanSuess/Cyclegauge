import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
const userName = () => { try { return userInfo().username; } catch { return ''; } };
import { join, resolve } from 'node:path';

// The survey targets Linux userland; on Windows the POSIX shell and mount semantics do not apply.
const test = (name: string, fn: () => void) => baseTest(name, { skip: process.platform === 'win32' }, fn);
const SCRIPT = resolve('scripts/poc/rhel9-survey.sh');
const LINE = /^[a-z0-9_]+=[A-Za-z0-9_.:+,-]{1,64}$/;
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);

function workspace() {
 const base = realpathSync(mkdtempSync(join(tmpdir(), 'synthetic-survey-')));
 const home = join(base, 'synthetic-home-marker with space; echo injected');
 mkdirSync(home);
 return { base, home };
}
function survey(env: Record<string, string>) {
 const r = spawnSync('sh', [SCRIPT], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env } });
 assert.equal(r.status, 0);
 assert.equal(r.stderr, '');
 const values = new Map(r.stdout.trim().split('\n').map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] as const; }));
 return { text: r.stdout, lines: r.stdout.trim().split('\n'), values };
}
const tree = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
 e.isDirectory() ? [e.name + '/', ...tree(join(dir, e.name)).map(n => `${e.name}/${n}`)] : [`${e.name}:${statSync(join(dir, e.name)).mtimeMs}`]);

test('output consists only of fixed key=value tokens and never echoes paths or identities', () => {
 const w = workspace();
 const { text, lines, values } = survey({ HOME: w.home, XDG_CONFIG_HOME: 'relative/synthetic-config', XDG_DATA_HOME: '', EKG_SURVEY_EXTRA_DIR: join(w.home, 'extra; echo injected') });
 for (const l of lines) assert.match(l, LINE);
 assert.equal(values.get('survey_complete'), 'yes');
 assert.equal(values.get('env_home'), 'absolute');
 assert.equal(values.get('env_xdg_config_home'), 'relative');
 assert.equal(values.get('env_xdg_data_home'), 'empty');
 assert.equal(values.get('env_xdg_state_home'), 'unset');
 assert.equal(values.get('loc_home_exists'), 'yes');
 assert.equal(values.get('loc_extra_exists'), 'no');
 assert.equal(values.get('loc_config_state'), 'not_absolute_or_unset');
 // Keys are fixed script text (a user named "root" legitimately matches `run_as_root=`), so identities are
 // searched for in the values only; the paths and markers are searched for everywhere.
 const valueText = lines.map(l => l.slice(l.indexOf('=') + 1)).join('\n');
 for (const secret of [w.base, w.home, 'synthetic-home-marker', 'injected'].filter(s => s.length > 3)) {
  assert.ok(!text.includes(secret), 'output must not contain a private value');
 }
 for (const identity of [hostname(), userName()].filter(s => s.length > 3)) {
  assert.ok(!valueText.includes(identity), 'output values must not contain a host or user name');
 }
 rmSync(w.base, { recursive: true });
});

test('filesystem and mount options come from mountinfo through allowlists only', () => {
 const w = workspace();
 const mountinfo = join(w.base, 'mountinfo');
 writeFileSync(mountinfo, [
  '1 0 8:1 / / rw,relatime shared:1 - xfs /dev/synthetic rw,seclabel',
  `2 1 0:50 / ${w.home.replaceAll(' ', '\\040')} rw,nosuid,seclabel,synthetic-secret-option=1 shared:2 - nfs4 synthetic-server:/export rw,vers=4.2,sec=krb5p,addr=192.0.2.7,clientaddr=192.0.2.8`,
  '3 1 0:51 /tmp /tmp rw,nosuid,nodev - tmpfs tmpfs rw,size=1024k',
 ].join('\n') + '\n');
 const { text, values } = survey({ HOME: w.home, EKG_SURVEY_MOUNTINFO: mountinfo });
 assert.equal(values.get('loc_home_fstype'), 'nfs4');
 assert.equal(values.get('loc_home_class'), 'network_or_cluster');
 assert.equal(values.get('loc_home_mount_opts'), 'rw,nosuid,seclabel');
 assert.equal(values.get('loc_home_mount_opts_unlisted'), '1');
 assert.equal(values.get('loc_home_nfs_vers'), '4.2');
 assert.equal(values.get('loc_home_nfs_sec'), 'krb5p');
 assert.equal(values.get('loc_vartmp_fstype'), 'xfs');
 assert.equal(values.get('loc_vartmp_class'), 'local_posix');
 for (const secret of ['192.0.2', 'synthetic-server', 'synthetic-secret-option', '/export']) assert.ok(!text.includes(secret));
 rmSync(w.base, { recursive: true });
});

test('Kiro program files are classified and summarised without echoing names, and nothing is modified', () => {
 const w = workspace();
 const kiro = join(w.base, 'synthetic-kiro-dir');
 mkdirSync(join(kiro, 'data'), { recursive: true });
 mkdirSync(join(kiro, 'lib'));
 writeFileSync(join(kiro, 'synthetic-app'), Buffer.concat([ELF, Buffer.from('\0GLIBC_2.17\0GLIBC_2.28\0GLIBC_2.4\0GLIBCXX_3.4.25\0GLIBC_PRIVATE\0')]));
 chmodSync(join(kiro, 'synthetic-app'), 0o755);
 writeFileSync(join(kiro, 'lib', 'synthetic-native.node'), Buffer.concat([ELF, Buffer.from('\0GLIBC_2.34\0')]));
 writeFileSync(join(kiro, 'notes.txt'), 'GLIBC_9.99 is text in a non-ELF file');
 const before = JSON.stringify([tree(kiro), tree(w.home)]);
 const { text, values } = survey({ HOME: w.home, EKG_KIRO_DIR: kiro, EKG_SURVEY_NO_LDD: '1' });
 assert.equal(values.get('kiro_dir_exists'), 'yes');
 assert.equal(values.get('kiro_portable_data_dir'), 'yes');
 assert.equal(values.get('kiro_elf_files'), '2');
 assert.equal(values.get('kiro_node_modules'), '1');
 assert.equal(values.get('kiro_max_glibc_required'), '2.34');
 assert.equal(values.get('kiro_max_glibcxx_required'), '3.4.25');
 assert.equal(values.get('kiro_unresolved_libraries'), 'skipped');
 assert.match(values.get('kiro_glibc_required_within_system') ?? '', /^(yes|no|unavailable)$/);
 assert.ok(!text.includes('synthetic-kiro-dir') && !text.includes('synthetic-native') && !text.includes('synthetic-app'));
 assert.equal(JSON.stringify([tree(kiro), tree(w.home)]), before, 'survey must not modify anything');
 rmSync(w.base, { recursive: true });
});

test('a Kiro directory that does not exist or is relative is reported, not followed', () => {
 const w = workspace();
 assert.equal(survey({ HOME: w.home, EKG_KIRO_DIR: join(w.base, 'missing') }).values.get('kiro_dir_exists'), 'no');
 assert.equal(survey({ HOME: w.home, EKG_KIRO_DIR: 'relative/dir' }).values.get('kiro_location_class'), 'not_absolute');
 rmSync(w.base, { recursive: true });
});

test('script text contains no mutating, privileged or network commands and writes no files', () => {
 const code = readFileSync(SCRIPT, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
 for (const word of ['rm', 'mv', 'cp', 'chmod', 'chown', 'chgrp', 'mkdir', 'touch', 'tee', 'ln', 'sudo', 'su', 'setenforce', 'chcon', 'restorecon', 'semanage',
  'audit2allow', 'setfacl', 'curl', 'wget', 'nc', 'ssh', 'scp', 'sqlite3', 'kiro', 'kiro-cli', 'dd', 'sysctl', 'systemctl start', 'systemctl enable', 'systemctl stop']) {
  assert.ok(!new RegExp(`(^|[\\s;|&(])${word}(\\s|$)`, 'm').test(code), word);
 }
 // Redirections may only target /dev/null or read from a named file.
 const stripped = code.replaceAll('2>/dev/null', '').replaceAll('>/dev/null', '').replaceAll('2>&1', '');
 assert.ok(!/>\s*[^&\s=]/.test(stripped.replace(/-gt|-le|=>/g, '')), 'no output redirection to files');
 assert.ok(!/\$HOME|\$\{HOME\}/.test(code.replace(/\$HOME_DIR/g, '')), 'only the classified copy of HOME is used');
});
