"use client";
import { useEffect, useRef, useState } from "react";
import { initialBomConfig, type BomConfig, type BomResult } from "@/lib/scan/bom-types";
export type RestoredBom = { file: File; config: BomConfig; sheet: number; delimiter: string; checked: boolean };
export function useBomSession() {
  const [file, setFile] = useState<File | null>(null), [config, setConfig] = useState(initialBomConfig);
  const [sheet, setSheet] = useState(0), [delimiter, setDelimiter] = useState(",");
  const [result, setResult] = useState<BomResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const revision = useRef(0), controller = useRef<AbortController | null>(null);
  function invalidate() { revision.current++; controller.current?.abort(); controller.current = null; setResult(null); setBusy(false); setError(""); }
  function changeFile(value: File | null) { invalidate(); setFile(value); }
  function edit(value: BomConfig) { invalidate(); setConfig(value); }
  function changeSheet(value: number) { invalidate(); setSheet(value); }
  function changeDelimiter(value: string) { invalidate(); setDelimiter(value); }
  useEffect(() => () => controller.current?.abort(), []);
  async function parse(source: File, mapping: BomConfig, sheetIndex: number, separator: string, signal?: AbortSignal) {
    const current = ++revision.current; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const cancel = () => abort.abort(); signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) abort.abort();
    setBusy(true); setError(""); setResult(null);
    try {
      const form = new FormData(); form.set("file", source); form.set("action", "bom"); form.set("config", JSON.stringify(mapping)); form.set("sheetIndex", String(sheetIndex)); form.set("delimiter", separator);
      const response = await fetch("/api/placements", { method: "POST", body: form, signal: abort.signal }); const value = await response.json();
      if (!response.ok || value.message || value.artifactType !== "scan.engineering-bom") throw new Error(value.message ?? "BOM could not be parsed.");
      if (current === revision.current && !abort.signal.aborted) setResult(value);
    } catch (failure) { if (current === revision.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "BOM read failed."); }
    finally { signal?.removeEventListener("abort", cancel); if (current === revision.current) { setBusy(false); controller.current = null; } }
  }
  async function restore(saved: RestoredBom, signal?: AbortSignal) { invalidate(); setFile(saved.file); setConfig(saved.config); setSheet(saved.sheet); setDelimiter(saved.delimiter); if (saved.checked) await parse(saved.file, saved.config, saved.sheet, saved.delimiter, signal); }
  return { file, config, sheet, delimiter, result, busy, error, revision, changeFile, edit, changeSheet, changeDelimiter, restore, run: () => file && parse(file, config, sheet, delimiter), reset: () => { changeFile(null); setConfig(initialBomConfig()); setSheet(0); setDelimiter(","); } };
}
