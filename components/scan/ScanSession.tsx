"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PlacementConfig, PlacementPreview, PlacementResult } from "@/lib/scan/placement-types";

const initial: PlacementConfig = { startRow: 1, columns: { refdes: 1, mpn: 2, xy: 4, side: 5, rotation: 6, footprint: 7 }, module: "", side: "", units: "unknown", rotationDirection: "unknown", decimalSeparator: ".", pairSeparator: "," };

function usePlacementSession() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PlacementPreview | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [config, setConfig] = useState<PlacementConfig>(initial);
  const [sheet, setSheet] = useState(0);
  const [delimiter, setDelimiter] = useState(",");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  // Invalidate pending responses synchronously, including clear from another screen.
  function invalidate() {
    controller.current?.abort(); controller.current = null;
    setBusy(false); setResult(null); setSelectedRow(null); setError("");
  }
  function edit(changes: Partial<PlacementConfig>) {
    invalidate(); setConfig(previous => ({ ...previous, ...changes }));
  }
  function changeFile(value: File | null) {
    invalidate(); setFile(value); setPreview(null); setConfig(initial); setSheet(0); setDelimiter(",");
  }
  function changeSheet(value: number) { invalidate(); setSheet(value); setPreview(null); }
  function changeDelimiter(value: string) { invalidate(); setDelimiter(value); setPreview(null); }
  function reset() { changeFile(null); }
  function cancel() {
    controller.current?.abort(); controller.current = null;
    setBusy(false); setError("Import cancelled.");
  }

  async function run(action: "inspect" | "normalize") {
    if (!file || (action === "normalize" && !preview)) return;
    invalidate();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    if (action === "inspect") setPreview(null);
    const form = new FormData();
    form.set("file", file); form.set("action", action); form.set("sheetIndex", String(sheet));
    form.set("delimiter", delimiter); form.set("config", JSON.stringify(config));
    try {
      const response = await fetch("/api/placements", { method: "POST", body: form, signal: abort.signal });
      const value = await response.json();
      if (controller.current !== abort || abort.signal.aborted) return;
      if (!response.ok || value.message) throw new Error(value.message || "Import failed.");
      if (action === "inspect") setPreview(value);
      else {
        if (value.sourceSha256 !== preview?.sourceSha256) throw new Error("Source changed since preview. Read the file again before validation.");
        setResult(value);
      }
    } catch (failure) {
      if (controller.current === abort && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Import failed.");
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  }

  function download() {
    if (!result || result.status !== "success") return;
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "scan-normalized-placements.json"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("The placement record could not be prepared. Your review remains available; try again."); }
  }

  const stage = busy ? "Processing source" : error ? "Import needs attention" : result ? result.status === "success" ? "Placement parsing complete" : "Placement review needs attention" : preview ? "Mapping needs validation" : file ? "Ready to read" : "No source loaded";
  return { file, preview, result, config, sheet, delimiter, busy, error, selectedRow, stage, edit, changeFile, changeSheet, changeDelimiter, reset, cancel, run, download, setSelectedRow };
}

const ScanSessionContext = createContext<ReturnType<typeof usePlacementSession> | null>(null);

export function ScanSessionProvider({ children }: { children: React.ReactNode }) {
  const session = usePlacementSession();
  return <ScanSessionContext.Provider value={session}>{children}</ScanSessionContext.Provider>;
}

export function useScanSession() {
  const session = useContext(ScanSessionContext);
  if (!session) throw new Error("SCAN session provider is missing.");
  return session;
}
