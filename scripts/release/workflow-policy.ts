// SC3 workflow policy (Milestone 6, plan section 8): "workflow permissions and pinning".
//
//   node scripts/release/workflow-policy.ts [workflow.yml ...]   (default: every file in .github/workflows)
//
// A line-based check of the rules the CI header states, so that a later edit cannot quietly widen the
// token, add a secret, or float an action or image. It does not resolve SHAs against their tags; that
// stays a manual SC3 review item. The workflows are plain YAML without anchors or flow mappings, and a
// construct this checker does not understand is reported rather than passed.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../is-main.ts';

export function checkWorkflow(text: string): string[] {
 const problems = new Set<string>();
 const lines = text.split(/\r?\n/);
 const code = (line: string) => line.replace(/\s+#.*$/, '');

 // Token: exactly one permissions block, at the top level, granting `contents: read` and nothing else.
 const permissionLines = lines.flatMap((l, i) => /^\s*permissions\s*:/.test(l) ? [i] : []);
 if (permissionLines.length !== 1 || !/^permissions:\s*$/.test(code(lines[permissionLines[0]]))) problems.add('PERMISSIONS_NOT_SINGLE_TOP_LEVEL');
 else {
  const grants: string[] = [];
  for (let i = permissionLines[0] + 1; i < lines.length && /^\s+\S|^\s*$/.test(lines[i]); i++) if (code(lines[i]).trim()) grants.push(code(lines[i]).trim());
  if (grants.length !== 1 || grants[0] !== 'contents: read') problems.add('PERMISSIONS_NOT_READ_ONLY');
 }
 if (/\bwrite-all\b|\bread-all\b|:\s*write\b/.test(lines.map(code).join('\n'))) problems.add('PERMISSIONS_WRITE');

 // Triggers that run with a privileged token or on untrusted heads are not used here.
 if (/^\s*(?:pull_request_target|workflow_run)\s*:/m.test(text)) problems.add('PRIVILEGED_TRIGGER');
 // No secrets of any kind, including the implicit token passed explicitly. Every `${{ }}` expression is
 // searched, because the context can be reached by dot or bracket syntax, inside a function call
 // (`format(…, secrets.X)`, `toJSON(secrets)`, `toJSON(github)` which carries the token), with spaces, and in any letter case. A `secrets:` key passes
 // secrets to a called workflow (`secrets: inherit`). Fails closed: the word in a string literal counts too.
 for (const [, expression] of text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
  if (/\bsecrets\b/i.test(expression) || /\bgithub\s*(?:\.\s*token\b|\[\s*['"]token['"]\s*\])|\btoJSON\s*\(\s*github\s*\)/i.test(expression)) problems.add('SECRET_REFERENCE');
 }
 if (/^\s*secrets\s*:/im.test(lines.map(code).join('\n'))) problems.add('SECRET_REFERENCE');

 // Actions: owner/repo[/path]@<40-hex commit SHA> with a version comment; no local or docker actions.
 let checkouts = 0;
 for (const line of lines) {
  const m = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(line);
  if (!m) continue;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/.test(m[1])) problems.add('ACTION_NOT_PINNED_BY_SHA');
  else if (!/^\s+#\s*v\d/.test(m[2])) problems.add('ACTION_PIN_WITHOUT_VERSION_COMMENT');
  if (m[1].startsWith('actions/checkout@')) checkouts++;
 }
 const persisted = lines.filter(l => /^\s*persist-credentials:\s*false\s*$/.test(code(l))).length;
 if (persisted !== checkouts) problems.add('CHECKOUT_PERSISTS_CREDENTIALS');

 // Container images: any registry reference must carry a digest.
 for (const line of lines) {
  const refs = code(line).match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/[a-z0-9._/-]+(?::[A-Za-z0-9._-]+)?(?:@sha256:[0-9a-f]{64})?/g) ?? [];
  for (const ref of refs) if (/^(?:registry\.|docker\.io|ghcr\.io|quay\.io|mcr\.microsoft\.com|public\.ecr\.aws)/.test(ref) && !/@sha256:[0-9a-f]{64}$/.test(ref)) problems.add('IMAGE_NOT_PINNED_BY_DIGEST');
  if (/^\s*(?:-\s+)?(?:image|container):\s*\S/.test(code(line)) && !/@sha256:[0-9a-f]{64}/.test(line)) problems.add('IMAGE_NOT_PINNED_BY_DIGEST');
 }

 // Installs come from the lockfile, and pnpm itself from the pinned version variable.
 for (const line of lines.map(code)) {
  if (/\bpnpm (?:install|i)\b/.test(line) && !/--frozen-lockfile\b/.test(line)) problems.add('INSTALL_NOT_FROZEN');
  if (/\bnpm (?:install|i)\b/.test(line) && !/\bnpm (?:install|i) --global pnpm@\$\{\{ env\.PNPM_VERSION \}\}$/.test(line.trim())) problems.add('NPM_INSTALL_NOT_PINNED');
 }
 const pnpm = /^\s+PNPM_VERSION:\s*'?([^'\s]+)'?\s*$/m.exec(text);
 if (text.includes('PNPM_VERSION') && (!pnpm || !/^\d+\.\d+\.\d+$/.test(pnpm[1]))) problems.add('PNPM_VERSION_NOT_EXACT');
 return [...problems].sort();
}

function main(): number {
 const root = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
 const args = process.argv.slice(2);
 if (args.some(a => a.startsWith('--'))) { console.log('USAGE'); return 2; }
 const files = args.length ? args : readdirSync(root).filter(f => /\.ya?ml$/.test(f)).map(f => join(root, f));
 if (!files.length) { console.log('WORKFLOW_POLICY FAIL no workflows'); return 1; }
 let ok = true;
 for (const file of files) {
  const problems = checkWorkflow(readFileSync(file, 'utf8'));
  ok &&= problems.length === 0;
  console.log(`WORKFLOW_POLICY ${problems.length ? 'FAIL' : 'PASS'} ${file.split(/[\\/]/).pop()}`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);
 }
 return ok ? 0 : 1;
}
if (isMain(import.meta.url)) process.exitCode = main();
