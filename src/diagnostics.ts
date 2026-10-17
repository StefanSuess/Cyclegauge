// Pure diagnostics report: fixed codes, counts and platform metadata only. No vscode import, no IO, no values from Kiro data.
// Every field is checked against an allowlist or a strict format; anything else becomes a fixed placeholder, never the original text.
import pkg from '../package.json' with { type: 'json' };
import { STORE_VERSION } from './store.ts';

export const DIAGNOSTICS_HEADER = '# Cyclegauge diagnostics — fixed codes and counts only. Review before sharing.';
// Mirrors the statuses produced by view() in view.ts. A test checks that every status view() produces for its test inputs is allowlisted;
// a status that is not listed shows as `other`.
export const STATUSES = ['unavailable', 'multiple_accounts', 'unknown_account', 'conflicting_snapshots', 'future_observation', 'stale', 'observed', 'reset_elapsed'] as const;
export const FORECAST_TIERS = ['unavailable', 'provisional', 'regular'] as const;
export const STORE_STATES = ['ok', 'runtime_unsupported', 'storage_newer', 'unavailable', 'not_opened'] as const;
export type StoreState = (typeof STORE_STATES)[number];
const GAUGES = ['running', 'failed_to_start', 'starting'] as const;

/** Everything is optional and untyped on purpose: callers hand over what they have and the builder keeps only what is allowlisted. */
export interface DiagnosticsInput {
 surface?: unknown; version?: unknown; editor?: unknown; editorVersion?: unknown; platform?: unknown; arch?: unknown; node?: unknown; electron?: unknown;
 sqlite?: unknown; store?: unknown; storage?: unknown; source?: unknown; timezone?: unknown; gauge?: unknown; status?: unknown; forecast?: unknown;
 snapshots?: unknown; accounts?: unknown; unassociated?: unknown; collection?: unknown; observedAgeMs?: unknown; importCodes?: unknown; discoveredLogs?: unknown; audit?: unknown; rejectedMessages?: unknown;
}
export type Diagnostics = Array<readonly [key: string, value: string]>;

const VERSION = /^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]{1,20})?$/;
const EDITOR = /^[A-Za-z][A-Za-z0-9 .-]{0,40}$/;
const WORD = /^[a-z0-9]{2,16}$/;
const CODE = /^[a-z_]{1,40}$/;
const text = (value: unknown, pattern: RegExp, otherwise = 'other'): string => typeof value === 'string' && pattern.test(value) ? value : otherwise;
const choice = <T extends string>(value: unknown, allowed: readonly T[], otherwise = 'other'): string => typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value : otherwise;
const count = (value: unknown): string => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : 'unavailable';
const flag = (value: unknown, yes: string, no: string): string => value === true ? yes : value === false ? no : 'unknown';

/** Maps any error to a fixed store state; the error itself is never inspected beyond the two known codes. */
export function storeStateFor(error: unknown): 'runtime_unsupported' | 'storage_newer' | 'unavailable' {
 const message = error instanceof Error ? error.message : undefined;
 return message === 'RUNTIME_UNSUPPORTED' ? 'runtime_unsupported' : message === 'STORAGE_NEWER' ? 'storage_newer' : 'unavailable';
}
export function sqliteAvailable(): boolean {
 try { return typeof (process.getBuiltinModule?.('node:sqlite') as { DatabaseSync?: unknown } | undefined)?.DatabaseSync === 'function'; } catch { return false; }
}
/** Process metadata shared by the extension and the CLI. */
export const runtimeFacts = (): Pick<DiagnosticsInput, 'platform' | 'arch' | 'node' | 'electron' | 'sqlite'> =>
 ({ platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron, sqlite: sqliteAvailable() });

/** Counts only: accounts are the partitions of associated snapshots; the rest are counted separately. Plain loops, no spread over data-sized arrays. */
export function snapshotFacts(snapshots: ReadonlyArray<{ partition: string; associated: boolean; observedAt: string }>): { snapshots: number; accounts: number; unassociated: number; latestMs?: number } {
 const partitions = new Set<string>(); let unassociated = 0, latestMs: number | undefined;
 for (const s of snapshots) {
  if (s.associated) partitions.add(s.partition); else unassociated++;
  const t = Date.parse(s.observedAt);
  if (Number.isFinite(t) && (latestMs === undefined || t > latestMs)) latestMs = t;
 }
 return { snapshots: snapshots.length, accounts: partitions.size, unassociated, latestMs };
}
function freshness(age: unknown): string {
 if (age === null || age === undefined) return 'none';
 if (typeof age !== 'number' || !Number.isFinite(age)) return 'other';
 return age < 3_600_000 ? '<1h' : age <= 86_400_000 ? '1-24h' : '>24h';
}
function codes(value: unknown): string {
 if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'none';
 const kept: string[] = []; let other = 0;
 for (const [code, n] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
  if (CODE.test(code) && code !== 'other' && typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) kept.push(`${code}=${n}`); else other++;
 }
 if (other) kept.push(`other=${other}`);
 return kept.join(', ') || 'none';
}

export function buildDiagnostics(input: DiagnosticsInput = {}): Diagnostics {
 const cli = input.surface === 'cli';
 return [
  ['cyclegauge', text(input.version ?? pkg.version, VERSION)],
  ['surface', cli ? 'cli' : 'extension'],
  ['editor', cli ? 'none' : text(input.editor, EDITOR)],
  ['editor_version', cli ? 'none' : text(input.editorVersion, VERSION)],
  ['platform', text(input.platform, WORD)],
  ['arch', text(input.arch, WORD)],
  ['node', text(input.node, VERSION)],
  ['electron', input.electron === undefined || input.electron === null || input.electron === '' ? 'none' : text(input.electron, VERSION)],
  ['sqlite', flag(input.sqlite, 'available', 'unavailable')],
  ['store_version', String(STORE_VERSION)],
  ['store', choice(input.store ?? 'not_opened', STORE_STATES)],
  ...(cli ? [['collection', choice(input.collection ?? 'not_run', ['ok', 'unavailable', 'not_run'])] as const] : []),
  ['storage', choice(input.storage, ['default', 'chosen'], 'unknown')],
  ['source', choice(input.source, ['default', 'chosen'], 'unknown')],
  ['timezone', choice(input.timezone, ['device', 'chosen', 'unset'], 'unknown')],
  ...(cli ? [] : [['gauge', choice(input.gauge ?? 'starting', GAUGES)] as const]),
  ['status', choice(input.status ?? 'unavailable', STATUSES)],
  ['forecast', choice(input.forecast ?? 'unavailable', FORECAST_TIERS)],
  ['snapshots', count(input.snapshots)],
  ['accounts', count(input.accounts)],
  ['unassociated', count(input.unassociated)],
  ['freshness', freshness(input.observedAgeMs ?? null)],
  ['import_codes', codes(input.importCodes)],
  ['discovered_logs', count(input.discoveredLogs)],
  ['audit', input.audit === true ? 'available' : 'unavailable']
  ,...(cli ? [] : [['rejected_messages', count(input.rejectedMessages ?? 0)] as const])
 ];
}
export const formatDiagnostics = (d: Diagnostics): string => `${DIAGNOSTICS_HEADER}\n${d.map(([key, value]) => `${key}: ${value}`).join('\n')}\n`;
