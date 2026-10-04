export type GerberConfig = { formatOverride: string | null; assumeLinear: boolean };
export type GerberObject = { instance_id: string; operation: "flash" | "draw"; aperture_d_code: number; polarity: "dark" | "clear"; start_x: string | null; start_y: string | null; end_x: string; end_y: string };
export type GerberResult = {
  status: "success" | "blocked" | "unsupported"; source_sha256: string; source_size: number; adapter_version: string;
  units: "mm" | "in" | "unknown"; coordinate_format: { x_integer: number; x_decimal: number; y_integer: number; y_decimal: number } | null;
  declared_coordinate_format: GerberResult["coordinate_format"];
  apertures: { d_code: number; template: "C" | "R" | "O" | "P"; parameters: string[] }[]; objects: GerberObject[];
  interpretation_overrides: string[]; warnings: string[]; blocked_reasons: string[]; unsupported_features: string[]; geometry_complete: boolean;
};
export type AlignmentPoint = { id: string; role: "fit" | "check"; cad: [string, string]; gerber: [string, string]; evidence: string };
export type AlignmentScope = { module: string; side: string; boardInstance: string };
export type AlignmentResult = {
  status: "success" | "blocked"; artifactType: "scan.rigid-alignment"; basis: string; fingerprint: string;
  scope: AlignmentScope; toleranceMm: number; maxResidualMm: number;
  transform: { matrix: [[number, number, number], [number, number, number]]; angleDegrees: number; scale: 1; mirror: false };
  residuals: { id: string; role: string; predictedMm: number[]; residualMm: number; withinTolerance: boolean }[];
  holds: string[]; qualification: string; machineExportAllowed: false;
};
