export type RepairProposal = { id: string; path: string; identity: Record<"ID" | "ParentId" | "MasterKey" | "RefID", string>; before: string; after: string; evidenceIds: string[]; dependencyProposalIds?: string[] };
export type RepairRequest = {
  artifactType: "scan.qualification-patch-request"; schemaVersion: "1"; purpose: "qualification-only";
  source: { archiveSha256: string; jobSha256: string; root: string; jobMember: string; jobRole: "main" };
  targetEagleBuild: string | null; targetMachine: string | null; reviewer: string; trialPurpose: string;
  evidence: { id: string; summary: string; independentSupport: true; references: { sha256: string; label: string }[] }[];
  proposals: RepairProposal[];
  acceptances: { proposalId: string; proposalSha256: string; decision: "pending" | "accepted" | "rejected"; reviewer: string }[];
};
export type RepairSession = {
  request: RepairRequest | null;
  history: { id: string; recordedAt: string; sourceSha256: string; packageSha256: string; candidateSha256: string; request: RepairRequest }[];
  work: { key: string; sourceSha256: string; snapshotId: string; status: "review-needed" | "reviewed-offline" | "intentionally-excluded" | "machine-work"; note: string }[];
};
export const emptyRepair = (): RepairSession => ({ request: null, history: [], work: [] });
export function validateRepairSession(value: unknown): RepairSession {
  const item = value as RepairSession;
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  if (!item || typeof item !== "object" || Object.keys(item).sort().join() !== "history,request,work" || JSON.stringify(item).length > 5_000_000 || !Array.isArray(item.history) || item.history.length > 50 || !Array.isArray(item.work) || item.work.length > 10000) throw new Error("Invalid saved repair session.");
  function request(r: RepairRequest) {
    if (!r || r.artifactType !== "scan.qualification-patch-request" || r.schemaVersion !== "1" || r.purpose !== "qualification-only" || !hash(r.source?.archiveSha256) || !hash(r.source?.jobSha256) || !Array.isArray(r.proposals) || r.proposals.length > 256 || !Array.isArray(r.acceptances) || !Array.isArray(r.evidence) || JSON.stringify(r).length > 1_000_000) throw new Error("Invalid saved repair request. No authority was restored.");
    const text = (value: unknown, maximum = 2048) => typeof value === "string" && value.length <= maximum && !value.includes("\0");
    if (!text(r.reviewer, 256) || !text(r.trialPurpose) || !text(r.source.jobMember) || !text(r.source.root) || r.source.jobRole !== "main") throw new Error("Invalid saved repair scope.");
    for (const proposal of r.proposals) if (!proposal || !text(proposal.id, 128) || !text(proposal.path) || !text(proposal.before) || !text(proposal.after) || !proposal.identity || ["ID", "ParentId", "MasterKey", "RefID"].some(key => !text(proposal.identity[key as keyof typeof proposal.identity])) || !Array.isArray(proposal.evidenceIds) || proposal.evidenceIds.some(id => !text(id, 128))) throw new Error("Invalid saved proposal.");
    for (const decision of r.acceptances) if (!decision || !text(decision.proposalId, 128) || !hash(decision.proposalSha256) || !["pending", "accepted", "rejected"].includes(decision.decision) || !text(decision.reviewer, 256)) throw new Error("Invalid saved decision.");
    for (const evidence of r.evidence) if (!evidence || !text(evidence.id, 128) || !text(evidence.summary, 4000) || evidence.independentSupport !== true || !Array.isArray(evidence.references) || evidence.references.some(ref => !ref || !hash(ref.sha256) || !text(ref.label, 512))) throw new Error("Invalid saved evidence.");
  }
  if (item.request !== null) request(item.request);
  for (const revision of item.history) {
    if (!hash(revision.sourceSha256) || !hash(revision.packageSha256) || !hash(revision.candidateSha256) || typeof revision.id !== "string" || typeof revision.recordedAt !== "string") throw new Error("Invalid candidate history.");
    request(revision.request);
  }
  for (const work of item.work) if (typeof work.key !== "string" || work.key.length > 2048 || !hash(work.sourceSha256) || typeof work.snapshotId !== "string" || !["review-needed", "reviewed-offline", "intentionally-excluded", "machine-work"].includes(work.status) || typeof work.note !== "string" || work.note.length > 2000) throw new Error("Invalid work observation. Observations cannot grant machine validation.");
  return item;
}
