"use client";
import { useEffect, useState } from "react";
import { useScanSession } from "./ScanSession";
import { candidateRepairWork } from "@/lib/scan/candidate-repair-work";
import { downloadJson } from "@/lib/scan/review-session";
import { Button } from "@/components/ui/button";

/** Repair-only candidates need no PCB or component-constructor recipe to reopen. */
export function CandidateRepairPanel({ onBusyChange }: { onBusyChange: (value: boolean) => void }) {
  const session = useScanSession(), original = session.archiveReview, candidate = session.generatedArchive.archiveReview;
  const history = [...session.repair.history].reverse().find(h => h.candidateSha256 === candidate?.preflight.source.sha256 && h.sourceSha256 === original?.preflight.source.sha256);
  const request = history?.request, composed = !!history?.composition?.accepted.length;
  const [work, setWork] = useState<ReturnType<typeof candidateRepairWork> | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const ready = !session.busy && !session.archiveBusy && !session.generatedArchive.archiveBusy;
  useEffect(() => {
    const abort = new AbortController(); setWork(null); setError(""); setBusy(false); onBusyChange(false);
    if (!ready || !original || !candidate || !request || composed || !session.archiveFile || !session.selection) return () => abort.abort();
    setBusy(true); onBusyChange(true);
    void (async () => {
      try {
        const form = new FormData(); form.set("file", session.archiveFile!); form.set("action", "repair-review");
        form.set("expectedArchiveSha256", original.preflight.source.sha256); form.set("expectedPackageSha256", original.capture.packageSha256); form.set("selection", JSON.stringify(session.selection));
        form.set("repair", JSON.stringify({ request }));
        const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal }); const result = await response.json();
        if (!response.ok || result.status !== "success" || typeof result.expectedAcceptedJobSha256 !== "string") throw new Error(result.reason ?? result.message ?? "The accepted edits could not be freshly reproduced from the original.");
        const rebuilt = candidateRepairWork(original, candidate, request, result.expectedAcceptedJobSha256);
        if (!abort.signal.aborted) setWork(rebuilt);
      } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Candidate repair reanalysis failed."); }
      finally { if (!abort.signal.aborted) { setBusy(false); onBusyChange(false); } }
    })();
    return () => { abort.abort(); onBusyChange(false); };
  }, [ready, original, candidate, request, composed, session.archiveFile, session.selection, onBusyChange]);
  if (!history || composed) return null;
  return <section aria-label="Reanalyzed placement edits">
    <h3>Reanalyzed placement edits</h3>
    {busy && <p role="status">Reproducing the exact accepted edit bytes from the original and checking the reopened candidate…</p>}
    {error && <p role="alert">Repair completion held: {error}</p>}
    {work && <>
      <p role="status">{work.acceptedScalarCount} accepted scalar edits verified in the actual candidate. Exact main bytes match freshly reproduced edits; {work.preservedFiles} other file payloads, including Temp and backups, are preserved. {work.masterBytesPreserved ? "Selected Master bytes are preserved." : "No Master was selected in this legacy trial; Master scope remains unverified."}</p>
      <p>Historical replay verifies the writer and review workflow. Independently diagnosed corrections: {work.independentlyDiagnosedCorrections}. No inspection repair, Eagle compatibility or production release is established.</p>
      {work.placementEditGroups.map((row, index) => <details key={index}><summary>{row.identity.RefID} · module {row.identity.ParentId} · ID {row.identity.ID} · {row.basis === "historical-replay" ? "Historical replay applied" : "Operator-declared trial applied"}</summary>
        <p>Master {row.identity.MasterKey}; existing ENABLE literal {row.literalEnable ?? "missing"} preserved. {row.windows.length} windows and {row.sharedPlacements.length} shared placements need dependency review.</p>
        <ul>{row.changes.map(c => <li key={c.proposalId}><code>{c.path}</code>: {c.before} → {c.after}</li>)}</ul>
        <p>Binding: {row.bindingState}; {row.bindingSegments} observed segments. FOV assignment: {row.fov.assignment}. Acquisition/window coverage: <strong>{row.fov.coverage}</strong>. Nearest-camera assignment is only a heuristic and does not establish that the component or windows fit.</p>
        <ol>{row.remaining.map(action => <li key={action}>{action}</li>)}</ol>
        <details><summary>Exact evidence and affected dependencies</summary><pre>{JSON.stringify({ evidence: row.evidence, windows: row.windows, sharedPlacements: row.sharedPlacements, fov: row.fov }, null, 2)}</pre></details>
      </details>)}
      <Button variant="outline" onClick={() => downloadJson(work, "reanalyzed-placement-repair.json")}>Download reanalyzed placement receipt</Button>
    </>}
  </section>;
}
