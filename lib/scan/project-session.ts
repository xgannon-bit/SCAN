import type { ComparisonPlacement } from "../../components/scan/ComparisonSession";
import { validateBomConfig, type BomConfig } from "./bom-types";
import type { RestoredBom } from "../../components/scan/BomSession";
import { validateRepairSession, type RepairSession } from "./repair-session";
import type { ArchiveInventory, ArchiveReview, ArchiveSelection, SnapshotRole } from "./archive-types";
import { decodeReview, encodeGerberDraft, encodeReview, validateReviewSession, type GerberDraft, type RestoredGerber, type ReviewNotes, type ReviewSessionFile } from "./review-session";

// Includes two 100 MB archives, two 8 MB sources, bounded notes and JSON overhead.
export const PROJECT_MAX_BYTES = 300_000_000;
export const ARCHIVE_MAX_BYTES = 100_000_000;
const CHUNK_BYTES = 3 * 32768;
type EmbeddedSource = ReviewSessionFile["source"];
export type ArchiveDraft = { root: string; job: string; master: string };
export type ProjectArchive = { source: EmbeddedSource; selection: ArchiveSelection | null; draft: ArchiveDraft };
export type RestoredArchive = { file: File; record: ProjectArchive };
type Annotation = { id: string; sourceSha256: string; recordedAt: string; summary: string };
export type ProjectEvidence = {
  authority: "annotations-only";
  decisions: Annotation[];
  candidateHistory: (Annotation & { candidateSha256: string })[];
  machineObservations: (Annotation & { machineVersion: string })[];
};
export function retainProjectEvidence(evidence: ProjectEvidence, sourceHashes: Set<string>): { evidence: ProjectEvidence | undefined; removed: number } {
  const decisions = evidence.decisions.filter(note => sourceHashes.has(note.sourceSha256));
  const candidateHistory = evidence.candidateHistory.filter(note => sourceHashes.has(note.sourceSha256));
  const machineObservations = evidence.machineObservations.filter(note => sourceHashes.has(note.sourceSha256));
  const retained = decisions.length + candidateHistory.length + machineObservations.length;
  const removed = evidence.decisions.length + evidence.candidateHistory.length + evidence.machineObservations.length - retained;
  return { evidence: retained ? { authority: "annotations-only", decisions, candidateHistory, machineObservations } : undefined, removed };
}
export type ProjectSessionFile = {
  artifactType: "scan.project-session"; schemaVersion: "1";
  placement: ReviewSessionFile | null; gerber: GerberDraft | null;
  archives: { original: ProjectArchive | null; returned: ProjectArchive | null };
  notes: ReviewNotes; machineVersion: string; evidence?: ProjectEvidence; repair?: RepairSession;
  layout?: { source: EmbeddedSource; checked: boolean };
  comparisons?: ReviewSessionFile[];
  bom?: { source: EmbeddedSource; config: BomConfig; sheet: number; delimiter: string; checked: boolean };
  attachments?: { role: "BOM" | "evidence"; source: EmbeddedSource }[];
  machineExportAllowed: false;
};
export type ProjectInput = {
  layout?: { file: File; checked: boolean };
  bom?: RestoredBom;
  comparisons?: ComparisonPlacement[];
  attachments?: { role: "BOM" | "evidence"; file: File }[];
  placement: { file: File; settings: Parameters<typeof encodeReview>[1] } | null;
  gerber: { file: File; settings: Parameters<typeof encodeGerberDraft>[1] } | null;
  original: { file: File; selection: ArchiveSelection | null; draft: ArchiveDraft } | null;
  returned: { file: File; selection: ArchiveSelection | null; draft: ArchiveDraft } | null;
  notes: ReviewNotes; machineVersion: string; evidence?: ProjectEvidence; repair?: RepairSession;
};
export type RestoredProject = {
  record: ProjectSessionFile;
  layout?: { file: File; checked: boolean };
  bom?: RestoredBom;
  comparisons?: ComparisonPlacement[];
  attachments?: { role: "BOM" | "evidence"; file: File }[];
  placement: { record: ReviewSessionFile; source: File } | null;
  gerber?: RestoredGerber;
  original: RestoredArchive | null; returned: RestoredArchive | null;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid project structure.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error("Unexpected or missing project fields. Derived reports cannot be restored.");
}
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !value.includes("\0");
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const role = (value: unknown): value is SnapshotRole => value === "main" || value === "temp" || value === "backup";
const path = (value: unknown): value is string => text(value, 2048) && !!value && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some(part => !part || part === "." || part === "..");

