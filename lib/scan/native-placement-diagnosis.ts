import { validatePlacementConfig, type PlacementConfig } from "./placement-types";
import { validateBomConfig, type BomConfig } from "./bom-types";
import { validatePackageProfiles, type PackageProfile } from "./package-profiles";

/** A reviewed interpretation for an offline experiment, never machine qualification. */
export type NativeDiagnosisSettings = {
  schemaVersion: "1"; module: string; sourceRevision: string; nativeRevision: string; bomRevision: string;
  sourceSide: "top" | "bottom" | "unknown"; nativeSide: "top" | "bottom" | "unknown";
  nativeUnits: "mm" | "mil" | "unknown"; nativeYDirection: "up" | "down" | "unknown";
  nativeRotation: "ccw" | "cw" | "unknown"; nativeRoiAnchor: "body-center" | "footprint-origin" | "unknown";
  frameStatement: string; toleranceMm: string; toleranceBasis: string;
  fitReferences: string[]; checkReferences: string[]; framesConfirmed: boolean;
};
export type NativeDiagnosisDraft = { settings: NativeDiagnosisSettings; reviewer: string };
export type NativeDiagnosisContext = {
  schemaVersion: "1"; settings: NativeDiagnosisSettings;
  source: { layoutSha256: string; placementSha256: string; bomSha256: string };
  placementConfig: { config: PlacementConfig; sheet: number; delimiter: string };
  bomConfig: { config: BomConfig; sheet: number; delimiter: string };
  packageProfiles: PackageProfile[]; diagnosisSha256?: string;
};
export type NativeDiagnosisRow = {
  sourcePath: string; identity: Record<"ID" | "ParentId" | "MasterKey" | "RefID", string>;
  beforeRoi: Record<"cx" | "cy" | "w" | "h" | "a", string>;
  classification: string; sourceAnchor: string; footprintOrigin: number[] | null; bodyCenter: number[] | null;
  proposedCenterNative: number[] | null; proposals: { field: "Roi/cx" | "Roi/cy"; before: string; after: string }[];
  holds: { code: string; message: string }[]; dependencyHolds: { code: string; message: string }[]; completeRepairClaimHeld: true;
  bodyProfileId?: string; drawingSha256?: string | null;
  originalMasterCenterNative?: number[] | null; masterSupportsSourceDatum?: boolean;
  bodyLocalOffsetMm?: number[] | null; withinBodyEnvelope?: boolean | null;
  dependencyInventory: Record<string, unknown>; existingEnabledLiteral: string | null;
};
export type NativeDiagnosisReport = {
  artifactType: "scan.native-placement-diagnosis"; schemaVersion: "1"; status: "success";
  diagnosisSha256: string; settings: NativeDiagnosisSettings; source: NativeDiagnosisContext["source"] & Record<string, string>;
  frame: { transform: { angleDegrees: number; matrix: number[][] } | null; holds: { code: string; message: string }[]; controls: unknown; interpretation: unknown };
  sourceRegistration?: { transform: { angleDegrees: number; matrix: number[][] } | null; controls: unknown; interpretation: string };
  rows: NativeDiagnosisRow[]; counts: { nativeParts: number; alreadyAligned: number; supportedQualificationRows: number; proposedScalars: number; held: number; completeRepairs: number };
};
export const emptyNativeDiagnosis = (): NativeDiagnosisDraft => ({ reviewer: "", settings: {
  schemaVersion: "1", module: "", sourceRevision: "", nativeRevision: "", bomRevision: "",
  sourceSide: "unknown", nativeSide: "unknown", nativeUnits: "unknown", nativeYDirection: "unknown",
  nativeRotation: "unknown", nativeRoiAnchor: "unknown", frameStatement: "", toleranceMm: "0.01",
  toleranceBasis: "", fitReferences: [], checkReferences: [], framesConfirmed: false,
} });
export function validateNativeDiagnosisDraft(value: unknown): NativeDiagnosisDraft {
  const d = value as NativeDiagnosisDraft;
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !v.includes("\0");
  if (!d || Object.keys(d).sort().join() !== "reviewer,settings" || !text(d.reviewer, 256)) throw new Error("Invalid saved native diagnosis draft.");
  const s = d.settings, expected = Object.keys(emptyNativeDiagnosis().settings).sort().join();
  if (!s || Object.keys(s).sort().join() !== expected || s.schemaVersion !== "1" || typeof s.framesConfirmed !== "boolean") throw new Error("Invalid native frame contract.");
  for (const key of ["module", "sourceRevision", "nativeRevision", "bomRevision"] as const) if (!text(s[key], 256)) throw new Error("Invalid native frame scope.");
  if (!text(s.frameStatement, 3000) || !text(s.toleranceBasis, 2000) || !text(s.toleranceMm, 40)) throw new Error("Invalid native frame evidence.");
  for (const key of ["fitReferences", "checkReferences"] as const) if (!Array.isArray(s[key]) || s[key].length > 32 || new Set(s[key]).size !== s[key].length || s[key].some(v => !text(v, 256) || !v.trim())) throw new Error("Invalid frame control references.");
  for (const key of ["sourceSide", "nativeSide"] as const) if (!["top", "bottom", "unknown"].includes(s[key])) throw new Error("Invalid frame side.");
  if (!["mm", "mil", "unknown"].includes(s.nativeUnits) || !["up", "down", "unknown"].includes(s.nativeYDirection) || !["ccw", "cw", "unknown"].includes(s.nativeRotation) || !["body-center", "footprint-origin", "unknown"].includes(s.nativeRoiAnchor)) throw new Error("Invalid native coordinate convention.");
  return d;
}
export function validateNativeDiagnosisContext(value: unknown): NativeDiagnosisContext {
  const c = value as NativeDiagnosisContext;
  const keys = ["schemaVersion", "settings", "source", "placementConfig", "bomConfig", "packageProfiles", ...(c && Object.hasOwn(c, "diagnosisSha256") ? ["diagnosisSha256"] : [])].sort().join();
  if (!c || Object.keys(c).sort().join() !== keys || c.schemaVersion !== "1" || JSON.stringify(c).length > 800000) throw new Error("Invalid diagnosis evidence context.");
  validateNativeDiagnosisDraft({ settings: c.settings, reviewer: "" });
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (!c.source || Object.keys(c.source).sort().join() !== "bomSha256,layoutSha256,placementSha256" || !Object.values(c.source).every(hash) || (Object.hasOwn(c, "diagnosisSha256") && !hash(c.diagnosisSha256))) throw new Error("Invalid diagnosis source hashes.");
  for (const config of [c.placementConfig, c.bomConfig]) if (!config || Object.keys(config).sort().join() !== "config,delimiter,sheet" || !Number.isInteger(config.sheet) || config.sheet < 0 || config.sheet > 19 || ![",", ";", "\t"].includes(config.delimiter) || !config.config || typeof config.config !== "object") throw new Error("Invalid diagnosis import interpretation.");
  validatePlacementConfig(c.placementConfig.config); validateBomConfig(c.bomConfig.config);
  validatePackageProfiles(c.packageProfiles);
  return c;
}
/** Source bytes accompany each fresh review/export/reopen; stored findings are never authority. */
export function appendDiagnosisSources(form: FormData, context: NativeDiagnosisContext | undefined, files: { layout: File | null; placement: File | null; bom: File | null }) {
  if (!context) return;
  if (!files.layout || !files.placement || !files.bom) throw new Error("Reopen the exact PCB, placement and BOM sources to reproduce this diagnosed candidate.");
  form.set("layout", files.layout); form.set("diagnosisPlacement", files.placement); form.set("diagnosisBom", files.bom);
}
