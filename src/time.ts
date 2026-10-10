export type TimeResult = { status: string; instant?: string; text?: string };
function wallParts(text: string): string | null {
 const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(text);
 if (!m) return null;
 const wall = `${m[1]}T${m[2]}.${(m[3] ?? '').padEnd(3, '0')}`;
 const ms = Date.parse(wall + 'Z');
 return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, -1) === wall ? wall : null;
}
export function timestamp(text: unknown, zone?: string): TimeResult {
 if (typeof text !== 'string') return { status: 'invalid_timestamp' };
 const offset = /(Z|[+-]\d{2}:\d{2})$/.exec(text);
 if (offset) {
  const wall = wallParts(text.slice(0, -offset[0].length));
  if (!wall || (offset[0] !== 'Z' && (Number(offset[0].slice(1, 3)) > 23 || Number(offset[0].slice(4)) > 59))) return { status: 'invalid_timestamp' };
  const ms = Date.parse(wall + offset[0]);
  return Number.isFinite(ms) ? { status: 'valid', instant: new Date(ms).toISOString(), text } : { status: 'invalid_timestamp' };
 }
 const wall = wallParts(text);
 if (!wall) return { status: 'invalid_timestamp' };
 if (!zone) return { status: 'source_timezone_required' };
 try {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const local = (ms: number) => {
   const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
   return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  const nominal = Date.parse(wall + 'Z'); const offsets = new Set<number>();
  for (let h = -48; h <= 48; h += 6) {
   const probe = nominal + h * 3600000;
   offsets.add(Date.parse(local(probe) + 'Z') - Math.floor(probe / 1000) * 1000);
  }
  const matches = [...offsets].map(o => nominal - o).filter(ms => local(ms) === wall.slice(0, 19));
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous_timezone' : 'invalid_timestamp' };
  return { status: 'valid', instant: new Date(matches[0]).toISOString(), text };
 } catch { return { status: 'unsupported_timezone' }; }
}
