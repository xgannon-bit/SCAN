import { placementWorker, permittedOrigin } from "@/lib/scan/placement-worker";

export const runtime = "nodejs";
const MAX_BODY = 8_030_000;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function POST(request: Request) {
  if (!permittedOrigin(request.headers.get("origin"), request.headers.get("host"))) return reply({ message: "Use the local SCAN page to select files." }, 403);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) return reply({ message: "Upload exceeds 8 MB." }, 413);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;") || !request.body) return reply({ message: "Expected a placement file upload." }, 400);
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BODY) { await reader.cancel(); return reply({ message: "Upload exceeds 8 MB." }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type")! } }).formData();
    const fields = ["file", "action", "sheetIndex", "delimiter", "config"];
    if ([...form.keys()].length !== fields.length || fields.some((key) => form.getAll(key).length !== 1)) return reply({ message: "Import fields are missing or duplicated." }, 400);
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 8_000_000 || !file.size) return reply({ message: "Select a nonempty file no larger than 8 MB." }, 400);
    const format = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : file.name.toLowerCase().endsWith(".xls") ? "xls" : file.name.toLowerCase().endsWith(".csv") ? "csv" : file.name.toLowerCase().endsWith(".pcb") ? "pcb" : null;
    const action = form.get("action");
    const sheet = form.get("sheetIndex");
    const config = form.get("config");
    const delimiter = form.get("delimiter");
    if (!format || !["inspect", "normalize", "bom", "layout"].includes(String(action)) || typeof sheet !== "string" || !/^\d{1,2}$/.test(sheet) || typeof config !== "string" || config.length > 8000 || typeof delimiter !== "string") return reply({ message: "Invalid import settings or file extension." }, 400);
    let mapping: unknown;
    try { mapping = JSON.parse(config); } catch { return reply({ message: "Invalid column mapping." }, 400); }
    const result = await placementWorker(Buffer.from(await file.arrayBuffer()), { action, format, sheetIndex: Number(sheet), delimiter, config: mapping }, request.signal);
    return reply(result);
  } catch (error) {
    const message = error instanceof Error && /^(Select a nonempty|Two imports|Import |Local Python|Local worker)/.test(error.message) ? error.message : "Import failed. No source contents were logged and no original file was changed.";
    return reply({ message }, 400);
  }
}
