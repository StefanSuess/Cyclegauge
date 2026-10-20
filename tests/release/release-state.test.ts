import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubOpenVsxAdapter } from '../../scripts/release/release-state.ts';

const adapter = () => new GitHubOpenVsxAdapter({
  repository: 'StefanSuess/Bobert',
  token: 'synthetic-token',
  publisherToolsDir: '/tmp/synthetic-publisher-tools',
  draftVisibility: 'full',
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
    if (url.pathname.endsWith('/releases')) {
      return json([{ id: 44, tag_name: 'v0.7.0', name: 'Bobert v0.7.0', body: 'notes', draft: true, prerelease: true }]);
    }
    if (url.pathname.endsWith('/releases/44/assets')) {
      return json([{ id: 100, name: 'bobert-v0.7.0.vsix', size: vsix.byteLength, state: 'uploaded' }]);
    }
    if (url.pathname.endsWith('/releases/assets/100')) {
      return new Response(vsix, { status: 200, headers: { 'content-length': String(vsix.byteLength) } });
    }
    return json({ message: 'not found' }, 404);
  }, async () => {
    const state = await adapter().readRelease('v0.7.0');
    assert.deepEqual(state, {
      kind: 'present',
      id: 44,
      tagName: 'v0.7.0',
      name: 'Bobert v0.7.0',
      body: 'notes',
      draft: true,
      prerelease: true,
      assets: [{ name: 'bobert-v0.7.0.vsix', sha256: expectedHash }],
    });
  });
});

test('creates a draft and discovers the same draft by exact tag', async () => {
  let draft: Record<string, unknown> | undefined;
  let creates = 0;
  await withFetch(async (url, init) => {
    if (url.pathname.endsWith('/releases') && init?.method === 'POST') {
      creates++;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      draft = { id: 44, tag_name: body.tag_name, name: body.name, body: body.body, draft: true, prerelease: true };
      return json({ id: 44 }, 201);
    }
    if (url.pathname.endsWith('/releases')) return json(draft ? [draft] : []);
    if (url.pathname.endsWith('/releases/44/assets')) return json([]);
    return json({}, 404);
  }, async () => {
    const client = adapter();
    assert.deepEqual(await client.readRelease('v0.7.0'), { kind: 'absent' });
    assert.equal(await client.createDraftRelease({ version: '0.7.0', tagName: 'v0.7.0', targetSha: 'a'.repeat(40), name: 'Bobert v0.7.0', body: 'notes', preRelease: true }), 44);
    assert.deepEqual(await client.readRelease('v0.7.0'), {
      kind: 'present', id: 44, tagName: 'v0.7.0', name: 'Bobert v0.7.0', body: 'notes', draft: true, prerelease: true, assets: [],
    });
    assert.equal(creates, 1);
  });
});

test('read-only preflight marks absent releases as draft visibility limited', async () => {
  const draft = { id: 44, tag_name: 'v0.7.0', name: 'Bobert v0.7.0', body: 'notes', draft: true, prerelease: true };
  await withFetch(async (url, init) => {
    if (url.pathname.endsWith('/releases')) {
      return json(new Headers(init?.headers).get('authorization') === 'Bearer synthetic-read-token' ? [] : [draft]);
    }
    if (url.pathname.endsWith('/releases/44/assets')) return json([]);
    return json({}, 404);
  }, async () => {
    const client = new GitHubOpenVsxAdapter({ repository: 'StefanSuess/Bobert', token: 'synthetic-read-token', publisherToolsDir: '/tmp/synthetic-publisher-tools', draftVisibility: 'limited' });
    assert.deepEqual(await client.readRelease('v0.7.0'), { kind: 'drafts-unverified' });
    assert.deepEqual(await adapter().readRelease('v0.7.0'), {
      kind: 'present', id: 44, tagName: 'v0.7.0', name: 'Bobert v0.7.0', body: 'notes', draft: true, prerelease: true, assets: [],
    });
  });
});

