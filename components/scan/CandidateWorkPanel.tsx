"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import { candidatePreparationWork, type CandidatePreparationEvidence } from "@/lib/scan/candidate-work";
import { preparationWorkCsv } from "@/lib/scan/preparation-work";
import { downloadJson } from "@/lib/scan/review-session";
import { CandidateRepairPanel } from "./CandidateRepairPanel";
import { appendDiagnosisSources } from "@/lib/scan/native-placement-diagnosis";

export function CandidateWorkPanel() {
  const session = useScanSession(), generated = session.generatedArchive;
  const original = session.archiveReview, candidate = generated.archiveReview;
  const [work, setWork] = useState<ReturnType<typeof candidatePreparationWork> | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [filter, setFilter] = useState(""), [state, setState] = useState("");
  const [repairBusy, setRepairBusy] = useState(false);
  useEffect(() => { session.setCandidateWorkBusy(busy || repairBusy); return () => session.setCandidateWorkBusy(false); }, [busy, repairBusy, session.setCandidateWorkBusy]);
  const hash = candidate?.preflight.source.sha256;
  const preparation = [...session.nativePreparation.history].reverse().find(h => h.candidateSha256 === hash && h.review.archiveSha256 === original?.preflight.source.sha256);
  const repair = [...session.repair.history].reverse().find(h => h.candidateSha256 === hash && h.sourceSha256 === original?.preflight.source.sha256);
  const authority = useMemo(() => JSON.stringify(preparation ? { accepted: preparation.accepted, packageProfiles: preparation.packageProfiles ?? [], request: repair?.request ?? null } : repair ? { accepted: repair.composition?.accepted ?? [], packageProfiles: repair.composition?.packageProfiles ?? [], request: repair.request } : null), [preparation, repair]);
  const ready = !session.busy && !session.archiveBusy && !generated.archiveBusy && !session.layout.busy && !!session.layout.result && (!!preparation || !!repair?.composition?.accepted.length);
  useEffect(() => {
    const abort = new AbortController(); setWork(null); setError(""); setBusy(false);
    if (!ready || !original || !candidate || !session.archiveFile || !session.selection || !session.layout.file || !session.layout.result) return () => abort.abort();
    const selected = JSON.parse(authority);
    if (!selected) { setError("This generated archive has no matching candidate history for the selected original. Native bytes remain available, but prepared completion is held."); return () => abort.abort(); }
    setBusy(true);
    void (async () => {
      try {
        const form = new FormData(); form.set("file", session.archiveFile!); form.set("layout", session.layout.file!); form.set("action", "draft-review");
        form.set("expectedArchiveSha256", original.preflight.source.sha256); form.set("expectedPackageSha256", original.capture.packageSha256); form.set("selection", JSON.stringify(session.selection));
        form.set("draft", JSON.stringify({ layoutSha256: session.layout.result!.sourceSha256, packageProfiles: selected.packageProfiles }));
        const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal }); const evidence = await response.json();
        if (!response.ok || evidence.artifactType !== "scan.native-preparation-review") throw new Error(evidence.reason ?? evidence.message ?? "Preparation evidence could not be reproduced.");
        if (evidence.plan.source.jobSha256 !== original.preflight.selection.job.sha256 || evidence.plan.source.masterSha256 !== original.preflight.selection.master?.sha256 || evidence.plan.source.layoutSha256 !== session.layout.result!.sourceSha256) throw new Error("Recomputed preparation evidence has different sources.");
        if (selected.request?.diagnosis) {
          const diagnosisForm = new FormData(); diagnosisForm.set("file", session.archiveFile!); diagnosisForm.set("action", "repair-review"); diagnosisForm.set("expectedArchiveSha256", original.preflight.source.sha256); diagnosisForm.set("expectedPackageSha256", original.capture.packageSha256); diagnosisForm.set("selection", JSON.stringify(session.selection)); diagnosisForm.set("repair", JSON.stringify({ request: selected.request }));
          appendDiagnosisSources(diagnosisForm, selected.request.diagnosis, { layout: session.layout.file, placement: session.file, bom: session.bom.file });
          const diagnosisResponse = await fetch("/api/archive", { method: "POST", body: diagnosisForm, signal: abort.signal }), diagnosis = await diagnosisResponse.json();
          if (!diagnosisResponse.ok || diagnosis.status !== "success" || diagnosis.diagnosis?.diagnosisSha256 !== selected.request.diagnosis.diagnosisSha256) throw new Error(diagnosis.reason ?? diagnosis.message ?? "Combined candidate source diagnosis could not be freshly reproduced.");
        }
        const rebuilt = candidatePreparationWork(original, candidate, session.bom.result, evidence as CandidatePreparationEvidence, selected.accepted, selected.request, session.layout.result);
        if (!abort.signal.aborted) { setWork(rebuilt); session.visual.observe("Preparation read-back", candidate.preflight.source.sha256 + authority, session.visualSource, "Actual candidate models and component work rebuilt from original evidence; disabled teaching and machine qualification remain pending.", selected.accepted.length); }
      } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Candidate work could not be rebuilt."); }
      finally { if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => abort.abort();
  }, [ready, original, candidate, authority, session.layout.file, session.layout.result, session.bom.file, session.bom.result, session.file, session.archiveFile, session.selection]);
  if (!generated.archiveFile) return <section className="scan-panel scan-panel-body" id="candidate-work" aria-label="Generated candidate and remaining work"><h2>Generated candidate and remaining work</h2><p>Export accepted preparation or an independently reviewed repair below. SCAN keeps the generated job separate from the original, reparses it and shows what remains for each component.</p></section>;
  async function retry() {
    if (!generated.archiveFile || !generated.selection) return;
    const bytes = await generated.archiveFile.arrayBuffer();
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    await generated.restoreArchive({ file: generated.archiveFile, record: { source: { name: generated.archiveFile.name, size: generated.archiveFile.size, sha256, base64: "" }, selection: generated.selection, draft: generated.archiveDraft } }, new AbortController().signal);
  }
  const rows = work?.rows.filter(r => r.reference.toLowerCase().includes(filter.toLowerCase()) && (!state || r.nativeCreation === state)) ?? [];
  const label = (row: NonNullable<typeof work>["rows"][number]) => row.nativeCreation === "prepared-offline" ? "Prepared draft · machine teaching/qualification needed" : row.nativeCreation === "existing-preserved" ? "Existing work preserved · flagged issues need review" : row.nativeCreation === "proposal-awaiting-review" ? "Review needed" : "Held with reason";
  return <section className="scan-panel scan-panel-body" id="candidate-work" aria-label="Generated candidate and remaining work">
    <h2>Generated candidate and remaining work</h2>
    <p><strong>Original baseline:</strong> {session.archiveFile?.name}. <strong>Separate generated candidate:</strong> {generated.archiveFile.name}. This is an offline qualification copy, not a job returned from Eagle.</p>
    <p>{generated.archiveBusy ? "Reanalyzing the actual generated archive and selected snapshots…" : candidate ? "Generated candidate reanalysis complete. Fresh native records and dependencies are available." : "Generated candidate reanalysis needs attention; completion has not been established."}</p>
    {candidate?.preflight.nativeFovAssignments?.domainReviewCounts && <p>Camera assignments were checked in both saved Id and PathId domains. {Object.entries(candidate.preflight.nativeFovAssignments.domainReviewCounts).map(([key, count]) => `${key}: ${count}`).join("; ")}. These observations grant no pad ownership, acquisition coverage or enabled traversal. Qualify the assignment domain and usable acquisition area in Eagle.</p>}
    {generated.archiveError && <p role="alert">{generated.archiveError}</p>}
    {!generated.archiveBusy && !candidate && <Button onClick={() => void retry()}>Retry generated candidate analysis</Button>}
    {busy && <p role="status">Rebuilding preparation evidence against the original and actual candidate records…</p>}
    {error && <p role="alert">{error}</p>}
    <CandidateRepairPanel onBusyChange={setRepairBusy} />
    {work && <>
      <p role="status">{work.counts.cadReferences} intended references · {work.counts.existingTeachingPreservedReferences} existing reference scopes retained · {work.counts.preparedReferences} prepared drafts ({work.counts.preparedPopulatedSmtIntent} populated SMT intents; {work.rows.filter(r => r.nativeCreation === "prepared-offline" && r.category === "engineering-dnp").length} engineering DNP drafts) · {work.counts.missingPopulatedSmtIntent} populated SMT references held.</p>
      <p>{work.counts.preparedWithPartialWindows} preparations have incomplete window coverage. DNP and hole-bearing work are separate from missing populated SMT. New drafts remain disabled and untaught. Work-order population is unapproved.</p>
      <label className="scan-field">Find candidate component<input value={filter} onChange={e => setFilter(e.target.value)} /></label>
      <label className="scan-field">Candidate work status<select value={state} onChange={e => setState(e.target.value)}><option value="">All components</option><option value="prepared-offline">Prepared draft</option><option value="existing-preserved">Existing work preserved</option><option value="required-if-populated">Held with reason</option><option value="proposal-awaiting-review">Review needed</option></select></label>
      <p>{rows.length} matching components. Select a reference for its created records, exact scope and next machine actions.</p>
      {rows.map(row => <details key={`${row.module}:${row.reference}`}><summary>{row.reference} · module {row.module} · {label(row)}</summary>
        <p>Population / mounting evidence: {row.category.replaceAll("-", " ")}. Placement IDs: {row.placementIds.join(", ") || "No native placement"}; local Masters: {row.masterKeys.join(", ") || "None"}; {row.windows.length} linked windows.</p>
        {row.nativeCreation === "prepared-offline" && <p>SCAN created the placement, local Master and initial reference geometry. Recreating those records is unnecessary if Eagle qualification passes. Binding and teaching must retain the initial positions; that behavior is not yet verified.</p>}
        <p><strong>Package identity:</strong> {row.packageIdentity.status.replaceAll("-", " ")}. BOM MPN: {row.packageIdentity.bomMpn ?? "Unresolved / DNP"}. {row.packageIdentity.comparisons.map(c => `${c.source}: ${c.value ?? "unknown"} (${c.state.replaceAll("-", " ")})`).join("; ")}. {row.packageIdentity.reason}</p>
        {row.holdReason && <p><strong>Held:</strong> {row.holdCode}: {row.holdReason}</p>}
        {row.appliedScalarTrials.length > 0 && <p>{row.appliedScalarTrials.length} separately accepted scalar trial(s) applied. Binding and dependent inspections remain unresolved.</p>}
        {row.omittedWindows.length > 0 && <p><strong>Incomplete windows:</strong> {row.omittedWindows.map(w => `${w.windowId}: ${w.reasons.join(", ")}`).join("; ")}. No inspection exclusion is approved.</p>}
        <ol>{row.atEagle.map((action, index) => <li key={index}>{action}</li>)}</ol>
        <details><summary>Window and shared-model details</summary><p>{row.sharedMasterScopes.map(s => `Master ${s.masterKey}: ${s.placementCount} placements share this scope`).join("; ")}</p><ul>{row.windows.map((w, index) => <li key={index}>Window {w.id} · Master {w.masterKey} · {w.algorithmCount} stored algorithms · geometry {w.geometry} · binding {w.binding} · teaching {w.teaching}</li>)}</ul></details>
      </details>)}
      <div className="scan-actions"><Button variant="outline" onClick={() => downloadJson(work, "reanalyzed-candidate-component-work.json")}>Download reanalyzed component work</Button><Button variant="outline" onClick={() => { const url = URL.createObjectURL(new Blob([preparationWorkCsv(work)], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = "reanalyzed-candidate-component-work.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download component work CSV</Button></div>
    </>}
    <details><summary>Candidate identity and integrity</summary><p>Archive SHA-256: <code>{hash ?? generated.inventory?.archive_sha256 ?? "Not yet verified"}</code>. {candidate?.preflight.preservedFiles.length ?? 0} file payloads verified. Temp and backup snapshots retain original state and must not substitute for the selected main candidate.</p></details>
  </section>;
}
