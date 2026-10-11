import type { ArchiveReview } from "./archive-types";
import type { RepairRequest } from "./repair-session";
import { repairImpact } from "./repair-impact";

const one = (fields: Record<string, string[]>, key: string) => fields[key]?.length === 1 ? fields[key][0] : null;
const keys = ["ParentId", "RefID", "ID", "MasterKey"] as const;
const canonical = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);

/** Re-read actual native records and file hashes. Saved decisions cannot assert completion. */
export function candidateRepairWork(original: ArchiveReview, candidate: ArchiveReview, request: RepairRequest, freshlyReproducedJobSha256: string) {
  const before = original.preflight, after = candidate.preflight;
  const refuse = (condition: unknown, reason: string) => { if (!condition) throw new Error(reason); };
  refuse(before.source.sha256 === request.source.archiveSha256 && before.selection.job.sha256 === request.source.jobSha256 && before.selection.root === request.source.root && before.selection.job.member === request.source.jobMember && before.selection.job.role === "main", "Repair history does not match this original main snapshot and source hashes.");
  refuse(after.selection.root === before.selection.root && after.selection.job.member === before.selection.job.member && after.selection.job.role === "main" && after.nativeRecords.job?.schemaVersionClaim === before.nativeRecords.job?.schemaVersionClaim, "Candidate snapshot selection or schema differs from the reviewed original.");
  refuse(/^[a-f0-9]{64}$/.test(freshlyReproducedJobSha256) && after.selection.job.sha256 === freshlyReproducedJobSha256, "Candidate main XML bytes differ from freshly reproduced exact accepted edits, including protected unknown fields.");
  refuse(equal(before.selection.master, after.selection.master), "Selected Master bytes or scope differ from the original.");
  if (request.proposals.some(p => p.beforeRoi)) refuse(request.source.masterMember && before.selection.master?.role === "main", "Guarded placement repair requires an exact selected main Master.");
  if (request.source.masterMember) refuse(request.source.masterMember === before.selection.master?.member && request.source.masterSha256 === before.selection.master.sha256 && request.source.masterRole === before.selection.master.role, "Repair history selects a different Master snapshot.");
  const fileMap = new Map(after.preservedFiles.map(f => [f.originalName, f]));
  refuse(fileMap.size === before.preservedFiles.length && after.preservedFiles.length === before.preservedFiles.length && equal([...before.preservedDirectories].sort(), [...after.preservedDirectories].sort()), "Candidate contains unexpected missing, repeated or added assets.");
  for (const file of before.preservedFiles) {
    const target = fileMap.get(file.originalName);
    refuse(target && (file.path ?? file.originalName) === (target.path ?? target.originalName) && ((file.path ?? file.originalName) === before.selection.job.member || (file.sha256 === target.sha256 && file.size === target.size)), "An unrelated asset, Master, Temp or backup differs from the original.");
  }
  refuse(before.nativeRecords.job?.status === "recorded" && after.nativeRecords.job?.status === "recorded", "Fresh original and candidate literal record inventories are required.");
  const baseline = before.nativeRecords.job.records, actual = after.nativeRecords.job.records;
  const parts = baseline.filter(r => r.kind === "part-record"), changed = actual.filter(r => r.kind === "part-record");
  const identity = (fields: Record<string, string[]>) => keys.map(k => one(fields, k));
  const partKey = (fields: Record<string, string[]>) => JSON.stringify(identity(fields));
  const indexed = new Map(changed.map(r => [partKey(r.rawFields), r]));
  refuse(indexed.size === changed.length && parts.length === changed.length && new Set(parts.map(r => partKey(r.rawFields))).size === parts.length, "Placement identities are missing, repeated or added; repair completion is held.");
  const accepted = request.proposals.filter(p => request.acceptances.some(a => a.proposalId === p.id && a.decision === "accepted"));
  refuse(accepted.length > 0, "No accepted repair exists in this candidate history.");
  const acceptedIds = new Set(accepted.map(p => p.id));
  refuse(accepted.every(p => (p.dependencyProposalIds ?? []).every(id => acceptedIds.has(id))), "An accepted placement edit is missing a required axis.");
  const expected = structuredClone(baseline);
  for (const proposal of accepted) {
    const matches = expected.filter(r => r.kind === "part-record" && keys.every(k => one(r.rawFields, k) === proposal.identity[k]));
    const suffix = proposal.path.match(/^JobContainer\/PartDataList\/PartData\[\d+\]\/(Roi\/cx|Roi\/cy|CenterPosX|ENABLE)$/)?.[1];
    refuse(matches.length === 1 && suffix && proposal.path === `${matches[0].sourcePath}/${suffix}`, "Exact stable placement identity or supported scalar scope could not be reproduced.");
    const record = matches[0];
    refuse(one(record.rawFields, suffix!) === proposal.before, "The recorded before-value differs from the fresh original.");
    const old = parts.find(r => keys.every(k => one(r.rawFields, k) === proposal.identity[k]))!;
    if (proposal.beforeRoi) refuse(Object.entries(proposal.beforeRoi).every(([k, v]) => one(old.rawFields, `Roi/${k}`) === v), "The original ROI guard is stale.");
    record.rawFields[suffix!] = [proposal.after];
  }
  // Records are literal observations; whole-file byte preservation is additionally
  // enforced by the worker's byte-span writer and checked receipt, not inferred here.
  refuse(equal(expected, actual), "Fresh candidate records contain a missing edit or an unrelated literal change.");
  refuse(equal(before.nativeRecords.master, after.nativeRecords.master), "Master record observations changed.");
  const byIdentity = new Map<string, typeof accepted>();
  for (const proposal of accepted) {
    const id = JSON.stringify(keys.map(k => proposal.identity[k]));
    byIdentity.set(id, [...(byIdentity.get(id) ?? []), proposal]);
  }
  const edits = [...byIdentity.values()].map(group => {
    const p = group[0], matching = changed.find(r => keys.every(k => one(r.rawFields, k) === p.identity[k]))!;
    const evidence = request.evidence.filter(e => group.some(v => v.evidenceIds.includes(e.id)));
    const impact = repairImpact(after, matching.sourcePath, p.path.split("]/")[1], p.after);
    const fovFields = Object.fromEntries(Object.entries(matching.rawFields).filter(([k]) => /^(FovList|SubFovNum|FovOPT)(\/|$)/.test(k)));
    const fov = after.nativeFovAssignments?.assignments.find(a => a.sourcePath === matching.sourcePath);
    return { identity: p.identity, changes: group.map(v => ({ proposalId: v.id, path: v.path, before: v.before, after: v.after })),
      evidence, basis: evidence.every(e => e.kind === "historical-replay") ? "historical-replay" : "operator-declared-unqualified",
      diagnosis: "not-independently-established", literalEnable: one(matching.rawFields, "ENABLE"),
      windows: impact?.windows ?? [], sharedPlacements: impact?.scopePlacements ?? [], masterMatch: impact?.masterMatch ?? "unavailable",
      bindingState: "preserved-unqualified", bindingSegments: impact?.bindingObservations.length ?? 0,
      fov: { fields: fovFields, assignment: fov?.assignmentState ?? "not-observed", assignedLiterals: fov?.assignedLiterals ?? [], coverage: "unverified" },
      remaining: ["Verify Eagle open/save/reopen preserves the exact ROI and untouched stored center.", "Verify physical body/pad alignment against independent board evidence; replay is not a diagnosis.", "Verify every linked Master/window and binding dependency; unchanged bytes do not prove unchanged runtime behavior.", "Verify acquisition coverage of the component and all inspection windows; a camera assignment is not coverage.", "Retain existing teaching and enabled states while performing the controlled machine trial; do not blanket-enable drafts."],
    };
  });
  return { artifactType: "scan.reanalyzed-placement-repair", schemaVersion: "1", originalSha256: before.source.sha256, candidateSha256: after.source.sha256,
    schemaClaim: after.nativeRecords.job.schemaVersionClaim, acceptedScalarCount: accepted.length, placementEditGroups: edits,
    preservedFiles: before.preservedFiles.length - 1, masterBytesPreserved: before.selection.master ? true : null, actualCandidateRecordsVerified: true, independentlyDiagnosedCorrections: 0,
    inspectionRepairEstablished: false, eagleOpenSaveReopen: "not-performed", productionRelease: "not-granted" };
}
