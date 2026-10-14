export type PlacementConfig = {
  csvRecovery?: boolean;
  encoding?: "utf-8" | "windows-1252";
  startRow: number;
  columns: Record<string, number>;
  module: string;
  side: string;
  units: string;
  rotationDirection: string;
  decimalSeparator: string;
  pairSeparator: string;
};
/** Guard saved source-derived requests before they can become review authority. */
export function validatePlacementConfig(value: unknown): PlacementConfig {
  const c = value as PlacementConfig;
  const keys = ["startRow", "columns", "module", "side", "units", "rotationDirection", "decimalSeparator", "pairSeparator", ...(c && Object.hasOwn(c, "encoding") ? ["encoding"] : []), ...(c && Object.hasOwn(c, "csvRecovery") ? ["csvRecovery"] : [])];
  const text = (v: unknown) => typeof v === "string" && v.length <= 256 && !v.includes("\0");
  if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).sort().join() !== keys.sort().join() || !Number.isInteger(c.startRow) || c.startRow < 1 || c.startRow > 10000 || !text(c.module) || !text(c.side)) throw new Error("Invalid diagnosis placement mapping.");
  if (!c.columns || typeof c.columns !== "object" || Array.isArray(c.columns) || !c.columns.refdes || Object.keys(c.columns).some(k => !["refdes", "mpn", "x", "y", "xy", "rotation", "side", "module", "footprint"].includes(k)) || Object.values(c.columns).some(v => !Number.isInteger(v) || v < 1 || v > 64) || new Set(Object.values(c.columns)).size !== Object.keys(c.columns).length || (c.columns.xy ? !!c.columns.x || !!c.columns.y : !c.columns.x || !c.columns.y)) throw new Error("Diagnosis needs distinct identity and coordinate columns.");
  if (!["unknown", "mm", "inch", "mil"].includes(c.units) || !["unknown", "cw", "ccw"].includes(c.rotationDirection) || ![".", ","].includes(c.decimalSeparator) || ![",", ";", "space"].includes(c.pairSeparator) || (Object.hasOwn(c, "encoding") && !["utf-8", "windows-1252"].includes(c.encoding!)) || (Object.hasOwn(c, "csvRecovery") && typeof c.csvRecovery !== "boolean")) throw new Error("Invalid diagnosis placement convention.");
  return c;
}

export type PlacementPreview = {
  status: "success";
  artifactType: "scan.placement-preview";
  interpretationWarnings?: string[];
  sourceSha256: string;
  sheets: { index: number; name: string }[];
  sheetIndex: number;
  rowCount: number;
  columnCount: number;
  headerCandidates?: { sourceRow: number; values: (string | number | boolean | null)[] }[];
  preview: (string | number | boolean | null)[][];
};

export type PlacementResult = {
  normalizerVersion?: string; delimiter?: string; interpretationSha256?: string;
  status: "success" | "blocked";
  artifactType: "scan.normalized-placements";
  interpretationWarnings?: string[];
  sourceSha256: string;
  schemaVersion: "1";
  sheetIndex: number;
  mapping: PlacementConfig;
  coordinateFrame: string;
  coverage: { represented: null; enabled: null; taught: null; verified: null; released: null };
  counts: { sourceRows: number; parsed: number; skippedBlank: number; errors: number; warnings: number };
  holds: string[];
  issues: { row: number; severity: "error" | "warning"; code: "DUPLICATE_IDENTITY" | "MPN_MISSING" | "SOURCE_ROW_INVALID"; message: string }[];
  placements: { placementId: string; module: string; side: string; refdes: string; mpn: string | null; footprint: string | null; sourceRow: number; sourceCoordinates: { x: string; y: string; rotation: string }; xMm: string | null; yMm: string | null; rotationCcwDegrees: string | null }[];
  machineExportAllowed: false;
};
