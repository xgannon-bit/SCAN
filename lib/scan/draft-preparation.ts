import type { LayoutPlacement, LayoutResult, ExplicitLayerGeometry } from "./layout-types";
import type { ArchiveReview } from "./archive-types";

// Classification uses geometry, never a RefDes prefix or historical repair.
function equalRectPair(layer: ExplicitLayerGeometry) {
  if (layer.pads.length !== 2) return false;
  const [a, b] = layer.pads;
  if (a.padNumber === b.padNumber || !a.padNumber || !b.padNumber) return false;
  const values = layer.pads.flatMap(pad => [pad.widthMm, pad.heightMm, pad.local.xMm, pad.local.yMm, pad.localRotationDegrees]);
  if (values.some(value => !Number.isFinite(value))) return false;
  const angle = ((a.localRotationDegrees % 180) + 180) % 180;
  const otherAngle = ((b.localRotationDegrees % 180) + 180) % 180;
  const separated = a.local.yMm === b.local.yMm
    ? Math.abs(a.local.xMm - b.local.xMm) > (angle === 0 ? a.widthMm : a.heightMm)
    : a.local.xMm === b.local.xMm && Math.abs(a.local.yMm - b.local.yMm) > (angle === 0 ? a.heightMm : a.widthMm);
  return a.shape === "Rect" && b.shape === "Rect" && a.widthMm > 0 && a.heightMm > 0
    && a.widthMm === b.widthMm && a.heightMm === b.heightMm
    && (angle === 0 || angle === 90) && angle === otherAngle && separated;
}

export function sourceDraftClass(placement: LayoutPlacement | null) {
  if (!placement) return "source-layout-needed";
  if (placement.identityHolds.length || !placement.ownedPadCentersAvailable) return "source-geometry-held";
  if (placement.mountingEvidence === "hole-bearing") return "hole-bearing-separate-workflow";
  if (placement.mountingEvidence !== "explicit-zero-holes") return "drill-evidence-needed";
  if (placement.explicitLayerGeometry?.some(equalRectPair)) return "two-pad-rectangular-source-family";
  return "other-family-not-supported";
}

export function draftPreparation(reference: string, layout: LayoutResult | null, archive: ArchiveReview | null, engineeringDnp: boolean, existing: boolean) {
  const matches = layout?.placements.filter(item => item.refdes?.trim().toUpperCase() === reference) ?? [];
  const source = matches.length === 1 ? matches[0] : null;
  const classification = matches.length > 1 ? "source-identity-ambiguous" : sourceDraftClass(source);
  const layers = source?.explicitLayerGeometry?.filter(equalRectPair) ?? [];
  // Name matches are review leads, not qualified template compatibility.
  const records = archive?.preflight.nativeRecords;
  const one = (fields: Record<string, string[]>, key: string) => fields[key]?.length === 1 ? fields[key][0] : null;
  const templateCandidates = source?.patternRef ? (records?.master?.records ?? [])
    .filter(record => record.kind === "part-record" && one(record.rawFields, "PackageName") === source.patternRef)
    .map(record => {
      const master = one(record.rawFields, "MasterKey");
      const windows = master ? (records?.master?.records ?? []).filter(item => item.kind === "window-record" && one(item.rawFields, "ParentId") === master) : [];
      return { sourcePath: record.sourcePath, masterKeyLiteral: master, windowCount: windows.length,
        linkedPlacementCount: (records?.job?.records ?? []).filter(item => item.kind === "part-record" && master !== null && one(item.rawFields, "MasterKey") === master).length,
        compatibility: "unqualified-package-name-correspondence" as const };
    }) : [];
  const holds: string[] = [];
  if (engineeringDnp) holds.push("Resolve engineering DNP and work-order population; no automatic exclusion or creation.");
  if (existing) holds.push("Existing native structure is preserved; this is not a missing-placement creation target.");
  if (classification !== "two-pad-rectangular-source-family") holds.push(classification === "hole-bearing-separate-workflow"
    ? "The source declares a nonzero drill. This is outside the first surface-pad draft family; it is not automatically excluded from inspection."
    : "Complete unique source geometry for the first supported two-pad rectangular family is unavailable.");
  if (layers.length) holds.push("Choose and qualify the numbered source layer; unresolved layer-class rules remain separate from these explicit outlines.");
  holds.push("Establish source-to-native module, side, rotation and origin correspondence.");
  holds.push(templateCandidates.length ? "Qualify a local template's fields, window frames, dependencies and neutral disabled state; matching package names are insufficient."
    : "No literal package-name template correspondence. Establish a compatible job-local model and its dependency contract.");
  holds.push("Review exact new placement/Master/window IDs and changes before any real native creation.");
  return { artifactType: "scan.disabled-draft-preparation" as const, schemaVersion: "1" as const,
    status: "held" as const, classification, reference, sourceSha256: layout?.sourceSha256 ?? null,
    sourcePath: source?.sourcePath ?? null, patternRef: source?.patternRef ?? null,
    mountingEvidence: source?.mountingEvidence ?? "unknown", layers, templateCandidates, holds,
    intendedOperation: "new-job-local-disabled-records" as const, nativeRecordsCreated: 0,
    populationApproved: false, machineCompatibility: "unverified", inspectionBehavior: "unverified",
    nextAction: holds[0], machineExportAllowed: false };
}
