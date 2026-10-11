import type { BomResult } from "./bom-types";
import type { LayoutResult, LayoutPlacement } from "./layout-types";
import { registrationReference, registrationScope, transformPoint, type RegistrationSource, type RigidTransform, sourceRegistrationAnalysis } from "./source-registration";

export type OriginAnchor = "pcb-footprint-origin" | "package-body-center";
export type OriginSettings = {
  sourceRevision: string; layoutRevision: string; bomRevision: string;
  sourceAnchor: "declared-center" | "pcb-footprint-origin" | "package-body-center" | "unknown";
  outputAnchor: OriginAnchor; toleranceMm: number; relationshipEvidence: string;
};
export type OriginBodyEvidence = {
  reference: string; sourcePath: string; profileId: string; profileSha256: string;
  status: "supported" | "held"; bodyLocalMm: [number, number] | null; bodyBoardMm: [number, number] | null;
  bodySizeMm: [number, number] | null; sourceRotationDegrees: number | null; sourceSide: string | null;
  drawingSha256: string; holds: { code: string; message: string }[]; mpnMatched: boolean;
};
export type OriginBodyEvidenceReport = {
  status: "success"; artifactType: "scan.source-body-evidence"; schemaVersion: "1";
  layoutSha256: string; bomSha256: string; profilesSha256: string; evidenceSha256: string;
  records: OriginBodyEvidence[]; machineQualified: false; nativeEditsApplied: false;
};
export type OriginClassification = "already-consistent" | "explained-convention" | "supported-normalization" | "supported-correction" | "unresolved";
export type OriginResolution = {
  reference: string; sourceIdentity: string | null; sourcePath: string | null; module: string; side: string | null;
  classification: OriginClassification; discrepancy: boolean; summary: string;
  original: { x: number; y: number; rotation: number | null; frame: string; anchor: OriginSettings["sourceAnchor"] } | null;
  mappedOriginal: { x: number; y: number } | null; footprintOrigin: { x: number; y: number } | null;
  bodyCenter: { x: number; y: number } | null; bodyLocalMm: [number, number] | null; bodySizeMm: [number, number] | null;
  padEnvelopeCenter: { x: number; y: number } | null;
  residualsMm: { toFootprintOrigin: number | null; toBodyCenter: number | null; toPadEnvelopeCenter: number | null };
  proposed: { x: number; y: number; rotation: number | null; side: string | null; frame: "pcb-source-mm"; anchor: OriginAnchor; operation: "none" | "anchor-normalization" | "local-source-correction" } | null;
  sourceRotationDegrees: number | null; ownedPads: { number: string; x: number; y: number }[];
  population: string; bomMpn: string | null; profileId: string | null; drawingSha256: string | null;
  evidence: string[]; holds: { code: string; message: string }[]; exportEligible: boolean;
};
export type OriginResolverInput = { source: RegistrationSource; layout: LayoutResult; bom: BomResult | null; registration: ReturnType<typeof sourceRegistrationAnalysis>; settings: OriginSettings; bodyEvidence: OriginBodyEvidenceReport | null };
export type OriginResolverReport = {
  artifactType: "scan.origin-resolution"; schemaVersion: "1"; analyzerVersion: "owned-origin-resolver-1";
  sourceSha256: string; layoutSha256: string; bomSha256: string | null; bodyEvidenceSha256: string | null;
  settings: OriginSettings; transform: RigidTransform | null; rows: OriginResolution[];
  counts: { total: number; discrepancies: number; classifications: Record<OriginClassification, number>; exportEligible: number; held: number };
  holds: { code: string; message: string }[]; nativeEditsApplied: false; machineQualified: false;
};

