"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NativeGeometry } from "./NativeGeometry";
import { evaluationBundle } from "@/lib/scan/evaluation-bundle";
import { buildSourceCrosswalk } from "@/lib/scan/source-crosswalk";
import { Button } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import { downloadJson } from "@/lib/scan/review-session";
import { repairProposalGroups, type RepairProposal, type RepairRequest } from "@/lib/scan/repair-session";
import { RepairImpact } from "./RepairImpact";
import { readComposedCandidateWork, readGeneratedCandidate } from "@/lib/scan/engineering-candidate-work";
import { preparationWork, preparationWorkCsv } from "@/lib/scan/preparation-work";
import { buildOfflineReviewEvidence } from "@/lib/scan/offline-review-evidence";
import { compositionDecisionContext, preparationNeedsRecompute } from "@/lib/scan/composition-context";

export function RepairReview() {
  const session = useScanSession();
  const { archiveFile, archiveReview, selection, repair, setRepair, eagleVersion } = session;
  const preflight = archiveReview?.preflight;
  const records = preflight?.nativeRecords.job?.records.filter(record => record.kind === "part-record") ?? [];
  const [selected, setSelected] = useState("");
  const [field, setField] = useState("Roi/cx");
  const [after, setAfter] = useState("");
  const [afterY, setAfterY] = useState("");
  const [evidenceKind, setEvidenceKind] = useState("operator-declared");
  const [reviewer, setReviewer] = useState("");
  const [evidence, setEvidence] = useState("");
  const [referenceHash, setReferenceHash] = useState("");
  const [referenceName, setReferenceName] = useState("");
  const [retained, setRetained] = useState("");
  const [ack, setAck] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentScope = `${preflight?.source.sha256}:${preflight?.selection.job.sha256}:${session.sourceContext}:${compositionDecisionContext(session.nativePreparation, repair.request)}`;
  const scopeRef = useRef(currentScope); scopeRef.current = currentScope;
  const part = records.find(record => record.sourcePath === selected);
  const scalar = (key: string) => part?.rawFields[key]?.length === 1 ? part.rawFields[key][0] : "";
  const peers = records.filter(record => record !== part && record.rawFields.RefID?.length === 1 && record.rawFields.ParentId?.length === 1 && record.rawFields.RefID[0] === scalar("RefID") && record.rawFields.ParentId[0] === scalar("ParentId"));
  const retainedPart = peers.find(record => record.sourcePath === retained);
  const req = repair.request;
  const fresh = !!req && req.source.archiveSha256 === preflight?.source.sha256 && req.source.jobSha256 === preflight?.selection.job.sha256 && req.source.jobMember === selection?.jobMember && (!req.source.masterMember || (req.source.masterMember === preflight?.selection.master?.member && req.source.masterSha256 === preflight.selection.master.sha256 && preflight.selection.master.role === "main")) && selection?.jobRole === "main" && !!session.sourceContext && (!repair.sourceContext || repair.sourceContext === session.sourceContext);
  const accepted = fresh ? req!.acceptances.filter(value => value.decision === "accepted").length : 0;
  const readOnly = !preflight || selection?.jobRole !== "main";
  const verificationBusy = session.candidateWorkBusy || session.generatedArchive.archiveBusy;
  const schema101 = preflight?.nativeRecords.job?.schemaVersionClaim === "10.1";
  const preparation = session.nativePreparation;
  const preparationAccepted = preparation.review?.decisions.filter(item => item.decision === "accepted").map(item => item.digest) ?? [];
  const preparationFresh = preparation.review?.archiveSha256 === preflight?.source.sha256 && preparation.review?.layoutSha256 === session.layout.result?.sourceSha256;

  async function call(action: "repair-review" | "repair-export", request: RepairRequest) {
    if (!archiveFile || !archiveReview || !selection) throw new Error("Select and preflight a complete native archive first.");
    const form = new FormData();
    form.set("file", archiveFile); form.set("action", action); form.set("expectedArchiveSha256", archiveReview.preflight.source.sha256);
    form.set("expectedPackageSha256", archiveReview.capture.packageSha256); form.set("selection", JSON.stringify(selection));
    if (action === "repair-export" && preparationNeedsRecompute(preparation, preflight?.source.sha256)) throw new Error("This source has earlier accepted preparation but its current review was cleared. Recompute preparation before export; prior parts will not be silently omitted.");
    if (action === "repair-export" && preparationAccepted.length) {
      if (!preparationFresh || !session.layout.file || !session.layout.result || !preparation.reviewer.trim()) throw new Error("Accepted native preparation is stale or lacks its source layout. Recompute it before composing this candidate; accepted parts will not be silently omitted.");
      form.set("layout", session.layout.file);
    }
    form.set("repair", JSON.stringify({ request, ...(action === "repair-export" ? { acknowledgement: "QUALIFICATION ONLY", ...(preparationAccepted.length ? { preparation: {
      layoutSha256: session.layout.result!.sourceSha256, reviewDigest: preparation.review!.digest,
      accepted: preparationAccepted, reviewer: preparation.reviewer,
      ...(preparation.packageProfiles?.length ? { packageProfiles: preparation.packageProfiles } : {}) } } : {}) } : {}) }));
    return fetch("/api/archive", { method: "POST", body: form });
  }
  async function review(draft: RepairRequest) {
    if (!session.sourceContext) return setMessage("Source hashes are still being checked; try again shortly.");
    const scope = currentScope;
    setWorking(true); setMessage(""); setAck(false);
    try {
      const response = await call("repair-review", draft); const result = await response.json();
      if (!response.ok || result.status !== "success") throw new Error(result.reason ?? result.message ?? result.reasons?.join(" ") ?? "Proposal validation failed.");
      if (!mounted.current || scopeRef.current !== scope) return;
      const checked: RepairRequest = result.request;
      // Only unchanged exact digests retain decisions; new/edited proposals need review.
      checked.acceptances = checked.acceptances.map(value => {
        const previous = (!repair.sourceContext || repair.sourceContext === session.sourceContext) && req?.acceptances.find(old => old.proposalId === value.proposalId && old.proposalSha256 === value.proposalSha256);
        return previous ? { ...value, decision: previous.decision } : value;
      });
      setRepair(old => ({ ...old, sourceContext: session.sourceContext!, request: checked })); setReviewer(checked.reviewer);
      setMessage("Source, exact identity, before-values and supported paths checked. Historical replay and operator-declared evidence do not establish an automatic diagnosis or physical correctness. Review each proposal below.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review failed."); }
    finally { setWorking(false); }
  }
  async function add() {
    if (!preflight || !part || !reviewer.trim() || !evidence.trim() || !/^[a-f0-9]{64}$/.test(referenceHash)) return setMessage("Select a placement, name the reviewer and add a supporting evidence file with a specific explanation.");
    if (field === "ENABLE" && (!retainedPart || retainedPart.rawFields.ENABLE?.join() !== "True")) return setMessage("Select an enabled retained placement in the same module/reference. Matching reference text alone does not prove redundancy.");
    if (!preflight.selection.master || preflight.selection.master.role !== "main") return setMessage("Select and preflight the matching main Master snapshot before adding a new guarded placement proposal. Temp/backup Masters cannot substitute for it.");
    const id = crypto.randomUUID(); const evidenceId = `evidence-${id}`;
    const source = { archiveSha256: preflight.source.sha256, jobSha256: preflight.selection.job.sha256, root: preflight.selection.root, jobMember: preflight.selection.job.member, jobRole: "main" as const, masterMember: preflight.selection.master.member, masterSha256: preflight.selection.master.sha256, masterRole: "main" as const };
    const draft: RepairRequest = fresh ? structuredClone(req!) : { artifactType: "scan.qualification-patch-request", schemaVersion: "1", purpose: "qualification-only", source, reviewer: reviewer.trim(), targetEagleBuild: eagleVersion || null, targetMachine: null, trialPurpose: "Reviewed isolated offline qualification; binding, dependent windows and inspection behavior remain unresolved.", evidence: [], proposals: [], acceptances: [] };
    draft.source = source;
    if (draft.reviewer !== reviewer.trim()) return setMessage("Use the same reviewer for this exact proposal set, or clear the set and review again.");
    draft.evidence.push({ id: evidenceId, ...(evidenceKind === "historical-replay" ? { kind: "historical-replay" as const, independentSupport: false } : { independentSupport: true }), summary: `${evidence.trim()}${retainedPart ? ` Retained placement: ${retainedPart.sourcePath}; ID ${retainedPart.rawFields.ID?.join()}.` : ""}`, references: [{ sha256: referenceHash, label: referenceName || "Operator supporting evidence" }] });
    const beforeRoi = Object.fromEntries(["cx", "cy", "w", "h", "a"].map(key => [key, scalar(`Roi/${key}`)])) as NonNullable<RepairProposal["beforeRoi"]>;
    if (Object.values(beforeRoi).some(v => !v.trim())) return setMessage("Complete unique original ROI X, Y, width, height and angle are required for an exact guarded proposal.");
    const axes = (field === "Roi/xy" ? [["Roi/cx", after], ["Roi/cy", afterY]] : [[field, field === "ENABLE" ? "False" : after]]).filter(([key, value]) => scalar(key) !== value);
    if (!axes.length) return setMessage("The proposed literals are unchanged; no movement or candidate is generated.");
    const proposals = axes.map(([key, value], index) => ({ id: `${id}-${index}`, path: `${part.sourcePath}/${key}`, identity: { ID: scalar("ID"), ParentId: scalar("ParentId"), MasterKey: scalar("MasterKey"), RefID: scalar("RefID") }, before: scalar(key), after: value, beforeRoi, evidenceIds: [evidenceId] }));
    draft.proposals.push(...proposals.map(p => ({ ...p, ...(proposals.length > 1 ? { dependencyProposalIds: proposals.filter(q => q.id !== p.id).map(q => q.id) } : {}) })));
    await review(draft);
  }
  async function generate() {
    if (!req || !fresh || !ack || !accepted) return;
    const scope = currentScope; const request = structuredClone(req);
    setWorking(true); setMessage("");
    try {
      const response = await call("repair-export", request);
      if (!response.ok || !response.headers.get("content-type")?.includes("octet-stream")) { const result = await response.json(); throw new Error(result.reason ?? result.message ?? result.reasons?.join(" ") ?? "Export held."); }
      const blob = await response.blob();
      const packageSha256 = response.headers.get("X-SCAN-SHA256")!;
      const candidateSha256 = response.headers.get("X-SCAN-Candidate-SHA256")!;
      const computed = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
      if (computed !== packageSha256) throw new Error("Downloaded package hash differs; no candidate recorded.");
      if (!mounted.current) return;
      if (scopeRef.current !== scope) throw new Error("Sources or exact reviewed decisions changed during export; no download or new history was recorded. Review and retry.");
      const id = crypto.randomUUID();
      const revision = { id, recordedAt: new Date().toISOString(), sourceSha256: request.source.archiveSha256, packageSha256, candidateSha256, request,
        ...(preparationAccepted.length ? { composition: { review: structuredClone(preparation.review!), reviewer: preparation.reviewer, accepted: preparationAccepted, ...(preparation.packageProfiles?.length ? { packageProfiles: structuredClone(preparation.packageProfiles) } : {}) } } : {}) };
      const updatedRepair = { ...repair, history: [...repair.history, revision] };
      const candidate = await readGeneratedCandidate(blob, candidateSha256, selection!);
      const project = await session.buildProjectBlob(updatedRepair, preparation, { file: candidate.file, selection: candidate.record.selection, draft: candidate.record.draft });
      const crosswalk = buildSourceCrosswalk(session.bom.result, session.result, archiveReview, session.comparisons.entries.map(item => ({ name: item.file.name, result: item.result })), session.layout.result);
      const json = (value: unknown) => new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
      const reports: { name: string; blob: Blob }[] = [{ name: "baseline-offline-review.json", blob: json(await buildOfflineReviewEvidence(session)) }];
      if (preparationAccepted.length) {
        const actual = await readComposedCandidateWork(blob, candidateSha256, request.source.archiveSha256, preparationAccepted);
        const work = { ...preparationWork(actual.accounting, actual.items, preparationAccepted, session.bom.result, archiveReview, actual.bindingWork, actual.queue, session.layout.result), candidateSha256, packageSha256 };
        reports.push({ name: "component-by-component-Eagle-work.json", blob: json(work) }, { name: "component-by-component-Eagle-work.csv", blob: new Blob([preparationWorkCsv(work)]) });
      }
      const bundle = await evaluationBundle([{ name: "engineering-QUALIFICATION-ONLY.zip", blob }, { name: "SCAN.scan-project.json", blob: project }, ...reports, { name: "source-reconciliation.json", blob: json({ bom: session.bom.result, crosswalk }) }, { name: "source-geometry-evidence.json", blob: json({ layout: session.layout.result, gerber: session.gerber.result, alignment: session.gerber.alignment }) }, { name: "OPEN_FIRST.txt", blob: new Blob(["QUALIFICATION ONLY. Open SCAN.scan-project.json in SCAN to resume sources, decisions and history. Extract engineering-QUALIFICATION-ONLY.zip separately and read START_HERE.txt before any Eagle evaluation. Source reconciliation and geometry evidence describe the original baseline; candidate-specific native and component work are recomputed inside the engineering package. Accepted scalar trials are recorded with exact identities and before/after fields in applied_changes.json; when preparations are included, composed-qualification-receipt.json records both reviewed sets. Component work identifies applied scalar trials and the unresolved binding, dependent-window and position-retention checks; no inspection repair is established. Temp/backup snapshots preserve the original state: do not substitute them during testing. No machine validation or production release is granted."]) }]);
      if (!mounted.current) return;
      if (scopeRef.current !== scope) throw new Error("Sources or exact reviewed decisions changed during export; no download or new history was recorded. Review and retry.");
      const url = URL.createObjectURL(bundle); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `SCAN-QUALIFICATION-ONLY-${id.slice(0, 8)}.zip`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      setRepair(old => ({ ...old, history: [...old.history, revision] }));
      void session.generatedArchive.restoreArchive(candidate, new AbortController().signal);
      setMessage(`${accepted} accepted scalar change(s) and ${preparationAccepted.length} accepted disabled preparations packaged in one complete native copy. Generated package hash verified; browser download requested. The project retains both reviewed sets and this combined revision. Binding, inspection repair and Eagle compatibility remain unverified.`);
      setAck(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export failed."); }
    finally { setWorking(false); }
  }

  return <div className="scan-content-stack"><section className="scan-review-controls">
    <h2>Repair Review</h2><p>Review local placement experiments against the selected source. Every export is <strong>QUALIFICATION ONLY</strong>. Original files, shared Masters, libraries and machine folders are not edited. Native binding changes are held pending qualified ownership and semantics.</p>
    {!preflight ? <p><Link href="/intake#archive-intake">Select a complete job ZIP and run preflight</Link> to start. Pre-arrival placement/Gerber review can continue without it.</p> : <p>Baseline: {preflight.selection.job.role} · {preflight.selection.job.member}<br />Source SHA-256: <code>{preflight.source.sha256}</code></p>}
    {readOnly && preflight && <p role="status">This baseline is available for analysis. The qualification writer supports explicitly selected main snapshots only; it will not switch from Temp/backup automatically.</p>}
    <fieldset disabled={working || session.candidateWorkBusy || session.generatedArchive.archiveBusy || readOnly}><legend>Prepare a local qualification proposal</legend>
      <label className="scan-field">Placement<select value={selected} onChange={event => { setSelected(event.target.value); setRetained(""); setAfter(""); setAfterY(records.find(r => r.sourcePath === event.target.value)?.rawFields["Roi/cy"]?.[0] ?? ""); }}><option value="">Select native placement</option>{records.map(record => <option key={record.sourcePath} value={record.sourcePath}>{record.rawFields.RefID?.join(" / ")} · module {record.rawFields.ParentId?.join()} · ID {record.rawFields.ID?.join()} · Master {record.rawFields.MasterKey?.join()}</option>)}</select></label>
      <label className="scan-field">Operation<select value={field} onChange={event => { setField(event.target.value); setAfter(""); setAfterY(scalar("Roi/cy")); }}><option value="Roi/cx">Local ROI X trial</option><option value="Roi/cy">Local ROI Y trial</option><option value="Roi/xy">Local ROI X/Y placement trial — atomic review</option><option value="CenterPosX" disabled={schema101}>Stored placement-center X trial</option><option value="ENABLE" disabled={schema101}>Disable reviewed redundant placement</option></select></label>
      {schema101 && <p>JobXmlVersion 10.1 supports only the guarded experimental ROI X/Y edit route. This is a schema claim, not the Eagle software version. Stored centers, Masters, windows, bindings, FOV and enabled states are preserved.</p>}
      {part && <><p>Exact before: <code>{field === "Roi/xy" ? `X ${scalar("Roi/cx")}; Y ${scalar("Roi/cy")}` : scalar(field) || "Missing/repeated — held"}</code>. Scope: this placement in module {scalar("ParentId")}; Master {scalar("MasterKey")} is preserved.</p><details><summary>Native literals and comparison evidence</summary><pre>{JSON.stringify(part.rawFields, null, 2)}</pre><p>Native frame and units are unqualified. CAD/Gerber registration does not qualify native placement or Master-local coordinates.</p>{peers.map(peer => <div key={peer.sourcePath}><strong>Same module/reference: {peer.sourcePath}</strong><pre>{JSON.stringify(Object.fromEntries(Object.keys({ ...part.rawFields, ...peer.rawFields }).filter(key => JSON.stringify(part.rawFields[key]) !== JSON.stringify(peer.rawFields[key])).map(key => [key, { selected: part.rawFields[key], peer: peer.rawFields[key] }])), null, 2)}</pre></div>)}</details></>}
      {part && <NativeGeometry sourcePath={part.sourcePath} />}
      {part && <RepairImpact sourcePath={part.sourcePath} field={field === "Roi/xy" ? "Roi/cx" : field} after={field === "ENABLE" ? "False" : after} {...(field === "Roi/xy" ? { afterFields: { "Roi/cx": after, "Roi/cy": afterY } } : {})} />}
      {field === "ENABLE" ? <label className="scan-field">Retained placement<select value={retained} onChange={event => setRetained(event.target.value)}><option value="">Select and justify survivor</option>{peers.map(peer => <option key={peer.sourcePath} value={peer.sourcePath}>ID {peer.rawFields.ID?.join()} · Master {peer.rawFields.MasterKey?.join()} · ENABLE {peer.rawFields.ENABLE?.join()}</option>)}</select><span>Both records and all teaching differences require review. No survivor is chosen automatically.</span></label> : <><label className="scan-field">{field === "Roi/cy" ? "Exact proposed Y literal" : "Exact proposed X literal"}<input value={after} onChange={event => setAfter(event.target.value)} maxLength={80} /></label>{field === "Roi/xy" && <label className="scan-field">Exact proposed Y literal<input value={afterY} onChange={event => setAfterY(event.target.value)} maxLength={80} /><span>Both changed axes are one decision. Unchanged axes are preserved and guarded, never emitted as a no-op patch.</span></label>}</>}
      <label className="scan-field">Reviewer<input value={reviewer} onChange={event => setReviewer(event.target.value)} maxLength={256} /></label>
      <label className="scan-field">Evidence basis<select value={evidenceKind} onChange={event => setEvidenceKind(event.target.value)}><option value="operator-declared">Operator-declared source support — independently unqualified</option><option value="historical-replay">Historical replay — archived edit, physical correctness unproven</option></select></label>
      <p>{evidenceKind === "historical-replay" ? "Reproducing archived coordinates tests the writer and workflow. Report-derived before/after values are not their own proof of intended physical placement. No automatic repair recommendation is made." : "An evidence declaration is not an automatic diagnosis. The writer checks exact bytes and identities; independent engineering justification still needs review."}</p>
      <label className="scan-field">Supporting evidence file<input type="file" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 8_000_000) return setMessage("Evidence file limit is 8 MB."); setReferenceHash(Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("")); setReferenceName(file.name); if (session.attachments.length < 3) session.setAttachments(old => [...old, { role: "evidence", file }]); else setMessage("Supporting hash retained; attachment slots are full. Keep this file alongside the bundle."); }} /></label>
      <p>{referenceName && `${referenceName} · ${referenceHash}`} Evidence contents are not interpreted by this writer; keep the supporting file with your project.</p>
      <label className="scan-field">Independent basis, coordinate frame and unresolved dependencies<textarea value={evidence} maxLength={3000} onChange={event => setEvidence(event.target.value)} placeholder="Explain why this is a local correction or full-placement redundancy, how the intended geometry/survivor was established, and what remains unverified. A numerical difference alone is insufficient." /></label>
      <Button onClick={add} disabled={!part || !session.sourceContext}>Check and add proposal</Button>
    </fieldset>
    <details><summary>Import an existing exact qualification request</summary><p>Imported decisions do not authorize new changes. Scope and before-values are checked, then new proposals enter pending review.</p><input type="file" accept=".json" aria-label="Qualification request" disabled={working || verificationBusy || readOnly} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 1_000_000) throw new Error("Request exceeds 1 MB."); await review(JSON.parse(await file.text())); } catch { setMessage("Invalid bounded JSON request."); } }} /></details>
    {message && <p role="status">{message}</p>}
  </section>
  {req && <section className="scan-review-controls"><h2>Exact proposed changes</h2>{!fresh && <p role="alert">Stale or different source, mapping, evidence or snapshot. These decisions are retained for history; export is blocked. Recheck against the matching source.</p>}
    {repairProposalGroups(req).map(group => {
      const proposal = group[0], ids = group.map(p => p.id), decisions = req.acceptances.filter(a => ids.includes(a.proposalId));
      const decision = decisions.length === ids.length && decisions.every(a => a.decision === decisions[0].decision) ? decisions[0].decision : "pending";
      const change = (next: "pending" | "accepted" | "rejected") => { setAck(false); setRepair(old => ({ ...old, request: old.request && { ...old.request, acceptances: old.request.acceptances.map(value => ids.includes(value.proposalId) ? { ...value, decision: next } : value) } })); };
      const basis = req.evidence.filter(e => group.some(p => p.evidenceIds.includes(e.id)));
      const samePlacement = group.every(p => JSON.stringify(p.identity) === JSON.stringify(proposal.identity));
      return <article key={proposal.id}><h3>{proposal.identity.RefID} · module {proposal.identity.ParentId} · ID {proposal.identity.ID}</h3>
        {group.length > 1 && <p>Atomic dependency group: all {group.length} exact scalar edits must share one accepted decision.</p>}
        {group.map(p => <p key={p.id}><strong>{p.identity.RefID} / ID {p.identity.ID} / Master {p.identity.MasterKey}</strong>: <code>{p.path}</code>: <code>{p.before}</code> → <code>{p.after}</code></p>)}
        <p>Master {proposal.identity.MasterKey} preserved. Protected: unrelated coordinates, limits, images, OCR, fiducials, calibration and unknown fields. Binding/dependent-window effects remain unresolved.</p>
        {samePlacement ? <RepairImpact sourcePath={proposal.path.split("]/", 1)[0] + "]"} field={proposal.path.split("]/")[1]} after={proposal.after} afterFields={Object.fromEntries(group.map(p => [p.path.split("]/")[1], p.after]))} /> : group.map(p => <RepairImpact key={p.id} sourcePath={p.path.split("]/", 1)[0] + "]"} field={p.path.split("]/")[1]} after={p.after} />)}
        {proposal.beforeRoi && <p>Guarded original ROI: X {proposal.beforeRoi.cx}, Y {proposal.beforeRoi.cy}, width {proposal.beforeRoi.w}, height {proposal.beforeRoi.h}, angle {proposal.beforeRoi.a}. Only listed changed fields will be written.</p>}
        {basis.map(e => <div key={e.id}><p><strong>{e.kind === "historical-replay" ? "Historical replay — physical correctness unproven" : "Operator-declared source support — not independently diagnosed"}</strong>. {e.summary}</p>{e.references.map((r, i) => <p key={`${r.sha256}:${i}`}>{r.label}: <code>{r.sha256}</code></p>)}</div>)}
        <label className="scan-field">Decision<select aria-label={`Decision ${proposal.id}`} value={decision} disabled={working || verificationBusy || !fresh || decisions.length !== ids.length} onChange={event => change(event.target.value as "pending" | "accepted" | "rejected")}><option value="pending">Pending</option><option value="accepted">Accept for isolated qualification only</option><option value="rejected">Reject</option></select></label>
        <Button variant="outline" disabled={working || verificationBusy || !fresh || decision === "pending"} onClick={() => change("pending")}>Undo decision {proposal.identity.RefID} / {proposal.identity.ID}</Button>
      </article>;
    })}
    <div className="scan-actions"><Button variant="outline" disabled={working || verificationBusy || readOnly} onClick={() => review(req)}>Recheck exact proposal set</Button><Button variant="outline" onClick={() => downloadJson(req, "repair-request.json")}>Export proposals and decisions</Button><Button variant="outline" disabled={working || verificationBusy} onClick={() => { setRepair(old => ({ ...old, request: null })); setAck(false); }}>Clear current proposal set</Button></div>
    <label><input type="checkbox" checked={ack} disabled={working || verificationBusy || !fresh} onChange={event => setAck(event.target.checked)} /> I acknowledge QUALIFICATION ONLY: selected main is changed; Temp/backup retain original state. Eagle compatibility, binding and inspection behavior are unverified.</label>
    <p>{preparationAccepted.length ? `This export also reconstructs ${preparationAccepted.length} separately accepted disabled preparations from the original source. Both exact reviewed sets are freshly checked and recorded; all other existing work is preserved.` : "No accepted native preparation is selected for this export."} Development-test decisions do not establish operator approval.</p>
    <p><Button disabled={working || verificationBusy || !fresh || !ack || !accepted || repair.history.length >= 50} onClick={generate}>{working ? "Checking source and packaging…" : `Generate qualification candidate (${accepted} accepted)`}</Button></p>
  </section>}
  <section className="scan-review-controls"><h2>Candidate revisions</h2><p>Each revision records its exact accepted set and hashes. Keep the downloaded package with the saved project. History records package generation; it does not confirm the browser saved the file or grant machine validation.</p>{repair.history.map(item => <details key={item.id}><summary>{item.recordedAt} · {item.id}</summary><p>Package <code>{item.packageSha256}</code><br />Native candidate <code>{item.candidateSha256}</code></p><Button variant="outline" onClick={() => downloadJson(item, `candidate-${item.id}.json`)}>Download revision receipt</Button></details>)}</section>
  <section className="scan-review-controls"><h2>Component work decisions</h2><p>All native CAD references and native-only placements remain accounted for. Your observations do not change literal enablement, establish teaching, validate inspection or grant release. Exclusion needs a specific population/stage reason.</p><label className="scan-field">Find reference or module<input value={filter} onChange={event => setFilter(event.target.value)} /></label>
    {(preflight?.nativeAccounting?.componentCoverage ?? []).filter(row => `${row.referenceLiteral} ${row.moduleLiteral}`.toLowerCase().includes(filter.toLowerCase())).map(row => { const note = repair.work.find(value => value.key === row.id && value.sourceSha256 === preflight!.source.sha256 && value.snapshotId === preflight!.snapshotId); const update = (status: typeof repair.work[number]["status"], text: string) => setRepair(old => ({ ...old, work: [...old.work.filter(value => !(value.key === row.id && value.sourceSha256 === preflight!.source.sha256 && value.snapshotId === preflight!.snapshotId)), { key: row.id, sourceSha256: preflight!.source.sha256, snapshotId: preflight!.snapshotId, status, note: text }] })); return <details key={row.id}><summary>{row.referenceLiteral ?? "Unresolved reference"} · module {row.moduleLiteral ?? "unknown"} · {note?.status ?? "review-needed"}</summary><p>{row.sourceRepresentation} · {row.nativeCorrespondence}. Teaching: {row.existingTeaching}; verification: {row.verification}.</p><label className="scan-field">Offline work status<select value={note?.status ?? "review-needed"} onChange={event => update(event.target.value as typeof repair.work[number]["status"], note?.note ?? "")}><option value="review-needed">Review needed</option><option value="reviewed-offline">Reviewed offline — machine unverified</option><option value="intentionally-excluded">Intentionally excluded — operator decision</option><option value="machine-work">Needs Athena work</option></select></label><label className="scan-field">Reason, evidence and next action<textarea maxLength={2000} value={note?.note ?? ""} onChange={event => update(note?.status ?? "review-needed", event.target.value)} /></label></details>; })}
    <Button variant="outline" onClick={() => downloadJson({ observations: repair.work, machineValidation: "not-granted" }, "work-decisions.json")}>Export work decisions</Button>
    <p><Link href="/handoff">Open whole-board accounting and exact Master/window/algorithm work</Link> · <Link href="/workspace">Review CAD and Gerber geometry</Link></p>
  </section></div>;
}
