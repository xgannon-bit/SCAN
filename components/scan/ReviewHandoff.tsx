"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import { buildSourceReport, sourceReportText } from "@/lib/scan/source-report";
import { downloadJson } from "@/lib/scan/review-session";
import { NativeQualification } from "./NativeQualification";
import { NativeAccounting } from "./NativeAccounting";

export function ReviewHandoff() {
  const { file, result, notes, archiveFile, archiveReview, setSelectedRow, qualification, gerber, runArchive, archiveBusy, archiveNotice, archiveError } = useScanSession();
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const report = buildSourceReport({ sourceName: file?.name ?? null, result, notes, archiveName: archiveFile?.name ?? null, archive: archiveReview, nativeQualification: qualification.report, gerber: gerber.result, alignment: gerber.alignment });
  const items = report.workItems.filter(item => `${item.reason} ${item.scope} ${item.sourceRow ?? ""} ${item.identity?.refdes ?? ""} ${item.nativeContext?.referenceLiteral ?? ""} ${item.nativeContext?.sourcePaths.join(" ") ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  function save(format: "json" | "text") {
    try {
      if (format === "json") downloadJson(report, "scan-source-review-handoff.json");
      else {
        const url = URL.createObjectURL(new Blob([sourceReportText(report)], { type: "text/plain;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "SCAN-SOURCE-REVIEW.txt"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage("Source review handoff sent to browser downloads. No native candidate was generated.");
    } catch { setMessage("The report could not be prepared. Your review remains available; try again."); }
  }
  return <div className="scan-content-stack">
    <section className="scan-panel" aria-labelledby="handoff-title"><div className="scan-panel-heading"><h2 id="handoff-title">Source review and remaining work</h2></div><div className="scan-panel-body">
      <p>Export the full placement review, exact row identities, notes, archive preflight and remaining-work list. Every parsed placement is listed with native preparation marked not assessed.</p>
      <div className="scan-actions"><Button disabled={!result && !archiveReview} onClick={() => save("text")}>Download readable handoff (.txt)</Button><Button variant="outline" disabled={!result && !archiveReview} onClick={() => save("json")}>Download complete review (.json)</Button><Link href="/repair" className={buttonVariants({ variant: "outline" })}>Review and export qualification candidate</Link></div>
      {message && <p role="status">{message}</p>}
      <p className="scan-caption">This report is available for blocked reviews too. It is not the complete native engineering bundle and has no JOB_COPY. Placement-to-archive correspondence has not been verified.</p>
    </div></section>
    <section className="scan-panel scan-panel-body"><h2>Preserved native job package</h2><p>Save the complete original native ZIP with freshly checked hashes, selected snapshot identities and dependency findings. Every original file remains inside NATIVE_SOURCE.zip. No CAD, Gerber or inspection edits are applied to the native job.</p><Button disabled={!archiveReview || archiveBusy} onClick={() => runArchive("reference")}>{archiveBusy ? "Preparing native source…" : "Download preserved native source package"}</Button>{archiveNotice && <p role="status">{archiveNotice}</p>}{archiveError && <p role="alert">{archiveError}</p>}<p className="scan-caption">Use the complete review download above to carry placement and Gerber alignment evidence. Creating a new Eagle/Athena program from these sources remains unavailable.</p></section>
    <section className="scan-panel" aria-labelledby="work-items-title"><div className="scan-panel-heading"><h2 id="work-items-title">Actionable findings ({report.workItems.length})</h2></div><div className="scan-panel-body">
      <label className="scan-field">Find work by reference, row or reason<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <p>{items.length} matching items. Showing {Math.min(items.length, 100)}; downloads include every item.</p>
      {items.slice(0, 100).map(item => <article className="scan-finding-card" key={item.id}><h3>{item.severity} · {item.scope}{item.sourceRow ? ` · Row ${item.sourceRow}` : ""}</h3>{item.identity && <p>{item.identity.module} / {item.identity.side} / {item.identity.refdes}</p>}{item.nativeContext && <details><summary>Native evidence · {item.nativeContext.moduleLiteral ?? "Unresolved module"} / {item.nativeContext.referenceLiteral ?? "Job or unresolved reference"}</summary><p>Finding: {item.nativeContext.findingId ?? item.nativeContext.blockerId}</p><ul>{item.nativeContext.sourcePaths.slice(0, 50).map(path => <li key={path}>{path}</li>)}</ul>{item.nativeContext.sourcePaths.length > 50 && <p>Showing 50 paths; the complete review contains every path.</p>}</details>}<p>{item.reason}</p><p><strong>Next action:</strong> {item.nextAction}</p>{item.annotation && <p>User note: {item.annotation}</p>}{item.identity && item.sourceRow !== null && <Link href="/workspace" className={buttonVariants({ variant: "outline" })} onClick={() => setSelectedRow(item.sourceRow)}>Inspect source row {item.sourceRow}</Link>}</article>)}
      {!result && !archiveReview && <p>Validate a placement file or verify an existing job archive to build this review.</p>}
    </div></section>
    <NativeAccounting />
    <NativeQualification />
    <section className="scan-panel scan-panel-body"><h2>Native preparation still required</h2><ul className="scan-issue-list">{report.requiredNativeWork.map(value => <li key={value}>{value}</li>)}</ul><p>Package completeness, offline programming coverage, machine compatibility, optical validation and production release remain unknown.</p></section>
  </div>;
}
