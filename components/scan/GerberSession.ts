"use client";
import { useEffect, useRef, useState } from "react";
import type { PlacementResult } from "@/lib/scan/placement-types";
import type { AlignmentPoint, AlignmentResult, AlignmentScope, GerberConfig, GerberResult } from "@/lib/scan/geometry-types";
import type { RestoredGerber } from "@/lib/scan/review-session";
const emptyPoints = (): AlignmentPoint[] => Array.from({ length: 4 }, (_, i) => ({ id: `point-${i + 1}`, role: i === 3 ? "check" : "fit", cad: ["", ""], gerber: ["", ""], evidence: "" }));
const makeBasis = (placements: PlacementResult | null, result: GerberResult | null) => placements && result?.geometry_complete && result.objects.length ? JSON.stringify({ placementHash: placements.sourceSha256, normalizedHash: placements.interpretationSha256, normalizer: placements.normalizerVersion, delimiter: placements.delimiter, frame: placements.coordinateFrame, schema: placements.schemaVersion, sheet: placements.sheetIndex, mapping: placements.mapping, gerberHash: result.source_sha256, format: result.coordinate_format, overrides: result.interpretation_overrides, parser: result.adapter_version }) : "";

export function useGerberSession(placements: PlacementResult | null) {
  const [file, setFile] = useState<File | null>(null); const [result, setResult] = useState<GerberResult | null>(null);
  const [config, setConfig] = useState<GerberConfig>({ formatOverride: null, assumeLinear: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [points, setPoints] = useState<AlignmentPoint[]>(emptyPoints);
  const [scope, setScope] = useState<AlignmentScope>({ module: "", side: "", boardInstance: "" });
  const [tolerance, setTolerance] = useState("0.1"); const [alignment, setAlignment] = useState<AlignmentResult | null>(null);
  const [alignBusy, setAlignBusy] = useState(false); const [alignError, setAlignError] = useState("");
  const parseController = useRef<AbortController | null>(null); const alignController = useRef<AbortController | null>(null);
  const basis = makeBasis(placements, result);
  const revision = useRef(0);
  const currentBasis = useRef(basis); currentBasis.current = basis;
  useEffect(() => () => { parseController.current?.abort(); alignController.current?.abort(); }, []);
  function invalidateAlignment() { revision.current += 1; alignController.current?.abort(); alignController.current = null; setAlignBusy(false); setAlignment(null); setAlignError(""); }
  function placementChanged() { invalidateAlignment(); setPoints(emptyPoints()); }
  function invalidate() { parseController.current?.abort(); parseController.current = null; setBusy(false); setResult(null); setError(""); placementChanged(); }
  function changeFile(value: File | null) { invalidate(); setFile(value); setConfig({ formatOverride: null, assumeLinear: false }); setPoints(emptyPoints()); }
  function edit(changes: Partial<GerberConfig>) { invalidate(); setConfig(old => ({ ...old, ...changes })); }
  function editPoint(index: number, changes: Partial<AlignmentPoint>) { invalidateAlignment(); setPoints(old => old.map((p, i) => i === index ? { ...p, ...changes } : p)); }
  function editScope(changes: Partial<AlignmentScope>) { placementChanged(); setScope(old => ({ ...old, ...changes })); }
  function editTolerance(value: string) { invalidateAlignment(); setTolerance(value); }
  function reset() { changeFile(null); setScope({ module: "", side: "", boardInstance: "" }); setTolerance("0.1"); }
  async function run() {
    if (!file) return; invalidate(); const abort = new AbortController(); parseController.current = abort; setBusy(true);
    try {
      const form = new FormData(); form.set("file", file); form.set("config", JSON.stringify(config));
      const response = await fetch("/api/gerber", { method: "POST", body: form, signal: abort.signal }); const value = await response.json();
      if (parseController.current !== abort || abort.signal.aborted) return;
      if (!response.ok || value.message) throw new Error(value.message ?? "Gerber import failed");
      setResult(value);
    } catch (failure) { if (parseController.current === abort && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Gerber import failed"); }
    finally { if (parseController.current === abort) { parseController.current = null; setBusy(false); } }
  }
  async function align() {
    invalidateAlignment(); if (!basis) return;
    const capturedBasis = basis; const abort = new AbortController(); alignController.current = abort; setAlignBusy(true);
    try {
      const number = (v: string) => { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())) throw new Error("Enter every control coordinate and tolerance as a plain number in millimeters."); return Number(v); };
      if (!placements?.placements.some(p => p.module === scope.module && p.side === scope.side && p.xMm !== null && p.yMm !== null)) throw new Error("Select a module and side with confirmed placement units.");
      const response = await fetch("/api/alignment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ basis, scope, toleranceMm: number(tolerance), points: points.map(p => ({ ...p, cad: p.cad.map(number), gerber: p.gerber.map(number) })) }), signal: abort.signal });
      const value = await response.json();
      if (alignController.current !== abort || abort.signal.aborted || currentBasis.current !== capturedBasis) return;
      if (!response.ok || value.message) throw new Error(value.message ?? "Alignment failed");
      setAlignment(value);
    } catch (failure) { if (alignController.current === abort && !abort.signal.aborted) setAlignError(failure instanceof Error ? failure.message : "Alignment failed"); }
    finally { if (alignController.current === abort) { alignController.current = null; setAlignBusy(false); } }
  }
  async function restore(saved: RestoredGerber, freshPlacements: PlacementResult | null, signal: AbortSignal) {
    invalidate(); const current = revision.current; const draft = saved.draft;
    const abort = new AbortController(); parseController.current = abort;
    const cancelRestore = () => abort.abort(); signal.addEventListener("abort", cancelRestore, { once: true }); if (signal.aborted) abort.abort();
    setFile(saved.file); setConfig(draft.config); setScope(draft.scope); setTolerance(draft.tolerance); setBusy(true);
    const form = new FormData(); form.set("file", saved.file); form.set("config", JSON.stringify(draft.config));
    try {
      const response = await fetch("/api/gerber", { method: "POST", body: form, signal: abort.signal }); const value = await response.json();
      if (current !== revision.current || signal.aborted) return;
      if (!response.ok || value.message || value.source_sha256 !== draft.source.sha256) throw new Error("Saved Gerber could not be re-read with its recorded interpretation.");
      setResult(value); const freshBasis = makeBasis(freshPlacements, value);
      if (freshBasis !== draft.basis || !freshBasis) { setPoints(emptyPoints()); setAlignError("Sources restored; interpretation changed or remains incomplete. Re-enter control points."); return; }
      setPoints(draft.points);
      if (draft.checked) {
        if (!freshPlacements?.placements.some(p => p.module === draft.scope.module && p.side === draft.scope.side && p.xMm !== null && p.yMm !== null)) throw new Error("Saved alignment scope needs a module and side with confirmed placement units.");
        const number = (v: string) => { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())) throw new Error("Saved alignment controls need review."); return Number(v); };
        const response = await fetch("/api/alignment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ basis: freshBasis, scope: draft.scope, toleranceMm: number(draft.tolerance), points: draft.points.map(p => ({ ...p, cad: p.cad.map(number), gerber: p.gerber.map(number) })) }), signal });
        const value = await response.json(); if (current !== revision.current || signal.aborted) return;
        if (!response.ok || value.message) throw new Error(value.message ?? "Saved alignment did not pass fresh evaluation.");
        setAlignment(value);
      }
    } catch (e) { if (current === revision.current && !signal.aborted) setError(e instanceof Error ? e.message : "Gerber restore failed."); }
    finally { signal.removeEventListener("abort", cancelRestore); if (parseController.current === abort) { parseController.current = null; setBusy(false); } }
  }
  return { file, result, config, busy, error, changeFile, edit, run, reset, invalidateAlignment, placementChanged, points, editPoint, scope, editScope, tolerance, editTolerance, align, alignBusy, alignError, alignment: alignment?.basis === basis && basis ? alignment : null, basis, restore, revision };
}
