import { frontMatterEnd, hasFrontMatter, parseSteering, scalar } from './config-parse.ts';
// Pure edit computation for the Steering and Hook apply actions (approved 2026-10-18). It works only on bytes the review is already allowed to read:
// the Steering prefix (5 bytes, or up to 2 KiB behind a front-matter opener) and Hook JSON (up to 64 KiB). It never writes: it returns where one
// small edit goes. Offsets are UTF-16 offsets into the file, which is what the editor uses. `verify` is the text the editor must show at that place
// before the edit is applied; it is compared in memory and dropped. Anything unusual yields `unsupported`, never a guess and never a rewrite.
export interface Verify { start: number; end: number; text: string }
export type ConfigEditPlan = { kind: 'replace'; start: number; end: number; text: string; verify: Verify } | { kind: 'select'; start: number; end: number; verify: Verify };
export type ConfigEditResult = { plan: ConfigEditPlan } | { code: 'unsupported' };
const none: ConfigEditResult = { code: 'unsupported' };
const decode = (b: Uint8Array): string | undefined => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b); } catch { return undefined; } };

/**
 * `manual`: front matter with `inclusion: manual` for an always-included file (a new block at the start, a new line after the opener, or the existing
 * `inclusion` value replaced). `select_pattern`: the `fileMatchPattern` value of a match-all file, to be selected for the user to type over (no edit).
 * `eol` is used only for a file without front matter, where the prefix does not reveal the file's line ending.
 */
export function planSteeringEdit(input: Uint8Array, size: number, action: 'manual' | 'select_pattern', eol: '\n' | '\r\n' = '\n'): ConfigEditResult {
 const b = input.subarray(0, 2048), config = parseSteering(b, size);
 if (action === 'select_pattern' ? config.mode !== 'fileMatch' || config.matchAll !== true : config.mode !== 'always') return none;
 if (!hasFrontMatter(b)) return action === 'manual' ? { plan: { kind: 'replace', start: 0, end: 0, text: `---${eol}inclusion: manual${eol}---${eol}`, verify: { start: 0, end: 0, text: '' } } } : none;
 const end = frontMatterEnd(b, size <= b.length), text = end === undefined ? undefined : decode(b.subarray(0, end));
 if (text === undefined) return none;
 const open = b[3] === 13 ? 5 : 4, line = b[3] === 13 ? '\r\n' : '\n';
 const fields = new Map<string, Verify>();
 for (let pos = open; pos < text.length;) {
  let stop = text.indexOf('\n', pos); if (stop < 0) stop = text.length;
  let content = text.slice(pos, stop); if (content.endsWith('\r')) content = content.slice(0, -1);
  if (content === '---') break;
  const colon = content.indexOf(':');
  if (colon > 0 && !content.startsWith('#') && !content.startsWith(' ')) {
   const raw = content.slice(colon + 1), value = raw.trim(), start = pos + colon + 1 + (raw.length - raw.trimStart().length);
   fields.set(content.slice(0, colon), { start, end: start + value.length, text: value });
  }
  pos = stop + 1;
 }
 if (action === 'select_pattern') { const v = fields.get('fileMatchPattern'); return v && v.end > v.start ? { plan: { kind: 'select', start: v.start, end: v.end, verify: v } } : none; }
 const inclusion = fields.get('inclusion');
 if (!inclusion) return { plan: { kind: 'replace', start: open, end: open, text: `inclusion: manual${line}`, verify: { start: 0, end: open, text: text.slice(0, open) } } };
 return scalar(inclusion.text) === 'always' ? { plan: { kind: 'replace', start: inclusion.start, end: inclusion.end, text: 'manual', verify: inclusion } } : none;
}

