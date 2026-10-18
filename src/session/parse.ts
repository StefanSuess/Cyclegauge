// Pure parsers for the session hints: no IO, no editor API. Every function returns a small projection or undefined; nothing here keeps or reports
// any other field of the Kiro-owned data it is given. See docs/wp11-13-data-proof.md (combined implementation design).
export const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/;
export const LIMITS = { sessionJsonBytes: 65_536, tailWindowBytes: 262_144, maxLineBytes: 4_096, maxWorkspacePaths: 8, maxPathChars: 4_096, futureMs: 300_000, mtimeAgreementMs: 600_000 } as const;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/;
/** Strict ISO 8601 with a numeric offset or Z, as epoch milliseconds; anything else (free-form dates, offset-less times, impossible dates) is undefined. */
export function strictIso(value: unknown): number | undefined {
 if (typeof value !== 'string' || value.length > 40) return undefined;
 const m = ISO.exec(value);
 if (!m) return undefined;
 const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
 if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return undefined;
 const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, '0')) : 0;
 const utc = Date.UTC(y, mo - 1, d, h, mi, s, ms);
 const check = new Date(utc);
 if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return undefined;
 let offset = 0;
 if (m[8] !== 'Z') {
  const digits = m[8]!.replace(':', ''), oh = Number(digits.slice(1, 3)), om = Number(digits.slice(3, 5));
  if (oh > 23 || om > 59) return undefined;
  offset = (digits[0] === '-' ? -1 : 1) * (oh * 60 + om) * 60_000;
 }
 return utc - offset;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface SessionProjection { modelId: string | null; lastModifiedAt: number; workspacePaths: string[] }
/** The allowlisted fields of an IDE session.json; everything else (title, root paths, display text, ...) is discarded here. */
export function projectSession(json: unknown): SessionProjection | 'unsupported_schema' | 'invalid_shape' {
 if (!record(json)) return 'invalid_shape';
 if (json.schemaVersion !== '1.0.0' || json.dataModelVersion !== 1) return 'unsupported_schema';
 const last = strictIso(json.lastModifiedAt), paths = json.workspacePaths;
 if (last === undefined || !Array.isArray(paths) || paths.length > LIMITS.maxWorkspacePaths) return 'invalid_shape';
 if (!paths.every(p => typeof p === 'string' && p.length <= LIMITS.maxPathChars)) return 'invalid_shape';
 const id = json.modelId;
 return { modelId: typeof id === 'string' && MODEL_ID.test(id) ? id : null, lastModifiedAt: last, workspacePaths: paths as string[] };
}

/**
 * Pure string normalisation for the workspace comparison, by platform rule (no filesystem call). darwin: NFC and case-insensitive. win32: NFC,
 * case-insensitive, backslashes as `/`, a leading `/` before a drive letter removed (`/c:/x` is `c:/x`) and trailing separators trimmed. linux: NFC,
 * case-sensitive, trailing `/` trimmed. The Windows and Linux forms are assumptions: only macOS paths were observed (docs/wp11-13-data-proof.md).
 * Any other platform behaves like linux (the gate never lets it reach the comparison). The platform is a required parameter: no result depends on the host running this code.
 */
export function normalizePath(p: string, platform: string): string {
 let s = p.normalize('NFC');
 if (platform === 'darwin') s = s.toLowerCase();
 else if (platform === 'win32') s = s.toLowerCase().replace(/\\/g, '/').replace(/^\/([a-z]:)/, '$1');
 while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
 return s;
}
export function workspaceMatches(workspacePaths: readonly string[], folders: readonly string[], platform: string): boolean {
 const open = new Set(folders.filter(f => f !== '').map(f => normalizePath(f, platform)));
 return workspacePaths.some(p => p !== '' && open.has(normalizePath(p, platform)));
}

/** True when the timestamp is neither missing nor more than five minutes in the future. */
export const notFuture = (ms: number, now: number): boolean => ms <= now + LIMITS.futureMs;

const enc = new TextEncoder();
const LITERALS = [enc.encode('"session_metadata"'), enc.encode('"contextUsage"')];
function has(bytes: Uint8Array, needle: Uint8Array): boolean {
 outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
  for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
  return true;
 }
 return false;
}
export interface ContextEvent { percent: number; at: number }
export interface TailScan { event?: ContextEvent; candidates: number; rejected: number }
/**
 * Scans complete (newline-terminated) lines of a tail window, in bytes. Only lines holding both literals are decoded; they are parsed and must have the
 * exact event shape, otherwise they are dropped. The newest event by timestamp wins (a later line wins a tie). Future timestamps are rejected.
 * `decode` is injectable so that a test can prove that other lines are never decoded.
 */
export function scanContext(bytes: Uint8Array, now: number, decode: (b: Uint8Array) => string = b => new TextDecoder('utf-8', { fatal: true }).decode(b)): TailScan {
 const out: TailScan = { candidates: 0, rejected: 0 };
 let from = 0;
 for (;;) {
  const nl = bytes.indexOf(0x0a, from);
  if (nl < 0) break; // an unterminated last line may be mid-write
  const line = bytes.subarray(from, nl);
  from = nl + 1;
  if (line.length === 0 || line.length > LIMITS.maxLineBytes || !LITERALS.every(l => has(line, l))) continue;
  out.candidates++;
  let event: ContextEvent | undefined;
  try { event = contextEvent(JSON.parse(decode(line)), now); } catch { event = undefined; }
  if (!event) { out.rejected++; continue; }
  if (!out.event || event.at >= out.event.at) out.event = event;
 }
 return out;
}
function contextEvent(json: unknown, now: number): ContextEvent | undefined {
 if (!record(json) || !record(json.payload)) return undefined;
 const at = strictIso(json.timestamp), p = json.payload, v = p.value;
 if (at === undefined || p.type !== 'session_metadata' || p.key !== 'contextUsage' || !record(v) || typeof v.usagePercentage !== 'number' || !notFuture(at, now)) return undefined;
 return { percent: v.usagePercentage, at };
}
/** 0..100 as is, above 100 up to 105 as 100 ("about 100 %"), anything else (negative, above 105, not finite) undefined. */
export function contextPercent(value: number): number | undefined {
 if (!Number.isFinite(value) || value < 0 || value > 105) return undefined;
 return value > 100 ? 100 : value;
}
