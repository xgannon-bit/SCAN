import type { NativePreparationSession } from "./native-preparation-session";
import type { RepairRequest } from "./repair-session";

/** Capture only decision inputs, never changing history timestamps or UI state. */
export function compositionDecisionContext(preparation: NativePreparationSession, repair: RepairRequest | null) {
  return JSON.stringify({ preparationReview: preparation.review, preparationReviewer: preparation.reviewer,
    packageProfiles: preparation.packageProfiles ?? [], repair });
}

export function preparationNeedsRecompute(preparation: NativePreparationSession, archiveSha256: string | undefined) {
  return !preparation.review && preparation.history.some(h => h.review.archiveSha256 === archiveSha256 && h.accepted.length > 0);
}
