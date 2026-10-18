// Bounded reader for the newest IDE session of the open workspace: read-only, metadata only, silent when uncertain. No editor API, no Store or
// history import, nothing is written. Kiro-owned files are only listed, lstat-ed and read through the shared bounded reader (src/audit/read-ignore.ts).
// Every failure is mapped to a code of the closed list in codes.ts; the text of an error is never inspected or reported.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeFs, readBounded, type ReadFs } from '../audit/read-ignore.ts';
import type { HintCode } from './codes.ts';
import { LIMITS, contextPercent, notFuture, projectSession, scanContext, workspaceMatches } from './parse.ts';
import type { Observation } from './notices.ts';
// readdir reports entry types without following links: a symlink is not a directory here.
export interface DirEntry { name: string; isDirectory(): boolean }
export interface SessionFs extends ReadFs { readdir(path: string): Promise<DirEntry[]> }
export const defaultFs: SessionFs = { ...nodeFs, readdir: path => readdir(path, { withFileTypes: true }) };
export const READER_LIMITS = { entriesPerLevel: 200, openPerTick: 20, inactiveMs: 12 * 3_600_000 } as const;
export interface ReadRequest { home: string; folders: readonly string[]; platform?: string; now: number; signal?: AbortSignal; fs?: SessionFs; decode?: (b: Uint8Array) => string }
// capped: workspace folders skipped because they hold more than 200 session folders
export type ReadOutcome = { code: 'ok'; observation: Observation; contextCode?: HintCode; opened: number; capped: number } | { code: Exclude<HintCode, 'ok'>; opened: number; capped: number };
const segmentOk = (n: string) => n !== '' && n !== '.' && n !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(n);
const bytes = (s: string) => Buffer.from(s, 'utf8');
const enoent = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';
const ABORTED = Symbol('aborted');
const wsEntryIsDir = (e: DirEntry) => e.isDirectory();
const NAMES = ['session.json', 'messages.jsonl'] as const;
interface Entry { ws: string; sess: string; mtimeMs: number }
interface Listing { entries: Entry[]; capped: number }
async function listSessions(fs: SessionFs, home: string, signal: AbortSignal | undefined): Promise<Listing | 'no_root' | 'listing_capped' | 'unsafe' | 'aborted'> {
 const live = () => signal?.aborted !== true;
 // Every filesystem step waits at most until the abort; a hanging call is abandoned (the tick ends with the fixed code `aborted`).
 let abort: (() => void) | undefined;
 const aborted = new Promise<never>((_, reject) => { abort = () => reject(ABORTED); });
 aborted.catch(() => undefined);
 if (signal) { if (signal.aborted) return 'aborted'; signal.addEventListener('abort', abort!, { once: true }); }
 const go = <T>(p: Promise<T>): Promise<T> => signal ? Promise.race([p, aborted]) : p;
 try {
  for (const dir of [home, join(home, '.kiro'), join(home, '.kiro', 'sessions')]) { // a symlink anywhere on the way fails closed
   let s;
   try { s = await go(fs.lstat(dir)); } catch (e) { if (enoent(e)) return 'no_root'; throw e; }
   if (s.isSymbolicLink() || !s.isDirectory()) return s.isSymbolicLink() ? 'unsafe' : 'no_root';
  }
  const root = join(home, '.kiro', 'sessions'), entries: Entry[] = [];
  let capped = 0;
  const top = await go(fs.readdir(root));
  if (top.length > READER_LIMITS.entriesPerLevel) return 'listing_capped';
  for (const wsEntry of top) {
   const ws = wsEntry.name;
   if (!live()) return 'aborted';
   if (ws === 'cli' || !segmentOk(ws) || !wsEntryIsDir(wsEntry)) continue;
   let inner: DirEntry[];
   try { inner = await go(fs.readdir(join(root, ws))); } catch (e) { if (enoent(e) || (e as { code?: unknown })?.code === 'ENOTDIR') continue; throw e; }
   if (inner.length > READER_LIMITS.entriesPerLevel) { capped++; continue; } // one over-full workspace folder is skipped and counted, the others are still checked
   for (const entry of inner) {
    const sess = entry.name;
    if (!live()) return 'aborted';
    if (!segmentOk(sess) || !entry.isDirectory()) continue; // the session folder itself must be a real directory (a symlink is not)
    try {
     const f = await go(fs.lstat(join(root, ws, sess, 'session.json'))); // only this file's modification time is looked at
     if (f.isFile() && !f.isSymbolicLink() && typeof f.mtimeMs === 'number' && Number.isFinite(f.mtimeMs)) entries.push({ ws, sess, mtimeMs: f.mtimeMs });
    } catch (e) { if (e === ABORTED) throw e; if (!enoent(e) && (e as { code?: unknown })?.code !== 'ENOTDIR') throw e; }
   }
  }
  return { entries, capped };
 } catch (e) { if (e === ABORTED) return 'aborted'; throw e; } finally { signal?.removeEventListener('abort', abort!); }
}
const byNewest = (a: Entry, b: Entry) => b.mtimeMs - a.mtimeMs || Buffer.compare(bytes(`${b.ws}/${b.sess}`), bytes(`${a.ws}/${a.sess}`));
/** Finds the newest session of an open folder and returns its model identifier and latest context percentage; otherwise a code. */
export async function readSession(req: ReadRequest): Promise<ReadOutcome> {
 const fs = req.fs ?? defaultFs, { home, now, signal } = req;
 let opened = 0, capped = 0;
 try {
  const listing = await listSessions(fs, home, signal);
  if (typeof listing === 'string') return { code: listing, opened, capped };
  capped = listing.capped;
  const listed = listing.entries;
  const rel = (e: Entry, file: (typeof NAMES)[number]) => `.kiro/sessions/${e.ws}/${e.sess}/${file}`;
  const best: { e: Entry; last: number; modelId: string | null }[] = [];
  let aborted = false;
  for (const e of listed.sort(byNewest).slice(0, READER_LIMITS.openPerTick)) {
   const r = await readBounded(home, rel(e, 'session.json'), { kind: 'whole', maxBytes: LIMITS.sessionJsonBytes }, { fs, names: NAMES, strict: true, signal });
   opened++;
   if ('code' in r) { if (r.code === 'aborted') { aborted = true; break; } continue; }
   let json: unknown;
   try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(r.bytes)); } catch { json = undefined; } finally { r.wipe(); }
   const p = projectSession(json);
   if (typeof p === 'string') continue;
   // Strict agreement: not in the future, and roughly the file's own modification time.
   if (!notFuture(p.lastModifiedAt, now) || Math.abs(p.lastModifiedAt - e.mtimeMs) > LIMITS.mtimeAgreementMs) continue;
   if (workspaceMatches(p.workspacePaths, req.folders, req.platform)) best.push({ e, last: p.lastModifiedAt, modelId: p.modelId });
  }
  if (aborted) return { code: 'aborted', opened, capped };
  if (best.length === 0) return { code: capped > 0 ? 'listing_capped' : 'no_match', opened, capped }; // an over-full folder may have held the session
  best.sort((a, b) => b.last - a.last || byNewest(a.e, b.e));
  const pick = best[0]!;
  if (now - pick.last > READER_LIMITS.inactiveMs) return { code: 'stale', opened, capped };
  const observation: Observation = { key: `${pick.e.ws}/${pick.e.sess}`, modelId: pick.modelId, sessionAsOf: pick.last };
  let contextCode: HintCode | undefined;
  const m = await readBounded(home, rel(pick.e, 'messages.jsonl'), { kind: 'tail', window: LIMITS.tailWindowBytes }, { fs, names: NAMES, strict: true, signal });
  if ('code' in m) {
   if (m.code === 'aborted') return { code: 'aborted', opened, capped };
   contextCode = m.code === 'unsafe' || m.code === 'changed' ? m.code : 'error';
  } else {
   try {
    const scan = scanContext(m.bytes, now, req.decode);
    const shown = scan.event ? contextPercent(scan.event.percent) : undefined;
    if (scan.event && shown !== undefined) observation.context = { percent: shown, asOf: scan.event.at };
    else contextCode = scan.event ? 'out_of_range' : scan.candidates > 0 ? 'invalid_shape' : 'no_candidate';
   } finally { m.wipe(); }
  }
  return { code: 'ok', observation, contextCode, opened, capped };
 } catch { return { code: signal?.aborted ? 'aborted' : 'error', opened, capped }; }
}
