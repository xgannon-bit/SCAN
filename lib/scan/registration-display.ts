import type { AlignmentResult } from "./geometry-types";
import { isProperRigidMatrix } from "./rigid-matrix";
/** Failed current results may be inspected, but cannot pose as a passed comparison. */
export function registrationDisplay(alignment: AlignmentResult | null, basis: string, module: string, side: string, diagnostic: boolean) {
  const fresh = !!alignment && !!basis && alignment.basis === basis && alignment.scope.module === module && alignment.scope.side === side && !!alignment.scope.boardInstance.trim();
  const m = alignment?.transform.matrix;
  const rigid = isProperRigidMatrix(m);
  const passed = fresh && rigid && alignment.status === "success" && !alignment.holds.length && alignment.transform.scale === 1 && alignment.transform.mirror === false && Number.isFinite(alignment.toleranceMm) && alignment.toleranceMm > 0 && Number.isFinite(alignment.maxResidualMm) && alignment.maxResidualMm <= alignment.toleranceMm && alignment.residuals.filter(r => r.role === "fit").length >= 3 && alignment.residuals.some(r => r.role === "check") && alignment.residuals.every(r => r.withinTolerance && Number.isFinite(r.residualMm) && r.residualMm <= alignment.toleranceMm);
  return { passed: !!passed, diagnosticAvailable: !!(fresh && rigid && !passed), matrix: fresh && rigid && (passed || diagnostic) ? m! : null,
    label: passed ? "Control checks passed · scoped diagnostic registration · physical qualification pending" : diagnostic && fresh && rigid ? "UNREGISTERED DIAGNOSTIC · failed fit/check · geometry is a hypothesis" : "Gerber coordinates · CAD overlay held until registration passes fit and independent checks" };
}