function validateNotes(value: unknown) {
  const notes = object(value);
  if (Object.keys(notes).length > 1000 || Object.entries(notes).some(([key, note]) => !/^(session|row:[1-9]\d{0,3}|row:10000)$/.test(key) || !text(note, 2000))) throw new Error("Project notes exceed supported bounds.");
}
function validateSource(value: unknown, extension: RegExp, maximum: number): EmbeddedSource {
  const source = object(value); exact(source, ["name", "size", "sha256", "base64"]);
  if (!text(source.name, 255) || !extension.test(source.name) || /[/\\]/.test(source.name) || typeof source.size !== "number" || !Number.isInteger(source.size) || source.size < 1 || source.size > maximum || !hash(source.sha256) || typeof source.base64 !== "string" || source.base64.length !== 4 * Math.ceil(source.size / 3)) throw new Error("Project source metadata exceeds supported bounds.");
  return value as EmbeddedSource;
}
function validateSelection(value: unknown): ArchiveSelection {
  const selected = object(value); exact(selected, ["root", "jobMember", "jobRole", "masterMember", "masterRole"]);
  if (!path(selected.root) || !path(selected.jobMember) || !role(selected.jobRole) || (selected.masterMember === null ? selected.masterRole !== null : !path(selected.masterMember) || !role(selected.masterRole))) throw new Error("Invalid explicit archive selection.");
  return value as ArchiveSelection;
}
function draftMember(value: string) {
  let member: Record<string, unknown>;
  try { member = object(JSON.parse(value)); } catch { throw new Error("Invalid archive selection draft."); }
  exact(member, ["role", "member"]);
  if (!role(member.role) || !path(member.member)) throw new Error("Invalid archive selection draft.");
  return member;
}
function validateArchive(value: unknown): ProjectArchive {
  const archive = object(value); exact(archive, ["source", "selection", "draft"]);
  validateSource(archive.source, /\.zip$/i, ARCHIVE_MAX_BYTES);
  const draft = object(archive.draft); exact(draft, ["root", "job", "master"]);
  if (!text(draft.root, 2048) || (draft.root && !path(draft.root)) || !text(draft.job, 4200) || !text(draft.master, 4200)) throw new Error("Invalid archive selection draft.");
  const job = draft.job ? draftMember(draft.job) : null;
  const master = draft.master && draft.master !== "none" ? draftMember(draft.master) : null;
  if (archive.selection !== null) {
    const selected = validateSelection(archive.selection);
    if (draft.root !== selected.root || job?.member !== selected.jobMember || job?.role !== selected.jobRole || (selected.masterMember === null ? draft.master !== "none" : master?.member !== selected.masterMember || master?.role !== selected.masterRole)) throw new Error("Saved archive selection differs from its draft.");
  }
  return value as ProjectArchive;
}
function validateGerber(value: unknown): GerberDraft {
  const draft = object(value); exact(draft, ["source", "config", "points", "scope", "tolerance", "basis", "checked"]);
  validateSource(draft.source, /\.(gbr|gbx)$/i, 8_000_000);
  const config = object(draft.config); exact(config, ["formatOverride", "assumeLinear"]);
  if (typeof config.assumeLinear !== "boolean" || (config.formatOverride !== null && (!text(config.formatOverride, 20) || !/^FSLAX[1-6][1-6]Y[1-6][1-6]$/.test(config.formatOverride)))) throw new Error("Invalid saved Gerber interpretation.");
  const scope = object(draft.scope); exact(scope, ["module", "side", "boardInstance"]);
  if (Object.values(scope).some(value => !text(value, 256)) || !text(draft.tolerance, 40) || !text(draft.basis, 8000) || typeof draft.checked !== "boolean" || !Array.isArray(draft.points) || draft.points.length !== 4) throw new Error("Invalid saved alignment draft.");
  const ids = new Set();
  for (const value of draft.points) {
    const point = object(value); exact(point, ["id", "role", "cad", "gerber", "evidence"]);
    if (!text(point.id, 128) || !point.id || ids.has(point.id) || !["fit", "check"].includes(String(point.role)) || !text(point.evidence, 512) || [point.cad, point.gerber].some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(coordinate => !text(coordinate, 40)))) throw new Error("Invalid saved control points.");
    ids.add(point.id);
  }
  return value as GerberDraft;
}
function validateEvidence(value: unknown, sources: Set<string>) {
  const evidence = object(value); exact(evidence, ["authority", "decisions", "candidateHistory", "machineObservations"]);
  if (evidence.authority !== "annotations-only") throw new Error("Project annotations cannot grant approval or export authority.");
  for (const kind of ["decisions", "candidateHistory", "machineObservations"] as const) {
    const records = evidence[kind]; const ids = new Set();
    if (!Array.isArray(records) || records.length > 1000) throw new Error("Project annotation count exceeds supported bounds.");
    for (const record of records) {
      const note = object(record);
      exact(note, ["id", "sourceSha256", "recordedAt", "summary", ...(kind === "candidateHistory" ? ["candidateSha256"] : kind === "machineObservations" ? ["machineVersion"] : [])]);
      if (!text(note.id, 128) || !note.id || ids.has(note.id) || !hash(note.sourceSha256) || !sources.has(note.sourceSha256) || !text(note.recordedAt, 40) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(note.recordedAt) || !Number.isFinite(Date.parse(note.recordedAt)) || !text(note.summary, 2000) || !note.summary.trim() || (kind === "candidateHistory" && !hash(note.candidateSha256)) || (kind === "machineObservations" && (!text(note.machineVersion, 256) || !note.machineVersion.trim()))) throw new Error("Invalid or unbound project annotation.");
      ids.add(note.id);
    }
  }
}
export function validateProjectSession(value: unknown): ProjectSessionFile {
  const project = object(value);
  exact(project, ["artifactType", "schemaVersion", "placement", "gerber", "archives", "notes", "machineVersion", "machineExportAllowed", ...(Object.hasOwn(project, "evidence") ? ["evidence"] : []), ...(Object.hasOwn(project, "repair") ? ["repair"] : []), ...(Object.hasOwn(project, "attachments") ? ["attachments"] : []), ...(Object.hasOwn(project, "layout") ? ["layout"] : []), ...(Object.hasOwn(project, "bom") ? ["bom"] : []), ...(Object.hasOwn(project, "comparisons") ? ["comparisons"] : [])]);
  if (project.artifactType !== "scan.project-session" || project.schemaVersion !== "1" || project.machineExportAllowed !== false || !text(project.machineVersion, 256)) throw new Error("Unsupported project version or capability flags.");
  validateNotes(project.notes);
  const sources = new Set<string>();
  if (project.placement !== null) {
    const placement = validateReviewSession(project.placement); sources.add(placement.source.sha256);
    if (JSON.stringify(Object.entries(placement.notes).sort()) !== JSON.stringify(Object.entries(project.notes as ReviewNotes).sort())) throw new Error("Project and placement notes differ.");
  }
  if (project.gerber !== null) sources.add(validateGerber(project.gerber).source.sha256);
  const archives = object(project.archives); exact(archives, ["original", "returned"]);
  for (const saved of [archives.original, archives.returned]) if (saved !== null) sources.add(validateArchive(saved).source.sha256);
  if (Object.hasOwn(project, "layout")) {
    const layout = object(project.layout); exact(layout, ["source", "checked"]);
    sources.add(validateSource(layout.source, /\.pcb$/i, 8_000_000).sha256);
    if (typeof layout.checked !== "boolean") throw new Error("Invalid source layout draft.");
  }
  if (Object.hasOwn(project, "comparisons")) {
    if (!Array.isArray(project.comparisons) || project.comparisons.length > 3) throw new Error("Too many placement comparisons.");
    for (const item of project.comparisons) sources.add(validateReviewSession(item).source.sha256);
  }
  if (Object.hasOwn(project, "bom")) {
    const bom = object(project.bom); exact(bom, ["source", "config", "sheet", "delimiter", "checked"]);
    sources.add(validateSource(bom.source, /\.(xlsx|xls|csv)$/i, 8_000_000).sha256); validateBomConfig(bom.config);
    if (!Number.isInteger(bom.sheet) || Number(bom.sheet) < 0 || Number(bom.sheet) > 19 || ![",", ";", "\t"].includes(String(bom.delimiter)) || typeof bom.checked !== "boolean") throw new Error("Invalid saved BOM worksheet.");
  }
  if (Object.hasOwn(project, "attachments")) {
    if (!Array.isArray(project.attachments) || project.attachments.length > 3) throw new Error("At most three supplementary files are supported.");
    for (const raw of project.attachments) {
      const item = object(raw); exact(item, ["role", "source"]);
      if (!["BOM", "evidence"].includes(String(item.role))) throw new Error("Invalid supplementary source role.");
      sources.add(validateSource(item.source, /./, 8_000_000).sha256);
    }
  }
  if (!sources.size || (archives.returned !== null && archives.original === null)) throw new Error("A project needs a source; a returned comparison requires its original archive.");
  if (Object.hasOwn(project, "evidence")) validateEvidence(project.evidence, sources);
  if (Object.hasOwn(project, "repair")) validateRepairSession(project.repair);
  return value as ProjectSessionFile;
}

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(result, byte => byte.toString(16).padStart(2, "0")).join("");
}
async function encodeSource(file: File, maximum: number): Promise<EmbeddedSource> {
  if (!file.size || file.size > maximum) throw new Error(`Source exceeds the ${maximum / 1_000_000} MB limit.`);
  const bytes = new Uint8Array(await file.arrayBuffer()); const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    let binary = "";
    for (let offset = start; offset < Math.min(start + CHUNK_BYTES, bytes.length); offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32768, start + CHUNK_BYTES)));
    chunks.push(btoa(binary));
  }
  return { name: file.name, size: file.size, sha256: await digest(bytes), base64: chunks.join("") };
}
async function decodeSource(source: EmbeddedSource): Promise<File> {
  const bytes = new Uint8Array(source.size); const chunkLength = CHUNK_BYTES / 3 * 4;
  for (let start = 0, offset = 0; start < source.base64.length; start += chunkLength) {
    const encoded = source.base64.slice(start, start + chunkLength);
    let binary: string;
    try { binary = atob(encoded); } catch { throw new Error("Saved source is not canonical base64."); }
    if (btoa(binary) !== encoded || offset + binary.length > bytes.length || (start + chunkLength < source.base64.length && encoded.includes("="))) throw new Error("Saved source is not canonical base64.");
    for (let index = 0; index < binary.length; index++) bytes[offset++] = binary.charCodeAt(index);
    if (start + chunkLength >= source.base64.length && offset !== source.size) throw new Error("Saved source byte count differs.");
  }
  if (await digest(bytes) !== source.sha256) throw new Error("Saved source bytes do not match their hash. Project was not opened.");
  return new File([bytes], source.name);
}
export async function encodeProject(input: ProjectInput): Promise<Blob> {
  const archive = async (value: ProjectInput["original"]): Promise<ProjectArchive | null> => value ? { source: await encodeSource(value.file, ARCHIVE_MAX_BYTES), selection: value.selection, draft: value.draft } : null;
  // Process sources sequentially to bound peak encoding memory.
  const placement = input.placement ? await encodeReview(input.placement.file, { ...input.placement.settings, notes: input.notes }) : null;
  const gerber = input.gerber ? await encodeGerberDraft(input.gerber.file, input.gerber.settings) : null;
  const original = await archive(input.original); const returned = await archive(input.returned);
  const layout = input.layout ? { source: await encodeSource(input.layout.file, 8_000_000), checked: input.layout.checked } : undefined;
  const comparisons = [];
  for (const item of input.comparisons ?? []) comparisons.push(await encodeReview(item.file, { config: item.config, sheetIndex: item.sheetIndex, delimiter: item.delimiter, validated: !!item.result, selectedRow: null, notes: {} }));
  const bom = input.bom ? { source: await encodeSource(input.bom.file, 8_000_000), config: input.bom.config, sheet: input.bom.sheet, delimiter: input.bom.delimiter, checked: input.bom.checked } : undefined;
  const attachments = [];
  for (const item of input.attachments ?? []) attachments.push({ role: item.role, source: await encodeSource(item.file, 8_000_000) });
  const record = validateProjectSession({ artifactType: "scan.project-session", schemaVersion: "1", placement, gerber, archives: { original, returned }, notes: input.notes, machineVersion: input.machineVersion, ...(input.evidence ? { evidence: input.evidence } : {}), ...(input.repair ? { repair: input.repair } : {}), ...(attachments.length ? { attachments } : {}), ...(layout ? { layout } : {}), ...(bom ? { bom } : {}), ...(comparisons.length ? { comparisons } : {}), machineExportAllowed: false });
  // Separate Blob parts avoid expanding both large base64 strings in one stringify.
  function archiveParts(value: ProjectArchive | null): BlobPart[] {
    if (!value) return ["null"];
    const { base64, ...metadata } = value.source;
    return ['{"source":', JSON.stringify(metadata).slice(0, -1), ',"base64":"', base64, '"},"selection":', JSON.stringify(value.selection), ',"draft":', JSON.stringify(value.draft), '}'];
  }
  const blob = new Blob(['{"artifactType":"scan.project-session","schemaVersion":"1","placement":', JSON.stringify(record.placement), ',"gerber":', JSON.stringify(record.gerber), ',"archives":{"original":', ...archiveParts(original), ',"returned":', ...archiveParts(returned), '},"notes":', JSON.stringify(record.notes), ',"machineVersion":', JSON.stringify(record.machineVersion), ...(record.evidence ? [',"evidence":', JSON.stringify(record.evidence)] : []), ...(record.repair ? [',"repair":', JSON.stringify(record.repair)] : []), ...(record.attachments ? [',"attachments":', JSON.stringify(record.attachments)] : []), ...(record.layout ? [',"layout":', JSON.stringify(record.layout)] : []), ...(record.bom ? [',"bom":', JSON.stringify(record.bom)] : []), ...(record.comparisons ? [',"comparisons":', JSON.stringify(record.comparisons)] : []), ',"machineExportAllowed":false}'], { type: "application/json" });
  if (blob.size > PROJECT_MAX_BYTES) throw new Error("Project exceeds the 300 MB save limit. Shorten annotations and try again.");
  return blob;
}
export async function decodeProject(file: File): Promise<RestoredProject> {
  if (!file.size || file.size > PROJECT_MAX_BYTES) throw new Error("Saved project exceeds the 300 MB limit.");
  let input: unknown;
  try { input = JSON.parse(await file.text()); } catch { throw new Error("Saved project is not valid JSON."); }
  // Keep legacy placement/source-review files working, with their original bounds.
  if (object(input).artifactType !== "scan.project-session") {
    const legacy = await decodeReview(file);
    return { record: { artifactType: "scan.project-session", schemaVersion: "1", placement: legacy.record, gerber: legacy.gerber?.draft ?? null, archives: { original: null, returned: null }, notes: legacy.record.notes, machineVersion: "", machineExportAllowed: false }, placement: { record: legacy.record, source: legacy.source }, ...(legacy.gerber ? { gerber: legacy.gerber } : {}), original: null, returned: null };
  }
  const record = validateProjectSession(input);
  const placement = record.placement ? { record: record.placement, source: await decodeSource(record.placement.source) } : null;
  const gerber = record.gerber ? { draft: record.gerber, file: await decodeSource(record.gerber.source) } : undefined;
  const original = record.archives.original ? { record: record.archives.original, file: await decodeSource(record.archives.original.source) } : null;
  const returned = record.archives.returned ? { record: record.archives.returned, file: await decodeSource(record.archives.returned.source) } : null;
  const attachments = [];
  for (const item of record.attachments ?? []) attachments.push({ role: item.role, file: await decodeSource(item.source) });
  const layout = record.layout ? { file: await decodeSource(record.layout.source), checked: record.layout.checked } : undefined;
  const bom = record.bom ? { file: await decodeSource(record.bom.source), config: record.bom.config, sheet: record.bom.sheet, delimiter: record.bom.delimiter, checked: record.bom.checked } : undefined;
  const comparisons: ComparisonPlacement[] = [];
  for (const item of record.comparisons ?? []) comparisons.push({ file: await decodeSource(item.source), config: item.config, sheetIndex: item.sheetIndex, delimiter: item.delimiter, result: null });
  return { record, comparisons, ...(layout ? { layout } : {}), ...(bom ? { bom } : {}), attachments, placement, ...(gerber ? { gerber } : {}), original, returned };
}

