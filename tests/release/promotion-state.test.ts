import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoteCandidate, type PromotionAdapter, type PromotionCandidate } from '../../scripts/release/promotion-state.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const commit = 'a'.repeat(40);
const bytes = Buffer.from('synthetic-candidate-vsix');
const sums = (version: string) => Buffer.from(`${digest(bytes)}  cyclegauge-v${version}.vsix\n`);
const candidate = (version = '0.6.0'): PromotionCandidate => ({
  version,
  commit,
  sha256: digest(bytes),
  vsixBytes: bytes,
  checksumBytes: sums(version),
  vsixAssetName: `cyclegauge-v${version}.vsix`,
  checksumAssetName: 'SHA256SUMS.txt',
  releaseName: `Cyclegauge v${version}`,
  releaseNotes: `Synthetic notes for ${version}.`,
});
const release = (version = '0.6.0', overrides: Record<string, unknown> = {}) => ({
  id: 77,
  tagName: `v${version}`,
  name: `Cyclegauge v${version}`,
  body: `Synthetic notes for ${version}.`,
  draft: true,
  prerelease: true,
  assets: [],
  ...overrides,
});
const exactPublishedRelease = (version = '0.6.0') => release(version, {
  draft: false,
  assets: [
    { name: `cyclegauge-v${version}.vsix`, sha256: digest(bytes) },
    { name: 'SHA256SUMS.txt', sha256: digest(sums(version)) },
  ],
});

function fakeAdapter(initial?: {
  openVsx?: unknown;
  tag?: unknown;
  release?: unknown;
}) {
  const state: Record<string, any> = {
    openVsx: initial?.openVsx ?? { kind: 'absent' },
    tag: initial?.tag ?? { kind: 'absent' },
    release: initial?.release ?? { kind: 'absent' },
  };
  const writes: string[] = [];
  const adapter: PromotionAdapter = {
    async readOpenVsx() { return structuredClone(state.openVsx); },
    async readTag() { return structuredClone(state.tag); },
    async readRelease() { return structuredClone(state.release); },
    async publishOpenVsx(_bytes, _authMode) {
      writes.push('open-vsx');
      state.openVsx = { kind: 'present', sha256: digest(bytes) };
    },
    async createTag(tagName, targetSha) {
      writes.push('tag');
      state.tag = { kind: 'present', tagName, targetSha };
    },
    async createDraftRelease(input) {
      writes.push('draft');
      state.release = { kind: 'present', ...release(input.version, { id: 77, tagName: input.tagName, name: input.name, body: input.body }) };
      return 77;
    },
    async uploadAsset(releaseId, name, content) {
      writes.push(`asset:${name}`);
      assert.equal(releaseId, 77);
      state.release.assets.push({ name, sha256: digest(content) });
    },
    async publishRelease(releaseId) {
      writes.push('publish-release');
      assert.equal(releaseId, 77);
      state.release.draft = false;
    },
  };
  return { adapter, state, writes };
}

const expectedWrites = ['open-vsx', 'tag', 'draft', 'asset:cyclegauge-v0.6.0.vsix', 'asset:SHA256SUMS.txt', 'publish-release'];

test('publishes in order and verifies each completed remote state', async () => {
  const fake = fakeAdapter();
  const result = await promoteCandidate(fake.adapter, candidate(), { dryRun: false, authMode: 'trusted-publishing' });
  assert.deepEqual(fake.writes, expectedWrites);
  assert.equal(result.status, 'published');
  assert.equal(fake.state.openVsx.sha256, candidate().sha256);
  assert.equal(fake.state.tag.targetSha, commit);
  assert.equal(fake.state.release.draft, false);
});

test('an exact retry is a no-op and does not rewrite published remote state', async () => {
  const c = candidate();
  const fake = fakeAdapter({
    openVsx: { kind: 'present', sha256: c.sha256 },
    tag: { kind: 'present', tagName: 'v0.6.0', targetSha: commit },
    release: { kind: 'present', ...exactPublishedRelease() },
  });
  const result = await promoteCandidate(fake.adapter, c, { dryRun: false, authMode: 'pat' });
  assert.equal(result.status, 'already-published');
  assert.deepEqual(fake.writes, []);
});

test('resumes a partial matching draft by uploading only missing assets', async () => {
  const c = candidate();
  const fake = fakeAdapter({
    openVsx: { kind: 'present', sha256: c.sha256 },
    tag: { kind: 'present', tagName: 'v0.6.0', targetSha: commit },
    release: { kind: 'present', ...release('0.6.0', { assets: [
      { name: c.vsixAssetName, sha256: c.sha256 },
    ] }) },
  });
  const result = await promoteCandidate(fake.adapter, c, { dryRun: false, authMode: 'trusted-publishing' });
  assert.equal(result.status, 'published');
  assert.deepEqual(fake.writes, ['asset:SHA256SUMS.txt', 'publish-release']);
});

test('resumes after Open VSX publication or an exact tag already exists', async () => {
  const c = candidate();
  const openVsxOnly = fakeAdapter({ openVsx: { kind: 'present', sha256: c.sha256 } });
  assert.equal((await promoteCandidate(openVsxOnly.adapter, c, { dryRun: false, authMode: 'pat' })).status, 'published');
  assert.deepEqual(openVsxOnly.writes, ['tag', 'draft', `asset:${c.vsixAssetName}`, 'asset:SHA256SUMS.txt', 'publish-release']);

  const tagOnly = fakeAdapter({ tag: { kind: 'present', tagName: 'v0.6.0', targetSha: commit } });
  assert.equal((await promoteCandidate(tagOnly.adapter, c, { dryRun: false, authMode: 'trusted-publishing' })).status, 'published');
  assert.deepEqual(tagOnly.writes, ['open-vsx', 'draft', `asset:${c.vsixAssetName}`, 'asset:SHA256SUMS.txt', 'publish-release']);
});

