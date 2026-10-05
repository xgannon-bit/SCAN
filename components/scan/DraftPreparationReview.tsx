"use client";
import { useMemo, useState } from "react";
import { useScanSession } from "./ScanSession";
import { buildSourceCrosswalk } from "@/lib/scan/source-crosswalk";
import { downloadJson } from "@/lib/scan/review-session";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function DraftPreparationReview() {
  const { layout, bom, result, archiveReview, comparisons } = useScanSession();
  const [showExisting, setShowExisting] = useState(false);
  const crosswalk = useMemo(() => buildSourceCrosswalk(bom.result, result, archiveReview,
    comparisons.entries.map(item => ({ name: item.file.name, result: item.result })), layout.result),
    [bom.result, result, archiveReview, comparisons.entries, layout.result]);
  if (!layout.result) return null;
  const rows = crosswalk.rows.filter(row => showExisting || row.nativeInstances.length === 0);
  const groups = Map.groupBy(rows, row => row.engineeringDnp ? "population-decision-needed" : row.draftPreparation.classification);
  return <section className="scan-panel scan-panel-body" aria-label="Disabled draft preparation" id="draft-preparation">
    <h2>Prepare missing native parts</h2>
    <p>Source geometry is grouped below so shared preparation questions can be resolved once. <Link href="/repair#native-preparation">Find supported job-local models and review complete disabled part proposals</Link> in Repair Review. This source-family view describes the original baseline; candidate history and candidate accounting track applied preparation separately.</p>
    <label><input type="checkbox" checked={showExisting} onChange={event => setShowExisting(event.target.checked)} /> Include references with existing native structure</label>
    {[...groups].map(([group, items]) => <details key={group}>
      <summary>{group.replace(/-/g, " ")} · {items.length} references</summary>
      <p>{items.map(item => item.reference).join(", ")}</p>
      {items.map(({ reference, draftPreparation: draft }) => <details key={reference}>
        <summary>{reference} · source family review</summary>
        <p><strong>Next action:</strong> {draft.nextAction}</p>
        <p>Source footprint: {draft.patternRef ?? "unknown"}. Drill evidence: {draft.mountingEvidence}. {draft.templateCandidates.length} literal package-name template correspondences; compatibility unqualified.</p>
        {draft.layers.map(layer => <div key={layer.layerNumber}>
          <h4>Explicit source layer {layer.layerNumber}</h4>
          <p>Complete outline records for {layer.pads.length} owned pads. Layer-class rules remain unresolved; these are not native inspection windows.</p>
          <table><thead><tr><th>Pad</th><th>Source local center (mm)</th><th>Size (mm)</th><th>Angle</th></tr></thead>
            <tbody>{layer.pads.map(pad => <tr key={pad.padNumber}><td>{pad.padNumber}</td><td>{pad.local.xMm}, {pad.local.yMm}</td><td>{pad.widthMm} × {pad.heightMm}</td><td>{pad.localRotationDegrees}°</td></tr>)}</tbody></table>
        </div>)}
        <ul>{draft.holds.map(hold => <li key={hold}>{hold}</li>)}</ul>
        <details><summary>Source and local-template evidence</summary><pre>{JSON.stringify(draft, null, 2)}</pre></details>
      </details>)}
    </details>)}
    {!rows.length && <p>No unrepresented references in the current source crosswalk.</p>}
    <Button variant="outline" onClick={() => downloadJson({ artifactType: "scan.disabled-draft-preparation-review", schemaVersion: "1", recipes: crosswalk.rows.map(row => row.draftPreparation), machineExportAllowed: false }, "disabled-draft-preparation.json")}>Download draft preparation review</Button>
    <p>Saving the project retains the original layout and native sources; reopening recomputes this review from their verified bytes. This download is preparation evidence, not a native candidate.</p>
  </section>;
}
