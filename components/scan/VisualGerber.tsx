import { gerberShape, gerberDisplayHold } from "@/lib/scan/gerber-display";
import { useId } from "react";
import type { GerberResult } from "@/lib/scan/geometry-types";
import { pointBounds } from "@/lib/scan/visual-workspace";

export function gerberExtents(layer: GerberResult | null) {
  const points: { x: number; y: number }[] = [], scale = layer?.units === "in" ? 25.4 : 1;
  const apertures = new Map(layer?.apertures.map(a => [a.d_code, a]));
  for (const o of layer?.geometry_complete ? layer.objects : []) {
    const aperture = apertures.get(o.aperture_d_code);
    if (!aperture) continue;
    const radius = Math.max(Number(aperture.parameters[0]), ["R", "O"].includes(aperture.template) ? Number(aperture.parameters[1]) : 0) * scale / 2;
    for (const [x, y] of [[o.end_x, o.end_y], ...(o.start_x !== null ? [[o.start_x, o.start_y!]] : [])]) points.push({ x: Number(x) * scale - radius, y: Number(y) * scale - radius }, { x: Number(x) * scale + radius, y: Number(y) * scale + radius });
  }
  return points;
}

/** Ordered dark/clear compositing; clear regions reveal the grid, not an opaque background. */
export function VisualGerber({ layer }: { layer: GerberResult }) {
  const id = useId().replace(/:/g, ""), scale = layer.units === "in" ? 25.4 : 1;
  const points = gerberExtents(layer); if (!points.length || gerberDisplayHold(layer)) return null;
  const bounds = pointBounds(points), x = bounds.minX / scale - 1, y = bounds.minY / scale - 1;
  const width = bounds.maxX / scale - x + 1, height = bounds.maxY / scale - y + 1;
  const apertures = new Map(layer.apertures.map(a => [a.d_code, a]));
  return <g transform={`scale(${scale},${-scale})`} pointerEvents="none" data-testid="actual-gerber-geometry">
    <defs><mask id={id} maskUnits="userSpaceOnUse" x={x} y={y} width={width} height={height} style={{ maskType: "luminance" }}>
      <rect x={x} y={y} width={width} height={height} fill="black" />
      {layer.objects.map(o => {
        const shape = gerberShape(o, apertures.get(o.aperture_d_code)!);
        return shape && <path key={o.instance_id} d={shape.d} transform={shape.transform} fillRule="evenodd" fill={o.polarity === "dark" ? "white" : "black"} />;
      })}
    </mask></defs><rect x={x} y={y} width={width} height={height} fill="#607f9e" mask={`url(#${id})`} />
  </g>;
}
