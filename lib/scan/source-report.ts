import type { PlacementResult } from "./placement-types";
import type { ArchiveReview } from "./archive-types";
import type { ReviewNotes } from "./review-session";

export function placementNextAction(code: string): string {
  if (code === "MPN_MISSING") return "Confirm this component's MPN against the approved BOM or engineering evidence, update the source, and validate again.";
  if (code === "DUPLICATE_IDENTITY") return "Check module, side and reference scope against the approved source. Resolve the duplicate without silently deleting a placement, then validate again.";
  return "Check this row and its column mapping against the original spreadsheet. Correct the source or mapping and validate again.";
}

export function buildSourceReport(input: { sourceName: string | null; result: PlacementResult | null; notes: ReviewNotes; archiveName: string | null; archive: ArchiveReview | null }) {
  const { result, notes, archive } = input;
  const placementsByRow = new Map(result?.placements.map(value => [value.sourceRow, value]));
  const workItems = [
    ...(result?.holds.map((reason, index) => ({ id: `placement-hold:${index}`, scope: "placement-source", sourceRow: null, severity: "hold", reason, nextAction: "Resolve the stated import prerequisite in Source intake, then validate again.", identity: null, annotation: "" })) ?? []),
    ...(result?.issues.map((issue, index) => {
      const placement = placementsByRow.get(issue.row);
      return { id: `row:${issue.row}:issue:${index}`, scope: "source-row", sourceRow: issue.row, severity: issue.severity, reason: issue.message, nextAction: placementNextAction(issue.code), identity: placement ? { module: placement.module, side: placement.side, refdes: placement.refdes, placementId: placement.placementId } : null, annotation: notes[`row:${issue.row}`] ?? "" };
    }) ?? []),
    ...(archive?.preflight.holds.map((hold, index) => ({ id: `native:${hold.scope}:${hold.code}:${index}`, scope: hold.scope, sourceRow: null, severity: "hold", reason: hold.reason, nextAction: hold.nextAction, identity: null, annotation: "" })) ?? []),
  ];
  return {
    artifactType: "scan.source-review-handoff", schemaVersion: "1", appVersion: "0.1.0-alpha.0",
    classification: "Source review and native preflight only; not a complete native engineering candidate package",
    placementSource: result ? { name: input.sourceName, sha256: result.sourceSha256, sheetIndex: result.sheetIndex, mapping: result.mapping, coordinateFrame: result.coordinateFrame, counts: result.counts, status: result.status } : null,
    archiveSource: archive ? { name: input.archiveName, sha256: archive.preflight.source.sha256, selection: archive.preflight.selection, capture: archive.capture } : null,
    sourceRelationship: "Placement-to-archive revision, population and coordinate registration have not been verified.",
    placementResult: result, nativePreflight: archive?.preflight ?? null,
    reviewNotes: notes, workItems,
    placements: result?.placements.map(placement => ({ sourceSha256: result.sourceSha256, sheetIndex: result.sheetIndex, sourceRow: placement.sourceRow, placementId: placement.placementId, module: placement.module, side: placement.side, refdes: placement.refdes, mpn: placement.mpn, nativePreparation: "not-assessed", reviewNote: notes[`row:${placement.sourceRow}`] ?? "" })) ?? [],
    requiredNativeWork: ["Verify placement/Gerber revision, side, module scope and coordinate registration.", "Read native semantics and resolve model, image and inspection dependencies through a supported version adapter.", "Review exact proposed corrections and qualify the copy-only native writer.", "Load, save and reopen the exact candidate in authorized Eagle software; complete image-dependent teaching and validation."],
    readiness: { packageComplete: null, offlinePreparationCoverage: null, machineCompatibility: null, opticalTeachingValidation: null, productionRelease: null },
    candidateId: null, machineExportAllowed: false,
    annotationsDoNotResolveHolds: true,
  };
}

export function sourceReportText(report: ReturnType<typeof buildSourceReport>): string {
  const lines = ["SCAN — SOURCE REVIEW HANDOFF", report.classification, "", `Placement source: ${report.placementSource?.name ?? "Not reviewed"}`, `Placement SHA-256: ${report.placementSource?.sha256 ?? "Unknown"}`, `Archive source: ${report.archiveSource?.name ?? "Not reviewed"}`, `Archive SHA-256: ${report.archiveSource?.sha256 ?? "Unknown"}`, `Source placements listed: ${report.placements.length}`, "Native candidate: NONE. Native package completeness and machine compatibility: UNKNOWN.", report.sourceRelationship, "", "SESSION NOTES (USER ANNOTATIONS)", report.reviewNotes.session || "None", "", "ACTIONABLE FINDINGS"];
  const identities = [`Placement worksheet index: ${report.placementSource?.sheetIndex ?? "Unknown"}`];
  if (report.archiveSource) {
    const { selection, capture } = report.archiveSource;
    identities.push(`Archive root: ${selection.root}`, `Job snapshot: ${selection.job.role} | ${selection.job.member}`, `Master snapshot: ${selection.master ? `${selection.master.role} | ${selection.master.member}` : "Explicitly not selected"}`, `Snapshot ID: ${capture.snapshotId}`, `Package SHA-256: ${capture.packageSha256}`);
  }
  lines.splice(8, 0, ...identities);
  if (!report.workItems.length) lines.push("No source findings were recorded. Native readiness has not been established.");
  for (const [index, item] of report.workItems.entries()) {
    lines.push(`${index + 1}. [${item.severity}] ${item.scope}${item.sourceRow ? ` row ${item.sourceRow}` : ""}`, item.identity ? `${item.identity.module} / ${item.identity.side} / ${item.identity.refdes} / ${item.identity.placementId}` : "Job/source-scoped; no placement identity inferred.", item.reason, `Next: ${item.nextAction}`, ...(item.annotation ? [`Note: ${item.annotation}`] : []), "");
  }
  lines.push("EVERY PARSED SOURCE PLACEMENT — NATIVE PREPARATION NOT ASSESSED");
  for (const placement of report.placements) lines.push(`Row ${placement.sourceRow} | ${placement.module} | ${placement.side} | ${placement.refdes} | MPN: ${placement.mpn ?? "Unknown"}${placement.reviewNote ? ` | Note: ${placement.reviewNote}` : ""}`);
  lines.push("", "REMAINING NATIVE WORK", ...report.requiredNativeWork.map((value, index) => `${index + 1}. ${value}`), "", "Notes do not clear parser holds or authorize native edits. Optical teaching, engineering approval and production release remain separate.");
  return lines.join("\n") + "\n";
}
