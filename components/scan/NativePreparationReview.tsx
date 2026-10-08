"use client";
import Link from "next/link";
import { validatePackageProfiles } from "@/lib/scan/package-profiles";
import { previousPreparationDecisions } from "@/lib/scan/native-preparation-session";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import { evaluationBundle } from "@/lib/scan/evaluation-bundle";
import { buildSourceCrosswalk } from "@/lib/scan/source-crosswalk";
import { preparationWork, preparationWorkCsv, type PreparationAccounting, type PreparationBindingWork } from "@/lib/scan/preparation-work";
import { readCandidateWork } from "@/lib/scan/engineering-candidate-work";
import { buildOfflineReviewEvidence } from "@/lib/scan/offline-review-evidence";
import { compositionDecisionContext } from "@/lib/scan/composition-context";

type Item = { status: string; reference?: string; digest?: string; reason?: string; code?: string;
  selection: { targetSourcePath: string; moduleId: string; templatePartId: string; templateMasterKey: string };
  templateReference?: string; changes?: { document: string; container: string; afterXml: string }[];
  dependencies?: { partId: string; masterKey: string; windowIds: string[]; templateAlgorithmsNotTransferred: number; windowPreparation?: string; windowRoles?: { windowId: string; role: string; padNumber: string | null; pin: string | null; sourcePath: string | null }[]; omittedWindows?: PreparationAccounting["omittedWindows"] };
  basis?: { translationNativeUnits: number[]; originOffsetPreserved: boolean; geometryRoute?: string; nativeCadAngleDeltaDegrees?: number; sourceAngleDeltaDegrees?: number; storedCenterPolicy?: string; cathodeDirectionPatternAxes?: number[]; cathodeDirectionNativeBoardAxes?: number[] }; remaining?: string[] };
type Review = { status: "success"; artifactType: "scan.native-preparation-review"; digest: string;
  plan: { source: { jobSha256: string; masterSha256: string; layoutSha256: string }; items: Item[] };
  accounting: PreparationAccounting[]; padBindingWork?: PreparationBindingWork;
  preparationIntents?: { counts: { components: number; ownedTerminalBindingIntents: number }; sharedContracts: { id: string; required: string }[] } };

