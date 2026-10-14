import type { ArchiveReview } from "./archive-types";
export type CachedRaster = { blob: Blob; sha256: string; member: string; width: number; height: number };
const validHash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
export function rasterSourceIdentity(review: ArchiveReview | null): string {
  const p = review?.preflight;
  if (!p || !p.integrity?.allArchivedFilesVerified || !validHash(p.source.sha256) || !validHash(review!.capture.packageSha256) || p.packageSha256 !== review!.capture.packageSha256) return "";
  return JSON.stringify([p.source.sha256, review!.capture.packageSha256, p.selection]);
}
const digest = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
/** Tab-local encoded originals only. No URLs, decoded buffers, disks or saved proof.
 * One exact source epoch, LRU <=3 /32MB, 5-minute TTL. Every reuse rehashes bytes. */
export class VerifiedRasterCache {
  private source = "";
  private entries = new Map<string, { raster: CachedRaster; at: number }>();
  constructor(private maxBytes = 32_000_000, private maxEntries = 3, private ttlMs = 300_000) {}
  bind(source: string) { if (source !== this.source) { this.entries.clear(); this.source = source; } }
  clear() { this.entries.clear(); this.source = ""; }
  stats() { return { entries: this.entries.size, encodedBytes: [...this.entries.values()].reduce((n, x) => n + x.raster.blob.size, 0) }; }
  async put(source: string, raster: CachedRaster) {
    if (!source || source !== this.source || !validHash(raster.sha256) || !raster.member || raster.blob.size <= 0 || raster.blob.size > this.maxBytes || !["image/png", "image/jpeg", "image/bmp"].includes(raster.blob.type) || ![raster.width, raster.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 40000) || raster.width*raster.height > 80_000_000 || await digest(raster.blob) !== raster.sha256 || source !== this.source) return false;
    this.entries.delete(raster.member); this.entries.set(raster.member, { raster, at: Date.now() });
    while (this.entries.size > this.maxEntries || this.stats().encodedBytes > this.maxBytes) this.entries.delete(this.entries.keys().next().value!);
    return true;
  }
  async get(source: string, member: string, sha256: string, size: number): Promise<CachedRaster | null> {
    const entry = this.entries.get(member);
    if (!source || source !== this.source || !entry) return null;
    if (Date.now()-entry.at > this.ttlMs || sha256 !== entry.raster.sha256 || size !== entry.raster.blob.size || await digest(entry.raster.blob) !== sha256) { if (this.entries.get(member) === entry) this.entries.delete(member); return null; }
    if (source !== this.source || this.entries.get(member) !== entry) return null;
    this.entries.delete(member); this.entries.set(member, entry); return entry.raster;
  }
}
export const rasterCache = new VerifiedRasterCache();