const WS = ' \t\n\r';
const skip = (t: string, i: number): number => { while (i < t.length && WS.includes(t[i]!)) i++; return i; };
function stringEnd(t: string, i: number): number | undefined {
 for (let j = i + 1; j < t.length; j++) { const c = t[j]; if (c === '\\') j++; else if (c === '"') return j + 1; }
 return undefined;
}
// Iterative on purpose: Hook JSON may nest deeply, and no recursion may depend on it.
function valueEnd(t: string, i: number): number | undefined {
 const c = t[i];
 if (c === '"') return stringEnd(t, i);
 if (c === '{' || c === '[') {
  let depth = 0;
  for (let j = i; j < t.length; j++) {
   const d = t[j];
   if (d === '"') { const e = stringEnd(t, j); if (e === undefined) return undefined; j = e - 1; }
   else if (d === '{' || d === '[') depth++;
   else if ((d === '}' || d === ']') && --depth === 0) return j + 1;
  }
  return undefined;
 }
 let j = i; while (j < t.length && !',}] \t\n\r'.includes(t[j]!)) j++;
 return j > i ? j : undefined;
}
interface Member { key: string; keyStart: number; keyEnd: number; valueStart: number; valueEnd: number }
// Members of the object opening at `open`. Escaped or duplicated keys make the object ambiguous for a text edit, so they are refused here.
function members(t: string, open: number): Member[] | undefined {
 if (t[open] !== '{') return undefined;
 const list: Member[] = []; let i = skip(t, open + 1);
 if (t[i] === '}') return list;
 for (;;) {
  if (t[i] !== '"') return undefined;
  const keyEnd = stringEnd(t, i); if (keyEnd === undefined) return undefined;
  const key = t.slice(i + 1, keyEnd - 1); if (key.includes('\\') || list.some(m => m.key === key)) return undefined;
  let j = skip(t, keyEnd); if (t[j] !== ':') return undefined;
  j = skip(t, j + 1); const end = valueEnd(t, j); if (end === undefined) return undefined;
  list.push({ key, keyStart: i, keyEnd, valueStart: j, valueEnd: end });
  i = skip(t, end);
  if (t[i] === '}') return list;
  if (t[i] !== ',') return undefined;
  i = skip(t, i + 1);
 }
}
/** `run_manually`: the entry's `trigger` value becomes "Manual". `disable`: its `enabled` value becomes false, or `"enabled": false,` is added before its first member. */
export function planHookEdit(input: Uint8Array, index: number, action: 'run_manually' | 'disable'): ConfigEditResult {
 const text = decode(input);
 if (text === undefined || text.startsWith('﻿') || !Number.isSafeInteger(index) || index < 0 || index >= 200) return none;
 const top = members(text, skip(text, 0)), hooks = top?.find(m => m.key === 'hooks');
 if (!hooks || text[hooks.valueStart] !== '[') return none;
 let at = skip(text, hooks.valueStart + 1), start = -1, end = -1;
 for (let n = 0; ; n++) {
  const e = valueEnd(text, at); if (e === undefined) return none;
  if (n === index) { start = at; end = e; break; }
  at = skip(text, e); if (text[at] !== ',') return none;
  at = skip(text, at + 1);
 }
 const entry = members(text, start);
 if (!entry || end <= start) return none;
 const member = (key: string) => entry.find(m => m.key === key), span = (m: Member): Verify => ({ start: m.keyStart, end: m.valueEnd, text: text.slice(m.keyStart, m.valueEnd) });
 if (action === 'run_manually') {
  const m = member('trigger');
  if (!m || text[m.valueStart] !== '"' || text.slice(m.valueStart, m.valueEnd).includes('\\') || text.slice(m.valueStart, m.valueEnd) === '"Manual"') return none;
  return { plan: { kind: 'replace', start: m.valueStart, end: m.valueEnd, text: '"Manual"', verify: span(m) } };
 }
 const enabled = member('enabled');
 if (enabled) return text.slice(enabled.valueStart, enabled.valueEnd) === 'true' ? { plan: { kind: 'replace', start: enabled.valueStart, end: enabled.valueEnd, text: 'false', verify: span(enabled) } } : none;
 const first = entry[0]; if (!first) return none;
 const gap = text.slice(start + 1, first.keyStart);
 return { plan: { kind: 'replace', start: first.keyStart, end: first.keyStart, text: `"enabled": false,${gap === '' ? ' ' : gap}`, verify: { start, end: first.keyEnd, text: text.slice(start, first.keyEnd) } } };
}
