"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
export function GerberIntake() {
  const { gerber: g } = useScanSession(); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!g.file && input.current) input.current.value = ""; }, [g.file]);
  return <section className="scan-panel" id="gerber-intake"><div className="scan-panel-heading"><h2>Gerber layer</h2></div><div className="scan-panel-body">
    <p>Read a paste or pad layer, then align it to a placement module in Board workspace. Original bytes remain unchanged.</p>
    <label className="scan-field">Gerber file (.gbr or .gbx)<input ref={input} type="file" accept=".gbr,.gbx" disabled={g.busy} onChange={e => g.changeFile(e.target.files?.[0] ?? null)} /></label>
    <details open={g.config.formatOverride !== null || g.config.assumeLinear}><summary>Review an incorrect source declaration</summary><p>Use only after checking the source format. These settings change SCAN’s interpretation and are recorded with the source hash. They do not edit the original file.</p>
      <label className="scan-field">Coordinate format override<select value={g.config.formatOverride ?? ""} disabled={g.busy} onChange={e => g.edit({ formatOverride: e.target.value || null })}><option value="">Use source FS declaration</option>{["FSLAX23Y23", "FSLAX24Y24", "FSLAX25Y25", "FSLAX33Y33", "FSLAX34Y34", "FSLAX36Y36", "FSLAX46Y46"].map(v => <option key={v}>{v}</option>)}</select></label>
      <label><input type="checkbox" checked={g.config.assumeLinear} disabled={g.busy} onChange={e => g.edit({ assumeLinear: e.target.checked })} /> I have reviewed the source and confirm initial linear interpolation where G01 is absent</label>
    </details>
    <div className="scan-actions"><Button disabled={!g.file || g.busy} onClick={g.run}>{g.busy ? "Reading Gerber…" : "Read Gerber"}</Button><Button variant="outline" onClick={() => g.changeFile(null)}>Clear Gerber</Button><Link href="/workspace" className={buttonVariants({ variant: "outline" })}>Open alignment workspace</Link></div>
    {g.error && <p role="alert">{g.error}</p>}
    {g.result && <div aria-live="polite"><p><strong>{g.result.geometry_complete ? "Gerber geometry parsed" : "Gerber interpretation needs attention"}</strong> · {g.result.units} · {g.result.apertures.length} apertures · {g.result.objects.length} objects</p>
      {[...g.result.blocked_reasons, ...g.result.unsupported_features, ...g.result.interpretation_overrides, ...g.result.warnings].map((v, i) => <p key={i}>{v}</p>)}
      <details><summary>Gerber source identity</summary><p className="scan-hash">SHA-256: {g.result.source_sha256}</p><p>Reader {g.result.adapter_version} · source FS {JSON.stringify(g.result.declared_coordinate_format)} · effective FS {JSON.stringify(g.result.coordinate_format)}</p></details>
    </div>}
    <p className="scan-caption">8 MB maximum. Standard flashes and circular-aperture linear draws are supported. Unsupported macros, arcs, regions, holes and transforms stop the geometry preview.</p>
  </div></section>;
}
