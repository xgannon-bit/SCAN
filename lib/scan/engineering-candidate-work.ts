import type { PreparationAccounting, PreparationBindingWork, PreparationItem } from "./preparation-work";
import type { NativeInspectionWork } from "./native-inspection-work";

const MAX_JSON = 8_000_000;
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let x = i;
  for (let bit = 0; bit < 8; bit++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
  return x >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Read bounded report members from the already hash-verified worker download.
 * Never extract source/job files or execute contents. ZIP64/multipart/encrypted
 * report entries and mismatched local/central records are deliberately refused.
 */
async function reports(blob: Blob, wanted: string[]) {
  if (blob.size < 22 || blob.size > 250_000_000) throw new Error("Candidate report transport exceeds its bounds.");
  const tailOffset = Math.max(0, blob.size - 65557), tail = new Uint8Array(await blob.slice(tailOffset).arrayBuffer()), end = new DataView(tail.buffer);
  let eocd = -1;
  for (let p = tail.length - 22; p >= 0; p--) {
    if (end.getUint32(p, true) === 0x06054b50 && p + 22 + end.getUint16(p + 20, true) === tail.length) { eocd = p; break; }
  }
  if (eocd < 0 || end.getUint16(eocd + 4, true) || end.getUint16(eocd + 6, true)) throw new Error("Unsupported candidate ZIP directory.");
  const count = end.getUint16(eocd + 10, true), size = end.getUint32(eocd + 12, true), start = end.getUint32(eocd + 16, true);
  if (!count || count > 128 || count !== end.getUint16(eocd + 8, true) || size > 1_000_000 || start + size !== tailOffset + eocd) throw new Error("Invalid candidate ZIP directory bounds.");
  const bytes = new Uint8Array(await blob.slice(start, start + size).arrayBuffer()), directory = new DataView(bytes.buffer);
  const entries = new Map<string, { method: number; flags: number; compressed: number; size: number; crc: number; offset: number }>();
  let position = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > bytes.length || directory.getUint32(position, true) !== 0x02014b50) throw new Error("Invalid candidate central entry.");
    const nameLength = directory.getUint16(position + 28, true), extraLength = directory.getUint16(position + 30, true), commentLength = directory.getUint16(position + 32, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length || directory.getUint16(position + 34, true)) throw new Error("Invalid candidate central entry bounds.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (wanted.includes(name)) {
      if (entries.has(name)) throw new Error("Repeated candidate report member.");
      entries.set(name, { method: directory.getUint16(position + 10, true), flags: directory.getUint16(position + 8, true),
        compressed: directory.getUint32(position + 20, true), size: directory.getUint32(position + 24, true), crc: directory.getUint32(position + 16, true), offset: directory.getUint32(position + 42, true) });
    }
    position = next;
  }
  if (position !== bytes.length || entries.size !== wanted.length) throw new Error("Candidate reports are missing or ambiguous.");
  const output = new Map<string, unknown>();
  for (const name of wanted) {
    const entry = entries.get(name)!;
    if (![0, 8].includes(entry.method) || entry.flags & ~0x808 || !entry.size || entry.size > MAX_JSON || entry.compressed > MAX_JSON || entry.offset + 30 > start) throw new Error("Unsupported candidate report encoding or size.");
    const raw = new Uint8Array(await blob.slice(entry.offset, entry.offset + 30).arrayBuffer()), local = new DataView(raw.buffer);
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== entry.flags || local.getUint16(8, true) !== entry.method) throw new Error("Candidate local/central report mismatch.");
    const length = local.getUint16(26, true), extra = local.getUint16(28, true), dataStart = entry.offset + 30 + length + extra;
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(await blob.slice(entry.offset + 30, entry.offset + 30 + length).arrayBuffer());
    if (localName !== name || dataStart + entry.compressed > start || (!(entry.flags & 8) && (local.getUint32(14, true) !== entry.crc || local.getUint32(18, true) !== entry.compressed || local.getUint32(22, true) !== entry.size))) throw new Error("Candidate report data bounds or CRC metadata differ.");
    const compressed = blob.slice(dataStart, dataStart + entry.compressed);
    const stream = entry.method === 0 ? compressed.stream() : compressed.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader(), chunks: Uint8Array[] = []; let total = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; total += next.value.length; if (total > entry.size || total > MAX_JSON) throw new Error("Candidate report inflation exceeds its bounds."); chunks.push(next.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (total !== entry.size) throw new Error("Candidate report length differs.");
    const inflated = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { inflated.set(chunk, offset); offset += chunk.length; }
    if (crc32(inflated) !== entry.crc) throw new Error("Candidate report CRC differs.");
    try { output.set(name, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inflated))); }
    catch { throw new Error("Candidate report JSON is invalid."); }
  }
  return output;
}

export async function readCandidateWork(blob: Blob, candidateSha256: string, archiveSha256: string, items: PreparationItem[], accepted: string[]) {
  const decoded = await reports(blob, ["manifest.json", "component_accounting.json", "pad-binding-work.json", "native-inspection-work.json"]);
  const manifest = decoded.get("manifest.json") as Record<string, unknown>;
  if (manifest.candidateSha256 !== candidateSha256 || manifest.archiveSha256 !== archiveSha256 || manifest.qualificationOnly !== true || manifest.machineExportAllowed !== false) throw new Error("Candidate work receipt differs from the verified download.");
  const accounting = decoded.get("component_accounting.json") as PreparationAccounting[];
  const text = (v: unknown) => typeof v === "string" && !!v && v.length <= 2048;
  if (!Array.isArray(accounting) || accounting.length > 10000 || accounting.some(r => !r || !text(r.reference) || !text(r.module) || !text(r.status) || !Array.isArray(r.placementIds) || r.placementIds.length > 1000 || r.placementIds.some(v => !text(v)) || !Array.isArray(r.masterKeys) || r.masterKeys.some(v => !text(v)))) throw new Error("Candidate component accounting is invalid.");
  const prepared = accounting.filter(r => ["prepared-disabled", "prepared-partial-disabled"].includes(r.status));
  if (prepared.length !== accepted.length || prepared.some(r => !items.some(i => i.digest && accepted.includes(i.digest) && i.reference === r.reference && i.selection.moduleId === r.module && r.placementIds.length === 1 && r.placementIds[0] === i.dependencies?.partId && r.masterKeys!.length === 1 && r.masterKeys![0] === i.dependencies?.masterKey))) throw new Error("Actual prepared placements differ from accepted proposals.");
  const bindingWork = decoded.get("pad-binding-work.json") as PreparationBindingWork;
  const queue = decoded.get("native-inspection-work.json") as NativeInspectionWork;
  if (bindingWork.status !== "recorded" || !Array.isArray(bindingWork.components) || bindingWork.components.length !== accounting.length || !Array.isArray(bindingWork.sharedBlockers) || queue.status !== "recorded" || !Array.isArray(queue.scopes) || !Array.isArray(queue.windows) || queue.windows.length > 20000) throw new Error("Actual candidate binding/window work is unavailable.");
  return { accounting, bindingWork, queue };
}
