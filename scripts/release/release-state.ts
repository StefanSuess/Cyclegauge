import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AuthMode } from './promotion-policy.ts';
import type {
  GitHubReleaseState,
  GitTagState,
  OpenVsxState,
  PromotionAdapter,
} from './promotion-state.ts';

const API_VERSION = '2022-11-28';
const MAX_RELEASE_ASSET_BYTES = 100 * 1024 * 1024;
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function tokenFromEnv(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('CONFIG_INVALID');
  return token;
}

function repositoryParts(repository: string): [string, string] {
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some(value => !/^[A-Za-z0-9_.-]+$/.test(value))) throw new Error('CONFIG_INVALID');
  return [parts[0], parts[1]];
}

async function githubRequest<T>(
  url: string,
  token: string,
  options: { method?: string; body?: unknown; accept?: string } = {},
): Promise<{ status: number; value?: T; bytes?: Uint8Array }> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        accept: options.accept || 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': API_VERSION,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('GITHUB_API_UNAVAILABLE');
  }
  if (response.status === 404) return { status: 404 };
  if (!response.ok) throw new Error(`GITHUB_API_ERROR_${response.status}`);
  if (options.accept === 'application/octet-stream') {
    const declaredSize = Number(response.headers.get('content-length') || 0);
    if (declaredSize > MAX_RELEASE_ASSET_BYTES) throw new Error('RELEASE_ASSET_TOO_LARGE');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('GITHUB_API_RESPONSE_INVALID');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RELEASE_ASSET_BYTES) {
        await reader.cancel();
        throw new Error('RELEASE_ASSET_TOO_LARGE');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, bytes };
  }
  try { return { status: response.status, value: await response.json() as T }; }
  catch { throw new Error('GITHUB_API_RESPONSE_INVALID'); }
}

async function openVsxRequest(url: string): Promise<{ status: number; value?: Record<string, unknown>; bytes?: Uint8Array }> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
  } catch {
    throw new Error('OPENVSX_UNAVAILABLE');
  }
  if (response.status === 404) return { status: 404 };
  if (!response.ok) throw new Error('OPENVSX_UNAVAILABLE');
  if (url.endsWith('.vsix') || response.headers.get('content-type')?.includes('application/octet-stream')) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('OPENVSX_RESPONSE_INVALID');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RELEASE_ASSET_BYTES) { await reader.cancel(); throw new Error('OPENVSX_RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { status: response.status, bytes };
  }
  try { return { status: response.status, value: await response.json() as Record<string, unknown> }; }
  catch { throw new Error('OPENVSX_RESPONSE_INVALID'); }
}

export class GitHubOpenVsxAdapter implements PromotionAdapter {
  private readonly apiBase: string;
  private readonly repository: string;
  private readonly token: string;
  private readonly publisherToolsDir: string;
  private readonly draftVisibility: 'limited' | 'full';

  constructor(input: { repository: string; token: string; publisherToolsDir: string; draftVisibility: 'limited' | 'full'; apiBase?: string }) {
    repositoryParts(input.repository);
    this.repository = input.repository;
    this.token = input.token;
    this.apiBase = (input.apiBase || 'https://api.github.com').replace(/\/$/, '');
    this.publisherToolsDir = input.publisherToolsDir;
    this.draftVisibility = input.draftVisibility;
  }

  private api(path: string): string {
    return `${this.apiBase}/repos/${this.repository}/${path}`;
  }

