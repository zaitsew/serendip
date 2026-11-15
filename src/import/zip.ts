import { inflateRawSync } from "node:zlib";

/**
 * A minimal ZIP reader for the Letterboxd export: the central directory, stored and deflated entries.
 * No zip64, no encryption. Entries are read by name; sizes are capped so a bomb cannot fill memory.
 */

const MAX_ENTRY = 50 * 1024 * 1024;

export function readZip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file.");
  const count = buf.readUInt16LE(eocd + 10);
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
    if (name.endsWith("/")) continue;
    if (usize > MAX_ENTRY) throw new Error(`ZIP entry too large: ${name}`);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Broken ZIP entry.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }));
    else throw new Error(`Unsupported ZIP method ${method} for ${name}.`);
  }
  return out;
}
