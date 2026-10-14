import { startProcessing } from "@/lib/scan/processing-journal";
import { permittedOrigin } from "@/lib/scan/placement-worker";
import { archiveWorker } from "@/lib/scan/archive-worker";
import { reserveWorker, WorkerBusyError } from "@/lib/scan/worker-budget";

export const runtime = "nodejs";
const MAX_BODY = 125_100_000;
const reply = (message: string, status = 400) => Response.json({ message }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(request: Request) {
  if (!permittedOrigin(request.headers.get("origin"), request.headers.get("host"))) return reply("Use the local SCAN page to select an archive.", 403);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return reply("Archive upload exceeds 100 MB.", 413);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;") || !request.body) return reply("Expected an archive file upload.");
  let release: (() => void) | undefined, transferred = false;
  try {
    // Bound concurrent upload memory before accepting any source bytes.
    release = reserveWorker("archive");
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    let expired = false;
    const cancel = () => { expired = true; void reader.cancel().catch(() => {}); };
    const timer = setTimeout(cancel, 120_000);
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) cancel();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > MAX_BODY) { await reader.cancel(); return reply("Archive upload exceeds 100 MB.", 413); }
        chunks.push(value);
      }
    } finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    if (expired || request.signal.aborted) return reply("Archive upload was interrupted or timed out.", 408);
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    const repairAction = String(form.get("action")).startsWith("repair-");
    const draftAction = String(form.get("action")).startsWith("draft-");
    const diagnosisAction = form.get("action") === "placement-diagnosis";
    const diagnosisSources = diagnosisAction || (repairAction && (form.has("diagnosisPlacement") || form.has("diagnosisBom")));
    const composedRepair = form.get("action") === "repair-export" && form.has("layout") && !diagnosisSources;
    const fields = [...new Set(["file", "action", "expectedArchiveSha256", "selection", "expectedPackageSha256", ...(form.get("action") === "image" ? ["imageMember"] : []), ...(repairAction ? ["repair"] : []), ...(draftAction ? ["draft", "layout"] : []), ...(composedRepair ? ["layout"] : []), ...(diagnosisAction ? ["diagnosis"] : []), ...(diagnosisSources ? ["layout", "diagnosisPlacement", "diagnosisBom"] : [])])];
    if ([...form.keys()].length !== fields.length || fields.some(key => form.getAll(key).length !== 1)) return reply("Archive fields are missing, duplicated or unknown.");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 100_000_000 || !file.name.toLowerCase().endsWith(".zip")) return reply("Select a nonempty ZIP no larger than 100 MB.");
    const action = form.get("action"), archiveHash = form.get("expectedArchiveSha256"), selection = form.get("selection"), packageHash = form.get("expectedPackageSha256");
    if (typeof action !== "string" || !["inventory", "preflight", "download", "reference", "image", "image-catalog", "repair-review", "repair-export", "draft-review", "draft-export", "placement-diagnosis"].includes(action) || typeof selection !== "string" || selection.length > 8000 || typeof archiveHash !== "string" || typeof packageHash !== "string") return reply("Invalid archive settings.");
    const control: Record<string, unknown> = { action };
    if (action === "inventory") {
      if (selection !== "null" || archiveHash !== "" || packageHash !== "") return reply("Inventory does not accept a prior selection or hash.");
    } else {
      if (!/^[a-f0-9]{64}$/.test(archiveHash) || (["download", "reference", "image", "image-catalog", "repair-review", "repair-export", "draft-review", "draft-export", "placement-diagnosis"].includes(action) ? !/^[a-f0-9]{64}$/.test(packageHash) : packageHash !== "")) return reply("Review the current archive and snapshot hashes first.");
      let chosen: unknown;
      try { chosen = JSON.parse(selection); } catch { return reply("Invalid snapshot selection."); }
      control.expectedArchiveSha256 = archiveHash; control.selection = chosen;
      if (["download", "reference", "image", "image-catalog", "repair-review", "repair-export", "draft-review", "draft-export", "placement-diagnosis"].includes(action)) control.expectedPackageSha256 = packageHash;
    }
    if (action === "image") {
      const member = form.get("imageMember");
      if (typeof member !== "string" || !member || member.length > 2048) return reply("Select one preserved image member.");
      control.imageMember = member;
    }
    if (repairAction) {
      const raw = form.get("repair");
      if (typeof raw !== "string" || raw.length > 1_000_000) return reply("Repair request exceeds its limit.");
      try { control.repair = JSON.parse(raw); } catch { return reply("Invalid repair request."); }
    }
    if (diagnosisAction) {
      const raw = form.get("diagnosis");
      if (typeof raw !== "string" || raw.length > 900_000) return reply("Diagnosis evidence exceeds its limit.");
      try { control.diagnosis = JSON.parse(raw); } catch { return reply("Invalid diagnosis interpretation."); }
    }
    let layoutBytes: Buffer | undefined;
    if (draftAction) {
      const raw = form.get("draft"), layout = form.get("layout");
      if (typeof raw !== "string" || raw.length > 1_000_000 || !(layout instanceof File) || !layout.size || layout.size > 8_000_000 || !layout.name.toLowerCase().endsWith(".pcb")) return reply("Select a source layout no larger than 8 MB and a bounded preparation review.");
      try { control.draft = JSON.parse(raw); } catch { return reply("Invalid preparation request."); }
      layoutBytes = Buffer.from(await layout.arrayBuffer());
    }
    if (composedRepair) {
      const layout = form.get("layout");
      if (!(layout instanceof File) || !layout.size || layout.size > 8_000_000 || !layout.name.toLowerCase().endsWith(".pcb") || !(control.repair as Record<string, unknown>)?.preparation) return reply("Composed export requires the exact source layout and reviewed preparation set.");
      layoutBytes = Buffer.from(await layout.arrayBuffer());
    }
    let capturedDiagnosis: Parameters<typeof archiveWorker>[5];
    if (diagnosisSources) {
      const layout = form.get("layout"), placement = form.get("diagnosisPlacement"), bom = form.get("diagnosisBom");
      const bounded = (value: FormDataEntryValue | null, extension: RegExp): value is File => value instanceof File && value.size > 0 && value.size <= 8_000_000 && value.name.length <= 255 && !/[/\\\0]/.test(value.name) && extension.test(value.name);
      if (!bounded(layout, /\.pcb$/i) || !bounded(placement, /\.(csv|xlsx|xls)$/i) || !bounded(bom, /\.(csv|xlsx|xls)$/i)) return reply("Diagnosis requires the exact PCB, placement and BOM files, each no larger than 8 MB.");
      if (repairAction && !(control.repair as { request?: { diagnosis?: unknown } })?.request?.diagnosis) return reply("Diagnosis source files require a bound diagnosis request.");
      layoutBytes = Buffer.from(await layout.arrayBuffer());
      capturedDiagnosis = { placement: Buffer.from(await placement.arrayBuffer()), bom: Buffer.from(await bom.arrayBuffer()), layoutName: layout.name, placementName: placement.name, bomName: bom.name };
    }
    const progressId = request.headers.get("X-SCAN-Progress");
    if (progressId && !["repair-export", "draft-export", "placement-diagnosis"].includes(action)) return reply("Archive progress is available for candidate exports and native diagnosis only.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const progress = progressId ? startProcessing(progressId, archiveHash) : undefined;
    transferred = true;
    return await archiveWorker(bytes, control, request.signal, release, layoutBytes, capturedDiagnosis, progress);
  } catch (error) {
    if (error instanceof WorkerBusyError) return Response.json({ code: "WORKER_BUSY", message: error.message }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
    const message = error instanceof Error && /^(Archive |Local Python|Local worker|Two imports)/.test(error.message) ? error.message : "Archive import failed. No source contents were logged or originals changed.";
    return reply(message);
  } finally { if (!transferred) release?.(); }
}
