"use client";

import Link from "next/link";
import { ArrowRight, Download, FileSpreadsheet, LockKeyhole } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useScanSession } from "./ScanSession";

export function ScanDashboard() {
  const { file, preview, result, stage, busy, error, reset, download, notes, editNote, archiveFile, inventory, archiveReview, archiveBusy, gerber } = useScanSession();
  const ready = result?.status === "success";
  const nextTitle = busy ? "Source processing is running" : error ? "Review the import message" : ready ? "Inspect your placement coordinates" : result ? "Resolve the source review holds" : preview ? "Confirm the placement mapping" : file ? "Read the selected placement file" : "Start with your placement file";
  const nextHref = error ? "/intake" : ready ? "/workspace" : result ? "/findings" : "/intake";
  return <div className="scan-content-stack">
    <section className="scan-session-hero" aria-labelledby="next-action-title">
      <div><p className="scan-eyebrow">Next action</p><h2 id="next-action-title">{nextTitle}</h2><p>{ready ? "Your parsed placements are available in the board workspace with their exact module, side and source identity." : "Import, map and review your source coordinates in one SCAN session. The dashboard follows your progress."}</p></div>
      <Link href={nextHref} className={buttonVariants()}>{error ? "Review import message" : ready ? "Open board workspace" : result ? "Review source findings" : file ? "Continue source intake" : "Open placement intake"}<ArrowRight aria-hidden="true" /></Link>
    </section>
    <div className="scan-dashboard-grid">
      <section className="scan-panel" aria-labelledby="placement-source-title">
        <div className="scan-panel-heading"><h2 id="placement-source-title"><FileSpreadsheet size={17} aria-hidden="true" /> Placement source</h2><Badge variant="outline">{file ? "Selected" : "Needed"}</Badge></div>
        <div className="scan-panel-body"><h3 className="scan-file-name">{file?.name ?? "No source loaded"}</h3><p role="status" aria-label="Placement session status">{stage}</p>
          <dl className="scan-source-metrics"><div><dt>Source rows</dt><dd>{preview?.rowCount ?? "—"}</dd></div><div><dt>Parsed placements</dt><dd>{result?.counts.parsed ?? "—"}</dd></div><div><dt>Row errors</dt><dd>{result?.counts.errors ?? "—"}</dd></div><div><dt>Warnings</dt><dd>{result?.counts.warnings ?? "—"}</dd></div></dl>
          {preview && <details><summary>Source identity</summary><p className="scan-hash">SHA-256: {preview.sourceSha256}</p></details>}
          <div className="scan-actions"><Link href="/intake" className={buttonVariants({ variant: "outline" })}>Review intake</Link>{(file || archiveFile) && <Button variant="ghost" onClick={reset}>Clear session</Button>}</div>
          {file && <label className="scan-field scan-note-field">Review notes<textarea disabled={busy} value={notes.session ?? ""} maxLength={2000} onChange={event => editNote("session", event.target.value)} placeholder="Revision context, questions and remaining engineering work" /></label>}
        </div>
      </section>
      <section className="scan-panel" aria-labelledby="native-readiness-title">
        <div className="scan-panel-heading"><h2 id="native-readiness-title"><LockKeyhole size={17} aria-hidden="true" /> Native job handoff</h2><Badge variant="outline">Unavailable</Badge></div>
        <div className="scan-panel-body"><p>Placement parsing is one part of preparing the complete Eagle/Athena job.</p><ul className="scan-readiness-list"><li><strong>Gerber and source registration</strong><span>{gerber.alignment?.status === "success" ? "Control-point checks passed" : gerber.result?.geometry_complete ? "Geometry parsed; alignment needs review" : "Add a Gerber layer"}</span></li><li><strong>Native references</strong><span>{archiveReview?.preflight.literalDependencies ? "Literal checks recorded; semantics unqualified" : "Not analyzed"}</span></li><li><strong>Version-qualified native writer</strong><span>Not implemented</span></li></ul>
          <div className="scan-actions"><Button disabled>Export machine job</Button><Button variant="outline" disabled={!ready} onClick={download}><Download aria-hidden="true" />Save placement record (JSON)</Button></div><p className="scan-caption">The downloadable JSON is a SCAN source record. Machine compatibility and optical teaching remain unverified.</p>
        </div>
      </section>
    </div>
    <section className="scan-panel scan-panel-body"><h2>Gerber source and alignment</h2><p>{gerber.file?.name ?? "No Gerber layer loaded"} · {gerber.result?.geometry_complete ? `${gerber.result.objects.length} objects parsed` : "Interpretation pending"}</p><p>{gerber.alignment ? `${gerber.alignment.status === "success" ? "Passed" : "Held"} · maximum residual ${gerber.alignment.maxResidualMm.toPrecision(6)} mm · ${gerber.alignment.scope.module} / ${gerber.alignment.scope.side} / ${gerber.alignment.scope.boardInstance}` : "Alignment needs three fit points and one independent check point."}</p><div className="scan-actions"><Link href="/intake#gerber-intake" className={buttonVariants({ variant: "outline" })}>Review Gerber intake</Link><Link href="/workspace" className={buttonVariants({ variant: "outline" })}>Open alignment workspace</Link></div></section>
    <section className="scan-panel" aria-labelledby="archive-source-title"><div className="scan-panel-heading"><h2 id="archive-source-title">Existing job archive</h2><Badge variant="outline">{archiveBusy ? "Processing" : archiveReview ? "Integrity verified" : inventory ? "Selection needed" : archiveFile ? "Selected" : "Optional source"}</Badge></div><div className="scan-panel-body"><h3 className="scan-file-name">{archiveFile?.name ?? "No archive loaded"}</h3><p>{archiveReview ? `${archiveReview.preflight.preservedFiles.length} files preserved; ${archiveReview.preflight.holds.length} native preparation holds. Snapshot integrity is verified, while native compatibility remains unknown.` : "Review the ZIP you received or a corrected reference package. Choose the exact main, temporary or backup job and master before capture."}</p><div className="scan-actions"><Link href="/intake#archive-intake" className={buttonVariants({ variant: "outline" })}>{archiveReview ? "Review archive preflight" : "Open archive intake"}</Link><Link href="/handoff" className={buttonVariants({ variant: "outline" })}>Open review handoff</Link></div></div></section>
    <section aria-label="Coverage states"><p className="scan-eyebrow">Native inspection coverage · not yet assessed</p><div className="scan-coverage">{["Represented", "Enabled", "Taught", "Verified", "Released"].map(label => <div className="scan-metric" key={label}><span>{label}</span><strong aria-label={`${label}: unknown`}>—</strong></div>)}</div></section>
    <p className="scan-demo-link"><Link href="/demo" target="_blank" rel="noopener">Explore synthetic demo</Link><span>Fictional walkthrough in a separate tab; your source session stays here.</span></p>
  </div>;
}