export function NativePreparationReview() {
  const session = useScanSession();
  const { archiveFile, archiveReview, selection, layout, nativePreparation: saved, setNativePreparation } = session;
  const [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [ack, setAck] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const scope = `${session.sourceContext}:${archiveReview?.capture.packageSha256}:${layout.result?.sourceSha256}:${JSON.stringify(saved.packageProfiles ?? [])}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const exportScope = `${scope}:${compositionDecisionContext(saved, session.repair.request)}`;
  const currentExportScope = useRef(exportScope); currentExportScope.current = exportScope;
  useEffect(() => { controller.current?.abort(); setBusy(false); setReview(null); setAck(false); return () => controller.current?.abort(); }, [scope]);
  const ready = review?.plan.items.filter(item => item.status === "ready-for-review") ?? [];
  const constructed = ready.filter(item => item.dependencies?.windowPreparation === "constructed-body-terminal-geometry");
  const partial = ready.filter(item => item.dependencies?.windowPreparation === "partial-closed-window-subset");
  const fresh = !!review && saved.review?.digest === review.digest && saved.review.sourceContext === session.sourceContext && saved.review.archiveSha256 === archiveReview?.preflight.source.sha256 && saved.review.layoutSha256 === layout.result?.sourceSha256;
  const accepted = fresh ? saved.review!.decisions.filter(item => item.decision === "accepted").map(item => item.digest) : [];
  const work = review ? preparationWork(review.accounting, review.plan.items, [], session.bom.result, archiveReview, review.padBindingWork) : null;
  const canReview = !!archiveFile && !!archiveReview && !!layout.file && !!layout.result && !!session.sourceContext && selection?.jobRole === "main" && selection.masterRole === "main";
  async function call(action: "draft-review" | "draft-export", extra: Record<string, unknown>, abort: AbortController) {
    if (!archiveFile || !archiveReview || !layout.file || !layout.result || !selection) throw new Error("Select and preflight the main job/Master and read the source layout first.");
    const form = new FormData(); form.set("file", archiveFile); form.set("layout", layout.file); form.set("action", action);
    form.set("expectedArchiveSha256", archiveReview.preflight.source.sha256); form.set("expectedPackageSha256", archiveReview.capture.packageSha256);
    form.set("selection", JSON.stringify(selection));
    const preparation: Record<string, unknown> = { layoutSha256: layout.result.sourceSha256, ...(saved.packageProfiles?.length ? { packageProfiles: saved.packageProfiles } : {}), ...extra };
    const repair = session.repair.request;
    if (action === "draft-export" && repair?.acceptances.some(a => a.decision === "accepted")) {
      if (repair.source.archiveSha256 !== archiveReview.preflight.source.sha256 || repair.source.jobSha256 !== archiveReview.preflight.selection.job.sha256 || repair.source.jobMember !== selection.jobMember || (session.repair.sourceContext && session.repair.sourceContext !== session.sourceContext)) throw new Error("Accepted scalar review is stale. Recheck it before composing this candidate; accepted changes will not be silently omitted.");
      const { acknowledgement: _acknowledgement, ...reviewedPreparation } = preparation;
      form.set("action", "repair-export");
      form.set("repair", JSON.stringify({ request: repair, preparation: reviewedPreparation, acknowledgement: "QUALIFICATION ONLY" }));
    } else form.set("draft", JSON.stringify(preparation));
    return fetch("/api/archive", { method: "POST", body: form, signal: abort.signal });
  }
  async function analyze() {
    if (!canReview) return;
    const start = scope, abort = new AbortController(); controller.current?.abort(); controller.current = abort; setBusy(true); setAck(false); setMessage("");
    try {
      const response = await call("draft-review", {}, abort); const value = await response.json();
      if (!response.ok || value.status !== "success" || value.artifactType !== "scan.native-preparation-review") throw new Error(value.reason ?? value.message ?? "Preparation review held.");
      if (abort.signal.aborted || currentScope.current !== start) return;
      const next = value as Review;
      if (next.plan.source.layoutSha256 !== layout.result!.sourceSha256 || next.plan.source.jobSha256 !== archiveReview!.preflight.selection.job.sha256 || next.plan.source.masterSha256 !== archiveReview!.preflight.selection.master?.sha256) throw new Error("Review source identities differ.");
      // Adding a package profile changes the plan receipt, not every unchanged
      // item. Retain only exact item decisions from these same captured sources.
      const prior = previousPreparationDecisions(saved, archiveReview!.preflight.source.sha256, layout.result!.sourceSha256);
      setNativePreparation(old => ({ ...old, review: { digest: next.digest, sourceContext: session.sourceContext!, archiveSha256: archiveReview!.preflight.source.sha256,
        layoutSha256: layout.result!.sourceSha256, decisions: next.plan.items.filter(i => i.status === "ready-for-review").map(i => ({ digest: i.digest!, reference: i.reference!, decision: prior.find(d => d.digest === i.digest && d.reference === i.reference)?.decision ?? "pending" })) } }));
      setReview(next); setMessage("Complete source-derived proposals recomputed. Review each part's exact appended records; original records remain unchanged.");
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Preparation review failed."); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  async function generate() {
    if (!fresh || !accepted.length || !ack || !saved.reviewer.trim() || saved.history.length >= 50) return;
    const start = exportScope, abort = new AbortController(); controller.current = abort; setBusy(true); setMessage("");
    try {
      const response = await call("draft-export", { reviewDigest: review!.digest, accepted, reviewer: saved.reviewer.trim(), acknowledgement: "QUALIFICATION ONLY" }, abort);
      if (!response.ok || !response.headers.get("content-type")?.includes("octet-stream")) { const value = await response.json(); throw new Error(value.reason ?? value.message ?? "Preparation export held."); }
      const blob = await response.blob(), packageSha256 = response.headers.get("X-SCAN-SHA256")!, candidateSha256 = response.headers.get("X-SCAN-Candidate-SHA256")!;
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
      if (actual !== packageSha256 || !/^[a-f0-9]{64}$/.test(candidateSha256) || response.headers.get("X-SCAN-Source-SHA256") !== archiveReview!.preflight.source.sha256) throw new Error("Downloaded candidate identity could not be verified.");
      const actualWork = await readCandidateWork(blob, candidateSha256, archiveReview!.preflight.source.sha256, review!.plan.items, accepted);
      if (abort.signal.aborted) return;
      if (currentExportScope.current !== start) throw new Error("Sources or exact reviewed decisions changed during export; no download or new history was recorded. Review and retry.");
      const id = crypto.randomUUID(); const history = { id, recordedAt: new Date().toISOString(), packageSha256, candidateSha256, review: structuredClone(saved.review!), reviewer: saved.reviewer.trim(), accepted, ...(saved.packageProfiles?.length ? { packageProfiles: structuredClone(saved.packageProfiles) } : {}) };
      const next = { ...saved, history: [...saved.history, history] };
      const scalarRequest = session.repair.request;
      const combined = !!scalarRequest?.acceptances.some(a => a.decision === "accepted");
      const nextRepair = combined ? { ...session.repair, history: [...session.repair.history, { id, recordedAt: history.recordedAt,
        sourceSha256: archiveReview!.preflight.source.sha256, packageSha256, candidateSha256, request: structuredClone(scalarRequest!),
        composition: { review: history.review, reviewer: history.reviewer, accepted, ...(history.packageProfiles ? { packageProfiles: history.packageProfiles } : {}) } }] } : session.repair;
      const project = await session.buildProjectBlob(nextRepair, next);
      const crosswalk = buildSourceCrosswalk(session.bom.result, session.result, archiveReview, session.comparisons.entries.map(item => ({ name: item.file.name, result: item.result })), layout.result);
      const candidateWork = { ...preparationWork(actualWork.accounting, review!.plan.items, accepted, session.bom.result, archiveReview, actualWork.bindingWork, actualWork.queue), candidateSha256, packageSha256 };
      const bundle = await evaluationBundle([{ name: "engineering-QUALIFICATION-ONLY.zip", blob }, { name: "SCAN.scan-project.json", blob: project },
        { name: "baseline-offline-review.json", blob: new Blob([JSON.stringify(await buildOfflineReviewEvidence(session), null, 2)]) },
        { name: "baseline-source-reconciliation.json", blob: new Blob([JSON.stringify(crosswalk, null, 2)]) },
        { name: "component-by-component-Eagle-work.json", blob: new Blob([JSON.stringify(candidateWork, null, 2)]) },
        { name: "component-by-component-Eagle-work.csv", blob: new Blob([preparationWorkCsv(candidateWork)]) },
        { name: "OPEN_FIRST.txt", blob: new Blob(["QUALIFICATION ONLY. New placements, local Masters and windows are disabled preparation, with empty bindings/FOV lists and algorithms. Open SCAN.scan-project.json to retain sources, exact decisions and candidate history; recompute preparation review before another export. The component-by-component Eagle work files distinguish engineering DNP, hole-bearing parts and populated SMT intent, identify creation/placement already prepared, exact native identities/windows and remaining teaching. Work-order population remains unapproved. Candidate component accounting and native inspection work are inside engineering-QUALIFICATION-ONLY.zip. Baseline reconciliation remains the original source state. Read START_HERE.txt there. Temp/backup contain original state. Eagle compatibility, binding, inspection and release remain unverified."]) }]);
      if (abort.signal.aborted) return;
      if (currentExportScope.current !== start) throw new Error("Sources or exact reviewed decisions changed during export; no download or new history was recorded. Review and retry.");
      setNativePreparation(next);
      if (combined) session.setRepair(nextRepair);
      const url = URL.createObjectURL(bundle), a = document.createElement("a"); a.href = url; a.download = `SCAN-PREPARED-PARTS-QUALIFICATION-${id.slice(0, 8)}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      setAck(false); setMessage(`${accepted.length} parts prepared as disabled placements, local Masters and linked windows in a separate complete native copy.${combined ? ` ${scalarRequest!.acceptances.filter(a => a.decision === "accepted").length} separately accepted scalar trials included in the same candidate.` : ""} ${candidateWork.counts.preparedWithPartialWindows} have explicitly partial windows and unfinished window work. Package hash verified; download requested with exact change log, full component accounting, remaining Athena work and reopenable project. Eagle and inspection behavior remain unverified.`);
    } catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Preparation export failed."); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  return <section className="scan-panel scan-panel-body" id="native-preparation" aria-label="Native part preparation">
    <h2>Prepare missing native parts</h2>
    <details><summary>Starter-job requirements and current limits</summary>
      <p>A scanned starter is the intended starting point. Today, template preparation still needs a compatible placement and model in the selected job. Package constructors derive new geometry but require an existing placement, local Master and suitable body/terminal windows as a native field-format seed. CAD-only starters without these records cannot yet create native models.</p>
      <p>This selected baseline contains {archiveReview?.preflight.nativeRecords.job?.records.filter(r => r.kind === "part-record").length ?? 0} read placement records. Read records alone do not establish suitable seeds. Each proposed part below identifies its exact seed and geometry evidence; unsupported routes stay held. A synthetic starter test establishes software behavior only. Compatibility with a genuine scan/fiducial/color-only Eagle starter remains untested.</p>
    </details>
    <p>Prepare a compatible model from this job, or construct a supported body and terminal reference model from reviewed package evidence and exact source-owned pads. The constructor uses a native record only as a field-format seed. Translation preserves template origin offsets; the bounded cardinal-angle trial requires an exact CAD-centered template and consistent source/native angle evidence. Every new placement and window stays disabled. Pad/FOV bindings, local-frame qualification and image teaching remain Athena work.</p>
    <details><summary>Package construction evidence</summary><label className="scan-field">Package geometry evidence profiles (JSON)<input type="file" accept=".json" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try { if (file.size > 200_000) throw new Error("Package evidence exceeds its bounds."); const packageProfiles = validatePackageProfiles(JSON.parse(await file.text()));
        setNativePreparation(old => ({ ...old, packageProfiles, review: null })); setAck(false); setMessage("Package evidence saved. Recompute and individually review source-derived body and terminal proposals.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid package evidence."); }
      event.target.value = "";
    }} /></label></details>
    {!!saved.packageProfiles?.length && <p>{saved.packageProfiles.length} reviewed package evidence profiles retained in this project and new candidate history. Drawing matches are explicit inputs; native runtime geometry still requires Eagle qualification.</p>}
    {saved.packageProfiles?.some(p => p.kind === "polarized-two-terminal-body-v1") && <p>Diode preparation requires a documented body datum and explicit pad/pin anode and cathode roles. Unequal lands never establish a body center by themselves. Missing evidence holds the affected parts. Native polarity teaching and pad bindings remain unverified.</p>}
    {saved.packageProfiles?.some(p => p.kind === "polarized-three-terminal-body-v1") && <p>Three-terminal preparation checks a source-owned body rectangle against manufacturer dimensions and numbered physical leads. The electrical no-connection pin retains a separate physical terminal reference. Bindings, polarity and image teaching still require Eagle qualification.</p>}
    {saved.packageProfiles?.some(p => p.kind === "numbered-physical-terminal-body-v1") && <p>Numbered physical-lead preparation keeps footprint lands separate from manufacturer leads. Extra lands require explicit absent-lead evidence and receive no physical terminal window. Body datum and pin-1 orientation are checked before proposing disabled local models; bindings and teaching remain unfinished.</p>}
    {saved.packageProfiles?.some(p => p.kind === "numbered-external-terminal-thermal-body-v1") && <p>External terminals and underside thermal pads are accounted separately. The body datum and numbered pin 1 must match source-owned geometry and manufacturer evidence. Thermal pads receive no optical window; external joint visibility also requires actual image evidence. Geometry alone never qualifies inspection coverage.</p>}
    {!canReview && <p><Link href="/intake">Select a complete job with both main snapshots and read its source layout</Link> to prepare parts. CAD/Gerber/BOM review can continue independently.</p>}
    <Button disabled={!canReview || busy} onClick={analyze}>{busy ? "Working…" : "Find supported native preparation"}</Button>
    {saved.review && !review && <p>Saved exact decisions are retained. Recompute from verified source bytes to view the proposals and export.</p>}
    {review && <>
      <p>{ready.length - partial.length - constructed.length} proposals retain the full template window set. {constructed.length > 0 && `${constructed.length} additional proposals construct a manufacturer body and owned physical terminal reference windows; no teaching or binding is inferred. `}{partial.length > 0 && `${partial.length} additional proposals have explicitly partial local windows; omitted inspections require Eagle work. `}{review.accounting.filter(i => i.status === "held-no-supported-template").length} native CAD references still need a supported template or other preparation route. A proposal does not count as an applied part.</p>
      {work && <details><summary>Population, mounting evidence and exact preparation blockers</summary>
        <p>Engineering DNP and hole-bearing evidence are separate from missing populated SMT. Current work-order population and stage applicability remain unapproved; no reference is automatically excluded.</p>
        {work.heldGroups.map((group, i) => <p key={i}><strong>{group.category} · {group.references.length} · {group.code}</strong>: {group.references.map(r => `${r.reference} (module ${r.module})`).join(", ")}. {group.reason}</p>)}
      </details>}
      {review.padBindingWork && <details><summary>Pad binding evidence and shared blockers</summary>
        <p>Source pad ownership and native literal links are separate evidence. Closed links or equal pad counts do not establish repaired bindings or inspections. This candidate writes no pad bindings.</p>
        {review.padBindingWork.sharedBlockers.map(blocker => <p key={blocker.code}><strong>{blocker.code} · {blocker.componentCount} references</strong>: {blocker.message}</p>)}
        <details><summary>Exact per-component source ownership and native binding work</summary><pre>{JSON.stringify(review.padBindingWork, null, 2)}</pre></details>
      </details>}
      {review.preparationIntents && <details><summary>Offline pad binding and FOV preparation</summary>
        <p>{review.preparationIntents.counts.ownedTerminalBindingIntents} exact source-owned terminal/window correspondences are prepared as review intents. Coverage extents are calculated in the recorded, unqualified native-frame hypothesis. These are prospective until applied; native artwork IDs, binding tuples and FOV assignments remain unwritten.</p>
        {review.preparationIntents.sharedContracts.map(c => <p key={c.id}><strong>{c.id}</strong>: {c.required}</p>)}
        <details><summary>Exact per-component binding and FOV intent plan</summary><pre>{JSON.stringify(review.preparationIntents, null, 2)}</pre></details>
        <p>The complete engineering export includes offline-binding-fov-intents.json. Project reopening rebuilds it from verified source bytes and exact proposals.</p>
      </details>}
      <label className="scan-field">Preparation reviewer<input value={saved.reviewer} maxLength={256} disabled={busy} onChange={event => { setAck(false); setNativePreparation(old => ({ ...old, reviewer: event.target.value, review: old.review ? { ...old.review, decisions: old.review.decisions.map(i => ({ ...i, decision: "pending" })) } : null })); }} /></label>
      {review.plan.items.map((item, index) => <details key={`${item.selection.targetSourcePath}:${index}`}>
        <summary>{item.reference ?? item.selection.targetSourcePath} · {item.status === "ready-for-review" ? "disabled model proposal" : "held"}</summary>
        {item.status === "held" ? <p>{item.code}: {item.reason}</p> : <>
          <p>Source category: <strong>{work?.rows.find(r => r.reference === item.reference && r.module === item.selection.moduleId)?.category ?? "population unresolved"}</strong>. Engineering population evidence does not approve this work order. Any DNP draft stays disabled pending that decision.</p>
          {item.dependencies?.windowPreparation === "constructed-body-terminal-geometry" && <p><strong>New package construction.</strong> Manufacturer body and owned terminal-land reference geometry; the source pad/pin map is verified. The selected original record supplies field formats only. Local native window axes, model metadata and terminal inspection properties remain qualification work; land reference windows are not taught lead/solder inspections.</p>}
          {item.basis?.geometryRoute === "polarized-two-terminal-body-v1" && <p><strong>Diode polarity evidence.</strong> Anode/cathode terminal roles and the body datum come from explicit source-bound evidence. Cathode direction in pattern axes: {JSON.stringify(item.basis.cathodeDirectionPatternAxes)}; native board axes: {JSON.stringify(item.basis.cathodeDirectionNativeBoardAxes)}. These are geometric directions, not taught polarity inspections. Verify them at Eagle before teaching or enabling.</p>}
          {item.basis?.geometryRoute === "polarized-three-terminal-body-v1" && <p><strong>Three physical leads.</strong> This draft contains a body reference and separately numbered anode, no-connection and cathode terminal-land references. NC remains a physical lead. The owned body datum and numbered package orientation are recorded below. These are disabled geometry references; bindings, polarity and inspection teaching remain unfinished.</p>}
          {item.basis?.geometryRoute === "numbered-physical-terminal-body-v1" && <p><strong>Physical leads and extra footprint lands.</strong> The matched numbered drawing establishes the body and pin-1 orientation. Only physical package leads receive terminal references. The exact extra-land evidence is recorded below; it authorizes no component exclusion or taught inspection. Keep the draft disabled until Eagle qualification and teaching.</p>}
          {item.basis?.geometryRoute === "numbered-external-terminal-thermal-body-v1" && <p><strong>External terminals and hidden thermal pads.</strong> Disabled body and numbered external-terminal land references are prepared. Underside thermal geometry is separately recorded below with no optical window. Neither thermal geometry nor external land geometry proves visible solder joints. Pin-1 marking, optical access, hidden-joint coverage, bindings and teaching remain unresolved.</p>}
          <p>Module {item.selection.moduleId}; structural seed/template {item.templateReference} (placement {item.selection.templatePartId}, Master {item.selection.templateMasterKey}). New placement {item.dependencies!.partId}, local Master {item.dependencies!.masterKey}, {item.dependencies!.windowIds.length} linked windows. Translation in native literal units: {item.basis!.translationNativeUnits.join(", ")} (unit qualification pending). {item.basis!.originOffsetPreserved ? "Existing origin offset preserved." : "New source-derived anchor; see the exact geometry basis."} {item.dependencies?.windowPreparation === "constructed-body-terminal-geometry" ? "Body and terminal geometry is derived anew in the recorded source/native frames." : <>Angle change {item.basis!.nativeCadAngleDeltaDegrees ?? 0}°.</>} {item.basis!.storedCenterPolicy}. Local Master/window behavior remains unverified.</p>
          <p>{item.dependencies!.templateAlgorithmsNotTransferred} template algorithms remain in the original model and are omitted from the new model. All new bindings/FOV lists are empty. Population approval and inspection teaching are unresolved.</p>
          {!!item.dependencies!.omittedWindows?.length && <p><strong>Partial window preparation.</strong> {item.dependencies!.windowIds.length} locally closed windows retained. Unfinished windows: {item.dependencies!.omittedWindows.map(w => `${w.windowId}: ${w.reasons.join(", ")}`).join("; ")}. Their original teaching remains untouched. Resolve intended coverage and create/teach any required omitted window at Eagle before enabling; no inspection exclusion is approved.</p>}
          <label className="scan-field">Decision for {item.reference}<select disabled={busy || !fresh || !saved.reviewer.trim()} value={saved.review?.decisions.find(d => d.digest === item.digest)?.decision ?? "pending"} onChange={event => { const decision = event.target.value as "pending" | "accepted" | "rejected"; setAck(false); setNativePreparation(old => ({ ...old, review: old.review ? { ...old.review, decisions: old.review.decisions.map(d => d.digest === item.digest ? { ...d, decision } : d) } : null })); }}><option value="pending">Review needed</option><option value="accepted">Accept this disabled preparation</option><option value="rejected">Reject</option></select></label>
          <details><summary>Exact records to append and remaining work</summary><pre>{JSON.stringify(item, null, 2)}</pre></details>
        </>}
      </details>)}
      <details><summary>Full component accounting before apply</summary><table><thead><tr><th>Reference</th><th>Module</th><th>Population / mounting evidence</th><th>State</th><th>Next action</th></tr></thead><tbody>{review.accounting.map((item, i) => <tr key={i}><td>{item.reference}</td><td>{item.module}</td><td>{work?.rows[i].category}</td><td>{item.status}</td><td>{item.nextAction}</td></tr>)}</tbody></table></details>
      <label><input type="checkbox" checked={ack} disabled={busy || !fresh || !accepted.length} onChange={e => setAck(e.target.checked)} /> I acknowledge qualification-only output, disabled new parts and unresolved binding, teaching and Eagle compatibility.</label>
      <p><Button disabled={busy || !fresh || !accepted.length || !ack || !saved.reviewer.trim() || saved.history.length >= 50} onClick={generate}>Apply accepted part preparation to a separate candidate</Button></p>
    </>}
    {message && <p role="status">{message}</p>}
    {!!saved.history.length && <details><summary>Prepared candidate history · {saved.history.length}</summary>{saved.history.map(h => <p key={h.id}>{h.recordedAt}: {h.accepted.length} disabled parts prepared · candidate <code>{h.candidateSha256}</code>. Eagle, binding and inspection remain unverified. {h.review.sourceContext !== session.sourceContext && "Historical source context differs from the current project."}</p>)}</details>}
  </section>;
}
