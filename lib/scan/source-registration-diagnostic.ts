type Point = { reference: string; x: number; y: number };
const median = (values: number[]) => { const ordered = [...values].sort((a, b) => a - b); const middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2; };

/** Reference-only translation hypothesis, never a qualified transform or repair. */
export function translationDiagnostic(from: Point[], to: Point[]) {
  function unique(points: Point[]) {
    const groups = new Map<string, Point[]>();
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const key = point.reference.trim().toUpperCase(); const group = groups.get(key) ?? [];
      group.push(point); groups.set(key, group);
    }
    return new Map([...groups].filter(([, group]) => group.length === 1).map(([key, group]) => [key, group[0]]));
  }
  const a = unique(from), b = unique(to);
  const pairs = [...a.keys()].filter(key => b.has(key)).sort().map(reference => ({ reference, a: a.get(reference)!, b: b.get(reference)! }));
  if (pairs.length < 6) return { status: "insufficient-correspondences" as const, matched: pairs.length, qualification: "unqualified" as const };
  const fit = pairs.filter((_, index) => index % 2 === 0);
  const tx = median(fit.map(pair => pair.b.x - pair.a.x)), ty = median(fit.map(pair => pair.b.y - pair.a.y));
  const residuals = pairs.map((pair, index) => ({ reference: pair.reference, role: index % 2 === 0 ? "fit" : "held-out", residualMm: Math.hypot(pair.a.x + tx - pair.b.x, pair.a.y + ty - pair.b.y) }));
  return { status: "translation-hypothesis" as const, matched: pairs.length, translationMm: [tx, ty], diagnosticThresholdMm: .1,
    fitCount: fit.length, heldOutCount: pairs.length - fit.length,
    withinDiagnosticThreshold: residuals.filter(item => item.residualMm <= .1).length,
    fitMaxResidualMm: Math.max(...residuals.filter(item => item.role === "fit").map(item => item.residualMm)),
    heldOutMaxResidualMm: Math.max(...residuals.filter(item => item.role === "held-out").map(item => item.residualMm)), residuals,
    qualification: "unqualified" as const,
    reason: "Alternating sorted unique references separate fit from held-out checks. Median translation tests a shared origin offset only. The 0.1 mm diagnostic threshold is not an inspection tolerance. Residuals may reflect different component origins, revisions, rotation, scale or identity; no defect or native transform is established.", machineExportAllowed: false };
}
