"use client";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import type { GerberObject, GerberResult } from "@/lib/scan/geometry-types";

function Layer({ layer, onFlash }: { layer: GerberResult; onFlash: (object: GerberObject) => void }) {
  const apertures = new Map(layer.apertures.map(a => [a.d_code, a]));
  return <>{layer.objects.map(o => {
    const a = apertures.get(o.aperture_d_code)!; const p = a.parameters.map(Number); const x = Number(o.end_x), y = Number(o.end_y);
    const fill = o.polarity === "dark" ? "#728dac" : "#101c2c";
    const props = { fill, onClick: () => onFlash(o), cursor: o.operation === "flash" ? "crosshair" : "default" };
    let shape;
    if (o.operation === "draw") shape = <line x1={Number(o.start_x)} y1={Number(o.start_y)} x2={x} y2={y} stroke={fill} strokeWidth={p[0]} strokeLinecap="round" />;
    else if (a.template === "C") shape = <circle cx={x} cy={y} r={p[0] / 2} {...props} />;
    else if (a.template === "R" || a.template === "O") shape = <rect x={x - p[0] / 2} y={y - p[1] / 2} width={p[0]} height={p[1]} rx={a.template === "O" ? Math.min(p[0], p[1]) / 2 : 0} {...props} />;
    else shape = <polygon points={Array.from({ length: p[1] }, (_, i) => { const angle = ((p[2] ?? 0) + 360 * i / p[1]) * Math.PI / 180; return `${x + Math.cos(angle) * p[0] / 2},${y + Math.sin(angle) * p[0] / 2}`; }).join(" ")} {...props} />;
    return <g key={o.instance_id}><title>{o.instance_id} · {o.operation} · D{a.d_code} · ({o.end_x}, {o.end_y}) {layer.units}</title>{shape}</g>;
  })}</>;
}

