"use client";
import { useScanSession } from "./ScanSession";
import { repairImpact } from "@/lib/scan/repair-impact";
import { downloadJson } from "@/lib/scan/review-session";
import { Button } from "@/components/ui/button";

export function RepairImpact({ sourcePath, field, after }: { sourcePath: string; field: string; after: string }) {
  const { archiveReview } = useScanSession();
  const impact = archiveReview && repairImpact(archiveReview.preflight, sourcePath, field, after);
  if (!impact) return null;
  const before = impact.beforeBox, next = impact.afterBox;
  const boxes = before && next ? [before, next] : [];
  const radius = before ? Math.hypot(before.w, before.h) : 1;
  const left = boxes.length ? Math.min(...boxes.map(b => b.x)) - radius : 0;
  const top = before ? before.y - radius : 0;
  const width = boxes.length ? Math.max(...boxes.map(b => b.x)) + radius - left : 1;
  return <section aria-label="Exact repair impact">
    <h4>Before/after and dependent work</h4>
    <p>{impact.classification}. Native literal delta: {impact.deltaLiteralUnits ?? "unavailable"}. This is a requested displacement, not an independently established registration residual or defect.</p>
    {!!boxes.length && <><svg role="img" aria-label="Requested native ROI before and after, unqualified frame" viewBox={`${left} ${top} ${width} ${radius * 2}`} width="420" height="220" style={{ maxWidth: "100%", border: "1px solid #80929c" }}>
      {boxes.map((b, i) => <g key={i} transform={`rotate(${b.angle} ${b.x} ${b.y})`}><title>{i ? "Proposed" : "Original"} stored ROI center ({b.x}, {b.y})</title><rect x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} fill="none" stroke={i ? "#f4b942" : "#53c4e8"} strokeDasharray={i ? `${radius / 8} ${radius / 12}` : undefined} strokeWidth={Math.max(width, radius * 2) / 180} /></g>)}
    </svg><p>Cyan: stored original ROI. Dashed amber: requested ROI. Same raw native frame; unit scale and Eagle propagation remain unqualified. No board photograph or source-frame geometry is silently overlaid.</p></>}
    <p>Exact byte edit: <code>{impact.exactWrite}</code>. Master relation: {impact.masterMatch}; {impact.scopePlacements.length} linked placements, {impact.windows.length} windows, {impact.windows.reduce((n, w) => n + w.algorithmIds.length, 0)} algorithms preserved. {impact.bindingObservations.length} literal binding segments observed; ownership remains unresolved.</p>
    <details><summary>Exact affected and preserved objects; dependent checks</summary>
      {impact.unresolved.map(value => <p key={value}>{value}</p>)}
      <p>Shared scope placements: {impact.scopePlacements.map(p => `${p.identity.RefID?.join()} / ID ${p.identity.ID?.join()} / ${p.sourcePath}`).join("; ") || "unavailable"}.</p>
      {impact.windows.map(w => <p key={w.sourcePath}>Window {w.id?.join()} · group {w.group?.join()} · parent {w.parent?.join()} · alignment target {w.align?.join()} · {w.algorithmIds.length} algorithms · <code>{w.sourcePath}</code>. Dependent geometry and teaching unresolved.</p>)}
      <pre>{JSON.stringify(impact, null, 2)}</pre>
    </details>
    <Button variant="outline" onClick={() => downloadJson(impact, "scalar-trial-impact.json")}>Export exact scalar impact</Button>
  </section>;
}
