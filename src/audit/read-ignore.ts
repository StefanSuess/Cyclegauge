import { readLegacyBounded as readBounded, type ReadFs } from './read-bounded.ts';
export { nodeFs, readLegacyBounded as readBounded } from './read-bounded.ts';
export type { ReadFs, ReadHandle, BoundedMode, BoundedCode, BoundedOptions, BoundedResult } from './read-bounded.ts';
export const READ_LIMITS = { maxBytes: 65_536, maxFiles: 200 }; // maxFiles is enforced by the caller
export type ReadIgnoreResult = { text: string } | { code: 'not_allowed' | 'unsafe' | 'oversized' | 'unreadable' };
export function validIgnoreNames(names: unknown): string[] | undefined {
 if (!Array.isArray(names)) return undefined;
 const out: string[] = [];
 for (const n of names as unknown[]) {
  if (typeof n !== 'string' || n === '' || n === '.' || n === '..' || n.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(n)) continue;
  if (!out.includes(n)) out.push(n);
 }
 return out;
}
export async function readIgnoreFile(root: string, rel: string, names: string[], options: { fs?: ReadFs } = {}): Promise<ReadIgnoreResult> {
 const r = await readBounded(root, rel, { kind: 'whole', maxBytes: READ_LIMITS.maxBytes }, { fs: options.fs, names });
 if ('code' in r) return { code: r.code as 'not_allowed' | 'unsafe' | 'oversized' | 'unreadable' };
 try {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(r.bytes);
  return { text: text.startsWith('﻿') ? text.slice(1) : text };
 } catch { return { code: 'unreadable' }; }
}