type Point = { x: number; y: number };
type Hold = { code: string; message: string };
type RawPlacement = LayoutPlacement & { rotation?: { degrees?: number }; isFlippedRaw?: string | null };
const norm = registrationReference;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e7;
const distance = (a: Point | null, b: Point | null) => a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
const angleDistance = (a: number, b: number) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);
const side = (value: string | null | undefined) => ["top", "bottom"].includes(value?.toLowerCase() ?? "") ? value!.toLowerCase() : null;
const point = (p: { xMm: number; yMm: number } | null | undefined): Point | null => p && finite(p.xMm) && finite(p.yMm) ? { x: p.xMm, y: p.yMm } : null;
const grouped = <T>(rows: T[], key: (r: T) => string) => { const result = new Map<string, T[]>(); for (const row of rows) { const k = key(row); result.set(k, [...(result.get(k) ?? []), row]); } return result; };
const rotate = (local: [number, number], degrees: number, origin: Point): Point => {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return { x: origin.x + c * local[0] - s * local[1], y: origin.y + s * local[0] + c * local[1] };
};
export const initialOriginSettings = (): OriginSettings => ({ sourceRevision: "", layoutRevision: "", bomRevision: "", sourceAnchor: "unknown", outputAnchor: "pcb-footprint-origin", toleranceMm: 0.001, relationshipEvidence: "" });
export function validateOriginSettings(value: unknown): OriginSettings {
  const s = value as OriginSettings;
  if (!s || typeof s !== "object" || Object.keys(s).sort().join() !== Object.keys(initialOriginSettings()).sort().join()
    || ![s.sourceRevision, s.layoutRevision, s.bomRevision, s.relationshipEvidence].every(v => typeof v === "string" && v.length <= 3000 && !v.includes("\0"))
    || !["declared-center", "pcb-footprint-origin", "package-body-center", "unknown"].includes(s.sourceAnchor)
    || !["pcb-footprint-origin", "package-body-center"].includes(s.outputAnchor) || !finite(s.toleranceMm) || s.toleranceMm <= 0 || s.toleranceMm > 1) throw new Error("Invalid origin resolver settings.");
  return s;
}

/** A witness to the source land envelope, deliberately NOT a body-center inference. */
function padWitness(placement: RawPlacement, angle: number | null, origin: Point | null) {
  const owned = placement.sourceOwnedPads.flatMap(p => { const xy = point(p.sourceBoardPoint); return xy ? [{ number: p.padNumber, ...xy }] : []; });
  if (angle === null || !origin) return { owned, center: null };
  const layers = placement.explicitLayerGeometry ?? [];
  const centers: Point[] = [];
  for (const layer of layers) {
    // Unresolved class/stack layers do not erase this explicitly numbered layer's
    // witness. It still cannot establish solder-mask/paste/optical semantics.
    if (layer.pads.length !== placement.sourceOwnedPads.length || !layer.pads.length
      || new Set(layer.pads.map(p => p.padNumber)).size !== layer.pads.length
      || layer.pads.some(p => !placement.sourceOwnedPads.some(o => o.sourcePath === p.padSourcePath && o.padNumber === p.padNumber))) continue;
    const bounds = layer.pads.map(p => {
      if (![p.widthMm, p.heightMm, p.local.xMm, p.local.yMm, p.localRotationDegrees].every(finite) || p.widthMm <= 0 || p.heightMm <= 0 || angleDistance(p.localRotationDegrees, Math.round(p.localRotationDegrees / 90) * 90) > 1e-8 || !["Rect", "Oval", "Ellipse"].includes(p.shape)) return null;
      const swapped = Math.abs(Math.round(p.localRotationDegrees / 90)) % 2 === 1, w = swapped ? p.heightMm : p.widthMm, h = swapped ? p.widthMm : p.heightMm;
      return [p.local.xMm - w / 2, p.local.yMm - h / 2, p.local.xMm + w / 2, p.local.yMm + h / 2];
    });
    if (bounds.some(b => !b)) continue;
    const valid = bounds as number[][];
    centers.push(rotate([(Math.min(...valid.map(b => b[0])) + Math.max(...valid.map(b => b[2]))) / 2, (Math.min(...valid.map(b => b[1])) + Math.max(...valid.map(b => b[3]))) / 2], angle, origin));
  }
  return { owned, center: centers.length && centers.every(p => distance(p, centers[0])! < 1e-8) ? centers[0] : null };
}

function properRigid(t: RigidTransform | null): t is RigidTransform {
  if (!t || t.scale !== 1 || t.mirror !== false || !finite(t.angleDegrees) || !Array.isArray(t.matrix) || t.matrix.length !== 2 || t.matrix.some(r => !Array.isArray(r) || r.length !== 3 || !r.every(finite))) return false;
  const [[a, b], [c, d]] = t.matrix, rad = t.angleDegrees * Math.PI / 180;
  return Math.abs(a * d - b * c - 1) < 1e-10 && Math.abs(a - Math.cos(rad)) < 1e-10 && Math.abs(b + Math.sin(rad)) < 1e-10 && Math.abs(c - Math.sin(rad)) < 1e-10 && Math.abs(d - Math.cos(rad)) < 1e-10;
}

