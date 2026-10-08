import type { useScanSession } from "../../components/scan/ScanSession";
import { coordinateSources, coordinateFrameContract } from "./coordinate-sources";
import { duplicateReviewExport } from "./native-duplicate-review";
import { registrationDigest, sourceRegistrationAnalysis } from "./source-registration";

/** Rebuild the baseline review rather than storing derived reports as authority. */
export async function buildOfflineReviewEvidence(session: ReturnType<typeof useScanSession>) {
  const sources = coordinateSources({ name: session.file?.name ?? "", result: session.result },
    session.comparisons.entries.map(p => ({ name: p.file.name, result: p.result })),
    { name: session.layout.file?.name ?? "", result: session.layout.result }, session.archiveReview);
  const draft = session.sourceRegistration;
  const source = sources.find(s => s.id === draft.sourceId), target = sources.find(s => s.id === draft.targetId);
  const digest = source && target ? await registrationDigest(source, target, draft) : null;
  const duplicate = session.archiveReview?.preflight.nativeDuplicateReview;
  return {
    artifactType: "scan.baseline-offline-review", schemaVersion: "1",
    scope: "Original selected inputs. Candidate native diagnostics are separate; these decisions do not suppress placements or authorize native coordinate transforms.",
    sourceRegistration: source && target ? { ...sourceRegistrationAnalysis(source, target, draft), digest,
      decision: draft.decision?.digest === digest ? draft.decision : null,
      staleDecision: draft.decision && draft.decision.digest !== digest ? draft.decision : null } : null,
    coordinateContract: coordinateFrameContract,
    duplicateReview: duplicate ? duplicateReviewExport(duplicate, session.repair.work) : null,
    sourceInventory: sources.map(({ points, ...source }) => ({ ...source, pointCount: points.length })),
    machineQualified: false, suppressionAuthorized: false,
  };
}
