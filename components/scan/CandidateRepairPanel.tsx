"use client";
import { useEffect } from "react";
import { useScanSession } from "./ScanSession";
import { downloadJson } from "@/lib/scan/review-session";
import { Button } from "@/components/ui/button";

/** Repair-only candidates need no PCB or component-constructor recipe to reopen. */
export function CandidateRepairPanel({ onBusyChange }: { onBusyChange: (value: boolean) => void }) {
  const session = useScanSession(), original = session.archiveReview, candidate = session.generatedArchive.archiveReview;
  const history = [...session.repair.history].reverse().find(h => h.candidateSha256 === candidate?.preflight.source.sha256 && h.sourceSha256 === original?.preflight.source.sha256);
  const request = history?.request, composed = !!history?.composition?.accepted.length;
  const { proof, error, busy } = session.candidatePreservation;
  const work = proof?.work;
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  if (!history || composed) return null;
  return <section aria-label="Reanalyzed placement edits">
    <h3>Reanalyzed placement edits</h3>
    {busy && <p role="status">Reproducing the exact accepted edit bytes from the original and checking the reopened candidate…</p>}
    {error && <p role="alert">Repair completion held: {error}</p>}
    {work && <>
      <p role="status">{work.acceptedScalarCount} accepted scalar edits verified in the actual candidate. Exact main bytes match freshly reproduced edits; {work.preservedFiles} other file payloads, including Temp and backups, are preserved. {work.masterBytesPreserved ? "Selected Master bytes are preserved." : "No Master was selected in this legacy trial; Master scope remains unverified."}</p>
      <p>{work.independentlyDerivedPlacementExperiments} source-derived placement experiments freshly reproduced. Historical replay remains a separate writer check. Physically qualified corrections: 0. No inspection repair, Eagle compatibility or production release is established.</p>
      {work.placementEditGroups.map((row, index) => <details key={index}><summary>{row.identity.RefID} · module {row.identity.ParentId} · ID {row.identity.ID} · {row.basis === "historical-replay" ? "Historical replay applied" : row.basis === "independent-source-derived-experiment" ? "Source-derived placement experiment applied" : "Operator-declared trial applied"}</summary>
        <p>Master {row.identity.MasterKey}; existing ENABLE literal {row.literalEnable ?? "missing"} preserved. {row.windows.length} windows and {row.sharedPlacements.length} shared placements need dependency review.</p>
        <ul>{row.changes.map(c => <li key={c.proposalId}><code>{c.path}</code>: {c.before} → {c.after}</li>)}</ul>
        <p>Binding: {row.bindingState}; {row.bindingSegments} observed segments. FOV assignment: {row.fov.assignment}. Acquisition/window coverage: <strong>{row.fov.coverage}</strong>. Nearest-camera assignment is only a heuristic and does not establish that the component or windows fit.</p>
        {!!row.fov.cameraDomainCandidates.length && <p>Camera domain evidence: {row.fov.cameraDomainCandidates.map(c => `${c.field}=${c.value}: ${c.state}; ${c.idMatches.length} Id matches / ${c.pathIdMatches.length} PathId matches`).join("; ")}. No domain or camera center has been selected from these literal matches. Camera Enb and legacy ENABLE remain separate stored observations.</p>}
        <ol>{row.remaining.map(action => <li key={action}>{action}</li>)}</ol>
        <details><summary>Exact evidence and affected dependencies</summary><pre>{JSON.stringify({ evidence: row.evidence, windows: row.windows, sharedPlacements: row.sharedPlacements, fov: row.fov }, null, 2)}</pre></details>
      </details>)}
      <Button variant="outline" onClick={() => downloadJson(work, "reanalyzed-placement-repair.json")}>Download reanalyzed placement receipt</Button>
    </>}
  </section>;
}
