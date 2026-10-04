import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import path from "node:path";
import { reserveWorker } from "./worker-budget";
import type { ArchiveReview } from "./archive-types";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function archiveWorker(bytes: Buffer, control: Record<string, unknown>, signal: AbortSignal, reservedRelease?: () => void): Promise<Response> {
  const release = reservedRelease ?? reserveWorker("archive");
  const temporaryRoot = path.resolve(tmpdir());
  const ownedPath = (candidate: string) => path.dirname(path.resolve(candidate)) === temporaryRoot && path.basename(candidate).startsWith("scan-archive-");
  let directory: string | undefined, streaming = false, disposal: Promise<void> | undefined;
  function dispose() {
    return disposal ??= (async () => {
      try { if (directory && ownedPath(directory)) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch { throw new Error("Archive temporary cleanup failed. Restart SCAN before another archive operation."); }
      finally { release(); }
    })();
  }
  try {
    if (!bytes.length || bytes.length > 100_000_000) throw new Error("Archive must be a nonempty ZIP no larger than 100 MB.");
    if (signal.aborted) throw new Error("Archive import cancelled.");
    directory = await mkdtemp(path.join(temporaryRoot, "scan-archive-"));
    if (!ownedPath(directory)) throw new Error("Archive temporary directory is invalid.");
    const source = path.join(directory, "source.zip");
    await writeFile(source, bytes, { flag: "wx", mode: 0o600 });
    const request = JSON.stringify({ ...control, protocolVersion: "1", source });
    if (Buffer.byteLength(request) > 16_384) throw new Error("Archive selection is too large.");
    const interpreter = process.env.SCAN_PYTHON || path.join(process.cwd(), ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = spawn(/* turbopackIgnore: true */ interpreter, ["-m", "workers.scan.archive_browser_cli"], {
        cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", TEMP: directory, TMP: directory, TMPDIR: directory },
      });
      const chunks: Buffer[] = []; let size = 0, failure: string | undefined;
      const stop = (message: string) => { failure = message; child.kill(); };
      const abort = () => stop("Archive import cancelled.");
      const timer = setTimeout(() => stop("Archive import exceeded its 120-second limit."), 120_000);
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 24_000_000) stop("Archive result exceeds its output limit."); else chunks.push(chunk); });
      child.stderr.on("data", () => { /* Private source diagnostics never enter the host log. */ });
      child.stdin.on("error", () => {});
      child.once("error", () => { failure = "Local Python worker is unavailable. Check the checkout's .venv."; });
      child.once("close", code => {
        clearTimeout(timer); signal.removeEventListener("abort", abort);
        if (failure) return reject(new Error(failure));
        try {
          const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (![0, 2, 3].includes(code ?? -1) || envelope.protocolVersion !== "1" || !["success", "blocked", "unsupported"].includes(envelope.result?.status)) throw new Error();
          resolve(envelope.result);
        } catch { reject(new Error("Local worker returned an invalid archive result.")); }
      });
      child.stdin.end(request);
    });
    if (!["download", "reference"].includes(String(control.action)) || result.status !== "success") return Response.json(result, { headers });
    const review = result as unknown as ArchiveReview;
    const reference = control.action === "reference";
    const payload = reference ? review.reference : { sha256: review.capture.packageSha256, size: review.capture.size };
    const snapshot = path.join(directory, reference ? "result.native-reference.zip" : "result.scan-snapshot");
    const info = await stat(snapshot);
    if (review.artifactType !== "scan.archive-review" || review.machineExportAllowed !== false || review.capture.packageSha256 !== control.expectedPackageSha256 || !payload || !/^[a-f0-9]{64}$/.test(payload.sha256) || (reference && review.reference?.nativeEditsApplied !== false) || !info.isFile() || info.size !== payload.size || info.size > (reference ? 125_000_000 : 620_000_000)) throw new Error("Archive snapshot does not match the reviewed capture.");
    if (signal.aborted) throw new Error("Archive import cancelled.");
    const input = createReadStream(snapshot);
    const reader = (Readable.toWeb(input) as ReadableStream<Uint8Array>).getReader();
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      // Wait for the Windows file handle to close before removing its directory.
      if (!input.closed) await new Promise<void>(resolve => input.once("close", resolve));
      await dispose();
    })();
    const abort = () => { void close().catch(() => { console.error("SCAN archive temporary cleanup failed; restart required."); }); };
    const timer = setTimeout(abort, 120_000);
    signal.addEventListener("abort", abort, { once: true });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const value = await reader.read(); if (value.done) { await close(); controller.close(); } else controller.enqueue(value.value); }
        catch { await close().catch(() => {}); controller.error(new Error("Snapshot download interrupted.")); }
      },
      cancel: close,
    });
    streaming = true;
    return new Response(body, { headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(info.size), "Content-Disposition": `attachment; filename="${reference ? "scan-preserved-native-reference.zip" : "scan-source.scan-snapshot"}"`, "X-SCAN-SHA256": payload.sha256, "X-SCAN-Source-SHA256": review.preflight.source.sha256, "X-SCAN-Native-Edits": "none" } });
  } finally { if (!streaming) await dispose(); }
}
