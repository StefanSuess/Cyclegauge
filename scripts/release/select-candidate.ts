import { appendFileSync } from 'node:fs';
import { isMain } from '../is-main.ts';
import {
  type CandidateArtifact,
  selectCandidateArtifact,
  selectTrustedCiRun,
  validateCiJobs,
  validateReleaseRequest,
} from './promotion-policy.ts';

const API_VERSION = '2022-11-28';
const PAGE_SIZE = 100;

interface ApiRun {
  id: number;
  path: string;
  event: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  run_number: number;
  run_attempt: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error('CONFIG_INVALID');
  return value;
}

function appendOutput(name: string, value: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || /[\r\n]/.test(value)) throw new Error('OUTPUT_INVALID');
  appendFileSync(requiredEnv('GITHUB_OUTPUT'), `${name.toLowerCase()}=${value}\n`, { encoding: 'utf8' });
}

async function getJson<T>(url: string, token: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': API_VERSION,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('GITHUB_API_UNAVAILABLE');
  }
  if (!response.ok) throw new Error(`GITHUB_API_ERROR_${response.status}`);
  try { return await response.json() as T; } catch { throw new Error('GITHUB_API_RESPONSE_INVALID'); }
}

async function listPages<T>(
  baseUrl: string,
  token: string,
  key: string,
): Promise<T[]> {
  const results: T[] = [];
  let totalCount = Number.POSITIVE_INFINITY;
  for (let page = 1; results.length < totalCount; page++) {
    if (page > 100) throw new Error('GITHUB_API_PAGINATION_LIMIT');
    const separator = baseUrl.includes('?') ? '&' : '?';
    const value = await getJson<{ total_count: number; [key: string]: unknown }>(
      `${baseUrl}${separator}per_page=${PAGE_SIZE}&page=${page}`,
      token,
    );
    if (!Number.isSafeInteger(value.total_count) || !Array.isArray(value[key])) throw new Error('GITHUB_API_RESPONSE_INVALID');
    const pageItems = value[key] as T[];
    totalCount = value.total_count;
    results.push(...pageItems);
    if (pageItems.length === 0) break;
  }
  return results;
}

function apiUrl(base: string, path: string): string {
  const url = new URL(path, `${base.replace(/\/$/, '')}/`);
  if (url.protocol !== 'https:') throw new Error('CONFIG_INVALID');
  return url.toString();
}

async function run(): Promise<void> {
  const token = requiredEnv('GITHUB_TOKEN');
  const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
  const repository = requiredEnv('GITHUB_REPOSITORY');
  const sha = requiredEnv('GITHUB_SHA');
  const ref = requiredEnv('GITHUB_REF');
  const event = requiredEnv('GITHUB_EVENT_NAME');
  const [owner, name] = repository.split('/');
  if (!owner || !name || repository.split('/').length !== 2) throw new Error('CONFIG_INVALID');
  if (event !== 'workflow_dispatch' || ref !== 'refs/heads/main') throw new Error('DISPATCH_REF_INVALID');

  const request = validateReleaseRequest({
    version: requiredEnv('INPUT_VERSION'),
    dryRun: requiredEnv('INPUT_DRY_RUN') === 'true',
    authMode: requiredEnv('INPUT_AUTH_MODE'),
  });
  if (!['true', 'false'].includes(requiredEnv('INPUT_DRY_RUN'))) throw new Error('DRY_RUN_INVALID');

  const repo = await getJson<{ id: number }>(apiUrl(apiBase, `repos/${repository}`), token);
  if (!Number.isSafeInteger(repo.id) || repo.id < 1) throw new Error('GITHUB_API_RESPONSE_INVALID');
  const refData = await getJson<{ object: { sha: string } }>(apiUrl(apiBase, `repos/${repository}/git/ref/heads/main`), token);
  if (!refData.object?.sha || refData.object.sha.toLowerCase() !== sha.toLowerCase()) throw new Error('MAIN_SHA_MISMATCH');

  const workflowRunsUrl = apiUrl(
    apiBase,
    `repos/${repository}/actions/workflows/ci.yml/runs?branch=main&head_sha=${encodeURIComponent(sha)}`,
  );
  const rawRuns = await listPages<Record<string, unknown>>(workflowRunsUrl, token, 'workflow_runs');
  const runs: ApiRun[] = rawRuns.map(raw => ({
    id: Number(raw.id),
    path: typeof raw.path === 'string' ? raw.path.split('@')[0] : '',
    event: typeof raw.event === 'string' ? raw.event : '',
    head_branch: typeof raw.head_branch === 'string' ? raw.head_branch : '',
    head_sha: typeof raw.head_sha === 'string' ? raw.head_sha : '',
    status: typeof raw.status === 'string' ? raw.status : '',
    conclusion: typeof raw.conclusion === 'string' ? raw.conclusion : null,
    run_number: Number(raw.run_number),
    run_attempt: Number(raw.run_attempt),
  }));
  const selected = selectTrustedCiRun(runs, { mainSha: refData.object.sha, dispatchSha: sha });

  const jobs = await listPages<{ name: string; status: string; conclusion: string | null }>(
    apiUrl(apiBase, `repos/${repository}/actions/runs/${selected.id}/jobs`), token, 'jobs',
  );
  validateCiJobs(jobs);

  const artifacts = await listPages<Record<string, unknown>>(
    apiUrl(apiBase, `repos/${repository}/actions/runs/${selected.id}/artifacts`), token, 'artifacts',
  );
  const artifact = selectCandidateArtifact(artifacts as unknown as CandidateArtifact[], {
    runId: selected.id,
    repositoryId: repo.id,
    headSha: refData.object.sha,
    branch: 'main',
  });

  appendOutput('RUN_ID', String(selected.id));
  appendOutput('SOURCE_SHA', selected.head_sha);
  appendOutput('ARTIFACT_ID', String(artifact.id));
  appendOutput('ARTIFACT_NAME', artifact.name);
  appendOutput('ARTIFACT_DIGEST', artifact.digest || 'unavailable');
  appendOutput('REPOSITORY_ID', String(repo.id));
  appendOutput('VERSION', request.version);
  appendOutput('DRY_RUN', String(request.dryRun));
  appendOutput('AUTH_MODE', request.authMode);
  appendOutput('REPOSITORY', repository);

  const summary = requiredEnv('GITHUB_STEP_SUMMARY');
  const runUrl = `https://github.com/${repository}/actions/runs/${selected.id}`;
  const commitUrl = `https://github.com/${repository}/commit/${selected.head_sha}`;
  appendFileSync(summary, [
    '### Verified release candidate',
    '',
    `- Version: \`${request.version}\``,
    `- Source commit: [\`${selected.head_sha}\`](${commitUrl})`,
    `- Successful CI run: [${selected.id}](${runUrl})`,
    `- Candidate artifact: \`${artifact.name}\` (ID \`${artifact.id}\`) in the linked CI run`,
    `- Artifact archive digest: \`${artifact.digest || 'unavailable'}\` (container digest; VSIX checksum is verified after download)`,
    `- Mode: \`${request.dryRun ? 'dry run' : 'live; awaiting protected release approval'}\``,
    '',
    'Review and, for a live run, natively accept this exact VSIX before approving the protected deployment.',
    '',
  ].join('\n'), { encoding: 'utf8' });
}

async function main(): Promise<number> {
  try {
    await run();
    return 0;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PREFLIGHT_SELECTION_FAILED';
    console.error(`RELEASE_PREFLIGHT ${code}`);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = await main();
