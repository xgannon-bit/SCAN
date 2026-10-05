"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PlacementConfig, PlacementPreview, PlacementResult } from "@/lib/scan/placement-types";
import { downloadJson, encodeReview, encodeGerberDraft, type ReviewNotes, type RestoredGerber } from "@/lib/scan/review-session";
import { decodeProject, encodeProject, retainProjectEvidence, type ProjectEvidence } from "@/lib/scan/project-session";
import { useSourceContext } from "./SourceContext";
import { useLayoutSession } from "./LayoutSession";
import { useComparisonSession } from "./ComparisonSession";
import { useBomSession } from "./BomSession";
import { useArchiveSession } from "./ArchiveSession";
import { buildNativeQualification } from "@/lib/scan/native-qualification";
import { useGerberSession } from "./GerberSession";

import { emptyRepair, type RepairSession } from "@/lib/scan/repair-session";

const initial: PlacementConfig = { startRow: 1, columns: { refdes: 1, mpn: 2, xy: 4, side: 5, rotation: 6, footprint: 7 }, module: "", side: "", units: "unknown", rotationDirection: "unknown", decimalSeparator: ".", pairSeparator: "," };

export function retainSessionNote(notes: ReviewNotes): ReviewNotes {
  return Object.hasOwn(notes, "session") ? { session: notes.session } : {};
}

