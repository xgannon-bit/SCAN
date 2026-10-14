import type { NativeDiagnosisReport } from "./native-placement-diagnosis";
import type { RegisteredBoardLayer } from "./registered-board-layers";
export type NativeControl = { reference: string; role: string; residualMm: number | null; sourceResidualMm: number | null; from: number[] | null; to: number[] | null };
/** Measured CAD control geometry, not component bodies or inferred pad ownership. */
export function nativeRegistrationControls(report: NativeDiagnosisReport | null, layer: RegisteredBoardLayer): NativeControl[] {
  if (!report || !Array.isArray(report.frame.controls)) return [];
  const settings = report.settings, scale = settings.nativeUnits === "mil" ? .0254 : 1, sign = settings.nativeYDirection === "down" ? -1 : 1;
  const matrix = report.frame.transform?.matrix;
  const point = (v: unknown): v is number[] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number" && Number.isFinite(n));
  return report.frame.controls.flatMap(c => {
    if (!c || typeof c.reference !== "string" || !["fit", "check"].includes(c.role)) return [];
    const supported = layer.status === "supported-diagnostic" && matrix && point(c.sourceOriginMm) && point(c.nativeOriginCanonicalMm);
    const from = supported ? matrix.map(r => (r[0] * c.sourceOriginMm[0] + r[1] * c.sourceOriginMm[1] + r[2])) : null;
    const native = (p: number[] | null) => p ? [p[0] / scale, p[1] * sign / scale] : null;
    return [{ reference: c.reference, role: c.role, residualMm: typeof c.residualMm === "number" && Number.isFinite(c.residualMm) ? c.residualMm : null, sourceResidualMm: typeof c.sourceRegistrationResidualMm === "number" && Number.isFinite(c.sourceRegistrationResidualMm) ? c.sourceRegistrationResidualMm : null, from: native(from), to: supported ? native(c.nativeOriginCanonicalMm) : null }];
  });
}
