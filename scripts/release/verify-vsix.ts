// Release verification (Milestone 6, Task 9): content, not container.
//
//   node scripts/release/verify-vsix.ts <file.vsix> [--out manifest.json] [--compare other-manifest.json]
//
// Asserts that the archive holds exactly the allowlisted entries, that the extension manifest and
// bundle are sane, and emits a SHA-256 for every extracted file. ZIP bytes, timestamps and ordering
// are never compared: two builds are equivalent when their payload file hashes are equal.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { isMain } from '../is-main.ts';
import { readZip, ZipError } from './zip.ts';

export const ALLOWLIST = [
 '[Content_Types].xml',
 'extension.vsixmanifest',
 'extension/dist/extension.cjs',
 'extension/package.json',
 'extension/readme.md',
] as const;
/** Files whose bytes must be identical across independent builds of the same commit. */
export const PAYLOAD = ['extension/dist/extension.cjs', 'extension/package.json', 'extension/readme.md'] as const;

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

export function verifyVsix(archive: Buffer): VerifyResult {
 const problems: string[] = [];
 const result: VerifyResult = { ok: false, problems, files: [], version: 'unknown' };
 let entries;
 try { entries = readZip(archive); } catch (e) { problems.push(e instanceof ZipError ? e.code : 'ZIP_UNREADABLE'); return result; }
 const names = entries.map(e => e.name).sort();
 for (const name of names) if (!(ALLOWLIST as readonly string[]).includes(name)) problems.push('UNEXPECTED_ENTRY');
 for (const name of ALLOWLIST) if (!names.includes(name)) problems.push(`MISSING_ENTRY:${name}`);
 result.files = entries.map(e => ({ name: e.name, bytes: e.size, sha256: sha256(e.data) })).sort((a, b) => a.name.localeCompare(b.name));
 const get = (name: string) => entries.find(e => e.name === name)?.data;

 const manifestBytes = get('extension/package.json');
 if (manifestBytes) {
  try {
   const manifest = JSON.parse(manifestBytes.toString('utf8'));
   result.version = typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version) ? manifest.version : 'unknown';
   if (manifest.main !== './dist/extension.cjs') problems.push('MANIFEST_MAIN');
   if (manifest.dependencies && Object.keys(manifest.dependencies).length) problems.push('MANIFEST_RUNTIME_DEPENDENCIES');
   if (!manifest.engines?.vscode) problems.push('MANIFEST_ENGINE');
   const props = manifest.contributes?.configuration?.properties ?? {};
   for (const key of ['easykirogauge.sourceRoot', 'easykirogauge.storageRoot']) {
    if (props[key]?.scope !== 'machine') problems.push('MANIFEST_ROOT_SETTING_SCOPE');
   }
  } catch { problems.push('MANIFEST_JSON'); }
 }
 const vsixManifest = get('extension.vsixmanifest')?.toString('utf8');
 if (vsixManifest && result.version !== 'unknown' && !new RegExp(`<Identity\\b[^>]*\\sVersion="${result.version.replaceAll('.', '\\.')}"`).test(vsixManifest)) problems.push('VSIXMANIFEST_VERSION');

 const bundle = get('extension/dist/extension.cjs')?.toString('utf8');
 if (bundle !== undefined) {
  if (!/\bactivate\b/.test(bundle) || !/\bdeactivate\b/.test(bundle)) problems.push('BUNDLE_ENTRYPOINTS');
  if (!/require\(["']vscode["']\)/.test(bundle)) problems.push('BUNDLE_VSCODE_EXTERNAL');
  for (const [code, pattern] of LEAK_PATTERNS) if (pattern.test(bundle)) problems.push(code);
  // Storage guard and runtime probes must be shipped, and SQLite must be loaded lazily, never statically.
  if (/require\(["']node:sqlite["']\)/.test(bundle)) problems.push('BUNDLE_STATIC_SQLITE');
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

export function parseArgs(argv: string[]): { file: string; out?: string; compare?: string } | undefined {
 let file: string | undefined, out: string | undefined, compare: string | undefined;
 for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out' || a === '--compare') {
   const value = argv[++i];
   if (value === undefined || value.startsWith('--')) return undefined;
   if (a === '--out') out = value; else compare = value;
  } else if (a.startsWith('--') || file !== undefined) return undefined;
  else file = a;
 }
 return file === undefined ? undefined : { file, out, compare };
}

function main(): number {
 const args = parseArgs(process.argv.slice(2));
 if (!args) { console.log('USAGE'); return 2; }
 const file = args.file;
 const result = verifyVsix(readFileSync(file));
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
