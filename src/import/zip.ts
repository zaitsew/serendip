import { inflateRawSync } from "node:zlib";

/**
 * A minimal ZIP reader for the Letterboxd export: the central directory, stored and deflated entries.
 * No zip64, no encryption. Entries are read by name; sizes are capped so a bomb cannot fill memory.
 */

export interface ZipLimits {
  /** Only entries this returns true for are read; the rest are skipped without being inflated. */
  want?: (name: string) => boolean;
  /** Entries in the central directory. More than this and the file is refused. */
  maxEntries?: number;
  /** One decompressed entry. */
  maxEntry?: number;
  /** All decompressed entries together. */
  maxTotal?: number;
}

const MAX_ENTRIES = 1000;
const MAX_ENTRY = 25 * 1024 * 1024;
const MAX_TOTAL = 60 * 1024 * 1024;

export function readZip(buf: Buffer, limits: ZipLimits = {}): Map<string, Buffer> {
  const { want, maxEntries = MAX_ENTRIES, maxEntry = MAX_ENTRY, maxTotal = MAX_TOTAL } = limits;
  const out = new Map<string, Buffer>();
  let total = 0;
  // End of central directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file.");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > maxEntries) throw new Error(`ZIP has too many entries (${count}, limit ${maxEntries}).`);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Broken ZIP directory.");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || (want && !want(name))) continue;
    if (usize > maxEntry) throw new Error(`ZIP entry too large: ${name}`);
    if (total + usize > maxTotal) throw new Error("ZIP expands to too much data.");
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Broken ZIP entry.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      // The declared size can lie, so the inflater itself stops at what is left of the budget.
      try { data = inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(maxEntry, maxTotal - total)) }); }
      catch { throw new Error(`ZIP entry is corrupt or expands to too much data: ${name}`); }
    } else throw new Error(`Unsupported ZIP method ${method} for ${name}.`);
    total += data.length;
    if (total > maxTotal) throw new Error("ZIP expands to too much data.");
    out.set(name, data);
  }
  return out;
}
