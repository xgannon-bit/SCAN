import type { LayoutResult } from "./layout-types";
import { translationDiagnostic } from "./source-registration-diagnostic";
import type { BomResult } from "./bom-types";
import type { PlacementResult } from "./placement-types";
import type { ArchiveReview } from "./archive-types";

export function buildSourceCrosswalk(bom: BomResult | null, placement: PlacementResult | null, archive: ArchiveReview | null, comparisons: { name: string; result: PlacementResult | null }[] = [], layout: LayoutResult | null = null) {
  const normalize = (ref: string) => ref.trim().toUpperCase();
  const entries: { source: string; hash: string; row: number | null; path: string | null; rawRef: string; key: string; module: string; side: string; mpn: string | null; rawMpn: unknown; population: string; frame: string; x: string | null; y: string | null }[] = [];
  for (const ref of bom?.references ?? []) entries.push({ source: "BOM", hash: bom!.sourceSha256, row: ref.sourceRow, path: null, rawRef: ref.rawRefdes, key: ref.normalizedRefdes, module: ref.scope.module, side: ref.scope.side, mpn: ref.mpn, rawMpn: ref.rawMpn, population: ref.populationEvidence, frame: "no-coordinates", x: null, y: null });
  for (const source of [{ name: "Active placement", result: placement }, ...comparisons]) for (const ref of source.result?.placements ?? []) entries.push({ source: source.name, hash: source.result!.sourceSha256, row: ref.sourceRow, path: null, rawRef: ref.refdes, key: normalize(ref.refdes), module: ref.module, side: ref.side, mpn: ref.mpn, rawMpn: ref.mpn, population: "unknown", frame: source.result!.coordinateFrame, x: ref.xMm, y: ref.yMm });
  for (const ref of archive?.preflight.nativeRecords.job?.records.filter(record => record.kind === "cad-record") ?? []) {
    const one = (key: string) => ref.rawFields[key]?.length === 1 ? ref.rawFields[key][0] : "";
    if (!one("RefID")) continue;
    entries.push({ source: "Native CAD", hash: archive!.preflight.selection.job.sha256, row: null, path: ref.sourcePath, rawRef: one("RefID"), key: normalize(one("RefID")), module: one("ModuleID"), side: "", mpn: null, rawMpn: null, population: "unknown", frame: "native-CAD-unqualified", x: one("X"), y: one("Y") });
  }
  for (const ref of layout?.placements ?? []) {
    if (!ref.refdes) continue;
    entries.push({ source: "Source PCB", hash: layout!.sourceSha256, row: null, path: ref.sourcePath, rawRef: ref.refdes, key: normalize(ref.refdes), module: "", side: ref.side ?? "", mpn: null, rawMpn: ref.component?.compValue ?? null, population: "unknown", frame: "source-PCB-cartesian-unregistered", x: ref.anchor?.xMm == null ? null : String(ref.anchor.xMm), y: ref.anchor?.yMm == null ? null : String(ref.anchor.yMm) });
  }
  const byReference = new Map<string, typeof entries>();
  const bySource = new Map<string, { refs: Set<string>; hashes: Set<string> }>();
  for (const entry of entries) {
    const group = byReference.get(entry.key) ?? []; group.push(entry); byReference.set(entry.key, group);
    const source = bySource.get(entry.source) ?? { refs: new Set<string>(), hashes: new Set<string>() };
    source.refs.add(entry.key); source.hashes.add(entry.hash); bySource.set(entry.source, source);
  }
  const keys = Array.from(byReference.keys()).sort();
  const sourceNames = Array.from(new Set(entries.map(item => item.source)));
  const rows = keys.map(key => {
    const items = byReference.get(key)!, issues: string[] = [];
    const bomItems = items.filter(item => item.source === "BOM"), active = items.filter(item => item.source === "Active placement");
    const engineeringDnp = bomItems.length === 1 && bomItems[0].population === "engineering-dnp";
    if (bom && !bomItems.length) issues.push("Missing from selected engineering BOM; resolve revision/applicability.");
    if (placement && !active.length) issues.push("Missing from active placement source; no coordinates are invented.");
    if (bomItems.length > 1) issues.push("Ambiguous BOM matching key; duplicate groups or normalization collision.");
    if (active.length > 1) issues.push("Multiple placement records: resolve module/side/instance scope before correspondence.");
    if (engineeringDnp) issues.push("Engineering DNP evidence explains a possible blank MPN; current work-order population is unapproved.");
    if (bomItems.length === 1 && active.length === 1 && bomItems[0].mpn && active[0].mpn && bomItems[0].mpn !== active[0].mpn) {
      issues.push(bomItems[0].mpn.replace(/\s/g, "") === active[0].mpn.replace(/\s/g, "") ? "MPNs match only after whitespace removal; review normalization, not an alternate-part approval." : "MPN conflict: resolve exact part identity; no substitution is approved.");
    }
    if (bomItems.some(item => !item.module || !item.side) || bom && !bom.config.scope.boardInstance) issues.push("BOM applicability is reference-only; confirm module, side and board instance before using quantities.");
    const positionSources = items.filter(item => item.source !== "Native CAD" && item.x !== null);
    if (new Set(positionSources.map(item => `${item.x},${item.y}`)).size > 1) issues.push("Placement sources have different coordinates; units alone do not establish registration.");
    return { reference: key, sources: items, engineeringDnp, issues, nextAction: issues[0] ?? "Source references correspond; verify geometry and inspection work separately.", nativePreparation: "unassessed", teaching: "unverified", workOrderPopulation: "unapproved" };
  });
  const coordinateSources = sourceNames.filter(name => name !== "Native CAD" && name !== "BOM");
  const registrationDiagnostics = coordinateSources.flatMap((from, i) => coordinateSources.slice(i + 1).map(to => {
    const points = (name: string) => entries.filter(item => item.source === name && item.x !== null && item.y !== null && item.x !== "" && item.y !== "").map(item => ({ reference: item.key, x: Number(item.x), y: Number(item.y) }));
    return { from, to, ...translationDiagnostic(points(from), points(to)) };
  }));
  const sharedCauses = new Map<string, string[]>();
  for (const row of rows) for (const issue of row.issues) { const affected = sharedCauses.get(issue) ?? []; affected.push(row.reference); sharedCauses.set(issue, affected); }
  return { artifactType: "scan.source-crosswalk", schemaVersion: "1", sourceNames, rows, registrationDiagnostics,
    sharedIssues: [...sharedCauses].map(([reason, references]) => ({ reason, references, affectedCount: references.length })),
    sources: sourceNames.map(name => ({ name, missingReferences: keys.filter(key => !bySource.get(name)!.refs.has(key)), count: bySource.get(name)!.refs.size, hashes: [...bySource.get(name)!.hashes] })),
    coordinateRegistration: "not-established-by-reference-matching", machineExportAllowed: false,
    missingFromActivePlacement: placement ? rows.filter(row => !row.sources.some(item => item.source === "Active placement")).map(row => row.reference) : [],
    engineeringDnpReferences: rows.filter(row => row.engineeringDnp).map(row => row.reference) };
}
