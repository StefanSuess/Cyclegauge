import type { StoredSnapshot } from '../../src/store.ts';
export const syntheticSnapshot = (observedAt: string, usage: string, changes: Partial<StoredSnapshot> = {}): StoredSnapshot => ({
 partition: 'synthetic-private-account', associated: true, observedAt, observedText: observedAt, sourceTimezone: null,
 usage, limit: '1000', resetAt: '2030-07-01T00:00:00.000Z', resetText: '2030-07-01T00:00:00Z', flags: [], overages: null, overageCap: null, ingestedAt: observedAt, ...changes });
