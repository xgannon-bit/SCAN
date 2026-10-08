import type { RepairSession } from "./repair-session";

export type FieldComparison = { state: string; changedFieldCount: number; examples: { field: string; left: string | null; right: string | null }[]; omittedExampleCount: number };
export type DuplicateCandidate = {
  sourcePath: string; identityLiterals: Record<string, string[]>; identityUnambiguous: boolean;
  moduleState: string; moduleLiterals: Record<string, string[]>[];
  enabledLiterals: string[]; placementSha256: string; geometry: Record<string, string>; bindings: Record<string, string>; fov: Record<string, string>;
  master: { state: string; sourcePaths: string[]; sha256: string | null; sharedUsage: { sourcePath: string; identityLiterals: Record<string, string[]> }[]; windows: number | null; algorithms: number | null };
  windows: { sourcePath: string; identityLiterals: Record<string, string[]>; sha256: string; geometry: Record<string, string>; algorithmCount: number; algorithmSha256: string }[];
};
export type DuplicatePair = {
  digest: string; leftPath: string; rightPath: string; comparisons: Record<string, FieldComparison | null>;
  windowComparisons: { nameLiteral: string; groupIdLiteral: string; leftPath: string; rightPath: string; comparison: FieldComparison; geometry: FieldComparison; algorithmParameters: FieldComparison; dependencies: FieldComparison }[];
  unpairedWindowRoles: { nameLiteral: string; groupIdLiteral: string; leftCount: number; rightCount: number }[];
  unmappedWindowCount: [number, number]; sameMasterLiteral: boolean; suppressionSupported: false; holds: string[]; nextAction: string;
};
export type NativeDuplicateReview = {
  artifactType: "scan.native-duplicate-review"; schemaVersion: "1"; analyzerVersion: string; status: "recorded" | "blocked" | "unavailable"; reason: string;
  sourceContext?: { archiveSha256: string; packageSha256: string; snapshotId: string; selection: unknown };
  interpretation?: string; groups: { reference: string; module: string; digest: string; candidates: DuplicateCandidate[]; pairs: DuplicatePair[] }[];
  unscopedPlacements: { sourcePath: string; identityLiterals: Record<string, string[]>; hold: string }[];
  counts: { placements: number; duplicateScopes: number; pairComparisons: number; unscopedPlacements: number; masterSelected: boolean } | null;
  suppressionSupported: false; nativeEditsApplied: false; machineQualified: false;
};
export type DuplicateDecision = {
  kind: "duplicate-review-observation"; pairDigest: string; disposition: "needs-evidence" | "retain-both" | "prefer-left" | "prefer-right";
  reviewer: string; reason: string; suppressionAuthorized: false;
};
export const duplicateDecisionKey = (pair: DuplicatePair) => `duplicate-review:${pair.digest}`;

export function duplicateDecision(report: NativeDuplicateReview, pair: DuplicatePair, work: RepairSession["work"]): DuplicateDecision | null {
  const current = work.filter(item => item.key === duplicateDecisionKey(pair) && item.sourceSha256 === report.sourceContext?.archiveSha256 && item.snapshotId === report.sourceContext?.snapshotId);
  if (current.length !== 1) return null;
  try {
    const item = JSON.parse(current[0].note) as DuplicateDecision;
    if (!item || Object.keys(item).sort().join() !== "disposition,kind,pairDigest,reason,reviewer,suppressionAuthorized" || item.kind !== "duplicate-review-observation" || item.pairDigest !== pair.digest || item.suppressionAuthorized !== false || !["needs-evidence", "retain-both", "prefer-left", "prefer-right"].includes(item.disposition) || typeof item.reviewer !== "string" || !item.reviewer.trim() || item.reviewer.length > 128 || typeof item.reason !== "string" || !item.reason.trim() || item.reason.length > 1000) return null;
    return item;
  } catch { return null; }
}

export function recordDuplicateDecision(report: NativeDuplicateReview, pair: DuplicatePair, decision: Omit<DuplicateDecision, "kind" | "pairDigest" | "suppressionAuthorized">, work: RepairSession["work"]): RepairSession["work"] {
  const context = report.sourceContext;
  if (report.status !== "recorded" || !context || !report.groups.some(group => group.pairs.some(item => item.digest === pair.digest))) throw new Error("Fresh selected-source comparison required.");
  if ((decision.disposition === "prefer-left" || decision.disposition === "prefer-right") && pair.holds.includes("PLACEMENT_IDENTITY_AMBIGUOUS")) throw new Error("Resolve ambiguous placement identities before recording a survivor preference.");
  const item: DuplicateDecision = { ...decision, kind: "duplicate-review-observation", pairDigest: pair.digest, suppressionAuthorized: false };
  const entry = { key: duplicateDecisionKey(pair), sourceSha256: context.archiveSha256, snapshotId: context.snapshotId, status: "reviewed-offline" as const, note: JSON.stringify(item) };
  if (entry.note.length > 2000 || !duplicateDecision(report, pair, [entry])) throw new Error("A reviewer and specific comparison reason are required.");
  const result = [...work.filter(row => row.key !== entry.key), entry];
  if (result.length > 10000) throw new Error("Review work exceeds the saved-project bound.");
  return result;
}

export function duplicateReviewExport(report: NativeDuplicateReview, work: RepairSession["work"]) {
  const decisions = report.groups.flatMap(group => group.pairs.map(pair => ({ reference: group.reference, module: group.module, pairDigest: pair.digest, leftPath: pair.leftPath, rightPath: pair.rightPath, decision: duplicateDecision(report, pair, work), holds: pair.holds })));
  const keys = new Set(report.groups.flatMap(group => group.pairs.map(duplicateDecisionKey)));
  const staleDecisions = work.filter(row => row.key.startsWith("duplicate-review:") && (!keys.has(row.key) || row.sourceSha256 !== report.sourceContext?.archiveSha256 || row.snapshotId !== report.sourceContext?.snapshotId));
  return { artifactType: "scan.native-duplicate-decisions", schemaVersion: "1", comparison: report, decisions, staleDecisions, nativeEditsApplied: false, suppressionAuthorized: false, machineQualified: false };
}