/**
 * Diagnoses source conventions; it neither fits component offsets nor writes native data.
 * A reviewed global rigid witness is retained even when LOCAL origin residuals hold
 * whole-scope registration. Every other frame/revision/control failure stays blocking.
 */
export function resolveOrigins(input: OriginResolverInput): OriginResolverReport {
  const { source, layout, bom, registration, bodyEvidence } = input, settings = validateOriginSettings(input.settings);
  if (source.points.length > 10000 || layout.placements.length > 10000 || (bom?.references.length ?? 0) > 10000) throw new Error("Origin resolver exceeds 10,000 source references.");
  const holds: Hold[] = [], add = (code: string, message: string) => holds.push({ code, message });
  if (source.id !== registration.source.id || source.sha256 !== registration.source.sha256 || source.interpretation !== registration.source.interpretation
    || source.frame !== registration.source.frame || source.inputUnits !== registration.source.inputUnits || layout.sourceSha256 !== registration.target.sha256 || registration.target.id !== "layout") add("ORIGIN_REGISTRATION_STALE", "Rebuild registration from these exact source bytes, mapping and PCB interpretation.");
  if (source.normalizedUnits !== "mm") add("ORIGIN_UNITS", "The source must be explicitly normalized to millimeters; native units are not qualified.");
  if (![settings.sourceRevision, settings.layoutRevision, settings.bomRevision].every(r => !!r.trim())
    || new Set([settings.sourceRevision.trim(), settings.layoutRevision.trim(), settings.bomRevision.trim()]).size !== 1
    || (source.revisionHint && source.revisionHint !== settings.sourceRevision.trim())
    || settings.sourceRevision.trim() !== registration.source.revision || settings.layoutRevision.trim() !== registration.target.revision
    || (bom?.config.revision && bom.config.revision.trim() !== settings.bomRevision.trim())) add("ORIGIN_REVISION", "Matching source, PCB and BOM revision evidence is required. Old-revision comparisons cannot authorize current corrections.");
  if (!settings.relationshipEvidence.trim()) add("ORIGIN_RELATIONSHIP", "Record the source/header anchor meaning and the independent same-frame reference evidence.");
  if (!bom || bom.status !== "success") add("ORIGIN_BOM", "A fresh, reconciled matching BOM is required for population and package identity.");
  if (!properRigid(registration.transform)) add("ORIGIN_RIGID", "A finite fixed-scale proper rigid transform is required; no scale or mirror fitting is allowed.");
  const localOnly = new Set([
    "Unselected references have local residuals above threshold: resolve component origins/revisions before whole-scope correction",
    "Selected scopes contain unmatched, duplicate or ambiguous references: comparison retained, whole-scope coordinate export held",
    "Record the physical board side for each source; null layout side is not proof of top",
  ]);
  for (const message of registration.holds) if (!localOnly.has(message)) add("ORIGIN_REGISTRATION", message);
  const sourceRows = source.points.filter(p => registrationScope(p) === registration.source.scope), sourceGroups = grouped(sourceRows, p => norm(p.reference));
  // Source PCB has one board frame; a different target scope is never silently used.
  const layoutRows = layout.placements.filter(p => registrationScope({ module: "source-board", side: p.side ?? "unknown" }) === registration.target.scope);
  if (!sourceRows.length || !layoutRows.length) add("ORIGIN_SCOPE", "The selected source or PCB module/side scope is absent.");
  const layoutGroups = grouped(layoutRows, p => norm(p.refdes)), bomGroups = grouped(bom?.references ?? [], p => p.normalizedRefdes);
  const controls = registration.residuals.filter(p => p.role === "fit" || p.role === "check");
  if (controls.filter(p => p.role === "fit").length < 3 || controls.filter(p => p.role === "check").length < 1 || new Set(controls.map(p => p.reference)).size !== controls.length) add("ORIGIN_CONTROLS", "Three unique fit origins and an independent checkpoint are required.");
  for (const control of controls) {
    const a = sourceGroups.get(control.reference), b = layoutGroups.get(control.reference), target = b?.length === 1 ? point(b[0].anchor) : null;
    if (a?.length !== 1 || b?.length !== 1 || !target || !control.from || !control.to || a[0].identity !== control.from.identity || b[0].sourcePath !== control.to.identity
      || a[0].x !== control.from.x || a[0].y !== control.from.y || target.x !== control.to.x || target.y !== control.to.y || a[0].holds.length || b[0].identityHolds.length
      || !registration.transform || distance(transformPoint(a[0], registration.transform), target)! > Math.min(settings.toleranceMm, registration.toleranceMm)) {
      add("ORIGIN_CONTROLS_STALE", "A selected fit/check identity, position or residual is stale or unsupported."); break;
    }
  }
  const fitPoints = controls.filter(p => p.role === "fit").map(p => p.from!);
  const fitMean = { x: fitPoints.reduce((s, p) => s + p.x, 0) / fitPoints.length, y: fitPoints.reduce((s, p) => s + p.y, 0) / fitPoints.length };
  const xx = fitPoints.reduce((s, p) => s + (p.x - fitMean.x) ** 2, 0), yy = fitPoints.reduce((s, p) => s + (p.y - fitMean.y) ** 2, 0), xy = fitPoints.reduce((s, p) => s + (p.x - fitMean.x) * (p.y - fitMean.y), 0);
  if (!(xx + yy > 1e-12 && (xx * yy - xy * xy) / (xx + yy) ** 2 > 1e-6)) add("ORIGIN_CONTROL_GEOMETRY", "Noncollinear independent global registration evidence is required.");
  const bodyFresh = !!bodyEvidence && bodyEvidence.artifactType === "scan.source-body-evidence" && bodyEvidence.layoutSha256 === layout.sourceSha256 && bodyEvidence.bomSha256 === bom?.sourceSha256 && bodyEvidence.machineQualified === false && bodyEvidence.nativeEditsApplied === false;
  const bodyGroups = grouped(bodyFresh ? bodyEvidence.records : [], r => r.sourcePath);
  if (bodyEvidence && !bodyFresh) add("ORIGIN_BODY_STALE", "Body evidence belongs to different source or BOM bytes; rebuild it before normalization.");
  const transform = properRigid(registration.transform) ? registration.transform : null;
  const rows: OriginResolution[] = [...new Set([...sourceGroups.keys(), ...layoutGroups.keys()])].sort().map(reference => {
    const rowHolds: Hold[] = [], hold = (code: string, message: string) => rowHolds.push({ code, message });
    const sourceMatches = sourceGroups.get(reference) ?? [], layoutMatches = layoutGroups.get(reference) ?? [], bomMatches = bomGroups.get(reference) ?? [];
    const original = sourceMatches.length === 1 ? sourceMatches[0] : null, pcb = layoutMatches.length === 1 ? layoutMatches[0] as RawPlacement : null, bomRow = bomMatches.length === 1 ? bomMatches[0] : null;
    if (sourceMatches.length !== 1 || layoutMatches.length !== 1) hold("ORIGIN_IDENTITY", "Select one exact source row and one owned PCB placement; missing/duplicate identities cannot be normalized.");
    if (original?.holds.length || pcb?.identityHolds.length) hold("ORIGIN_IDENTITY", "The selected source identity has unresolved parser/ownership holds.");
    if (bomMatches.length !== 1 || !bomRow?.quantityMatches) hold("ORIGIN_BOM_IDENTITY", "A unique quantity-reconciled BOM reference is required.");
    if (bomRow && ((bomRow.scope.module && bomRow.scope.module !== original?.module) || (side(bomRow.scope.side) && side(bomRow.scope.side) !== side(original?.side)))) hold("ORIGIN_BOM_SCOPE", "BOM module/side conflicts with the selected placement scope.");
    if (pcb?.isFlippedRaw != null && pcb.isFlippedRaw.toLowerCase() !== "false") hold("ORIGIN_FLIP", "Source flip/mirror semantics are unsupported; no reflected anchor is inferred.");
    const rotation = finite(pcb?.rotation?.degrees) ? pcb!.rotation!.degrees! : null;
    if (rotation === null || !finite(original?.rotation)) hold("ORIGIN_ROTATION", "Both source rotations must be explicit finite values with a known angle convention.");
    const origin = point(pcb?.anchor), mapped = original && finite(original.x) && finite(original.y) && transform ? transformPoint(original, transform) : null;
    if (!origin || !mapped) hold("ORIGIN_COORDINATE", "Finite positions and a supported shared rigid registration are required.");
    const mappedRotation = original && finite(original.rotation) && transform ? ((original.rotation + transform.angleDegrees) % 360 + 360) % 360 : null;
    if (rotation !== null && mappedRotation !== null && angleDistance(rotation, mappedRotation) > 0.01) hold("ORIGIN_ROTATION_CONVENTION", "CSV and PCB rotations disagree after the global transform; independently establish the package/angle datum before export.");
    const witness = pcb ? padWitness(pcb, rotation, origin) : { owned: [], center: null };
    const bodies = pcb ? bodyGroups.get(pcb.sourcePath) ?? [] : [], body = bodies.length === 1 ? bodies[0] : null;
    let bodyCenter: Point | null = null, bodyLocal: [number, number] | null = null, bodySize: [number, number] | null = null;
    if (bodies.length > 1) hold("ORIGIN_BODY_AMBIGUOUS", "Multiple independent body candidates match this source; symmetry or competing profiles is unresolved.");
    if (body?.status === "supported" && body.mpnMatched && body.reference && norm(body.reference) === reference && body.sourceRotationDegrees === rotation
      && body.sourceSide === pcb?.side && body.bodyLocalMm?.length === 2 && body.bodyLocalMm.every(finite) && body.bodyBoardMm?.length === 2 && body.bodyBoardMm.every(finite)
      && body.bodySizeMm?.length === 2 && body.bodySizeMm.every(v => finite(v) && v > 0) && /^[a-f0-9]{64}$/.test(body.drawingSha256)
      && !body.holds.length && origin && rotation !== null) {
      const reconstructed = rotate(body.bodyLocalMm, rotation, origin);
      if (distance(reconstructed, { x: body.bodyBoardMm[0], y: body.bodyBoardMm[1] })! <= 1e-8) { bodyCenter = reconstructed; bodyLocal = body.bodyLocalMm; bodySize = body.bodySizeMm; }
      else hold("ORIGIN_BODY_FRAME", "Independent body local and board coordinates do not close under the declared source rotation.");
    } else if (body?.status === "supported") hold("ORIGIN_BODY_STALE", "Body identity, package evidence or source rotation no longer matches this component.");
    const residuals = { toFootprintOrigin: distance(mapped, origin), toBodyCenter: distance(mapped, bodyCenter), toPadEnvelopeCenter: distance(mapped, witness.center) };
    const discrepancy = residuals.toFootprintOrigin !== null && residuals.toFootprintOrigin > settings.toleranceMm;
    let classification: OriginClassification = "unresolved", summary = "The declared centroid datum has not been established independently.";
    let operation: NonNullable<OriginResolution["proposed"]>["operation"] = "none";
    const geometricHolds = rowHolds.filter(h => !["ORIGIN_ROTATION_CONVENTION"].includes(h.code));
    if (!holds.length && !geometricHolds.length && mapped && origin && settings.sourceAnchor !== "unknown") {
      const atOrigin = residuals.toFootprintOrigin! <= settings.toleranceMm, atBody = residuals.toBodyCenter !== null && residuals.toBodyCenter <= settings.toleranceMm;
      const sourceExplained = settings.sourceAnchor === "pcb-footprint-origin" ? atOrigin : settings.sourceAnchor === "package-body-center" ? atBody : atOrigin || atBody;
      if (sourceExplained) {
        if (!atOrigin && atBody && settings.sourceAnchor === "declared-center") { classification = "explained-convention"; summary = "CSV center agrees with the independently established body center; its offset from footprint origin is a convention, not evidence of physical displacement."; }
        else { classification = "already-consistent"; summary = atOrigin ? "Source coordinate agrees with the owned PCB footprint origin; this alone does not prove physical body center." : "Source coordinate agrees with the independently established body center."; }
        const desired = settings.outputAnchor === "pcb-footprint-origin" ? origin : bodyCenter;
        if (desired && distance(mapped, desired)! > settings.toleranceMm) { operation = "anchor-normalization"; if (classification !== "explained-convention") { classification = "supported-normalization"; summary = "The supported input anchor is converted to the explicitly selected output anchor; no physical component movement is claimed."; } }
      } else if (bodyCenter && ["pcb-footprint-origin", "package-body-center"].includes(settings.sourceAnchor)) {
        classification = "supported-correction"; operation = "local-source-correction";
        summary = "The explicitly declared source anchor conflicts with independently supported owned geometry. The proposed source-only correction requires separate review; no native repair is implied.";
      }
    }
    if (classification === "unresolved") {
      if (!bodyCenter) {
        if (body?.holds.length) rowHolds.push(...body.holds);
        else hold("ORIGIN_BODY_DATUM", "Supply a matched manufacturer/package body datum and owned footprint-to-pin/body mapping. A land-envelope midpoint alone is not a physical body center.");
      } else if (settings.sourceAnchor === "unknown" || settings.sourceAnchor === "declared-center") hold("ORIGIN_ANCHOR_MEANING", "Establish what the CSV exporter means by center for this footprint before calling the difference a physical error.");
      if (residuals.toPadEnvelopeCenter !== null && residuals.toPadEnvelopeCenter <= settings.toleranceMm && !bodyCenter) summary = "CSV center agrees with the owned land-envelope midpoint, but independent body/datum evidence is missing. This is not a proved placement defect or body center.";
    }
    const knownSide = side(pcb?.side);
    if (!knownSide || !side(original?.side)) hold("ORIGIN_SIDE_UNKNOWN", "PCB or centroid physical board side is unknown; unflipped does not mean top. Geometry-based normalization export is held.");
    else if (knownSide !== side(original?.side)) hold("ORIGIN_SIDE_MISMATCH", "Source sides differ; an independent side/mirror contract is required.");
    if (bomRow?.populationEvidence === "engineering-dnp") hold("ORIGIN_DNP", "Engineering DNP remains excluded from populated-part output; no work-order population approval is implied.");
    const output = settings.outputAnchor === "pcb-footprint-origin" ? origin : bodyCenter;
    if (settings.outputAnchor === "package-body-center" && !bodyCenter) hold("ORIGIN_OUTPUT_ANCHOR", "The selected output body center has no independent package/body evidence.");
    const proposed = classification !== "unresolved" && output ? { ...output, rotation: mappedRotation, side: knownSide, frame: "pcb-source-mm" as const, anchor: settings.outputAnchor, operation } : null;
    return { reference, sourceIdentity: original?.identity ?? null, sourcePath: pcb?.sourcePath ?? null, module: original?.module ?? "unknown", side: knownSide,
      classification, discrepancy, summary, original: original ? { x: original.x, y: original.y, rotation: original.rotation, frame: source.frame, anchor: settings.sourceAnchor } : null,
      mappedOriginal: mapped, footprintOrigin: origin, bodyCenter, bodyLocalMm: bodyLocal, bodySizeMm: bodySize, padEnvelopeCenter: witness.center, residualsMm: residuals, proposed,
      sourceRotationDegrees: rotation, ownedPads: witness.owned, population: bomRow?.populationEvidence ?? "unknown", bomMpn: bomRow?.mpn ?? null,
      profileId: body?.profileId ?? null, drawingSha256: body?.drawingSha256 ?? null,
      evidence: ["Owned PCB origin and declared rotation; no per-component fitting.", ...(bodyCenter ? ["Matched BOM identity and independent manufacturer profile passed source-owned pad/pin/body checks; body frame reconstructed independently."] : []), ...(witness.center ? ["Owned explicit-layer land envelope is a geometric witness only, not body evidence."] : [])],
      holds: rowHolds, exportEligible: !!proposed && !holds.length && !rowHolds.length };
  });
  const classifications = Object.fromEntries(["already-consistent", "explained-convention", "supported-normalization", "supported-correction", "unresolved"].map(k => [k, rows.filter(r => r.classification === k).length])) as Record<OriginClassification, number>;
  return { artifactType: "scan.origin-resolution", schemaVersion: "1", analyzerVersion: "owned-origin-resolver-1", sourceSha256: source.sha256, layoutSha256: layout.sourceSha256, bomSha256: bom?.sourceSha256 ?? null,
    bodyEvidenceSha256: bodyFresh ? bodyEvidence.evidenceSha256 : null, settings, transform, rows,
    counts: { total: rows.length, discrepancies: rows.filter(r => r.discrepancy).length, classifications, exportEligible: rows.filter(r => r.exportEligible).length, held: rows.filter(r => !r.exportEligible).length }, holds, nativeEditsApplied: false, machineQualified: false };
}
