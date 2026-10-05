// Bounded ZIP32 STORE transport: no rewriting or interpretation of enclosed files.
const table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
async function crc32(blob: Blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  try { while (true) { const next = await reader.read(); if (next.done) break; for (const byte of next.value) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); } }
  finally { reader.releaseLock(); }
  return (crc ^ 0xffffffff) >>> 0;
}
export async function evaluationBundle(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  if (!entries.length || entries.length > 16 || entries.reduce((sum, item) => sum + item.blob.size, 0) > 600_000_000 || new Set(entries.map(item => item.name)).size !== entries.length) throw new Error("Evaluation bundle exceeds supported bounds.");
  const parts: BlobPart[] = [], central: BlobPart[] = []; let offset = 0, directorySize = 0;
  for (const { name, blob } of entries) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(name)) throw new Error("Invalid evaluation member name.");
    const filename = new TextEncoder().encode(name), crc = await crc32(blob);
    const header = new Uint8Array(30), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(12, 33, true);
    view.setUint32(14, crc, true); view.setUint32(18, blob.size, true); view.setUint32(22, blob.size, true); view.setUint16(26, filename.length, true);
    const record = new Uint8Array(46), recordView = new DataView(record.buffer);
    recordView.setUint32(0, 0x02014b50, true); recordView.setUint16(4, 20, true); record.set(header.subarray(4, 30), 6); recordView.setUint32(42, offset, true);
    parts.push(header, filename, blob); central.push(record, filename);
    offset += header.length + filename.length + blob.size; directorySize += record.length + filename.length;
  }
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true); view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
