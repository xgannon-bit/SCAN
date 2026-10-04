export type NativeAccounting = {
  artifactType: "scan.native-accounting"; schemaVersion: "1"; analyzerVersion: string;
  status: "recorded" | "unavailable" | "blocked"; code: string; reason?: string;
  accountingComplete: boolean; interpretation?: string; enableLiteralInterpretation?: string;
  sourceContext?: { archiveSha256: string; snapshotId: string; jobMember: string; jobSha256: string };
  componentCoverage: { id: string; sourcePath: string; recordId: string; groupId: string | null; moduleLiteral: string | null; referenceLiteral: string | null; sourceRepresentation: string; nativeCorrespondence: string; nativePreparation: string; existingTeaching: string; enabledState: string; verification: string; release: string; exclusion: string }[];
  nativeInstances: { id: string; sourcePath: string; groupId: string | null; coverageRowId?: string | null; nativeIdLiterals: string[]; enableLiterals: string[]; enableObservation?: string; enabledMeaning: string }[];
  correspondenceGroups: { id: string; moduleLiteral: string; referenceLiteral: string; cadRecordIds: string[]; nativeInstanceIds: string[]; affectedRowIds: string[]; moduleMatchState: string; duplicateMeaning: string }[];
  findings: { id: string; code: string; severity: string; sourcePaths: string[]; groupId: string | null; message: string; repairEligibility: string }[];
  sharedBlockers: { id: string; code: string; scope: string; moduleLiteral?: string; affectedRowIds: string[]; reason: string }[];
  remainingWork: { id: string; findingId?: string; groupId?: string | null; blockerId?: string; nextAction: string }[];
  counts: { cadRows: number; nativePartInstances: number; coverageRows: number; nativeOnlyRows: number; findings: number; sharedBlockers: number; nativeEditsApplied: number; [key: string]: unknown } | null;
  machineExportAllowed: false; nativeEditsApplied: false; changes?: unknown[];
};

export const MAX_NATIVE_CSV_BYTES = 3_000_000;
export const MAX_NATIVE_CSV_CELL_BYTES = 32_768;
const MAX_RECORDS = 10_000;
const MAX_ACTIONS = 50_000;
const encoder = new TextEncoder();

function fail(message: string): never { throw new Error(message); }
function boundedCount(value: unknown, maximum = MAX_RECORDS): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) fail("Native accounting count exceeds its supported bounds.");
}

function uniqueById<T extends { id: string }>(items: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (typeof item.id !== "string" || !item.id || item.id.length > 256 || map.has(item.id)) fail("Native accounting record IDs are invalid or repeated.");
    map.set(item.id, item);
  }
  return map;
}

