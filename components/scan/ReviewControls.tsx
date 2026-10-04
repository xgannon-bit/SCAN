"use client";

import { useRef } from "react";
import { FolderOpen, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";

export function ReviewControls() {
  const { file, busy, notice, error, saveReview, openReview, gerber } = useScanSession();
  const input = useRef<HTMLInputElement>(null);
  return <section className="scan-review-controls" aria-label="Save and reopen placement review">
    <div className="scan-actions"><Button variant="outline" onClick={() => input.current?.click()} disabled={busy || gerber.busy || gerber.alignBusy}><FolderOpen aria-hidden="true" />Open saved review</Button><Button variant="outline" onClick={saveReview} disabled={!file || busy || gerber.busy || gerber.alignBusy}><Save aria-hidden="true" />Save review</Button></div>
    <input ref={input} hidden type="file" accept=".json" aria-label="Saved placement review file" onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void openReview(selected); }} />
    {notice ? <p role="status">{notice}</p> : <p>Save includes placement bytes, mapping and notes, plus any selected Gerber and alignment controls. Reopening checks source hashes, reparses files and recomputes alignment. Native archive files are managed separately.</p>}
    {error && <p role="alert" className="scan-inline-warning">{error}</p>}
  </section>;
}
