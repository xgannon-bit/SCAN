import type { ArchiveReview, SnapshotPreflight } from "./archive-types";

type FileRecord = SnapshotPreflight["preservedFiles"][number];
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const name = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
const size = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const invalid = () => { throw new Error("Use two freshly verified archive selections. A saved JSON report cannot qualify a writer."); };

function verify(review: ArchiveReview) {
  const report = review?.preflight;
  if (review?.artifactType !== "scan.archive-review" || review.schemaVersion !== "1" || review.status !== "success" || review.machineExportAllowed !== false || review.candidateId !== null ||
      !report || report.artifactType !== "scan.snapshot-preflight" || report.schemaVersion !== "1" || report.status !== "success" || report.machineExportAllowed !== false || report.nativeSchemaSupported !== false || report.candidateId !== null ||
      report.integrity?.allArchivedFilesVerified !== true || report.integrity?.status !== "verified-against-capture-hash" ||
      !hash(report.source?.sha256) || !hash(report.packageSha256) || !hash(report.snapshotId) || !size(report.source.size) ||
      review.capture?.packageSha256 !== report.packageSha256 || review.capture?.snapshotId !== report.snapshotId || !name(report.selection?.root) ||
      !Array.isArray(report.preservedFiles) || !report.preservedFiles.length || report.preservedFiles.length > 10_000 || !Array.isArray(report.preservedDirectories) || report.preservedDirectories.length > 10_000) invalid();
  const files = new Map<string, FileRecord>();
  const seen = new Set<string>();
  for (const file of report.preservedFiles) {
    if (!name(file.path) || !name(file.originalName) || !hash(file.sha256) || !size(file.size) || seen.has(file.path.toLowerCase())) invalid();
    files.set(file.path, file); seen.add(file.path.toLowerCase());
  }
  for (const directory of report.preservedDirectories) {
    if (!name(directory) || seen.has(directory.toLowerCase())) invalid();
    seen.add(directory.toLowerCase());
  }
  for (const selected of [report.selection.job, report.selection.master]) {
    if (selected === null) continue;
    if (!selected || !name(selected.member) || !["main", "temp", "backup"].includes(selected.role)) invalid();
    const actual = files.get(selected.member);
    if (!actual || selected.sha256 !== actual.sha256 || selected.size !== actual.size) invalid();
  }
  if (!report.selection.job || !report.xmlEnvelopes?.job || (report.selection.master && !report.xmlEnvelopes.master)) invalid();
  return { report, files };
}