export function GerberWorkspace() {
  const { gerber: g, result: placements, setSelectedRow } = useScanSession(); const titleId = useId();
  const [active, setActive] = useState(0); const [zoom, setZoom] = useState(1); const [panX, setPanX] = useState(0); const [panY, setPanY] = useState(0);
  const [picked, setPicked] = useState(""); const layer = g.result?.geometry_complete ? g.result : null;
  const units = layer?.units === "in" ? 25.4 : 1;
  const bounds = useMemo(() => {
    if (!layer?.objects.length) return { x: 0, y: 0, width: 100, height: 100 };
    const apertures = new Map(layer.apertures.map(a => [a.d_code, a])); let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of layer.objects) {
      const a = apertures.get(o.aperture_d_code)!; const radius = Math.max(Number(a.parameters[0]), a.template === "R" || a.template === "O" ? Number(a.parameters[1]) : 0) * units / 2;
      for (const [x, y] of [[o.end_x, o.end_y], ...(o.start_x !== null ? [[o.start_x, o.start_y!]] : [])]) { const px = Number(x) * units, py = Number(y) * units; minX = Math.min(minX, px - radius); minY = Math.min(minY, py - radius); maxX = Math.max(maxX, px + radius); maxY = Math.max(maxY, py + radius); }
    }
    const margin = Math.max(maxX - minX, maxY - minY, 1) * .05;
    return { x: minX - margin, y: minY - margin, width: maxX - minX + 2 * margin, height: maxY - minY + 2 * margin };
  }, [layer, units]);
  const matching = placements?.placements.filter(p => p.module === g.scope.module && p.side === g.scope.side) ?? [];
  const choices = [...new Map(placements?.placements.map(p => [JSON.stringify([p.module, p.side]), { module: p.module, side: p.side }])).entries()];
  const matrix = g.alignment?.transform.matrix; const markerSize = Math.max(bounds.width, bounds.height) / 180;
  const width = bounds.width / zoom, height = bounds.height / zoom;
  const vx = bounds.x + (bounds.width - width) / 2 + panX * bounds.width / 100;
  const vy = -bounds.y - bounds.height + (bounds.height - height) / 2 + panY * bounds.height / 100;
  if (!layer) return <section className="scan-panel scan-panel-body"><h2>Gerber alignment</h2><p>{g.file ? `The loaded Gerber ${g.file.name} needs interpretation review: ${g.result?.blocked_reasons.join("; ") || g.error || "parse pending"}. Your source is retained; native and BOM work can continue.` : "Read a supported Gerber layer in Source intake to open the board view."}</p><Link href="/intake#gerber-intake" className={buttonVariants({ variant: "outline" })}>{g.file ? "Review loaded Gerber diagnostics" : "Add Gerber layer"}</Link></section>;
  return <section className="scan-panel"><div className="scan-panel-heading"><h2>Gerber and placement alignment</h2></div><div className="scan-panel-body scan-content-stack">
    <p>{layer.objects.length} source objects · physical coordinates in millimeters · gray: Gerber · orange: transformed CAD origins. Click a pad to record its center for the active control point.</p>
    <svg role="img" aria-labelledby={titleId} viewBox={`${vx} ${vy} ${width} ${height}`} style={{ width: "100%", height: 480, background: "#101c2c", borderRadius: 8 }}>
      <title id={titleId}>Gerber layer and reviewed CAD alignment overlay</title>
      <g transform="scale(1,-1)"><g transform={`scale(${units})`}><Layer layer={layer} onFlash={o => { if (o.operation !== "flash" || o.polarity !== "dark") return; g.editPoint(active, { gerber: [String(Number(o.end_x) * units), String(Number(o.end_y) * units)] }); setPicked(`${o.instance_id} · D${o.aperture_d_code}`); }} /></g>
        {matrix && matching.filter(p => p.xMm !== null && p.yMm !== null).map(p => {
          const x = matrix[0][0] * Number(p.xMm) + matrix[0][1] * Number(p.yMm) + matrix[0][2]; const y = matrix[1][0] * Number(p.xMm) + matrix[1][1] * Number(p.yMm) + matrix[1][2];
          return <g key={p.placementId} onClick={() => setSelectedRow(p.sourceRow)} cursor="pointer"><title>{p.refdes} · row {p.sourceRow}</title><circle cx={x} cy={y} r={markerSize} fill="none" stroke="#ffb45c" strokeWidth={markerSize / 4} /><path d={`M${x - markerSize} ${y}h${markerSize * 2}M${x} ${y - markerSize}v${markerSize * 2}`} stroke="#ffb45c" strokeWidth={markerSize / 5} /></g>;
        })}
      </g>
    </svg>
    <div className="scan-detail-grid"><label className="scan-field">Zoom<input type="range" min="1" max="10" step=".1" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label><label className="scan-field">Pan horizontally<input type="range" min="-50" max="50" value={panX} onChange={e => setPanX(Number(e.target.value))} /></label><label className="scan-field">Pan vertically<input type="range" min="-50" max="50" value={panY} onChange={e => setPanY(Number(e.target.value))} /></label><Button variant="outline" onClick={() => { setZoom(1); setPanX(0); setPanY(0); }}>Fit board</Button></div>
    <p className="scan-caption">Display Y is flipped only for the screen. CAD source coordinates remain unchanged. A pad center is not automatically a component center. Confirm physical correspondences; no nearest-pad ownership is assigned.</p>
    <div className="scan-detail-grid"><label className="scan-field">Placement module and side<select value={JSON.stringify([g.scope.module, g.scope.side])} onChange={e => { const [module, side] = JSON.parse(e.target.value); g.editScope({ module, side }); }}><option value={'["",""]'}>Select module / side</option>{choices.map(([key, c]) => <option key={key} value={key}>{c.module} / {c.side}</option>)}</select></label><label className="scan-field">Gerber board instance<input value={g.scope.boardInstance} maxLength={256} onChange={e => g.editScope({ boardInstance: e.target.value })} placeholder="Identify the board within this panel" /></label><label className="scan-field">Allowed residual (mm)<input value={g.tolerance} onChange={e => g.editTolerance(e.target.value)} inputMode="decimal" /></label></div>
    <p>Enter three widely spaced, noncollinear fit points and one independent check point. The fit uses rotation and translation only. Both coordinate columns below are millimeters.</p>
    {g.points.map((p, i) => <fieldset key={p.id} className="scan-panel-body" style={{ border: i === active ? "1px solid #e3a14c" : "1px solid #34465b", borderRadius: 8 }} disabled={g.alignBusy}>
      <legend>Point {i + 1} · {p.role === "fit" ? "Fit" : "Independent check"}</legend>
      <div className="scan-actions"><Button variant="outline" onClick={() => setActive(i)}>{active === i ? "Active for pad picking" : "Pick Gerber pad for this point"}</Button><label className="scan-field">Use source placement point {i + 1}<select value="" onChange={e => { const row = matching.find(c => c.sourceRow === Number(e.target.value)); if (row?.xMm !== null && row?.yMm !== null && row) g.editPoint(i, { cad: [row.xMm, row.yMm] }); }}><option value="">Choose a source row</option>{matching.filter(c => c.xMm !== null && c.yMm !== null).map(c => <option key={c.sourceRow} value={c.sourceRow}>{c.refdes} · row {c.sourceRow}</option>)}</select></label></div>
      <div className="scan-detail-grid">{(["cad", "gerber"] as const).flatMap(frame => [0, 1].map(axis => <label className="scan-field" key={`${frame}${axis}`}>{frame === "cad" ? "CAD" : "Gerber"} {axis === 0 ? "X" : "Y"} mm · point {i + 1}<input value={p[frame][axis]} inputMode="decimal" onChange={e => { const values: [string, string] = [...p[frame]]; values[axis] = e.target.value; g.editPoint(i, { [frame]: values }); }} /></label>))}</div>
      <label className="scan-field">Physical match evidence · point {i + 1}<input maxLength={512} value={p.evidence} placeholder="Identify the same physical feature in both sources" onChange={e => g.editPoint(i, { evidence: e.target.value })} /></label>
    </fieldset>)}
    {picked && <p role="status">Last selected Gerber feature: {picked}</p>}
    <div className="scan-actions"><Button disabled={!g.basis || g.alignBusy} onClick={g.align}>{g.alignBusy ? "Checking alignment…" : "Fit and check alignment"}</Button></div>
    {g.alignError && <p role="alert">{g.alignError}</p>}
    {g.alignment && <div role="status"><h3>{g.alignment.status === "success" ? "Alignment checks passed" : "Alignment needs review — diagnostic overlay only"}</h3><p>Rotation {g.alignment.transform.angleDegrees.toFixed(6)}° · scale 1 · maximum residual {g.alignment.maxResidualMm.toPrecision(8)} mm</p><ul>{g.alignment.residuals.map(r => <li key={r.id}>{r.id} ({r.role}): {r.residualMm.toPrecision(8)} mm · {r.withinTolerance ? "within tolerance" : "outside tolerance"}</li>)}</ul><p>{g.alignment.qualification}</p></div>}
  </div></section>;
}