test('conflicting or unverifiable Open VSX, tag, release, or asset state fails closed', async () => {
  const c = candidate();
  const cases = [
    { openVsx: { kind: 'present', sha256: 'f'.repeat(64) } },
    { openVsx: { kind: 'unavailable' } },
    { tag: { kind: 'present', tagName: 'v0.6.0', targetSha: 'b'.repeat(40) } },
    { release: { kind: 'present', ...release('0.6.0', { body: 'different notes' }) } },
    { release: { kind: 'present', ...release('0.6.0', { assets: [
      { name: c.vsixAssetName, sha256: 'f'.repeat(64) },
    ] }) } },
    { release: { kind: 'present', ...release('0.6.0', { assets: [
      { name: 'synthetic-unexpected.txt', sha256: digest(bytes) },
    ] }) } },
  ];
  for (const state of cases) {
    const fake = fakeAdapter(state);
    await assert.rejects(promoteCandidate(fake.adapter, c, { dryRun: false, authMode: 'pat' }));
    assert.deepEqual(fake.writes, []);
  }
});

test('a published but incomplete release cannot be repaired or edited', async () => {
  const c = candidate();
  const fake = fakeAdapter({
    openVsx: { kind: 'present', sha256: c.sha256 },
    tag: { kind: 'present', tagName: 'v0.6.0', targetSha: commit },
    release: { kind: 'present', ...exactPublishedRelease(), assets: [] },
  });
  await assert.rejects(promoteCandidate(fake.adapter, c, { dryRun: false, authMode: 'pat' }));
  assert.deepEqual(fake.writes, []);
});

test('a dry run reads readiness but makes zero write calls', async () => {
  const fake = fakeAdapter();
  const result = await promoteCandidate(fake.adapter, candidate(), { dryRun: true, authMode: 'trusted-publishing' });
  assert.equal(result.status, 'ready');
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(fake.state.openVsx, { kind: 'absent' });
  assert.deepEqual(fake.state.tag, { kind: 'absent' });
  assert.deepEqual(fake.state.release, { kind: 'absent' });
});

test('limited draft visibility is allowed only in read-only preflight', async () => {
  const fake = fakeAdapter({ release: { kind: 'drafts-unverified' } });
  assert.equal((await promoteCandidate(fake.adapter, candidate(), { dryRun: true, authMode: 'pat' })).status, 'ready');
  await assert.rejects(promoteCandidate(fake.adapter, candidate(), { dryRun: false, authMode: 'pat' }), /RELEASE_DRAFT_VISIBILITY_LIMITED/);
  assert.deepEqual(fake.writes, []);
});

test('failed asset upload is retried only after rediscovering the exact matching draft', async () => {
  const c = candidate();
  const fake = fakeAdapter({
    openVsx: { kind: 'present', sha256: c.sha256 },
    tag: { kind: 'present', tagName: 'v0.6.0', targetSha: commit },
    release: { kind: 'present', ...release() },
  });
  const upload = fake.adapter.uploadAsset;
  let failOnce = true;
  fake.adapter.uploadAsset = async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('synthetic upload failure'); }
    return upload(...args);
  };
  await assert.rejects(promoteCandidate(fake.adapter, c, { dryRun: false, authMode: 'pat' }), /PROMOTION_WRITE_FAILED/);
  assert.equal(fake.state.release.draft, true);
  assert.equal((await promoteCandidate(fake.adapter, c, { dryRun: false, authMode: 'pat' })).status, 'published');
  assert.deepEqual(fake.writes, [`asset:${c.vsixAssetName}`, 'asset:SHA256SUMS.txt', 'publish-release']);
});

test('v0.5.2 is a read-only exact no-op and never receives repair writes', async () => {
  const c = candidate('0.5.2');
  const exact = exactPublishedRelease('0.5.2');
  const fake = fakeAdapter({
    openVsx: { kind: 'present', sha256: c.sha256 },
    tag: { kind: 'present', tagName: 'v0.5.2', targetSha: commit },
    release: { kind: 'present', ...exact },
  });
  const result = await promoteCandidate(fake.adapter, c, { dryRun: false, authMode: 'pat' });
  assert.equal(result.status, 'already-published');
  assert.deepEqual(fake.writes, []);

  const incomplete = fakeAdapter({
    openVsx: { kind: 'present', sha256: c.sha256 },
    tag: { kind: 'present', tagName: 'v0.5.2', targetSha: commit },
    release: { kind: 'absent' },
  });
  await assert.rejects(promoteCandidate(incomplete.adapter, c, { dryRun: false, authMode: 'pat' }));
  assert.deepEqual(incomplete.writes, []);
});

test('rejects a candidate whose version metadata and asset names disagree', async () => {
  const bad = { ...candidate(), releaseName: 'Cyclegauge v0.7.0' };
  const fake = fakeAdapter();
  await assert.rejects(promoteCandidate(fake.adapter, bad, { dryRun: false, authMode: 'pat' }));
  assert.deepEqual(fake.writes, []);
});
