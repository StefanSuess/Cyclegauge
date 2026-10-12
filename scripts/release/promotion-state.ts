import { createHash } from 'node:crypto';
import { isVersion, type AuthMode } from './promotion-policy.ts';

export type OpenVsxState =
  | { kind: 'absent' }
  | { kind: 'present'; sha256: string }
  | { kind: 'unavailable' };

export type GitTagState =
  | { kind: 'absent' }
  | { kind: 'present'; tagName: string; targetSha: string }
  | { kind: 'unavailable' };

export interface ReleaseAssetState { name: string; sha256: string }
export type GitHubReleaseState =
  | { kind: 'absent' }
  | { kind: 'drafts-unverified' }
  | {
      kind: 'present';
      id: number;
      tagName: string;
      name: string;
      body: string;
      draft: boolean;
      prerelease: boolean;
      assets: ReleaseAssetState[];
    }
  | { kind: 'unavailable' };

export interface PromotionCandidate {
  version: string;
  commit: string;
  sha256: string;
  vsixBytes: Uint8Array;
  checksumBytes: Uint8Array;
  vsixAssetName: string;
  checksumAssetName: string;
  releaseName: string;
  releaseNotes: string;
}

export interface PromotionAdapter {
  readOpenVsx(version: string): Promise<OpenVsxState>;
  readTag(tagName: string): Promise<GitTagState>;
  readRelease(tagName: string): Promise<GitHubReleaseState>;
  publishOpenVsx(vsix: Uint8Array, authMode: AuthMode): Promise<void>;
  createTag(tagName: string, targetSha: string): Promise<void>;
  createDraftRelease(input: { version: string; tagName: string; targetSha: string; name: string; body: string }): Promise<number>;
  uploadAsset(releaseId: number, name: string, content: Uint8Array): Promise<void>;
  publishRelease(releaseId: number): Promise<void>;
}

export class PromotionStateError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'PromotionStateError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new PromotionStateError(code); };
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const validCommit = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

function validateCandidate(candidate: PromotionCandidate): { tagName: string; expectedAssets: ReleaseAssetState[] } {
  if (!isVersion(candidate.version)) return fail('VERSION_INVALID');
  if (!validCommit(candidate.commit)) return fail('COMMIT_INVALID');
  if (!validHash(candidate.sha256) || sha256(candidate.vsixBytes) !== candidate.sha256) return fail('CANDIDATE_CHECKSUM_MISMATCH');
  if (candidate.vsixAssetName !== `cyclegauge-v${candidate.version}.vsix` || candidate.checksumAssetName !== 'SHA256SUMS.txt') {
    return fail('CANDIDATE_ASSET_NAME_INVALID');
  }
  const checksum = Buffer.from(candidate.checksumBytes).toString('utf8');
  if (checksum !== `${candidate.sha256}  ${candidate.vsixAssetName}\n`) return fail('CANDIDATE_CHECKSUM_FILE_INVALID');
  if (candidate.releaseName !== `Cyclegauge v${candidate.version}` || !candidate.releaseNotes.trim()) return fail('CANDIDATE_RELEASE_METADATA_INVALID');
  const tagName = `v${candidate.version}`;
  return {
    tagName,
    expectedAssets: [
      { name: candidate.vsixAssetName, sha256: candidate.sha256 },
      { name: candidate.checksumAssetName, sha256: sha256(candidate.checksumBytes) },
    ],
  };
}

function assertOpenVsx(state: OpenVsxState, expectedHash: string): void {
  if (state.kind === 'unavailable') return fail('OPENVSX_STATE_UNAVAILABLE');
  if (state.kind === 'present' && (!validHash(state.sha256) || state.sha256 !== expectedHash)) return fail('OPENVSX_VERSION_CONFLICT');
}

function assertTag(state: GitTagState, tagName: string, commit: string): void {
  if (state.kind === 'unavailable') return fail('TAG_STATE_UNAVAILABLE');
  if (state.kind === 'present' && (state.tagName !== tagName || !validCommit(state.targetSha) || state.targetSha.toLowerCase() !== commit.toLowerCase())) {
    return fail('TAG_CONFLICT');
  }
}