function indexReport(report: NativeAccounting) {
  if (report.status !== "recorded" || report.accountingComplete !== true || report.machineExportAllowed !== false || report.nativeEditsApplied !== false || (report.changes?.length ?? 0) !== 0) fail("Only complete literal accounting can be exported; this exporter cannot claim native preparation or candidate output.");
  if (!report.sourceContext || !/^[0-9a-f]{64}$/.test(report.sourceContext.jobSha256) || !/^[0-9a-f]{64}$/.test(report.sourceContext.archiveSha256) || !report.sourceContext.snapshotId) fail("Native accounting source hashes and snapshot identity are required.");
  for (const list of [report.componentCoverage, report.nativeInstances, report.correspondenceGroups, report.sharedBlockers]) {
    if (!Array.isArray(list)) fail("Native accounting list is invalid.");
    boundedCount(list.length);
  }
  for (const list of [report.findings, report.remainingWork]) {
    if (!Array.isArray(list)) fail("Native accounting actions are invalid.");
    boundedCount(list.length, MAX_ACTIONS);
  }
  const counts = report.counts;
  if (!counts) fail("Complete accounting counts are required.");
  for (const name of ["cadRows", "nativePartInstances", "coverageRows", "nativeOnlyRows"] as const) boundedCount(counts[name]);
  boundedCount(counts.findings, MAX_ACTIONS); boundedCount(counts.sharedBlockers);
  if (counts.nativeEditsApplied !== 0 || counts.coverageRows !== report.componentCoverage.length || counts.nativePartInstances !== report.nativeInstances.length || counts.findings !== report.findings.length || counts.sharedBlockers !== report.sharedBlockers.length) fail("Native accounting counts disagree with the complete records.");
  const rows = uniqueById(report.componentCoverage), instances = uniqueById(report.nativeInstances);
  const groups = uniqueById(report.correspondenceGroups), findings = uniqueById(report.findings), blockers = uniqueById(report.sharedBlockers);
  uniqueById(report.remainingWork);
  let cadRows = 0, nativeOnlyRows = 0, links = 0;
  const memberGroups = new Map<string, string>(), rowGroups = new Map<string, string>();
  const sourceRecords = new Map<string, NativeAccounting["componentCoverage"][number]>();
  function checkLinks(ids: string[], exists: (id: string) => boolean) {
    if (!Array.isArray(ids)) fail("Native accounting links are invalid.");
    boundedCount(ids.length);
    links += ids.length;
    if (links > 100_000 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !exists(id))) fail("Native accounting links are incomplete, repeated or exceed supported bounds.");
  }
  for (const row of rows.values()) {
    if (typeof row.recordId !== "string" || !row.recordId || sourceRecords.has(row.recordId)) fail("Source accounting record identities must remain distinct.");
    sourceRecords.set(row.recordId, row);
    if (row.sourceRepresentation === "native-cad-row") cadRows++;
    else if (row.sourceRepresentation === "native-part-only") nativeOnlyRows++;
    else fail("Unknown accounting row representation.");
    if (row.groupId !== null && !groups.has(row.groupId)) fail("Accounting row references an absent group.");
    if (row.nativePreparation !== "not-prepared" || row.existingTeaching !== "unassessed" || row.enabledState !== "unqualified" || row.verification !== "not-verified" || row.release !== "not-assessed" || row.exclusion !== "not-assessed") fail("Literal accounting cannot establish preparation, teaching, enablement, exclusion, verification or release.");
  }
  if (cadRows !== counts.cadRows || nativeOnlyRows !== counts.nativeOnlyRows) fail("Native accounting source row counts disagree.");
  for (const group of groups.values()) {
    checkLinks(group.nativeInstanceIds, id => instances.has(id));
    checkLinks(group.affectedRowIds, id => rows.get(id)?.groupId === group.id);
    checkLinks(group.cadRecordIds, id => sourceRecords.get(id)?.groupId === group.id && sourceRecords.get(id)?.sourceRepresentation === "native-cad-row");
    for (const id of group.affectedRowIds) rowGroups.set(id, group.id);
    for (const id of group.nativeInstanceIds) {
      if (memberGroups.has(id) || instances.get(id)?.groupId !== group.id) fail("A native instance has an inconsistent correspondence group.");
      memberGroups.set(id, group.id);
    }
  }
  for (const row of rows.values()) {
    if (row.groupId !== null && rowGroups.get(row.id) !== row.groupId) fail("Accounting group row membership is incomplete.");
    if (row.sourceRepresentation === "native-part-only" && instances.get(row.recordId)?.coverageRowId !== row.id) fail("Native-only coverage has no exact instance link.");
  }
  for (const instance of instances.values()) {
    if (instance.enabledMeaning !== "unqualified") fail("Raw ENABLE values cannot establish enabled inspection meaning.");
    if (instance.groupId !== null && memberGroups.get(instance.id) !== instance.groupId) fail("Native group membership is incomplete.");
    if (instance.coverageRowId && rows.get(instance.coverageRowId)?.recordId !== instance.id) fail("Native-only row identity is inconsistent.");
  }
  for (const blocker of blockers.values()) checkLinks(blocker.affectedRowIds, id => rows.has(id));
  for (const finding of findings.values()) {
    if (finding.repairEligibility !== "unqualified" || (finding.groupId !== null && !groups.has(finding.groupId))) fail("Native findings must retain unqualified repair meaning and exact group links.");
    if (!Array.isArray(finding.sourcePaths)) fail("Native source paths are invalid.");
    boundedCount(finding.sourcePaths.length);
    links += finding.sourcePaths.length;
    if (links > 100_000) fail("Native source links exceed supported bounds.");
  }
  for (const work of report.remainingWork) {
    if ((Boolean(work.findingId) === Boolean(work.blockerId)) || (work.findingId && !findings.has(work.findingId)) || (work.blockerId && !blockers.has(work.blockerId)) || (work.groupId && !groups.has(work.groupId))) fail("Native work item has no exact finding or blocker basis.");
  }
  return { rows, instances, groups, findings, blockers };
}

