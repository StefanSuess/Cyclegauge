// Pure and browser-safe (no Node or editor API): the fixed recap-card format shared by the dashboard script that draws and encodes the card
// and by the extension's strict PNG validator. The card has one fixed size and one fixed PNG shape, so anything else is refused.
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const PNG_BIT_DEPTH = 8;
export const PNG_COLOR_TYPE = 6; // RGBA, 8 bits per channel
/** Decompressed size of the card: one filter byte plus four bytes per pixel, for every row. */
export const CARD_RAW_SIZE = CARD_HEIGHT * (1 + CARD_WIDTH * 4);
/** The only message allowed to exceed the usual 4 KB string cap: 2 MB of base64 text. */
export const MAX_PNG_BASE64 = 2 * 1024 * 1024;

// Brand colours (navy tile of the icon, light text). Every text colour keeps at least 4.5:1 against the background (checked in tests).
export const BRAND = { background: '#0b2545', title: '#ffffff', text: '#e6edf7', muted: '#b8c7de', accent: '#7fd1ff' } as const;
export const MIN_CONTRAST = 4.5;
function luminance(hex: string): number {
 const channel = (i: number) => { const v = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
 return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
 const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
 return (hi + 0.05) / (lo + 0.05);
}

/** Greedy word wrap; a word wider than the line is split by characters. `measure` returns the drawn width of a string. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
 const lines: string[] = [];
 let line = '';
 for (const word of text.split(/\s+/).filter(Boolean)) {
  const attempt = line ? `${line} ${word}` : word;
  if (measure(attempt) <= maxWidth) { line = attempt; continue; }
  if (line) { lines.push(line); line = ''; }
  let rest = word;
  while (measure(rest) > maxWidth && rest.length > 1) {
   let cut = rest.length - 1;
   while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
   lines.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  line = rest;
 }
 if (line) lines.push(line);
 return lines;
}

const CRC_TABLE = (() => {
 const table = new Uint32Array(256);
 for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
 return table;
})();
export function crc32(...parts: Uint8Array[]): number {
 let c = 0xffffffff;
 for (const bytes of parts) for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
 return (c ^ 0xffffffff) >>> 0;
}
export const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const ascii = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
function chunk(type: string, data: Uint8Array): Uint8Array {
 const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
 const name = ascii(type);
 view.setUint32(0, data.length);
 out.set(name, 4); out.set(data, 8);
 view.setUint32(8 + data.length, crc32(name, data));
 return out;
}
/**
 * Encodes the card's RGBA pixels as the one PNG shape the extension accepts: IHDR, a single IDAT, IEND; no filtering, no ancillary chunks.
 * `deflate` must return a zlib stream (RFC 1950), for example from CompressionStream('deflate').
 */
export async function encodePng(rgba: Uint8Array | Uint8ClampedArray, deflate: (raw: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
 if (rgba.length !== CARD_WIDTH * CARD_HEIGHT * 4) throw new Error('PNG_SIZE');
 const stride = CARD_WIDTH * 4, raw = new Uint8Array(CARD_RAW_SIZE);
 for (let y = 0; y < CARD_HEIGHT; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); // filter byte 0 is already in place
 const header = new Uint8Array(13), hv = new DataView(header.buffer);
 hv.setUint32(0, CARD_WIDTH); hv.setUint32(4, CARD_HEIGHT);
 header[8] = PNG_BIT_DEPTH; header[9] = PNG_COLOR_TYPE; // compression, filter and interlace stay 0
 const parts = [PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
 const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
 let at = 0;
 for (const p of parts) { out.set(p, at); at += p.length; }
 return out;
}
export function toBase64(bytes: Uint8Array): string {
 let binary = '';
 for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
 return btoa(binary);
}
