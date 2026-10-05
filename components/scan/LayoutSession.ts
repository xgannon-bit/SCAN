"use client";
import { useEffect, useRef, useState } from "react";
import type { LayoutResult } from "@/lib/scan/layout-types";
export function useLayoutSession() {
  const [file, setFile] = useState<File | null>(null), [result, setResult] = useState<LayoutResult | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const revision = useRef(0), controller = useRef<AbortController | null>(null);
  function changeFile(value: File | null) { revision.current++; controller.current?.abort(); controller.current = null; setFile(value); setResult(null); setError(""); setBusy(false); }
  useEffect(() => () => controller.current?.abort(), []);
  async function run(source = file, signal?: AbortSignal) {
    if (!source) return; const current = ++revision.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const cancel = () => abort.abort(); signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) abort.abort();
    setBusy(true); setResult(null); setError("");
    try {
      const form = new FormData(); form.set("file", source); form.set("action", "layout"); form.set("config", "{}"); form.set("sheetIndex", "0"); form.set("delimiter", ",");
      const response = await fetch("/api/placements", { method: "POST", body: form, signal: abort.signal }); const value = await response.json();
      if (!response.ok || value.message || value.artifactType !== "scan.accel-source-model") throw new Error(value.message ?? "Source layout could not be read.");
      if (current === revision.current && !abort.signal.aborted) setResult(value);
    } catch (failure) { if (current === revision.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Layout read failed."); }
    finally { signal?.removeEventListener("abort", cancel); if (current === revision.current) { setBusy(false); controller.current = null; } }
  }
  return { file, result, error, busy, revision, changeFile, run };
}