function inspectAssets(assets: ReleaseAssetState[], expected: ReleaseAssetState[], allowMissing: boolean): Set<string> {
  if (!Array.isArray(assets)) return fail('RELEASE_ASSET_STATE_UNAVAILABLE');
  const byName = new Map<string, string>();
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || !validHash(asset.sha256) || byName.has(asset.name)) return fail('RELEASE_ASSET_STATE_UNAVAILABLE');
    byName.set(asset.name, asset.sha256);
  }
  const expectedByName = new Map(expected.map(asset => [asset.name, asset.sha256]));
  if ([...byName.keys()].some(name => !expectedByName.has(name))) return fail('RELEASE_ASSET_CONFLICT');
  const missing = new Set(expected.map(asset => asset.name));
  for (const [name, hash] of byName) {
    if (expectedByName.get(name) !== hash) return fail('RELEASE_ASSET_CONFLICT');
    missing.delete(name);
  }
  if (!allowMissing && missing.size > 0) return fail('PUBLISHED_RELEASE_INCOMPLETE');
  return missing;
}

function assertReleaseMetadata(
  state: GitHubReleaseState,
  candidate: PromotionCandidate,
  tagName: string,
  expectedAssets: ReleaseAssetState[],
): { missing: Set<string> } | undefined {
  if (state.kind === 'unavailable') return fail('RELEASE_STATE_UNAVAILABLE');
  if (state.kind === 'drafts-unverified') return fail('RELEASE_DRAFT_VISIBILITY_LIMITED');
  if (state.kind === 'absent') return undefined;
  if (!Number.isSafeInteger(state.id) || state.id < 1 || state.tagName !== tagName ||
      state.name !== candidate.releaseName || normalizeNotes(state.body) !== normalizeNotes(candidate.releaseNotes) || state.prerelease !== true ||
      typeof state.draft !== 'boolean') return fail('RELEASE_METADATA_CONFLICT');
  return { missing: inspectAssets(state.assets, expectedAssets, state.draft) };
}

// GitHub may return CRLF line endings or trim the trailing newline; content must otherwise match exactly.
const normalizeNotes = (value: string): string => value.replace(/\r\n/g, '\n').trimEnd();

function assertConsistentState(input: {
  openVsx: OpenVsxState;
  tag: GitTagState;
  release: GitHubReleaseState;
  candidate: PromotionCandidate;
  tagName: string;
  expectedAssets: ReleaseAssetState[];
}): void {
  assertOpenVsx(input.openVsx, input.candidate.sha256);
  assertTag(input.tag, input.tagName, input.candidate.commit);
  assertReleaseMetadata(input.release, input.candidate, input.tagName, input.expectedAssets);
  if (input.release.kind === 'present' && input.tag.kind === 'absent') return fail('RELEASE_WITHOUT_TAG');
  if (input.release.kind === 'present' && !input.release.draft && input.openVsx.kind === 'absent') return fail('PUBLISHED_RELEASE_WITHOUT_OPENVSX');
}

async function readState(adapter: PromotionAdapter, candidate: PromotionCandidate, tagName: string, expectedAssets: ReleaseAssetState[]) {
  let openVsx: OpenVsxState, tag: GitTagState, release: GitHubReleaseState;
  try {
    [openVsx, tag, release] = await Promise.all([
      adapter.readOpenVsx(candidate.version),
      adapter.readTag(tagName),
      adapter.readRelease(tagName),
    ]);
  } catch {
    return fail('PROMOTION_READ_FAILED');
  }
  if (release.kind === 'drafts-unverified') {
    assertOpenVsx(openVsx, candidate.sha256);
    assertTag(tag, tagName, candidate.commit);
  } else {
    assertConsistentState({ openVsx, tag, release, candidate, tagName, expectedAssets });
  }
  return { openVsx, tag, release };
}

async function readOpenVsx(adapter: PromotionAdapter, candidate: PromotionCandidate): Promise<OpenVsxState> {
  try { return await adapter.readOpenVsx(candidate.version); } catch { return fail('PROMOTION_READ_FAILED'); }
}

async function readTag(adapter: PromotionAdapter, tagName: string): Promise<GitTagState> {
  try { return await adapter.readTag(tagName); } catch { return fail('PROMOTION_READ_FAILED'); }
}

async function readRelease(adapter: PromotionAdapter, tagName: string): Promise<GitHubReleaseState> {
  try { return await adapter.readRelease(tagName); } catch { return fail('PROMOTION_READ_FAILED'); }
}

async function writeThenVerify(write: () => Promise<unknown>, reread: () => Promise<unknown>, verify: (state: unknown) => void): Promise<void> {
  try { await write(); } catch { /* A raced retry is accepted only if the read proves the exact result. */ }
  const state = await reread();
  verify(state);
}

