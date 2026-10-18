import { inflateSync } from 'node:zlib';
import { CARD_HEIGHT, CARD_RAW_SIZE, CARD_WIDTH, MAX_PNG_BASE64, PNG_BIT_DEPTH, PNG_COLOR_TYPE, PNG_SIGNATURE, crc32 } from './recap-card.ts';

// Strict check of the recap image before anything is written. It guarantees only that the bytes are a plain image of the fixed card
// size with no metadata, no extra chunk and no trailing payload; a compromised script could still send a different image of that size.
const MAX_IDAT_CHUNKS = 4096;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** True only for exactly: signature, IHDR (fixed size and shape), one or more IDAT, one IEND, every CRC valid, nothing after IEND. */
export function validatePng(bytes: Uint8Array): boolean {
 try {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  if (buffer.length < PNG_SIGNATURE.length + 25 + 12 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  let at = 8, first = true, ended = false;
  const idat: Buffer[] = [];
  while (at < buffer.length) {
   if (ended || at + 12 > buffer.length) return false; // trailing bytes after IEND, or a cut-off chunk
   const length = buffer.readUInt32BE(at);
   if (length > 0x7fffffff || at + 12 + length > buffer.length) return false;
   const type = buffer.toString('latin1', at + 4, at + 8), body = buffer.subarray(at + 8, at + 8 + length);
   if (crc32(buffer.subarray(at + 4, at + 8), body) !== buffer.readUInt32BE(at + 8 + length)) return false;
   if (first) {
    if (type !== 'IHDR' || length !== 13 || body.readUInt32BE(0) !== CARD_WIDTH || body.readUInt32BE(4) !== CARD_HEIGHT) return false;
    // bit depth, colour type, then compression, filter and interlace methods, which must all be 0
    if (body[8] !== PNG_BIT_DEPTH || body[9] !== PNG_COLOR_TYPE || body[10] !== 0 || body[11] !== 0 || body[12] !== 0) return false;
    first = false;
   } else if (type === 'IDAT') {
    if (idat.length >= MAX_IDAT_CHUNKS) return false;
    idat.push(body);
   } else if (type === 'IEND') {
    if (length !== 0 || !idat.length) return false;
    ended = true;
   } else return false; // ancillary, text, palette and every other chunk are refused
   at += 12 + length;
  }
  if (!ended) return false;
  const compressed = Buffer.concat(idat);
  // maxOutputLength is the exact raw size, so a small file can never expand into a decompression bomb; `info` reports the bytes consumed.
  const result = inflateSync(compressed, { maxOutputLength: CARD_RAW_SIZE, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  if (result.buffer.length !== CARD_RAW_SIZE || result.engine.bytesWritten !== compressed.length) return false;
  const stride = 1 + CARD_WIDTH * 4;
  for (let y = 0; y < CARD_HEIGHT; y++) if (result.buffer[y * stride]! > 4) return false; // only the five defined row filters
  return true;
 } catch { return false; }
}

/** Decodes the base64 text of a `saveRecapImage` message; null unless it is canonical base64 within the cap and a valid card PNG. */
export function decodeCardPng(text: unknown): Buffer | null {
 if (typeof text !== 'string' || text.length === 0 || text.length > MAX_PNG_BASE64 || text.length % 4 !== 0 || !BASE64.test(text)) return null;
 const bytes = Buffer.from(text, 'base64');
 return bytes.toString('base64') === text && validatePng(bytes) ? bytes : null;
}
