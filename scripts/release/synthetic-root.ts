// Generates an invented Kiro-style log root for acceptance runs (plan R4 phase A) and smoke tests.
// Nothing is derived from real data: fixed account label, fixed dates, fixed numbers.
//
//   node scripts/release/synthetic-root.ts <new-or-empty-directory> [observations]
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMain } from '../is-main.ts';

export interface SyntheticOptions { observations?: number; windows?: number; startUsage?: number; limit?: number; startAt?: number }
export const SYNTHETIC_ACCOUNT = 'synthetic-account-private-marker';

/** `startAt` is the first observation time (ms since epoch); the billing reset is 20 days after it. */
export function syntheticLine(index: number, usage: number, limit: number, startAt = Date.UTC(2030, 5, 1, 8, 0, 0)): string {
 const base = startAt + index * 30 * 60_000;
 const stamp = new Date(base).toISOString().replace('T', ' ').replace('Z', '');
 const reset = new Date(startAt + 20 * 86_400_000).toISOString();
 return `${stamp} [info] synthetic-envelope ${JSON.stringify({
  commandName: 'GetUsageLimitsCommand',
  output: { userInfo: { userId: SYNTHETIC_ACCOUNT }, nextDateReset: reset,
   usageBreakdownList: [{ resourceType: 'CREDIT', unit: 'INVOCATIONS', currentUsageWithPrecision: usage, usageLimitWithPrecision: limit,
    nextDateReset: reset, bonuses: [], overageCredits: [] }] },
  metadata: { httpStatusCode: 200 } })}\n`;
}

/** Creates `<root>/logs/synthetic-run/synthetic-window-N/exthost/kiro.kiroAgent/q-client.log`. Returns the log directories. */
export function createSyntheticRoot(root: string, options: SyntheticOptions = {}): string[] {
 const target = resolve(root);
 try { if (readdirSync(target).length) throw new Error('SYNTHETIC_ROOT_NOT_EMPTY'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
 const count = options.observations ?? 6, windows = options.windows ?? 1, limit = options.limit ?? 50;
 const startAt = options.startAt ?? Date.now() - count * 30 * 60_000;
 const dirs: string[] = [];
 for (let w = 1; w <= windows; w++) {
  const dir = join(target, 'logs', 'synthetic-run', `synthetic-window-${w}`, 'exthost', 'kiro.kiroAgent');
  mkdirSync(dir, { recursive: true });
  let text = '';
  for (let i = 0; i < count; i++) text += syntheticLine(i, (options.startUsage ?? 4) + i * 0.25, limit, startAt);
  writeFileSync(join(dir, 'q-client.log'), text);
  dirs.push(dir);
 }
 return dirs;
}

function main(): number {
 const [dir, count] = process.argv.slice(2);
 if (!dir) { console.log('USAGE'); return 2; }
 try {
  const dirs = createSyntheticRoot(dir, { observations: count ? Number(count) : undefined });
  console.log(`SYNTHETIC_ROOT_CREATED windows=${dirs.length}`);
  return 0;
 } catch (e) { console.log((e as Error).message === 'SYNTHETIC_ROOT_NOT_EMPTY' ? 'SYNTHETIC_ROOT_NOT_EMPTY' : 'SYNTHETIC_ROOT_FAILED'); return 1; }
}
if (isMain(import.meta.url)) process.exitCode = main();
