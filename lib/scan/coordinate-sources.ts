import type { ArchiveReview } from "./archive-types";
import type { LayoutResult } from "./layout-types";
import type { PlacementResult } from "./placement-types";
import { revisionHint, type RegistrationSource } from "./source-registration";

/** Source types remain separate; there is deliberately no native-to-mm conversion. */
export function coordinateSources(placement: { name: string; result: PlacementResult | null }, comparisons: { name: string; result: PlacementResult | null }[], layout: { name: string; result: LayoutResult | null }, archive: ArchiveReview | null): RegistrationSource[] {
  const sources: RegistrationSource[] = [];
  for (const [i, entry] of [placement, ...comparisons].entries()) {
    const r = entry.result;
    if (!r) continue;
    sources.push({ id: i ? `comparison:${i - 1}` : "primary", label: entry.name || (i ? `Comparison ${i}` : "Active placement"), sha256: r.sourceSha256,
      interpretation: JSON.stringify({ normalizer: r.normalizerVersion, digest: r.interpretationSha256, mapping: r.mapping, sheet: r.sheetIndex, delimiter: r.delimiter, frame: r.coordinateFrame }), frame: r.coordinateFrame, inputUnits: r.mapping.units, normalizedUnits: "mm", revisionHint: revisionHint(entry.name),
      points: r.placements.map(p => ({ reference: p.refdes, identity: p.placementId, module: p.module, side: p.side, x: p.xMm === null ? NaN : Number(p.xMm), y: p.yMm === null ? NaN : Number(p.yMm), rotation: p.rotationCcwDegrees === null ? null : Number(p.rotationCcwDegrees), holds: r.issues.filter(issue => issue.row === p.sourceRow && issue.severity === "error").map(issue => issue.code) })) });
  }
  if (layout.result) {
    const r = layout.result as LayoutResult & { declaredUnits?: string; readerVersion?: string; coordinateFrame?: unknown };
    sources.push({ id: "layout", label: layout.name || "Source PCB", sha256: r.sourceSha256, interpretation: JSON.stringify({ reader: "accel-source-model", readerVersion: r.readerVersion, declaredUnits: r.declaredUnits, units: "mm", frame: r.coordinateFrame ?? "source-board", status: r.status }), frame: "PCB source-board footprint origin (mm)", inputUnits: r.declaredUnits ?? "source-declared; adapter converts to mm", normalizedUnits: "mm", revisionHint: revisionHint(layout.name),
      points: r.placements.map(p => { const raw = p as typeof p & { rotation?: { degrees?: number }; isFlippedRaw?: string | null }; const degrees = raw.rotation?.degrees; return { reference: p.refdes, identity: p.sourcePath, module: "source-board", side: p.side ?? "unknown", x: p.anchor?.xMm ?? NaN, y: p.anchor?.yMm ?? NaN, rotation: typeof degrees === "number" && Number.isFinite(degrees) ? degrees : null, holds: [...p.identityHolds.map(h => h.code), ...(raw.isFlippedRaw != null && !["false"].includes(raw.isFlippedRaw.toLowerCase()) ? ["PCB flipped-source frame is unsupported by this registration profile"] : [])] }; }) });
  }
  if (archive) {
    const r = archive.preflight;
    const one = (fields: Record<string, string[]>, key: string) => fields[key]?.length === 1 ? fields[key][0] : null;
    sources.push({ id: "native-cad", label: "Selected native CAD (unqualified units)", sha256: r.selection.job.sha256, interpretation: JSON.stringify({ source: r.source.sha256, selection: r.selection, reader: r.readerVersion, nativeFrame: "literal-unqualified" }), frame: "native CAD literal units (unqualified)", inputUnits: "native-literal-unqualified", normalizedUnits: "unqualified-native", revisionHint: revisionHint(r.selection.job.member),
      points: (r.nativeRecords.job?.records ?? []).filter(p => p.kind === "cad-record").map(p => ({ reference: one(p.rawFields, "RefID") ?? "", identity: p.sourcePath, module: one(p.rawFields, "ModuleID") ?? "unknown", side: "unknown", x: one(p.rawFields, "X") === null ? NaN : Number(one(p.rawFields, "X")), y: one(p.rawFields, "Y") === null ? NaN : Number(one(p.rawFields, "Y")), rotation: null, holds: ["RefID", "X", "Y", "ModuleID"].filter(k => one(p.rawFields, k) === null).map(k => `Native scalar ${k} missing/repeated`) })) });
  }
  return sources;
}

export const coordinateFrameContract = [
  { frame: "Placement source → normalized placement", status: "observed parser conversion", contract: "Original row and strings retained. Explicit mapped columns, declared mm/inches, side/module and rotation direction produce millimeters and CCW angles. Swapped columns are an intake decision, not a board transform." },
  { frame: "PCB footprint local → PCB source board", status: "source-defined geometry", contract: "Owned pattern origin, numbered pads, source placement rotation and flip state remain distinct. A footprint anchor is not automatically the physical body center. Unsupported flips and shapes retain their holds." },
  { frame: "Gerber source → Gerber physical mm", status: "observed parser conversion", contract: "FS declaration/override, MO units, polarity and step-repeat are recorded. Board-instance registration is separate from ownership. Display Y inversion changes only the drawing." },
  { frame: "Selected source scope → another source scope", status: "reviewed hypothesis until accepted", contract: "Three noncollinear same-origin references plus independent checkpoints establish fixed scale proper rotation/translation. Revisions, side, units, handedness and missing/duplicate references remain explicit holds. No scale or reflection fitting." },
  { frame: "Native CAD → board/module → Part ROI", status: "literal observations; runtime unqualified", contract: "CAD ModuleID, placement ParentId, ROI, Center/Polarity and module transforms are independent native fields. Shared numeric offsets do not qualify native units or justify moving correct CAD to hide a local ROI error." },
  { frame: "Master/window local → placement → native board", status: "constructor hypothesis; runtime unqualified", contract: "Master origin/CadOffset, window RelROI rotation/offset, parent/group links and shared Master usage must close independently. New geometry does not establish WND_PAD, FOV, optical teaching or propagation semantics." },
  { frame: "Native board/FOV → image pixels", status: "unqualified", contract: "Image origin, pitch, extent, optical distortion, board side and module mapping are required before board-image overlays. No image is overlaid by visual similarity." },
];
