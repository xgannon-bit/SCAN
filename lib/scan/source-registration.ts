/** Source-origin registration only. No native/inspection/image coordinate writer. */
export type RegistrationPoint = { reference: string; identity: string; module: string; side: string; x: number; y: number; rotation: number | null; holds: string[] };
export type RegistrationSource = { id: string; label: string; sha256: string; interpretation: string; frame: string; inputUnits: string; normalizedUnits: "mm" | "unqualified-native"; revisionHint: string; points: RegistrationPoint[] };
export type SourceRegistrationSession = {
  schemaVersion: "1"; sourceId: string; targetId: string; sourceScope: string; targetScope: string;
  sourceRevision: string; targetRevision: string; sourceSide: string; targetSide: string; frameEvidence: string; framesConfirmed: boolean;
  fitReferences: string[]; checkReferences: string[]; toleranceMm: string;
  decision: { digest: string; choice: "accepted" | "rejected"; reviewer: string; reason: string } | null;
};
export const emptySourceRegistration = (): SourceRegistrationSession => ({ schemaVersion: "1", sourceId: "", targetId: "", sourceScope: "", targetScope: "", sourceRevision: "", targetRevision: "", sourceSide: "", targetSide: "", frameEvidence: "", framesConfirmed: false, fitReferences: [], checkReferences: [], toleranceMm: "0.05", decision: null });
const fields = Object.keys(emptySourceRegistration());
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max && !v.includes("\0");
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function validateSourceRegistrationSession(value: unknown): SourceRegistrationSession {
  if (!exact(value, fields) || value.schemaVersion !== "1" || typeof value.framesConfirmed !== "boolean") throw new Error("Invalid source registration review.");
  for (const k of ["sourceId", "targetId", "sourceScope", "targetScope", "sourceRevision", "targetRevision", "sourceSide", "targetSide", "toleranceMm"] as const) if (!text(value[k], 512)) throw new Error("Invalid registration frame metadata.");
  if (!text(value.frameEvidence, 3000)) throw new Error("Invalid registration evidence.");
  for (const k of ["fitReferences", "checkReferences"] as const) if (!Array.isArray(value[k]) || value[k].length > 32 || value[k].some(v => !text(v, 128) || !v.trim()) || new Set(value[k]).size !== value[k].length) throw new Error("Invalid registration reference selection.");
  if (value.decision !== null) {
    const d = value.decision;
    if (!exact(d, ["digest", "choice", "reviewer", "reason"]) || !text(d.digest, 64) || !/^[a-f0-9]{64}$/.test(d.digest) || !["accepted", "rejected"].includes(String(d.choice)) || !text(d.reviewer, 256) || !d.reviewer.trim() || !text(d.reason, 3000) || !d.reason.trim()) throw new Error("Invalid registration decision.");
  }
  return value as SourceRegistrationSession;
}
export const registrationScope = (p: { module: string; side: string }) => JSON.stringify([p.module, p.side]);
export const registrationReference = (ref: string) => ref.trim().toUpperCase();
export function revisionHint(name: string) { const match = name.match(/(?:REV(?:ISION)?[ _.-]*|_V)(\d+)/i)?.[1]; return match ? String(Number(match)) : ""; }
const finite = (x: number) => Number.isFinite(x) && Math.abs(x) <= 1e7;
function group(points: RegistrationPoint[], scope: string) {
  const groups = new Map<string, RegistrationPoint[]>();
  for (const p of points.filter(p => registrationScope(p) === scope)) { const key = registrationReference(p.reference), values = groups.get(key) ?? []; values.push(p); groups.set(key, values); }
  return groups;
}
export function registrationPairs(source: RegistrationSource, target: RegistrationSource, draft: SourceRegistrationSession) {
  const a = group(source.points, draft.sourceScope), b = group(target.points, draft.targetScope);
  return [...new Set([...a.keys(), ...b.keys()])].sort().map(reference => {
    const from = a.get(reference) ?? [], to = b.get(reference) ?? [];
    const holds = [...(!from.length || !to.length ? ["Reference missing from one selected scope"] : []), ...(from.length > 1 || to.length > 1 ? ["Duplicate reference in selected scope: explicit identity resolution required"] : [])];
    if (from.length === 1 && to.length === 1) {
      holds.push(...from[0].holds, ...to[0].holds);
      if (![from[0].x, from[0].y, to[0].x, to[0].y].every(finite)) holds.push("Missing or unsupported coordinate");
    }
    return { reference, from: from.length === 1 ? from[0] : null, to: to.length === 1 ? to[0] : null, holds };
  });
}
export type RigidTransform = { angleDegrees: number; matrix: [[number, number, number], [number, number, number]]; scale: 1; mirror: false };
export const transformPoint = (p: { x: number; y: number }, transform: RigidTransform) => ({ x: transform.matrix[0][0] * p.x + transform.matrix[0][1] * p.y + transform.matrix[0][2], y: transform.matrix[1][0] * p.x + transform.matrix[1][1] * p.y + transform.matrix[1][2] });
function noncollinear(points: { x: number; y: number }[]) {
  let xx = 0, yy = 0, xy = 0; const cx = points.reduce((n, p) => n + p.x, 0) / points.length, cy = points.reduce((n, p) => n + p.y, 0) / points.length;
  for (const p of points) { const x = p.x - cx, y = p.y - cy; xx += x * x; yy += y * y; xy += x * y; }
  return xx + yy > 1e-12 && (xx * yy - xy * xy) / (xx + yy) ** 2 > 1e-6;
}
export function sourceRegistrationAnalysis(source: RegistrationSource, target: RegistrationSource, draft: SourceRegistrationSession) {
  validateSourceRegistrationSession(draft);
  const holds: string[] = [], pairs = registrationPairs(source, target, draft), selected = [...draft.fitReferences, ...draft.checkReferences];
  if (source.id === target.id || (source.sha256 === target.sha256 && source.interpretation === target.interpretation)) holds.push("Choose distinct source interpretations for comparison");
  if (source.points.length > 10000 || target.points.length > 10000) throw new Error("Registration source exceeds 10,000 points.");
  if (!draft.sourceScope || !draft.targetScope) holds.push("Select a module/side scope in each source");
  const scopedA = source.points.filter(p => registrationScope(p) === draft.sourceScope), scopedB = target.points.filter(p => registrationScope(p) === draft.targetScope);
  if (!scopedA.length || !scopedB.length) holds.push("A selected scope is missing from the fresh source");
  if (!draft.framesConfirmed || !draft.frameEvidence.trim()) holds.push("Confirm units, side, handedness and the same physical origin convention in the selected references");
  const aRevision = draft.sourceRevision.trim(), bRevision = draft.targetRevision.trim();
  if (!aRevision || !bRevision) holds.push("Record both source revisions before accepting registration");
  else if (aRevision !== bRevision) holds.push("Different source revisions: diagnostic comparison only; no coordinate correction");
  if ((source.revisionHint && source.revisionHint !== aRevision) || (target.revisionHint && target.revisionHint !== bRevision)) holds.push("Reviewed revision differs from the source filename revision hint; resolve source selection before correction");
  if (source.normalizedUnits !== "mm" || target.normalizedUnits !== "mm") holds.push("Native coordinate units/semantics are unqualified: numeric hypothesis only; source correction held");
  const reviewedSideA = draft.sourceSide.toLowerCase(), reviewedSideB = draft.targetSide.toLowerCase();
  if (!["top", "bottom"].includes(reviewedSideA) || !["top", "bottom"].includes(reviewedSideB)) holds.push("Record the physical board side for each source; null layout side is not proof of top");
  if (scopedA.some(p => ["top", "bottom"].includes(p.side.toLowerCase()) && p.side.toLowerCase() !== reviewedSideA) || scopedB.some(p => ["top", "bottom"].includes(p.side.toLowerCase()) && p.side.toLowerCase() !== reviewedSideB)) holds.push("Reviewed side contradicts the parsed source side; correct source interpretation first");
  if (reviewedSideA !== reviewedSideB) holds.push("Different board sides require an independently established side/mirror contract");
  const tolerance = Number(draft.toleranceMm);
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 1) holds.push("Residual threshold must be greater than zero and at most 1 mm");
  if (draft.fitReferences.length < 3 || draft.checkReferences.length < 1 || selected.length > 32) holds.push("Choose at least three noncollinear fit references and one independent check reference (32 total maximum)");
  if (new Set(selected).size !== selected.length) holds.push("Fit and independent check references must be disjoint");
  const control = selected.map(ref => pairs.find(p => p.reference === ref));
  if (control.some(p => !p || p.holds.length)) holds.push("Selected reference is missing, duplicated or has unresolved source geometry");
  let transform: RigidTransform | null = null;
  const geometryReady = draft.fitReferences.length >= 3 && draft.checkReferences.length >= 1 && selected.length <= 32 && new Set(selected).size === selected.length && control.every(p => p && !p.holds.length);
  if (geometryReady) {
    const fit = control.slice(0, draft.fitReferences.length).map(p => p!);
    const a = fit.map(p => p.from!), b = fit.map(p => p.to!);
    let unique = true;
    for (const key of ["from", "to"] as const) for (let i = 0; i < control.length; i++) for (let j = 0; j < i; j++) if (Math.hypot(control[i]![key]!.x - control[j]![key]!.x, control[i]![key]!.y - control[j]![key]!.y) < 1e-6) unique = false;
    if (!unique) holds.push("Fit/check references must identify distinct physical origins");
    if (!noncollinear(a) || !noncollinear(b)) holds.push("Fit geometry is collinear or nearly collinear");
    else if (unique) {
      const mean = (ps: RegistrationPoint[], k: "x" | "y") => ps.reduce((n, p) => n + p[k], 0) / ps.length;
      const ax = mean(a, "x"), ay = mean(a, "y"), bx = mean(b, "x"), by = mean(b, "y");
      let h00 = 0, h01 = 0, h10 = 0, h11 = 0;
      for (let i = 0; i < a.length; i++) { h00 += (a[i].x - ax) * (b[i].x - bx); h01 += (a[i].x - ax) * (b[i].y - by); h10 += (a[i].y - ay) * (b[i].x - bx); h11 += (a[i].y - ay) * (b[i].y - by); }
      if (h00 * h11 - h01 * h10 <= 0) holds.push("Correspondences require reflection or inconsistent handedness; no fitted mirror is permitted");
      else {
        const angle = Math.atan2(h01 - h10, h00 + h11), c = Math.cos(angle), s = Math.sin(angle);
        transform = { angleDegrees: angle * 180 / Math.PI, scale: 1, mirror: false, matrix: [[c, -s, bx - c * ax + s * ay], [s, c, by - s * ax - c * ay]] };
        let distanceMismatch = false;
        for (let i = 0; i < a.length; i++) for (let j = 0; j < i; j++) if (Math.abs(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y) - Math.hypot(b[i].x - b[j].x, b[i].y - b[j].y)) > 2 * tolerance) distanceMismatch = true;
        if (distanceMismatch) holds.push("Fit distances disagree at fixed scale: check units, origin conventions or a local discrepancy; no scale fitting permitted");
      }
    }
  }
  const residuals = pairs.filter(p => p.from && p.to && !p.holds.length).map(p => {
    const after = transform ? transformPoint(p.from!, transform) : null;
    return { ...p, role: draft.fitReferences.includes(p.reference) ? "fit" : draft.checkReferences.includes(p.reference) ? "check" : "unselected", beforeResidual: Math.hypot(p.from!.x - p.to!.x, p.from!.y - p.to!.y), after, residual: after ? Math.hypot(after.x - p.to!.x, after.y - p.to!.y) : null };
  });
  const controls = residuals.filter(p => p.role !== "unselected");
  if (transform && controls.some(p => p.residual! > tolerance)) holds.push("A fit or independent check residual exceeds the reviewed threshold; hold the transform");
  const scopeHolds = pairs.filter(p => p.holds.length);
  if (scopeHolds.length) holds.push("Selected scopes contain unmatched, duplicate or ambiguous references: comparison retained, whole-scope coordinate export held");
  const outside = residuals.filter(p => p.residual !== null && p.residual > tolerance && p.role === "unselected");
  if (outside.length) holds.push("Unselected references have local residuals above threshold: resolve component origins/revisions before whole-scope correction");
  return { artifactType: "scan.reviewed-source-registration" as const, schemaVersion: "1" as const, status: holds.length || !transform ? "held" as const : "reviewable" as const,
    source: { id: source.id, sha256: source.sha256, interpretation: source.interpretation, frame: source.frame, inputUnits: source.inputUnits, revision: aRevision, scope: draft.sourceScope, reviewedSide: reviewedSideA },
    target: { id: target.id, sha256: target.sha256, interpretation: target.interpretation, frame: target.frame, inputUnits: target.inputUnits, revision: bRevision, scope: draft.targetScope, reviewedSide: reviewedSideB },
    transform, residuals, scopeHolds, holds: [...new Set(holds)], toleranceMm: tolerance,
    classification: "Registration tests a shared origin/rotation hypothesis. Residuals alone do not prove wrong CAD, body origin, placement ROI or inspection windows.",
    machineQualified: false, nativeEditsApplied: false, imageOverlayQualified: false };
}
export async function registrationDigest(source: RegistrationSource, target: RegistrationSource, draft: SourceRegistrationSession) {
  const { decision: _decision, ...settings } = draft;
  const input = JSON.stringify({ analyzer: "reviewed-source-registration-1", source, target, settings });
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))), b => b.toString(16).padStart(2, "0")).join("");
}
export async function buildCorrectedSourcePlacement(source: RegistrationSource, target: RegistrationSource, draft: SourceRegistrationSession) {
  const report = sourceRegistrationAnalysis(source, target, draft), digest = await registrationDigest(source, target, draft);
  if (report.status !== "reviewable" || !report.transform || draft.decision?.digest !== digest || draft.decision.choice !== "accepted") throw new Error("Current exact source registration must pass and be accepted before deriving coordinates.");
  const placements = source.points.filter(p => registrationScope(p) === draft.sourceScope).map(p => ({ reference: p.reference, sourceIdentity: p.identity, sourceScope: registrationScope(p), targetScope: draft.targetScope, before: { x: p.x, y: p.y, rotation: p.rotation }, ...transformPoint(p, report.transform!), rotationCcwDegrees: p.rotation === null ? null : ((p.rotation + report.transform!.angleDegrees) % 360 + 360) % 360 }));
  return { artifactType: "scan.corrected-source-placement" as const, schemaVersion: "1", units: "mm", coordinateFrame: target.frame, source: report.source, target: report.target, decision: draft.decision, reviewDigest: digest, transform: report.transform, placements,
    purpose: "AOI-only source derivative in the reviewed target frame; original inputs unchanged. Not an Eagle import profile or native job.", nativeEditsApplied: false, machineExportAllowed: false };
}
