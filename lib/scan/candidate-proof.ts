import type { SnapshotPreflight } from "./archive-types";
import type { RepairRequest } from "./repair-session";
import type { candidateRepairWork } from "./candidate-repair-work";

const canonical = (v: unknown): string => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
export type PreservationProof = { identity: string; work: ReturnType<typeof candidateRepairWork> };
/** Runtime-only identity. Never restored from a saved event or project report. */
export function preservationIdentity(b: SnapshotPreflight, c: SnapshotPreflight, request: RepairRequest) {
  return canonical({ original: b.source.sha256, originalSelection: b.selection, candidate: c.source.sha256, candidateSelection: c.selection, request });
}
export function matchesPreservation(proof: PreservationProof | null | undefined, b?: SnapshotPreflight, c?: SnapshotPreflight, request?: RepairRequest) {
  return !!(proof && b && c && request && proof.identity === preservationIdentity(b, c, request) && proof.work.originalSha256 === b.source.sha256 && proof.work.candidateSha256 === c.source.sha256 && proof.work.actualCandidateRecordsVerified);
}
/** Narrow positive frame proof: freshly reproduced ROI-only edit, same module records and schema. */
export function candidateFrameHold(b?: SnapshotPreflight, c?: SnapshotPreflight, request?: RepairRequest, proof?: PreservationProof | null): string | null {
  if (!b || !c || !request || !matchesPreservation(proof, b, c, request)) return "Candidate overlay held: fresh full preservation proof for this original, candidate and exact request is required. Native candidate records remain visible.";
  if ([b, c].some(p => p.integrity?.status !== "verified-against-capture-hash" || !p.integrity.allArchivedFilesVerified || p.selection.job.role !== "main" || p.selection.master?.role !== "main" || p.nativeRecords.job?.status !== "recorded")) return "Candidate overlay held: both main snapshots and Masters must be freshly verified.";
  const version = b.nativeRecords.job.schemaVersionClaim;
  const accepted = request.proposals.filter(p => request.acceptances.some(a => a.proposalId === p.id && a.decision === "accepted"));
  if (!["10.1", "10.2"].includes(version ?? "") || c.nativeRecords.job.schemaVersionClaim !== version || !accepted.length || accepted.some(p => !p.beforeRoi || !/\/Roi\/(cx|cy)$/.test(p.path))) return "Candidate overlay held: frame equivalence is supported only for freshly reproduced ROI X/Y placement edits in the same supported schema.";
  const modules = (p: SnapshotPreflight) => p.nativeRecords.job.records.filter(r => r.kind === "module-record");
  if (!modules(b).length || canonical(modules(b)) !== canonical(modules(c)) || canonical(b.selection.master) !== canonical(c.selection.master)) return "Candidate overlay held: native module/frame records or Master selection differ from the verified original.";
  return null;
}
