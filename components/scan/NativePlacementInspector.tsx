"use client";

import type { NativeBoardPlacement } from "@/lib/scan/native-board-scene";
import type { SnapshotPreflight } from "@/lib/scan/archive-types";
import styles from "./VisualWorkspace.module.css";

const fmt = (n: number) => Number(n.toFixed(6)).toString();
/** Read-only projection of existing snapshot, review and candidate evidence. */
export function NativePlacementInspector({ row, baseline, candidate, inspectReview, returnToBoard }: {
  row: NativeBoardPlacement; baseline?: SnapshotPreflight; candidate?: SnapshotPreflight;
  inspectReview: () => void; returnToBoard: () => void;
}) {
  const original = row.entity, proposed = row.proposedEntity, after = row.candidateEntity;
  const edits = row.proposalGroup.length ? row.proposalGroup : row.writtenChanges;
  const changed = new Set(edits.map(p => p.path.slice(row.sourcePath.length + 1)));
  const scalar = (name: string) => row.literals[name]?.join(" | ") ?? "not recorded";
  const module = baseline?.nativeRecords.job?.records.find(r => r.kind === "module-record" && r.rawFields.ID?.[0] === row.identity.ParentId);
  return <div className={styles.detail} aria-label="Selected placement">
    <div className={styles.componentHeading}><h3>{row.identity.RefID} <small>Part {row.identity.ID} · Master {row.identity.MasterKey}</small></h3><button onClick={returnToBoard}>Return to board</button></div>
    <p className={styles.muted}>Module {row.identity.ParentId} · TB literal {module?.rawFields.TB?.join(" | ") ?? "missing"} · side unqualified</p>
    <div className={styles.stateBadges} aria-label="Selected engineering state">
      <span>Proposal: {row.status.proposed ? "available" : "none"}</span>
      <span data-testid="selected-review-state">Review: {row.status.review}</span>
      <span data-testid="selected-write-state">Candidate: {row.status.written ? "written · literal read-back" : row.status.preserved ? "record literals unchanged" : "unconfirmed"}</span>
    </div>
    {original && <table className={styles.geometryTable} aria-label="Original proposed coordinates"><thead><tr><th>Native ROI</th><th>Original</th><th>Proposed</th><th>Δ</th></tr></thead><tbody>{(["x", "y"] as const).map(axis => <tr key={axis}><th>{axis.toUpperCase()}</th><td>{fmt(original[axis])}</td><td>{proposed ? fmt(proposed[axis]) : "—"}</td><td>{proposed ? fmt(proposed[axis] - original[axis]) : "—"}</td></tr>)}</tbody></table>}
    {original && proposed && <p data-testid="placement-displacement">Displacement {fmt(Math.hypot(proposed.x - original.x, proposed.y - original.y))} native units. Vector connects literal ROI centers; physical correctness remains unverified.</p>}
    {after && <p>Candidate read-back: ({fmt(after.x)}, {fmt(after.y)}). {row.status.written ? "Matches the recorded revision." : "Unchanged parsed placement record."}</p>}
    {edits.length > 0 && <><h3>Exact changed fields</h3>{edits.map(p => <p key={p.id}><code>{p.path.slice(row.sourcePath.length + 1)}</code> {p.before} → <strong>{p.after}</strong></p>)}<button className={styles.primary} onClick={inspectReview}>Inspect exact proposal</button></>}
    <details><summary>Preserved fields & outstanding work</summary><dl>{["Roi/cx", "Roi/cy", "Roi/w", "Roi/h", "Roi/a", "CenterPosX", "CenterPosY", "ENABLE", "MasterKey"].filter(k => !changed.has(k)).map(k => <div key={k}><dt>{k}</dt><dd>{scalar(k)}</dd></div>)}</dl><p>Placement-only edits retain Master, windows, bindings, FOV and teaching. Parsed read-back is separate from the guarded writer's full byte-preservation test. ENABLE is a retained literal, not inspection readiness.</p></details>
    <p className={styles.heldText}>Eagle verification pending: placement retention, dependent-window geometry, bindings and FOV coverage. No machine validation is established.</p>
    {row.reasons.map((reason, index) => <p className={styles.heldText} key={index}>{reason}</p>)}
    <details><summary>Snapshot & exact evidence</summary><p className={styles.hash}>{baseline?.selection.job.member}<br />Archive SHA-256 {baseline?.source.sha256}<br />Job SHA-256 {baseline?.selection.job.sha256}<br />Master SHA-256 {baseline?.selection.master?.sha256 ?? "absent"}<br />Candidate SHA-256 {candidate?.source.sha256 ?? "absent"}</p><code className={styles.hash}>{row.sourcePath}</code><p>Identity: module {row.identity.ParentId}, RefID {row.identity.RefID}, Part ID {row.identity.ID}, MasterKey {row.identity.MasterKey}.</p></details>
  </div>;
}
