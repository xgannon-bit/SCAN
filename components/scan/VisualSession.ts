"use client";
import { useCallback, useRef, useState } from "react";
import { appendVisualJournal, emptyVisualWorkspace, validateVisualWorkspace, type VisualEvent, type VisualWorkspaceState } from "@/lib/scan/visual-workspace";
import { validComponentProgress, type ProcessingEvent } from "@/lib/scan/processing-event";

/** Presentation journal only. No event can change a decision, source or writer. */
export function useVisualSession() {
  const [view, reactSetView] = useState<VisualWorkspaceState>(emptyVisualWorkspace);
  const current = useRef(view);
  const setView = useCallback((update: VisualWorkspaceState | ((old: VisualWorkspaceState) => VisualWorkspaceState)) => {
    current.current = typeof update === "function" ? update(current.current) : update;
    reactSetView(current.current);
  }, []);
  const active = useRef(new Map<string, VisualEvent>());
  const seen = useRef(new Map<string, string>());
  const emit = useCallback((event: VisualEvent) => setView(old => appendVisualJournal(old, event)), [setView]);
  const finish = useCallback((run: string, status: Exclude<VisualEvent["status"], "started">, message: string, count: number | null = null, transportDropped?: number) => {
    const old = active.current.get(run); if (!old) return;
    active.current.delete(run); emit({ ...old, id: crypto.randomUUID(), sequence: old.sequence + 1, at: new Date().toISOString(), status, message, count, ...(transportDropped === undefined ? {} : { transportDropped }) });
  }, [emit]);
  const begin = useCallback((stage: string, source: string, message: string) => {
    for (const [id, event] of active.current) if (event.stage === stage) finish(id, "cancelled", "Superseded by a new operation.");
    const run = crypto.randomUUID(); const event: VisualEvent = { id: crypto.randomUUID(), run, sequence: 1, at: new Date().toISOString(), source, stage, status: "started", message, count: null, entity: null };
    active.current.set(run, event); emit(event); return run;
  }, [emit, finish]);
  const observe = useCallback((stage: string, signature: string, source: string, message: string, count: number | null = null, status: VisualEvent["status"] = "completed") => {
    if (seen.current.get(stage) === signature) return;
    seen.current.set(stage, signature);
    if (!signature) return;
    emit({ id: crypto.randomUUID(), run: crypto.randomUUID(), sequence: 1, at: new Date().toISOString(), source, stage, status, message, count, entity: null });
  }, [emit]);
  const restore = useCallback((value?: VisualWorkspaceState) => {
    active.current.clear(); seen.current.clear();
    // Saved in-flight operations do not resume when a project is reopened.
    const next = value ? validateVisualWorkspace(value) : emptyVisualWorkspace();
    let restored = next;
    for (const event of next.events) if (["started", "progress"].includes(event.status) && !next.events.some(e => e.run === event.run && e.sequence > event.sequence)) { const { geometry: _geometry, componentPhase: _phase, ...record } = event; restored = appendVisualJournal(restored, { ...record, id: crypto.randomUUID(), sequence: event.sequence + 1, at: new Date().toISOString(), status: "cancelled", message: "Project reopened; this earlier operation did not resume." }); }
    setView(restored);
  }, [setView]);
  const fetchArchive = useCallback(async (form: FormData, signal?: AbortSignal, contextHash = "") => {
    const source = String(form.get("expectedArchiveSha256")), analysis = form.get("action") === "placement-diagnosis";
    const selection = JSON.parse(String(form.get("selection")));
    const nativeSource = { contextHash, packageSha256: String(form.get("expectedPackageSha256")), jobMember: String(selection.jobMember), masterMember: String(selection.masterMember ?? "") };
    const run = begin(analysis ? "Native diagnosis" : "Native writer checks", source, "Waiting for actual component checks from the local worker."), id = crypto.randomUUID();
    let stop = false, last = 0, received = false, dropped = 0;
    const poll = async () => {
      try {
        const response = await fetch("/api/archive/progress", { headers: { "X-SCAN-Progress": id }, cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (!response.ok) return;
        const value = await response.json();
        if (value.source !== source || !Array.isArray(value.events) || value.events.length > 1024) return;
        received = true; dropped = value.dropped;
        for (const e of value.events as ProcessingEvent[]) {
          if (!Number.isSafeInteger(e.sequence) || e.sequence !== last + 1 || !Number.isFinite(Date.parse(e.at)) || !validComponentProgress({ kind: e.kind, geometry: e.geometry })) continue;
          const old = active.current.get(run); if (!old) return;
          last = e.sequence;
          const next: VisualEvent = { ...old, id: crypto.randomUUID(), sequence: old.sequence + 1, at: e.at, status: "progress", count: last, entity: JSON.stringify(e.geometry.identity), geometry: e.geometry, nativeSource, componentPhase: e.kind,
            message: `${e.geometry.identity.ref} · module ${e.geometry.identity.module} · ID ${e.geometry.identity.id}: ${e.kind === "analysis-started" ? "source/dependency analysis started" : e.kind === "analysis-held" ? "analysis completed with evidence holds" : e.kind === "analysis-checked" ? "source/dependency analysis completed; any proposal is unaccepted" : e.kind === "placement-checked" ? "exact ROI edit and unchanged scalar checks passed" : "disabled placement, Master and window closure checked"}. Display evidence only; candidate packaging and Eagle checks are separate.` };
          // Keep geometry on the component event only, never on a terminal batch event.
          active.current.set(run, { ...old, sequence: next.sequence }); emit(next);
        }
      } catch { /* Telemetry loss is reported separately; it cannot alter a writer result. */ }
    };
    let wake: (() => void) | undefined;
    const polling = (async () => { while (!stop) { await poll(); if (!stop) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 350); wake = () => { clearTimeout(timer); resolve(); }; }); } })();
    try {
      const response = await fetch("/api/archive", { method: "POST", body: form, signal, headers: { "X-SCAN-Progress": id } });
      stop = true; wake?.(); await polling; await poll();
      const analyzed = analysis && response.ok ? await response.clone().json().catch(() => null) : null;
      const success = response.ok && (analysis ? analyzed?.artifactType === "scan.native-placement-diagnosis" && analyzed.status === "success" : response.headers.get("Content-Type") === "application/octet-stream");
      finish(run, success && received && !dropped ? "completed" : "held", success ? `${last} component events recorded${dropped ? `; ${dropped} additional events exceeded the transport bound` : received ? "" : "; telemetry unavailable"}. ${analysis ? "Analysis returned; current findings are verified separately before use" : "Worker package returned; browser download verification follows"}. Eagle remains unverified.` : analysis ? "Analysis did not return verified findings. Recorded events cannot establish completion." : "Worker did not return a candidate package. Any recorded geometry is an unpublished staged result.", last, received && Number.isSafeInteger(dropped) && dropped >= 0 ? dropped : undefined);
      return response;
    } catch (error) { finish(run, signal?.aborted ? "cancelled" : "failed", "Export interrupted; recorded checks do not establish a delivered candidate."); throw error; }
    finally { stop = true; wake?.(); await polling; }
  }, [begin, emit, finish]);
  const snapshot = useCallback(() => structuredClone(current.current), []);
  return { view, setView, begin, finish, observe, restore, fetchArchive, snapshot };
}
