import { validGeometry, type ComponentGeometry } from "./processing-event";
import type { PlacementResult } from "./placement-types";
import type { SnapshotPreflight } from "./archive-types";
import type { RepairProposal, RepairRequest, RepairSession } from "./repair-session";
import type { ArchiveSelection } from "./archive-types";
import { validateImageRegistrationState, type ImageRegistrationState } from "./image-registration";

export type ViewFrame = "source" | "gerber" | "native" | "image";
export type Camera = { x: number; y: number; width: number; height: number };
export type VisualEntity = { key: string; ref: string; module: string; side: string; x: number; y: number; row?: number; path?: string; id?: string; master?: string; angle?: number; width?: number; height?: number; enabled?: string };
export type VisualEvent = { id: string; run: string; sequence: number; at: string; source: string; stage: string; status: "started" | "progress" | "completed" | "held" | "failed" | "cancelled"; message: string; count: number | null; entity: string | null; geometry?: ComponentGeometry; nativeSource?: { contextHash: string; packageSha256: string; jobMember: string; masterMember: string }; componentPhase?: "analysis-started" | "analysis-checked" | "analysis-held" | "placement-checked" | "preparation-checked"; transportDropped?: number };
export type VisualWorkspaceState = {
  version: 1; authority: "presentation-only";
  nativeSnapshot: "baseline" | "candidate";
  frame: ViewFrame; scope: string; query: string; selected: string;
  cameras: Partial<Record<ViewFrame, Camera>>;
  layers: { labels: boolean; source: boolean; gerber: boolean; original: boolean; proposed: boolean };
  image: { archiveSha256: string; member: string } | null;
  imageRegistration?: ImageRegistrationState;
  imageLayers?: { native: boolean; cad: boolean; gerber: boolean; controls: boolean; processing: boolean; proposals: boolean; dimUnselected: boolean; filter: "all" | "held" | "proposed" | "written"; preset: "clean-board" | "placement-review" | "alignment-analysis" | "component-inspection" | "repair-review" | "visual-rebuild"; cropRadiusMm: number };
  /** Optional image-first presentation state. It never grants a registration. */
  imageDisplay?: { preset: "clean-image" | "native-evidence"; role: "all" | "board-candidate" | "model-reference" | "pattern-model" | "other"; opacity: number; brightness: number; referenceOpen: boolean; note: { archiveSha256: string; member: string; imageSha256: string; x: number; y: number; width: number; height: number; label: string } | null };
  events: VisualEvent[];
  /** Presentation trimming only; absent on legacy projects whose totals are unknown. */
  historyOmitted?: number;
};
export const emptyVisualWorkspace = (): VisualWorkspaceState => ({ version: 1, authority: "presentation-only", nativeSnapshot: "baseline", frame: "source", scope: "", query: "", selected: "", cameras: {}, layers: { labels: true, source: true, gerber: true, original: true, proposed: true }, image: null, events: [], historyOmitted: 0 });
export const scopeKey = (module: string, side: string) => JSON.stringify([module, side]);
/** Resolve overlapping screen hit targets only. Never fits/snaps engineering data. */
export function nearestVisualOrigin(entities: VisualEntity[], point: { x: number; y: number }, radius: number): VisualEntity | undefined {
  let best: VisualEntity | undefined, distance = radius;
  for (const entity of entities) {
    const d = Math.hypot(entity.x - point.x, entity.y - point.y);
    if (d < distance) { best = entity; distance = d; }
  }
  return best;
}
/** Iteration keeps large supported layers below the engine's function-argument limit. */
export function pointBounds(points: readonly { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}
/** Label decluttering is display-only; every source marker and list entry remains selectable. */
export function visibleReferenceLabels(entities: VisualEntity[], marker: number, ySign: number, selected?: string): Set<string> {
  const labels = new Set<string>(), occupied: { x: number; y: number; right: number; bottom: number }[] = [];
  const ordered = [...entities.filter(e => e.key === selected), ...entities.filter(e => e.key !== selected)];
  for (const e of ordered) {
    const box = { x: e.x + marker * 1.6, y: e.y * ySign - marker * 3.5, right: e.x + marker * (2 + e.ref.length * 1.5), bottom: e.y * ySign - marker };
    if (occupied.some(b => box.x < b.right && box.right > b.x && box.y < b.bottom && box.bottom > b.y)) continue;
    occupied.push(box); labels.add(e.key);
  }
  return labels;
}
const number = (value: unknown): number | undefined => typeof value === "string" && value.trim() && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e9 ? Number(value) : undefined;
export function placementEntities(result: PlacementResult | null): VisualEntity[] {
  if (!result) return [];
  return result.placements.flatMap(p => {
    const x = number(p.xMm), y = number(p.yMm); if (x === undefined || y === undefined) return [];
    return [{ key: JSON.stringify([result.sourceSha256, result.interpretationSha256, p.module, p.side, p.placementId, p.sourceRow]), ref: p.refdes, module: p.module, side: p.side, x, y, row: p.sourceRow, angle: number(p.rotationCcwDegrees) }];
  });
}
export function nativeEntities(preflight: SnapshotPreflight | undefined): VisualEntity[] {
  return (preflight?.nativeRecords.job?.records ?? []).flatMap(p => {
    if (p.kind !== "part-record") return [];
    const scalar = (key: string) => p.rawFields[key]?.length === 1 ? p.rawFields[key][0] : "";
    const x = number(scalar("Roi/cx")), y = number(scalar("Roi/cy")); if (x === undefined || y === undefined) return [];
    return [{ key: JSON.stringify([preflight!.source.sha256, preflight!.selection.job.sha256, p.sourcePath, scalar("ParentId"), scalar("ID"), scalar("MasterKey"), scalar("RefID")]), ref: scalar("RefID"), module: scalar("ParentId"), side: "native side unqualified", x, y, path: p.sourcePath, id: scalar("ID"), master: scalar("MasterKey"), width: number(scalar("Roi/w")), height: number(scalar("Roi/h")), angle: number(scalar("Roi/a")), enabled: scalar("ENABLE") }];
  });
}
/** View-only fit. Outliers are identified, never moved or discarded from engineering data. */
export function fitEntities(points: Pick<VisualEntity, "x" | "y">[], includeOutliers = false): { camera: Camera; excluded: number } {
  if (!points.length) return { camera: { x: -10, y: -10, width: 120, height: 100 }, excluded: 0 };
  const quantile = (values: number[], f: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * f)];
  const limits = (axis: "x" | "y") => { const vs = points.map(p => p[axis]), lo = quantile(vs, .25), hi = quantile(vs, .75), span = Math.max(hi - lo, 1); return [lo - span * 4, hi + span * 4]; };
  const [xmin, xmax] = limits("x"), [ymin, ymax] = limits("y");
  const usable = includeOutliers || points.length < 8 ? points : points.filter(p => p.x >= xmin && p.x <= xmax && p.y >= ymin && p.y <= ymax);
  const bounds = pointBounds(usable), x = bounds.minX, y = bounds.minY, width = Math.max(bounds.maxX - x, 5), height = Math.max(bounds.maxY - y, 5), pad = Math.max(width, height) * .12;
  return { camera: { x: x - pad, y: y - pad, width: width + pad * 2, height: height + pad * 2 }, excluded: points.length - usable.length };
}
/** Never use a path alone. All identity and baseline geometry literals must agree. */
export function proposalMatches(entity: VisualEntity, group: RepairProposal[]): boolean {
  return group.length > 0 && group.every(p => p.path.startsWith(`${entity.path}/`) && p.identity.ID === entity.id && p.identity.ParentId === entity.module && p.identity.MasterKey === entity.master && p.identity.RefID === entity.ref && p.beforeRoi && Number(p.beforeRoi.cx) === entity.x && Number(p.beforeRoi.cy) === entity.y);
}
export function previewEntity(entity: VisualEntity, group: RepairProposal[], fraction = 1): VisualEntity | null {
  if (!proposalMatches(entity, group) || group.some(p => !/\/Roi\/(cx|cy)$/.test(p.path) || number(p.after) === undefined)) return null;
  const x = group.find(p => p.path.endsWith("/Roi/cx")), y = group.find(p => p.path.endsWith("/Roi/cy"));
  const t = Math.min(1, Math.max(0, fraction));
  return { ...entity, x: entity.x + ((x ? Number(x.after) : entity.x) - entity.x) * t, y: entity.y + ((y ? Number(y.after) : entity.y) - entity.y) * t };
}
export function repairIsFresh(repair: RepairSession, preflight: SnapshotPreflight | undefined, selection: ArchiveSelection | null, sourceContext: string | null | undefined): boolean {
  const req = repair.request;
  return !!req && req.source.archiveSha256 === preflight?.source.sha256 && req.source.jobSha256 === preflight?.selection.job.sha256 && req.source.jobMember === selection?.jobMember && (!req.source.masterMember || (req.source.masterMember === preflight?.selection.master?.member && req.source.masterSha256 === preflight.selection.master.sha256 && preflight.selection.master.role === "main")) && selection?.jobRole === "main" && !!sourceContext && (!repair.sourceContext || repair.sourceContext === sourceContext);
}
export function decideProposalGroup(request: RepairRequest, group: RepairProposal[], decision: "pending" | "accepted" | "rejected"): RepairRequest {
  const ids = new Set(group.map(p => p.id));
  return { ...request, acceptances: request.acceptances.map(a => ids.has(a.proposalId) ? { ...a, decision } : a) };
}
export function appendVisualEvent(events: VisualEvent[], event: VisualEvent): VisualEvent[] {
  if (events.some(e => e.id === event.id)) return events;
  const run = events.filter(e => e.run === event.run);
  if (run.some(e => e.sequence >= event.sequence || e.source !== event.source || !["started", "progress"].includes(e.status))) return events;
  const next = [...events, event].slice(-500);
  while (JSON.stringify(next).length > 850_000) next.shift();
  return next;
}
/** Count actual count/byte-bound trims without restoring engineering authority. */
export function appendVisualJournal(view: VisualWorkspaceState, event: VisualEvent): VisualWorkspaceState {
  const events = appendVisualEvent(view.events, event);
  if (events === view.events) return view;
  return { ...view, events, ...(view.historyOmitted === undefined ? {} : { historyOmitted: view.historyOmitted + view.events.length + 1 - events.length }) };
}
export function visualHistoryDisclosure(events: VisualEvent[], omitted?: number) {
  const groups = new Map<string, VisualEvent[]>();
  for (const event of events) { const run = groups.get(event.run) ?? []; run.push(event); groups.set(event.run, run); }
  const runs = [...groups].map(([run, items]) => {
    const first = Math.min(...items.map(e => e.sequence)), last = Math.max(...items.map(e => e.sequence));
    const transportDropped = items.findLast(e => e.transportDropped !== undefined)?.transportDropped;
    return { run, first, last, retained: items.length, transportDropped, partial: first > 1 || items.length < last - first + 1 || (transportDropped ?? 0) > 0 };
  });
  return { partial: (omitted ?? 0) > 0 || runs.some(r => r.partial), omitted, legacy: omitted === undefined, runs };
}
export function validateVisualWorkspace(value: unknown): VisualWorkspaceState {
  const fail = () => { throw new Error("Invalid saved visual workspace. View history cannot grant engineering authority."); };
  if (!value || typeof value !== "object" || JSON.stringify(value).length > 1_000_000) return fail();
  const v = value as VisualWorkspaceState;
  const text = (x: unknown, n = 4096) => typeof x === "string" && x.length <= n && !x.includes("\0");
  const exact = (x: object, keys: string[]) => x && Object.keys(x).sort().join() === keys.sort().join();
  if (!exact(v, ["version", "authority", "nativeSnapshot", "frame", "scope", "query", "selected", "cameras", "layers", "image", "events", ...(v.imageRegistration === undefined ? [] : ["imageRegistration"]), ...(v.imageLayers === undefined ? [] : ["imageLayers"]), ...(v.imageDisplay === undefined ? [] : ["imageDisplay"]), ...(v.historyOmitted === undefined ? [] : ["historyOmitted"])]) || (v.historyOmitted !== undefined && (!Number.isSafeInteger(v.historyOmitted) || v.historyOmitted < 0)) || v.version !== 1 || v.authority !== "presentation-only" || !["baseline", "candidate"].includes(v.nativeSnapshot) || !["source", "gerber", "native", "image"].includes(v.frame) || !text(v.scope) || !text(v.query, 256) || !text(v.selected) || !v.cameras || !v.layers) return fail();
  if (!exact(v.layers, ["labels", "source", "gerber", "original", "proposed"]) || Object.values(v.layers).some(b => typeof b !== "boolean")) return fail();
  for (const [frame, camera] of Object.entries(v.cameras)) if (!["source", "gerber", "native", "image"].includes(frame) || !exact(camera, ["x", "y", "width", "height"]) || Object.values(camera).some(n => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e12) || camera.width <= 0 || camera.height <= 0) return fail();
  if (v.image !== null && (!exact(v.image, ["archiveSha256", "member"]) || !/^[a-f0-9]{64}$/.test(v.image.archiveSha256) || !text(v.image.member, 2048))) return fail();
  if (v.imageDisplay !== undefined) {
    const d = v.imageDisplay;
    if (!exact(d, ["preset", "role", "opacity", "brightness", "referenceOpen", "note"]) || !["clean-image", "native-evidence"].includes(d.preset) || !["all", "board-candidate", "model-reference", "pattern-model", "other"].includes(d.role) || typeof d.referenceOpen !== "boolean" || !Number.isFinite(d.opacity) || d.opacity < .1 || d.opacity > 1 || !Number.isFinite(d.brightness) || d.brightness < .5 || d.brightness > 2) return fail();
    const n = d.note;
    if (n !== null && (!exact(n, ["archiveSha256", "member", "imageSha256", "x", "y", "width", "height", "label"]) || !/^[a-f0-9]{64}$/.test(n.archiveSha256) || !/^[a-f0-9]{64}$/.test(n.imageSha256) || !text(n.member, 2048) || !text(n.label, 256) || [n.x, n.y, n.width, n.height].some(x => !Number.isFinite(x) || x < 0 || x > 40000) || n.width <= 0 || n.height <= 0)) return fail();
  }
  if (v.imageRegistration !== undefined) {
    validateImageRegistrationState(v.imageRegistration);
  }
  if (v.imageLayers !== undefined) {
    const l = v.imageLayers;
    if (!exact(l, ["native", "cad", "gerber", "controls", "processing", "proposals", "dimUnselected", "filter", "preset", "cropRadiusMm"]) || [l.native, l.cad, l.gerber, l.controls, l.processing, l.proposals, l.dimUnselected].some(v => typeof v !== "boolean") || !["all", "held", "proposed", "written"].includes(l.filter) || !["clean-board", "placement-review", "alignment-analysis", "component-inspection", "repair-review", "visual-rebuild"].includes(l.preset) || !Number.isFinite(l.cropRadiusMm) || l.cropRadiusMm < .1 || l.cropRadiusMm > 50) return fail();
  }
  if (!Array.isArray(v.events) || v.events.length > 500 || new Set(v.events.map(e => e.id)).size !== v.events.length) return fail();
  for (const e of v.events) if (!e || !exact(e, ["id", "run", "sequence", "at", "source", "stage", "status", "message", "count", "entity", ...(e.geometry === undefined ? [] : ["geometry"]), ...(e.nativeSource === undefined ? [] : ["nativeSource"]), ...(e.componentPhase === undefined ? [] : ["componentPhase"]), ...(e.transportDropped === undefined ? [] : ["transportDropped"])]) || (e.transportDropped !== undefined && (!Number.isSafeInteger(e.transportDropped) || e.transportDropped < 0 || !["completed", "held", "failed", "cancelled"].includes(e.status))) || !text(e.id, 128) || !text(e.run, 128) || !Number.isSafeInteger(e.sequence) || e.sequence < 0 || !text(e.at, 40) || !Number.isFinite(Date.parse(e.at)) || !text(e.source) || !text(e.stage, 128) || !text(e.message, 2000) || !["started", "progress", "completed", "held", "failed", "cancelled"].includes(e.status) || (e.count !== null && (!Number.isSafeInteger(e.count) || e.count < 0)) || (e.entity !== null && !text(e.entity)) || (e.geometry !== undefined && (e.status !== "progress" || !validGeometry(e.geometry)))) return fail();
  for (const e of v.events) {
    if (e.nativeSource !== undefined && (!exact(e.nativeSource, ["contextHash", "packageSha256", "jobMember", "masterMember"]) || !/^[a-f0-9]{64}$/.test(e.nativeSource.packageSha256) || !/^[a-f0-9]{64}$/.test(e.nativeSource.contextHash) || !text(e.nativeSource.jobMember, 2000) || !text(e.nativeSource.masterMember, 2000))) return fail();
    if (e.componentPhase !== undefined && (!e.geometry || !["analysis-started", "analysis-checked", "analysis-held", "placement-checked", "preparation-checked"].includes(e.componentPhase))) return fail();
  }
  return v.imageRegistration ? { ...v, imageRegistration: validateImageRegistrationState(v.imageRegistration) } : v;
}
