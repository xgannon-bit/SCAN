"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useScanSession } from "./ScanSession";
import type { ArchiveSelection, SnapshotRole } from "@/lib/scan/archive-types";

export function ArchiveIntake() {
  const { archiveFile, inventory, selection, archiveDraft, archiveReview, archiveBusy, archiveError, archiveNotice, changeArchive, changeSelection, cancelArchive, runArchive, downloadArchiveReport } = useScanSession();
  const input = useRef<HTMLInputElement>(null);
  const { root, job, master } = archiveDraft;
  useEffect(() => {
    if (!archiveFile && input.current) input.current.value = "";
  }, [archiveFile]);
  const chosenRoot = inventory?.job_roots.find(candidate => candidate.root === root);
  const jobs = chosenRoot ? (["main", "temp", "backup"] as const).flatMap(role => chosenRoot[`${role}_candidates`].map(member => ({ role, member }))) : [];
  function choose(nextRoot: string, nextJob: string, nextMaster: string) {
    const draft = { root: nextRoot, job: nextJob, master: nextMaster };
    const candidate = inventory?.job_roots.find(value => value.root === nextRoot);
    if (!candidate || !nextJob || !nextMaster) { changeSelection(null, draft); return; }
    const chosen = JSON.parse(nextJob) as { role: SnapshotRole; member: string };
    const masterValue = nextMaster === "none" ? null : JSON.parse(nextMaster) as { role: SnapshotRole; member: string };
    const value: ArchiveSelection = { root: nextRoot, jobMember: chosen.member, jobRole: chosen.role, masterMember: masterValue?.member ?? null, masterRole: masterValue?.role ?? null };
    changeSelection(value, draft);
  }
  function masterRole(member: string): SnapshotRole { return member.toLowerCase().endsWith(".bak") ? "backup" : member.toLowerCase().endsWith("_temp.xml") ? "temp" : "main"; }
  return <section className="scan-panel" aria-labelledby="archive-intake-title" id="archive-intake">
    <div className="scan-panel-heading"><h2 id="archive-intake-title">Existing native job archive</h2><Badge variant="outline">Read-only preflight</Badge></div>
    <div className="scan-panel-body"><p>Optional for continuing an existing job. Select the complete archived job ZIP, then choose its exact job and master snapshots. No native XML or original file is changed.</p>
      <label className="scan-field">Native job archive (.zip)<input ref={input} type="file" accept=".zip" disabled={archiveBusy} onChange={event => changeArchive(event.target.files?.[0] ?? null)} /></label>
      <div className="scan-actions"><Button disabled={!archiveFile || archiveBusy} onClick={() => runArchive("inventory")}>Inventory archive</Button><Button variant="outline" onClick={() => changeArchive(null)}>Clear archive</Button>{archiveBusy && <Button variant="outline" onClick={cancelArchive}>Cancel archive operation</Button>}</div>
      <p aria-live="polite">{archiveBusy ? "Processing archive locally. Large packages may take up to two minutes…" : archiveFile ? `${archiveFile.name} · ${(archiveFile.size / 1_000_000).toFixed(1)} MB` : "100 MB maximum ZIP. Archive bytes stay on this laptop."}</p>
      {inventory && <><p>{inventory.entry_count} archive entries · {inventory.job_roots.length} job roots · {(inventory.total_uncompressed / 1_000_000).toFixed(1)} MB declared uncompressed</p>
        {inventory.reasons.length > 0 && <ul className="scan-issue-list">{inventory.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {inventory.job_roots.length > 0 && <fieldset disabled={archiveBusy} className="scan-archive-fields">
          <label className="scan-field">Job root<select value={root} onChange={event => choose(event.target.value, "", "")}><option value="">Choose one exact root</option>{inventory.job_roots.map(candidate => <option key={candidate.root} value={candidate.root}>{candidate.root}</option>)}</select></label>
          <label className="scan-field">Job snapshot<select disabled={!chosenRoot || archiveBusy} value={job} onChange={event => choose(root, event.target.value, master)}><option value="">Choose main, temp or backup</option>{jobs.map(value => <option key={value.member} value={JSON.stringify(value)}>{value.role} · {value.member}</option>)}</select></label>
          <label className="scan-field">Master snapshot<select disabled={!chosenRoot || archiveBusy} value={master} onChange={event => choose(root, job, event.target.value)}><option value="">Choose a master or explicitly omit</option><option value="none">No master selected — dependent analysis held</option>{chosenRoot?.master_candidates.map(member => <option key={member} value={JSON.stringify({ role: masterRole(member), member })}>{masterRole(member)} · {member}</option>)}</select></label>
        </fieldset>}
        <p className="scan-caption">Main, temporary and backup snapshots remain separate. Selection is explicit; timestamps never decide for you.</p>
        <div className="scan-actions"><Button disabled={!selection || archiveBusy} onClick={() => runArchive("preflight")}>Capture and verify selection</Button></div>
      </>}
      {archiveError && <p role="alert" className="scan-inline-warning">{archiveError}</p>}
      {archiveNotice && <p role="status">{archiveNotice}</p>}
      {archiveReview && <div className="scan-content-stack scan-archive-result">
        <h3>Snapshot integrity verified; native preparation blocked</h3><p>{archiveReview.preflight.preservedFiles.length} preserved files verified against their captured bytes. This does not prove native dependencies or machine compatibility.</p>
        <dl className="scan-detail-grid"><div><dt>Selected job</dt><dd>{archiveReview.preflight.selection.job.role}</dd></div><div><dt>Selected master</dt><dd>{archiveReview.preflight.selection.master?.role ?? "Not selected"}</dd></div><div><dt>Native candidate</dt><dd>None</dd></div></dl>
        <details><summary>Capture identity and XML envelope checks</summary><p className="scan-hash">Snapshot: {archiveReview.capture.snapshotId}</p><p className="scan-hash">Package SHA-256: {archiveReview.capture.packageSha256}</p><pre className="scan-json-evidence">{JSON.stringify(archiveReview.preflight.xmlEnvelopes, null, 2)}</pre></details>
        <ul className="scan-issue-list">{archiveReview.preflight.holds.map((hold, index) => <li key={`${hold.code}-${index}`}><strong>{hold.scope}: {hold.reason}</strong><p>{hold.nextAction}</p></li>)}</ul>
        <div className="scan-actions"><Button variant="outline" onClick={downloadArchiveReport}>Save archive report (JSON)</Button><Button onClick={() => runArchive("download")} disabled={archiveBusy}>Save source snapshot</Button></div>
        <p className="scan-caption">The verified capture is temporary until you save it. Save source snapshot recreates and hash-checks the same capture for download. A .scan-snapshot preserves inputs; Eagle cannot use it as a programmed job.</p>
      </div>}
    </div>
  </section>;
}
