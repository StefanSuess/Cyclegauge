import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHmac } from 'node:crypto';
import { writeFileSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { prepareStorage, noSymlinks } from './paths.ts';
import { persistedSnapshot, type Snapshot } from './projection.ts';
import { windowsStorageAccess } from './windows-storage.ts';
export interface StoredSnapshot extends Snapshot { partition: string; associated: boolean; ingestedAt: string }
/** MIGRATIONS[i] upgrades storage version i + 1 to i + 2. Append only; STORE_VERSION follows the list length.
 * Migrations run inside the open BEGIN IMMEDIATE transaction and must not BEGIN, COMMIT, VACUUM or change PRAGMAs. */
export type Migration = (db: DatabaseSync) => void;
export const MIGRATIONS: readonly Migration[] = Object.freeze([]);
export const STORE_VERSION = 1 + MIGRATIONS.length;
export const MAX_IMPORT_ROWS = 10_000;
/** Test-only overrides; production callers use the defaults. */
export interface StoreOptions { migrations?: readonly Migration[]; maxImportRows?: number }
export class Store {
 private db: DatabaseSync; private secret: Buffer; private maxImports: number;
 constructor(directory: string, source: string, profile = false, options: StoreOptions = {}) {
  const root = prepareStorage(directory, source, profile);
  const verifyAcl = !profile;
  const secureFile = (name: string, initial: Buffer) => {
   const path = join(root, name);
   try { writeFileSync(path, initial, { flag: 'wx', mode: 0o600 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('STORAGE_UNAVAILABLE'); }
   noSymlinks(path); const s = lstatSync(path);
   if (!s.isFile() || s.nlink !== 1) throw new Error('UNSAFE_STORAGE');
   if (process.platform === 'win32') { if (verifyAcl) windowsStorageAccess(path); }
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
    if (process.platform === 'win32') { if (verifyAcl) windowsStorageAccess(path); }
    else if (s.uid !== process.getuid!() || (s.mode & 0o077)) throw new Error('UNSAFE_STORAGE');
   }
   catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('UNSAFE_STORAGE'); }
  }
  this.maxImports = options.maxImportRows ?? MAX_IMPORT_ROWS;
  this.db = new DatabaseSync(dbPath);
  let open = false;
  try {
   this.db.exec('PRAGMA busy_timeout=3000');
   this.db.exec('BEGIN IMMEDIATE'); open = true;
   this.prepareSchema(options.migrations ?? MIGRATIONS);
   this.db.exec('COMMIT'); open = false;
  } catch (e) {
   if (open) { try { this.db.exec('ROLLBACK'); } catch { /* the connection is closed next */ } }
   try { this.db.close(); } catch { /* fixed code below */ }
   throw new Error((e as Error)?.message === 'STORAGE_NEWER' ? 'STORAGE_NEWER' : 'STORAGE_UNAVAILABLE');
  }
 }
 /** Runs inside BEGIN IMMEDIATE. A file written by a newer version or without a valid meta row is never written to or repaired. */
 private prepareSchema(migrations: readonly Migration[]): void {
  const target = 1 + migrations.length;
  const tables = new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name as string));
  // Fresh only when the file has no schema objects at all (an empty file); anything else must be a valid Cyclegauge store.
  if ((this.db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number }).n === 0) {
   this.db.exec(`CREATE TABLE meta(version INTEGER NOT NULL);
    CREATE TABLE snapshots(key TEXT PRIMARY KEY, partition TEXT NOT NULL, associated INTEGER NOT NULL, observed TEXT NOT NULL, body TEXT NOT NULL, ingested TEXT NOT NULL);
    CREATE TABLE sources(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE imports(id INTEGER PRIMARY KEY, ingested TEXT NOT NULL, body TEXT NOT NULL);`);
   this.db.prepare('INSERT INTO meta(version) VALUES (?)').run(target);
   return;
  }
  if (!tables.has('meta')) throw new Error('STORAGE_UNAVAILABLE');
  const rows = this.db.prepare('SELECT version FROM meta').all();
  const version = rows[0]?.version;
  if (rows.length !== 1 || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('STORAGE_UNAVAILABLE');
  if (version > target) throw new Error('STORAGE_NEWER');
  if (!['snapshots', 'sources', 'imports'].every(name => tables.has(name))) throw new Error('STORAGE_UNAVAILABLE');
  if (version === target) return;
  for (let v = version; v < target; v++) migrations[v - 1](this.db);
  if (this.db.prepare('UPDATE meta SET version=?').run(target).changes !== 1) throw new Error('STORAGE_UNAVAILABLE');
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
  const body = JSON.stringify(codes);
  const last = this.db.prepare('SELECT id, body FROM imports ORDER BY id DESC LIMIT 1').get() as { id: number; body: string } | undefined;
  // Unchanged codes refresh the latest row's time instead of adding a row: bounded, and the last import stays visible.
  if (last?.body === body) { this.db.prepare('UPDATE imports SET ingested=? WHERE id=?').run(ingestedAt, last.id); return; }
  this.db.prepare('INSERT INTO imports(ingested, body) VALUES (?, ?)').run(ingestedAt, body);
  // Keep only the newest rows; snapshots and sources are never touched.
  this.db.prepare('DELETE FROM imports WHERE id <= (SELECT id FROM imports ORDER BY id DESC LIMIT 1 OFFSET ?)').run(this.maxImports);
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
