import type { PlacementResult } from "./placement-types";
import type { ArchiveReview, NativeLiteralBindings } from "./archive-types";
import type { ReviewNotes } from "./review-session";
import { nativeQualificationText, type NativeQualification } from "./native-qualification";
import type { AlignmentResult, GerberResult } from "./geometry-types";

type SourceWorkItem = {
  id: string; scope: string; sourceRow: number | null; severity: string; reason: string;
  nextAction: string; identity: { module: string; side: string; refdes: string; placementId: string } | null;
  annotation: string;
  nativeContext?: { findingId: string | null; blockerId: string | null; groupId: string | null; moduleLiteral: string | null; referenceLiteral: string | null; sourcePaths: string[] };
  bindingContext?: { code: string; segmentOrdinal: number | null; sourceContext: NativeLiteralBindings["sourceContext"] };
};

export function placementNextAction(code: string): string {
  if (code === "MPN_MISSING") return "Confirm this component's MPN against the approved BOM or engineering evidence, update the source, and validate again.";
  if (code === "DUPLICATE_IDENTITY") return "Check module, side and reference scope against the approved source. Resolve the duplicate without silently deleting a placement, then validate again.";
  return "Check this row and its column mapping against the original spreadsheet. Correct the source or mapping and validate again.";
}

export function buildSourceReport(input: { sourceName: string | null; result: PlacementResult | null; notes: ReviewNotes; archiveName: string | null; archive: ArchiveReview | null; nativeQualification?: NativeQualification | null; gerber?: GerberResult | null; alignment?: AlignmentResult | null }) {
  const { result, notes, archive } = input;
  const nativeAccounting = archive?.preflight.nativeAccounting ?? null;
  const nativeBindings = archive?.preflight.nativeBindings ?? null;
  const nativeFindings = new Map(nativeAccounting?.findings.map(finding => [finding.id, finding]));
  const nativeBlockers = new Map(nativeAccounting?.sharedBlockers.map(blocker => [blocker.id, blocker]));
  const nativeGroups = new Map(nativeAccounting?.correspondenceGroups.map(group => [group.id, group]));
  const equivalentHolds: Record<string, string> = {
    NATIVE_SEMANTICS_UNQUALIFIED: "NATIVE_ADAPTER_UNQUALIFIED",
    NATIVE_REQUIRED_ASSETS_UNRESOLVED: "DEPENDENCIES_UNKNOWN",
    EAGLE_CANDIDATE_UNVERIFIED: "MACHINE_EVIDENCE_MISSING",
  };
  const coveredHolds = new Set(nativeAccounting?.status === "recorded" ? nativeAccounting.sharedBlockers.map(blocker => equivalentHolds[blocker.code]) : []);
  const nativeWorkItems = nativeAccounting?.remainingWork.map(work => {
    const finding = nativeFindings.get(work.findingId ?? ""), blocker = nativeBlockers.get(work.blockerId ?? "");
    const group = nativeGroups.get(work.groupId ?? finding?.groupId ?? "");
    return {
      id: work.id, scope: "native-accounting", sourceRow: null,
      severity: blocker ? "hold" : finding?.severity ?? "observation",
      reason: finding?.message ?? blocker?.reason ?? "Native work has no recorded finding basis.",
      nextAction: work.nextAction, identity: null, annotation: "",
      nativeContext: { findingId: work.findingId ?? null, blockerId: work.blockerId ?? null, groupId: group?.id ?? null,
        moduleLiteral: group?.moduleLiteral ?? blocker?.moduleLiteral ?? null, referenceLiteral: group?.referenceLiteral ?? null, sourcePaths: finding?.sourcePaths ?? [] },
    };
  }) ?? [];
  const placementsByRow = new Map(result?.placements.map(value => [value.sourceRow, value]));
  const workItems: SourceWorkItem[] = [
    ...[...(input.gerber?.blocked_reasons ?? []), ...(input.gerber?.unsupported_features ?? []), ...(input.alignment?.holds ?? []), ...(input.gerber?.geometry_complete && !input.alignment ? ["CAD/Gerber registration has not passed independent control checks."] : [])].map((reason, index) => ({ id: `gerber:${index}`, scope: "gerber-registration", sourceRow: null, severity: "hold", reason, nextAction: "Review the Gerber interpretation and physical correspondences in Source intake and Board workspace.", identity: null, annotation: "" })),
    ...(result?.holds.map((reason, index) => ({ id: `placement-hold:${index}`, scope: "placement-source", sourceRow: null, severity: "hold", reason, nextAction: "Resolve the stated import prerequisite in Source intake, then validate again.", identity: null, annotation: "" })) ?? []),
    ...(result?.issues.map((issue, index) => {
      const placement = placementsByRow.get(issue.row);
      return { id: `row:${issue.row}:issue:${index}`, scope: "source-row", sourceRow: issue.row, severity: issue.severity, reason: issue.message, nextAction: placementNextAction(issue.code), identity: placement ? { module: placement.module, side: placement.side, refdes: placement.refdes, placementId: placement.placementId } : null, annotation: notes[`row:${issue.row}`] ?? "" };
    }) ?? []),
    ...(archive?.preflight.holds.filter(hold => !coveredHolds.has(hold.code)).map((hold, index) => ({ id: `native:${hold.scope}:${hold.code}:${index}`, scope: hold.scope, sourceRow: null, severity: "hold", reason: hold.reason, nextAction: hold.nextAction, identity: null, annotation: "" })) ?? []),
    ...nativeWorkItems,
    ...(nativeBindings?.findings.map((finding, index) => ({ id: `native-binding:${index}`, scope: "native-literal-binding", sourceRow: null, severity: "observation", reason: finding.message,
      nextAction: "Review the exact source field and selected window/pad records. Literal links do not establish physical ownership or authorize a native repair.", identity: null, annotation: "",
      nativeContext: { findingId: null, blockerId: null, groupId: null, moduleLiteral: null, referenceLiteral: null, sourcePaths: [finding.sourcePath] },
      bindingContext: { code: finding.code, segmentOrdinal: finding.segmentOrdinal, sourceContext: nativeBindings.sourceContext },
    })) ?? []),
    ...(nativeBindings && nativeBindings.status !== "recorded" ? [{ id: "native-bindings-unavailable", scope: "native-literal-binding", sourceRow: null, severity: "hold", reason: nativeBindings.reason ?? "Literal binding observations are unavailable.", nextAction: "Resolve the bounded native record prerequisite before assessing literal bindings; ownership remains unknown.", identity: null, annotation: "" }] : []),
    ...(nativeAccounting && nativeAccounting.status !== "recorded" ? [{ id: "native-accounting-unavailable", scope: "native-accounting", sourceRow: null, severity: "hold", reason: nativeAccounting.reason ?? "Complete native accounting is unavailable.", nextAction: "Resolve the native accounting hold before assessing component preparation.", identity: null, annotation: "" }] : []),
  ];
  return {
    artifactType: "scan.source-review-handoff", schemaVersion: "1", appVersion: "0.1.0-alpha.0",
    classification: "Source review, native structural accounting and preflight; not a complete native engineering candidate package",
    placementSource: result ? { name: input.sourceName, sha256: result.sourceSha256, sheetIndex: result.sheetIndex, mapping: result.mapping, coordinateFrame: result.coordinateFrame, counts: result.counts, status: result.status } : null,
    archiveSource: archive ? { name: input.archiveName, sha256: archive.preflight.source.sha256, selection: archive.preflight.selection, capture: archive.capture } : null,
    sourceRelationship: "Placement-to-archive revision, population and coordinate registration have not been verified.",
    placementResult: result, nativePreflight: archive?.preflight ?? null, nativeAccounting, nativeBindings,
    reviewNotes: notes, workItems, nativeQualification: input.nativeQualification ?? null,
    gerber: input.gerber ?? null, alignment: input.alignment ?? null,
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
    if (item.nativeContext) lines.push(`Literal native scope: ${item.nativeContext.moduleLiteral ?? "unresolved/job"} / ${item.nativeContext.referenceLiteral ?? "unresolved/job"}`, `Evidence links: ${JSON.stringify(item.nativeContext)}`, "");
    if (item.bindingContext) lines.push(`Exact binding evidence: ${JSON.stringify(item.bindingContext)}`, "");
  }
  lines.push("EVERY PARSED SOURCE PLACEMENT — NATIVE PREPARATION NOT ASSESSED");
  for (const placement of report.placements) lines.push(`Row ${placement.sourceRow} | ${placement.module} | ${placement.side} | ${placement.refdes} | MPN: ${placement.mpn ?? "Unknown"}${placement.reviewNote ? ` | Note: ${placement.reviewNote}` : ""}`);
  lines.push("", "REMAINING NATIVE WORK", ...report.requiredNativeWork.map((value, index) => `${index + 1}. ${value}`), "", "Notes do not clear parser holds or authorize native edits. Optical teaching, engineering approval and production release remain separate.");
  if (report.nativeQualification) lines.push("", nativeQualificationText(report.nativeQualification));
  if (report.gerber) lines.push('', 'GERBER REVIEW', `SHA-256: ${report.gerber.source_sha256}`, `Parse: ${report.gerber.status}; ${report.gerber.objects.length} objects`, ...report.gerber.interpretation_overrides, ...report.gerber.blocked_reasons, ...report.gerber.unsupported_features);
  if (report.alignment) lines.push('', 'CAD TO GERBER REGISTRATION', `Status: ${report.alignment.status}; fingerprint: ${report.alignment.fingerprint}`, `Scope: ${JSON.stringify(report.alignment.scope)}`, `Max residual: ${report.alignment.maxResidualMm} mm; tolerance: ${report.alignment.toleranceMm} mm`, `Transform: ${JSON.stringify(report.alignment.transform)}`, report.alignment.qualification);
  if (report.nativePreflight?.literalDependencies) {
    lines.push('', 'NATIVE LITERAL REFERENCE CHECKS — SEMANTICS UNQUALIFIED');
    for (const r of report.nativePreflight.literalDependencies.relations) lines.push(`${r.id}: ${r.counts ? JSON.stringify(r.counts) : r.reason}`);
    lines.push(...report.nativePreflight.literalDependencies.limitations);
  }
  if (report.nativeBindings) {
    const bindings = report.nativeBindings;
    lines.push("", "NATIVE WINDOW/PAD LITERAL LINKS — OWNERSHIP UNKNOWN",
      `Status: ${bindings.status}; complete literal observations: ${bindings.literalObservationsComplete}`,
      bindings.interpretation ?? bindings.reason ?? "Native field interpretation is unavailable.",
      `Binding source: ${JSON.stringify(bindings.sourceContext)}`, `Observed counts: ${JSON.stringify(bindings.counts)}`,
      "Literal links are not qualified native dependencies. No native edits or repair proposals are generated.");
    for (const [name, rule] of Object.entries(bindings.scopeRules ?? {})) lines.push(`${name}: ${rule}`);
    for (const part of bindings.parts) lines.push(`Part: ${part.sourcePath} | ${part.state} | raw identity=${JSON.stringify(part.identityLiterals)} | WND_PAD=${JSON.stringify(part.wndPadLiterals)} | empty segments=${JSON.stringify(part.emptySegmentOrdinals)}`);
    for (const binding of bindings.bindings) lines.push(`Binding: ${binding.partSourcePath}/WND_PAD segment ${binding.segmentOrdinal} | ${binding.state} | ownership=${binding.ownership}`,
      `Exact raw segment: ${JSON.stringify(binding.rawSegment)}`, `Window comparison: ${JSON.stringify(binding.window ?? null)}`,
      `Pad comparison: ${JSON.stringify(binding.pad ?? null)}`, `XY comparison: ${JSON.stringify(binding.coordinateComparison ?? null)}`,
      `Sentinel-like literals (meaning unknown): ${JSON.stringify(binding.sentinelLikeLiterals ?? [])}`);
    for (const finding of bindings.findings) lines.push(`Binding observation: ${finding.code} | ${finding.sourcePath} | segment=${finding.segmentOrdinal ?? "none"} | ${finding.message}`);
    if (bindings.padCadRelationExperiment) lines.push("", "SEPARATE RELATION EXPERIMENT — NOT OWNERSHIP EVIDENCE OR DEFECT FINDINGS",
      JSON.stringify(bindings.padCadRelationExperiment));
    lines.push(...(bindings.limitations ?? []));
  }
  if (report.nativeAccounting) {
    const accounting = report.nativeAccounting;
    lines.push("", "NATIVE STRUCTURAL ACCOUNTING — NO NATIVE EDITS APPLIED",
      `Status: ${accounting.status}; complete literal accounting: ${accounting.accountingComplete}`,
      accounting.interpretation ?? accounting.reason ?? "Population and native preparation remain unknown.",
      "Rows are selected-job CAD records and separately identified native-only records, not verified intended components.",
      `Accounting source: ${JSON.stringify(accounting.sourceContext ?? null)}`,
      `Observed counts: ${JSON.stringify(accounting.counts)}`,
      accounting.enableLiteralInterpretation ?? "Raw ENABLE values do not establish enabled inspections.");
    for (const row of accounting.componentCoverage) lines.push(
      `${row.id} | ${row.sourceRepresentation} | ${row.sourcePath} | module=${row.moduleLiteral ?? "unknown"} | reference=${row.referenceLiteral ?? "unknown"} | group=${row.groupId ?? "none"}`,
      `Correspondence=${row.nativeCorrespondence}; preparation=${row.nativePreparation}; existing teaching=${row.existingTeaching}; exclusion=${row.exclusion}; enabled meaning=${row.enabledState}; verification=${row.verification}; release=${row.release}`,
    );
    lines.push("", "NATIVE INSTANCES — LINKED ONCE BY EXACT GROUP ID");
    for (const instance of accounting.nativeInstances) lines.push(`${instance.id} | ${instance.sourcePath} | group=${instance.groupId ?? "none"} | native ID literals=${JSON.stringify(instance.nativeIdLiterals)} | ENABLE literals=${JSON.stringify(instance.enableLiterals)} | enabled meaning=${instance.enabledMeaning}`);
    lines.push("", "SHARED BLOCKERS — AFFECTED ACCOUNTING ROWS");
    for (const blocker of accounting.sharedBlockers) lines.push(`${blocker.id} | ${blocker.scope} | ${blocker.reason}`, `Affected row IDs: ${JSON.stringify(blocker.affectedRowIds)}`);
    lines.push("", "NATIVE OBSERVATION EVIDENCE");
    for (const finding of accounting.findings) lines.push(`${finding.id} | ${finding.code} | group=${finding.groupId ?? "none"} | repair eligibility=${finding.repairEligibility}`, finding.message, `Exact source paths: ${JSON.stringify(finding.sourcePaths)}`);
    lines.push("Next actions above retain finding, blocker and group links. No reference appearing here counts as completed native preparation.");
  }
  return lines.join("\n") + "\n";
}
