"use client";

import { useRef } from "react";
import { FolderOpen, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";

export function ReviewControls() {
  const { file, busy, notice, error, saveReview, saveProject, openReview, gerber, archiveFile, archiveBusy, returnedArchive, notes, editNote } = useScanSession();
  const input = useRef<HTMLInputElement>(null);
  const working = busy || archiveBusy || returnedArchive.archiveBusy || gerber.busy || gerber.alignBusy;
  return <section className="scan-review-controls" aria-label="Save and reopen project or source review">
    <div className="scan-actions"><Button variant="outline" onClick={() => input.current?.click()} disabled={working}><FolderOpen aria-hidden="true" />Open saved review or project</Button><Button onClick={saveProject} disabled={working || (!file && !archiveFile && !gerber.file)}><Save aria-hidden="true" />Save project</Button><Button variant="outline" onClick={saveReview} disabled={!file || working}><Save aria-hidden="true" />Save review</Button></div>
    <input ref={input} hidden type="file" accept=".json" aria-label="Saved placement review file" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void openReview(selected); }} />
    {!file && (archiveFile || gerber.file) && <label className="scan-field scan-note-field">Review notes<textarea disabled={working} value={notes.session ?? ""} maxLength={2000} onChange={event => editNote("session", event.target.value)} placeholder="Revision context, questions and remaining engineering work" /></label>}
    {notice ? <p role="status">{notice}</p> : <p>Save project includes original and returned job ZIPs, explicit snapshots, placement and Gerber sources, mappings, notes and machine version. Reopening checks every source hash, inventories selected archives and recomputes results. Save review saves placement and Gerber work only. Project limit: two 100 MB ZIPs, 8 MB per placement or Gerber source; 300 MB saved JSON.</p>}
    {error && <p role="alert" className="scan-inline-warning">{error}</p>}
  </section>;
}
