// Release verification: content, not container.
//
//   node scripts/release/verify-vsix.ts <file.vsix> [--out manifest.json] [--compare other-manifest.json] [--pre-release]
//
// Asserts that the archive holds exactly the allowlisted entries, that the extension manifest and
// bundle are sane, and prints a SHA-256 for every file. ZIP bytes, timestamps and ordering are never
// compared: two builds are equivalent when their payload file hashes are equal. Output contains only
// fixed problem codes, names from the allowlist, sizes and hashes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isMain } from '../is-main.ts';
import { readZip, ZipError } from './zip.ts';

export const ALLOWLIST = [
 '[Content_Types].xml',
 'extension.vsixmanifest',
 'extension/changelog.md',
 'extension/LICENSE.txt',
 'extension/assets/branding/cyclegauge-icon-256.png',
 'extension/dist/extension.cjs',
 'extension/package.json',
 'extension/readme.md',
];
/** Files whose bytes must be identical across independent builds of the same commit. */
export const PAYLOAD = ALLOWLIST.filter(n => n.startsWith('extension/'));
/** Intended Open VSX identity. */
export const EXPECTED_ID = 'StefanSuess.cyclegauge';
const SETTING_KEYS = ['sourceRoot', 'storageRoot', 'sourceTimezone'];
// The audit reminder, community prompt and budget warning settings are the user's own (application scope: a workspace cannot set them): exactly these keys, with exactly this scope, type, default and range.
const USER_SETTINGS: Record<string, { type: string; default: unknown; minimum?: number; maximum?: number; enum?: string[] }> = {
 auditReminderDays: { type: 'number', default: 30, minimum: 0, maximum: 365 },
 auditAutomatically: { type: 'string', default: 'off', enum: ['off', 'onOpen', 'onOpenAndChanges'] },
 supportPrompts: { type: 'boolean', default: true },
 budgetWarnings: { type: 'boolean', default: true },
 budgetWarningPercent: { type: 'number', default: 80, minimum: 0, maximum: 100 },
};

export interface FileHash { name: string; bytes: number; sha256: string }
export interface VerifyResult { ok: boolean; problems: string[]; files: FileHash[]; version: string }

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
// Strings that would mean a build leaked its environment into the shipped bundle.
const LEAK_PATTERNS: [string, RegExp][] = [
 ['BUNDLE_HOME_PATH', /\/(?:Users|home)\/[A-Za-z0-9._-]+\//],
 ['BUNDLE_CI_WORKSPACE_PATH', /[A-Za-z]:\\{1,2}a\\{1,2}[A-Za-z0-9._-]+\\{1,2}/],
 ['BUNDLE_WINDOWS_PROFILE_PATH', /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._ -]+\\\\?/],
 ['BUNDLE_SOURCEMAP', /\/\/# sourceMappingURL=/],
 ['BUNDLE_CREDENTIAL_MARKER', /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bnpm_[A-Za-z0-9]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}/],
];

