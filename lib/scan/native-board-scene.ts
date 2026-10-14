import type { ArchiveSelection, SnapshotPreflight } from "./archive-types";
import type { NativeDiagnosisReport } from "./native-placement-diagnosis";
import { repairProposalGroups, type RepairProposal, type RepairRequest, type RepairSession } from "./repair-session";
import { fitEntities, nativeEntities, previewEntity, repairIsFresh, scopeKey, type VisualEntity } from "./visual-workspace";

type NativeRecord = SnapshotPreflight["nativeRecords"][string]["records"][number];
type Identity = RepairProposal["identity"];
export type NativeBoardReview = "unreviewed" | "pending" | "accepted" | "rejected" | "mixed" | "stale";
export type NativeBoardPlacement = {
  key: string; sourcePath: string; identity: Identity; scope: string;
  entity: VisualEntity | null; candidateEntity: VisualEntity | null; proposedEntity: VisualEntity | null;
  literals: Record<string, string[]>; proposalGroup: RepairProposal[]; writtenChanges: RepairProposal[];
  status: { review: NativeBoardReview; proposed: boolean; accepted: boolean; written: boolean; preserved: boolean; analyzed: boolean; held: boolean; outlier: boolean; machineVerified: false };
  reasons: string[];
};
export type NativeBoardCounts = { total: number; eligible: number; invalid: number; outliers: number; unreviewed: number; pending: number; accepted: number; rejected: number; mixed: number; stale: number; proposed: number; written: number; preserved: number; analyzed: number; held: number; machineVerified: 0 };
export type NativeBoardSceneInput = {
  baseline?: SnapshotPreflight; candidate?: SnapshotPreflight; selection: ArchiveSelection | null;
  repair: RepairSession; sourceContext?: string | null;
  /** Only a current analysis result should be supplied; source and ROI guards are checked again here. */
  diagnosis?: NativeDiagnosisReport | null;
};
const keys = ["ParentId", "RefID", "ID", "MasterKey"] as const;
const roiKeys = ["cx", "cy", "w", "h", "a"] as const;
const scalar = (r: NativeRecord, key: string): string | null => r.rawFields[key]?.length === 1 ? r.rawFields[key][0] : null;
const identity = (r: NativeRecord): Identity => Object.fromEntries(keys.map(k => [k, scalar(r, k) ?? ""])) as Identity;
const completeIdentity = (r: NativeRecord) => keys.every(k => !!scalar(r, k)?.trim());
const sameIdentity = (r: NativeRecord, id: Identity) => keys.every(k => scalar(r, k) === id[k]);
const identityKey = (r: NativeRecord) => JSON.stringify(keys.map(k => scalar(r, k)));
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const canonical = (v: unknown): string => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const verified = (p?: SnapshotPreflight) => p?.status === "success" && p.integrity?.status === "verified-against-capture-hash" && p.integrity.allArchivedFilesVerified && p.nativeRecords.job?.status === "recorded";
const supportedField = (p: RepairProposal, record: NativeRecord) => ["Roi/cx", "Roi/cy", "CenterPosX", "ENABLE"].find(f => p.path === `${record.sourcePath}/${f}`);
const coordinateLiteral = (value: string | null) => value !== null && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e9;
const beforeMatches = (r: NativeRecord, p: RepairProposal) => sameIdentity(r, p.identity) && !!supportedField(p, r) && scalar(r, supportedField(p, r)!) === p.before && (!p.beforeRoi || roiKeys.every(k => scalar(r, `Roi/${k}`) === p.beforeRoi![k]));
const requestMatches = (p: SnapshotPreflight, r: RepairRequest) => r.source.archiveSha256 === p.source.sha256 && r.source.jobSha256 === p.selection.job.sha256 && r.source.root === p.selection.root && r.source.jobMember === p.selection.job.member && r.source.jobRole === "main" && p.selection.job.role === "main" && (!r.source.masterMember || (r.source.masterMember === p.selection.master?.member && r.source.masterSha256 === p.selection.master.sha256 && r.source.masterRole === p.selection.master.role));
const countByIdentity = (records: NativeRecord[]) => {
  const result = new Map<string, number>();
  for (const r of records) result.set(identityKey(r), (result.get(identityKey(r)) ?? 0) + 1);
  return result;
};

