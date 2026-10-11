import { originEvidenceWorker, validateOriginEvidenceControl } from "@/lib/scan/origin-evidence-worker";
import { permittedOrigin } from "@/lib/scan/placement-worker";
import { reserveWorker } from "@/lib/scan/worker-budget";

export const runtime = "nodejs";
const MAX_BODY = 16_270_000;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const blocked = (message: string, status: number) => reply({ status: "blocked", message, nativeEditsApplied: false }, status);

export async function POST(request: Request) {
  if (!permittedOrigin(request.headers.get("origin"), request.headers.get("host"))) return blocked("Use the local SCAN page to select source evidence.", 403);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return blocked("Origin evidence upload exceeds its total byte bound.", 413);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;") || !request.body) return blocked("Expected a PCB and BOM upload.", 400);
  let release: (() => void) | undefined, transferred = false;
  try {
    // Admit the upload before buffering source bytes; transfer this same slot
    // to the worker instead of reserving a second slot after the upload.
    release = reserveWorker("placement");
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0, expired = false;
    const cancel = () => { expired = true; void reader.cancel().catch(() => {}); };
    const timer = setTimeout(cancel, 30_000);
    request.signal.addEventListener("abort", cancel, { once: true });
    if (request.signal.aborted) cancel();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BODY) { void reader.cancel().catch(() => {}); return blocked("Origin evidence upload exceeds its total byte bound.", 413); }
        chunks.push(value);
      }
    } finally { clearTimeout(timer); request.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    if (expired || request.signal.aborted) return blocked("Origin evidence upload was interrupted or exceeded its 30-second limit.", 408);
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    const fields = ["pcb", "bom", "control"];
    if ([...form.keys()].length !== fields.length || fields.some(key => form.getAll(key).length !== 1)) return blocked("Origin evidence upload fields are missing, duplicated or unknown.", 400);
    const pcb = form.get("pcb"), bom = form.get("bom"), rawControl = form.get("control");
    if (!(pcb instanceof File) || !(bom instanceof File) || [pcb, bom].some(file => !file.size || file.size > 8_000_000)
      || !pcb.name.toLowerCase().endsWith(".pcb") || typeof rawControl !== "string" || Buffer.byteLength(rawControl) > 240_000) return blocked("Origin evidence requires PCB and BOM files up to 8 MB each and bounded settings.", 400);
    const bomKind = bom.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : bom.name.toLowerCase().endsWith(".xls") ? "xls" : bom.name.toLowerCase().endsWith(".csv") ? "csv" : null;
    if (!bomKind) return blocked("Origin evidence BOM must be XLSX, XLS or CSV.", 400);
    let control;
    try { control = validateOriginEvidenceControl(JSON.parse(rawControl)); }
    catch { return blocked("Origin evidence settings are malformed, unsupported or exceed their bounds.", 400); }
    const pcbBytes = Buffer.from(await pcb.arrayBuffer()), bomBytes = Buffer.from(await bom.arrayBuffer());
    transferred = true;
    const result = await originEvidenceWorker(pcbBytes, bomBytes, { ...control, bomKind }, request.signal, release);
    return reply(result);
  } catch (error) {
    const message = error instanceof Error && /^(Origin evidence|Two imports|Local Python|Local worker)/.test(error.message)
      ? error.message : "Origin evidence failed. No source contents were logged or original files changed.";
    return blocked(message, 400);
  } finally { if (!transferred) release?.(); }
}