export async function promoteCandidate(
  adapter: PromotionAdapter,
  candidate: PromotionCandidate,
  options: { dryRun: boolean; authMode: AuthMode },
): Promise<{ status: 'ready' | 'already-published' | 'published'; tagName: string; sha256: string }> {
  const { tagName, expectedAssets } = validateCandidate(candidate);
  if (typeof options.dryRun !== 'boolean' || !['pat', 'trusted-publishing'].includes(options.authMode)) return fail('PROMOTION_OPTIONS_INVALID');
  let state = await readState(adapter, candidate, tagName, expectedAssets);
  if (state.release.kind === 'drafts-unverified' && !options.dryRun) return fail('RELEASE_DRAFT_VISIBILITY_LIMITED');
  if (state.release.kind === 'present' && !state.release.draft) {
    inspectAssets(state.release.assets, expectedAssets, false);
    return { status: 'already-published', tagName, sha256: candidate.sha256 };
  }

  if (candidate.version === '0.5.2') {
    return fail('HISTORICAL_VERSION_NOT_EXACT');
  }
  if (options.dryRun) return { status: 'ready', tagName, sha256: candidate.sha256 };

  let openVsx = await readOpenVsx(adapter, candidate);
  assertOpenVsx(openVsx, candidate.sha256);
  if (openVsx.kind === 'absent') {
    await writeThenVerify(
      () => adapter.publishOpenVsx(candidate.vsixBytes, options.authMode),
      () => readOpenVsx(adapter, candidate),
      value => {
        const result = value as OpenVsxState;
        assertOpenVsx(result, candidate.sha256);
        if (result.kind !== 'present') return fail('PROMOTION_WRITE_FAILED');
      },
    );
  }

  let tag = await readTag(adapter, tagName);
  assertTag(tag, tagName, candidate.commit);
  if (tag.kind === 'absent') {
    await writeThenVerify(
      () => adapter.createTag(tagName, candidate.commit),
      () => readTag(adapter, tagName),
      value => {
        const result = value as GitTagState;
        assertTag(result, tagName, candidate.commit);
        if (result.kind !== 'present') return fail('PROMOTION_WRITE_FAILED');
      },
    );
  }

  let releaseState = await readRelease(adapter, tagName);
  assertReleaseMetadata(releaseState, candidate, tagName, expectedAssets);
  if (releaseState.kind === 'absent') {
    await writeThenVerify(
      () => adapter.createDraftRelease({ version: candidate.version, tagName, targetSha: candidate.commit, name: candidate.releaseName, body: candidate.releaseNotes }),
      () => readRelease(adapter, tagName),
      value => {
        const result = value as GitHubReleaseState;
        if (result.kind !== 'present' || result.draft !== true) return fail('PROMOTION_WRITE_FAILED');
        assertReleaseMetadata(result, candidate, tagName, expectedAssets);
      },
    );
    releaseState = await readRelease(adapter, tagName);
  }

  for (const expected of expectedAssets) {
    const current = await readRelease(adapter, tagName);
    const details = assertReleaseMetadata(current, candidate, tagName, expectedAssets);
    if (current.kind !== 'present' || current.draft !== true || !details) return fail('RELEASE_STATE_UNEXPECTED');
    if (!details.missing.has(expected.name)) continue;
    const content = expected.name === candidate.vsixAssetName ? candidate.vsixBytes : candidate.checksumBytes;
    await writeThenVerify(
      () => adapter.uploadAsset(current.id, expected.name, content),
      () => readRelease(adapter, tagName),
      value => {
        const result = value as GitHubReleaseState;
        const after = assertReleaseMetadata(result, candidate, tagName, expectedAssets);
        if (result.kind !== 'present' || !after || after.missing.has(expected.name)) return fail('PROMOTION_WRITE_FAILED');
      },
    );
  }

  state = await readState(adapter, candidate, tagName, expectedAssets);
  if (state.openVsx.kind !== 'present' || state.tag.kind !== 'present' || state.release.kind !== 'present' || !state.release.draft) {
    return fail('PROMOTION_STATE_INCOMPLETE');
  }
  const missing = inspectAssets(state.release.assets, expectedAssets, false);
  if (missing.size) return fail('PUBLISHED_RELEASE_INCOMPLETE');
  await writeThenVerify(
    () => adapter.publishRelease(state.release.kind === 'present' ? state.release.id : 0),
    () => readRelease(adapter, tagName),
    value => {
      const result = value as GitHubReleaseState;
      const details = assertReleaseMetadata(result, candidate, tagName, expectedAssets);
      if (result.kind !== 'present' || result.draft || !details || details.missing.size) return fail('PROMOTION_WRITE_FAILED');
    },
  );
  const finalState = await readState(adapter, candidate, tagName, expectedAssets);
  if (finalState.openVsx.kind !== 'present' || finalState.tag.kind !== 'present' || finalState.release.kind !== 'present' || finalState.release.draft) {
    return fail('PROMOTION_STATE_INCOMPLETE');
  }
  return { status: 'published', tagName, sha256: candidate.sha256 };
}