/** Exact reviewed subset, including atomic dependencies. A saved decision alone proves no write. */
function acceptedProposals(request: RepairRequest): RepairProposal[] | null {
  const decisions = new Map(request.acceptances.map(a => [a.proposalId, a]));
  const ids = new Set(request.proposals.map(p => p.id));
  if (decisions.size !== request.acceptances.length || ids.size !== request.proposals.length || request.acceptances.some(a => !ids.has(a.proposalId) || !hash(a.proposalSha256))) return null;
  const accepted = request.proposals.filter(p => decisions.get(p.id)?.decision === "accepted"), chosen = new Set(accepted.map(p => p.id));
  if (accepted.some(p => (p.dependencyProposalIds ?? []).some(id => !chosen.has(id)))) return null;
  return accepted;
}

function candidateEvidence(input: NativeBoardSceneInput, originals: NativeRecord[]) {
  const { baseline, candidate } = input;
  const empty = (state: "no-candidate" | "unmatched-revision" | "incompatible" | "record-mismatch", reason: string) => ({ state, reason, revisionId: null as string | null, accepted: [] as RepairProposal[], records: new Map<string, NativeRecord>() });
  if (!candidate) return empty("no-candidate", "No freshly parsed candidate is loaded.");
  if (!baseline || !verified(baseline) || !verified(candidate)) return empty("incompatible", "Verified original and candidate native record inventories are required.");
  const revisions = input.repair.history.filter(h => h.sourceSha256 === baseline.source.sha256 && h.candidateSha256 === candidate.source.sha256 && hash(h.packageSha256) && requestMatches(baseline, h.request));
  const revision = revisions.at(-1);
  if (!revision) return empty("unmatched-revision", "Candidate and original archive hashes do not match an exact saved repair revision.");
  if (revision.composition || candidate.selection.root !== baseline.selection.root || candidate.selection.job.member !== baseline.selection.job.member || candidate.selection.job.role !== "main" || candidate.nativeRecords.job.schemaVersionClaim !== baseline.nativeRecords.job.schemaVersionClaim || !equal(candidate.selection.master, baseline.selection.master) || !equal(candidate.nativeRecords.master, baseline.nativeRecords.master)) return empty("incompatible", "This placement-only confirmation requires the same main snapshot/schema and preserved Master; combined preparation needs its existing separate verification.");
  const accepted = acceptedProposals(revision.request);
  if (!accepted || !accepted.length) return empty("record-mismatch", "The saved revision has no valid complete accepted proposal subset.");
  const candidateRecords = candidate.nativeRecords.job.records, afterParts = candidateRecords.filter(r => r.kind === "part-record");
  const originalIds = countByIdentity(originals), afterIds = countByIdentity(afterParts);
  if (originals.length !== afterParts.length || originals.some(r => !completeIdentity(r) || originalIds.get(identityKey(r)) !== 1 || afterIds.get(identityKey(r)) !== 1)) return empty("record-mismatch", "Missing, repeated or added placement identities prevent exact candidate confirmation.");
  const expected = structuredClone(baseline.nativeRecords.job.records);
  const changedPaths = new Set<string>();
  for (const p of accepted) {
    const matches = originals.filter(r => sameIdentity(r, p.identity));
    if (matches.length !== 1 || !beforeMatches(matches[0], p) || changedPaths.has(p.path)) return empty("record-mismatch", "Candidate history contains stale before-values, identities, ROI guards or repeated scalar edits.");
    changedPaths.add(p.path);
    const target = expected.find(r => r.kind === "part-record" && r.sourcePath === matches[0].sourcePath)!;
    target.rawFields[supportedField(p, matches[0])!] = [p.after];
  }
  if (!equal(expected, candidateRecords)) return empty("record-mismatch", "Fresh candidate records do not equal the original records plus the exact accepted scalar subset.");
  const files = new Map(candidate.preservedFiles.map(f => [f.originalName, f]));
  if (files.size !== candidate.preservedFiles.length || files.size !== baseline.preservedFiles.length || !equal([...baseline.preservedDirectories].sort(), [...candidate.preservedDirectories].sort()) || baseline.preservedFiles.some(f => { const a = files.get(f.originalName); return !a || (f.path ?? f.originalName) !== (a.path ?? a.originalName) || ((f.path ?? f.originalName) !== baseline.selection.job.member && (a.sha256 !== f.sha256 || a.size !== f.size)); })) return empty("record-mismatch", "An unrelated asset, Temp/backup payload or directory differs from the original.");
  return { state: "confirmed" as const, reason: "Fresh candidate literals match the exact saved accepted edits; unrelated file hashes match. Full main-XML byte preservation still requires the existing guarded reproduction check. Literal read-back is not Eagle or physical validation.", revisionId: revision.id, accepted, records: new Map(afterParts.map(r => [identityKey(r), r])) };
}

