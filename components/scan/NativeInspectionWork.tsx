"use client";

import { useScanSession } from "./ScanSession";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { NativeInspectionWork as InspectionWork } from "@/lib/scan/native-inspection-work";
import { downloadJson } from "@/lib/scan/review-session";

export function NativeInspectionWork({ report }: { report?: InspectionWork }) {
  const { repair, setRepair } = useScanSession();
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [expandedPart, setExpandedPart] = useState<string | null>(null);
  const scopes = useMemo(() => new Map(report?.scopes.map(scope => [scope.id, scope])), [report]);
  const windows = useMemo(() => new Map(report?.windows.map(window => [window.id, window])), [report]);
  const algorithms = useMemo(() => new Map(report?.algorithms.map(algorithm => [algorithm.id, algorithm])), [report]);
  if (!report) return null;
  const matches = report.parts.filter(part => `${Object.values(part.identityLiterals).flat().join(" ")} ${part.sourcePath}`.toLowerCase().includes(filter.toLowerCase()));
  function save() {
    try {
      downloadJson(report, "native-inspection-work.json");
      setNotice("Inspection review queue exported. Geometry, bindings and teaching remain unverified.");
    } catch { setNotice("Export could not be prepared; your current review is retained."); }
  }
  return <section aria-labelledby="native-inspection-work-heading">
    <h3 id="native-inspection-work-heading">Remaining inspection review</h3>
    <p>See the selected Master windows behind each placement and which work is shared. These literal links do not establish correct pad ownership, teaching or completed preparation.</p>
    {report.status !== "recorded" ? <p role="status">{report.reason}</p> : <>
      <p>{report.counts?.nativeParts} placement records · {report.counts?.masterWindows ?? "Unknown"} Master windows · {report.counts?.masterAlgorithms ?? "Unknown"} algorithm records.</p>
      {!report.inventoryComplete && <p>Master records are unavailable. Window workload is unknown; it is not zero.</p>}
      <p>Unresolved scope: {report.counts?.unscopedParts} placements · {report.counts?.unscopedWindows} windows · {report.counts?.unscopedAlgorithms} algorithms. Downloads retain all records, including unlinked and unused Master records.</p>
      <Button variant="outline" onClick={save}>Download inspection review queue (.json)</Button>
      {notice && <p role="status">{notice}</p>}
      {report.actions.map(action => <p key={action.id}><strong>{action.owner}:</strong> {action.nextAction}</p>)}
      <label className="scan-field">Find inspection work by component or native ID<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <p>{matches.length} matching placements. Showing {Math.min(50, matches.length)}; the download contains every record.</p>
      {matches.slice(0, 50).map(part => {
        const scope = scopes.get(part.scopeId ?? "");
        const linkedWindows = (scope?.windowIds ?? []).flatMap(id => windows.get(id) ?? []);
        return <details key={part.id} open={expandedPart === part.id} onToggle={event => {
          if (event.currentTarget.open) setExpandedPart(part.id);
          else setExpandedPart(current => current === part.id ? null : current);
        }}>
          <summary>{part.identityLiterals.RefID?.join(" | ") || "Unknown reference"} · module {part.identityLiterals.ParentId?.join(" | ") || "unknown"} · part {part.identityLiterals.ID?.join(" | ") || "unknown"}</summary>
          {expandedPart === part.id && <>
          <p className="break-words">{part.sourcePath}</p>
          <p>Binding: {part.bindingReview} · Inspection: {part.inspectionReview}</p>
          {!scope ? <p>Master key is missing or ambiguous. Resolve this placement identity before interpreting windows.</p> : <>
            <p>Master key {scope.masterKeyLiteral}: {scope.masterMatchState}. This literal scope links {scope.partIds.length} placement records; changing its shared Master could affect all of them.</p>
            {scope.masterMatchState !== "unique-literal-match" && <p>Resolve the Master relation first. Listed windows are source observations, not verified dependencies.</p>}
            <p>{report.inventoryComplete ? `${linkedWindows.length} observed windows` : "Window count unknown"}. No observed window does not mean no required inspection.</p>
            {linkedWindows.slice(0, 50).map(window => <details key={window.id}>
              <summary>Window {window.rawFields.ID?.join(" | ") || "unknown"} · {window.rawFields.Name?.join(" | ") || "unnamed"}</summary>
              <p className="break-words">{window.sourcePath}</p>
              <p>Geometry: {window.geometryReview} · Binding: {window.bindingReview} · Teaching: {window.teachingReview}</p>
              <p className="break-words">Relative ROI literals: {JSON.stringify(Object.fromEntries(Object.entries(window.rawFields).filter(([key]) => key.startsWith("RelRoi/"))))}</p>
              <label className="scan-field">Shared window review observation<textarea maxLength={2000} value={repair.work.find(note => note.key === window.id && note.sourceSha256 === report.sourceContext?.archiveSha256 && note.snapshotId === report.sourceContext?.snapshotId)?.note ?? ""} onChange={event => { const context = report.sourceContext; if (!context) return; const note = event.target.value; setRepair(old => ({ ...old, work: [...old.work.filter(value => !(value.key === window.id && value.sourceSha256 === context.archiveSha256 && value.snapshotId === context.snapshotId)), { key: window.id, sourceSha256: context.archiveSha256, snapshotId: context.snapshotId, status: "reviewed-offline", note }] })); }} /><span>Applies to this shared window scope ({scope.partIds.length} placements). This note does not mark teaching or machine verification complete.</span></label>
              <p>{window.algorithmIds.length} observed algorithm records. Their presence does not prove correct teaching.</p>
              {window.algorithmIds.slice(0, 50).map(id => {
                const algorithm = algorithms.get(id);
                return algorithm && <p className="break-words" key={id}>{algorithm.sourcePath} · Type literal: {algorithm.rawFields.Type?.join(" | ") || "unknown"} · {algorithm.teachingReview}</p>;
              })}
              {window.algorithmIds.length > 50 && <p>Showing 50 algorithms; download the queue for all records.</p>}
            </details>)}
            {linkedWindows.length > 50 && <p>Showing 50 windows; download the queue for all records.</p>}
          </>}
          </>}
        </details>;
      })}
    </>}
  </section>;
}
