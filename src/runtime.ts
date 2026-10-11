// Capability probes: feature detection, never version sniffing. A missing capability becomes a
// fixed unavailable code (RUNTIME_UNSUPPORTED) instead of a failed activation.
export type BuiltinLoader = (id: string) => unknown;
export interface RuntimeProbes { sqlite: boolean; reviverSource: boolean; ok: boolean }
export interface ProbeDeps { builtin?: BuiltinLoader; parse?: typeof JSON.parse }
const defaultBuiltin: BuiltinLoader = id => (process as { getBuiltinModule?: BuiltinLoader }).getBuiltinModule?.(id);
/** `node:sqlite` is loaded lazily and only through the builtin loader, so older runtimes can still activate. */
export function loadSqlite(builtin: BuiltinLoader = defaultBuiltin): typeof import('node:sqlite') | undefined {
 try {
  const module = builtin('node:sqlite') as { DatabaseSync?: unknown } | undefined;
  return typeof module?.DatabaseSync === 'function' ? (module as typeof import('node:sqlite')) : undefined;
 } catch { return undefined; }
}
/** projection.ts needs the reviver `context.source` text to keep exact decimal precision. */
export function probeReviverSource(parse: typeof JSON.parse = JSON.parse): boolean {
 try {
  let seen: string | undefined;
  parse('[1.50]', (_key: string, value: unknown, context?: { source?: string }) => { if (typeof value === 'number') seen = context?.source; return value; });
  return seen === '1.50';
 } catch { return false; }
}
export function probeRuntime(deps: ProbeDeps = {}): RuntimeProbes {
 const sqlite = loadSqlite(deps.builtin) !== undefined;
 const reviverSource = probeReviverSource(deps.parse);
 return { sqlite, reviverSource, ok: sqlite && reviverSource };
}
