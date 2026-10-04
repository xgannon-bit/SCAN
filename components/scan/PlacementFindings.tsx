"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";

export function PlacementFindings() {
  const { result } = useScanSession();
  return <section className="scan-panel" aria-labelledby="source-findings-title">
    <div className="scan-panel-heading"><h2 id="source-findings-title">Placement source review</h2><Link href="/intake" className={buttonVariants({ variant: "outline" })}>Edit source mapping</Link></div>
    <div className="scan-panel-body">{result ? <>
      <p role="status">{result.status === "success" ? "Placement parsing complete" : "Placement review needs attention"} · {result.counts.parsed} parsed · {result.counts.errors} errors · {result.counts.warnings} warnings</p>
      {result.holds.length > 0 && <><h3>Review holds</h3><ul className="scan-issue-list">{result.holds.map(hold => <li key={hold}>{hold}</li>)}</ul></>}
      <h3>Row issues ({result.issues.length})</h3>
      {result.issues.length ? <ul className="scan-issue-list">{result.issues.slice(0, 100).map((issue, index) => <li key={index}><strong>Row {issue.row} · {issue.severity}</strong><p>{issue.message}</p></li>)}</ul> : <p>No row issues were reported by the placement parser.</p>}
      {result.issues.length > 100 && <p>Showing the first 100 issues. Resolve these and validate again.</p>}
      <details><summary>Source identity</summary><p className="scan-hash">SHA-256: {result.sourceSha256}</p></details>
      <Link href="/workspace" className={buttonVariants({ variant: "outline" })}>Inspect parsed placements</Link>
    </> : <><h3>No placement review yet</h3><p>Validate your source in Source intake to see mapping holds and row issues here.</p></>}
    <p className="scan-caption">These findings cover placement parsing only. Native structure, Gerber registration, ROI geometry and machine readiness have not been assessed.</p></div>
  </section>;
}
