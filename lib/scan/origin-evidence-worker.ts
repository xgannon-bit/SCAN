import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reserveWorker } from "./worker-budget";
import { validateBomConfig, type BomConfig } from "./bom-types";
import { validatePackageProfiles, type PackageProfile } from "./package-profiles";
import type { OriginBodyEvidenceReport } from "./origin-resolver";

const MAX_FILE = 8_000_000;
const MAX_CONTROL = 240_000;
const MAX_RESPONSE = 4_010_000;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const validHash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const literal = (value: unknown, max: number) => typeof value === "string" && value.length <= max && !value.includes("\0");
const keys = (value: unknown, expected: string[]) => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join() === [...expected].sort().join();

export type OriginEvidenceControl = {
  layoutSha256: string; bomSha256: string; bomSheetIndex: number; bomDelimiter: string;
  bomConfig: BomConfig; packageProfiles: PackageProfile[];
};
type OriginEvidenceWorkerControl = OriginEvidenceControl & { bomKind: "xlsx" | "xls" | "csv" };
export type OriginEvidenceResult = OriginBodyEvidenceReport | { status: "blocked"; message: string; nativeEditsApplied: false };

export function validateOriginEvidenceControl(value: unknown): OriginEvidenceControl {
  const control = value as OriginEvidenceControl;
  if (!keys(control, ["layoutSha256", "bomSha256", "bomSheetIndex", "bomDelimiter", "bomConfig", "packageProfiles"])
    || Buffer.byteLength(JSON.stringify(control)) > MAX_CONTROL || !validHash(control.layoutSha256) || !validHash(control.bomSha256)
    || !Number.isInteger(control.bomSheetIndex) || control.bomSheetIndex < 0 || control.bomSheetIndex >= 20
    || ![",", ";", "\t"].includes(control.bomDelimiter)) throw new Error("Origin evidence settings are invalid or exceed their bounds.");
  validateBomConfig(control.bomConfig);
  validatePackageProfiles(control.packageProfiles);
  return control;
}

function checkedResponse(value: unknown, control: OriginEvidenceControl): OriginEvidenceResult {
  const response = value as Record<string, unknown>;
  if (!keys(response, ["protocolVersion", "result"]) || response.protocolVersion !== "1") throw new Error();
  const result = response.result as Record<string, unknown>;
  if (keys(result, ["status", "message", "nativeEditsApplied"]) && result.status === "blocked" && literal(result.message, 8000) && result.nativeEditsApplied === false) return result as OriginEvidenceResult;
  if (!keys(result, ["status", "artifactType", "schemaVersion", "layoutSha256", "bomSha256", "profilesSha256", "evidenceSha256", "records", "machineQualified", "nativeEditsApplied"])
    || result.status !== "success" || result.artifactType !== "scan.source-body-evidence" || result.schemaVersion !== "1"
    || result.layoutSha256 !== control.layoutSha256 || result.bomSha256 !== control.bomSha256
    || !validHash(result.profilesSha256) || !validHash(result.evidenceSha256) || result.machineQualified !== false || result.nativeEditsApplied !== false
    || !Array.isArray(result.records) || result.records.length > 1000) throw new Error();
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10_000_000;
  const vector = (v: unknown) => v === null || Array.isArray(v) && v.length === 2 && v.every(finite);
  for (const record of result.records) {
    if (!keys(record, ["reference", "sourcePath", "profileId", "profileSha256", "status", "bodyLocalMm", "bodyBoardMm", "bodySizeMm", "sourceRotationDegrees", "sourceSide", "drawingSha256", "holds", "mpnMatched"])
      || !literal(record.reference, 2048) || !literal(record.sourcePath, 4096) || !literal(record.profileId, 2048)
      || !control.packageProfiles.some(p => p.id === record.profileId) || !validHash(record.profileSha256) || !validHash(record.drawingSha256)
      || !["supported", "held"].includes(record.status) || ![record.bodyLocalMm, record.bodyBoardMm, record.bodySizeMm].every(vector)
      || record.status === "supported" && [record.bodyLocalMm, record.bodyBoardMm, record.bodySizeMm].some(v => v === null)
      || record.sourceRotationDegrees !== null && !finite(record.sourceRotationDegrees)
      || record.sourceSide !== null && !literal(record.sourceSide, 256) || typeof record.mpnMatched !== "boolean"
      || !Array.isArray(record.holds) || record.holds.length > 100 || record.holds.some((hold: unknown) => {
        const h = hold as { code: unknown; message: unknown };
        return !keys(h, ["code", "message"]) || !literal(h.code, 256) || !literal(h.message, 8000);
      })) throw new Error();
  }
  return result as unknown as OriginBodyEvidenceReport;
}

