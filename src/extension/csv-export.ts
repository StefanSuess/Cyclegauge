import { history } from '../history.ts';
import type { StoredSnapshot } from '../store.ts';

// CSV export of the user's own retained account updates. Pure and vscode-free. Every cell is either a regex-validated number or timestamp, a fixed
// flag code or the word `unknown`, so no free text can reach the file (and none starts with =, +, - or @). No partition key, identifier or path is exported.
export const CSV_HEADER = ['observed_at_source', 'observed_at_utc', 'credits_used', 'credit_limit', 'reset_at_utc', 'flags', 'conflict'] as const;
export const MAX_CSV_ROWS = 200_000;
export type CsvResult = { ok: true; csv: string; rows: number } | { ok: false; code: 'no_history' | 'multiple_accounts' | 'unavailable' };

const FLAGS = new Set(['reduced_precision', 'missing_usage', 'missing_limit', 'unsupported_extra_credits', 'conflicting_reset_metadata', 'missing_reset', 'assumed_source_timezone']);
const SOURCE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/;
const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL = /^\d{1,200}(?:\.\d{1,200})?$/;
const cell = (value: string | null, pattern: RegExp): string => value !== null && pattern.test(value) ? value : 'unknown';
// The same fields history() compares when it decides that two snapshots of one instant conflict.
const fields = (s: StoredSnapshot) => JSON.stringify([s.usage, s.limit, s.resetAt, s.overages, s.overageCap, s.flags.filter(f => f !== 'assumed_source_timezone').sort()]);

function row(s: StoredSnapshot, conflict: boolean): string {
 const flags = [...new Set(s.flags.filter(f => FLAGS.has(f)))].sort().join(';') || 'none';
 return [cell(s.observedText, SOURCE_TIME), cell(s.observedAt, UTC_TIME), cell(s.usage, DECIMAL), cell(s.limit, DECIMAL), cell(s.resetAt, UTC_TIME), flags, conflict ? 'yes' : 'no'].join(',');
}

/**
 * One row per distinct observation, in time order. Snapshots of the same instant that disagree are all exported with `conflict` = yes, never
 * dropped or picked. Only offered when history() accepts the data: one associated account, with usable timestamps.
 */
export function buildCsv(snapshots: readonly StoredSnapshot[]): CsvResult {
 const status = history([...snapshots]).status;
 if (status === 'unavailable') return { ok: false, code: 'no_history' };
 if (status === 'multiple_accounts' || status === 'unknown_account') return { ok: false, code: 'multiple_accounts' };
 if (status === 'invalid_timestamp' || status === 'history_range_exceeded') return { ok: false, code: 'unavailable' };
 const groups = new Map<number, StoredSnapshot[]>();
 for (const s of snapshots) { const t = Date.parse(s.observedAt); groups.set(t, [...(groups.get(t) ?? []), s]); }
 const rows: string[] = [];
 for (const [, group] of [...groups].sort(([a], [b]) => a - b)) {
  const conflict = new Set(group.map(fields)).size !== 1;
  const texts = [...new Set(group.map(s => row(s, conflict)))].sort();
  rows.push(...(conflict ? texts : texts.slice(0, 1)));
  if (rows.length > MAX_CSV_ROWS) return { ok: false, code: 'unavailable' };
 }
 return { ok: true, csv: [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n', rows: rows.length };
}