// CSV exports are normalized tables distinguished by record_type. Membership is
// emitted once rather than multiplying every CAD row by every matching part.
class BoundedCsv {
  private chunks: string[] = [];
  private bytes = 0;
  append(values: (string | number | null | undefined)[]) {
    const line = values.map(value => {
      let text = value == null ? "" : String(value);
      if (encoder.encode(text).length > MAX_NATIVE_CSV_CELL_BYTES) fail("A complete CSV cell exceeds 32 KiB. Download the native accounting JSON instead; no values were truncated.");
      // Quoting alone does not stop spreadsheet formula execution.
      if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    }).join(",") + "\r\n";
    this.bytes += encoder.encode(line).length;
    if (this.bytes > MAX_NATIVE_CSV_BYTES) fail("Complete native CSV exceeds 3 MB. Download the native accounting JSON instead; no rows were truncated.");
    this.chunks.push(line);
  }
  finish() { return this.chunks.join(""); }
}

function literalArray(values: string[]): string {
  if (!Array.isArray(values) || values.length > MAX_RECORDS || values.some(value => typeof value !== "string" || value.length > 2048)) fail("Raw native literals are outside supported bounds.");
  return JSON.stringify(values);
}

export function componentCoverageCsv(report: NativeAccounting): string {
  const { groups } = indexReport(report);
  const csv = new BoundedCsv(), source = report.sourceContext!;
  csv.append(["record_type", "accounting_id", "source_record_id", "group_id", "snapshot_id", "job_sha256", "module_literal", "reference_literal", "source_path", "source_representation", "native_correspondence", "native_id_literals_json", "enable_literals_json_unqualified", "native_preparation", "existing_teaching", "exclusion", "enabled_state", "fresh_image_verification", "release"]);
  for (const row of report.componentCoverage) csv.append([
    "component", row.id, row.recordId, row.groupId, source.snapshotId, source.jobSha256,
    row.moduleLiteral, row.referenceLiteral, row.sourcePath, row.sourceRepresentation,
    row.nativeCorrespondence, null, null, row.nativePreparation, row.existingTeaching,
    row.exclusion, row.enabledState, row.verification, row.release,
  ]);
  for (const instance of report.nativeInstances) {
    const group = groups.get(instance.groupId ?? "");
    csv.append(["native-instance", instance.coverageRowId, instance.id, instance.groupId, source.snapshotId, source.jobSha256,
      group?.moduleLiteral, group?.referenceLiteral, instance.sourcePath, "native-part-instance", "group_id-links-exact-members",
      literalArray(instance.nativeIdLiterals), literalArray(instance.enableLiterals), "not-prepared", "unassessed", "not-assessed", "unqualified", "not-verified", "not-assessed"]);
  }
  return csv.finish();
}

export function remainingNativeWorkCsv(report: NativeAccounting): string {
  const { groups, findings, blockers } = indexReport(report);
  const csv = new BoundedCsv(), source = report.sourceContext!;
  csv.append(["record_type", "work_id", "subject_id", "group_id", "accounting_id", "snapshot_id", "module_literal", "reference_literal", "source_path", "reason", "next_action", "status"]);
  for (const work of report.remainingWork) {
    const finding = findings.get(work.findingId ?? ""), blocker = blockers.get(work.blockerId ?? "");
    const group = groups.get(work.groupId ?? finding?.groupId ?? "");
    csv.append(["work", work.id, work.findingId ?? work.blockerId, group?.id, null, source.snapshotId,
      group?.moduleLiteral ?? blocker?.moduleLiteral, group?.referenceLiteral, null,
      finding?.message ?? blocker?.reason, work.nextAction, "not-completed"]);
  }
  for (const group of groups.values()) for (const rowId of group.affectedRowIds) csv.append([
    "group-accounting-link", null, group.id, group.id, rowId, source.snapshotId,
    group.moduleLiteral, group.referenceLiteral, null, null, null, "observation-link",
  ]);
  for (const blocker of blockers.values()) for (const rowId of blocker.affectedRowIds) csv.append([
    "blocker-accounting-link", null, blocker.id, null, rowId, source.snapshotId,
    blocker.moduleLiteral, null, null, null, null, "unresolved-link",
  ]);
  for (const finding of findings.values()) for (const path of finding.sourcePaths) csv.append([
    "finding-source-link", null, finding.id, finding.groupId, null, source.snapshotId,
    null, null, path, null, null, "observation-link",
  ]);
  return csv.finish();
}
