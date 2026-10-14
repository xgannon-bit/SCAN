import type { SnapshotPreflight } from "./archive-types";
import type { AlignmentResult, GerberResult } from "./geometry-types";
import type { NativeDiagnosisReport } from "./native-placement-diagnosis";
import type { PlacementResult } from "./placement-types";
import { gerberDisplayHold } from "./gerber-display";
import { candidateFrameHold, type PreservationProof } from "./candidate-proof";
import type { RepairRequest } from "./repair-session";
import { isProperRigidMatrix as rigid, type RigidMatrix } from "./rigid-matrix";

export type BoardMatrix = RigidMatrix;
export type BoardLayerHold = { code: string; reason: string };
export type RegisteredBoardLayer = {
  status: "held" | "supported-diagnostic"; matrix: BoardMatrix | null;
  from: "primary-mm" | "gerber-mm"; to: "native-roi-literals";
  holds: BoardLayerHold[]; provenance: Record<string, string>;
  machineQualified: false; padOwnershipEstablished: false;
};
export type RegisteredBoardLayersInput = {
  baseline?: SnapshotPreflight; nativeModule: string;
  candidateView?: boolean; candidate?: SnapshotPreflight; candidateRequest?: RepairRequest; preservationProof?: PreservationProof | null;
  sourceScope?: { module: string; side: string } | null;
  placement?: PlacementResult | null; layoutSha256?: string; bomSha256?: string;
  finding?: { basis: string; report: NativeDiagnosisReport } | null;
  /** Recomputed by the session from current sources, interpretations and profiles. */
  currentDiagnosisBasis: string;
  gerber?: { result: GerberResult | null; alignment: AlignmentResult | null; basis: string };
};

const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v) === JSON.stringify(b, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y))) : v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e9;
const multiply = (a: BoardMatrix, b: BoardMatrix): BoardMatrix => [0, 1].map(i => [a[i][0] * b[0][0] + a[i][1] * b[1][0], a[i][0] * b[0][1] + a[i][1] * b[1][1], a[i][0] * b[0][2] + a[i][1] * b[1][2] + a[i][2]]) as BoardMatrix;
function inverseRigid(m: BoardMatrix): BoardMatrix {
  return [[m[0][0], m[1][0], -m[0][0] * m[0][2] - m[1][0] * m[1][2]], [m[0][1], m[1][1], -m[0][1] * m[0][2] - m[1][1] * m[1][2]]];
}
/** Applies a reviewed display mapping only; no component matching or pad ownership. */
export function boardLayerPoint(matrix: BoardMatrix, point: { x: number; y: number }) {
  return { x: matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2], y: matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2] };
}

/**
 * Composes existing, fresh diagnosis/registration results for display. It never
 * fits geometry, guesses native conventions or changes a source/writer input.
 * The diagnosis worker maps primary mm -> PCB mm -> canonical native mm/Y-up.
 * Undo only the explicitly reviewed native unit/Y normalization to plot beside
 * literal native ROI coordinates. Gerber -> native additionally inverts the
 * independently checked primary -> Gerber rigid registration.
 */
