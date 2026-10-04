"use client";
import { useState } from "react";
import Link from "next/link";
import { useScanSession } from "./ScanSession";
import { ArchiveIntake } from "./ArchiveIntake";
import { Button } from "@/components/ui/button";
import { downloadJson } from "@/lib/scan/review-session";
import { nativeQualificationText } from "@/lib/scan/native-qualification";

export function NativeQualification() {
  const { archiveReview, returnedArchive, eagleVersion, setEagleVersion, qualification } = useScanSession();
  const [notice, setNotice] = useState("");
  const [changedOnly, setChangedOnly] = useState(true);
  const report = qualification.report;
  const files = report?.comparison.files.filter(file => !changedOnly || file.state !== "unchanged") ?? [];
  function save(format: "json" | "text") {
    if (!report) return;
    try {
      if (format === "json") downloadJson(report, "scan-native-qualification.json");
      else {
        const url = URL.createObjectURL(new Blob([nativeQualificationText(report)], { type: "text/plain;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "SCAN-NATIVE-QUALIFICATION.txt"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice("Qualification evidence downloaded. No native job was generated or approved.");
    } catch { setNotice("Could not prepare the evidence download. Try again."); }
  }
  return <section className="scan-content-stack" aria-labelledby="native-qualification-title">
    <div className="scan-panel scan-panel-body"><h2 id="native-qualification-title">Verify native output integrity</h2>
      <p>Compare the original archive with a copy returned from Eagle. This is the preservation check needed before native writing: identify added, removed or changed files, including unselected snapshots and assets.</p>
      <p>First verify the original in <Link href="/intake#archive-intake">Source intake</Link>. An authorized operator can then load a separate copy in the intended Eagle version, save it and reopen it, keeping the original untouched. Import the returned ZIP below.</p>
      <label className="scan-field">Intended Eagle software version<input maxLength={128} value={eagleVersion} onChange={event => setEagleVersion(event.target.value)} placeholder="Complete version from the intended installation" /></label>
      <p className="scan-caption">A version entered here is unverified. Matching file bytes, XML format claims and an operator save are separate evidence.</p>
      {!archiveReview && <p>Verify an original archive in Source intake before comparing a returned job.</p>}
    </div>
    {archiveReview && <ArchiveIntake session={returnedArchive} returned />}
    {qualification.error && <p role="alert">{qualification.error}</p>}
    {report && <div className="scan-panel scan-panel-body">
      <h3>{report.comparison.filePayloadsEqual && report.comparison.directoryEntriesEqual ? "Archived payloads preserved" : "Archive changes need review"}</h3>
      <p>{report.comparison.counts.unchanged} unchanged · {report.comparison.counts.changed} changed · {report.comparison.counts.added} added · {report.comparison.counts.removed} removed files</p>
      <p>Archive bytes {report.comparison.archiveBytesEqual ? "match" : "differ"}. Snapshot selections {report.comparison.sameSelection ? "correspond by exact path and role" : "differ; correspondence is held"}. Explicit directory entries {report.comparison.directoryEntriesEqual ? "match" : "differ"}.</p>
      <label><input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} /> Show only changed files</label>
      <p>{files.length} matching files. Showing {Math.min(files.length, 100)}; downloads include all files and directory changes.</p>
      {files.slice(0, 100).map(file => <details key={file.path}><summary>{file.state.toUpperCase()} · {file.path}</summary><p className="scan-hash">Before: {file.before?.sha256 ?? "Absent"}</p><p className="scan-hash">After: {file.after?.sha256 ?? "Absent"}</p></details>)}
      <ul className="scan-issue-list">{report.holds.map(hold => <li key={hold.code}><strong>{hold.reason}</strong><p>{hold.nextAction}</p></li>)}</ul>
      <div className="scan-actions"><Button onClick={() => save("json")}>Save native qualification (.json)</Button><Button variant="outline" onClick={() => save("text")}>Save native qualification (.txt)</Button></div>
      {notice && <p role="status">{notice}</p>}
      <p className="scan-caption">This checks captured inputs only. Package completeness and Eagle compatibility remain unknown; native candidate export stays blocked.</p>
    </div>}
  </section>;
}
