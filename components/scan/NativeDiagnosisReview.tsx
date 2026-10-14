"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import { appendDiagnosisSources, type NativeDiagnosisContext, type NativeDiagnosisReport, type NativeDiagnosisRow, type NativeDiagnosisSettings } from "@/lib/scan/native-placement-diagnosis";
import type { RepairProposal, RepairRequest } from "@/lib/scan/repair-session";
import { nativeEntities } from "@/lib/scan/visual-workspace";
import { downloadJson } from "@/lib/scan/review-session";

function PlacementComparison({ row }: { row: NativeDiagnosisRow }) {
  const from = [Number(row.beforeRoi.cx), Number(row.beforeRoi.cy)], to = row.proposedCenterNative;
  if (!to || !from.every(Number.isFinite)) return null;
  const width = Number(row.beforeRoi.w), height = Number(row.beforeRoi.h);
  const span = Math.max(Math.abs(to[0]-from[0]), Math.abs(to[1]-from[1]), width, height, 1)*1.5;
  const x = (v: number) => 150+(v-from[0])/span*180, y = (v: number) => 105-(v-from[1])/span*140;
  return <svg role="img" aria-label={`Original and proposed native geometry ${row.identity.RefID}`} viewBox="0 0 420 220" style={{ width: "100%", maxWidth: 600, background: "#f8fafc" }}>
    <rect x={x(from[0])-width/span*90} y={y(from[1])-height/span*70} width={width/span*180} height={height/span*140} fill="none" stroke="#64748b" strokeWidth="2" />
    <line x1={x(from[0])} y1={y(from[1])} x2={x(to[0])} y2={y(to[1])} stroke="#2563eb" strokeDasharray="5 4" />
    <circle cx={x(from[0])} cy={y(from[1])} r="5" fill="#64748b" /><circle cx={x(to[0])} cy={y(to[1])} r="5" fill="#2563eb" />
    <text x="12" y="20" fill="#0f172a">Native centers only · preserved ROI dimensions, angle omitted</text><text x="12" y="197" fill="#475569">Gray: original ROI · Blue: source-derived center</text>
  </svg>;
}
export function NativeDiagnosisReview() {
  const session = useScanSession(), draft = session.nativeDiagnosis, settings = draft.settings;
  const finding = session.nativeFinding, setFinding = session.setNativeFinding;
  const [selected, setSelected] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const basis = JSON.stringify({ source: session.sourceContext, native: session.archiveReview?.capture.packageSha256, settings, profiles: session.nativePreparation.packageProfiles ?? [] });
  const basisRef = useRef(basis); basisRef.current = basis;
  useEffect(() => () => { controller.current?.abort();  }, []);
  useEffect(() => { const entity = nativeEntities(session.archiveReview?.preflight).find(e => e.key === session.visual.view.selected); if (entity?.path) setSelected(entity.path); }, [session.archiveReview, session.visual.view.selected]);
  const fresh = finding?.basis === basis ? finding : null;
  const row = fresh?.report.rows.find(r => r.sourcePath === selected) ?? fresh?.report.rows.find(r => r.proposals.length) ?? fresh?.report.rows[0];
  const edit = (changes: Partial<NativeDiagnosisSettings>) => session.setNativeDiagnosis(old => ({ ...old, settings: { ...old.settings, ...changes } }));
  const ready = session.nativeAnalysis.ready;
  const diagnose = session.nativeAnalysis.run;
  async function propose() {
    if (!fresh || !row?.proposals.length || row.holds.length || !draft.reviewer.trim() || !session.archiveReview || !session.archiveFile || !session.selection || !session.sourceContext) return;
    if (session.repair.request && (!session.repair.request.diagnosis || session.repair.request.diagnosis.diagnosisSha256 !== fresh.report.diagnosisSha256)) return setMessage("There is a separate reviewed proposal set. Export it or explicitly clear it in native review before starting this derived set; existing decisions will not be discarded.");
    const preflight = session.archiveReview.preflight, master = preflight.selection.master;
    if (!master || master.role !== "main") return;
    const id = crypto.randomUUID(), evidenceId = `diagnosis-${id}`;
    const request: RepairRequest = session.repair.request ? structuredClone(session.repair.request) : { artifactType: "scan.qualification-patch-request", schemaVersion: "1", purpose: "qualification-only", source: { archiveSha256: preflight.source.sha256, jobSha256: preflight.selection.job.sha256, root: preflight.selection.root, jobMember: preflight.selection.job.member, jobRole: "main", masterMember: master.member, masterRole: "main", masterSha256: master.sha256 }, targetEagleBuild: session.eagleVersion || null, targetMachine: null, reviewer: draft.reviewer.trim(), trialPurpose: "Source-derived experimental placement edit. Complete repair held pending Master/window propagation, binding, coverage and Eagle qualification.", evidence: [], proposals: [], acceptances: [], diagnosis: fresh.context };
    if (request.reviewer !== draft.reviewer.trim()) return setMessage("Use the same reviewer for this proposal set or start a separate reviewed set.");
    if (request.proposals.some(p => p.path.startsWith(`${row.sourcePath}/`))) return setMessage("This component is already in native review. Accept, reject or undo its exact group there.");
    const proposals: RepairProposal[] = row.proposals.map((p, i) => ({ id: `${id}-${i}`, path: `${row.sourcePath}/${p.field}`, identity: row.identity, before: p.before, after: p.after, beforeRoi: row.beforeRoi, evidenceIds: [evidenceId] }));
    request.proposals.push(...proposals.map(p => ({ ...p, ...(proposals.length > 1 ? { dependencyProposalIds: proposals.filter(q => q.id !== p.id).map(q => q.id) } : {}) })));
    request.evidence.push({ id: evidenceId, kind: "independent-source-support", independentSupport: true, summary: `Source-owned ${row.sourceAnchor}, matched body profile ${row.bodyProfileId ?? "not needed for origin trial"}; ${row.classification}. Frame controls use original native CAD independently of ROI. Complete inspection repair remains held.`, references: [{ sha256: fresh.report.diagnosisSha256, label: "Frozen independently derived diagnosis" }, ...Object.entries(fresh.context.source).map(([label, sha256]) => ({ label, sha256 }))] });
    const token = basis; controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setMessage("");
    const form = new FormData(); form.set("file", session.archiveFile); form.set("action", "repair-review"); form.set("selection", JSON.stringify(session.selection)); form.set("expectedArchiveSha256", preflight.source.sha256); form.set("expectedPackageSha256", session.archiveReview.capture.packageSha256); form.set("repair", JSON.stringify({ request })); appendDiagnosisSources(form, request.diagnosis, { layout: session.layout.file, placement: session.file, bom: session.bom.file });
    try { const response = await fetch("/api/archive", { method: "POST", body: form, signal: abort.signal }), result = await response.json(); if (!response.ok || result.status !== "success") throw new Error(result.reason ?? result.message ?? result.reasons?.join(" ") ?? "Derived proposal held."); if (abort.signal.aborted || basisRef.current !== token) return; const checked: RepairRequest = result.request; checked.acceptances = checked.acceptances.map(a => ({ ...a, decision: request.acceptances.find(old => old.proposalId === a.proposalId && old.proposalSha256 === a.proposalSha256)?.decision ?? "pending" })); session.setRepair(old => ({ ...old, sourceContext: session.sourceContext!, request: checked })); setMessage("Exact derived group freshly verified and added to native review below. Accept/reject/undo there, then export the complete separate qualification candidate."); }
    catch (e) { if (!abort.signal.aborted) setMessage(e instanceof Error ? e.message : "Proposal failed."); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  return <section className="scan-panel" id="native-diagnosis"><div className="scan-panel-heading"><h2>Independent source diagnosis → native placement review</h2></div><div className="scan-panel-body scan-content-stack">
    <p>Select the original native job/main Master, current placement file, owned PCB layout and actual BOM in Source intake. Reuse reviewed package evidence from preparation. Historical corrected jobs are comparison evidence only.</p>
    <p>The frame uses source footprint origins and original native CAD controls; the ROI being diagnosed is excluded. An explicit physical interpretation is required even when the residual is small. Unknown facts hold the affected scope.</p>
    <div className="scan-detail-grid">{(["module", "sourceRevision", "nativeRevision", "bomRevision"] as const).map(key => <label key={key} className="scan-field">Diagnosis {key}<input value={settings[key]} maxLength={256} onChange={e => edit({ [key]: e.target.value })} /></label>)}
      {(["sourceSide", "nativeSide", "nativeUnits", "nativeYDirection", "nativeRotation", "nativeRoiAnchor"] as const).map(key => <label className="scan-field" key={key}>Diagnosis {key}<select aria-label={`Diagnosis ${key}`} value={settings[key]} onChange={e => edit({ [key]: e.target.value })}>{({ sourceSide: ["unknown", "top", "bottom"], nativeSide: ["unknown", "top", "bottom"], nativeUnits: ["unknown", "mm", "mil"], nativeYDirection: ["unknown", "up", "down"], nativeRotation: ["unknown", "ccw", "cw"], nativeRoiAnchor: ["unknown", "body-center", "footprint-origin"] }[key]).map(v => <option key={v} value={v}>{v}</option>)}</select></label>)}
      {(["fitReferences", "checkReferences"] as const).map(key => <label key={key} className="scan-field">Diagnosis {key} (comma separated)<input value={settings[key].join(", ")} onChange={e => edit({ [key]: e.target.value.split(",").map(v => v.trim()).filter(Boolean) })} /></label>)}
      <label className="scan-field">Diagnosis tolerance (mm)<input value={settings.toleranceMm} onChange={e => edit({ toleranceMm: e.target.value })} /></label>
    </div>
    <label className="scan-field">Physical frame and anchor evidence<textarea aria-label="Physical frame and anchor evidence" maxLength={3000} value={settings.frameStatement} onChange={e => edit({ frameStatement: e.target.value })} /></label>
    <label className="scan-field">Tolerance evidence<input maxLength={2000} value={settings.toleranceBasis} onChange={e => edit({ toleranceBasis: e.target.value })} /></label>
    <label><input type="checkbox" checked={settings.framesConfirmed} onChange={e => edit({ framesConfirmed: e.target.checked })} /> I have reviewed these frame/origin declarations for this isolated offline experiment. This does not qualify Eagle or physical alignment.</label>
    <Button disabled={!ready || busy} onClick={() => void diagnose()}>Derive independent native findings</Button>{(busy || session.nativeAnalysis.busy) && <Button variant="outline" onClick={() => { controller.current?.abort(); session.nativeAnalysis.cancel(); setBusy(false); }}>Cancel diagnosis</Button>}
    {!ready && <p>Next: load and validate original/main native snapshots, current placements, PCB and BOM. No candidate is generated from missing evidence.</p>}
    {finding && !fresh && <p role="status">Sources, package evidence or interpretation changed. Findings and derived proposals are stale; derive again before review or export.</p>}
    {fresh && <><p>{fresh.report.counts.alreadyAligned} already aligned · {fresh.report.counts.supportedQualificationRows} experimental placement proposals · {fresh.report.counts.held} held native placements · complete inspection repairs: 0.</p>
      <p>Primary placement → owned PCB datum: {fresh.report.sourceRegistration?.transform ? `${fresh.report.sourceRegistration.transform.angleDegrees.toFixed(5)}° rotation; translation (${fresh.report.sourceRegistration.transform.matrix[0][2].toFixed(5)}, ${fresh.report.sourceRegistration.transform.matrix[1][2].toFixed(5)}) mm` : "not established"}. PCB datum → original native CAD: {fresh.report.frame.transform ? `${fresh.report.frame.transform.angleDegrees.toFixed(5)}° rotation; translation (${fresh.report.frame.transform.matrix[0][2].toFixed(5)}, ${fresh.report.frame.transform.matrix[1][2].toFixed(5)}) mm` : "not established"}. Each uses separate fit and check evidence; held interpretations remain hypotheses.</p>
      <Button variant="outline" onClick={() => downloadJson(fresh.report, "independent-native-placement-findings.json")}>Download independent findings</Button>
      {!!fresh.report.frame.holds.length && <ul>{fresh.report.frame.holds.map((h, i) => <li key={i}>{h.code}: {h.message}</li>)}</ul>}
      <label className="scan-field">Diagnosed native component<select aria-label="Diagnosed native component" value={row?.sourcePath ?? ""} onChange={e => setSelected(e.target.value)}>{fresh.report.rows.map(r => <option value={r.sourcePath} key={r.sourcePath}>{r.identity.RefID} · module {r.identity.ParentId} · ID {r.identity.ID} · {r.classification}</option>)}</select></label>
      {row && <><h3>{row.identity.RefID}: {row.classification}</h3><PlacementComparison row={row} /><p>Stable ID {row.identity.ID}; module {row.identity.ParentId}; Master {row.identity.MasterKey}. Existing enable state {row.existingEnabledLiteral ?? "unknown"} preserved.</p><p>Owned source origin: {row.footprintOrigin?.join(", ") ?? "unresolved"} mm. Independent body center: {row.bodyCenter?.join(", ") ?? "unresolved"} mm. These are source-frame coordinates.</p><p>Original native Master center: {row.originalMasterCenterNative?.join(", ") ?? "unresolved"}. {row.masterSupportsSourceDatum ? "It corroborates the independently derived datum under this interpretation." : "It does not establish the source datum."} Small offsets within the body envelope retain existing teaching; numerical disagreement alone is insufficient.</p><ul>{row.proposals.map(p => <li key={p.field}>{p.field}: {p.before} → {p.after}</li>)}{row.holds.map((h, i) => <li key={`hold${i}`}>{h.code}: {h.message}</li>)}{row.dependencyHolds.map((h, i) => <li key={`dep${i}`}>{h.code}: {h.message}</li>)}</ul>
        <label className="scan-field">Derived proposal reviewer<input value={draft.reviewer} maxLength={256} onChange={e => session.setNativeDiagnosis(old => ({ ...old, reviewer: e.target.value }))} /></label><Button disabled={busy || !row.proposals.length || !!row.holds.length || !!fresh.report.frame.holds.length || !draft.reviewer.trim()} onClick={() => void propose()}>Send exact derived placement to native review</Button>
        <details><summary>Original-CAD controls, source identities and dependencies</summary><pre>{JSON.stringify({ frame: fresh.report.frame, source: fresh.report.source, packageProfile: row.bodyProfileId, drawingSha256: row.drawingSha256, dependencies: row.dependencyInventory, findingSha256: fresh.report.diagnosisSha256 }, null, 2)}</pre></details>
      </>}
    </>}{(message || session.nativeAnalysis.message) && <p role="status">{message || session.nativeAnalysis.message}</p>}
  </div></section>;
}
