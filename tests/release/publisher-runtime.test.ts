import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVsix } from '../../scripts/release/build-vsix.ts';
import { isPreReleaseVersion } from '../../scripts/release/channel.ts';
import { readZip, writeZip } from '../../scripts/release/zip.ts';

const repository = resolve(import.meta.dirname, '../..');

test('the actual protected publisher archive extracts with every entrypoint import', { skip: process.platform === 'win32' ? 'Protected publisher runs on Ubuntu; POSIX tar/shell archive contract' : false }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'synthetic-release-runtime-'));
  try {
    const bundle = join(temp, 'bundle');
    const tools = join(temp, 'tools');
    const extracted = join(temp, 'extracted');
    mkdirSync(tools, { recursive: true });
    mkdirSync(extracted);
    writeFileSync(join(tools, 'synthetic-marker'), 'synthetic');
    const packed = spawnSync('bash', ['scripts/release/prepare-publisher-runtime.sh', bundle, tools], { cwd: repository, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const archive = join(bundle, 'publisher-runtime.tar.gz');
    assert.equal(existsSync(archive), true);
    const unpacked = spawnSync('tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    assert.equal(unpacked.status, 0, unpacked.stderr);
    assert.equal(existsSync(join(extracted, 'scripts/release/zip.ts')), true);
    assert.equal(existsSync(join(extracted, 'scripts/release/channel.ts')), true);
    assert.equal(existsSync(join(extracted, 'publisher-tools/node_modules/synthetic-marker')), true);
    await import(pathToFileURL(join(extracted, 'scripts/release/publish-candidate.ts')).href);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('extracted publisher runs the full promotion from a relative bundle directory against synthetic remote services', { skip: process.platform === 'win32' ? 'Protected publisher runs on Ubuntu; POSIX tar/shell archive contract' : false }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'synthetic-release-execution-'));
  try {
    const bundle = join(temp, 'bundle');
    const tools = join(temp, 'tools');
    const runtime = join(bundle, 'publisher-runtime');
    const marker = join(temp, 'openvsx-published');
    const resultFile = join(temp, 'mock-result.json');
    const originalVsix = join(temp, 'original.vsix');
    const packagedVersion = (JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as { version: string }).version;
    // A different version on the same channel as the packaged one, so the flag stays valid whatever the package version is.
    const version = isPreReleaseVersion(packagedVersion) ? '0.7.0' : '0.8.0';
    const commit = 'a'.repeat(40);
    mkdirSync(join(tools, 'ovsx/bin'), { recursive: true });
    writeFileSync(join(tools, 'ovsx/bin/ovsx'), `require('node:fs').writeFileSync(process.env.SYNTHETIC_OPENVSX_MARKER, 'published');\n`);
    await buildVsix(originalVsix);
    const entries = readZip(readFileSync(originalVsix)).map(entry => {
      let data = entry.data;
      if (entry.name === 'extension/package.json') {
        const manifest = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        manifest.version = version;
        data = Buffer.from(JSON.stringify(manifest));
      } else if (entry.name === 'extension.vsixmanifest') {
        data = Buffer.from(data.toString('utf8').replaceAll(packagedVersion, version));
      }
      return { name: entry.name, data };
    });
    const vsix = writeZip(entries);
    const hash = createHash('sha256').update(vsix).digest('hex');
    const sums = Buffer.from(`${hash}  cyclegauge-v${version}.vsix\n`);
    const notes = Buffer.from('Synthetic release notes.');
    mkdirSync(bundle);
    writeFileSync(join(bundle, `cyclegauge-v${version}.vsix`), vsix);
    writeFileSync(join(bundle, 'SHA256SUMS.txt'), sums);
    writeFileSync(join(bundle, 'release-notes.md'), notes);
    writeFileSync(join(bundle, 'promotion.json'), JSON.stringify({
      version, commit, runId: 12, artifactId: 34, artifactName: 'release-candidate', sha256: hash,
      releaseNotesSha256: createHash('sha256').update(notes).digest('hex'),
      checksumFileSha256: createHash('sha256').update(sums).digest('hex'),
      vsixAssetName: `cyclegauge-v${version}.vsix`, checksumAssetName: 'SHA256SUMS.txt', releaseName: `Cyclegauge v${version}`,
    }));
    const packed = spawnSync('bash', ['scripts/release/prepare-publisher-runtime.sh', bundle, tools], { cwd: repository, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    mkdirSync(runtime);
    const unpacked = spawnSync('tar', ['-xzf', join(bundle, 'publisher-runtime.tar.gz'), '-C', runtime], { encoding: 'utf8' });
    assert.equal(unpacked.status, 0, unpacked.stderr);
    const preload = join(temp, 'mock-remotes.mjs');
    writeFileSync(preload, `
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const vsix = readFileSync(process.env.SYNTHETIC_VSIX);
let tag, release;
const assets = [];
const writes = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input.toString());
  const path = url.pathname;
  const method = init.method || 'GET';
  if (url.hostname === 'open-vsx.org') {
    if (!existsSync(process.env.SYNTHETIC_OPENVSX_MARKER)) return json({}, 404);
    if (path.endsWith('/file.vsix')) return new Response(vsix, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    return json({ namespace: 'StefanSuess', name: 'cyclegauge', version: '${version}', files: { download: 'https://open-vsx.org/api/StefanSuess/cyclegauge/${version}/file.vsix' } });
  }
  if (url.hostname === 'uploads.github.com' && method === 'POST') {
    const bytes = Buffer.from(init.body);
    assets.push({ id: 100 + assets.length, name: url.searchParams.get('name'), bytes });
    writes.push('asset:' + url.searchParams.get('name'));
    return json({}, 201);
  }
  if (url.hostname !== 'api.github.com') throw new Error('UNEXPECTED_REMOTE_HOST');
  if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: process.env.SOURCE_SHA } });
  if (path.endsWith('/git/ref/tags/v${version}')) return tag ? json({ object: { sha: tag, type: 'commit' } }) : json({}, 404);
  if (path.endsWith('/git/refs') && method === 'POST') { tag = JSON.parse(init.body).sha; writes.push('tag'); return json({}, 201); }
  if (path.endsWith('/releases') && method === 'GET') return json(release ? [release] : []);
  if (path.endsWith('/releases') && method === 'POST') {
    const body = JSON.parse(init.body);
    release = { id: 77, tag_name: body.tag_name, name: body.name, body: body.body, draft: true, prerelease: body.prerelease };
    writes.push('draft');
    return json({ id: 77 }, 201);
  }
  if (path.endsWith('/releases/77/assets')) return json(assets.map(asset => ({ id: asset.id, name: asset.name, size: asset.bytes.length, state: 'uploaded' })));
  if (path.includes('/releases/assets/')) {
    const asset = assets.find(item => path.endsWith('/' + item.id));
    return asset ? new Response(asset.bytes, { status: 200, headers: { 'content-length': String(asset.bytes.length) } }) : json({}, 404);
  }
  if (path.endsWith('/releases/77') && method === 'GET') return json({ upload_url: 'https://uploads.github.com/repos/StefanSuess/Cyclegauge/releases/77/assets{?name,label}' });
  if (path.endsWith('/releases/77') && method === 'PATCH') { release.draft = false; writes.push('publish-release'); writeFileSync(process.env.SYNTHETIC_RESULT, JSON.stringify({ writes, tag, release, assets: assets.map(asset => asset.name) })); return json(release); }
  throw new Error('UNEXPECTED_REMOTE_REQUEST');
};
`);
    const execution = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', preload, join(runtime, 'scripts/release/publish-candidate.ts')], {
      cwd: repository, encoding: 'utf8', timeout: 60_000,
      env: {
        PATH: process.env.PATH || '', PROMOTION_BUNDLE_DIR: relative(repository, bundle), GITHUB_TOKEN: 'synthetic-github-token',
        GITHUB_REPOSITORY: 'StefanSuess/Cyclegauge', GITHUB_API_URL: 'https://api.github.com',
        GITHUB_SHA: commit, SOURCE_SHA: commit, INPUT_VERSION: version, INPUT_AUTH_MODE: 'trusted-publishing',
        EXPECTED_RUN_ID: '12', EXPECTED_ARTIFACT_ID: '34', GITHUB_STEP_SUMMARY: join(temp, 'summary.md'),
        SYNTHETIC_OPENVSX_MARKER: marker, SYNTHETIC_VSIX: join(bundle, `cyclegauge-v${version}.vsix`), SYNTHETIC_RESULT: resultFile,
      },
    });
    assert.equal(execution.status, 0, `${execution.stdout}\n${execution.stderr}`);
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { writes: string[]; tag: string; release: { draft: boolean }; assets: string[] };
    assert.deepEqual(result.writes, ['tag', 'draft', `asset:cyclegauge-v${version}.vsix`, 'asset:SHA256SUMS.txt', 'publish-release']);
    assert.equal(result.tag, commit);
    assert.equal(result.release.draft, false);
    assert.deepEqual(result.assets, [`cyclegauge-v${version}.vsix`, 'SHA256SUMS.txt']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
