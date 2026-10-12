import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubOpenVsxAdapter } from '../../scripts/release/release-state.ts';

const adapter = () => new GitHubOpenVsxAdapter({
  repository: 'StefanSuess/Cyclegauge',
  token: 'synthetic-token',
  publisherToolsDir: '/tmp/synthetic-publisher-tools',
});

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json' },
});

async function withFetch(handler: (url: URL, init?: RequestInit) => Promise<Response>, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => handler(new URL(input.toString()), init)) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('reads release assets from GitHub\'s paginated array response and hashes their bytes', async () => {
  const vsix = Uint8Array.from([1, 2, 3, 4]);
  const expectedHash = createHash('sha256').update(vsix).digest('hex');
  await withFetch(async url => {
    if (url.pathname.endsWith('/releases/tags/v0.6.0')) {
      return json({ id: 44, tag_name: 'v0.6.0', name: 'Cyclegauge v0.6.0', body: 'notes', draft: true, prerelease: true });
    }
    if (url.pathname.endsWith('/releases/44/assets')) {
      return json([{ id: 100, name: 'cyclegauge-v0.6.0.vsix', size: vsix.byteLength, state: 'uploaded' }]);
    }
    if (url.pathname.endsWith('/releases/assets/100')) {
      return new Response(vsix, { status: 200, headers: { 'content-length': String(vsix.byteLength) } });
    }
    return json({ message: 'not found' }, 404);
  }, async () => {
    const state = await adapter().readRelease('v0.6.0');
    assert.deepEqual(state, {
      kind: 'present',
      id: 44,
      tagName: 'v0.6.0',
      name: 'Cyclegauge v0.6.0',
      body: 'notes',
      draft: true,
      prerelease: true,
      assets: [{ name: 'cyclegauge-v0.6.0.vsix', sha256: expectedHash }],
    });
  });
});

test('uploads assets only to the release-specific GitHub upload URL', async () => {
  const seen: string[] = [];
  await withFetch(async (url, init) => {
    seen.push(url.toString());
    if (url.pathname.endsWith('/releases/44')) {
      return json({ upload_url: 'https://uploads.github.com/repos/StefanSuess/Cyclegauge/releases/44/assets{?name,label}' });
    }
    if (url.hostname === 'uploads.github.com' && init?.method === 'POST') return json({}, 201);
    return json({ message: 'not found' }, 404);
  }, async () => {
    await adapter().uploadAsset(44, 'SHA256SUMS.txt', Uint8Array.from([1, 2]));
    assert.equal(seen.length, 2);
    assert.match(seen[1], /^https:\/\/uploads\.github\.com\/repos\/StefanSuess\/Cyclegauge\/releases\/44\/assets\?name=SHA256SUMS\.txt$/);
  });
});

test('rejects an unexpected release upload host before sending the GitHub token', async () => {
  const seen: string[] = [];
  await withFetch(async url => {
    seen.push(url.toString());
    if (url.pathname.endsWith('/releases/44')) {
      return json({ upload_url: 'https://attacker.example/repos/StefanSuess/Cyclegauge/releases/44/assets{?name,label}' });
    }
    return json({ message: 'not found' }, 404);
  }, async () => {
    await assert.rejects(adapter().uploadAsset(44, 'SHA256SUMS.txt', Uint8Array.from([1])), /RELEASE_UPLOAD_URL_INVALID/);
    assert.equal(seen.length, 1);
  });
});

test('reads the current protected main SHA for the post-approval freshness gate', async () => {
  await withFetch(async url => {
    if (url.pathname.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'a'.repeat(40) } });
    return json({ message: 'not found' }, 404);
  }, async () => assert.equal(await adapter().readMainSha(), 'a'.repeat(40)));
});

test('fails closed when the post-approval main SHA cannot be verified', async () => {
  await withFetch(async () => json({ message: 'not found' }, 404), async () => {
    await assert.rejects(adapter().readMainSha(), /MAIN_STATE_UNAVAILABLE/);
  });
});

function fakePublisher(tempDir: string, resultFile: string): string {
  const executable = join(tempDir, 'node_modules/ovsx/bin/ovsx');
  mkdirSync(join(tempDir, 'node_modules/ovsx/bin'), { recursive: true });
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({
  hasOvsxPat: process.env.OVSX_PAT === 'synthetic-openvsx-pat',
  hasOpenVsxPatAlias: Object.hasOwn(process.env, 'OPENVSX_PAT'),
  hasGithubToken: Object.hasOwn(process.env, 'GITHUB_TOKEN') || Object.hasOwn(process.env, 'GH_TOKEN'),
  hasAnyPat: Object.hasOwn(process.env, 'OPENVSX_PAT') || Object.hasOwn(process.env, 'OVSX_PAT'),
  hasOidc: Object.hasOwn(process.env, 'ACTIONS_ID_TOKEN_REQUEST_URL') && Object.hasOwn(process.env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'),
}));
`);
  chmodSync(executable, 0o700);
  return executable;
}

test('PAT mode exposes only the Open VSX credential and strips GitHub and OIDC credentials', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'synthetic-publisher-'));
  const resultFile = join(tempDir, 'result.json');
  fakePublisher(tempDir, resultFile);
  const oldEnv = Object.fromEntries([
    'OPENVSX_PAT', 'OVSX_PAT', 'GITHUB_TOKEN', 'GH_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ].map(key => [key, process.env[key]]));
  process.env.OPENVSX_PAT = 'synthetic-openvsx-pat';
  process.env.OVSX_PAT = 'stale-synthetic-pat';
  process.env.GITHUB_TOKEN = 'synthetic-github-token';
  process.env.GH_TOKEN = 'synthetic-gh-token';
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://synthetic.invalid/token';
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'synthetic-oidc-token';
  try {
    await new GitHubOpenVsxAdapter({
      repository: 'StefanSuess/Cyclegauge', token: 'synthetic-token', publisherToolsDir: tempDir,
    }).publishOpenVsx(Uint8Array.from([1]), 'pat');
    assert.deepEqual(JSON.parse(readFileSync(resultFile, 'utf8')), {
      hasOvsxPat: true,
      hasOpenVsxPatAlias: false,
      hasGithubToken: false,
      hasAnyPat: true,
      hasOidc: false,
    });
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('trusted publishing strips every PAT alias while retaining OIDC environment', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'synthetic-publisher-'));
  const resultFile = join(tempDir, 'result.json');
  fakePublisher(tempDir, resultFile);
  const oldEnv = Object.fromEntries([
    'OPENVSX_PAT', 'OVSX_PAT', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ].map(key => [key, process.env[key]]));
  process.env.OPENVSX_PAT = 'synthetic-openvsx-pat';
  process.env.OVSX_PAT = 'synthetic-openvsx-pat';
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://synthetic.invalid/token';
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'synthetic-oidc-token';
  try {
    await new GitHubOpenVsxAdapter({
      repository: 'StefanSuess/Cyclegauge', token: 'synthetic-token', publisherToolsDir: tempDir,
    }).publishOpenVsx(Uint8Array.from([1]), 'trusted-publishing');
    assert.deepEqual(JSON.parse(readFileSync(resultFile, 'utf8')), {
      hasOvsxPat: false,
      hasOpenVsxPatAlias: false,
      hasGithubToken: false,
      hasAnyPat: false,
      hasOidc: true,
    });
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