test('duplicate matching tags or malformed release listings fail closed', async () => {
  const row = { id: 44, tag_name: 'v0.7.0', name: 'Bobert v0.7.0', body: 'notes', draft: true, prerelease: true };
  await withFetch(async url => url.pathname.endsWith('/releases') ? json([row, { ...row, id: 45 }]) : json({}, 404), async () => {
    assert.deepEqual(await adapter().readRelease('v0.7.0'), { kind: 'unavailable' });
  });
  await withFetch(async url => url.pathname.endsWith('/releases') ? json([{ id: 99 }]) : json({}, 404), async () => {
    assert.deepEqual(await adapter().readRelease('v0.7.0'), { kind: 'unavailable' });
  });
});

test('uploads assets only to the release-specific GitHub upload URL', async () => {
  const seen: string[] = [];
  await withFetch(async (url, init) => {
    seen.push(url.toString());
    if (url.pathname.endsWith('/releases/44')) {
      return json({ upload_url: 'https://uploads.github.com/repos/StefanSuess/Bobert/releases/44/assets{?name,label}' });
    }
    if (url.hostname === 'uploads.github.com' && init?.method === 'POST') return json({}, 201);
    return json({ message: 'not found' }, 404);
  }, async () => {
    await adapter().uploadAsset(44, 'SHA256SUMS.txt', Uint8Array.from([1, 2]));
    assert.equal(seen.length, 2);
    assert.match(seen[1], /^https:\/\/uploads\.github\.com\/repos\/StefanSuess\/Bobert\/releases\/44\/assets\?name=SHA256SUMS\.txt$/);
  });
});

test('rejects an unexpected release upload host before sending the GitHub token', async () => {
  const seen: string[] = [];
  await withFetch(async url => {
    seen.push(url.toString());
    if (url.pathname.endsWith('/releases/44')) {
      return json({ upload_url: 'https://attacker.example/repos/StefanSuess/Bobert/releases/44/assets{?name,label}' });
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
      repository: 'StefanSuess/Bobert', token: 'synthetic-token', publisherToolsDir: tempDir, draftVisibility: 'full',
    }).publishOpenVsx(Uint8Array.from([1]), 'pat', true);
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
      repository: 'StefanSuess/Bobert', token: 'synthetic-token', publisherToolsDir: tempDir, draftVisibility: 'full',
    }).publishOpenVsx(Uint8Array.from([1]), 'trusted-publishing', true);
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

test('creates and publishes the GitHub release with the prerelease value of the channel', async () => {
  for (const preRelease of [true, false]) {
    const bodies: Record<string, unknown>[] = [];
    await withFetch(async (url, init) => {
      if (init?.method === 'POST' || init?.method === 'PATCH') bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return json({ id: 44 }, 201);
    }, async () => {
      await adapter().createDraftRelease({ version: '1.0.0', tagName: 'v1.0.0', targetSha: 'a'.repeat(40), name: 'Bobert v1.0.0', body: 'notes', preRelease });
      await adapter().publishRelease(44, preRelease);
    });
    assert.equal(bodies.length, 2);
    assert.deepEqual([bodies[0].draft, bodies[0].prerelease], [true, preRelease]);
    assert.deepEqual(bodies[1], { draft: false, prerelease: preRelease });
  }
});

test('ovsx publish gets --pre-release only for pre-release versions', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'synthetic-ovsx-args-'));
  try {
    const tools = join(temp, 'tools');
    const record = join(temp, 'args.json');
    mkdirSync(join(tools, 'node_modules/ovsx/bin'), { recursive: true });
    writeFileSync(join(tools, 'node_modules/ovsx/bin/ovsx'), `require('node:fs').writeFileSync(process.env.SYNTHETIC_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n`);
    const client = new GitHubOpenVsxAdapter({ repository: 'StefanSuess/Bobert', token: 'synthetic-token', publisherToolsDir: tools, draftVisibility: 'full' });
    process.env.SYNTHETIC_ARGS_FILE = record;
    for (const preRelease of [true, false]) {
      await client.publishOpenVsx(Uint8Array.from([1]), 'trusted-publishing', preRelease);
      const args = JSON.parse(readFileSync(record, 'utf8')) as string[];
      assert.equal(args[0], 'publish');
      assert.equal(args.includes('--pre-release'), preRelease);
      assert.ok(args.includes('--trusted-publishing'));
      rmSync(record);
    }
  } finally {
    delete process.env.SYNTHETIC_ARGS_FILE;
    rmSync(temp, { recursive: true, force: true });
  }
});
