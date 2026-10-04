"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useScanSession } from "./ScanSession";

export function PlacementWorkspace() {
  const { result, selectedRow, setSelectedRow } = useScanSession();
  const selected = result?.placements.find(placement => placement.sourceRow === selectedRow);
  if (!result) return <section className="scan-panel scan-panel-body"><h2>Validate a placement source first</h2><p>Read and map a placement file in Source intake. Its parsed coordinates will appear here.</p><Link href="/intake" className={buttonVariants()}>Go to source intake</Link></section>;
  return <div className="scan-content-stack">
    {result.status !== "success" && <div className="scan-inline-warning" role="status">Source review has unresolved holds. These {result.counts.parsed} parsed records may be incomplete or have unconfirmed coordinates. <Link href="/findings">Review source findings</Link></div>}
    <section className="scan-panel" aria-labelledby="coordinate-workspace-title">
      <div className="scan-panel-heading"><h2 id="coordinate-workspace-title">Placement coordinates</h2><Badge variant="outline">Source CAD frame</Badge></div>
      <div className="scan-panel-body"><p>Inspect any of the {result.placements.length} parsed placements. Module, board side and source row identify the selected record.</p><label className="scan-field">Placement to inspect<select value={selectedRow ?? ""} onChange={event => setSelectedRow(event.target.value ? Number(event.target.value) : null)}><option value="">Select a placement</option>{result.placements.map(placement => <option key={placement.sourceRow} value={placement.sourceRow}>{placement.module} / {placement.side} / {placement.refdes} · row {placement.sourceRow}</option>)}</select></label></div>
    </section>
    <section className="scan-panel" aria-labelledby="selected-placement-title">
      <div className="scan-panel-heading"><h2 id="selected-placement-title">Selected placement</h2><Badge variant="outline">{selected ? `Source row ${selected.sourceRow}` : "None selected"}</Badge></div>
      <div className="scan-panel-body">{selected ? <><h3>{selected.module} / {selected.side} / {selected.refdes}</h3><dl className="scan-detail-grid">{[
        ["Module", selected.module], ["Board side", selected.side], ["Reference", selected.refdes], ["MPN", selected.mpn ?? "Unknown"], ["Footprint", selected.footprint ?? "Unknown"], ["Source row", selected.sourceRow],
        ["X (mm)", selected.xMm ?? "Unconfirmed"], ["Y (mm)", selected.yMm ?? "Unconfirmed"], ["Rotation (CCW degrees)", selected.rotationCcwDegrees ?? "Unconfirmed"],
        ["Source X", selected.sourceCoordinates.x], ["Source Y", selected.sourceCoordinates.y], ["Source rotation", selected.sourceCoordinates.rotation],
      ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><details><summary>Placement and source identity</summary><p className="scan-hash">Placement ID: {selected.placementId}</p><p className="scan-hash">Source SHA-256: {result.sourceSha256}</p></details></> : <p>Select a placement above to inspect its identity and source coordinates.</p>}
        <p className="scan-caption">Confirmed units convert to millimeters and confirmed rotations to counterclockwise degrees. No origin shift, Gerber alignment or bottom-side mirror is applied. Board graphics, pad ownership and native inspection overlays are not available yet.</p>
      </div>
    </section>
  </div>;
}
