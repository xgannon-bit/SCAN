"use client";
import { useRef, useState } from "react";
import type { PlacementConfig, PlacementResult } from "@/lib/scan/placement-types";
export type ComparisonPlacement = { file: File; config: PlacementConfig; sheetIndex: number; delimiter: string; result: PlacementResult | null };
export function useComparisonSession() {
  const [entries, setEntries] = useState<ComparisonPlacement[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const revision = useRef(0);
  function keep(entry: ComparisonPlacement) {
    if (!entry.result || entry.result.status !== "success") return setError("Validate the placement source and mapping before retaining it for comparison.");
    if (entries.length >= 3) return setError("At most three independent placement comparisons are supported.");
    if (entries.some(item => item.result?.sourceSha256 === entry.result?.sourceSha256 && JSON.stringify(item.config) === JSON.stringify(entry.config))) return setError("This exact source and mapping is already retained.");
    revision.current++; setEntries(old => [...old, { ...entry, config: structuredClone(entry.config) }]); setError("");
  }
  function remove(index: number) { revision.current++; setEntries(old => old.filter((_, i) => i !== index)); }
  function reset() { revision.current++; setEntries([]); setError(""); setBusy(false); }
  function loadDrafts(saved: ComparisonPlacement[]) { revision.current++; setEntries(saved.map(item => ({ ...item, result: null }))); setError(""); setBusy(false); }
  async function restore(saved: ComparisonPlacement[], signal: AbortSignal) {
    const current = ++revision.current; setEntries(saved.map(item => ({ ...item, result: null }))); setBusy(true); setError("");
    try {
      const rebuilt: ComparisonPlacement[] = [];
      for (const item of saved) {
        const form = new FormData(); form.set("file", item.file); form.set("action", "normalize"); form.set("config", JSON.stringify(item.config)); form.set("sheetIndex", String(item.sheetIndex)); form.set("delimiter", item.delimiter);
        const response = await fetch("/api/placements", { method: "POST", body: form, signal }); const result = await response.json();
        if (!response.ok || result.message || result.artifactType !== "scan.normalized-placements") throw new Error("A retained comparison source needs its mapping reviewed.");
        rebuilt.push({ ...item, result });
      }
      if (current === revision.current && !signal.aborted) setEntries(rebuilt);
    } catch (failure) { if (current === revision.current && !signal.aborted) setError(failure instanceof Error ? failure.message : "Comparison reparse failed; original bytes and mapping are retained."); }
    finally { if (current === revision.current) setBusy(false); }
  }
  return { entries, busy, error, revision, keep, remove, reset, loadDrafts, restore };
}
