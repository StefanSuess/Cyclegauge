import { discover, readLog } from './source.ts';
import type { Store } from './store.ts';
export async function collect(root: string, store: Store, zone?: string, ingestedAt = new Date().toISOString()) {
 const found = await discover(root); const codes = found.codes; let imported = 0, duplicates = 0;
 for (const file of found.files) {
  const read = await readLog(file, zone);
  for (const [code, count] of Object.entries(read.codes)) codes[code] = (codes[code] ?? 0) + count;
  if (read.fingerprint === undefined) continue;
  const token = store.token('source', file);
  store.transaction(() => {
   if (store.checkpoint(token, store.token('file', read.fingerprint!), read.bytes!)) codes.source_changed = (codes.source_changed ?? 0) + 1;
   for (const r of read.records) {
    if (store.insert(r.snapshot!, r.identity, token, ingestedAt)) imported++; else duplicates++;
    r.identity = undefined;
   }
  });
 }
 store.transaction(() => store.evidence(ingestedAt, codes));
 return { imported, duplicates, codes };
}
