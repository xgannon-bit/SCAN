"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { PlacementConfig, PlacementPreview, PlacementResult } from "@/lib/scan/placement-types";
import { decodeReview, downloadJson, encodeReview, type ReviewNotes } from "@/lib/scan/review-session";
import { useArchiveSession } from "./ArchiveSession";

const initial: PlacementConfig = { startRow: 1, columns: { refdes: 1, mpn: 2, xy: 4, side: 5, rotation: 6, footprint: 7 }, module: "", side: "", units: "unknown", rotationDirection: "unknown", decimalSeparator: ".", pairSeparator: "," };

function usePlacementSession() {
  const archive = useArchiveSession();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PlacementPreview | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [config, setConfig] = useState<PlacementConfig>(initial);
  const [sheet, setSheet] = useState(0);
  const [delimiter, setDelimiter] = useState(",");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [notes, setNotes] = useState<ReviewNotes>({});
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);

  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  // Invalidate pending responses synchronously, including clear from another screen.
  function invalidate() {
    revision.current += 1;
    controller.current?.abort(); controller.current = null;
    setBusy(false); setResult(null); setSelectedRow(null); setError(""); setNotice("");
  }
  function edit(changes: Partial<PlacementConfig>) {
    invalidate(); setNotes({}); setConfig(previous => ({ ...previous, ...changes }));
  }
  function changeFile(value: File | null) {
    invalidate(); setNotes({}); setFile(value); setPreview(null); setConfig(initial); setSheet(0); setDelimiter(",");
  }
  function changeSheet(value: number) { invalidate(); setNotes({}); setSheet(value); setPreview(null); }
  function changeDelimiter(value: string) { invalidate(); setNotes({}); setDelimiter(value); setPreview(null); }
  function reset() { changeFile(null); archive.changeArchive(null); }
  function cancel() {
    revision.current += 1;
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
      downloadJson(result, "scan-normalized-placements.json"); setError(""); setNotice("Placement record sent to browser downloads.");
    } catch { setError("The placement record could not be prepared. Your review remains available; try again."); }
  }

  function editNote(key: string, value: string) {
    if (!/^(session|row:[1-9]\d{0,3}|row:10000)$/.test(key) || value.length > 2000) return;
    setNotes(previous => {
      if (!Object.hasOwn(previous, key) && Object.keys(previous).length >= 1000) return previous;
      const next = { ...previous }; if (value) next[key] = value; else delete next[key]; return next;
    });
    revision.current += 1; setNotice("");
  }

  async function saveReview() {
    if (!file || busy) return;
    const current = revision.current;
    try {
      const saved = await encodeReview(file, { config, sheetIndex: sheet, delimiter, validated: !!result, selectedRow, notes });
      if (current !== revision.current) return;
      downloadJson(saved, "scan-placement-review.scan-review.json");
      setError(""); setNotice("Review saved to browser downloads, including the original placement source and mapping.");
    } catch (failure) { if (current === revision.current) setError(failure instanceof Error ? failure.message : "Review could not be saved. Your current work remains available."); }
  }

  async function openReview(saved: File) {
    const current = ++revision.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setNotice("");
    let sourceRestored = false;
    try {
      const { record, source } = await decodeReview(saved);
      if (current !== revision.current || abort.signal.aborted) return;
      // A hash-verified draft must remain editable even if its saved sheet or
      // mapping cannot currently be parsed. Derived results are never restored.
      setFile(source); setConfig(record.config); setSheet(record.sheetIndex); setDelimiter(record.delimiter);
      setPreview(null); setResult(null); setSelectedRow(null); setNotes(record.notes);
      archive.changeArchive(null); sourceRestored = true;
      async function parse(action: "inspect" | "normalize") {
        const form = new FormData();
        form.set("file", source); form.set("action", action); form.set("sheetIndex", String(record.sheetIndex));
        form.set("delimiter", record.delimiter); form.set("config", JSON.stringify(record.config));
        const response = await fetch("/api/placements", { method: "POST", body: form, signal: abort.signal });
        const value = await response.json();
        if (!response.ok || value.message) throw new Error("Saved source could not be parsed with this local worker.");
        if (value.sourceSha256 !== record.source.sha256) throw new Error("Saved source hash differs from the worker result.");
        return value;
      }
      const freshPreview: PlacementPreview = await parse("inspect");
      const freshResult: PlacementResult | null = record.validated ? await parse("normalize") : null;
      if (current !== revision.current || abort.signal.aborted) return;
      setPreview(freshPreview); setResult(freshResult);
      setSelectedRow(freshResult?.placements.some(placement => placement.sourceRow === record.selectedRow) ? record.selectedRow : null);
      setNotice("Review reopened. Embedded placement bytes were hash-checked and parsed again locally; notes are user annotations.");
    } catch (failure) {
      if (current === revision.current && !abort.signal.aborted) setError(sourceRestored ? "Saved source and notes restored, but parsing failed. Open Source intake, correct the worksheet or mapping settings, and read the file again." : failure instanceof Error ? failure.message : "Saved review could not be opened.");
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }

  const stage = busy ? "Processing source" : error ? "Import needs attention" : result ? result.status === "success" ? "Placement parsing complete" : "Placement review needs attention" : preview ? "Mapping needs validation" : file ? "Ready to read" : "No source loaded";
  return { file, preview, result, config, sheet, delimiter, busy, error, selectedRow, notes, notice, stage, edit, changeFile, changeSheet, changeDelimiter, reset, cancel, run, download, setSelectedRow, editNote, saveReview, openReview, ...archive };
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
