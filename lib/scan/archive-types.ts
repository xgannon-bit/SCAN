export type SnapshotRole = "main" | "temp" | "backup";
export type ArchiveSelection = { root: string; jobMember: string; jobRole: SnapshotRole; masterMember: string | null; masterRole: SnapshotRole | null };
export type ArchiveInventory = {
  status: "success" | "blocked" | "unsupported";
  archive_sha256: string; archive_size: number; entry_count: number; total_uncompressed: number;
  entries: { path: string; size: number; compressed_size: number; is_directory: boolean; kind: string; snapshot_role: string }[];
  job_roots: { root: string; job_name: string; main_candidates: string[]; temp_candidates: string[]; backup_candidates: string[]; master_candidates: string[]; image_candidates: string[]; history_candidates: string[] }[];
  reasons: string[];
};
export type SnapshotPreflight = {
  status: "success"; code: "PREFLIGHT_RECORDED"; artifactType: "scan.snapshot-preflight"; schemaVersion: "1";
  readerVersion: string; packageSha256: string; snapshotId: string;
  source: { sha256: string; size: number; storedPath: string };
  selection: { root: string; job: { member: string; role: SnapshotRole; sha256: string; size: number }; master: { member: string; role: SnapshotRole; sha256: string; size: number } | null };
  integrity: { status: "verified-against-capture-hash"; allArchivedFilesVerified: true };
  preservedFiles: { originalName: string; path: string; size: number; sha256: string; kind: string; inventoryRole: string }[];
  preservedDirectories: string[];
  nativeRecords: Record<string, { status: "recorded" | "blocked" | "unsupported"; reason?: string; readerProfile?: string; schemaVersionClaim?: string; records: { kind: string; sourcePath: string; rawFields: Record<string, string[]> }[]; duplicateScalarFields?: { sourcePath: string; field: string }[]; countsByRecordKind?: Record<string, number> }>;
  xmlEnvelopes: Record<string, { status: "well-formed" | "blocked"; code?: string; reason?: string; rootName?: string; elementCount?: number; versionClaims?: unknown[] }>;
  readiness: { packageComplete: null; offlinePreparationCoverage: null; machineCompatibility: null; opticalTeachingValidation: null; productionRelease: null };
  coverage: { represented: null; enabled: null; taught: null; verified: null; released: null };
  nativeSchemaSupported: false; machineExportAllowed: false; candidateId: null;
  holds: { code: string; scope: string; reason: string; nextAction: string }[];
};
export type ArchiveReview = {
  status: "success"; code: "ARCHIVE_PREFLIGHT_RECORDED"; artifactType: "scan.archive-review"; schemaVersion: "1";
  capture: { snapshotId: string; packageSha256: string; size: number };
  preflight: SnapshotPreflight; machineExportAllowed: false; candidateId: null;
};
