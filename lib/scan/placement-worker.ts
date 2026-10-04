import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reserveWorker } from "./worker-budget";

const MAX_UPLOAD = 8_000_000;
const MAX_RESPONSE = 24_000_000;

export function permittedOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host || !/^127\.0\.0\.1(?::\d{1,5})?$/.test(host)) return false;
  return origin === `http://${host}`;
}

export async function placementWorker(bytes: Buffer, control: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  if (!bytes.length || bytes.length > MAX_UPLOAD) throw new Error("Select a nonempty file no larger than 8 MB.");
  const release = reserveWorker("placement");
  let directory: string | undefined;
  const temporaryRoot = path.resolve(tmpdir());
  const ownedTemporaryPath = (candidate: string) => path.dirname(path.resolve(candidate)) === temporaryRoot && path.basename(candidate).startsWith("scan-placement-");
  try {
    directory = await mkdtemp(path.join(temporaryRoot, "scan-placement-"));
    if (!ownedTemporaryPath(directory)) throw new Error("Import temporary directory is invalid.");
    const source = path.join(directory, "source.input");
    await writeFile(source, bytes, { flag: "wx", mode: 0o600 });
    const interpreter = process.env.SCAN_PYTHON || path.join(process.cwd(), ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const request = JSON.stringify({ ...control, protocolVersion: "1", source });
    if (Buffer.byteLength(request) > 16_384) throw new Error("Import configuration is too large.");
    return await new Promise((resolve, reject) => {
      // This runtime is installed locally, never bundled into a deployment.
      const child = spawn(/* turbopackIgnore: true */ interpreter, ["-m", "workers.scan.placement_cli"], {
        cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", OPENPYXL_DEFUSEDXML: "True", OPENPYXL_LXML: "False" },
      });
      let size = 0;
      const chunks: Buffer[] = [];
      let failure: string | undefined;
      const stop = (message: string) => { failure = message; child.kill(); };
      const abort = () => stop("Import cancelled.");
      const timer = setTimeout(() => stop("Import exceeded its 30-second limit."), 30_000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE) stop("Import result exceeds its output limit.");
        else chunks.push(chunk);
      });
      child.stderr.on("data", () => { /* Do not expose source values or library warnings. */ });
      child.stdin.on("error", () => { /* Process close reports the failure. */ });
      child.once("error", () => { failure = "Local Python worker is unavailable. Install workers/requirements.txt in the checkout’s .venv."; });
      child.once("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (failure) return reject(new Error(failure));
        try {
          if (code !== 0 && code !== 2) throw new Error();
          const response = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (response.protocolVersion !== "1" || !["success", "blocked"].includes(response.result?.status)) throw new Error();
          resolve(response.result);
        } catch { reject(new Error("Local worker returned an invalid result. No file was changed.")); }
      });
      child.stdin.end(request);
    });
  } finally {
    try { if (directory && ownedTemporaryPath(directory)) await rm(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}
