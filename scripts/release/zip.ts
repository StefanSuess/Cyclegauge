// Minimal, defensive ZIP reader for release verification (Node only, no dependencies).
// It reads the central directory and rejects anything a VSIX must not contain; it never extracts to disk.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry { name: string; size: number; method: number; flags: number; externalAttributes: number; data: Buffer }
export class ZipError extends Error {
 readonly code: string;
 constructor(code: string) { super(code); this.code = code; }
}
export interface ZipLimits { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }
export const DEFAULT_LIMITS: ZipLimits = { maxEntries: 64, maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024 };

const CRC_TABLE = (() => {
 const t = new Uint32Array(256);
 for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
 return t;
})();
export function crc32(data: Uint8Array): number {
 let c = 0xffffffff;
 for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
 return (c ^ 0xffffffff) >>> 0;
}

/** Entry names must be plain relative paths with forward slashes only. */
export function safeEntryName(name: string): boolean {
 return name.length > 0 && name.length <= 256 && !/[\\\0-\x1f]/.test(name) && !name.startsWith('/') && !/^[A-Za-z]:/.test(name) &&
  !name.split('/').some(part => part === '..' || part === '.' || part === '');
}

export function readZip(buffer: Buffer, limits: ZipLimits = DEFAULT_LIMITS): ZipEntry[] {
 if (buffer.length < 22 || buffer.length > 64 * 1024 * 1024) throw new ZipError('ZIP_SIZE');
 let eocd = -1;
 for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
  if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
 }
 if (eocd < 0) throw new ZipError('ZIP_NO_DIRECTORY');
 const onDisk = buffer.readUInt16LE(eocd + 8), count = buffer.readUInt16LE(eocd + 10), dirSize = buffer.readUInt32LE(eocd + 12), dirOffset = buffer.readUInt32LE(eocd + 16);
 if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) throw new ZipError('ZIP_MULTIDISK');
 if (count === 0xffff || dirOffset === 0xffffffff || dirSize === 0xffffffff) throw new ZipError('ZIP_ZIP64');
 if (count > limits.maxEntries) throw new ZipError('ZIP_TOO_MANY_ENTRIES');
 if (onDisk !== count) throw new ZipError('ZIP_COUNT_MISMATCH');
 if (buffer.readUInt16LE(eocd + 20) !== 0 || eocd + 22 !== buffer.length) throw new ZipError('ZIP_TRAILING_DATA');
 if (dirOffset + dirSize > eocd) throw new ZipError('ZIP_BAD_DIRECTORY');
 const entries: ZipEntry[] = [];
 const seen = new Set<string>();
 let total = 0, p = dirOffset;
 for (let i = 0; i < count; i++) {
  if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) throw new ZipError('ZIP_BAD_DIRECTORY');
  const flags = buffer.readUInt16LE(p + 8), method = buffer.readUInt16LE(p + 10), crc = buffer.readUInt32LE(p + 16);
  const compressed = buffer.readUInt32LE(p + 20), size = buffer.readUInt32LE(p + 24);
  const nameLength = buffer.readUInt16LE(p + 28), extraLength = buffer.readUInt16LE(p + 30), commentLength = buffer.readUInt16LE(p + 32);
  const externalAttributes = buffer.readUInt32LE(p + 38), localOffset = buffer.readUInt32LE(p + 42);
  const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
  p += 46 + nameLength + extraLength + commentLength;
  if (flags & 1) throw new ZipError('ZIP_ENCRYPTED');
  if (method !== 0 && method !== 8) throw new ZipError('ZIP_METHOD');
  if (!safeEntryName(name.endsWith('/') ? name.slice(0, -1) : name)) throw new ZipError('ZIP_UNSAFE_NAME');
  if (seen.has(name)) throw new ZipError('ZIP_DUPLICATE');
  seen.add(name);
  // Unix mode in the high 16 bits: a symbolic link is S_IFLNK (0o120000).
  if (((externalAttributes >>> 16) & 0o170000) === 0o120000) throw new ZipError('ZIP_SYMLINK');
  if (size > limits.maxEntryBytes) throw new ZipError('ZIP_ENTRY_TOO_LARGE');
  total += size;
  if (total > limits.maxTotalBytes) throw new ZipError('ZIP_TOTAL_TOO_LARGE');
  if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ZipError('ZIP_BAD_LOCAL_HEADER');
  const localName = buffer.toString('utf8', localOffset + 30, localOffset + 30 + buffer.readUInt16LE(localOffset + 26));
  if (localName !== name) throw new ZipError('ZIP_NAME_MISMATCH');
  const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
  if (start + compressed > dirOffset) throw new ZipError('ZIP_BAD_LOCAL_HEADER');
  const raw = buffer.subarray(start, start + compressed);
  let data: Buffer;
  try { data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: limits.maxEntryBytes }); } catch { throw new ZipError('ZIP_INFLATE'); }
  if (data.length !== size) throw new ZipError('ZIP_SIZE_MISMATCH');
  if (crc32(data) !== crc) throw new ZipError('ZIP_CRC');
  entries.push({ name, size, method, flags, externalAttributes, data });
 }
 // The directory must end exactly where the end record starts; otherwise another reader could see more entries.
 if (p !== dirOffset + dirSize || p !== eocd) throw new ZipError('ZIP_DIRECTORY_GAP');
 return entries;
}

/** Writer used by tests to build deliberately malformed archives. */
export function writeZip(files: { name: string; data: Buffer; method?: 0 | 8; attributes?: number; flags?: number }[]): Buffer {
 const locals: Buffer[] = [], central: Buffer[] = [];
 let offset = 0;
 for (const f of files) {
  const name = Buffer.from(f.name), method = f.method ?? 8;
  const body = method === 8 ? deflateRawSync(f.data) : f.data;
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(f.flags ?? 0, 6); header.writeUInt16LE(method, 8);
  header.writeUInt32LE(crc32(f.data), 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(f.data.length, 22); header.writeUInt16LE(name.length, 26);
  locals.push(header, name, body);
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(f.flags ?? 0, 8); dir.writeUInt16LE(method, 10);
  dir.writeUInt32LE(crc32(f.data), 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(f.data.length, 24); dir.writeUInt16LE(name.length, 28);
  dir.writeUInt32LE(f.attributes ?? 0, 38); dir.writeUInt32LE(offset, 42);
  central.push(dir, name);
  offset += 30 + name.length + body.length;
 }
 const directory = Buffer.concat(central);
 const end = Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
 end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
 return Buffer.concat([...locals, directory, end]);
}
