import type { PlacementConfig } from "./placement-types";
import type { AlignmentPoint, AlignmentScope, GerberConfig } from "./geometry-types";

export const REVIEW_MAX_BYTES = 14_000_000;
export type ReviewNotes = Record<string, string>;
export type GerberDraft = { source: { name: string; size: number; sha256: string; base64: string }; config: GerberConfig; points: AlignmentPoint[]; scope: AlignmentScope; tolerance: string; basis: string; checked: boolean };
export type RestoredGerber = { draft: GerberDraft; file: File };
export type ReviewSessionFile = {
  artifactType: "scan.placement-review-session";
  schemaVersion: "1";
  source: { name: string; size: number; sha256: string; base64: string };
  config: PlacementConfig;
  sheetIndex: number;
  delimiter: string;
  validated: boolean;
  selectedRow: number | null;
  notes: ReviewNotes;
  machineExportAllowed: false;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid review structure.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error("Unexpected or missing review fields.");
}
function text(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length <= maximum && !value.includes("\0"); }
function integer(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum; }

export function validateReviewSession(value: unknown): ReviewSessionFile {
  const v = object(value);
  exact(v, ["artifactType", "schemaVersion", "source", "config", "sheetIndex", "delimiter", "validated", "selectedRow", "notes", "machineExportAllowed"]);
  if (v.artifactType !== "scan.placement-review-session" || v.schemaVersion !== "1" || v.machineExportAllowed !== false) throw new Error("Unsupported review file or capability flags.");
  const source = object(v.source);
  exact(source, ["name", "size", "sha256", "base64"]);
  if (!text(source.name, 255) || !/\.(xlsx|xls|csv)$/i.test(source.name) || /[/\\]/.test(source.name) || !integer(source.size, 1, 8_000_000) || !text(source.sha256, 64) || !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.base64 !== "string" || source.base64.length !== 4 * Math.ceil(source.size / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.base64)) throw new Error("Review source metadata is invalid.");
  const config = object(v.config);
  exact(config, ["startRow", "columns", "module", "side", "units", "rotationDirection", "decimalSeparator", "pairSeparator"]);
  if (["units", "rotationDirection", "decimalSeparator", "pairSeparator"].some(key => !text(config[key], 20))) throw new Error("Review conventions must be text.");
  const columns = object(config.columns);
  const allowedColumns = ["refdes", "mpn", "x", "y", "xy", "rotation", "side", "module", "footprint"];
  if (Object.keys(columns).some(key => !allowedColumns.includes(key)) || Object.values(columns).some(column => !integer(column, 1, 64)) || !integer(config.startRow, 1, 10_000) || !text(config.module, 256) || !text(config.side, 256) || !["unknown", "mm", "inch", "mil"].includes(String(config.units)) || !["unknown", "cw", "ccw"].includes(String(config.rotationDirection)) || ![".", ","].includes(String(config.decimalSeparator)) || ![",", ";", "space"].includes(String(config.pairSeparator))) throw new Error("Review mapping is invalid.");
  if (!integer(v.sheetIndex, 0, 19) || !text(v.delimiter, 1) || ![",", ";", "\t"].includes(v.delimiter) || typeof v.validated !== "boolean" || (v.selectedRow !== null && !integer(v.selectedRow, 1, 10_000))) throw new Error("Review settings are invalid.");
  const notes = object(v.notes);
  if (Object.keys(notes).length > 1000 || Object.entries(notes).some(([key, note]) => !/^(session|row:[1-9]\d{0,3}|row:10000)$/.test(key) || !text(note, 2000))) throw new Error("Review notes exceed supported bounds.");
  return value as ReviewSessionFile;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function encodeReview(source: File, settings: Omit<ReviewSessionFile, "artifactType" | "schemaVersion" | "source" | "machineExportAllowed">): Promise<ReviewSessionFile> {
  if (source.size < 1 || source.size > 8_000_000) throw new Error("Review source must be no larger than 8 MB.");
  const bytes = new Uint8Array(await source.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const record = validateReviewSession({ artifactType: "scan.placement-review-session", schemaVersion: "1", source: { name: source.name, size: source.size, sha256: await sha256(bytes), base64: btoa(binary) }, ...settings, machineExportAllowed: false });
  if (new TextEncoder().encode(JSON.stringify(record, null, 2)).length > REVIEW_MAX_BYTES) throw new Error("Review exceeds the 14 MB save limit. Shorten the review notes and try again.");
  return record;
}

export async function encodeGerberDraft(file: File, settings: Omit<GerberDraft, "source">): Promise<GerberDraft> {
  if (!file.size || file.size > 8_000_000) throw new Error("Gerber source exceeds the review limit.");
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  const draft = { ...settings, source: { name: file.name, size: file.size, sha256: await sha256(bytes), base64: btoa(binary) } };
  await decodeGerberDraft(draft);
  return draft;
}
async function decodeGerberDraft(value: unknown): Promise<RestoredGerber> {
  const v = object(value); exact(v, ["source", "config", "points", "scope", "tolerance", "basis", "checked"]);
  const source = object(v.source); exact(source, ["name", "size", "sha256", "base64"]);
  if (!text(source.name, 255) || !/\.(gbr|gbx)$/i.test(source.name) || /[/\\]/.test(source.name) || !integer(source.size, 1, 8_000_000) || !text(source.sha256, 64) || !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.base64 !== "string" || source.base64.length !== 4 * Math.ceil(source.size / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.base64)) throw new Error("Invalid saved Gerber source.");
  const config = object(v.config); exact(config, ["formatOverride", "assumeLinear"]);
  if (typeof config.assumeLinear !== "boolean" || (config.formatOverride !== null && (!text(config.formatOverride, 20) || !/^FSLAX[1-6][1-6]Y[1-6][1-6]$/.test(config.formatOverride)))) throw new Error("Invalid saved Gerber interpretation.");
  const scope = object(v.scope); exact(scope, ["module", "side", "boardInstance"]);
  if (Object.values(scope).some(x => !text(x, 256)) || !text(v.basis, 8000) || !text(v.tolerance, 40) || typeof v.checked !== "boolean" || !Array.isArray(v.points) || v.points.length !== 4) throw new Error("Invalid saved alignment draft.");
  const ids = new Set();
  for (const value of v.points) {
    const p = object(value); exact(p, ["id", "role", "cad", "gerber", "evidence"]);
    if (!text(p.id, 128) || !p.id || ids.has(p.id) || typeof p.role !== "string" || !["fit", "check"].includes(p.role) || !text(p.evidence, 512) || [p.cad, p.gerber].some(x => !Array.isArray(x) || x.length !== 2 || x.some(c => !text(c, 40)))) throw new Error("Invalid saved control points."); ids.add(p.id);
  }
  const binary = atob(source.base64); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (bytes.length !== source.size || btoa(binary) !== source.base64 || await sha256(bytes) !== source.sha256) throw new Error("Saved Gerber source hash does not match.");
  return { draft: value as GerberDraft, file: new File([bytes], source.name, { type: "text/plain" }) };
}
export async function decodeReview(file: File): Promise<{ record: ReviewSessionFile; source: File; gerber?: RestoredGerber }> {
  if (!file.size || file.size > 26_000_000) throw new Error("Saved review exceeds the 26 MB limit.");
  let input: unknown;
  try { input = JSON.parse(await file.text()); } catch { throw new Error("Saved review is not valid JSON."); }
  let gerber: RestoredGerber | undefined;
  if (object(input).artifactType === "scan.source-review-session") {
    const bundle = object(input); exact(bundle, ["artifactType", "schemaVersion", "placement", "gerber", "machineExportAllowed"]);
    if (bundle.schemaVersion !== "1" || bundle.machineExportAllowed !== false) throw new Error("Unsupported source review.");
    gerber = await decodeGerberDraft(bundle.gerber); input = bundle.placement;
  } else if (file.size > REVIEW_MAX_BYTES) throw new Error("Saved placement review exceeds the 14 MB limit.");
  const record = validateReviewSession(input);
  const binary = atob(record.source.base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length !== record.source.size || btoa(binary) !== record.source.base64 || await sha256(bytes) !== record.source.sha256) throw new Error("Saved source bytes do not match their hash. Review was not opened.");
  return { record, source: new File([bytes], record.source.name, { type: record.source.name.toLowerCase().endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : record.source.name.toLowerCase().endsWith(".xls") ? "application/vnd.ms-excel" : "text/csv" }), ...(gerber ? { gerber } : {}) };
}

export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