export function verifyVsix(archive: Buffer, options: { expectPreRelease?: boolean } = {}): VerifyResult {
 const problems: string[] = [];
 const result: VerifyResult = { ok: false, problems, files: [], version: 'unknown' };
 let entries;
 try { entries = readZip(archive); } catch (e) { problems.push(e instanceof ZipError ? e.code : 'ZIP_UNREADABLE'); return result; }
 const names = entries.map(e => e.name).sort();
 for (const name of names) if (!ALLOWLIST.includes(name)) problems.push('UNEXPECTED_ENTRY');
 for (const name of ALLOWLIST) if (!names.includes(name)) problems.push(`MISSING_ENTRY:${name}`);
 if (new Set(names).size !== names.length) problems.push('DUPLICATE_ENTRY');
 // Rejected names may contain private metadata; keep them out of all exported diagnostics.
 result.files = entries.filter(e => ALLOWLIST.includes(e.name)).map(e => ({ name: e.name, bytes: e.size, sha256: sha256(e.data) })).sort((a, b) => a.name.localeCompare(b.name));
 const get = (name: string) => entries.find(e => e.name === name)?.data;

 const manifestBytes = get('extension/package.json');
 if (manifestBytes) {
  try {
   const manifest = JSON.parse(manifestBytes.toString('utf8'));
   result.version = typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version) ? manifest.version : 'unknown';
   if (manifest.name !== 'cyclegauge') problems.push('MANIFEST_NAME');
   if (`${manifest.publisher}.${manifest.name}` !== EXPECTED_ID) problems.push('MANIFEST_EXTENSION_ID');
   if (manifest.license !== 'MIT') problems.push('MANIFEST_LICENSE');
   if (manifest.main !== './dist/extension.cjs') problems.push('MANIFEST_MAIN');
   if (manifest.dependencies && Object.keys(manifest.dependencies).length) problems.push('MANIFEST_RUNTIME_DEPENDENCIES');
   if (!manifest.engines?.vscode) problems.push('MANIFEST_ENGINE');
   if (manifest.icon !== 'assets/branding/cyclegauge-icon-256.png') problems.push('MANIFEST_ICON');
   const props = manifest.contributes?.configuration?.properties ?? {};
   if (Object.keys(props).sort().join(',') !== [...SETTING_KEYS, ...Object.keys(USER_SETTINGS)].map(key => `cyclegauge.${key}`).sort().join(',')) problems.push('MANIFEST_SETTING_PROPERTIES');
   // Workspace settings must not be able to redirect the source or storage roots.
   for (const key of SETTING_KEYS) if (props[`cyclegauge.${key}`]?.scope !== 'machine') problems.push('MANIFEST_SETTING_SCOPE');
   for (const [key, expected] of Object.entries(USER_SETTINGS)) {
    const p = props[`cyclegauge.${key}`];
    if (p?.scope !== 'application') problems.push('MANIFEST_SETTING_SCOPE');
    if (p?.type !== expected.type || p?.default !== expected.default || p?.minimum !== expected.minimum || p?.maximum !== expected.maximum
     || JSON.stringify(p?.enum) !== JSON.stringify(expected.enum)) problems.push('MANIFEST_SETTING_TYPE');
   }
  } catch { problems.push('MANIFEST_JSON'); }
 }
 const vsixManifest = get('extension.vsixmanifest')?.toString('utf8');
 if (vsixManifest) {
  if (result.version !== 'unknown' && !new RegExp(`<Identity\\b[^>]*\\sVersion="${result.version.replaceAll('.', '\\.')}"`).test(vsixManifest)) problems.push('VSIXMANIFEST_VERSION');
  if (!new RegExp(`<Identity\\b[^>]*\\sPublisher="StefanSuess"`).test(vsixManifest) || !/<Identity\b[^>]*\sId="cyclegauge"/.test(vsixManifest)) problems.push('VSIXMANIFEST_IDENTITY');
  const flagged = /Microsoft\.VisualStudio\.Code\.PreRelease"\s+Value="true"/.test(vsixManifest);
  if (options.expectPreRelease && !flagged) problems.push('VSIXMANIFEST_NOT_PRERELEASE');
 }
 const license = get('extension/LICENSE.txt')?.toString('utf8');
 if (license !== undefined && !/MIT License/.test(license)) problems.push('LICENSE_TEXT');
 const bundle = get('extension/dist/extension.cjs')?.toString('utf8');
 if (bundle !== undefined) {
  if (!/\bactivate\b/.test(bundle) || !/\bdeactivate\b/.test(bundle)) problems.push('BUNDLE_ENTRYPOINTS');
  if (!/require\(["']vscode["']\)/.test(bundle)) problems.push('BUNDLE_VSCODE_EXTERNAL');
  for (const [code, pattern] of LEAK_PATTERNS) if (pattern.test(bundle)) problems.push(code);
 }
 result.problems = [...new Set(problems)];
 result.ok = result.problems.length === 0;
 return result;
}

/** Payload files that differ between two manifests (by name), plus names present on one side only. */
export function comparePayload(a: FileHash[], b: FileHash[]): string[] {
 const index = (list: FileHash[]) => new Map(list.map(f => [f.name, f.sha256]));
 const left = index(a), right = index(b);
 const differences: string[] = [];
 for (const name of PAYLOAD) {
  const l = left.get(name), r = right.get(name);
  if (l === undefined || r === undefined || l !== r) differences.push(name);
 }
 return differences;
}

export function parseArgs(argv: string[]): { file: string; out?: string; compare?: string; preRelease: boolean } | undefined {
 let file: string | undefined, out: string | undefined, compare: string | undefined, preRelease = false;
 for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--pre-release') preRelease = true;
  else if (a === '--out' || a === '--compare') {
   const value = argv[++i];
   if (value === undefined || value.startsWith('--')) return undefined;
   if (a === '--out') out = value; else compare = value;
  } else if (a.startsWith('--') || file !== undefined) return undefined;
  else file = a;
 }
 return file === undefined ? undefined : { file, out, compare, preRelease };
}

function main(): number {
 const args = parseArgs(process.argv.slice(2));
 if (!args) { console.log('USAGE'); return 2; }
 const result = verifyVsix(readFileSync(args.file), { expectPreRelease: args.preRelease });
 if (args.out) writeFileSync(args.out, JSON.stringify({ version: result.version, files: result.files }, null, 1) + '\n');
 console.log(`VSIX_VERIFY ${result.ok ? 'PASS' : 'FAIL'} version=${result.version} files=${result.files.length}`);
 for (const f of result.files) console.log(`  ${f.sha256}  ${f.name}`);
 for (const problem of result.problems) console.log(`  PROBLEM ${problem}`);
 if (args.compare) {
  const other = JSON.parse(readFileSync(args.compare, 'utf8')) as { files: FileHash[] };
  const differences = comparePayload(result.files, other.files);
  console.log(`PAYLOAD_COMPARE ${differences.length ? 'DIFFERENT' : 'IDENTICAL'}${differences.map(d => ` ${d}`).join('')}`);
  if (differences.length) return 1;
 }
 return result.ok ? 0 : 1;
}
if (isMain(import.meta.url)) process.exitCode = main();
