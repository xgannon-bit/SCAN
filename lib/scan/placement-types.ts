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
  status: "success" | "blocked";
  artifactType: "scan.normalized-placements";
  sourceSha256: string;
  counts: { sourceRows: number; parsed: number; skippedBlank: number; errors: number; warnings: number };
  holds: string[];
  issues: { row: number; severity: string; message: string }[];
  placements: { placementId: string; module: string; side: string; refdes: string; mpn: string | null; xMm: string | null; yMm: string | null; rotationCcwDegrees: string | null }[];
  machineExportAllowed: false;
};
