import { decimal } from './decimal.ts';
import { timestamp } from './time.ts';
export interface Snapshot {
 observedAt: string; observedText: string; sourceTimezone: string | null;
 usage: string | null; limit: string | null; resetAt: string | null; resetText: string | null;
 overages: string | null; overageCap: string | null; flags: string[];
}
export interface Projection { status: string; snapshot?: Snapshot; identity?: string }
class Numeric { text: string; constructor(text: string) { this.text = text; } }
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
export function parseLine(line: string, sourceTimezone?: string): Projection {
 if (!line.includes('GetUsageLimitsCommand')) return { status: 'ignored' };
 const start = line.indexOf('{');
 if (start < 0) return { status: 'malformed_record' };
 try {
  // Reviver context.source preserves numeric lexical precision, including exponents.
  const envelope = obj(JSON.parse(line.slice(start), (key: string, value: unknown, context?: { source?: string }) =>
   typeof value === 'number' ? new Numeric(context!.source!) : value));
  if (envelope.commandName !== 'GetUsageLimitsCommand') return { status: 'ignored' };
  const code = obj(envelope.metadata).httpStatusCode;
  if (!(code instanceof Numeric) || code.text !== '200') return { status: 'failed_response' };
  const prefix = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)\s+\[info\]/.exec(line);
  const time = timestamp(prefix?.[1], sourceTimezone);
  if (!time.instant) return { status: time.status };
  const output = obj(envelope.output);
  if (!Array.isArray(output.usageBreakdownList)) return { status: 'unsupported_format' };
  const credits = output.usageBreakdownList.map(obj).filter(b => b.resourceType === 'CREDIT');
  if (credits.length !== 1) return { status: credits.length ? 'conflicting_resources' : 'unsupported_resource' };
  const b = credits[0]; const flags: string[] = [];
  const amount = (precise: string, fallback: string): string | null => {
   let value = b[precise];
   if (value === undefined) { value = b[fallback]; if (value !== undefined) flags.push('reduced_precision'); }
   if (value === undefined) return null;
   if (!(value instanceof Numeric)) throw new Error('INVALID_BILLING');
   if (b[precise] === undefined && !/^\d+$/.test(value.text)) throw new Error('INVALID_BILLING');
   return decimal(value.text);
  };
  const usage = amount('currentUsageWithPrecision', 'currentUsage');
  const limit = amount('usageLimitWithPrecision', 'usageLimit');
  const overages = amount('currentOveragesWithPrecision', 'currentOverages');
  const overageCap = amount('overageCapWithPrecision', 'overageCap');
  if (usage === null) flags.push('missing_usage'); if (limit === null) flags.push('missing_limit');
  for (const key of ['bonuses', 'overageCredits']) {
   if (b[key] !== undefined && (!Array.isArray(b[key]) || (b[key] as unknown[]).length)) flags.push('unsupported_extra_credits');
  }
  const outer = timestamp(output.nextDateReset), inner = timestamp(b.nextDateReset);
  let reset = b.nextDateReset === undefined ? outer : inner;
  if (output.nextDateReset !== undefined && b.nextDateReset !== undefined && (!outer.instant || !inner.instant || outer.instant !== inner.instant)) {
   flags.push('conflicting_reset_metadata'); reset = { status: 'invalid' };
  }
  if (!reset.instant) flags.push('missing_reset');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(time.text!)) flags.push('assumed_source_timezone');
  const userId = obj(output.userInfo).userId;
  return { status: 'accepted', snapshot: { observedAt: time.instant, observedText: time.text!, sourceTimezone: flags.includes('assumed_source_timezone') ? sourceTimezone! : null,
   usage, limit, overages, overageCap, resetAt: reset.instant ?? null, resetText: reset.text ?? null, flags: [...new Set(flags)].sort() },
   identity: typeof userId === 'string' && userId.length > 0 && userId.length <= 1024 ? userId : undefined };
 } catch (error) {
  return { status: error instanceof SyntaxError ? 'malformed_record' : 'invalid_billing' };
 }
}

const qualityFlags = new Set(['reduced_precision', 'missing_usage', 'missing_limit', 'unsupported_extra_credits', 'conflicting_reset_metadata', 'missing_reset', 'assumed_source_timezone']);
// Re-project persisted data before any public query; corruption cannot inject diagnostics.
export function persistedSnapshot(value: unknown): Snapshot {
 const b = obj(value);
 const keys = ['observedAt','observedText','sourceTimezone','usage','limit','resetAt','resetText','overages','overageCap','flags'];
 if (Object.keys(b).length !== keys.length || keys.some(k => !(k in b))) throw new Error('STORAGE_UNAVAILABLE');
 if (typeof b.sourceTimezone !== 'string' && b.sourceTimezone !== null) throw new Error('STORAGE_UNAVAILABLE');
 const explicitOffset = typeof b.observedText === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(b.observedText);
 if (explicitOffset && b.sourceTimezone !== null) throw new Error('STORAGE_UNAVAILABLE');
 if (!explicitOffset && typeof b.sourceTimezone !== 'string') throw new Error('STORAGE_UNAVAILABLE');
 const time = timestamp(b.observedText, b.sourceTimezone as string | undefined);
 if (!time.instant || time.instant !== b.observedAt) throw new Error('STORAGE_UNAVAILABLE');
 if (b.resetAt !== null && (!timestamp(b.resetText).instant || timestamp(b.resetText).instant !== b.resetAt)) throw new Error('STORAGE_UNAVAILABLE');
 if (b.resetAt === null && b.resetText !== null) throw new Error('STORAGE_UNAVAILABLE');
 for (const key of ['usage','limit','overages','overageCap']) {
  if (b[key] !== null && (typeof b[key] !== 'string' || decimal(b[key]) !== b[key])) throw new Error('STORAGE_UNAVAILABLE');
 }
 if (!Array.isArray(b.flags) || b.flags.some(f => typeof f !== 'string' || !qualityFlags.has(f))) throw new Error('STORAGE_UNAVAILABLE');
 return { observedAt: time.instant, observedText: time.text!, sourceTimezone: b.sourceTimezone as string | null,
  usage: b.usage as string | null, limit: b.limit as string | null, resetAt: b.resetAt as string | null, resetText: b.resetText as string | null,
  overages: b.overages as string | null, overageCap: b.overageCap as string | null, flags: [...b.flags] };
}
