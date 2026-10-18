import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { BRAND, CARD_HEIGHT, CARD_RAW_SIZE, CARD_WIDTH, MAX_PNG_BASE64, MIN_CONTRAST, PNG_SIGNATURE, contrastRatio, crc32, encodePng, toBase64, wrapText } from '../../src/extension/recap-card.ts';
import { decodeCardPng, validatePng } from '../../src/extension/recap-png.ts';

const deflate = async (raw: Uint8Array) => new Uint8Array(deflateSync(raw));
const pixels = () => { const p = new Uint8Array(CARD_WIDTH * CARD_HEIGHT * 4); for (let i = 0; i < p.length; i += 4) { p[i] = 11; p[i + 1] = 37; p[i + 2] = 69; p[i + 3] = 255; } return p; };
const valid = () => encodePng(pixels(), deflate);

interface Chunk { type: string; data: Buffer }
const parse = (png: Uint8Array): Chunk[] => {
 const b = Buffer.from(png), out: Chunk[] = [];
 for (let at = 8; at < b.length;) { const n = b.readUInt32BE(at); out.push({ type: b.toString('latin1', at + 4, at + 8), data: b.subarray(at + 8, at + 8 + n) }); at += 12 + n; }
 return out;
};
const crc = (type: string, data: Buffer) => { const out = Buffer.alloc(4); out.writeUInt32BE(crc32(Buffer.from(type, 'latin1'), data)); return out; };
const chunk = (type: string, data: Buffer, goodCrc = true) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); return Buffer.concat([head, Buffer.from(type, 'latin1'), data, goodCrc ? crc(type, data) : Buffer.alloc(4)]); };
const build = (chunks: Chunk[], tail: Buffer = Buffer.alloc(0)) => Buffer.concat([Buffer.from(PNG_SIGNATURE), ...chunks.map(c => chunk(c.type, c.data)), tail]);

test('the encoder writes exactly IHDR, one IDAT and IEND, and the strict validator accepts it', async () => {
 const png = await valid();
 assert.deepEqual(parse(png).map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
 assert.equal(validatePng(png), true);
 const text = Buffer.from(png).toString('base64');
 assert.ok(text.length < MAX_PNG_BASE64);
 assert.deepEqual(decodeCardPng(text), Buffer.from(png));
 assert.equal(toBase64(png), text);
 assert.equal(crc32(Buffer.from('IEND')), 0xae426082);
});

test('every structural corruption is refused', async () => {
 const png = await valid(), chunks = parse(png), ihdr = chunks[0]!, idat = chunks[1]!, iend = chunks[2]!;
 const withHeader = (patch: (b: Buffer) => void) => { const b = Buffer.from(ihdr.data); patch(b); return [{ type: 'IHDR', data: b }, idat, iend]; };
 const cases: Record<string, Buffer | Uint8Array> = {
  empty: new Uint8Array(), signature: Buffer.concat([Buffer.from([0]), Buffer.from(png).subarray(1)]), truncated: Buffer.from(png).subarray(0, png.length - 5),
  'wrong width': build(withHeader(b => b.writeUInt32BE(CARD_WIDTH + 1, 0))), 'wrong height': build(withHeader(b => b.writeUInt32BE(CARD_HEIGHT - 1, 4))),
  'bit depth': build(withHeader(b => { b[8] = 16; })), 'colour type RGB': build(withHeader(b => { b[9] = 2; })), 'palette type': build(withHeader(b => { b[9] = 3; })),
  compression: build(withHeader(b => { b[10] = 1; })), filter: build(withHeader(b => { b[11] = 1; })), interlace: build(withHeader(b => { b[12] = 1; })),
  'short IHDR': build([{ type: 'IHDR', data: ihdr.data.subarray(0, 12) }, idat, iend]),
  'IHDR not first': build([idat, ihdr, iend]), 'no IDAT': build([ihdr, iend]), 'no IEND': build([ihdr, idat]), 'two IEND': build([ihdr, idat, iend, iend]),
  'IEND with data': build([ihdr, idat, { type: 'IEND', data: Buffer.from([0]) }]), 'IEND before IDAT': build([ihdr, iend, idat]),
  'trailing byte': build([ihdr, idat, iend], Buffer.from([0])), 'trailing polyglot payload': build([ihdr, idat, iend], Buffer.from('<script>')),
  'second IHDR': build([ihdr, ihdr, idat, iend]),
 };
 for (const [name, bytes] of Object.entries(cases)) assert.equal(validatePng(bytes), false, name);
});

test('ancillary, text, colour-profile and unknown chunks are refused, with or without a good CRC', async () => {
 const [ihdr, idat, iend] = parse(await valid()) as [Chunk, Chunk, Chunk];
 for (const type of ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'iCCP', 'sRGB', 'gAMA', 'pHYs', 'tIME', 'PLTE', 'bKGD', 'IDAx', 'abCD'])
  for (const position of [1, 2, 3]) {
   const chunks = [ihdr, idat, iend]; chunks.splice(position, 0, { type, data: Buffer.from('synthetic-metadata') });
   assert.equal(validatePng(build(chunks)), false, `${type}@${position}`);
  }
});