export function registeredBoardLayers(input: RegisteredBoardLayersInput): { cad: RegisteredBoardLayer; gerber: RegisteredBoardLayer } {
  const { baseline: b, placement: p, finding, sourceScope: scope } = input;
  const report = finding?.report, s = report?.settings, holds: BoardLayerHold[] = [];
  const hold = (code: string, reason: string) => holds.push({ code, reason });
  const provenance: Record<string, string> = {};
  const layer = (from: RegisteredBoardLayer["from"], reasons: BoardLayerHold[], matrix: BoardMatrix | null, extra: Record<string, string> = {}): RegisteredBoardLayer => ({ status: reasons.length || !matrix ? "held" : "supported-diagnostic", matrix: reasons.length ? null : matrix, from, to: "native-roi-literals", holds: reasons, provenance: { ...provenance, ...extra }, machineQualified: false, padOwnershipEstablished: false });
  if (input.candidateView) {
    const reason = candidateFrameHold(b, input.candidate, input.candidateRequest, input.preservationProof);
    if (reason) hold("CANDIDATE_FRAME", reason);
    else Object.assign(provenance, { candidateSha256: input.candidate!.source.sha256, candidateJobSha256: input.candidate!.selection.job.sha256, frameEvidence: "Fresh exact ROI-only reproduction; module/frame records preserved." });
  }
  if (!b || b.integrity?.status !== "verified-against-capture-hash" || !b.integrity.allArchivedFilesVerified || b.nativeRecords.job?.status !== "recorded" || b.selection.job.role !== "main" || b.selection.master?.role !== "main") hold("NATIVE_SNAPSHOT", "Select and freshly verify the original main job and main Master before registering source layers.");
  if (!p || p.status !== "success" || !hash(p.sourceSha256) || !hash(p.interpretationSha256)) hold("PRIMARY_SOURCE", "Fresh normalized primary placement geometry and its interpretation hash are required; native placements remain independently visible.");
  if (!finding || !input.currentDiagnosisBasis || finding.basis !== input.currentDiagnosisBasis || report?.status !== "success" || !hash(report.diagnosisSha256)) hold("FRESH_DIAGNOSIS", "Run the existing source-bound native diagnosis with the current sources, settings and package profiles. Saved history alone cannot establish registration.");
  if (!hash(input.layoutSha256) || !hash(input.bomSha256)) hold("DIAGNOSIS_SOURCES", "The freshly parsed PCB layout and BOM used by native diagnosis are required.");
  if (b && p && report) {
    const expected = { archiveSha256: b.source.sha256, jobSha256: b.selection.job.sha256, masterSha256: b.selection.master?.sha256, root: b.selection.root, jobMember: b.selection.job.member, masterMember: b.selection.master?.member, placementSha256: p.sourceSha256, layoutSha256: input.layoutSha256, bomSha256: input.bomSha256 };
    if (Object.entries(expected).some(([k, v]) => !v || report.source[k] !== v)) hold("SOURCE_IDENTITY", "Diagnosis hashes or selected native members differ from the current source inputs.");
    Object.assign(provenance, { archiveSha256: b.source.sha256, jobSha256: b.selection.job.sha256, placementSha256: p.sourceSha256, placementInterpretationSha256: p.interpretationSha256 ?? "", diagnosisSha256: report.diagnosisSha256, nativeModule: input.nativeModule });
  }
  if (!scope || !scope.module || !["top", "bottom"].includes(scope.side.toLowerCase()) || !p?.placements.some(row => row.module === scope.module && row.side === scope.side)) hold("SOURCE_SCOPE", "Select one exact populated primary module/side scope; reference names cannot register other modules.");
  // The current diagnosis adapter groups the primary by reference without a
  // module selector. Refuse to extend its transform over a multi-scope input.
  if (p && scope && p.placements.some(row => row.module !== scope.module || row.side !== scope.side)) hold("DIAGNOSIS_SCOPE", "The current native diagnosis has no primary-module selector. Multi-scope primary inputs need an explicit scoped diagnosis before this overlay.");
  if (s) {
    if (!s.framesConfirmed || !s.frameStatement.trim() || s.module !== input.nativeModule || !["top", "bottom"].includes(s.sourceSide) || s.sourceSide !== s.nativeSide || s.sourceSide !== scope?.side.toLowerCase() || !["mm", "mil"].includes(s.nativeUnits) || !["up", "down"].includes(s.nativeYDirection) || !["ccw", "cw"].includes(s.nativeRotation) || !["body-center", "footprint-origin"].includes(s.nativeRoiAnchor)) hold("NATIVE_CONVENTION", "Explicit matching side, native module, units, Y direction, rotation and anchor evidence are required; no mirror or unit convention is guessed.");
    if (report!.frame.holds.length) hold("DIAGNOSIS_FRAME_HELD", report!.frame.holds.map(h => `${h.code}: ${h.message}`).join("; "));
    const modules = b?.nativeRecords.job?.records.filter(r => r.kind === "module-record" && r.rawFields.ID?.length === 1 && r.rawFields.ID[0] === input.nativeModule) ?? [];
    if (modules.length !== 1) hold("NATIVE_MODULE", "One exact native module record must establish the selected scope; duplicate or missing module records stay held.");
    else if (["Angle", "Shift/X", "Shift/Y", "RotCenter/X", "RotCenter/Y"].some(key => { const values = modules[0].rawFields[key]; return values?.length !== 1 || !values[0].trim() || !Number.isFinite(Number(values[0])) || Number(values[0]) !== 0; })) hold("NATIVE_MODULE_TRANSFORM", "The native module has a missing, repeated or nonzero transform. Its CAD-to-ROI propagation needs separate evidence; no module transform is invented for the overlay.");
  }
  const sourceToPcb = report?.sourceRegistration?.transform?.matrix, pcbToNative = report?.frame.transform?.matrix;
  if (!rigid(sourceToPcb) || !rigid(pcbToNative)) hold("DIAGNOSIS_TRANSFORM", "Both primary-to-PCB and PCB-to-native transforms must be finite, fixed-scale proper rigid mappings from the existing diagnosis.");
  let cadMatrix: BoardMatrix | null = null;
  if (!holds.length && s && rigid(sourceToPcb) && rigid(pcbToNative)) {
    const scale = s.nativeUnits === "mil" ? 0.0254 : 1, sy = s.nativeYDirection === "down" ? -1 : 1;
    cadMatrix = multiply([[1 / scale, 0, 0], [0, sy / scale, 0]], multiply(pcbToNative, sourceToPcb));
    if (cadMatrix.some(row => !row.every(finite))) { hold("COMPOSED_RANGE", "Composed display coordinates exceed the supported finite range."); cadMatrix = null; }
    Object.assign(provenance, { sourceModule: scope!.module, sourceSide: scope!.side, nativeUnits: s.nativeUnits, nativeYDirection: s.nativeYDirection, interpretation: "Diagnostic display registration only; native runtime, physical alignment and pad ownership remain unqualified." });
  }
  const cad = layer("primary-mm", [...holds], cadMatrix);
  const gh = [...holds], g = input.gerber, alignment = g?.alignment, artwork = g?.result;
  const ghold = (code: string, reason: string) => gh.push({ code, reason });
  if (!artwork || artwork.status !== "success" || !artwork.geometry_complete || !artwork.objects.length) ghold("GERBER_SOURCE", "Complete supported Gerber geometry is required; native coordinates remain available without artwork.");
  const renderHold = gerberDisplayHold(artwork?.geometry_complete ? artwork : null);
  if (renderHold) ghold("GERBER_RENDERING", renderHold);
  if (!alignment || alignment.status !== "success" || alignment.holds.length || !rigid(alignment.transform.matrix) || alignment.transform.scale !== 1 || alignment.transform.mirror !== false || !finite(alignment.toleranceMm) || alignment.toleranceMm <= 0 || !finite(alignment.maxResidualMm) || alignment.maxResidualMm > alignment.toleranceMm || alignment.residuals.filter(r => r.role === "fit").length < 3 || !alignment.residuals.some(r => r.role === "check") || alignment.residuals.some(r => !r.withinTolerance || !finite(r.residualMm) || r.residualMm > alignment.toleranceMm)) ghold("GERBER_ALIGNMENT", "The existing CAD/Gerber registration must pass its fit and independent check at fixed scale without reflection.");
  if (!alignment || !scope || alignment.scope.module !== scope.module || alignment.scope.side !== scope.side || !alignment.scope.boardInstance.trim()) ghold("GERBER_SCOPE", "Gerber registration must identify this exact primary module, side and an explicit board instance.");
  let basisMatches = false;
  if (g?.basis && alignment?.basis === g.basis && p && artwork) {
    try {
      const expected = { placementHash: p.sourceSha256, normalizedHash: p.interpretationSha256, normalizer: p.normalizerVersion, delimiter: p.delimiter, frame: p.coordinateFrame, schema: p.schemaVersion, sheet: p.sheetIndex, mapping: p.mapping, gerberHash: artwork.source_sha256, format: artwork.coordinate_format, overrides: artwork.interpretation_overrides, parser: artwork.adapter_version };
      basisMatches = equal(JSON.parse(g.basis), expected);
    } catch { /* Invalid or stale interpretation evidence holds only this layer. */ }
  }
  if (!basisMatches) ghold("GERBER_BASIS", "Gerber alignment is not bound to these exact placement/Gerber bytes and parser interpretations.");
  const gerberMatrix = !gh.length && cadMatrix && alignment ? multiply(cadMatrix, inverseRigid(alignment.transform.matrix)) : null;
  if (gerberMatrix?.some(row => !row.every(finite))) ghold("COMPOSED_RANGE", "Composed Gerber display coordinates exceed the supported finite range.");
  return { cad, gerber: layer("gerber-mm", gh, gerberMatrix, { gerberSha256: artwork?.source_sha256 ?? "", alignmentFingerprint: alignment?.fingerprint ?? "", boardInstance: alignment?.scope.boardInstance ?? "" }) };
}
