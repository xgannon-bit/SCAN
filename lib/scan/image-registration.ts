import type { VisualEntity } from "./visual-workspace";
import type { SnapshotPreflight } from "./archive-types";
import { assetRole } from "./image-evidence";

export type PixelImage = { member: string; sha256: string; width: number; height: number };
export type ImageControl = { id: string; role: "fit" | "check"; identity: { module: string; ref: string; id: string; master: string; path: string } | null; native: [number, number] | null; beforeRoi: Record<"cx" | "cy" | "w" | "h" | "a", string | null> | null; pixel: [number, number] | null; evidence: string };
export type ImageRegistrationRequest = {
  artifactType: "scan.image-registration-request"; schemaVersion: "1";
  source: { archiveSha256: string; packageSha256: string; root: string; jobMember: string; jobRole: string; jobSha256: string; masterMember: string | null; masterRole: string | null; masterSha256: string | null; nativeVersion: string };
  image: PixelImage;
  scope: { module: string; physicalSide: "unknown" | "top" | "bottom"; instance: string; nativeRevision: string; imageRevision: string };
  conventions: { module: string; physicalSide: "unknown" | "top" | "bottom"; instance: string; unit: "unknown" | "mm" | "in"; yDirection: "unknown" | "up" | "down"; roiAngle: "unknown" | "clockwise" | "counterclockwise"; anchor: "native-roi-center"; distortion: "unknown" | "uniform-similarity"; evidence: string };
  nativeBounds: [number, number, number, number] | null; points: ImageControl[];
  tolerancePx: number; toleranceEvidence: string; scopeEvidence: string; reviewer: string;
};
export type ImageMappingReview = { version: 1; requestSha256: string; source: ImageRegistrationRequest["source"]; image: PixelImage; reviewer: string; reviewedAt: string };
export type ImageRegistrationState = { version: 1; request: ImageRegistrationRequest; decision: "unreviewed" | "reviewed"; draftPixels?: Record<string, [string, string]>; review?: ImageMappingReview | null; reviewHold?: "legacy-unbound" | "changed-request" };
export type ImageRegistrationFit = { status: "success" | "blocked"; artifactType: "scan.image-registration-fit"; schemaVersion: "1"; fingerprint: string; matrix: number[][]; scalePixelsPerNativeUnit: number; pixelsPerMm: number; handedness: 1 | -1; residuals: { id: string; role: "fit" | "check"; predictedPx: [number, number]; residualPx: number; withinTolerance: boolean }[]; maxResidualPx: number; holds: string[]; qualification: string; machineExportAllowed: false };
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, n = 2048) => typeof v === "string" && v.length <= n && !v.includes("\0");
const exact = (v: object, keys: string[]) => !!v && typeof v === "object" && Object.keys(v).sort().join() === [...keys].sort().join();
const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e9;
const point = (p: unknown) => p === null || (Array.isArray(p) && p.length === 2 && p.every(finite));
const scalar = (r: SnapshotPreflight["nativeRecords"][string]["records"][number], k: string) => r.rawFields[k]?.length === 1 ? r.rawFields[k][0] : null;
const numeric = (s: string | null) => s !== null && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s.trim()) && finite(Number(s)) ? Number(s) : null;
export const canonicalImageRequest = (value: unknown): string => JSON.stringify(value, (_, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
export async function imageRequestFingerprint(request: ImageRegistrationRequest) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalImageRequest(request))); return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""); }
/** Independent axis drafts cannot manufacture a measured zero. */
export function imagePixelDraft(state: ImageRegistrationState, id: string): [string, string] {
  const p = state.request.points.find(p => p.id === id);
  return state.draftPixels?.[id] ?? (p?.pixel ? [String(p.pixel[0]), String(p.pixel[1])] : ["", ""]);
}
function measuredDraft(v: [string, string]): [number, number] | null {
  const p = v.map(x => numeric(x)); return p.every(n => n !== null) ? p as [number, number] : null;
}
export function invalidateImageReview(state: ImageRegistrationState, request = state.request): ImageRegistrationState {
  return { ...state, request, decision: "unreviewed", ...(state.review || state.decision === "reviewed" ? { reviewHold: "changed-request" as const } : {}) };
}
export function editImagePixel(state: ImageRegistrationState, id: string, axis: 0 | 1, value: string): ImageRegistrationState {
  if (!state.request.points.some(p => p.id === id) || !text(value, 64)) throw new Error("Invalid pixel draft.");
  const draft = [...imagePixelDraft(state, id)] as [string, string]; draft[axis] = value;
  return { ...invalidateImageReview(state, { ...state.request, points: state.request.points.map(p => p.id === id ? { ...p, pixel: measuredDraft(draft) } : p) }), draftPixels: { ...state.draftPixels, [id]: draft } };
}
export function pickImagePixel(state: ImageRegistrationState, id: string, pixel: [number, number]): ImageRegistrationState {
  if (!pixel.every(finite)) throw new Error("Invalid measured image point.");
  return editImagePixel(editImagePixel(state, id, 0, String(pixel[0])), id, 1, String(pixel[1]));
}
export function makeImageReview(request: ImageRegistrationRequest, requestSha256: string): ImageMappingReview {
  if (!hash(requestSha256)) throw new Error("Missing reviewed request identity.");
  return { version: 1, requestSha256, source: { ...request.source }, image: { ...request.image }, reviewer: request.reviewer, reviewedAt: new Date().toISOString() };
}
export function acceptImageReview(state: ImageRegistrationState, fingerprint: string): ImageRegistrationState {
  const { reviewHold: _hold, ...rest } = state;
  return { ...rest, decision: "reviewed", review: makeImageReview(state.request, fingerprint) };
}
/** Integrity annotation, not authenticated approval or machine qualification. */
export function imageReviewHolds(state: ImageRegistrationState, fingerprint: string): string[] {
  if (state.decision !== "reviewed") return [state.reviewHold === "legacy-unbound" ? "Legacy reviewed flag has no bound request identity; retain evidence and explicitly review again." : state.reviewHold === "changed-request" ? "Previous review invalidated: request/evidence or source identity changed." : "This exact image request has not been reviewed."];
  const v = state.review;
  if (!v) return ["Saved reviewed flag lacks a bound request identity; explicit review required."];
  if (v.requestSha256 !== fingerprint || canonicalImageRequest(v.source) !== canonicalImageRequest(state.request.source) || canonicalImageRequest(v.image) !== canonicalImageRequest(state.request.image) || v.reviewer !== state.request.reviewer) return ["Previous review invalidated: request/evidence or source identity changed."];
  return [];
}
export function validateImageRegistrationState(value: unknown): ImageRegistrationState {
  const v = value as ImageRegistrationState;
  if (!exact(v, ["version", "request", "decision", ...(v?.draftPixels === undefined ? [] : ["draftPixels"]), ...(v?.review === undefined ? [] : ["review"]), ...(v?.reviewHold === undefined ? [] : ["reviewHold"])]) || v.version !== 1 || !["unreviewed", "reviewed"].includes(v.decision) || (v.reviewHold !== undefined && !["legacy-unbound", "changed-request"].includes(v.reviewHold))) throw new Error("Invalid image registration state.");
  validateImageRegistrationRequest(v.request);
  if (v.draftPixels !== undefined) {
    if (!v.draftPixels || typeof v.draftPixels !== "object" || Array.isArray(v.draftPixels) || Object.keys(v.draftPixels).length > 16) throw new Error("Invalid pixel drafts.");
    for (const [id, draft] of Object.entries(v.draftPixels)) {
      const p = v.request.points.find(p => p.id === id);
      if (!p || !Array.isArray(draft) || draft.length !== 2 || !draft.every(x => text(x, 64)) || canonicalImageRequest(measuredDraft(draft)) !== canonicalImageRequest(p.pixel)) throw new Error("Pixel draft differs from explicitly measured axes.");
    }
  }
  if (v.review != null) {
    const r = v.review;
    if (!exact(r, ["version", "requestSha256", "source", "image", "reviewer", "reviewedAt"]) || r.version !== 1 || !hash(r.requestSha256) || !text(r.reviewer, 256) || !text(r.reviewedAt, 32) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.reviewedAt) || !Number.isFinite(Date.parse(r.reviewedAt))) throw new Error("Invalid saved review identity.");
    validateImageRegistrationRequest({ ...v.request, source: r.source, image: r.image });
  }
  if (v.decision === "reviewed" && !v.review) return { ...v, decision: "unreviewed", reviewHold: "legacy-unbound" };
  if (v.decision === "reviewed" && v.review && (canonicalImageRequest(v.review.source) !== canonicalImageRequest(v.request.source) || canonicalImageRequest(v.review.image) !== canonicalImageRequest(v.request.image) || v.review.reviewer !== v.request.reviewer)) return { ...v, decision: "unreviewed", reviewHold: "changed-request" };
  return v;
}
export function validateImageRegistrationRequest(value: unknown): ImageRegistrationRequest {
  const r = value as ImageRegistrationRequest, fail = () => { throw new Error("Invalid image registration evidence."); };
  if (!r || JSON.stringify(r).length > 60000 || !exact(r, ["artifactType", "schemaVersion", "source", "image", "scope", "conventions", "nativeBounds", "points", "tolerancePx", "toleranceEvidence", "scopeEvidence", "reviewer"]) || r.artifactType !== "scan.image-registration-request" || r.schemaVersion !== "1") return fail();
  const s = r.source;
  if (!exact(s, ["archiveSha256", "packageSha256", "root", "jobMember", "jobRole", "jobSha256", "masterMember", "masterRole", "masterSha256", "nativeVersion"]) || ![s.archiveSha256, s.packageSha256, s.jobSha256].every(hash) || !text(s.root) || !text(s.jobMember) || !["main", "temp", "backup"].includes(s.jobRole) || !["10.1", "10.2"].includes(s.nativeVersion) || (s.masterMember !== null && !text(s.masterMember)) || (s.masterSha256 !== null && !hash(s.masterSha256)) || (s.masterRole !== null && !["main", "temp", "backup"].includes(s.masterRole))) return fail();
  if (!exact(r.image, ["member", "sha256", "width", "height"]) || !text(r.image.member) || !hash(r.image.sha256) || ![r.image.width, r.image.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 40000) || r.image.width * r.image.height > 80_000_000) return fail();
  if (!exact(r.scope, ["module", "physicalSide", "instance", "nativeRevision", "imageRevision"]) || !Object.values(r.scope).every(v => text(v, 256)) || !["unknown", "top", "bottom"].includes(r.scope.physicalSide)) return fail();
  const c = r.conventions;
  if (!exact(c, ["module", "physicalSide", "instance", "unit", "yDirection", "roiAngle", "anchor", "distortion", "evidence"]) || ![c.module, c.instance].every(v => text(v, 256)) || !["unknown", "top", "bottom"].includes(c.physicalSide) || !["unknown", "mm", "in"].includes(c.unit) || !["unknown", "up", "down"].includes(c.yDirection) || !["unknown", "clockwise", "counterclockwise"].includes(c.roiAngle) || c.anchor !== "native-roi-center" || !["unknown", "uniform-similarity"].includes(c.distortion) || !text(c.evidence)) return fail();
  if (r.nativeBounds !== null && (!Array.isArray(r.nativeBounds) || r.nativeBounds.length !== 4 || !r.nativeBounds.every(finite))) return fail();
  if (!Array.isArray(r.points) || r.points.length < 4 || r.points.length > 16 || new Set(r.points.map(p => p.id)).size !== r.points.length || !finite(r.tolerancePx) || r.tolerancePx < .01 || r.tolerancePx > 25 || ![r.toleranceEvidence, r.scopeEvidence].every(v => text(v)) || !text(r.reviewer, 256)) return fail();
  for (const p of r.points) if (!exact(p, ["id", "role", "identity", "native", "beforeRoi", "pixel", "evidence"]) || !text(p.id, 128) || !p.id || !["fit", "check"].includes(p.role) || !point(p.native) || !point(p.pixel) || !text(p.evidence, 512) || (p.identity !== null && (!exact(p.identity, ["module", "ref", "id", "master", "path"]) || !Object.values(p.identity).every(v => text(v)))) || (p.beforeRoi !== null && (!exact(p.beforeRoi, ["cx", "cy", "w", "h", "a"]) || !Object.values(p.beforeRoi).every(v => v === null || text(v))))) return fail();
  return r;
}
function sourceBasis(p: SnapshotPreflight): ImageRegistrationRequest["source"] { return { archiveSha256: p.source.sha256, packageSha256: p.packageSha256, root: p.selection.root, jobMember: p.selection.job.member, jobRole: p.selection.job.role, jobSha256: p.selection.job.sha256, masterMember: p.selection.master?.member ?? null, masterRole: p.selection.master?.role ?? null, masterSha256: p.selection.master?.sha256 ?? null, nativeVersion: p.nativeRecords.job?.schemaVersionClaim ?? "" }; }
export function nativeImageBounds(p: SnapshotPreflight, module: string): ImageRegistrationRequest["nativeBounds"] {
  const points = p.nativeRecords.job?.records.filter(r => r.kind === "part-record" && scalar(r, "ParentId") === module).map(r => [numeric(scalar(r, "Roi/cx")), numeric(scalar(r, "Roi/cy"))]).filter((v): v is number[] => v.every(n => n !== null)) ?? [];
  return points.length ? [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] : null;
}
export function newImageRegistration(p: SnapshotPreflight, image: PixelImage): ImageRegistrationState {
  return { version: 1, decision: "unreviewed", request: { artifactType: "scan.image-registration-request", schemaVersion: "1", source: sourceBasis(p), image: { member: image.member, sha256: image.sha256, width: image.width, height: image.height }, scope: { module: "", physicalSide: "unknown", instance: "", nativeRevision: "", imageRevision: "" }, conventions: { module: "", physicalSide: "unknown", instance: "", unit: "unknown", yDirection: "unknown", roiAngle: "unknown", anchor: "native-roi-center", distortion: "unknown", evidence: "" }, nativeBounds: null, points: Array.from({ length: 4 }, (_, i) => ({ id: `control-${i + 1}`, role: i === 3 ? "check" : "fit", identity: null, native: null, beforeRoi: null, pixel: null, evidence: "" })), tolerancePx: 1, toleranceEvidence: "", scopeEvidence: "", reviewer: "" } };
}
export function nativeImageControl(p: SnapshotPreflight, path: string, old: ImageControl): ImageControl {
  const matches = p.nativeRecords.job.records.filter(r => r.kind === "part-record" && r.sourcePath === path);
  if (matches.length !== 1) return { ...old, identity: null, native: null, beforeRoi: null };
  const r = matches[0], x = numeric(scalar(r, "Roi/cx")), y = numeric(scalar(r, "Roi/cy"));
  return { ...old, identity: { module: scalar(r, "ParentId") ?? "", ref: scalar(r, "RefID") ?? "", id: scalar(r, "ID") ?? "", master: scalar(r, "MasterKey") ?? "", path }, native: x === null || y === null ? null : [x, y], beforeRoi: Object.fromEntries(["cx", "cy", "w", "h", "a"].map(k => [k, scalar(r, `Roi/${k}`)])) as ImageControl["beforeRoi"] };
}
/** Current native records and decoded image independently bind every saved control. */
export function imageRegistrationHolds(r: ImageRegistrationRequest | undefined, p: SnapshotPreflight | undefined, image: PixelImage | null, candidateView = false): string[] {
  if (!r || !p || !image) return ["Select and verify the exact original board image before registration."];
  const holds: string[] = [];
  if (candidateView) holds.push("Candidate photo mapping is held: separately bound frame-equivalence evidence is required.");
  if (p.integrity?.allArchivedFilesVerified !== true || p.nativeRecords.job?.readerProfile !== `jobcontainer-${p.nativeRecords.job?.schemaVersionClaim}-observed-readonly-1` || canonicalImageRequest(r.source) !== canonicalImageRequest(sourceBasis(p))) holds.push("Native source/snapshot/schema changed; saved mapping is stale.");
  if (canonicalImageRequest(r.image) !== canonicalImageRequest({ member: image.member, sha256: image.sha256, width: image.width, height: image.height }) || assetRole(image.member, p.selection) !== "board-candidate" || p.preservedFiles.filter(f => f.originalName === image.member && f.sha256 === image.sha256).length !== 1) holds.push("Image member/hash/dimensions or board-photo role is incompatible.");
  if (canonicalImageRequest(r.nativeBounds) !== canonicalImageRequest(nativeImageBounds(p, r.scope.module))) holds.push("Native module extent changed or was not selected.");
  for (const point of r.points) {
    if (!point.identity || !point.native || !point.beforeRoi) { holds.push(`${point.id}: exact native feature is missing.`); continue; }
    const matches = p.nativeRecords.job.records.filter(record => record.kind === "part-record" && ["ParentId", "RefID", "ID", "MasterKey"].every((k, i) => scalar(record, k) === [point.identity!.module, point.identity!.ref, point.identity!.id, point.identity!.master][i]));
    if (matches.length !== 1 || matches[0].sourcePath !== point.identity.path || point.identity.module !== r.scope.module || canonicalImageRequest(nativeImageControl(p, point.identity.path, point)) !== canonicalImageRequest(point)) holds.push(`${point.id}: stable native identity or original ROI values changed.`);
  }
  return holds;
}
export function isPixelSimilarityMatrix(m: unknown, handedness: 1 | -1): m is number[][] {
  if (!Array.isArray(m) || m.length !== 2 || m.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(finite))) return false;
  const [[a, b], [c, d]] = m, scale = Math.hypot(a, c);
  return scale >= 1e-6 && scale <= 1e6 && Math.abs(Math.hypot(b, d) / scale - 1) <= 1e-8 && Math.abs((a*b+c*d)/(scale*scale)) <= 1e-8 && Math.abs((a*d-b*c)/(scale*scale)-handedness) <= 1e-8;
}
export const imagePoint = (m: number[][], x: number, y: number) => ({ x: m[0][0]*x+m[0][1]*y+m[0][2], y: m[1][0]*x+m[1][1]*y+m[1][2] });
export function checkedImageFit(value: unknown, r: ImageRegistrationRequest, fingerprint: string): ImageRegistrationFit {
  const fit = value as ImageRegistrationFit, sign = r.conventions.yDirection === "up" ? -1 : 1;
  if (!fit || fit.artifactType !== "scan.image-registration-fit" || fit.schemaVersion !== "1" || !["success", "blocked"].includes(fit.status) || fit.fingerprint !== fingerprint || fit.machineExportAllowed !== false || fit.handedness !== sign || !isPixelSimilarityMatrix(fit.matrix, sign) || !finite(fit.scalePixelsPerNativeUnit) || Math.abs(Math.hypot(fit.matrix[0][0], fit.matrix[1][0]) / fit.scalePixelsPerNativeUnit - 1) > 1e-8 || !finite(fit.pixelsPerMm) || Math.abs(fit.pixelsPerMm / (fit.scalePixelsPerNativeUnit/(r.conventions.unit === "in" ? 25.4 : 1))-1) > 1e-8 || !Array.isArray(fit.residuals) || fit.residuals.length !== r.points.length || !Array.isArray(fit.holds) || fit.holds.some(h => !text(h)) || !text(fit.qualification)) throw new Error("Image-fit response differs from exact request or similarity contract.");
  const observed = r.points.map(p => { const v = imagePoint(fit.matrix, ...p.native!); return Math.hypot(v.x-p.pixel![0], v.y-p.pixel![1]); });
  if (fit.residuals.some((v, i) => v.id !== r.points[i].id || v.role !== r.points[i].role || !point(v.predictedPx) || v.predictedPx === null || !finite(v.residualPx) || Math.abs(observed[i] - v.residualPx) > 1e-6 || Math.hypot(v.predictedPx[0]-imagePoint(fit.matrix,...r.points[i].native!).x,v.predictedPx[1]-imagePoint(fit.matrix,...r.points[i].native!).y)>1e-6 || v.withinTolerance !== (v.residualPx <= r.tolerancePx)) || !finite(fit.maxResidualPx) || Math.abs(Math.max(...observed)-fit.maxResidualPx)>1e-6 || (fit.status === "success" && (fit.holds.length || fit.residuals.some(v => !v.withinTolerance)))) throw new Error("Fit/check residuals do not independently reproduce.");
  return fit;
}

export function photoRoi(e: VisualEntity, r: ImageRegistrationRequest, matrix: number[][]): string | null {
  if (!e.width || !e.height || e.width <= 0 || e.height <= 0 || !Number.isFinite(e.angle)) return null;
  const sign = (r.conventions.yDirection === "down") === (r.conventions.roiAngle === "clockwise") ? 1 : -1;
  const angle = e.angle! * Math.PI / 180 * sign, cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => { const dx = x*e.width!/2, dy = y*e.height!/2; const p = imagePoint(matrix,e.x+dx*cos-dy*sin,e.y+dx*sin+dy*cos); return `${p.x},${p.y}`; }).join(" ");
}