test('every CRC is verified', async () => {
 const png = Buffer.from(await valid());
 for (const offset of [29 /* IHDR crc */, png.length - 1 /* IEND crc */, 8 + 25 + 12 /* IDAT data */]) {
  const bad = Buffer.from(png); bad[offset] = bad[offset]! ^ 1; assert.equal(validatePng(bad), false, String(offset));
 }
 const [ihdr, idat, iend] = parse(png) as [Chunk, Chunk, Chunk];
 const badIdat = Buffer.concat([Buffer.from(PNG_SIGNATURE), chunk('IHDR', ihdr.data), chunk('IDAT', idat.data, false), chunk('IEND', iend.data)]);
 assert.equal(validatePng(badIdat), false);
});

test('inflation is bounded by the exact raw size: a bomb, a short image and trailing zlib data are refused', async () => {
 const [ihdr, , iend] = parse(await valid()) as [Chunk, Chunk, Chunk];
 const wrap = (zlib: Buffer) => build([ihdr, { type: 'IDAT', data: zlib }, iend]);
 const exact = Buffer.alloc(CARD_RAW_SIZE);
 assert.equal(validatePng(wrap(deflateSync(exact))), true);
 assert.equal(validatePng(wrap(deflateSync(Buffer.alloc(CARD_RAW_SIZE + 1)))), false, 'one byte too many');
 assert.equal(validatePng(wrap(deflateSync(Buffer.alloc(CARD_RAW_SIZE - 1)))), false, 'one byte too few');
 const bomb = deflateSync(Buffer.alloc(64 * 1024 * 1024));
 assert.ok(bomb.length < 200_000, 'a small input that expands far beyond the card');
 assert.equal(validatePng(wrap(bomb)), false);
 assert.equal(validatePng(wrap(Buffer.concat([deflateSync(exact), Buffer.from([1, 2, 3])]))), false, 'bytes after the zlib stream');
 assert.equal(validatePng(wrap(Buffer.from('not zlib data'))), false);
 const badFilter = Buffer.alloc(CARD_RAW_SIZE); badFilter[0] = 5;
 assert.equal(validatePng(wrap(deflateSync(badFilter))), false, 'undefined row filter');
 const split = deflateSync(exact), half = split.length >> 1;
 assert.equal(validatePng(build([ihdr, { type: 'IDAT', data: split.subarray(0, half) }, { type: 'IDAT', data: split.subarray(half) }, iend])), true, 'the same stream in two IDAT chunks');
});

test('base64 transport is canonical, bounded and hostile-safe', async () => {
 const text = Buffer.from(await valid()).toString('base64');
 for (const bad of [undefined, null, 5, {}, [], '', ' ' + text, text + '\n', text.slice(0, -1), text.replace(/.$/, '!'), text.slice(0, 4) + '-' + text.slice(5), 'A'.repeat(MAX_PNG_BASE64 + 4), text + '====', 'data:image/png;base64,' + text])
  assert.equal(decodeCardPng(bad), null);
 assert.ok(decodeCardPng(text));
});

test('brand colours keep text contrast of at least 4.5:1 and the contrast function is correct', () => {
 assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
 assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
 for (const colour of [BRAND.title, BRAND.text, BRAND.muted, BRAND.accent]) assert.ok(contrastRatio(colour, BRAND.background) >= MIN_CONTRAST, colour);
});

test('text wrapping fits the width and splits very long words', () => {
 const measure = (s: string) => s.length * 10;
 assert.deepEqual(wrapText('aa bb cc dd', 50, measure), ['aa bb', 'cc dd']);
 assert.deepEqual(wrapText('', 50, measure), []);
 const long = wrapText('x'.repeat(23), 50, measure);
 assert.ok(long.every(l => measure(l) <= 50) && long.join('') === 'x'.repeat(23));
});
test('the encoder refuses pixels of another size', async () => {
 await assert.rejects(encodePng(new Uint8Array(4), deflate));
});