export async function originEvidenceWorker(pcb: Buffer, bom: Buffer, input: OriginEvidenceWorkerControl, signal: AbortSignal, reservedRelease?: () => void): Promise<OriginEvidenceResult> {
  const release = reservedRelease ?? reserveWorker("placement");
  const temporaryRoot = path.resolve(tmpdir());
  const ownedTemporaryPath = (candidate: string) => path.dirname(path.resolve(candidate)) === temporaryRoot && path.basename(candidate).startsWith("scan-origin-evidence-");
  let directory: string | undefined;
  try {
    const { bomKind, ...rawControl } = input;
    const control = validateOriginEvidenceControl(rawControl);
    if (!["xlsx", "xls", "csv"].includes(bomKind)) throw new Error("Origin evidence BOM format is unsupported.");
    if ([pcb, bom].some(bytes => !bytes.length || bytes.length > MAX_FILE)) throw new Error("Origin evidence requires two nonempty files no larger than 8 MB each.");
    if (hash(pcb) !== control.layoutSha256 || hash(bom) !== control.bomSha256) throw new Error("Origin evidence source hashes changed. Reimport these exact sources.");
    if (signal.aborted) throw new Error("Origin evidence cancelled.");
    directory = await mkdtemp(path.join(temporaryRoot, "scan-origin-evidence-"));
    if (!ownedTemporaryPath(directory)) throw new Error("Origin evidence temporary directory is invalid.");
    const source = path.join(directory, "layout.pcb"), bomSource = path.join(directory, "bom.input");
    await writeFile(source, pcb, { flag: "wx", mode: 0o600 });
    await writeFile(bomSource, bom, { flag: "wx", mode: 0o600 });
    const request = JSON.stringify({ protocolVersion: "1", source, bomSource, bomKind,
      bomSheetIndex: control.bomSheetIndex, bomDelimiter: control.bomDelimiter,
      bomConfig: control.bomConfig, packageProfiles: control.packageProfiles });
    if (Buffer.byteLength(request) > 250_000) throw new Error("Origin evidence settings exceed the worker bound.");
    const interpreter = process.env.SCAN_PYTHON || path.join(process.cwd(), ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    return await new Promise((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ interpreter, ["-m", "workers.scan.origin_evidence_cli"], {
        cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", OPENPYXL_DEFUSEDXML: "True", OPENPYXL_LXML: "False" },
      });
      let size = 0;
      const chunks: Buffer[] = [];
      let failure: string | undefined;
      const stop = (message: string) => { failure ??= message; child.kill(); };
      const abort = () => stop("Origin evidence cancelled.");
      const timer = setTimeout(() => stop("Origin evidence exceeded its 30-second limit."), 30_000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE) stop("Origin evidence result exceeds its output bound.");
        else chunks.push(chunk);
      });
      child.stderr.on("data", () => { /* Source contents and parser warnings stay private. */ });
      child.stdin.on("error", () => { /* The close handler reports bounded failure. */ });
      child.once("error", () => { failure = "Local Python worker is unavailable. Install workers/requirements.txt in the checkout’s .venv."; });
      child.once("close", code => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (failure) return reject(new Error(failure));
        try {
          if (code !== 0 && code !== 2) throw new Error();
          resolve(checkedResponse(JSON.parse(Buffer.concat(chunks).toString("utf8")), control));
        } catch { reject(new Error("Local worker returned invalid or mismatched origin evidence. No file was changed.")); }
      });
      child.stdin.end(request);
    });
  } finally {
    try { if (directory && ownedTemporaryPath(directory)) await rm(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}