function counts(placements: NativeBoardPlacement[]): NativeBoardCounts {
  const count = (predicate: (r: NativeBoardPlacement) => boolean) => placements.filter(predicate).length;
  return { total: placements.length, eligible: count(r => !!r.entity), invalid: count(r => !r.entity), outliers: count(r => r.status.outlier), unreviewed: count(r => r.status.review === "unreviewed"), pending: count(r => r.status.review === "pending"), accepted: count(r => r.status.review === "accepted"), rejected: count(r => r.status.review === "rejected"), mixed: count(r => r.status.review === "mixed"), stale: count(r => r.status.review === "stale"), proposed: count(r => r.status.proposed), written: count(r => r.status.written), preserved: count(r => r.status.preserved), analyzed: count(r => r.status.analyzed), held: count(r => r.status.held), machineVerified: 0 };
}

/**
 * A presentation adapter over complete fresh native records, existing reviews and
 * candidate receipts. No event input, event count, image, or saved scene can make
 * a component analyzed, written, physically correct, taught or machine-verified.
 * Coordinates are literal native Roi/cx, Roi/cy; no translation/mirror/rotation
 * is applied. Module scopes are kept separate and native side stays unqualified.
 */
export function buildNativeBoardScene(input: NativeBoardSceneInput) {
  const { baseline, repair, selection, sourceContext } = input;
  const records = baseline?.nativeRecords.job?.status === "recorded" ? baseline.nativeRecords.job.records.filter(r => r.kind === "part-record") : [];
  const originals = nativeEntities(baseline), entityByPath = new Map(originals.map(e => [e.path, e]));
  const candidateEntities = new Map(nativeEntities(input.candidate).map(e => [e.path, e]));
  const candidate = candidateEvidence(input, records), idCounts = countByIdentity(records);
  const pathCounts = new Map<string, number>();
  for (const r of records) pathCounts.set(r.sourcePath, (pathCounts.get(r.sourcePath) ?? 0) + 1);
  const fresh = !!baseline && !!repair.request && repairIsFresh(repair, baseline, selection, sourceContext) && requestMatches(baseline, repair.request) && selection?.root === baseline.selection.root && selection.masterMember === (baseline.selection.master?.member ?? null) && selection.masterRole === (baseline.selection.master?.role ?? null);
  const groups = repair.request ? repairProposalGroups(repair.request) : [];
  const diagnosis = input.diagnosis?.source.archiveSha256 === baseline?.source.sha256 && input.diagnosis?.source.jobSha256 === baseline?.selection.job.sha256 ? input.diagnosis : null;
  const placements: NativeBoardPlacement[] = records.map((record, index) => {
    const id = identity(record), reasons: string[] = [], rawEntity = coordinateLiteral(scalar(record, "Roi/cx")) && coordinateLiteral(scalar(record, "Roi/cy")) ? entityByPath.get(record.sourcePath) : undefined;
    const moduleValid = /^\d+$/.test(id.ParentId), unambiguous = completeIdentity(record) && idCounts.get(identityKey(record)) === 1 && pathCounts.get(record.sourcePath) === 1;
    if (!rawEntity) reasons.push("Missing, repeated, non-finite or unsupported native Roi/cx or Roi/cy; the record remains accounted for.");
    if (!moduleValid) reasons.push("Native module identity is missing or not a supported numeric literal; coordinate scope is held.");
    if (!unambiguous) reasons.push("Stable native identity or source path is missing/repeated; proposal and candidate matching are held.");
    const entity = rawEntity && moduleValid && pathCounts.get(record.sourcePath) === 1 ? rawEntity : null;
    const scope = entity ? scopeKey(entity.module, entity.side) : moduleValid ? scopeKey(id.ParentId, "native side unqualified") : JSON.stringify(["unresolved native module", record.sourcePath, index]);
    const key = entity?.key ?? JSON.stringify([baseline?.source.sha256, baseline?.selection.job.sha256, record.sourcePath, id, index]);
    const matching = groups.filter(g => g.some(p => p.path.startsWith(`${record.sourcePath}/`) && sameIdentity(record, p.identity)));
    const all = matching.flat(), exact = unambiguous && new Set(all.map(p => p.path)).size === all.length && all.every(p => beforeMatches(record, p));
    let review: NativeBoardReview = "unreviewed", group: RepairProposal[] = [];
    if (all.length) {
      if (!fresh || !exact) { review = "stale"; reasons.push("Proposal source, exact identity, before-value or ROI guard is stale/incompatible."); }
      else {
        group = all;
        const states = new Set(all.map(p => { const d = repair.request!.acceptances.filter(a => a.proposalId === p.id); return d.length === 1 ? d[0].decision : "pending"; }));
        review = states.size === 1 ? [...states][0] : "mixed";
        if (review === "mixed") reasons.push("Connected proposal decisions are incomplete; the writer retains its atomic acceptance guards.");
      }
    }
    const proposedEntity = entity && group.length ? previewEntity(entity, group) : null;
    const finding = diagnosis?.rows.find(r => r.sourcePath === record.sourcePath && sameIdentity(record, r.identity) && roiKeys.every(k => scalar(record, `Roi/${k}`) === r.beforeRoi[k]));
    if (finding) reasons.push(...finding.holds.map(h => `${h.code}: ${h.message}`), ...finding.dependencyHolds.map(h => `${h.code}: ${h.message}`));
    const duplicate = baseline?.nativeDuplicateReview;
    if (baseline && duplicate?.sourceContext && duplicate.sourceContext.archiveSha256 === baseline.source.sha256 && duplicate.sourceContext.snapshotId === baseline.snapshotId && duplicate.groups.some(g => g.candidates.some(c => c.sourcePath === record.sourcePath && keys.every(k => c.identityLiterals[k]?.length === 1 && c.identityLiterals[k][0] === id[k])))) reasons.push("A fresh duplicate-placement comparison includes this exact record; a shared reference is not authority to merge or suppress it.");
    const afterRecord = candidate.records.get(identityKey(record));
    const writtenChanges = afterRecord ? candidate.accepted.filter(p => sameIdentity(record, p.identity)) : [];
    const candidateEntity = afterRecord ? candidateEntities.get(afterRecord.sourcePath) ?? null : null;
    return { key, sourcePath: record.sourcePath, identity: id, scope, entity, candidateEntity, proposedEntity, literals: record.rawFields, proposalGroup: group, writtenChanges,
      status: { review, proposed: !!proposedEntity, accepted: review === "accepted", written: writtenChanges.length > 0, preserved: !!afterRecord && !writtenChanges.length && equal(record, afterRecord), analyzed: !!finding, held: reasons.length > 0, outlier: false, machineVerified: false }, reasons };
  });
  const scopeGroups = new Map<string, NativeBoardPlacement[]>();
  for (const p of placements) scopeGroups.set(p.scope, [...(scopeGroups.get(p.scope) ?? []), p]);
  const scopes = [...scopeGroups].map(([key, rows]) => {
    const entities = rows.flatMap(r => r.entity ? [r.entity] : []), fitted = fitEntities(entities);
    // The same robust fit already used by the canvas classifies display outliers.
    // It never removes them from entities, accounting, or fit-all bounds.
    if (fitted.excluded) {
      const limits = (axis: "x" | "y") => { const sorted = entities.map(e => e[axis]).sort((a, b) => a - b), lo = sorted[Math.floor((sorted.length - 1) * .25)], hi = sorted[Math.floor((sorted.length - 1) * .75)], span = Math.max(hi - lo, 1); return [lo - 4 * span, hi + 4 * span]; };
      const [xmin, xmax] = limits("x"), [ymin, ymax] = limits("y");
      for (const row of rows) if (row.entity && (row.entity.x < xmin || row.entity.x > xmax || row.entity.y < ymin || row.entity.y > ymax)) { row.status.outlier = true; row.status.held = true; row.reasons.push("Coordinate outlier excluded from the robust view fit; retained at its literal position. Use fit all or select it to inspect."); }
    }
    return { key, module: rows[0].identity.ParentId, side: "native side unqualified", counts: counts(rows), camera: fitted.camera, allCamera: fitEntities(entities, true).camera };
  });
  const byKey = new Map<string, NativeBoardPlacement>();
  for (const p of placements) { byKey.set(p.key, p); if (p.candidateEntity) byKey.set(p.candidateEntity.key, p); }
  return { frame: "native-roi-unqualified" as const, placements, entities: placements.flatMap(p => p.entity ? [p.entity] : []), byKey, scopes, counts: counts(placements), candidateState: candidate.state, candidateProofLevel: candidate.state === "confirmed" ? "literal-readback" as const : "none" as const, candidateReason: candidate.reason, candidateRevisionId: candidate.revisionId, holds: baseline && !verified(baseline) ? ["Complete verified native record inventory is unavailable."] : [] };
}
