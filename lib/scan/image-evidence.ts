import type { SnapshotPreflight } from "./archive-types";
import type { VisualEntity } from "./visual-workspace";

export type ImageAsset = { member: string; sha256: string; size: number; role: "board-candidate" | "model-reference" | "pattern-model" | "other"; width: number | null; height: number | null; mime: string | null; preview: "held" | "supported-header"; reason: string; dimensionEvidence: "unavailable" | "raster-header-only" };
export type ImageCatalog = { status: "success"; artifactType: "scan.image-catalog"; schemaVersion: "1"; sourceSha256: string; packageSha256: string; snapshotId: string; selection: SnapshotPreflight["selection"]; entries: ImageAsset[]; omittedAssets: number; registration: "unregistered"; machineExportAllowed: false };
export const imageRoles = { "board-candidate": "Board / panel candidates", "model-reference": "Part-library references", "pattern-model": "Pattern models · decoder unavailable", other: "Other raster assets" };
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const scalar = (r: { rawFields: Record<string, string[]> }, k: string) => r.rawFields[k]?.length === 1 ? r.rawFields[k][0] : null;
export function assetRole(member: string, selection: SnapshotPreflight["selection"]): ImageAsset["role"] | null {
  if (member.includes("\\") || member.split("/").some(p => p === ".." || p === "." || !p)) return null;
  const parent = member.slice(0, member.lastIndexOf("/"));
  const master = selection.master?.member.slice(0, selection.master.member.lastIndexOf("/"));
  if (master && parent === `${master}/PartImage`) return "model-reference";
  if (master && parent === `${master}/PatternModel`) return "pattern-model";
  return member.startsWith(`${selection.root}/`) ? parent === selection.root ? "board-candidate" : "other" : null;
}
/** Rebind catalog to current verified original/candidate bytes; never trust a saved report. */
export function validateImageCatalog(value: unknown, p: SnapshotPreflight): ImageCatalog {
  const v = value as ImageCatalog;
  const fail = () => { throw new Error("Image catalog provenance differs from the selected verified snapshot."); };
  if (!v || p.integrity?.allArchivedFilesVerified !== true || v.status !== "success" || v.artifactType !== "scan.image-catalog" || v.schemaVersion !== "1" || v.sourceSha256 !== p.source.sha256 || v.packageSha256 !== p.packageSha256 || v.snapshotId !== p.snapshotId || JSON.stringify(v.selection) !== JSON.stringify(p.selection) || v.registration !== "unregistered" || v.machineExportAllowed !== false || !Array.isArray(v.entries) || v.entries.length > 256 || new Set(v.entries.map(e => e.member)).size !== v.entries.length || !Number.isSafeInteger(v.omittedAssets) || v.omittedAssets < 0) return fail();
  for (const e of v.entries) {
    const f = p.preservedFiles.filter(f => f.originalName === e.member);
    if (typeof e.member !== "string" || e.member.length > 2048 || f.length !== 1 || !hash(e.sha256) || e.sha256 !== f[0].sha256 || e.size !== f[0].size || e.role !== assetRole(e.member, p.selection) || typeof e.reason !== "string" || e.reason.length > 2000 || !["held", "supported-header"].includes(e.preview)) return fail();
    if (e.preview === "supported-header" && (e.dimensionEvidence !== "raster-header-only" || !["image/png", "image/jpeg", "image/bmp"].includes(e.mime ?? "") || !Number.isSafeInteger(e.width) || !Number.isSafeInteger(e.height) || e.width! <= 0 || e.height! <= 0 || e.width! * e.height! > 80_000_000 || Math.max(e.width!, e.height!) > 40000 || e.size <= 0 || e.size > 32_000_000)) return fail();
    if (e.preview === "held" && (e.width !== null || e.height !== null || e.mime !== null || e.dimensionEvidence !== "unavailable")) return fail();
  }
  return v;
}

/** Observed storage contract: unique Part.MasterKey -> Master.PartCode -> exact
 * PartImage/<PartCode> raster stem. No normalization, substring or nearest match.
 * This establishes a model-reference correspondence, never an instance/OK image.
 */
export function referenceForPlacement(p: SnapshotPreflight | undefined, catalog: ImageCatalog | null, e: VisualEntity | undefined) {
  const held = (reason: string) => ({ asset: null as ImageAsset | null, reason, masterPath: null as string | null, code: null as string | null });
  if (!p || !e || !catalog) return held("Open the image catalog for this exact native snapshot.");
  if (catalog.sourceSha256 !== p.source.sha256 || catalog.packageSha256 !== p.packageSha256 || catalog.selection.master?.sha256 !== p.selection.master?.sha256) return held("Reference catalog is stale or belongs to another snapshot.");
  const supported = (doc: SnapshotPreflight["nativeRecords"][string] | undefined) => doc?.status === "recorded" && ["10.1", "10.2"].includes(doc.schemaVersionClaim ?? "") && doc.readerProfile === `jobcontainer-${doc.schemaVersionClaim}-observed-readonly-1`;
  if (!supported(p.nativeRecords.job) || !supported(p.nativeRecords.master) || !p.selection.master) return held("Selected Job/Master does not have a supported observed read profile.");
  const parts = p.nativeRecords.job.records.filter(r => r.kind === "part-record" && ["ParentId", "RefID", "ID", "MasterKey"].every((k, i) => scalar(r, k) === [e.module, e.ref, e.id, e.master][i]));
  const models = p.nativeRecords.master.records.filter(r => r.kind === "part-record" && scalar(r, "MasterKey") === e.master);
  if (parts.length !== 1 || !e.master || models.length !== 1 || parts[0].sourcePath !== e.path) return held("Placement/Master identity is missing, repeated or incompatible; reference association held.");
  const code = scalar(models[0], "PartCode");
  if (!code || /[/\\\0]/.test(code) || code === "." || code === ".." || (Object.hasOwn(parts[0].rawFields, "PartCode") && scalar(parts[0], "PartCode") !== code)) return held("Unique safe Master PartCode and nonconflicting placement code are required.");
  const assets = catalog.entries.filter(a => a.role === "model-reference" && a.member.slice(a.member.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "") === code);
  if (assets.length !== 1) return held(assets.length ? "Multiple exact code assets: association is ambiguous." : "Reference unavailable: no exact preserved PartCode image.");
  return { asset: assets[0], reason: "Exact MasterKey and PartCode filename correspondence; vendor reference/OK-image semantics unqualified.", masterPath: models[0].sourcePath, code };
}
