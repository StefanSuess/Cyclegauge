import { parseArgs } from 'node:util';
import { Store } from './store.ts';
import { collect } from './collector.ts';
import { view } from './view.ts';
import { defaultSource, defaultStorage } from './paths.ts';
import { probeRuntime } from './runtime.ts';
import { diagnostics } from './diagnostics.ts';
const help = `Cyclegauge for Kiro IDE — local observed CREDIT usage (Node.js 24.13+)
Usage: node --disable-warning=ExperimentalWarning src/cli.ts [options]
  --source-root <directory>     Kiro IDE data root; reads allowlisted logs only
  --source-timezone <IANA>      Required for offset-free log timestamps
  --store-dir <directory>       App-owned private directory outside source/repository
  --max-age-hours <hours>       Freshness threshold (default 24)
  --json                       Billing fields and quality; no identity/source keys
  --diagnostics                Fixed-code platform, runtime and source report; creates nothing
  --help
No Kiro commands, authenticated requests, session aggregation or cache reads.
Reported remaining credits are the reported credit limit minus observed usage, clamped at zero. The limit may include purchased add-on credits; this is not verified.
Per-day allocation uses UTC 24-hour days until reset; it is not a forecast.
Windows storage permissions are unsupported; Windows/Ubuntu/RHEL are unverified.`;
let store: Store | undefined;
let stage = 'CONFIGURATION_INVALID';
try {
 const { values } = parseArgs({ options: {
  'source-root': { type: 'string' }, 'store-dir': { type: 'string' }, 'source-timezone': { type: 'string' },
  'max-age-hours': { type: 'string' }, json: { type: 'boolean' }, diagnostics: { type: 'boolean' }, help: { type: 'boolean' }
 }, strict: true, allowPositionals: false });
 if (values.help) console.log(help);
 else {
  const hours = Number(values['max-age-hours'] ?? '24');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 8760 || values['source-root'] === '' || values['store-dir'] === '') throw new Error();
  if (values['source-timezone'] !== undefined) new Intl.DateTimeFormat('en', { timeZone: values['source-timezone'] }).format();
  stage = 'STORAGE_UNAVAILABLE';
  const source = values['source-root'] ?? defaultSource();
  if (values.diagnostics) {
   console.log(JSON.stringify(await diagnostics({ root: source, method: values['source-root'] === undefined ? 'platform_default' : 'configured' }), null, 2));
  } else {
  stage = 'RUNTIME_UNSUPPORTED';
  if (!probeRuntime().ok) throw new Error();
  stage = 'STORAGE_UNAVAILABLE';
  store = new Store(values['store-dir'] ?? defaultStorage(), source);
  const now = new Date().toISOString();
  stage = 'COLLECTION_UNAVAILABLE';
  const imported = await collect(source, store, values['source-timezone'], now);
  stage = 'STORAGE_UNAVAILABLE';
  const observation = view(store.snapshots(), now, hours);
  const output = { observation, import: imported, cache: 'unavailable_live_read_safety_unproven', platform: process.platform,
   platformVerification: process.platform === 'darwin' ? 'synthetic_tests_only_no_live_validation' : 'unverified' };
  if (values.json) console.log(JSON.stringify(output, null, 2));
  else {
   const value = (v: string | null) => v ?? 'unknown/unavailable';
   console.log(`Status: ${observation.status}\nObserved at: ${value(observation.observedAt)}\nSource: GetUsageLimitsCommand\nObserved usage: ${value(observation.usage)} CREDIT\nReported credit limit: ${value(observation.baseLimit)} CREDIT\nReported remaining credits (as observed): ${value(observation.remainingBaseCredits)}\nReset (UTC): ${value(observation.resetAt)}\nReported remaining credits per remaining UTC 24-hour day: ${value(observation.availablePerDay)}\nAllocation only; truncated to six decimals. Total including extra credits: unknown.\nInterval: ${observation.interval.status}\nQuality: ${observation.flags.join(', ') || 'none'}\nImport: ${imported.imported} accepted, ${imported.duplicates} duplicates\nDiagnostics: ${Object.entries(imported.codes).map(([code, count]) => `${code}=${count}`).join(', ') || 'none'}\nCache: ${output.cache}\nPlatform verification: ${output.platformVerification}`);
  }
  }
 }
} catch (e) { console.log((e as Error)?.message === 'STORAGE_PERMISSIONS_UNSUPPORTED' ? 'STORAGE_PERMISSIONS_UNSUPPORTED' : stage); process.exitCode = 1; }
finally { try { store?.close(); } catch { process.exitCode = 1; } }