  async readOpenVsx(version: string): Promise<OpenVsxState> {
    try {
      if (!/^\d+\.\d+\.\d+$/.test(version)) return { kind: 'unavailable' };
      const url = `https://open-vsx.org/api/StefanSuess/cyclegauge/${version}`;
      const metadataResponse = await openVsxRequest(url);
      if (metadataResponse.status === 404) return { kind: 'absent' };
      const metadata = metadataResponse.value;
      if (!metadata || metadata.namespace !== 'StefanSuess' || metadata.name !== 'cyclegauge' || metadata.version !== version ||
          typeof metadata.files !== 'object' || metadata.files === null || !('download' in metadata.files) ||
          typeof metadata.files.download !== 'string') return { kind: 'unavailable' };
      const downloadUrl = new URL(metadata.files.download);
      if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'open-vsx.org') return { kind: 'unavailable' };
      const file = await openVsxRequest(downloadUrl.toString());
      if (file.status !== 200 || !file.bytes) return { kind: 'unavailable' };
      return { kind: 'present', sha256: digest(file.bytes) };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  async readMainSha(): Promise<string> {
    try {
      const branch = await githubRequest<{ object?: { sha?: string } }>(this.api('git/ref/heads/main'), this.token);
      const sha = branch.value?.object?.sha;
      if (branch.status !== 200 || typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) {
        throw new Error('MAIN_STATE_UNAVAILABLE');
      }
      return sha;
    } catch {
      throw new Error('MAIN_STATE_UNAVAILABLE');
    }
  }

  async readTag(tagName: string): Promise<GitTagState> {
    try {
      const refUrl = this.api(`git/ref/tags/${encodeURIComponent(tagName)}`);
      const ref = await githubRequest<{ object?: { sha?: string; type?: string } }>(refUrl, this.token);
      if (ref.status === 404) return { kind: 'absent' };
      let object = ref.value?.object;
      for (let depth = 0; depth < 4; depth++) {
        if (!object?.sha || !object.type) return { kind: 'unavailable' };
        if (object.type === 'commit') return { kind: 'present', tagName, targetSha: object.sha };
        if (object.type !== 'tag') return { kind: 'unavailable' };
        const tag = await githubRequest<{ object?: { sha?: string; type?: string } }>(this.api(`git/tags/${object.sha}`), this.token);
        object = tag.value?.object;
      }
      return { kind: 'unavailable' };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  async readRelease(tagName: string): Promise<GitHubReleaseState> {
    try {
      type ReleaseRow = {
        id?: number; tag_name?: string; name?: string | null; body?: string | null; draft?: boolean; prerelease?: boolean;
      };
      let value: ReleaseRow | undefined;
      for (let page = 1; page <= 100; page++) {
        const response = await githubRequest<ReleaseRow[]>(this.api(`releases?per_page=100&page=${page}`), this.token);
        const rows = response.value;
        if (response.status !== 200 || !Array.isArray(rows) || rows.length > 100) return { kind: 'unavailable' };
        for (const row of rows) {
          if (!row || typeof row.tag_name !== 'string') return { kind: 'unavailable' };
          if (row.tag_name === tagName) {
            if (value) return { kind: 'unavailable' };
            value = row;
          }
        }
        if (rows.length < 100) break;
        if (page === 100) return { kind: 'unavailable' };
      }
      if (!value) return this.draftVisibility === 'limited' ? { kind: 'drafts-unverified' } : { kind: 'absent' };
      if (!Number.isSafeInteger(value.id) ||
          typeof value.tag_name !== 'string' || typeof value.draft !== 'boolean' || typeof value.prerelease !== 'boolean') {
        return { kind: 'unavailable' };
      }
      const version = /^v(\d+\.\d+\.\d+)$/.exec(tagName)?.[1];
      if (!version) return { kind: 'unavailable' };
      const assets = await this.listReleaseAssets(value.id as number, version);
      if (!assets) return { kind: 'unavailable' };
      return {
        kind: 'present',
        id: value.id as number,
        tagName: value.tag_name,
        name: value.name || '',
        body: value.body || '',
        draft: value.draft,
        prerelease: value.prerelease,
        assets,
      };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  private async listReleaseAssets(releaseId: number, version: string): Promise<Array<{ name: string; sha256: string }> | undefined> {
    const result: Array<{ name: string; sha256: string }> = [];
    for (let page = 1; ; page++) {
      if (page > 10) return undefined;
      const response = await githubRequest<Array<{ id?: number; name?: string; size?: number; state?: string }>>(
        this.api(`releases/${releaseId}/assets?per_page=100&page=${page}`), this.token,
      );
      const body = response.value;
      if (!Array.isArray(body) || body.length > 100) return undefined;
      for (const asset of body) {
        if (!Number.isSafeInteger(asset.id) || typeof asset.name !== 'string' || !Number.isSafeInteger(asset.size) || asset.size! < 0 || asset.state !== 'uploaded') return undefined;
        const expectedNames = new Set([`cyclegauge-v${version}.vsix`, 'SHA256SUMS.txt']);
        if (!expectedNames.has(asset.name)) {
          result.push({ name: asset.name, sha256: 'unverifiable' });
          continue;
        }
        if (asset.size! > MAX_RELEASE_ASSET_BYTES) return undefined;
        const downloaded = await githubRequest<never>(
          this.api(`releases/assets/${asset.id}`),
          this.token,
          { accept: 'application/octet-stream' },
        );
        if (!downloaded.bytes) return undefined;
        result.push({ name: asset.name, sha256: digest(downloaded.bytes) });
      }
      if (body.length < 100) return result;
    }
  }

  async publishOpenVsx(vsix: Uint8Array, authMode: AuthMode): Promise<void> {
    if (authMode === 'pat' && !process.env.OPENVSX_PAT) throw new Error('OPENVSX_PAT_MISSING');
    const tempDir = mkdtempSync(join(tmpdir(), 'cyclegauge-publish-'));
    const file = join(tempDir, 'candidate.vsix');
    try {
      writeFileSync(file, vsix, { flag: 'wx' });
      const args = [join(this.publisherToolsDir, 'node_modules/ovsx/bin/ovsx'), 'publish', file, '--pre-release'];
      if (authMode === 'trusted-publishing') args.push('--trusted-publishing');
      const childEnv = { ...process.env };
      delete childEnv.GITHUB_TOKEN;
      delete childEnv.GH_TOKEN;
      if (authMode === 'trusted-publishing') {
        delete childEnv.OPENVSX_PAT;
        delete childEnv.OVSX_PAT;
      } else {
        childEnv.OVSX_PAT = childEnv.OPENVSX_PAT;
        delete childEnv.OPENVSX_PAT;
        delete childEnv.ACTIONS_ID_TOKEN_REQUEST_URL;
        delete childEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
      }
      const child = spawnSync(process.execPath, args, {
        cwd: this.publisherToolsDir,
        env: childEnv,
        stdio: 'ignore',
        timeout: 300_000,
      });
      if (child.error || child.status !== 0) throw new Error('OPENVSX_PUBLISH_FAILED');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async createTag(tagName: string, targetSha: string): Promise<void> {
    const result = await githubRequest(this.api('git/refs'), this.token, {
      method: 'POST', body: { ref: `refs/tags/${tagName}`, sha: targetSha },
    });
    if (result.status < 200 || result.status >= 300) throw new Error('TAG_CREATE_FAILED');
  }

  async createDraftRelease(input: { version: string; tagName: string; targetSha: string; name: string; body: string }): Promise<number> {
    const result = await githubRequest<{ id?: number }>(this.api('releases'), this.token, {
      method: 'POST',
      body: {
        tag_name: input.tagName,
        target_commitish: input.targetSha,
        name: input.name,
        body: input.body,
        draft: true,
        prerelease: true,
      },
    });
    if (!Number.isSafeInteger(result.value?.id) || (result.value?.id as number) < 1) throw new Error('RELEASE_CREATE_FAILED');
    return result.value!.id as number;
  }

  async uploadAsset(releaseId: number, name: string, content: Uint8Array): Promise<void> {
    const release = await githubRequest<{ upload_url?: string }>(this.api(`releases/${releaseId}`), this.token);
    const rawUploadUrl = release.value?.upload_url;
    const templateSuffix = '{?name,label}';
    if (typeof rawUploadUrl !== 'string' || !rawUploadUrl.endsWith(templateSuffix)) throw new Error('RELEASE_UPLOAD_URL_INVALID');
    let url: URL;
    try {
      url = new URL(rawUploadUrl.slice(0, -templateSuffix.length));
      const apiBase = new URL(this.apiBase);
      const expectedOrigin = apiBase.hostname === 'api.github.com' && apiBase.pathname === '/'
        ? 'https://uploads.github.com'
        : apiBase.origin;
      const expectedPath = `${apiBase.pathname.replace(/\/$/, '')}/repos/${this.repository}/releases/${releaseId}/assets`;
      if (url.protocol !== 'https:' || url.origin !== expectedOrigin || url.pathname !== expectedPath ||
          url.username || url.password || url.search || url.hash) throw new Error('RELEASE_UPLOAD_URL_INVALID');
    } catch {
      throw new Error('RELEASE_UPLOAD_URL_INVALID');
    }
    url.searchParams.set('name', name);
    let response: Response;
    const body = new Uint8Array(content.length);
    body.set(content);
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/octet-stream',
          'x-github-api-version': API_VERSION,
        },
        body: body.buffer,
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new Error('RELEASE_ASSET_UPLOAD_FAILED');
    }
    if (!response.ok) throw new Error('RELEASE_ASSET_UPLOAD_FAILED');
  }

  async publishRelease(releaseId: number): Promise<void> {
    const response = await githubRequest(this.api(`releases/${releaseId}`), this.token, {
      method: 'PATCH', body: { draft: false, prerelease: true },
    });
    if (response.status < 200 || response.status >= 300) throw new Error('RELEASE_PUBLISH_FAILED');
  }
}

export function createAdapterFromEnv(publisherToolsDir: string, draftVisibility: 'limited' | 'full'): GitHubOpenVsxAdapter {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new Error('CONFIG_INVALID');
  return new GitHubOpenVsxAdapter({
    repository,
    token: tokenFromEnv(),
    publisherToolsDir,
    draftVisibility,
    apiBase: process.env.GITHUB_API_URL,
  });
}
