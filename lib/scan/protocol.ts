export const SCAN_PROTOCOL_VERSION = "0.1" as const;

export type ScanProtocolVersion = typeof SCAN_PROTOCOL_VERSION;
export type SnapshotRole = "main" | "temp" | "backup" | "unknown";
export type AnalysisStatus = "success" | "blocked" | "unsupported";
export type ScanUnits = "mm" | "in" | "unknown";

export type CoverageCounts = Readonly<{
  represented: number | null;
  enabled: number | null;
  taught: number | null;
  verified: number | null;
  released: number | null;
}>;

export type SnapshotSelection = Readonly<{
  id: string;
  role: SnapshotRole;
  sha256: string;
}>;

export type ScanRequest = Readonly<{
  protocolVersion: ScanProtocolVersion;
  runId: string;
  buildVersion: string;
  adapterVersion: string;
  selectedSnapshot: SnapshotSelection;
  sourceHashes: Readonly<Record<string, string>>;
  units: ScanUnits;
  coordinateFrame: string;
}>;

export type ScanFinding = Readonly<{
  id: string;
  code: string;
  title: string;
}>;

export type ScanResult = Readonly<{
  protocolVersion: ScanProtocolVersion;
  runId: string;
  buildVersion: string;
  adapterVersion: string;
  selectedSnapshot: SnapshotSelection;
  sourceHashes: Readonly<Record<string, string>>;
  units: ScanUnits;
  coordinateFrame: string;
  status: AnalysisStatus;
  blockedReasons: readonly string[];
  unsupportedReasons: readonly string[];
  findings: readonly ScanFinding[];
  coverage: CoverageCounts;
}>;

const SHA256_RE = /^[0-9a-f]{64}$/i;
const SNAPSHOT_ROLES = new Set<SnapshotRole>(["main", "temp", "backup", "unknown"]);
const UNITS = new Set<ScanUnits>(["mm", "in", "unknown"]);
const STATUSES = new Set<AnalysisStatus>(["success", "blocked", "unsupported"]);

export class ScanProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScanProtocolError";
    this.code = code;
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ScanProtocolError("INVALID_TYPE", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ScanProtocolError("INVALID_STRING", `${label} must be a non-empty string`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const text = nonEmptyString(value, label).toLowerCase();
  if (!SHA256_RE.test(text)) {
    throw new ScanProtocolError(
      "INVALID_SHA256",
      `${label} must be a 64-character SHA-256 hex digest`,
    );
  }
  return text;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new ScanProtocolError("INVALID_TYPE", `${label} must be an array`);
  }
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
}

function nullableCount(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ScanProtocolError(
      "INVALID_COUNT",
      `${label} must be null or a non-negative safe integer`,
    );
  }
  return value;
}

function parseSnapshot(value: unknown): SnapshotSelection {
  const input = record(value, "selectedSnapshot");
  const role = nonEmptyString(input.role, "selectedSnapshot.role") as SnapshotRole;
  if (!SNAPSHOT_ROLES.has(role)) {
    throw new ScanProtocolError(
      "INVALID_SNAPSHOT_ROLE",
      "selectedSnapshot.role is unsupported",
    );
  }
  return Object.freeze({
    id: nonEmptyString(input.id, "selectedSnapshot.id"),
    role,
    sha256: sha256(input.sha256, "selectedSnapshot.sha256"),
  });
}

function parseHashes(value: unknown): Readonly<Record<string, string>> {
  const input = record(value, "sourceHashes");
  const names = Object.keys(input).sort();
  if (names.length === 0) {
    throw new ScanProtocolError(
      "MISSING_SOURCE",
      "sourceHashes must contain at least one source",
    );
  }

  const result: Record<string, string> = {};
  for (const name of names) {
    const normalizedName = nonEmptyString(name, "sourceHashes key");
    result[normalizedName] = sha256(
      input[name],
      `sourceHashes.${normalizedName}`,
    );
  }
  return Object.freeze(result);
}

function parseCoverage(value: unknown): CoverageCounts {
  const input = record(value, "coverage");
  return Object.freeze({
    represented: nullableCount(input.represented, "coverage.represented"),
    enabled: nullableCount(input.enabled, "coverage.enabled"),
    taught: nullableCount(input.taught, "coverage.taught"),
    verified: nullableCount(input.verified, "coverage.verified"),
    released: nullableCount(input.released, "coverage.released"),
  });
}

