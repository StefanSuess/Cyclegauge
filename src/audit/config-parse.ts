// Configuration text is hostile input. Only the projections below may leave these parsers.
export type SteeringMode = 'always' | 'fileMatch' | 'manual' | 'auto' | 'unrecognised';
export interface SteeringConfig { mode: SteeringMode; matchAll: boolean | 'unknown'; patternCount: number; size: number }
export type HookTrigger = 'PostFileSave' | 'PostFileCreate' | 'PostFileDelete' | 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop' | 'SessionStart' | 'SessionEnd' | 'PreTaskExec' | 'PostTaskExec' | 'Manual';
export interface HookConfig {
 index: number; name: string; trigger: HookTrigger | 'unrecognised'; action: 'agent' | 'command' | 'unrecognised';
 matcher: 'none' | 'broad' | 'specific' | 'not_analysed'; matcherKey?: number;
 enabled: boolean | 'unrecognised'; promptBytes: number; commandBytes: number;
}
export type HookParseResult = { hooks: HookConfig[]; omitted: number } | { code: 'json_invalid' | 'schema_unknown' };
const TRIGGERS: readonly string[] = ['PostFileSave', 'PostFileCreate', 'PostFileDelete', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SessionStart', 'SessionEnd', 'PreTaskExec', 'PostTaskExec', 'Manual'];
const BROAD = new Set(['*', '**', '**/*', '.*', '.+', '^.*$']);
const ALL = new Set(['**', '**/*', '**/**']);
export const hasFrontMatter = (b: Uint8Array) => b[0] === 45 && b[1] === 45 && b[2] === 45 && (b[3] === 10 || (b[3] === 13 && b[4] === 10));
// Byte scanning precedes decoding: no Steering body byte, including invalid UTF-8, is decoded.
function frontMatterEnd(b: Uint8Array, complete: boolean): number | undefined {
 let start = b[3] === 13 ? 5 : 4;
 while (start < b.length) {
  let end = b.indexOf(10, start); const eof = end < 0;
  if (eof) end = b.length;
  const contentEnd = !eof && b[end - 1] === 13 ? end - 1 : end;
  if (contentEnd - start === 3 && b[start] === 45 && b[start + 1] === 45 && b[start + 2] === 45 && (!eof || complete)) return eof ? end : end + 1;
  if (eof) break;
  start = end + 1;
 }
 return undefined;
}
function scalar(raw: string): string | undefined {
 const s = raw.trim();
 if (!s || /[\t\r\n]/.test(s)) return undefined;
 if (s.startsWith('"')) { try { const v: unknown = JSON.parse(s); return typeof v === 'string' ? v : undefined; } catch { return undefined; } }
 if (s.startsWith("'")) {
  if (!s.endsWith("'")) return undefined;
  const value = s.slice(1, -1); if (value.replaceAll("''", '').includes("'")) return undefined;
  return value.replaceAll("''", "'");
 }
 if (/^[&!>|{\[]/.test(s) || /^\*[A-Za-z_]/.test(s) || /[:#'"\[\]{}]/.test(s)) return undefined;
 return s;
}
function patterns(raw: string): string[] | undefined {
 if (!raw.startsWith('[')) { const value = scalar(raw); return value === undefined ? undefined : [value]; }
 if (!raw.endsWith(']')) return undefined;
 const inside = raw.slice(1, -1).trim(); if (!inside) return [];
 const out: string[] = []; let start = 0, quote = '', escaped = false;
 for (let i = 0; i <= inside.length; i++) {
  const c = inside[i];
  if (quote) {
   if (escaped) escaped = false;
   else if (c === '\\' && quote === '"') escaped = true;
   else if (c === quote) { if (quote === "'" && inside[i + 1] === "'") i++; else quote = ''; }
  } else if (c === '"' || c === "'") quote = c;
  else if (c === ',' || i === inside.length) {
   const part = inside.slice(start, i).trim(); if (!part.startsWith('"') && !part.startsWith("'")) return undefined;
   const value = scalar(part); if (value === undefined) return undefined; out.push(value); start = i + 1;
  }
 }
 return quote ? undefined : out;
}
export function parseSteering(input: Uint8Array, size: number): SteeringConfig {
 const unknown = (): SteeringConfig => ({ mode: 'unrecognised', matchAll: 'unknown', patternCount: 0, size });
 const b = input.subarray(0, 2048);
 if (!hasFrontMatter(b)) {
  let offset = 0; while (offset < 5 && (b[offset] === 10 || b[offset] === 13 || b[offset] === 9)) offset++;
  if ((b[0] === 239 && b[1] === 187 && b[2] === 191) || (b[offset] === 45 && b[offset + 1] === 45 && b[offset + 2] === 45)) return unknown();
  return { mode: 'always', matchAll: false, patternCount: 0, size };
 }
 const end = frontMatterEnd(b, size <= b.length); if (end === undefined) return unknown();
 let text: string;
 try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b.subarray(0, end)); } catch { return unknown(); }
 const fields = new Map<string, string>();
 for (const line of text.split('\n').slice(1, -1)) {
  const s = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (s === '---') break;
  if (!s.trim() || s.startsWith('#')) continue;
  if (/\t|\r/.test(s) || s.startsWith(' ')) return unknown();
  const colon = s.indexOf(':'); if (colon < 0) return unknown();
  const key = s.slice(0, colon), value = s.slice(colon + 1).trim();
  if (!['inclusion', 'fileMatchPattern', 'name', 'description'].includes(key) || fields.has(key)) return unknown();
  fields.set(key, value);
 }
 const inclusion = fields.has('inclusion') ? scalar(fields.get('inclusion')!) : 'always';
 if (!['always', 'manual', 'auto', 'fileMatch'].includes(inclusion ?? '')) return unknown();
 for (const key of ['name', 'description']) if (fields.has(key) && scalar(fields.get(key)!) === undefined) return unknown();
 if (inclusion === 'auto' && (!fields.has('name') || !fields.has('description'))) return unknown();
 const list = fields.has('fileMatchPattern') ? patterns(fields.get('fileMatchPattern')!) : [];
 if (!list) return unknown();
 const limited = list.length > 20 || list.some(p => p.length > 256);
 const matchAll = limited ? 'unknown' : list.length > 0 && list.every(p => ALL.has(p.trim().replace(/^\.\//, '')));
 return { mode: inclusion as SteeringMode, matchAll, patternCount: Math.min(list.length, 20), size };
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (v: Record<string, unknown>, k: string): unknown => Object.hasOwn(v, k) ? v[k] : undefined;
export function parseHooks(input: Uint8Array, matcherKey?: (value: string) => number): HookParseResult {
 if (input.length > 65536) return { code: 'json_invalid' };
 try {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  if (text.startsWith('\ufeff')) return { code: 'json_invalid' };
  const parsed: unknown = JSON.parse(text);
  if (!object(parsed) || own(parsed, 'version') !== 'v1') return { code: 'schema_unknown' };
  const entries = own(parsed, 'hooks'); if (!Array.isArray(entries)) return { code: 'schema_unknown' };
  const hooks: HookConfig[] = [];
  for (let index = 0; index < Math.min(entries.length, 200); index++) {
   const entry: unknown = entries[index];
   const h: HookConfig = Object.assign(Object.create(null), { index, name: '', trigger: 'unrecognised', action: 'unrecognised', matcher: 'not_analysed', enabled: 'unrecognised', promptBytes: 0, commandBytes: 0 });
   hooks.push(h); if (!object(entry)) continue;
   const name = own(entry, 'name'); if (typeof name === 'string' && name.length <= 200) h.name = name;
   const enabled = own(entry, 'enabled'); h.enabled = enabled === undefined ? true : typeof enabled === 'boolean' ? enabled : 'unrecognised';
   const trigger = own(entry, 'trigger');
   if (typeof trigger === 'string' && trigger.length <= 64) h.trigger = trigger === 'AgentSpawn' || trigger === 'agentSpawn' ? 'SessionStart' : TRIGGERS.includes(trigger) ? trigger as HookTrigger : 'unrecognised';
   const action = own(entry, 'action');
   if (object(action)) {
    const type = own(action, 'type'); if (type === 'agent' || type === 'command') h.action = type;
    const prompt = own(action, 'prompt'), command = own(action, 'command');
    if (typeof prompt === 'string') h.promptBytes = Buffer.byteLength(prompt, 'utf8');
    if (typeof command === 'string') h.commandBytes = Buffer.byteLength(command, 'utf8');
   }
   const matcher = own(entry, 'matcher');
   if (h.trigger === 'Stop' || h.trigger === 'UserPromptSubmit' || matcher === undefined) h.matcher = 'none';
   else if (typeof matcher === 'string' && matcher.length <= 512) {
    const value = matcher.trim(); h.matcher = !value ? 'none' : BROAD.has(value) ? 'broad' : 'specific';
    // Equality keys are opaque ordinals; raw matcher strings are dropped before return.
    if (h.matcher === 'specific' && matcherKey) h.matcherKey = matcherKey(matcher);
   }
  }
  return { hooks, omitted: Math.max(0, entries.length - 200) };
 } catch { return { code: 'json_invalid' }; }
}
