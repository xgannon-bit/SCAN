import type { LayoutResult } from "./layout-types";
import type { ArchiveReview } from "./archive-types";
import type { BomResult } from "./bom-types";
import type { PreparationAccounting, PreparationBindingWork, PreparationItem } from "./preparation-work";
import { preparationWork } from "./preparation-work";
import type { RepairRequest } from "./repair-session";

export type CandidatePreparationEvidence = { accounting: PreparationAccounting[]; plan: { items: PreparationItem[] }; padBindingWork?: PreparationBindingWork };
const one = (fields: Record<string, string[]>, key: string) => fields[key]?.length === 1 ? fields[key][0] : null;

/** Rebuild completion from the actual candidate's freshly read linked records.
 * Saved decisions identify intended edits; they cannot manufacture completion. */
export function candidatePreparationWork(original: ArchiveReview, candidate: ArchiveReview, bom: BomResult | null, evidence: CandidatePreparationEvidence, accepted: string[], request?: RepairRequest | null, layout?: LayoutResult | null) {
  const baseline = original.preflight.nativeRecords.job?.records.filter(r => r.kind === "part-record") ?? [];
  const parts = candidate.preflight.nativeRecords.job?.records.filter(r => r.kind === "part-record") ?? [];
  const queue = candidate.preflight.nativeInspectionWork;
  if (!queue?.inventoryComplete || !original.preflight.nativeAccounting?.accountingComplete || !candidate.preflight.nativeAccounting?.accountingComplete) throw new Error("Complete fresh native accounting and linked inspection inventory are required.");
  const identity = (r: typeof parts[number]) => JSON.stringify([one(r.rawFields, "ParentId"), one(r.rawFields, "RefID"), one(r.rawFields, "ID"), one(r.rawFields, "MasterKey")]);
  const old = new Set(baseline.map(identity)), added = parts.filter(r => !old.has(identity(r)));
  const selected = evidence.plan.items.filter(i => i.digest && accepted.includes(i.digest));
  if (selected.length !== accepted.length || new Set(accepted).size !== accepted.length) throw new Error("Saved accepted preparation recipes cannot be reproduced exactly from these sources.");
  for (const item of selected) {
    const dep = item.dependencies;
    if (!dep) throw new Error("Prepared recipe has no linked record identities.");
    const matches = added.filter(p => one(p.rawFields, "RefID") === item.reference && one(p.rawFields, "ParentId") === item.selection.moduleId && one(p.rawFields, "ID") === dep.partId && one(p.rawFields, "MasterKey") === dep.masterKey);
    const windows = queue.windows.filter(w => one(w.rawFields, "ParentId") === dep.masterKey);
    const scope = queue.scopes.filter(s => s.masterKeyLiteral === dep.masterKey);
    if (matches.length !== 1 || one(matches[0].rawFields, "ENABLE") !== "False" || scope.length !== 1 || scope[0].masterPartSourcePaths.length !== 1 || windows.length !== dep.windowIds.length || new Set(windows.map(w => one(w.rawFields, "ID"))).size !== windows.length || windows.some(w => !dep.windowIds.includes(one(w.rawFields, "ID") ?? "") || one(w.rawFields, "ENABLE") !== "False" || w.algorithmIds.length)) throw new Error("Actual candidate placement, Master, disabled windows or algorithms differ from the reproduced accepted preparation.");
  }
  if (added.length !== selected.length || baseline.some(p => !parts.some(x => identity(x) === identity(p)))) throw new Error("The generated candidate has unexpected added or missing placement identities.");
  const accounting = evidence.accounting.map(row => {
    const actual = parts.filter(p => one(p.rawFields, "RefID") === row.reference && one(p.rawFields, "ParentId") === row.module);
    const item = selected.find(i => i.reference === row.reference && i.selection.moduleId === row.module);
    const partial = item?.dependencies?.windowPreparation === "partial-closed-window-subset";
    const result: PreparationAccounting = { ...row, placementIds: actual.map(p => one(p.rawFields, "ID") ?? "unknown"), masterKeys: actual.map(p => one(p.rawFields, "MasterKey") ?? "unknown"),
      status: item ? partial ? "prepared-partial-disabled" : "prepared-disabled" : actual.length ? "existing-native-preserved" : row.status === "proposal-awaiting-review" ? "proposal-awaiting-review" : "held-no-supported-template",
      ...(item ? { windowPreparation: item.dependencies?.windowPreparation, omittedWindows: item.dependencies?.omittedWindows, remaining: item.remaining } : {}) };
    const trials = request?.proposals.filter(p => request.acceptances.some(a => a.proposalId === p.id && a.decision === "accepted") && p.identity.RefID === row.reference && p.identity.ParentId === row.module) ?? [];
    for (const trial of trials) {
      const match = actual.filter(p => ["ID", "ParentId", "MasterKey", "RefID"].every(k => one(p.rawFields, k) === trial.identity[k as keyof typeof trial.identity]));
      if (match.length !== 1 || one(match[0].rawFields, trial.path.replace(/^JobContainer\/PartDataList\/PartData\[\d+\]\//, "")) !== trial.after) throw new Error("The actual candidate does not retain the recorded scalar trial.");
    }
    if (trials.length) result.appliedScalarTrials = trials.map(p => ({ proposalId: p.id, path: p.path, field: p.path.replace(/^JobContainer\/PartDataList\/PartData\[\d+\]\//, ""), identity: p.identity, before: p.before, after: p.after, qualificationOnly: true, inspectionRepairEstablished: false }));
    return result;
  });
  const binding = evidence.padBindingWork ? structuredClone(evidence.padBindingWork) : undefined;
  if (binding) {
    const missingMessage = binding.sharedBlockers.find(b => b.code === "BINDING_NATIVE_PART_MISSING")?.message;
    for (const component of binding.components) {
      const item = selected.find(i => i.reference === component.reference && i.selection.moduleId === component.moduleId);
      if (!item?.dependencies) continue;
      component.holdCodes = component.holdCodes.filter(c => c !== "BINDING_NATIVE_PART_MISSING");
      component.requiredEvidence = component.requiredEvidence.filter(message => message !== missingMessage);
      component.placements = [{ partId: item.dependencies.partId, masterKey: item.dependencies.masterKey, bindingTupleCount: 0, literalClosedTupleCount: 0, literalState: "new-empty-bindings-unqualified", windowCount: item.dependencies.windowIds.length }];
    }
    binding.sharedBlockers = binding.sharedBlockers.map(b => ({ ...b, componentCount: binding.components.filter(c => c.holdCodes.includes(b.code)).length })).filter(b => b.componentCount > 0);
  }
  return preparationWork(accounting, evidence.plan.items, accepted, bom, original, binding, queue, layout);
}
