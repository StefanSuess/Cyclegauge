import { arch as osArch } from 'node:os';
import { discover } from './source.ts';
import { probeRuntime, type RuntimeProbes } from './runtime.ts';
import { guardKind } from './guard.ts';
import type { DiscoveryMethod } from './paths.ts';
// Fixed-code report: platform, versions, capability probes, guard kind, discovery method and counts.
// No path, SID, identifier or log content is ever included; every string is a short token.
export interface DiagnosticsReport {
 schema: 'ekg-diagnostics.1'; platform: string; arch: string; node: string; electron: string;
 runtime: RuntimeProbes; guard: 'posix' | 'unsupported'; discovery: DiscoveryMethod;
 sourceLogFiles: number; sourceCodes: Record<string, number>;
}
const token = (value: string | undefined, fallback = 'unknown') => (value !== undefined && /^[A-Za-z0-9.+-]{1,32}$/.test(value) ? value : fallback);
export async function diagnostics(o: {
 root: string; method: DiscoveryMethod; platform?: NodeJS.Platform; arch?: string; versions?: { node?: string; electron?: string };
}): Promise<DiagnosticsReport> {
 const platform = o.platform ?? process.platform;
 const found = await discover(o.root);
 const codes: Record<string, number> = {};
 for (const [code, count] of Object.entries(found.codes)) codes[token(code, 'other_code')] = count;
 return {
  schema: 'ekg-diagnostics.1', platform: token(platform), arch: token(o.arch ?? osArch()),
  node: token(o.versions?.node ?? process.versions.node), electron: token(o.versions?.electron ?? process.versions.electron, 'none'),
  runtime: probeRuntime(), guard: guardKind(platform), discovery: o.method,
  sourceLogFiles: found.files.length, sourceCodes: codes,
 };
}