function usePlacementSession() {
  const layout = useLayoutSession(); const bom = useBomSession(); const comparisons = useComparisonSession();
  const [attachments, setAttachments] = useState<{ role: "BOM" | "evidence"; file: File }[]>([]);
  const [repair, setRepair] = useState<RepairSession>(emptyRepair);
  const archive = useArchiveSession();
  const returnedArchive = useArchiveSession();
  const [eagleVersion, updateEagleVersion] = useState("");
  const [projectEvidence, setProjectEvidence] = useState<ProjectEvidence | undefined>();
  const evidenceSources = useRef(new Map<File, string>());
  const qualification = useMemo(() => {
    if (!archive.archiveReview || !returnedArchive.archiveReview) return { report: null, error: "" };
    try { return { report: buildNativeQualification(archive.archiveReview, returnedArchive.archiveReview, eagleVersion), error: "" }; }
    catch (error) { return { report: null, error: error instanceof Error ? error.message : "Qualification comparison is unavailable." }; }
  }, [archive.archiveReview, returnedArchive.archiveReview, eagleVersion]);
  function changeBaseline(file: File | null) { archive.changeArchive(file); returnedArchive.changeArchive(null); }
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
  const gerber = useGerberSession(result);
  function setEagleVersion(value: string) { revision.current += 1; updateEagleVersion(value); setNotice(""); }

  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  useEffect(() => {
    const currentFiles = new Set([file, archive.archiveFile, returnedArchive.archiveFile, gerber.file]);
    let changed = false;
    for (const source of evidenceSources.current.keys()) if (!currentFiles.has(source)) { evidenceSources.current.delete(source); changed = true; }
    if (changed && projectEvidence) {
      const retained = retainProjectEvidence(projectEvidence, new Set(evidenceSources.current.values()));
      if (retained.removed) {
        setProjectEvidence(retained.evidence);
        setNotice(`${retained.removed} historical annotation(s) invalidated because their source was removed or replaced. Annotations for retained sources remain available; none grant approval.`);
      }
    }
  }, [file, archive.archiveFile, returnedArchive.archiveFile, gerber.file, projectEvidence]);

  // Invalidate pending responses synchronously, including clear from another screen.
  function invalidate() {
    gerber.placementChanged();
    revision.current += 1;
    controller.current?.abort(); controller.current = null;
    setBusy(false); setResult(null); setSelectedRow(null); setError(""); setNotice("");
  }
  function edit(changes: Partial<PlacementConfig>) {
    invalidate(); setNotes(retainSessionNote); setConfig(previous => ({ ...previous, ...changes }));
  }
  function changeFile(value: File | null) {
    invalidate(); setNotes(retainSessionNote); setFile(value); setPreview(null); setConfig(initial); setSheet(0); setDelimiter(",");
  }
  function changeSheet(value: number) { invalidate(); setNotes(retainSessionNote); setSheet(value); setPreview(null); }
  function changeDelimiter(value: string) { invalidate(); setNotes(retainSessionNote); setDelimiter(value); setPreview(null); }
  function reset() { changeFile(null); changeBaseline(null); gerber.reset(); bom.reset(); comparisons.reset(); layout.changeFile(null); setEagleVersion(""); setNotes({}); setProjectEvidence(undefined); setRepair(emptyRepair()); setAttachments([]); evidenceSources.current.clear(); }
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
    if (!file || busy || gerber.busy || gerber.alignBusy) return;
    const current = revision.current;
    const geometryRevision = gerber.revision.current;
    try {
      const saved = await encodeReview(file, { config, sheetIndex: sheet, delimiter, validated: !!result, selectedRow, notes });
      const geometry = gerber.file ? await encodeGerberDraft(gerber.file, { config: gerber.config, points: gerber.points, scope: gerber.scope, tolerance: gerber.tolerance, basis: gerber.basis, checked: !!gerber.alignment }) : null;
      if (current !== revision.current || geometryRevision !== gerber.revision.current) return;
      const output = geometry ? { artifactType: "scan.source-review-session", schemaVersion: "1", placement: saved, gerber: geometry, machineExportAllowed: false } : saved;
      if (new TextEncoder().encode(JSON.stringify(output, null, 2)).length > 26_000_000) throw new Error("Source review exceeds the 26 MB limit.");
      downloadJson(output, "scan-placement-review.scan-review.json");
      setError(""); setNotice(geometry ? "Review saved with original placement and Gerber bytes, interpretations and control points. Reopening reparses both and recomputes alignment." : "Review saved to browser downloads, including the original placement source and mapping.");
    } catch (failure) { if (current === revision.current) setError(failure instanceof Error ? failure.message : "Review could not be saved. Your current work remains available."); }
  }

  async function buildProjectBlob(repairOverride = repair) {
    return encodeProject({
        placement: file ? { file, settings: { config, sheetIndex: sheet, delimiter, validated: !!result, selectedRow, notes } } : null,
        gerber: gerber.file ? { file: gerber.file, settings: { config: gerber.config, points: gerber.points, scope: gerber.scope, tolerance: gerber.tolerance, basis: gerber.basis, checked: !!gerber.alignment } } : null,
        original: archive.archiveFile ? { file: archive.archiveFile, selection: archive.selection, draft: archive.archiveDraft } : null,
        returned: returnedArchive.archiveFile ? { file: returnedArchive.archiveFile, selection: returnedArchive.selection, draft: returnedArchive.archiveDraft } : null,
        ...(layout.file ? { layout: { file: layout.file, checked: !!layout.result } } : {}), comparisons: comparisons.entries, ...(bom.file ? { bom: { file: bom.file, config: bom.config, sheet: bom.sheet, delimiter: bom.delimiter, checked: !!bom.result } } : {}), attachments, notes, repair: repairOverride, machineVersion: eagleVersion, ...(projectEvidence ? { evidence: projectEvidence } : {}),
      });
  }

  async function saveProject() {
    if (busy || layout.busy || bom.busy || comparisons.busy || archive.archiveBusy || returnedArchive.archiveBusy || gerber.busy || gerber.alignBusy || (!file && !archive.archiveFile && !gerber.file && !bom.file && !layout.file && !comparisons.entries.length)) return;
    const current = revision.current; const layoutRevision = layout.revision.current; const bomRevision = bom.revision.current; const comparisonRevision = comparisons.revision.current; const originalRevision = archive.archiveRevision.current;
    const returnedRevision = returnedArchive.archiveRevision.current; const geometryRevision = gerber.revision.current;
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setBusy(true); setError(""); setNotice("");
    try {
      const output = await buildProjectBlob();
      if (current !== revision.current || originalRevision !== archive.archiveRevision.current || returnedRevision !== returnedArchive.archiveRevision.current || geometryRevision !== gerber.revision.current || layoutRevision !== layout.revision.current || bomRevision !== bom.revision.current || comparisonRevision !== comparisons.revision.current || abort.signal.aborted) return;
      const url = URL.createObjectURL(output); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "scan-project.scan-project.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Download requested: scan-project.scan-project.json. Check your browser downloads for the saved file. The package contains original sources, BOM, comparison mappings, archive selections, notes and machine version. Reopening verifies bytes and recomputes findings and comparisons; reviewed repair decisions and candidate revision receipts are retained. Repair export always rechecks source and exact scope.");
    } catch (failure) { if (current === revision.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Project could not be saved. Your current work remains available."); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }

  async function openReview(saved: File) {
    const current = ++revision.current;
    const originalRevision = archive.archiveRevision.current; const returnedRevision = returnedArchive.archiveRevision.current;
    const startingGeometryRevision = gerber.revision.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setNotice("");
    let sourceRestored = false;
    let geometryToRestore: RestoredGerber | undefined;
    let geometryRevision = -1;
    try {
      // Every embedded source is hash-checked before replacing any project state.
      const restored = await decodeProject(saved);
      if (current !== revision.current || abort.signal.aborted || originalRevision !== archive.archiveRevision.current || returnedRevision !== returnedArchive.archiveRevision.current || startingGeometryRevision !== gerber.revision.current) return;
      const { placement, gerber: savedGerber } = restored;
      evidenceSources.current = new Map([
        ...(placement ? [[placement.source, placement.record.source.sha256] as const] : []),
        ...(savedGerber ? [[savedGerber.file, savedGerber.draft.source.sha256] as const] : []),
        ...(restored.original ? [[restored.original.file, restored.original.record.source.sha256] as const] : []),
        ...(restored.returned ? [[restored.returned.file, restored.returned.record.source.sha256] as const] : []),
      ]);
      gerber.reset(); bom.reset(); comparisons.reset(); layout.changeFile(null);
      comparisons.loadDrafts(restored.comparisons ?? []);
      if (restored.layout) layout.changeFile(restored.layout.file);
      if (restored.bom) await bom.restore({ ...restored.bom, checked: false }, abort.signal);
      // Install verified source drafts before any worker request, so cancellation
      // or a parser failure cannot discard another source's saved settings.
      if (savedGerber) {
        gerber.changeFile(savedGerber.file); gerber.edit(savedGerber.draft.config);
        gerber.editScope(savedGerber.draft.scope); gerber.editTolerance(savedGerber.draft.tolerance);
        savedGerber.draft.points.forEach((point, index) => gerber.editPoint(index, point));
      }
      geometryToRestore = savedGerber; geometryRevision = gerber.revision.current;
      // A hash-verified draft must remain editable even if its saved sheet or
      // mapping cannot currently be parsed. Derived results are never restored.
      setFile(placement?.source ?? null); setConfig(placement?.record.config ?? initial); setSheet(placement?.record.sheetIndex ?? 0); setDelimiter(placement?.record.delimiter ?? ",");
      setPreview(null); setResult(null); setSelectedRow(null); setNotes(restored.record.notes);
      changeBaseline(null); updateEagleVersion(restored.record.machineVersion); setProjectEvidence(restored.record.evidence); setRepair(restored.record.repair ?? emptyRepair()); setAttachments(restored.attachments ?? []); sourceRestored = true;
      // One archive worker is allowed at a time. Keep the returned file visible
      // while the original is inventoried, without reusing any saved reports.
      if (restored.original) archive.loadArchiveDraft(restored.original);
      if (restored.returned) returnedArchive.loadArchiveDraft(restored.returned);
      const expectedReturnedRevision = returnedArchive.archiveRevision.current;
      let archivesFresh = true;
      if (restored.original) archivesFresh = await archive.restoreArchive(restored.original, abort.signal);
      if (current !== revision.current || abort.signal.aborted) return;
      if (restored.returned && returnedArchive.archiveRevision.current === expectedReturnedRevision) archivesFresh = await returnedArchive.restoreArchive(restored.returned, abort.signal) && archivesFresh;
      else if (restored.returned) archivesFresh = false;
      if (current !== revision.current || abort.signal.aborted) return;
      async function parse(action: "inspect" | "normalize") {
        if (!placement) return null;
        const { source, record } = placement;
        const form = new FormData();
        form.set("file", source); form.set("action", action); form.set("sheetIndex", String(record.sheetIndex));
        form.set("delimiter", record.delimiter); form.set("config", JSON.stringify(record.config));
        const response = await fetch("/api/placements", { method: "POST", body: form, signal: abort.signal });
        const value = await response.json();
        if (!response.ok || value.message) throw new Error("Saved source could not be parsed with this local worker.");
        if (value.sourceSha256 !== record.source.sha256) throw new Error("Saved source hash differs from the worker result.");
        return value;
      }
      const freshPreview: PlacementPreview | null = placement ? await parse("inspect") : null;
      const freshResult: PlacementResult | null = placement?.record.validated ? await parse("normalize") : null;
      if (current !== revision.current || abort.signal.aborted) return;
      setPreview(freshPreview); setResult(freshResult);
      if (savedGerber && gerber.revision.current === geometryRevision) await gerber.restore(savedGerber, freshResult, abort.signal);
      if (current !== revision.current || abort.signal.aborted) return;
      if (restored.layout?.checked) await layout.run(restored.layout.file, abort.signal);
      if (restored.bom) await bom.restore(restored.bom, abort.signal);
      if (restored.comparisons?.length) await comparisons.restore(restored.comparisons, abort.signal);
      if (current !== revision.current || abort.signal.aborted) return;
      setSelectedRow(freshResult?.placements.some(value => value.sourceRow === placement?.record.selectedRow) ? placement!.record.selectedRow : null);
      setNotice(restored.original ? archivesFresh ? "Project reopened. All embedded bytes were hash-checked; archive inventory, selected preflight and available comparisons were recomputed. Notes and historical evidence remain annotations." : "Project sources reopened after hash verification. Archive checks need attention; inspect the original and returned archive panels. No saved derived reports were trusted." : "Review reopened. Embedded source bytes were hash-checked and parsed again locally; notes are user annotations.");
    } catch (failure) {
      if (sourceRestored && geometryToRestore && current === revision.current && !abort.signal.aborted && gerber.revision.current === geometryRevision) await gerber.restore(geometryToRestore, null, abort.signal);
      if (current === revision.current && !abort.signal.aborted) setError(sourceRestored ? "Saved source and notes restored, but parsing failed. Open Source intake, correct the worksheet or mapping settings, and read the file again." : failure instanceof Error ? failure.message : "Saved review could not be opened.");
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }

  const contextFiles = useMemo(() => [file, gerber.file, bom.file, layout.file, ...comparisons.entries.map(item => item.file), ...attachments.map(item => item.file)], [file, gerber.file, bom.file, layout.file, comparisons.entries, attachments]);
  const sourceContext = useSourceContext(contextFiles, JSON.stringify({ config, sheet, delimiter, gerber: { config: gerber.config, points: gerber.points, scope: gerber.scope, tolerance: gerber.tolerance, basis: gerber.basis }, bom: { config: bom.config, sheet: bom.sheet, delimiter: bom.delimiter }, comparisons: comparisons.entries.map(item => ({ config: item.config, sheet: item.sheetIndex, delimiter: item.delimiter })) }));
  const stage = busy ? "Processing source" : error ? "Import needs attention" : result ? result.status === "success" ? "Placement parsing complete" : "Placement review needs attention" : preview ? "Mapping needs validation" : file ? "Ready to read" : "No source loaded";
  return { sourceContext, layout, comparisons, bom, attachments, setAttachments, buildProjectBlob, repair, setRepair, file, preview, result, config, sheet, delimiter, busy, error, selectedRow, notes, notice, stage, edit, changeFile, changeSheet, changeDelimiter, reset, cancel, run, download, setSelectedRow, editNote, saveReview, saveProject, openReview, projectEvidence, ...archive, changeArchive: changeBaseline, returnedArchive, eagleVersion, setEagleVersion, qualification, gerber };
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
