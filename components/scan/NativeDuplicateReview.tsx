"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadJson } from "@/lib/scan/review-session";
import { duplicateDecision, duplicateReviewExport, recordDuplicateDecision, type DuplicateCandidate, type DuplicateDecision, type DuplicatePair, type FieldComparison, type NativeDuplicateReview as Report } from "@/lib/scan/native-duplicate-review";
import { useScanSession } from "./ScanSession";

function Differences({ label, value }: { label: string; value: FieldComparison | null }) {
  return <details><summary>{label}: {value ? `${value.changedFieldCount} differing observed fields` : "unresolved"}</summary>
    {value?.examples.map(row => <p className="break-words" key={row.field}><strong>{row.field}</strong>: left <code>{row.left ?? "absent"}</code> · right <code>{row.right ?? "absent"}</code></p>)}
    {!!value?.omittedExampleCount && <p>{value.omittedExampleCount} additional differing fields are represented by exact record digests. Review the source records before choosing a survivor.</p>}
  </details>;
}

function Candidate({ value, side }: { value: DuplicateCandidate; side: string }) {
  const id = (key: string) => value.identityLiterals[key]?.join(" | ") || "missing";
  return <div className="rounded border border-slate-700 p-3">
    <h4>{side} · part {id("ID")} · Master {id("MasterKey")}</h4>
    <p>Enabled literal: {value.enabledLiterals.join(" | ") || "missing"}. Master relation: {value.master.state}. {value.master.windows ?? "Unknown"} windows · {value.master.algorithms ?? "Unknown"} algorithm records.</p>
    {!value.identityUnambiguous && <p>Placement identity is missing or ambiguous; survivor preference is held.</p>}
    <p>Master scope is used by {value.master.sharedUsage.length} placements. Existing algorithms are recorded teaching, with quality unverified.</p>
    <details><summary>Placement geometry, module frame and all affected shared placements</summary><pre>{JSON.stringify({ placementGeometry: value.geometry, moduleState: value.moduleState, moduleLiterals: value.moduleLiterals }, null, 2)}</pre>{value.master.sharedUsage.map(row => <p className="break-words" key={row.sourcePath}>{row.identityLiterals.RefID?.join(" | ")} · module {row.identityLiterals.ParentId?.join(" | ")} · part {row.identityLiterals.ID?.join(" | ")} · {row.sourcePath}</p>)}</details>
    <details><summary>Window geometry, binding literals and FOV</summary><pre>{JSON.stringify({ bindings: value.bindings, fov: value.fov, windows: value.windows }, null, 2)}</pre></details>
  </div>;
}

