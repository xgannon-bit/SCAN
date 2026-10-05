"use client";
import { NativeInspectionWork } from "./NativeInspectionWork";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import { componentCoverageCsv, remainingNativeWorkCsv } from "@/lib/scan/native-accounting";
import { downloadJson } from "@/lib/scan/review-session";
import type { NativeLiteralBindings } from "@/lib/scan/archive-types";

export function NativeBindingDetails({ report }: { report: NativeLiteralBindings }) {
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const counts = report.counts;
  const matches = report.bindings.filter(binding => `${binding.partSourcePath} ${binding.rawSegment}`.toLowerCase().includes(filter.toLowerCase()));
  function save() {
    try { downloadJson(report, "native-literal-bindings.json"); setNotice("Literal binding observations exported with exact source hashes and snapshot choices. Ownership remains unknown."); }
    catch { setNotice("Binding observations could not be exported; your current review is retained."); }
  }
  return <section aria-labelledby="native-bindings-heading">
    <h3 id="native-bindings-heading">Native window and pad links</h3>
    <p>These are literal source comparisons. Physical pad ownership, native dependencies and Eagle compatibility remain unqualified. No repair proposals or native edits are generated.</p>
    <Button onClick={save} variant="outline">Download native bindings (.json)</Button>
    {notice && <p role="status">{notice}</p>}
    <details><summary>Verified source and snapshot choices</summary>
      <p className="break-all">Archive SHA-256: {report.sourceContext.archiveSha256}</p>
      <p className="break-all">Capture SHA-256: {report.sourceContext.packageSha256}</p>
      <p className="break-all">Snapshot ID: {report.sourceContext.snapshotId}</p>
      <p className="break-words">Root: {report.sourceContext.selection.root}</p>
      {(["job", "master"] as const).map(role => {
        const selected = report.sourceContext.selection[role];
        return <div key={role}><p className="break-words">{role === "job" ? "Job" : "Master"}: {selected ? `${selected.role} · ${selected.member}` : "Explicitly not selected"}</p>{selected && <p className="break-all">SHA-256: {selected.sha256}</p>}</div>;
      })}
    </details>
    {report.status !== "recorded" ? <p role="status">{report.reason ?? "Literal binding observations are unavailable."}</p> : <>
      <p>{counts?.sixFieldSegments ?? 0} six-field tuples · {counts?.windowMatches["unique-literal-match"] ?? 0} unique window literal matches · {counts?.padMatches["unique-literal-match"] ?? 0} unique pad literal matches.</p>
      <p>{(counts?.coordinateComparisons["literal-pair-equal"] ?? 0) + (counts?.coordinateComparisons["decimal-equal-text-differs"] ?? 0)} tuple XY pairs equal pad.C numerically. This equality does not establish units, a common frame or ownership.</p>
      {!counts?.masterDocumentAvailable && <p>The selected Master has no supported record inventory. Window comparisons are unavailable, not assumed to be missing links.</p>}
      <p>{counts?.["missing-scalar"] ?? 0} parts lack WND_PAD · {counts?.["repeated-scalar"] ?? 0} contain repeated WND_PAD fields · {counts?.unsupportedTokenCount ?? 0} segments have an unsupported token count.</p>
      <details><summary>Literal comparison rules and limits</summary>{Object.entries(report.scopeRules ?? {}).map(([name, rule]) => <p key={name}>{name}: {rule}</p>)}{report.limitations?.map(limit => <p key={limit}>{limit}</p>)}</details>
      <label className="scan-field">Find a binding source path or literal<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <p>{matches.length} matching binding segments. Showing {Math.min(50, matches.length)}; the JSON download retains all observed segments and exact raw fields.</p>
      {matches.slice(0, 50).map(binding => <details key={`${binding.partSourcePath}:${binding.segmentOrdinal}`}>
        <summary className="break-words">{binding.partSourcePath} · WND_PAD segment {binding.segmentOrdinal}</summary>
        <p>State: {binding.state} · Ownership: {binding.ownership}</p>
        <p className="break-all">Raw segment: {JSON.stringify(binding.rawSegment)}</p>
        <p>Window comparison: {binding.window?.state ?? "Not interpreted"} · Pad comparison: {binding.pad?.state ?? "Not interpreted"}</p>
        {(["window", "pad"] as const).map(kind => binding[kind] && <div key={kind}><p className="break-words">{kind} source literals: {JSON.stringify(binding[kind].sourceLiterals)}</p><p className="break-words">Matched paths: {binding[kind].targetSourcePaths.join(" · ") || "None"}</p>{binding[kind].omittedTargetCount > 0 && <p>{binding[kind].omittedTargetCount} additional targets counted; the bounded report retains five path examples.</p>}</div>)}
        <p>XY comparison: {binding.coordinateComparison?.state ?? "Not interpreted"}</p>
        {binding.coordinateComparison && <p className="break-words">Tuple XY: {JSON.stringify(binding.coordinateComparison.tupleXYLiterals)} · pad.C: {JSON.stringify(binding.coordinateComparison.padCenterLiterals)}</p>}
        {!!binding.sentinelLikeLiterals?.length && <p>Sentinel-like source strings, meaning unknown: {JSON.stringify(binding.sentinelLikeLiterals)}</p>}
      </details>)}
      <details><summary>Literal binding observations ({report.findings.length})</summary>
        <p>Showing {Math.min(100, report.findings.length)} observations; download the report for every source path. These observations do not determine whether a repair is needed.</p>
        {report.findings.slice(0, 100).map((finding, index) => <div key={index}><p>{finding.code}: {finding.message}</p><p className="break-words">{finding.sourcePath}{finding.segmentOrdinal === null ? "" : ` · segment ${finding.segmentOrdinal}`}</p></div>)}
      </details>
      {report.padCadRelationExperiment && <details><summary>Separate PartNo / CAD.ID relation experiment — ownership unknown</summary>
        <p>{report.padCadRelationExperiment.interpretation}</p>
        <p>Candidate join counts: {JSON.stringify(report.padCadRelationExperiment.padJoinCounts)}</p>
        <p>Experimental reference comparisons: {JSON.stringify(report.padCadRelationExperiment.boundPartReferenceComparisonCounts)}</p>
        <p>Reference differences here are not defect findings. No component ownership or repair decision follows from this experiment.</p>
      </details>}
    </>}
  </section>;
}

