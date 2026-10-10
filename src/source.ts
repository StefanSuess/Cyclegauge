import { createHash } from 'node:crypto';
import { readdir, lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { noSymlinks } from './paths.ts';
import { parseLine, type Projection } from './projection.ts';
export interface ReadResult { records: Projection[]; codes: Record<string, number>; fingerprint?: string; bytes?: number }
export async function discover(root: string): Promise<{ files: string[]; codes: Record<string, number> }> {
 const files: string[] = [], codes: Record<string, number> = {};
 const dirs = async (path: string) => {
  noSymlinks(path); return (await readdir(path, { withFileTypes: true })).filter(d => d.isDirectory() && !d.isSymbolicLink()).map(d => d.name);
 };
 try {
  noSymlinks(root); const logs = join(resolve(root), 'logs');
  for (const run of (await dirs(logs)).slice(0, 1000)) {
   for (const window of (await dirs(join(logs, run))).slice(0, 1000)) {
    const dir = join(logs, run, window, 'exthost', 'kiro.kiroAgent');
    try {
     noSymlinks(dir);
     for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!/^q-client\.log(?:\.\d+)?$/.test(entry.name)) continue;
      if (entry.isSymbolicLink() || !entry.isFile()) { codes.unsafe_source = (codes.unsafe_source ?? 0) + 1; continue; }
      if (files.length >= 1000) { codes.source_limit = 1; continue; }
      files.push(join(dir, entry.name));
     }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') codes.unsafe_source = (codes.unsafe_source ?? 0) + 1; }
   }
  }
 } catch { codes.source_unavailable = 1; }
 if (!files.length) codes.no_source_logs = 1;
 return { files: files.sort(), codes };
}
export async function readLog(path: string, zone?: string): Promise<ReadResult> {
 const codes: Record<string, number> = {}, records: Projection[] = [];
 const count = (code: string) => { codes[code] = (codes[code] ?? 0) + 1; };
 let handle;
 try {
  noSymlinks(path); const canonical = await realpath(path);
  if (canonical !== resolve(path)) return { records: [], codes: { unsafe_source: 1 } };
  const initial = await lstat(path);
  handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const before = await handle.stat();
  if (!before.isFile() || before.dev !== initial.dev || before.ino !== initial.ino) return { records: [], codes: { unsafe_source: 1 } };
  if (before.size > 64 * 1024 * 1024) return { records: [], codes: { oversized_source: 1 } };
  const hash = createHash('sha256');
  const chunk = Buffer.alloc(65536); let pending = Buffer.alloc(0), oversized = false, position = 0;
  while (position < before.size) {
   const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, before.size - position), position);
   if (!bytesRead) break; position += bytesRead; hash.update(chunk.subarray(0, bytesRead));
   let start = 0;
   for (let i = 0; i < bytesRead; i++) {
    if (chunk[i] !== 10) continue;
    const segment = chunk.subarray(start, i);
    if (!oversized && pending.length + segment.length <= 256 * 1024) {
     try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([pending, segment]));
      const record = parseLine(text.replace(/\r$/, ''), zone);
      if (record.status === 'accepted') records.push(record); else if (record.status !== 'ignored') count(record.status);
     } catch { count('malformed_record'); }
    } else count('oversized_record');
    pending = Buffer.alloc(0); oversized = false; start = i + 1;
   }
   const tail = chunk.subarray(start, bytesRead);
   if (!oversized && pending.length + tail.length <= 256 * 1024) pending = Buffer.concat([pending, tail]); else { pending = Buffer.alloc(0); oversized = true; }
   if (records.length > 10000) return { records: [], codes: { observation_limit: 1 } };
  }
  if (pending.length || oversized) count('partial_record');
  const after = await handle.stat(); const current = await lstat(path); noSymlinks(path);
  if (position !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || await realpath(path) !== canonical) return { records: [], codes: { source_unstable: 1 } };
  return { records, codes, fingerprint: `${before.dev}:${before.ino}:${before.birthtimeMs}:${hash.digest('hex')}`, bytes: before.size };
 } catch { return { records: [], codes: { source_unavailable: 1 } }; }
 finally { await handle?.close(); }
}