function Pair({ report, pair, candidates }: { report: Report; pair: DuplicatePair; candidates: DuplicateCandidate[] }) {
  const { repair, setRepair } = useScanSession();
  const saved = duplicateDecision(report, pair, repair.work);
  const [disposition, setDisposition] = useState<DuplicateDecision["disposition"]>(saved?.disposition ?? "needs-evidence");
  const [reviewer, setReviewer] = useState(saved?.reviewer ?? "");
  const [reason, setReason] = useState(saved?.reason ?? "");
  const [notice, setNotice] = useState("");
  const left = candidates.find(item => item.sourcePath === pair.leftPath)!;
  const right = candidates.find(item => item.sourcePath === pair.rightPath)!;
  return <div className="space-y-3 border-t border-slate-700 pt-3">
    <p><strong>Part {left.identityLiterals.ID?.join(" | ")} compared with {right.identityLiterals.ID?.join(" | ")}</strong>. {pair.sameMasterLiteral ? "Both point to the same literal Master scope." : "These point to different Master scopes; compare teaching before preferring either."}</p>
    <div className="grid gap-3 lg:grid-cols-2"><Candidate value={left} side="Left" /><Candidate value={right} side="Right" /></div>
    {Object.entries(pair.comparisons).map(([label, value]) => <Differences key={label} label={label} value={value} />)}
    <details><summary>Window and algorithm parameter comparison</summary><p>Only unique matching Name + GroupID literals are compared side by side. This is not qualified role equivalence. Native IDs are retained separately.</p>
      {pair.windowComparisons.map(window => <details key={`${window.leftPath}:${window.rightPath}`}><summary>{window.nameLiteral} / group {window.groupIdLiteral}: geometry {window.geometry.changedFieldCount} · algorithm parameters {window.algorithmParameters.changedFieldCount} · window links {window.dependencies.changedFieldCount} differences</summary><Differences label="Local geometry" value={window.geometry} /><Differences label="Algorithm parameters (algorithm IDs excluded)" value={window.algorithmParameters} /><Differences label="Dependent-window links" value={window.dependencies} /><Differences label="All observed fields" value={window.comparison} /></details>)}
      <p>Windows without an unambiguous paired role: left {pair.unmappedWindowCount[0]}, right {pair.unmappedWindowCount[1]}.</p>
      {!!pair.unpairedWindowRoles.length && <pre>{JSON.stringify(pair.unpairedWindowRoles, null, 2)}</pre>}
    </details>
    <p><strong>Suppression held:</strong> {pair.holds.join(" · ")}</p><p>{pair.nextAction}</p>
    <label className="scan-field">Duplicate review disposition<select value={disposition} onChange={event => setDisposition(event.target.value as DuplicateDecision["disposition"])}><option value="needs-evidence">Needs specific evidence</option><option value="retain-both">Retain both for distinct purposes</option><option value="prefer-left" disabled={!left.identityUnambiguous || !right.identityUnambiguous}>Prefer left after offline comparison</option><option value="prefer-right" disabled={!left.identityUnambiguous || !right.identityUnambiguous}>Prefer right after offline comparison</option></select></label>
    <label className="scan-field">Duplicate reviewer<input maxLength={128} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label>
    <label className="scan-field">Survivor reason or exact missing evidence<textarea maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <Button variant="outline" onClick={() => { try { const work = recordDuplicateDecision(report, pair, { disposition, reviewer: reviewer.trim(), reason: reason.trim() }, repair.work); setRepair(old => ({ ...old, work })); setNotice("Comparison decision saved with this exact evidence. No placement was suppressed or teaching changed."); } catch (error) { setNotice(error instanceof Error ? error.message : "Decision could not be saved."); } }}>Save duplicate review decision</Button>
    {saved && <p>Saved: {saved.disposition} · {saved.reviewer}. Save the SCAN project to retain this review after closing.</p>}
    {notice && <p role="status">{notice}</p>}
  </div>;
}

export function NativeDuplicateReview({ report }: { report?: Report }) {
  const { repair } = useScanSession();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  if (!report) return null;
  const output = duplicateReviewExport(report, repair.work);
  const groups = report.groups.filter(group => `${group.reference} ${group.module}`.toLowerCase().includes(filter.toLowerCase()));
  return <section aria-labelledby="duplicate-review-heading" className="scan-card space-y-3">
    <h2 id="duplicate-review-heading">Compare duplicate placements</h2>
    <p>{report.reason}</p><p>{report.interpretation}</p>
    {report.status === "recorded" && <>
      <p>{report.counts?.duplicateScopes} duplicate reference/module scopes · {report.counts?.pairComparisons} pair comparisons. {report.counts?.unscopedPlacements} placements have unresolved reference/module identity.</p>
      <p>Choose an evidence-backed preference, retain both, or record the exact missing evidence. These decisions do not disable or delete placements. Unknown suppression side effects and preserved teaching still require controlled qualification.</p>
      {!!output.staleDecisions.length && <p role="status">{output.staleDecisions.length} earlier duplicate decisions do not match the current evidence and are inactive.</p>}
      <label className="scan-field">Find duplicate reference or module<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <Button variant="outline" onClick={() => { try { downloadJson(output, "duplicate-placement-review.json"); setNotice("Complete duplicate comparisons and current/stale decisions downloaded; no suppression authority included."); } catch { setNotice("Download could not be prepared."); } }}>Download duplicate comparisons and decisions</Button>
      {notice && <p role="status">{notice}</p>}
      {groups.map(group => <details key={group.digest} open={expanded === group.digest} onToggle={event => { if (event.currentTarget.open) setExpanded(group.digest); else setExpanded(old => old === group.digest ? null : old); }}>
        <summary>{group.reference} · module {group.module} · {group.candidates.length} placements · {group.pairs.filter(pair => duplicateDecision(report, pair, repair.work)).length} reviewed pairs</summary>
        {expanded === group.digest && group.pairs.map(pair => <Pair key={pair.digest} report={report} pair={pair} candidates={group.candidates} />)}
      </details>)}
    </>}
  </section>;
}
