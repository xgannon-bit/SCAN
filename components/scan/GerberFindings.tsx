"use client";
import Link from "next/link";
import { useScanSession } from "./ScanSession";
export function GerberFindings() {
  const { gerber: g } = useScanSession();
  if (!g.file) return null;
  const messages = [...(g.result?.blocked_reasons ?? []), ...(g.result?.unsupported_features ?? []), ...(g.result?.interpretation_overrides ?? []), ...(g.result?.warnings ?? []), ...(g.alignment?.holds ?? []), ...(g.error ? [g.error] : []), ...(g.alignError ? [g.alignError] : [])];
  return <section className="scan-panel scan-panel-body"><h2>Gerber and registration findings</h2><p>{g.file.name} · {g.result?.geometry_complete ? "Geometry parsed" : "Interpretation needs review"}</p><p>{g.alignment?.status === "success" ? "Alignment control checks passed for the recorded module, side and board instance." : "Registration has not passed its independent control checks."}</p><ul>{messages.map((message, i) => <li key={i}>{message}</li>)}</ul><p>Source assumptions remain part of the review. Native frames, pad ownership and machine compatibility are separate checks.</p><div className="scan-actions"><Link href="/intake#gerber-intake">Review Gerber interpretation</Link><Link href="/workspace">Review alignment controls</Link></div></section>;
}