function parseFindings(value: unknown): readonly ScanFinding[] {
  if (!Array.isArray(value)) {
    throw new ScanProtocolError("INVALID_TYPE", "findings must be an array");
  }

  const ids = new Set<string>();
  const findings = value.map((item, index) => {
    const input = record(item, `findings[${index}]`);
    const id = nonEmptyString(input.id, `findings[${index}].id`);
    if (ids.has(id)) {
      throw new ScanProtocolError(
        "DUPLICATE_FINDING_ID",
        `duplicate finding id: ${id}`,
      );
    }
    ids.add(id);

    return Object.freeze({
      id,
      code: nonEmptyString(input.code, `findings[${index}].code`),
      title: nonEmptyString(input.title, `findings[${index}].title`),
    });
  });

  return Object.freeze(findings);
}

function parseVersion(value: unknown): ScanProtocolVersion {
  if (value !== SCAN_PROTOCOL_VERSION) {
    throw new ScanProtocolError(
      "UNSUPPORTED_PROTOCOL_VERSION",
      `protocolVersion must equal ${SCAN_PROTOCOL_VERSION}`,
    );
  }
  return SCAN_PROTOCOL_VERSION;
}

function parseUnits(value: unknown): ScanUnits {
  const units = nonEmptyString(value, "units") as ScanUnits;
  if (!UNITS.has(units)) {
    throw new ScanProtocolError(
      "INVALID_UNITS",
      "units must be mm, in, or unknown",
    );
  }
  return units;
}

export function parseScanRequest(value: unknown): ScanRequest {
  const input = record(value, "request");
  return Object.freeze({
    protocolVersion: parseVersion(input.protocolVersion),
    runId: nonEmptyString(input.runId, "runId"),
    buildVersion: nonEmptyString(input.buildVersion, "buildVersion"),
    adapterVersion: nonEmptyString(input.adapterVersion, "adapterVersion"),
    selectedSnapshot: parseSnapshot(input.selectedSnapshot),
    sourceHashes: parseHashes(input.sourceHashes),
    units: parseUnits(input.units),
    coordinateFrame: nonEmptyString(
      input.coordinateFrame,
      "coordinateFrame",
    ),
  });
}

export function parseScanResult(value: unknown): ScanResult {
  const input = record(value, "result");
  const status = nonEmptyString(input.status, "status") as AnalysisStatus;
  if (!STATUSES.has(status)) {
    throw new ScanProtocolError(
      "INVALID_STATUS",
      "status must be success, blocked, or unsupported",
    );
  }

  const blockedReasons = Object.freeze(
    stringArray(input.blockedReasons, "blockedReasons"),
  );
  const unsupportedReasons = Object.freeze(
    stringArray(input.unsupportedReasons, "unsupportedReasons"),
  );

  if (
    status === "success" &&
    (blockedReasons.length > 0 || unsupportedReasons.length > 0)
  ) {
    throw new ScanProtocolError(
      "CONTRADICTORY_STATUS",
      "success cannot contain blocked or unsupported reasons",
    );
  }

  if (
    status === "blocked" &&
    (blockedReasons.length === 0 || unsupportedReasons.length > 0)
  ) {
    throw new ScanProtocolError(
      "CONTRADICTORY_STATUS",
      "blocked requires blockedReasons only",
    );
  }

  if (
    status === "unsupported" &&
    (unsupportedReasons.length === 0 || blockedReasons.length > 0)
  ) {
    throw new ScanProtocolError(
      "CONTRADICTORY_STATUS",
      "unsupported requires unsupportedReasons only",
    );
  }

  return Object.freeze({
    protocolVersion: parseVersion(input.protocolVersion),
    runId: nonEmptyString(input.runId, "runId"),
    buildVersion: nonEmptyString(input.buildVersion, "buildVersion"),
    adapterVersion: nonEmptyString(input.adapterVersion, "adapterVersion"),
    selectedSnapshot: parseSnapshot(input.selectedSnapshot),
    sourceHashes: parseHashes(input.sourceHashes),
    units: parseUnits(input.units),
    coordinateFrame: nonEmptyString(
      input.coordinateFrame,
      "coordinateFrame",
    ),
    status,
    blockedReasons,
    unsupportedReasons,
    findings: parseFindings(input.findings),
    coverage: parseCoverage(input.coverage),
  });
}

export function createEmptyCoverage(): CoverageCounts {
  return Object.freeze({
    represented: null,
    enabled: null,
    taught: null,
    verified: null,
    released: null,
  });
}
