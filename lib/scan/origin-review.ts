import type { BomResult } from "./bom-types";
import type { RegistrationSource } from "./source-registration";
import type { OriginResolverReport, OriginSettings } from "./origin-resolver";

export type OriginReviewSession = {
  schemaVersion: "1"; sourceId: string; outputAnchor: "as-supplied" | OriginSettings["outputAnchor"];
  sourceAnchor: OriginSettings["sourceAnchor"]; sourceRevision: string; layoutRevision: string; bomRevision: string;
  relationshipEvidence: string; toleranceMm: number; reviewer: string; reviewerRole: "development-test" | "operator";
  decisions: { key: string; digest: string; choice: "accepted" | "rejected"; reviewer: string; reviewerRole: "development-test" | "operator" }[];
};
export const emptyOriginReview = (): OriginReviewSession => ({ schemaVersion: "1", sourceId: "primary", outputAnchor: "as-supplied", sourceAnchor: "unknown", sourceRevision: "", layoutRevision: "", bomRevision: "", relationshipEvidence: "", toleranceMm: .001, reviewer: "", reviewerRole: "development-test", decisions: [] });
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !v.includes("\0");
export function validateOriginReview(value: unknown): OriginReviewSession {
  const v = value as OriginReviewSession;
  if (!v || typeof v !== "object" || Object.keys(v).sort().join() !== Object.keys(emptyOriginReview()).sort().join() || v.schemaVersion !== "1" || !["as-supplied", "pcb-footprint-origin", "package-body-center"].includes(v.outputAnchor) || !["unknown", "declared-center", "pcb-footprint-origin", "package-body-center"].includes(v.sourceAnchor) || !["development-test", "operator"].includes(v.reviewerRole)) throw new Error("Invalid origin review settings.");
  for (const k of ["sourceId", "sourceRevision", "layoutRevision", "bomRevision", "reviewer"] as const) if (!bounded(v[k], 256)) throw new Error("Invalid origin review text.");
  if (!bounded(v.relationshipEvidence, 3000) || !Number.isFinite(v.toleranceMm) || v.toleranceMm <= 0 || v.toleranceMm > 1 || !Array.isArray(v.decisions) || v.decisions.length > 10000) throw new Error("Invalid origin review bounds.");
  const keys = new Set<string>();
  for (const d of v.decisions) {
    if (!d || Object.keys(d).sort().join() !== "choice,digest,key,reviewer,reviewerRole" || !bounded(d.key, 2300) || keys.has(d.key) || !/^[a-f0-9]{64}$/.test(d.digest) || !["accepted", "rejected"].includes(d.choice) || !bounded(d.reviewer, 256) || !d.reviewer.trim() || !["development-test", "operator"].includes(d.reviewerRole)) throw new Error("Invalid source-bound origin decision.");
    keys.add(d.key);
  }
  return v;
}
export const originKey = (p: { reference: string; module: string; identity: string }) => JSON.stringify([p.module, p.reference, p.identity]);
export type CentroidRow = { key: string; reference: string; module: string; side: string | null; x: number | null; y: number | null; rotation: number | null; population: string; anchor: string; frame: string; original: { x: number; y: number; rotation: number | null; side: string; frame: string; anchor: string }; holds: string[] };
/** As-supplied means literal source-anchor semantics, never inferred body centroids. */
export function centroidRows(source: RegistrationSource, bom: BomResult | null, settings: OriginReviewSession, report: OriginResolverReport | null): CentroidRow[] {
  validateOriginReview(settings);
  if (source.points.length > 10000) throw new Error("Centroid row limit exceeded.");
  const counts = new Map<string, number>();
  for (const p of source.points) { const key = JSON.stringify([p.module, p.reference]); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return source.points.map(p => {
    const matches = bom?.references.filter(b => b.normalizedRefdes === p.reference.trim().toUpperCase()) ?? [];
    const body = report?.rows.find(r => r.sourceIdentity === p.identity && r.reference === p.reference);
    const supplied = settings.outputAnchor === "as-supplied", target = supplied ? p : body?.proposed;
    const side = supplied ? p.side.toLowerCase() : target?.side?.toLowerCase();
    const holds = [...p.holds];
    if (settings.sourceId !== source.id) holds.push("Selected centroid source identity changed.");
    if (counts.get(JSON.stringify([p.module, p.reference])) !== 1) holds.push("Duplicate reference in this module; choose an exact source interpretation.");
    if (!bom || matches.length !== 1 || !matches[0]?.quantityMatches) holds.push("A unique, quantity-consistent BOM reference is required.");
    if (matches.length === 1 && ((matches[0].scope?.module && matches[0].scope.module !== p.module) || (["top", "bottom"].includes(matches[0].scope?.side?.toLowerCase()) && matches[0].scope.side.toLowerCase() !== p.side.toLowerCase()))) holds.push("BOM module or physical side conflicts with the selected source reference.");
    if (bom?.status !== "success") holds.push("Resolve blocked BOM interpretation before exporting reviewed centroid data.");
    if (!settings.sourceRevision || !settings.bomRevision || settings.sourceRevision !== settings.bomRevision || (source.revisionHint && source.revisionHint !== settings.sourceRevision) || (bom?.config.revision && bom.config.revision !== settings.bomRevision)) holds.push("Source and BOM revisions must be explicitly established and match; legacy data stays separate.");
    if (source.normalizedUnits !== "mm") holds.push("Source units are not established in millimeters.");
    if (supplied && (!settings.relationshipEvidence.trim() || settings.sourceAnchor === "unknown")) holds.push("State the source column/anchor meaning before exporting as-supplied coordinates.");
    if (!supplied && (!body?.exportEligible || !report || report.sourceSha256 !== source.sha256 || report.bomSha256 !== bom?.sourceSha256)) holds.push("Independent origin evidence is held or stale for this exact source and BOM.", ...(body?.holds.map(h => h.message) ?? []));
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.rotation)) holds.push("Coordinates and declared rotation are required.");
    if (side !== "top" && side !== "bottom") holds.push("Physical side is unknown; no side is inferred from unflipped geometry.");
    for (const v of [p.reference, p.module]) if (!v || v.length > 512 || /^[\s=+@-]/.test(v) || /[\u0000-\u001f]/.test(v)) holds.push("Reference/module text is missing or unsafe for exact centroid CSV interchange.");
    return { key: originKey(p), reference: p.reference, module: p.module, side: side === "top" || side === "bottom" ? side : null, x: target?.x ?? null, y: target?.y ?? null, rotation: target?.rotation ?? null, population: matches.length === 1 ? matches[0].populationEvidence : "unknown", anchor: supplied ? `as-supplied:${settings.sourceAnchor}` : settings.outputAnchor, frame: supplied ? source.frame : "pcb-source-mm", original: { x: p.x, y: p.y, rotation: p.rotation, side: p.side, frame: source.frame, anchor: settings.sourceAnchor }, holds: [...new Set(holds)] };
  });
}
export async function originReviewDigest(source: RegistrationSource, bom: BomResult | null, settings: OriginReviewSession, rows: CentroidRow[], report: OriginResolverReport | null) {
  const { decisions: _decisions, reviewer: _reviewer, reviewerRole: _role, ...basis } = settings;
  const bytes = new TextEncoder().encode(JSON.stringify({ analyzer: "reviewed-centroid-1", source, bom, basis, rows, report: settings.outputAnchor === "as-supplied" ? null : report }));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
const csvCell = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
const headers = ["RefDes", "X_mm", "Y_mm", "Rotation_CCW_deg", "Side", "Module", "PopulationEvidence"];
export function parseCentroidCsv(csv: string) {
  if (csv.length > 10_000_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(csv)) throw new Error("Invalid centroid CSV bounds.");
  // Strict parser for the documented all-quoted, single-line-cell interchange.
  const lines = csv.replace(/^\uFEFF/, "").split("\r\n"); if (lines.pop() !== "") throw new Error("Centroid CSV must end with CRLF.");
  const rows = lines.map(line => { const fields: string[] = []; let p = 0; while (p < line.length) { if (line[p++] !== '"') throw new Error("Invalid CSV field."); let value = "", closed = false; while (p < line.length) { if (line[p] === '"') { if (line[p + 1] === '"') { value += '"'; p += 2; } else { p++; closed = true; break; } } else value += line[p++]; } if (!closed || (p < line.length && (line[p++] !== ',' || p === line.length))) throw new Error("Invalid CSV separator."); fields.push(value); } return fields; });
  if (JSON.stringify(rows.shift()) !== JSON.stringify(headers) || rows.some(r => r.length !== headers.length)) throw new Error("Unexpected centroid CSV schema.");
  return rows.map(r => ({ reference: r[0], x: Number(r[1]), y: Number(r[2]), rotation: Number(r[3]), side: r[4], module: r[5], population: r[6] }));
}
/** Export rederives rows and their digest; saved/caller-supplied rows never grant authority. */
export async function buildCentroidExport(source: RegistrationSource, bom: BomResult | null, settings: OriginReviewSession, report: OriginResolverReport | null, expectedDigest: string, allowExplicitSubset = false) {
  const rows = centroidRows(source, bom, settings, report);
  const digest = await originReviewDigest(source, bom, settings, rows, report);
  if (digest !== expectedDigest) throw new Error("Centroid review is stale; exact source interpretation or values changed.");
  const output = serializeCentroidExport(rows, settings, digest, allowExplicitSubset);
  return { ...output, manifest: { ...output.manifest, source: { id: source.id, name: source.label, sha256: source.sha256, interpretation: source.interpretation, frame: source.frame, inputUnits: source.inputUnits }, bomSha256: bom?.sourceSha256 ?? null, settings: { sourceAnchor: settings.sourceAnchor, sourceRevision: settings.sourceRevision, layoutRevision: settings.layoutRevision, bomRevision: settings.bomRevision, relationshipEvidence: settings.relationshipEvidence, toleranceMm: settings.toleranceMm } } };
}
function serializeCentroidExport(rows: CentroidRow[], settings: OriginReviewSession, digest: string, allowExplicitSubset = false) {
  validateOriginReview(settings);
  if (!/^[a-f0-9]{64}$/.test(digest) || rows.length > 10000 || new Set(rows.map(r => r.key)).size !== rows.length) throw new Error("Invalid centroid review identity.");
  const approved = new Map(settings.decisions.filter(d => d.digest === digest && d.choice === "accepted").map(d => [d.key, d]));
  const included = rows.filter(r => !r.holds.length && approved.has(r.key));
  if (included.some(r => ![r.x, r.y, r.rotation].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9) || !["top", "bottom"].includes(r.side ?? "") || [r.reference, r.module, r.population].some(v => !v || v.length > 512 || /^[\s=+@-]/.test(v) || /[\u0000-\u001f]/.test(v)))) throw new Error("Accepted centroid contains unsafe or unknown interchange fields.");
  const excluded = rows.filter(r => !included.includes(r)).map(r => ({ reference: r.reference, module: r.module, identityKey: r.key, reasons: r.holds.length ? r.holds : [settings.decisions.some(d => d.key === r.key && d.digest === digest && d.choice === "rejected") ? "Review rejected" : "Current exact row has not been accepted"] }));
  if (!included.length || (excluded.length && !allowExplicitSubset)) throw new Error("No complete accepted centroid set. Review all rows or explicitly acknowledge the listed subset exclusions.");
  const rounded = (v: number | null) => Number(v).toFixed(6);
  const csv = [headers.map(csvCell).join(','), ...included.map(r => [r.reference, rounded(r.x), rounded(r.y), rounded(((r.rotation! % 360) + 360) % 360), r.side!, r.module, r.population].map(csvCell).join(','))].join('\r\n') + '\r\n';
  const parsed = parseCentroidCsv(csv);
  if (parsed.length !== included.length || parsed.some((p, i) => { const r = included[i]; return p.reference !== r.reference || p.module !== r.module || p.side !== r.side || p.population !== r.population || Math.abs(p.x - r.x!) > .000000501 || Math.abs(p.y - r.y!) > .000000501 || Math.min(Math.abs(p.rotation - ((r.rotation! % 360 + 360) % 360)), 360 - Math.abs(p.rotation - ((r.rotation! % 360 + 360) % 360))) > .000000501; })) throw new Error("Exported centroid round-trip differs from accepted values.");
  return { csv, manifest: { artifactType: "scan.reviewed-centroid-export", schemaVersion: "1", digest, outputAnchor: settings.outputAnchor, units: "mm", rotation: "CCW degrees viewed in the declared source frame", serializationQuantumMm: .000001, quantumMeaning: "Serialization precision only, not physical accuracy.", rowCount: included.length, intendedRows: rows.length, excluded, acceptedDecisions: included.map(r => approved.get(r.key)), beforeAfterRows: included, containsEngineeringDnp: included.some(r => /dnp/i.test(r.population)), workOrderPopulation: "unapproved", nativeEditsApplied: false, EagleImportQualified: false, roundTripPassed: true } };
}