/** Evidence about bytes only. No combination of reports or observations can enable a native writer. */
export function buildNativeQualification(before: ArchiveReview, after: ArchiveReview, applicationVersion: string) {
  const left = verify(before), right = verify(after);
  const version = applicationVersion.trim();
  if (version.length > 128 || /[\x00-\x1f]/.test(version)) throw new Error("Enter an Eagle software version of at most 128 characters.");
  const files = [...new Set([...left.files.keys(), ...right.files.keys()])].sort().map(path => {
    const original = left.files.get(path), returned = right.files.get(path);
    const state: "added" | "removed" | "changed" | "unchanged" = !original ? "added" : !returned ? "removed" : original.sha256 !== returned.sha256 || original.size !== returned.size ? "changed" : "unchanged";
    return { path, state, before: original ?? null, after: returned ?? null };
  });
  const directories = [...new Set([...left.report.preservedDirectories, ...right.report.preservedDirectories])].sort().map(path => ({
    path, state: !left.report.preservedDirectories.includes(path) ? "added" : !right.report.preservedDirectories.includes(path) ? "removed" : "unchanged",
  }));
  const counts = { unchanged: 0, changed: 0, added: 0, removed: 0 };
  for (const file of files) counts[file.state]++;
  const sameSelection = left.report.selection.root === right.report.selection.root && (["job", "master"] as const).every(role => {
    const first = left.report.selection[role], second = right.report.selection[role];
    return first === null ? second === null : second !== null && first.member === second.member && first.role === second.role;
  });
  const payloadsEqual = counts.changed + counts.added + counts.removed === 0;
  const directoryEntriesEqual = directories.every(directory => directory.state === "unchanged");
  const holds = [
    { code: "NATIVE_FORMAT_UNQUALIFIED", reason: "No Eagle/Athena semantic reader or writer is qualified. Byte equality cannot establish model, inspection or dependency correctness.", nextAction: "Qualify the exact software/schema version against approved format evidence and independent fixtures." },
    { code: "EAGLE_EXECUTION_NOT_VERIFIED", reason: "SCAN has not observed Eagle load/save/reopen. Selecting an archive or typing a version does not verify machine compatibility.", nextAction: "An authorized operator must test the exact candidate in the intended Eagle build and retain its hashes and results." },
  ];
  if (!version) holds.push({ code: "SOFTWARE_VERSION_MISSING", reason: "The intended Eagle build has not been recorded.", nextAction: "Record the complete Eagle software version from the intended installation." });
  if (!sameSelection) holds.push({ code: "SNAPSHOT_SELECTION_CHANGED", reason: "Root, job/master member or snapshot role differs between selections. Correspondence has not been established.", nextAction: "Select corresponding snapshots explicitly; renamed or reorganized jobs require a qualified mapping." });
  if (!left.report.selection.master || !right.report.selection.master) holds.push({ code: "MASTER_NOT_SELECTED", reason: "At least one archive has no selected master. Required master dependencies remain unknown.", nextAction: "Select the required master through the approved job workflow." });
  if (!payloadsEqual || !directoryEntriesEqual) holds.push({ code: "ARCHIVE_CONTENT_CHANGED", reason: "The archives contain different files, file bytes or explicit directory entries. Changes have not been approved or classified by a native adapter.", nextAction: "Review every change and resolve deleted or altered assets before considering native writing." });
  if ([left.report, right.report].some(report => Object.values(report.xmlEnvelopes).some(envelope => envelope.status !== "well-formed"))) holds.push({ code: "XML_PREFLIGHT_BLOCKED", reason: "A selected XML document failed preflight.", nextAction: "Resolve the XML failure before attempting native interpretation." });
  for (const [side, source] of [["before", left.report], ["after", right.report]] as const) {
    for (const hold of source.holds.filter(item => item.code.startsWith("NATIVE_RECORDS_") || item.code === "NATIVE_SCALAR_AMBIGUITY")) {
      holds.push({ code: `${side.toUpperCase()}_${hold.scope}_${hold.code}`, reason: `${side} ${hold.scope}: ${hold.reason}`, nextAction: hold.nextAction });
    }
  }
  return {
    artifactType: "scan.native-qualification-review" as const, schemaVersion: "1", comparatorVersion: "file-integrity-1",
    classification: "Native writer qualification evidence only; no candidate generated",
    application: { product: "PEMTRON Eagle / ATHENA", reportedVersion: version || null, versionVerified: false },
    before: { archiveSha256: left.report.source.sha256, captureSha256: left.report.packageSha256, snapshotId: left.report.snapshotId, selection: left.report.selection },
    after: { archiveSha256: right.report.source.sha256, captureSha256: right.report.packageSha256, snapshotId: right.report.snapshotId, selection: right.report.selection },
    comparison: { scope: "All archived file payloads and explicit directory entries; no semantic interpretation", archiveBytesEqual: left.report.source.sha256 === right.report.source.sha256, filePayloadsEqual: payloadsEqual, directoryEntriesEqual, sameSelection, counts, files, directories },
    holds, nativeAdapter: null, candidateId: null, machineExportAllowed: false,
    readiness: { packageComplete: null, offlinePreparationCoverage: null, machineCompatibility: null, opticalTeachingValidation: null, productionRelease: null },
  };
}

export type NativeQualification = ReturnType<typeof buildNativeQualification>;

export function nativeQualificationText(report: NativeQualification) {
  return ["SCAN — NATIVE OUTPUT QUALIFICATION REVIEW", report.classification,
    `Eagle version (user supplied, unverified): ${report.application.reportedVersion ?? "Unknown"}`,
    ...(["before", "after"] as const).flatMap(role => {
      const source = report[role];
      return [`${role.toUpperCase()} archive SHA-256: ${source.archiveSha256}`, `Capture SHA-256: ${source.captureSha256}`, `Snapshot ID: ${source.snapshotId}`, `Root: ${source.selection.root}`, `Job: ${source.selection.job.role} | ${source.selection.job.member} | ${source.selection.job.sha256}`, `Master: ${source.selection.master ? `${source.selection.master.role} | ${source.selection.master.member} | ${source.selection.master.sha256}` : "Explicitly not selected"}`];
    }), "", `Archive bytes equal: ${report.comparison.archiveBytesEqual}`, `File payloads equal: ${report.comparison.filePayloadsEqual}`, `Explicit directory entries equal: ${report.comparison.directoryEntriesEqual}`, `Same snapshot selection: ${report.comparison.sameSelection}`, "", "ALL FILES",
    ...report.comparison.files.map(file => `${file.state.toUpperCase()} | ${file.path}\nBefore: ${file.before?.sha256 ?? "Absent"} (${file.before?.size ?? 0} bytes)\nAfter: ${file.after?.sha256 ?? "Absent"} (${file.after?.size ?? 0} bytes)`),
    "", "EXPLICIT DIRECTORIES", ...report.comparison.directories.map(directory => `${directory.state.toUpperCase()} | ${directory.path}`),
    "", "UNRESOLVED QUALIFICATION GATES", ...report.holds.map(hold => `${hold.code}: ${hold.reason}\nNext: ${hold.nextAction}`),
    "", "No native job was generated. Eagle execution, dependency completeness, optical teaching and production release remain unverified.",
  ].join("\n") + "\n";
}