export function selectionInInventory(selection: ArchiveSelection, inventory: ArchiveInventory): boolean {
  const root = inventory.job_roots.find(value => value.root === selection.root);
  // Main XML entries deliberately have an unknown inventory role. Validate the
  // explicit master choice against the same exact names as snapshot capture.
  const masterName = selection.masterMember?.split("/").at(-1)?.toLowerCase();
  const masterRole = masterName === "master.xml" ? "main" : masterName === "master_temp.xml" ? "temp" : masterName === "master.xml.bak" ? "backup" : null;
  return !!root && root[`${selection.jobRole}_candidates`].includes(selection.jobMember) && (selection.masterMember === null ? selection.masterRole === null : root.master_candidates.includes(selection.masterMember) && masterRole === selection.masterRole);
}
export function reviewMatchesSelection(review: ArchiveReview, selection: ArchiveSelection, source: EmbeddedSource): boolean {
  const selected = review.preflight?.selection;
  return review.artifactType === "scan.archive-review" && review.status === "success" && review.machineExportAllowed === false && review.preflight?.source.sha256 === source.sha256 && review.preflight?.source.size === source.size && selected?.root === selection.root && selected.job.member === selection.jobMember && selected.job.role === selection.jobRole && (selection.masterMember === null ? selected.master === null : selected.master?.member === selection.masterMember && selected.master.role === selection.masterRole);
}
