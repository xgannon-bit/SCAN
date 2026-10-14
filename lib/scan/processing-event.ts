/** Presentation data emitted by actual worker checks, never writer input. */
export type RecordedRoi = { x: number; y: number; width: number; height: number; angle: number };
export type ComponentGeometry = {
  frame: "native-roi-unqualified";
  identity: { module: string; ref: string; id: string; master: string };
  before: RecordedRoi | null; after: RecordedRoi;
};
export type ComponentProgress = { kind: "placement-checked" | "preparation-checked" | "analysis-started" | "analysis-checked" | "analysis-held"; geometry: ComponentGeometry };
export type ProcessingEvent = ComponentProgress & { sequence: number; at: string };
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join();
export function validGeometry(v: unknown): v is ComponentGeometry {
  if (!exact(v, ["frame", "identity", "before", "after"]) || v.frame !== "native-roi-unqualified" || !exact(v.identity, ["module", "ref", "id", "master"]) || Object.values(v.identity).some(x => typeof x !== "string" || !x || x.length > 256 || x.includes("\0"))) return false;
  const roi = (x: unknown) => exact(x, ["x", "y", "width", "height", "angle"]) && Object.values(x).every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e9) && Number(x.width) > 0 && Number(x.height) > 0;
  return (v.before === null || roi(v.before)) && roi(v.after);
}
export function validComponentProgress(v: unknown): v is ComponentProgress {
  return exact(v, ["kind", "geometry"]) && ["placement-checked", "preparation-checked", "analysis-started", "analysis-checked", "analysis-held"].includes(String(v.kind)) && validGeometry(v.geometry) && (v.kind === "preparation-checked" ? v.geometry.before === null : v.geometry.before !== null);
}
