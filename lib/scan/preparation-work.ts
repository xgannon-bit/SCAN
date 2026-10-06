import type { BomResult } from "./bom-types";
import type { ArchiveReview } from "./archive-types";
import type { NativeInspectionWork } from "./native-inspection-work";

export type PreparationAccounting = {
  reference: string; module: string; nativeCadId?: string; status: string;
  placementIds: string[]; masterKeys?: string[]; mountingEvidence?: string;
  sourcePath?: string | null; holdCode?: string | null; holdReason?: string | null;
  nextAction: string; remaining?: string[]; windowPreparation?: string | null;
  omittedWindows?: { windowId: string; reasons: string[]; relatedWindowIds: string[]; templateAlgorithmsNotTransferred?: number }[];
};
export type PreparationItem = {
  status: string; reference?: string; digest?: string;
  selection: { moduleId: string };
  dependencies?: { partId: string; masterKey: string; windowIds: string[]; windowPreparation?: string; windowRoles?: { windowId: string; role: string; padNumber: string | null; pin: string | null; sourcePath: string | null; terminalRole?: string }[]; omittedWindows?: PreparationAccounting["omittedWindows"] };
  remaining?: string[]; prepared?: string;
};
export type PreparationBindingWork = { status: string; components: { reference: string; moduleId: string; sourceOwnedPadCount: number; holdCodes: string[]; requiredEvidence: string[]; placements: { partId: string; masterKey: string; bindingTupleCount: number; literalClosedTupleCount: number; literalState: string; windowCount: number }[] }[];
  sharedBlockers: { code: string; message: string; componentCount: number }[] };

