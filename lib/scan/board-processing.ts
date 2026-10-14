import type { SnapshotPreflight } from "./archive-types";
import { validGeometry } from "./processing-event";
import type { VisualEntity, VisualEvent } from "./visual-workspace";

const identityKey = (e: { module?: string; ref?: string; id?: string; master?: string }) => JSON.stringify([e.module, e.ref, e.id, e.master]);
export type BoardEntityIndex = ReadonlyMap<string, readonly VisualEntity[]>;
/** Duplicate identities remain arrays so indexing cannot weaken the unique-match guard. */
export function indexBoardEntities(entities: VisualEntity[]): BoardEntityIndex {
  const index = new Map<string, VisualEntity[]>();
  for (const entity of entities) { const key = identityKey(entity), entries = index.get(key) ?? []; entries.push(entity); index.set(key, entries); }
  return index;
}
export function latestVisualRuns(events: VisualEvent[]) {
  const runs = new Map<string, VisualEvent>();
  for (const event of events) if (!runs.has(event.run) || runs.get(event.run)!.sequence < event.sequence) runs.set(event.run, event);
  return runs;
}
export function latestComponentEvent(events: VisualEvent[], source: string | undefined, results: boolean, runs = latestVisualRuns(events)) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.geometry && e.source === source && (results || ["started", "progress"].includes(runs.get(e.run)?.status ?? ""))) return e;
  }
  return null;
}
export function boardProcessingPhases(events: VisualEvent[], event: VisualEvent | null, baseline: SnapshotPreflight | undefined, entities: BoardEntityIndex, contextHash: string | null, live: boolean, replaying = false) {
  const phases = new Map<string, string>();
  if (event) for (const e of events) if (e.run === event.run && e.sequence <= event.sequence) {
    const joined = boardProcessingEvent(e, baseline, entities, contextHash);
    if (joined.entity && e.componentPhase) {
      // The existing analysis worker emits after-values from actual unaccepted
      // scalar proposals. This remains a display preview, never a review decision.
      const proposal = e.componentPhase === "analysis-checked" && e.geometry?.before && (e.geometry.before.x !== e.geometry.after.x || e.geometry.before.y !== e.geometry.after.y);
      phases.set(joined.entity.key, proposal ? "proposal-preview" : !live && !replaying && e.componentPhase === "analysis-started" ? "incomplete-event" : e.componentPhase);
    }
  }
  return phases;
}

/** A presentation join only. Events never establish analyzed/written/verified state. */
export function boardProcessingEvent(event: VisualEvent | null | undefined, baseline: SnapshotPreflight | undefined, entities: VisualEntity[] | BoardEntityIndex, contextHash: string | null) {
  const held = (reason: string) => ({ entity: null, geometry: null, reason });
  if (!event?.geometry || !validGeometry(event.geometry)) return held("No supported component geometry in this event.");
  if (!contextHash || event.nativeSource?.contextHash !== contextHash || !baseline || baseline.integrity?.status !== "verified-against-capture-hash" || !baseline.integrity.allArchivedFilesVerified || event.source !== baseline.source.sha256 || event.nativeSource?.packageSha256 !== baseline.packageSha256 || event.nativeSource?.jobMember !== baseline.selection.job.member || event.nativeSource?.masterMember !== (baseline.selection.master?.member ?? "")) return held("Event source/snapshot differs from this board. Recorded geometry is held; the board remains visible.");
  const id = event.geometry.identity, matches = Array.isArray(entities) ? entities.filter(e => e.id === id.id && e.ref === id.ref && e.module === id.module && e.master === id.master) : entities.get(identityKey(id)) ?? [];
  if (event.componentPhase === "preparation-checked" && event.geometry.before === null && matches.length === 0 && baseline.nativeRecords.job?.records.filter(r => r.kind === "module-record" && r.rawFields.ID?.length === 1 && r.rawFields.ID[0] === id.module).length === 1) {
    const entity: VisualEntity = { key: `staged:${event.run}:${event.entity}`, ...id, ...event.geometry.after, side: "native side unqualified" };
    return { entity, geometry: event.geometry, reason: "Staged new placement from the actual worker, shown in its declared native module. Not counted as a delivered preparation; fresh candidate read-back is required." };
  }
  if (matches.length !== 1) return held("No unique original placement for this event. Prepared additions remain staged until the candidate is freshly read.");
  const entity = matches[0], before = event.geometry.before;
  if (!before || before.x !== entity.x || before.y !== entity.y || before.width !== entity.width || before.height !== entity.height || before.angle !== entity.angle) return held("Recorded before-geometry differs from the selected original; event overlay held.");
  return { entity, geometry: event.geometry, reason: "Recorded worker geometry only; package delivery, preservation and Eagle verification are separate." };
}
