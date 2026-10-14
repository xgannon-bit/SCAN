export type RigidMatrix = [[number, number, number], [number, number, number]];

/** Finite, fixed-scale proper rotation/translation; never accepts shear or reflection. */
export function isProperRigidMatrix(value: unknown): value is RigidMatrix {
  if (!Array.isArray(value) || value.length !== 2 || value.some(row => !Array.isArray(row) || row.length !== 3 || row.some(n => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9))) return false;
  const [[a, b], [c, d]] = value;
  return Math.abs(a * a + c * c - 1) < 1e-8
    && Math.abs(b * b + d * d - 1) < 1e-8
    && Math.abs(a * b + c * d) < 1e-8
    && Math.abs(a * d - b * c - 1) < 1e-8;
}
