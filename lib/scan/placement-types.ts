export type PlacementConfig = {
  startRow: number;
  columns: Record<string, number>;
  module: string;
  side: string;
  units: string;
  rotationDirection: string;
  decimalSeparator: string;
  pairSeparator: string;
};

export type PlacementPreview = {
  status: "success";
  artifactType: "scan.placement-preview";
  sourceSha256: string;
  sheets: { index: number; name: string }[];
  sheetIndex: number;
  rowCount: number;
  columnCount: number;
  preview: (string | number | boolean | null)[][];
};

export type PlacementResult = {
  normalizerVersion?: string; delimiter?: string; interpretationSha256?: string;
  status: "success" | "blocked";
  artifactType: "scan.normalized-placements";
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
