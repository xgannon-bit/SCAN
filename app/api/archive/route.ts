import { permittedOrigin } from "@/lib/scan/placement-worker";
import { archiveWorker } from "@/lib/scan/archive-worker";
import { reserveWorker } from "@/lib/scan/worker-budget";

export const runtime = "nodejs";
const MAX_BODY = 100_030_000;
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
    const fields = ["file", "action", "expectedArchiveSha256", "selection", "expectedPackageSha256"];
    if ([...form.keys()].length !== fields.length || fields.some(key => form.getAll(key).length !== 1)) return reply("Archive fields are missing, duplicated or unknown.");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 100_000_000 || !file.name.toLowerCase().endsWith(".zip")) return reply("Select a nonempty ZIP no larger than 100 MB.");
    const action = form.get("action"), archiveHash = form.get("expectedArchiveSha256"), selection = form.get("selection"), packageHash = form.get("expectedPackageSha256");
    if (typeof action !== "string" || !["inventory", "preflight", "download"].includes(action) || typeof selection !== "string" || selection.length > 8000 || typeof archiveHash !== "string" || typeof packageHash !== "string") return reply("Invalid archive settings.");
    const control: Record<string, unknown> = { action };
    if (action === "inventory") {
      if (selection !== "null" || archiveHash !== "" || packageHash !== "") return reply("Inventory does not accept a prior selection or hash.");
    } else {
      if (!/^[a-f0-9]{64}$/.test(archiveHash) || (action === "download" ? !/^[a-f0-9]{64}$/.test(packageHash) : packageHash !== "")) return reply("Review the current archive and snapshot hashes first.");
      let chosen: unknown;
      try { chosen = JSON.parse(selection); } catch { return reply("Invalid snapshot selection."); }
      control.expectedArchiveSha256 = archiveHash; control.selection = chosen;
      if (action === "download") control.expectedPackageSha256 = packageHash;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    transferred = true;
    return await archiveWorker(bytes, control, request.signal, release);
  } catch (error) {
    const message = error instanceof Error && /^(Archive |Local Python|Local worker|Two imports)/.test(error.message) ? error.message : "Archive import failed. No source contents were logged or originals changed.";
    return reply(message);
  } finally { if (!transferred) release?.(); }
}
