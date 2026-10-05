export type PartDecision = { digest: string; reference: string; decision: "pending" | "accepted" | "rejected" };
export type PreparationReviewIdentity = { digest: string; sourceContext: string; archiveSha256: string; layoutSha256: string; decisions: PartDecision[] };
export type NativePreparationSession = {
  reviewer: string;
  review: PreparationReviewIdentity | null;
  history: { id: string; recordedAt: string; packageSha256: string; candidateSha256: string; review: PreparationReviewIdentity; reviewer: string; accepted: string[] }[];
};
export const emptyNativePreparation = (): NativePreparationSession => ({ reviewer: "", review: null, history: [] });
export function validateNativePreparationSession(value: unknown): NativePreparationSession {
  const object = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join() !== keys.sort().join()) throw new Error("Invalid saved native preparation structure.");
    return v as Record<string, unknown>;
  };
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max && !v.includes("\0");
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const review = (v: unknown) => {
    const r = object(v, ["digest", "sourceContext", "archiveSha256", "layoutSha256", "decisions"]);
    if (![r.digest, r.sourceContext, r.archiveSha256, r.layoutSha256].every(hash) || !Array.isArray(r.decisions) || r.decisions.length > 1000) throw new Error("Invalid saved preparation source identity.");
    const seen = new Set();
    for (const raw of r.decisions) {
      const d = object(raw, ["digest", "reference", "decision"]);
      if (!hash(d.digest) || seen.has(d.digest) || !text(d.reference, 2048) || !["pending", "accepted", "rejected"].includes(String(d.decision))) throw new Error("Invalid saved component decision.");
      seen.add(d.digest);
    }
  };
  const item = object(value, ["reviewer", "review", "history"]);
  if (!text(item.reviewer, 256) || !Array.isArray(item.history) || item.history.length > 50 || JSON.stringify(value).length > 5_000_000) throw new Error("Saved preparation exceeds supported bounds.");
  if (item.review !== null) review(item.review);
  for (const raw of item.history) {
    const h = object(raw, ["id", "recordedAt", "packageSha256", "candidateSha256", "review", "reviewer", "accepted"]);
    review(h.review);
    const r = h.review as PreparationReviewIdentity;
    if (!text(h.id, 128) || !text(h.reviewer, 256) || !h.reviewer || !hash(h.packageSha256) || !hash(h.candidateSha256) || typeof h.recordedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(h.recordedAt) || !Number.isFinite(Date.parse(h.recordedAt)) || !Array.isArray(h.accepted) || !h.accepted.length || h.accepted.length !== new Set(h.accepted).size || h.accepted.some(d => !hash(d) || !r.decisions.some(p => p.digest === d && p.decision === "accepted"))) throw new Error("Invalid preparation candidate history.");
  }
  return value as NativePreparationSession;
}
