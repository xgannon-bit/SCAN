import type { GerberObject, GerberResult } from "./geometry-types";

const circle = (x: number, y: number, r: number) => `M${x + r} ${y}a${r} ${r} 0 1 0 ${-2 * r} 0a${r} ${r} 0 1 0 ${2 * r} 0Z`;
function rectangle(x: number, y: number, w: number, h: number, r: number) {
  if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x + r} ${y}H${x + w - r}a${r} ${r} 0 0 1 ${r} ${r}V${y + h - r}a${r} ${r} 0 0 1 ${-r} ${r}H${x + r}a${r} ${r} 0 0 1 ${-r} ${-r}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}
/** Display geometry only. Aperture holes leave prior material untouched (even-odd fill). */
export function gerberShape(object: GerberObject, aperture: GerberResult["apertures"][number]): { d: string; transform?: string } | null {
  const p = aperture.parameters.map(Number), x = Number(object.end_x), y = Number(object.end_y);
  const hole = p[{ C: 1, R: 2, O: 2, P: 3 }[aperture.template]] ?? 0;
  if (object.operation === "draw") {
    // The parser permits circular holed strokes, but a solid stroke would invent
    // material. Hold this display subset until its swept-hole semantics are tested.
    if (hole || aperture.template !== "C") return null;
    const startX = Number(object.start_x), startY = Number(object.start_y), length = Math.hypot(x - startX, y - startY), r = p[0] / 2;
    return { d: length ? rectangle(-r, -r, length + p[0], p[0], r) : circle(0, 0, r), transform: `translate(${startX},${startY}) rotate(${Math.atan2(y - startY, x - startX) * 180 / Math.PI})` };
  }
  const outer = aperture.template === "C" ? circle(x, y, p[0] / 2) : aperture.template === "R" || aperture.template === "O" ? rectangle(x - p[0] / 2, y - p[1] / 2, p[0], p[1], aperture.template === "O" ? Math.min(p[0], p[1]) / 2 : 0) : Array.from({ length: p[1] }, (_, i) => { const a = ((p[2] ?? 0) + i * 360 / p[1]) * Math.PI / 180; return `${i ? "L" : "M"}${x + Math.cos(a) * p[0] / 2} ${y + Math.sin(a) * p[0] / 2}`; }).join("") + "Z";
  return { d: outer + (hole ? circle(x, y, hole / 2) : "") };
}
export function gerberDisplayHold(layer: GerberResult | null): string | null {
  if (!layer) return null;
  const apertures = new Map(layer.apertures.map(a => [a.d_code, a]));
  return layer.objects.some(o => !apertures.has(o.aperture_d_code) || !gerberShape(o, apertures.get(o.aperture_d_code)!)) ? "Canvas rendering held: circular aperture draws with holes need qualified swept-hole rendering. The parsed source remains intact; review its numeric geometry in the engineering controls." : null;
}
