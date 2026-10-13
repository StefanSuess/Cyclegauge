import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHmac } from 'node:crypto';
import { writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { prepareStorage, noSymlinks } from './paths.ts';
import { persistedSnapshot, type Snapshot } from './projection.ts';
import { windowsStorageAccess } from './windows-storage.ts';
export interface StoredSnapshot extends Snapshot { partition: string; associated: boolean; ingestedAt: string }
export class Store {
 private db: DatabaseSync; private secret: Buffer;
 constructor(directory: string, source: string) {
  const root = prepareStorage(directory, source);
  const secureFile = (name: string, initial: Buffer) => {
   const path = join(root, name);
   try { writeFileSync(path, initial, { flag: 'wx', mode: 0o600 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('STORAGE_UNAVAILABLE'); }
   noSymlinks(path); const s = lstatSync(path);
   if (!s.isFile() || s.nlink !== 1) throw new Error('UNSAFE_STORAGE');
   if (process.platform === 'win32') windowsStorageAccess(path);
   else if ((s.mode & 0o777) !== 0o600 || s.uid !== process.getuid!()) throw new Error('UNSAFE_STORAGE');
   return path;
  };
  const key = secureFile('device.key', randomBytes(32)); this.secret = readFileSync(key);
  if (this.secret.length !== 32) throw new Error('STORAGE_UNAVAILABLE');
  const dbPath = secureFile('usage.sqlite', Buffer.alloc(0));
  for (const suffix of ['-journal', '-wal', '-shm']) {
   try {
    const path = dbPath + suffix; noSymlinks(path); const s = lstatSync(path);
    if (!s.isFile() || s.nlink !== 1) throw new Error('UNSAFE_STORAGE');
    if (process.platform === 'win32') windowsStorageAccess(path);
    else if (s.uid !== process.getuid!() || (s.mode & 0o077)) throw new Error('UNSAFE_STORAGE');
   }
   catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('UNSAFE_STORAGE'); }
  }
  this.db = new DatabaseSync(dbPath);
  try {
   this.db.exec(`PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS meta(version INTEGER NOT NULL);
    INSERT INTO meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM meta);
    CREATE TABLE IF NOT EXISTS snapshots(key TEXT PRIMARY KEY, partition TEXT NOT NULL, associated INTEGER NOT NULL, observed TEXT NOT NULL, body TEXT NOT NULL, ingested TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY, ingested TEXT NOT NULL, body TEXT NOT NULL);`);
   if ((this.db.prepare('SELECT version FROM meta').get() as {version:number})?.version !== 1) throw new Error('UNSUPPORTED_STORAGE');
  } catch { this.db.close(); throw new Error('STORAGE_UNAVAILABLE'); }
 }
 token(kind: string, value: string): string { return createHmac('sha256', this.secret).update(kind + '\0' + value).digest('hex'); }
 transaction<T>(work: () => T): T {
  this.db.exec('BEGIN IMMEDIATE');
  try { const result = work(); this.db.exec('COMMIT'); return result; } catch { this.db.exec('ROLLBACK'); throw new Error('STORAGE_UNAVAILABLE'); }
 }
 insert(snapshot: Snapshot, identity: string | undefined, sourceToken: string, ingestedAt: string): boolean {
  const body = JSON.stringify(snapshot);
  const associated = identity !== undefined;
  // Without identity, isolate each observation; never infer continuity from billing fields.
  const partition = this.token(associated ? 'account' : 'unassociated', identity ?? sourceToken + body);
  const key = this.token('observation', partition + body);
  return this.db.prepare('INSERT OR IGNORE INTO snapshots VALUES (?, ?, ?, ?, ?, ?)').run(key, partition, +associated, snapshot.observedAt, body, ingestedAt).changes > 0;
 }
 checkpoint(key: string, fingerprint: string, bytes: number): boolean {
  const old = this.db.prepare('SELECT fingerprint, bytes FROM sources WHERE key=?').get(key) as {fingerprint:string;bytes:number} | undefined;
  this.db.prepare('INSERT OR REPLACE INTO sources VALUES (?, ?, ?)').run(key, fingerprint, bytes);
  return !!old && (old.fingerprint !== fingerprint || bytes < old.bytes);
 }
 evidence(ingestedAt: string, codes: Record<string, number>): void {
  this.db.prepare('INSERT INTO imports(ingested, body) VALUES (?, ?)').run(ingestedAt, JSON.stringify(codes));
 }
 snapshots(): StoredSnapshot[] {
  try {
   return this.db.prepare('SELECT partition, associated, body, ingested FROM snapshots ORDER BY observed').all().map(row => {
    if (typeof row.partition !== 'string' || !/^[a-f0-9]{64}$/.test(row.partition) || (row.associated !== 0 && row.associated !== 1)) throw new Error();
    const snapshot = persistedSnapshot(JSON.parse(row.body as string));
    return { ...snapshot, partition: row.partition, associated: !!row.associated, ingestedAt: row.ingested as string };
   });
  } catch { throw new Error('STORAGE_UNAVAILABLE'); }
 }
 close(): void { this.db.close(); this.secret.fill(0); }
}