/** Source evidence and applied native records are separate from optical completion. */
export function preparationWork(accounting: PreparationAccounting[], items: PreparationItem[], accepted: string[], bom: BomResult | null, archive: ArchiveReview | null, bindingWork?: PreparationBindingWork, candidateQueue?: NativeInspectionWork) {
  const applied = new Map(items.filter(i => i.digest && accepted.includes(i.digest)).map(i => [`${i.selection.moduleId}\0${i.reference}`, i]));
  const one = (values: string[] | undefined) => values?.length === 1 ? values[0] : null;
  const queue = candidateQueue ?? archive?.preflight.nativeInspectionWork;
  const rows = accounting.map(component => {
    const actualPrepared = ["prepared-disabled", "prepared-partial-disabled"].includes(component.status);
    const item = actualPrepared ? applied.get(`${component.module}\0${component.reference}`) : undefined;
    // Only freshly parsed candidate accounting establishes creation. Accepting
    // a proposal alone never fabricates a placement or counts preparation.
    const prepared = actualPrepared;
    const existed = !prepared && component.placementIds.length > 0;
    const pending = !prepared && component.status === "proposal-awaiting-review";
    const binding = bindingWork?.components.find(b => b.reference === component.reference && b.moduleId === component.module);
    const matches = bom?.references.filter(b => b.normalizedRefdes === component.reference.trim().toUpperCase()) ?? [];
    const evidence = matches.length === 1 ? matches[0] : null;
    const applicability = evidence && (!evidence.scope.module || evidence.scope.module === component.module) ? "reference-correspondence-only" : "unresolved-module-applicability";
    const population = applicability === "reference-correspondence-only" ? evidence!.populationEvidence : "missing-or-ambiguous-bom";
    const group = population === "engineering-dnp" ? "engineering-dnp"
      : component.mountingEvidence === "hole-bearing" ? "hole-bearing"
      : population === "engineering-listed" && component.mountingEvidence === "explicit-zero-holes" ? "populated-smt-intent" : "population-or-mounting-unknown";
    const keys = item?.dependencies ? [item.dependencies.masterKey] : component.masterKeys ?? [];
    const omittedWindows = item?.dependencies?.omittedWindows ?? component.omittedWindows ?? [];
    const partialWindows = prepared && (component.status === "prepared-partial-disabled" || omittedWindows.length > 0);
    const scopes = queue?.scopes.filter(s => keys.includes(s.masterKeyLiteral)) ?? [];
    const scopeIds = new Set(scopes.map(s => s.id));
    const windows = prepared && item?.dependencies ? item.dependencies.windowIds.map(id => ({ id, masterKey: item.dependencies!.masterKey, algorithmCount: 0, referenceGeometry: item.dependencies!.windowRoles?.find(w => w.windowId === id) ?? null, geometry: "unverified", binding: "unresolved", teaching: "not-prepared" }))
      : (queue?.windows.filter(w => w.scopeId && scopeIds.has(w.scopeId)) ?? []).map(w => ({ id: one(w.rawFields.ID), masterKey: one(w.rawFields.ParentId), algorithmCount: w.algorithmIds.length, geometry: w.geometryReview, binding: w.bindingReview, teaching: "preserved-unverified" }));
    const atEagle = ["Confirm current work-order population, board side, module and stage."];
    if (group === "engineering-dnp") atEagle.push("Decide fitted/DNP for this work order; do not enable a disabled DNP draft merely because a native record exists.");
    if (group === "hole-bearing") atEagle.push("Decide through-hole inspection for this stage; surface-pad preparation is not an exclusion decision.");
    if (pending) atEagle.push("Review the supported offline preparation proposal first; a proposal is not an applied native part.");
    else if (!prepared && !existed) atEagle.push(`Create the required job-local model and placement if populated. Offline blocker: ${component.holdCode ?? "supported model required"}. ${component.holdReason ?? component.nextAction}`);
    if (existed && component.placementIds.length > 1) atEagle.push("Review every listed placement and model in this duplicate scope; preserve useful feature teaching and choose any redundant record explicitly.");
    if (prepared) atEagle.push("Verify the prepared placement identity, native CAD correspondence, origin, angle and every listed local window; manual model/placement recreation is not required if qualification passes.",
      "Resolve owned pad bindings, dependent windows and FOV assignment before enabling.",
      "Teach required body/presence, leads/solder, polarity, OCR, Blob, lighting and height on the actual board; no template image algorithms were transferred.");
    if (prepared && component.windowPreparation === "constructed-body-terminal-geometry") atEagle.push("Qualify the new body origin, local Master and each owned terminal-land reference window. Terminal-land geometry is not lead/solder teaching. Verify the native coordinate convention and any Eagle binding or model synchronization preserves the initial placement; that behavior remains unverified.");
    const polarized = item?.dependencies?.windowRoles?.some(w => w.terminalRole === "cathode");
    if (prepared && polarized) atEagle.push("Check the recorded source pad/pin anode and cathode assignment against the fitted part and manufacturer marking. Teach the cathode mark in Eagle; native polarity-position fields remain unlearned and unqualified. Verify polarity and body/terminal positions after binding, teaching, save and reopen.");
    if (partialWindows) atEagle.push(`Partial local-window preparation: resolve each omitted intended inspection before enabling: ${omittedWindows.map(w => `${w.windowId} (${w.reasons.join(", ")})`).join("; ")}. Create/teach any required missing window with a supported local parent; review body settings and implicit window-dependent settings. No omitted window is an approved inspection exclusion.`);
    if (existed) atEagle.push("Preserve existing teaching; review flagged bindings/origins/windows and shared Master scope. Reteach only where review or a geometry change requires it.");
    atEagle.push("Complete Eagle open/save/reopen qualification and physical inspection before enabling intended parts; record machine-specific validation separately.");
    return { reference: component.reference, module: component.module, nativeCadId: component.nativeCadId ?? null,
      state: component.status, category: group,
      populationEvidence: population, rawBomPopulationEvidence: evidence?.populationEvidence ?? null,
      bomSourceSha256: bom?.sourceSha256 ?? null, bomSourceRow: evidence?.sourceRow ?? null,
      bomApplicability: applicability, workOrderPopulation: "unapproved", intentionallyExcluded: false,
      mountingEvidence: component.mountingEvidence ?? "unknown", sourcePath: component.sourcePath ?? null,
      placementIds: item?.dependencies ? [item.dependencies.partId] : component.placementIds,
      masterKeys: keys, windows, omittedWindows,
      windowPreparation: prepared ? (partialWindows ? "partial-closed-window-subset" : component.windowPreparation ?? item?.dependencies?.windowPreparation ?? "complete-template-window-copy") : "not-prepared-by-this-candidate",
      sharedMasterScopes: scopes.map(s => ({ masterKey: s.masterKeyLiteral, placementCount: s.partIds.length, scopeId: s.id })),
      nativeCreation: prepared ? "prepared-offline" : existed ? "existing-preserved" : pending ? "proposal-awaiting-review" : "required-if-populated",
      nativePlacement: prepared ? "prepared-offline-verify-at-Eagle" : existed ? "existing-preserved" : "required-if-populated",
      alignment: prepared ? "prepared-native-CAD-correspondence-qualification-required" : existed ? "preserved-review-flagged-issues" : "not-prepared",
      teaching: prepared ? "new-image-algorithms-not-prepared" : existed ? "preserved-unverified" : "not-prepared",
      padBinding: { status: "unresolved", sourceOwnedPadCount: binding?.sourceOwnedPadCount ?? null,
        holdCodes: binding?.holdCodes ?? [], actualObservedPlacements: binding?.placements ?? [],
        newBindingTuples: prepared ? 0 : null, requiredEvidence: binding?.requiredEvidence ?? [], bindingPrepared: false },
      holdCode: prepared || existed || pending ? null : component.holdCode ?? "PREPARATION_MODEL_GEOMETRY",
      holdReason: prepared || existed || pending ? null : component.holdReason ?? component.nextAction,
      remaining: prepared ? item?.remaining ?? component.remaining ?? [] : component.remaining ?? [],
      atEagle, enabledBySCAN: false, machineValidated: false, released: false };
  });
  const held = new Map<string, { category: string; code: string; reason: string; references: { module: string; reference: string }[] }>();
  for (const row of rows.filter(r => r.nativeCreation === "required-if-populated")) {
    const key = `${row.category}\0${row.holdCode}\0${row.holdReason}`;
    const group = held.get(key) ?? { category: row.category, code: row.holdCode!, reason: row.holdReason!, references: [] };
    group.references.push({ module: row.module, reference: row.reference }); held.set(key, group);
  }
  return { artifactType: "scan.component-preparation-work", schemaVersion: "1", sourceContext: archive?.capture.packageSha256 ?? null,
    nativeWorkSourceContext: candidateQueue?.sourceContext ?? queue?.sourceContext ?? null,
    rows, heldGroups: [...held.values()], counts: { cadReferences: rows.length,
      originalReferencesPreserved: rows.filter(r => r.nativeCreation === "existing-preserved").length,
      preparedReferences: rows.filter(r => r.nativeCreation === "prepared-offline").length,
      preparedWithCompleteTemplateWindowCopy: rows.filter(r => r.nativeCreation === "prepared-offline" && r.windowPreparation === "complete-template-window-copy").length,
      preparedWithPartialWindows: rows.filter(r => r.nativeCreation === "prepared-offline" && r.windowPreparation === "partial-closed-window-subset").length,
      preparedWithConstructedGeometry: rows.filter(r => r.nativeCreation === "prepared-offline" && r.windowPreparation === "constructed-body-terminal-geometry").length,
      proposalsAwaitingReview: rows.filter(r => r.nativeCreation === "proposal-awaiting-review").length,
      preparedPopulatedSmtIntent: rows.filter(r => r.nativeCreation === "prepared-offline" && r.category === "populated-smt-intent").length,
      missingPopulatedSmtIntent: rows.filter(r => ["required-if-populated", "proposal-awaiting-review"].includes(r.nativeCreation) && r.category === "populated-smt-intent").length,
      missingEngineeringDnp: rows.filter(r => ["required-if-populated", "proposal-awaiting-review"].includes(r.nativeCreation) && r.category === "engineering-dnp").length,
      missingHoleBearing: rows.filter(r => ["required-if-populated", "proposal-awaiting-review"].includes(r.nativeCreation) && r.category === "hole-bearing").length },
    sharedBindingBlockers: bindingWork?.sharedBlockers ?? [],
    sharedSteps: ["Select the explicit main job and Master. Preserved Temp/backup snapshots contain original state and must not be substituted.",
      "Qualify this candidate on the exact Eagle version with an original control save and candidate open/save/reopen.",
      "Verify board/module/fiducial alignment against independent features before local teaching; offline native preparation is not physical alignment validation."],
    qualificationOnly: true, machineExportAllowed: false, inspectionRepairEstablished: false };
}

export function preparationWorkCsv(work: ReturnType<typeof preparationWork>) {
  const columns = ["reference", "module", "category", "state", "populationEvidence", "workOrderPopulation", "nativeCreation", "nativePlacement", "alignment", "teaching", "placementIds", "masterKeys", "windowPreparation", "windows", "omittedWindows", "padBinding", "holdCode", "holdReason", "atEagle"] as const;
  const cell = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return `"${/^[=+@-]/.test(text) ? "'" : ""}${text.replaceAll('"', '""')}"`;
  };
  return [columns.join(","), ...work.rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n") + "\r\n";
}
