"use client";
import { useScanSession } from "./ScanSession";

type Box = { label: string; x: number; y: number; w: number; h: number; angle: number };
function plot(title: string, boxes: Box[]) {
  if (!boxes.length) return <div><h4>{title}</h4><p>Complete bounded geometry is unavailable in the selected source.</p></div>;
  const minX = Math.min(...boxes.map(box => box.x - Math.hypot(box.w, box.h))), minY = Math.min(...boxes.map(box => box.y - Math.hypot(box.w, box.h)));
  const width = Math.max(...boxes.map(box => box.x + Math.hypot(box.w, box.h))) - minX || 1;
  const height = Math.max(...boxes.map(box => box.y + Math.hypot(box.w, box.h))) - minY || 1;
  return <div><h4>{title}</h4><svg role="img" aria-label={title} viewBox={`${minX} ${minY} ${width} ${height}`} width="320" height="220" style={{ maxWidth: "100%", border: "1px solid #80929c" }}>{boxes.map((box, index) => <g key={index} transform={`rotate(${box.angle} ${box.x} ${box.y})`}><title>{box.label}: x={box.x}, y={box.y}, w={box.w}, h={box.h}, a={box.angle}</title><rect x={box.x - box.w / 2} y={box.y - box.h / 2} width={box.w} height={box.h} fill="none" stroke={index % 2 ? "#c58016" : "#287da1"} strokeWidth={Math.max(width, height) / 200} /></g>)}</svg><p>{boxes.map(box => `${box.label}: (${box.x}, ${box.y}), ${box.w} × ${box.h}, angle ${box.angle}`).join("; ")}</p></div>;
}
export function NativeGeometry({ sourcePath }: { sourcePath: string }) {
  const { archiveReview, result } = useScanSession(); const report = archiveReview?.preflight;
  const part = report?.nativeRecords.job?.records.find(record => record.sourcePath === sourcePath);
  if (!part) return null;
  const literal = (fields: Record<string, string[]>, key: string) => fields[key]?.length === 1 ? fields[key][0] : null;
  function box(fields: Record<string, string[]>, prefix: string, label: string): Box[] {
    const values = ["cx", "cy", "w", "h", "a"].map(key => literal(fields, `${prefix}/${key}`));
    if (values.some(value => value === null || value.trim() === "" || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e6)) return [];
    const [x, y, w, h, angle] = values.map(Number); return w > 0 && h > 0 ? [{ label, x, y, w, h, angle }] : [];
  }
  const queue = report?.nativeInspectionWork; const linkedPart = queue?.parts.find(value => value.sourcePath === sourcePath);
  const scope = queue?.scopes.find(value => value.id === linkedPart?.scopeId);
  const windows = scope?.masterMatchState === "unique-literal-match" ? queue?.windows.filter(value => scope.windowIds.includes(value.id)) ?? [] : [];
  const sources = result?.placements.filter(value => value.refdes === literal(part.rawFields, "RefID") && value.module === literal(part.rawFields, "ParentId")) ?? [];
  return <section><h3>Geometry context</h3><p>Separate source frames below. Literal rectangles are a visualization of stored values, not a qualified Eagle rendering or a registration to CAD/Gerber. No overlay implies a common frame, pad ownership or a defect.</p><div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>{plot("Native placement ROI — raw frame", box(part.rawFields, "Roi", "placement"))}{plot("Master windows — raw local frame", windows.flatMap(window => box(window.rawFields, "RelRoi", window.rawFields.Name?.join() || window.id)))}</div><p>Master scope: {scope?.partIds.length ?? "unknown"} linked placements. Shared teaching is preserved.</p><h4>Source CAD — normalized source frame</h4>{sources.length ? sources.map(value => <p key={value.placementId}>{value.refdes} · {value.side} · ({value.xMm}, {value.yMm}) mm · {value.rotationCcwDegrees}° · {value.mpn ?? "MPN unknown"}</p>) : <p>No exact module/reference source match. Resolve source identity/mapping before comparing geometry.</p>}</section>;
}