export function NativeAccounting() {
  const { archiveReview } = useScanSession();
  const report = archiveReview?.preflight.nativeAccounting;
  const bindings = archiveReview?.preflight.nativeBindings;
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState("");
  const groups = useMemo(() => new Map(report?.correspondenceGroups.map(g => [g.id, g])), [report]);
  const instances = useMemo(() => new Map(report?.nativeInstances.map(p => [p.id, p])), [report]);
  const coordinateChecks = useMemo(() => {
    const index = new Map<string, NonNullable<typeof report>["coordinateComparisons"]>();
    for (const check of report?.coordinateComparisons ?? []) index.set(check.partSourcePath, [...(index.get(check.partSourcePath) ?? []), check]);
    return index;
  }, [report]);
  const ungrouped = report?.findings.filter(f => !f.groupId && `${f.message} ${f.sourcePaths.join(" ")}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  if (!report) return bindings ? <NativeBindingDetails report={bindings} /> : null;
  const matches = report.componentCoverage.filter(row => `${row.moduleLiteral ?? ""} ${row.referenceLiteral ?? ""} ${row.sourcePath} ${row.nativeCorrespondence}`.toLowerCase().includes(filter.toLowerCase()));
  function save(kind: "coverage" | "work" | "findings") {
    try {
      if (!report) return;
      if (kind === "findings") downloadJson(report, "native-accounting.json");
      else {
        const url = URL.createObjectURL(new Blob([kind === "coverage" ? componentCoverageCsv(report) : remainingNativeWorkCsv(report)], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = kind === "coverage" ? "component_coverage.csv" : "remaining_work.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice("Accounting exported. Native preparation and machine verification remain unresolved.");
    } catch { setNotice("Export could not be prepared; your current review is retained."); }
  }
  return <section className="scan-panel scan-panel-body" aria-labelledby="native-accounting-heading">
    <h2 id="native-accounting-heading">Native component accounting</h2>
    <p>Selected snapshot: {archiveReview?.preflight.selection.job.role} · {archiveReview?.preflight.selection.job.member}</p>
    {report.status !== "recorded" ? <p role="status">{report.reason}</p> : <>
      <p>{report.counts?.cadRows} native CAD rows · {report.counts?.nativePartInstances} native placement records · {report.counts?.nativeOnlyRows} placement records without a CAD match. Each source row is retained; this does not establish the intended BOM population.</p>
      <p>Native edits applied: 0. Source ENABLE values are shown literally; teaching, preparation and verification are assessed separately and remain unqualified.</p>
      <div className="scan-actions"><Button onClick={() => save("coverage")} variant="outline">Download component accounting (.csv)</Button><Button onClick={() => save("work")} variant="outline">Download remaining native work (.csv)</Button><Button onClick={() => save("findings")} variant="outline">Download native accounting (.json)</Button></div>
      {notice && <p role="status">{notice}</p>}
      <h3>Resolve shared issues once</h3>
      {report.sharedBlockers.map(b => <details key={b.id}><summary>{b.reason} ({b.affectedRowIds.length} accounting rows)</summary><p>{report.remainingWork.find(w => w.blockerId === b.id)?.nextAction}</p><p>Scope: {b.scope}{b.moduleLiteral ? ` · module literal ${b.moduleLiteral}` : ""}</p></details>)}
      {!!report.coordinateComparisons?.length && <details><summary>Whole-board coordinate evidence</summary>
        <p>{report.coordinateComparisons.length} numeric comparisons. These retain raw fields and unavailable comparisons; they do not count as diagnosed defects or completed preparation.</p>
        <p>Resolve the shared coordinate-frame prerequisite before interpreting a numeric offset as a physical movement. Do not move CAD to hide misplaced inspections.</p>
        <p>{report.coordinatePatterns?.length ?? 0} repeated nonzero patterns across distinct reference literals within one uniquely identified module. Exact comparisons use no tolerance or inferred units.</p>
        {report.coordinatePatterns?.slice(0, 50).map(pattern => <details key={pattern.id}>
          <summary>Module {pattern.moduleLiteral} · {pattern.relation} · X={pattern.deltaXY[0]}, Y={pattern.deltaXY[1]} · {pattern.referenceLiterals.length} references</summary>
          <p>{pattern.interpretation}</p><p className="break-words">References: {pattern.referenceLiterals.slice(0, 100).join(", ")}</p>
          {pattern.referenceLiterals.length > 100 && <p>Showing 100 references; download accounting JSON for all affected records.</p>}
        </details>)}
        {(report.coordinatePatterns?.length ?? 0) > 50 && <p>Showing 50 patterns; download accounting JSON for all patterns.</p>}
      </details>}
      <label className="scan-field">Find native component or source path<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <p>{matches.length} accounting rows match. Showing {Math.min(100, matches.length)}; exports contain all rows.</p>
      {matches.slice(0, 100).map(row => {
        const group = groups.get(row.groupId ?? "");
        const parts = (group?.nativeInstanceIds ?? [row.recordId]).flatMap(id => instances.get(id) ?? []);
        return <details key={row.id}><summary>{row.moduleLiteral ?? "Unknown module"} / {row.referenceLiteral ?? "Unknown reference"} · {row.nativeCorrespondence}</summary>
          <p>{row.sourcePath}</p><p>Native IDs: {parts.slice(0, 50).flatMap(p => p.nativeIdLiterals).join(", ") || "None established"}</p><p>Raw ENABLE: {parts.slice(0, 50).map(p => p.enableLiterals.join(" | ")).join(" ; ") || "Missing"}</p>{parts.length > 50 && <p>Showing 50 of {parts.length} linked native instances. Download accounting for every exact member.</p>}
          <p>Prepared: {row.nativePreparation} · Existing teaching: {row.existingTeaching} · Exclusion: {row.exclusion} · Verification: {row.verification} · Release: {row.release}</p>
          <details><summary>Placement coordinate evidence</summary>
            <p>These compare numeric fields inside the selected job. Units, coordinate frames and component origins remain unqualified. Equal numbers do not prove correct geometry; differences do not authorize corrections.</p>
            {parts.slice(0, 50).flatMap(part => coordinateChecks.get(part.sourcePath) ?? []).map(check => <div key={check.id}>
              <p>{check.relation}: {check.state}{check.deltaXY ? ` · X=${check.deltaXY[0]}, Y=${check.deltaXY[1]}` : ` · ${check.unavailableReason}`}</p>
              <p className="break-words">Left: {check.left.sourcePath} · {check.left.fields.join(", ")} · {JSON.stringify(check.left.literals)}</p>
              <p className="break-words">Right: {check.right.sourcePath ?? "No unique correspondence"} · {check.right.fields.join(", ")} · {JSON.stringify(check.right.literals)}</p>
            </div>)}
            {parts.length > 50 && <p>Showing coordinate checks for 50 placements; download accounting JSON for all comparisons.</p>}
          </details>
          {report.findings.filter(f => f.groupId ? f.groupId === row.groupId : f.sourcePaths.includes(row.sourcePath) || parts.some(p => f.sourcePaths.includes(p.sourcePath))).map(f => <div key={f.id}><p>{f.message}</p><p>Next: {report.remainingWork.find(w => w.findingId === f.id)?.nextAction}</p></div>)}
        </details>;
      })}
      <h3>Observations outside a resolved component group</h3>
      <p>{ungrouped.length} matching observations. Showing {Math.min(100, ungrouped.length)}; downloads retain every evidence path.</p>
      {ungrouped.slice(0, 100).map(f => <details key={f.id}><summary>{f.code} · {f.message}</summary><p>Next: {report.remainingWork.find(w => w.findingId === f.id)?.nextAction}</p><ul>{f.sourcePaths.slice(0, 50).map(path => <li key={path}>{path}</li>)}</ul>{f.sourcePaths.length > 50 && <p>Showing 50 of {f.sourcePaths.length} paths; download the JSON for all evidence.</p>}</details>)}
    </>}
    {bindings && <NativeBindingDetails report={bindings} />}
    <NativeInspectionWork report={archiveReview?.preflight.nativeInspectionWork} />
  </section>;
}
