import { validateNativePreparationSession, type NativePreparationSession } from "./native-preparation-session";
import { validateNativeDiagnosisContext, type NativeDiagnosisContext } from "./native-placement-diagnosis";
export type RepairComposition = Pick<NativePreparationSession["history"][number], "review" | "reviewer" | "accepted" | "packageProfiles">;
export type RepairProposal = { id: string; path: string; identity: Record<"ID" | "ParentId" | "MasterKey" | "RefID", string>; before: string; after: string; evidenceIds: string[]; dependencyProposalIds?: string[]; beforeRoi?: Record<"cx" | "cy" | "w" | "h" | "a", string> };
export type RepairRequest = {
  artifactType: "scan.qualification-patch-request"; schemaVersion: "1"; purpose: "qualification-only";
  source: { archiveSha256: string; jobSha256: string; root: string; jobMember: string; jobRole: "main"; masterMember?: string; masterSha256?: string; masterRole?: "main" };
  targetEagleBuild: string | null; targetMachine: string | null; reviewer: string; trialPurpose: string;
  evidence: { id: string; summary: string; kind?: "historical-replay" | "independent-source-support"; independentSupport: boolean; references: { sha256: string; label: string }[] }[];
  proposals: RepairProposal[];
  acceptances: { proposalId: string; proposalSha256: string; decision: "pending" | "accepted" | "rejected"; reviewer: string }[];
  diagnosis?: NativeDiagnosisContext;
};
export type RepairSession = {
  sourceContext?: string;
  request: RepairRequest | null;
  history: { id: string; recordedAt: string; sourceSha256: string; packageSha256: string; candidateSha256: string; request: RepairRequest; composition?: RepairComposition }[];
  work: { key: string; sourceSha256: string; snapshotId: string; status: "review-needed" | "reviewed-offline" | "intentionally-excluded" | "machine-work"; note: string }[];
};
export const emptyRepair = (): RepairSession => ({ request: null, history: [], work: [] });
/** Connected dependencies are reviewed together, so an XY move cannot be partly accepted. */
export function repairProposalGroups(request: RepairRequest): RepairProposal[][] {
  const remaining = new Map(request.proposals.map(p => [p.id, p])), groups: RepairProposal[][] = [];
  while (remaining.size) {
    const ids = new Set([remaining.keys().next().value!]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of request.proposals) if (ids.has(p.id) || p.dependencyProposalIds?.some(id => ids.has(id))) {
        for (const id of [p.id, ...(p.dependencyProposalIds ?? [])]) if (!ids.has(id)) { ids.add(id); changed = true; }
      }
    }
    const group = request.proposals.filter(p => ids.has(p.id)); group.forEach(p => remaining.delete(p.id)); groups.push(group);
  }
  return groups;
}
export function validateRepairSession(value: unknown): RepairSession {
  const item = value as RepairSession;
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (!item || typeof item !== "object" || Object.keys(item).filter(key => key !== "sourceContext").sort().join() !== "history,request,work" || (Object.hasOwn(item, "sourceContext") && !hash(item.sourceContext)) || JSON.stringify(item).length > 5_000_000 || !Array.isArray(item.history) || item.history.length > 50 || !Array.isArray(item.work) || item.work.length > 10000) throw new Error("Invalid saved repair session.");
  function request(r: RepairRequest) {
    if (!r || r.artifactType !== "scan.qualification-patch-request" || r.schemaVersion !== "1" || r.purpose !== "qualification-only" || !hash(r.source?.archiveSha256) || !hash(r.source?.jobSha256) || !Array.isArray(r.proposals) || r.proposals.length > 256 || !Array.isArray(r.acceptances) || !Array.isArray(r.evidence) || JSON.stringify(r).length > 1_000_000) throw new Error("Invalid saved repair request. No authority was restored.");
    const text = (value: unknown, maximum = 2048) => typeof value === "string" && value.length <= maximum && !value.includes("\0");
    if (!text(r.reviewer, 256) || !text(r.trialPurpose) || !text(r.source.jobMember) || !text(r.source.root) || r.source.jobRole !== "main") throw new Error("Invalid saved repair scope.");
    if (r.diagnosis) { validateNativeDiagnosisContext(r.diagnosis); if (!r.diagnosis.diagnosisSha256) throw new Error("Saved derived proposals require the frozen finding hash."); }
    if (["masterMember", "masterSha256", "masterRole"].some(k => Object.hasOwn(r.source, k)) && (!text(r.source.masterMember) || !r.source.masterMember || !hash(r.source.masterSha256) || r.source.masterRole !== "main")) throw new Error("Invalid saved repair Master scope.");
    const ids = new Set(r.proposals.map(p => p?.id));
    if (ids.size !== r.proposals.length) throw new Error("Repeated saved proposal identity.");
    for (const proposal of r.proposals) {
      if (!proposal || !text(proposal.id, 128) || !text(proposal.path) || !text(proposal.before) || !text(proposal.after) || !proposal.identity || ["ID", "ParentId", "MasterKey", "RefID"].some(key => !text(proposal.identity[key as keyof typeof proposal.identity])) || !Array.isArray(proposal.evidenceIds) || proposal.evidenceIds.some(id => !text(id, 128))) throw new Error("Invalid saved proposal.");
      if (proposal.dependencyProposalIds && (!Array.isArray(proposal.dependencyProposalIds) || proposal.dependencyProposalIds.length > 256 || new Set(proposal.dependencyProposalIds).size !== proposal.dependencyProposalIds.length || proposal.dependencyProposalIds.some(id => !ids.has(id)))) throw new Error("Invalid saved proposal dependencies.");
      if (proposal.beforeRoi && (Object.keys(proposal.beforeRoi).sort().join() !== "a,cx,cy,h,w" || Object.values(proposal.beforeRoi).some(v => !text(v, 80)))) throw new Error("Invalid saved ROI guard.");
    }
    for (const decision of r.acceptances) if (!decision || !text(decision.proposalId, 128) || !hash(decision.proposalSha256) || !["pending", "accepted", "rejected"].includes(decision.decision) || !text(decision.reviewer, 256)) throw new Error("Invalid saved decision.");
    for (const evidence of r.evidence) if (!evidence || !text(evidence.id, 128) || !text(evidence.summary, 4000) || (evidence.kind === "historical-replay" ? evidence.independentSupport !== false : (evidence.kind !== undefined && evidence.kind !== "independent-source-support") || evidence.independentSupport !== true) || !Array.isArray(evidence.references) || evidence.references.some(ref => !ref || !hash(ref.sha256) || !text(ref.label, 512))) throw new Error("Invalid saved evidence.");
  }
  if (item.request !== null) request(item.request);
  for (const revision of item.history) {
    if (!hash(revision.sourceSha256) || !hash(revision.packageSha256) || !hash(revision.candidateSha256) || typeof revision.id !== "string" || typeof revision.recordedAt !== "string") throw new Error("Invalid candidate history.");
    request(revision.request);
    if (revision.composition) {
      const c = revision.composition;
      validateNativePreparationSession({ reviewer: c.reviewer, review: c.review, history: [{ id: revision.id,
        recordedAt: revision.recordedAt, packageSha256: revision.packageSha256, candidateSha256: revision.candidateSha256,
        ...c }], ...(c.packageProfiles ? { packageProfiles: c.packageProfiles } : {}) });
      if (c.review.archiveSha256 !== revision.sourceSha256) throw new Error("Combined preparation and repair sources differ.");
    }
  }
  for (const work of item.work) if (typeof work.key !== "string" || work.key.length > 2048 || !hash(work.sourceSha256) || typeof work.snapshotId !== "string" || !["review-needed", "reviewed-offline", "intentionally-excluded", "machine-work"].includes(work.status) || typeof work.note !== "string" || work.note.length > 2000) throw new Error("Invalid work observation. Observations cannot grant machine validation.");
  return item;
}
