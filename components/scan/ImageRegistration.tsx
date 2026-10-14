"use client";
import { useEffect, useMemo, useState } from "react";
import { useScanSession } from "./ScanSession";
import { acceptImageReview, editImagePixel, imagePixelDraft, imageReviewHolds, invalidateImageReview, canonicalImageRequest, checkedImageFit, imageRegistrationHolds, imageRequestFingerprint, nativeImageBounds, nativeImageControl, newImageRegistration, type ImageRegistrationFit, type ImageRegistrationRequest, type PixelImage } from "@/lib/scan/image-registration";
import { nativeEntities } from "@/lib/scan/visual-workspace";
import styles from "./VisualWorkspace.module.css";

export function useImageRegistration(image: PixelImage | null, enabled: boolean, candidateView: boolean) {
  const s = useScanSession(), state = s.visual.view.imageRegistration;
  const [result, setResult] = useState<{ key: string; fit: ImageRegistrationFit } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [requested, setRequested] = useState<{ key: string; ticket: number }>({ key: "", ticket: 0 });
  const key = state ? canonicalImageRequest(state.request) : "";
  const [reviewBinding, setReviewBinding] = useState<{ key: string; holds: string[] } | null>(null);
  const reviewKey = canonicalImageRequest([state?.request, state?.review, state?.decision, state?.reviewHold]);
  const reviewHolds = reviewBinding?.key === reviewKey ? reviewBinding.holds : ["Checking saved review request identity…"];
  const reviewValid = !!state && state.decision === "reviewed" && reviewHolds.length === 0;
  useEffect(() => {
    let stale = false;
    if (state) void imageRequestFingerprint(state.request).then(fingerprint => {
      if (stale) return;
      const reasons = imageReviewHolds(state, fingerprint); setReviewBinding({ key: reviewKey, holds: reasons });
      if (state.decision === "reviewed" && reasons.length) s.visual.setView(old => old.imageRegistration && canonicalImageRequest([old.imageRegistration.request, old.imageRegistration.review, old.imageRegistration.decision, old.imageRegistration.reviewHold]) === reviewKey ? { ...old, imageRegistration: { ...old.imageRegistration, decision: "unreviewed", reviewHold: state.review ? "changed-request" : "legacy-unbound" } } : old);
    });
    return () => { stale = true; };
  }, [reviewKey, s.visual.setView]);
  const holds = useMemo(() => imageRegistrationHolds(state?.request, s.archiveReview?.preflight, image, candidateView), [state, s.archiveReview, image?.member, image?.sha256, image?.width, image?.height, candidateView]);
  const ready = enabled && !s.busy && !s.archiveBusy && !s.generatedArchive.archiveBusy && !s.candidateWorkBusy;
  const { begin, finish } = s.visual;
  useEffect(() => {
    setBusy(false); setError("");
    if (!ready || !state || holds.length || (requested.key !== key && !reviewValid) || result?.key === key) return;
    const abort = new AbortController(), run = begin("Image registration", state.request.source.archiveSha256, "Computing a uniform pixel similarity and an independent check; no native edit.");
    setBusy(true);
    void (async () => {
      try {
        const fingerprint = await imageRequestFingerprint(state.request); if (abort.signal.aborted) return;
        const response = await fetch("/api/image-registration", { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: abort.signal });
        const data = await response.json(); if (!response.ok || data.message) throw new Error(data.message ?? "Image registration unavailable.");
        const fit = checkedImageFit(data, state.request, fingerprint); if (abort.signal.aborted) return;
        setResult({ key, fit }); finish(run, fit.status === "success" ? "completed" : "held", `${fit.residuals.length} measured controls; maximum residual ${fit.maxResidualPx.toFixed(3)} px. Reviewer evidence and machine qualification remain separate.`);
      } catch (e) { if (!abort.signal.aborted) { const message = e instanceof Error ? e.message : "Image fit failed."; setError(message); finish(run, "held", message); } }
      finally { if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => { abort.abort(); finish(run, "cancelled", "Image registration request or source context changed."); };
  }, [key, ready, holds.join("|"), requested.ticket, reviewValid, begin, finish]);
  const fit = result?.key === key && !holds.length ? result.fit : null;
  return { fit, holds, reviewHolds, busy, error, calculate: () => { setResult(null); setRequested(a => ({ key, ticket: a.ticket + 1 })); }, usable: !!fit && fit.status === "success" && reviewValid && !holds.length };
}

export function ImageRegistrationWizard({ image, registration, active, setActive, openPhoto, inspectNative }: { image: PixelImage | null; registration: ReturnType<typeof useImageRegistration>; active: string; setActive: (id: string) => void; openPhoto: () => void; inspectNative: (path: string) => void }) {
  const s = useScanSession(), p = s.archiveReview?.preflight, state = s.visual.view.imageRegistration, request = state?.request;
  const [step, setStep] = useState(1), [ack, setAck] = useState(false);
  useEffect(() => setAck(false), [request ? canonicalImageRequest(request) : ""]);
  const entities = useMemo(() => nativeEntities(p), [p]), modules = [...new Set(entities.map(e => e.module))];
  function edit(change: (r: ImageRegistrationRequest) => ImageRegistrationRequest) {
    setAck(false); s.visual.setView(old => old.imageRegistration ? { ...old, imageRegistration: invalidateImageReview(old.imageRegistration, change(old.imageRegistration.request)) } : old);
  }
  return <div aria-label="Image registration wizard">
    <p className={styles.eyebrow}>Read-only registration · no engineering edits</p><h2>Register image to native ROI</h2>
    <p className={styles.muted}>Select exact physical features and establish their conventions. A plausible overlay is not verification. R04 stays held until its missing evidence is recorded.</p>
    {!request && <button disabled={!image || !p || !["10.1", "10.2"].includes(p.nativeRecords.job?.schemaVersionClaim ?? "")} onClick={() => { if (image && p) s.visual.setView(old => ({ ...old, imageRegistration: newImageRegistration(p, image) })); }}>Start mapping for selected image</button>}
    {request && <>
      <div className={styles.decisions}>{[1, 2, 3].map(n => <button key={n} aria-pressed={step === n} onClick={() => setStep(n)}>{n === 1 ? "1 Identity / frame" : n === 2 ? "2 Correspondences" : "3 Check / review"}</button>)}</div>
      {registration.holds.length > 0 && <details open><summary>Mapping held</summary>{registration.holds.map((h, i) => <p className={styles.heldText} key={i}>{h}</p>)}</details>}
      {step === 1 && <div className={styles.registrationFields}>
        <p className={styles.hash}>{request.image.member}<br />Image {request.image.sha256}<br />{request.image.width} × {request.image.height} pixels · original snapshot</p>
        <label>Native module<select aria-label="Image mapping native module" value={request.scope.module} onChange={e => edit(r => ({ ...r, scope: { ...r.scope, module: e.target.value }, nativeBounds: p ? nativeImageBounds(p, e.target.value) : null, points: r.points.map(pt => ({ ...pt, identity: null, native: null, beforeRoi: null })) }))}><option value="">Select exact module</option>{modules.map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Photographed physical side<select aria-label="Photographed physical side" value={request.scope.physicalSide} onChange={e => edit(r => ({ ...r, scope: { ...r.scope, physicalSide: e.target.value as typeof r.scope.physicalSide } }))}><option value="unknown">Unknown · held</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
        {(["instance", "nativeRevision", "imageRevision"] as const).map(k => <label key={k}>{{ instance: "Physical panel instance", nativeRevision: "Native physical revision", imageRevision: "Image physical revision" }[k]}<input aria-label={`Mapping ${k}`} maxLength={256} value={request.scope[k]} onChange={e => edit(r => ({ ...r, scope: { ...r.scope, [k]: e.target.value } }))} /></label>)}
        <label>Revision / capture / instance evidence<textarea aria-label="Image scope evidence" maxLength={2048} value={request.scopeEvidence} onChange={e => edit(r => ({ ...r, scopeEvidence: e.target.value }))} /></label>
        <h3>Independently established native convention</h3>
        {(["module", "instance"] as const).map(k => <label key={k}>Native convention {k}<input aria-label={`Native convention ${k}`} maxLength={256} value={request.conventions[k]} onChange={e => edit(r => ({ ...r, conventions: { ...r.conventions, [k]: e.target.value } }))} /></label>)}
        <label>Native physical side<select aria-label="Native convention side" value={request.conventions.physicalSide} onChange={e => edit(r => ({ ...r, conventions: { ...r.conventions, physicalSide: e.target.value as typeof r.conventions.physicalSide } }))}><option value="unknown">Unknown</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
        <label>Native ROI unit<select aria-label="Native convention unit" value={request.conventions.unit} onChange={e => edit(r => ({ ...r, conventions: { ...r.conventions, unit: e.target.value as typeof r.conventions.unit } }))}><option value="unknown">Unknown</option><option value="mm">Millimeters</option><option value="in">Inches</option></select></label>
        <label>Native Y direction<select aria-label="Native convention Y" value={request.conventions.yDirection} onChange={e => edit(r => ({ ...r, conventions: { ...r.conventions, yDirection: e.target.value as typeof r.conventions.yDirection } }))}><option value="unknown">Unknown</option><option value="up">Y up · explicit pixel inversion</option><option value="down">Y down · preserve handedness</option></select></label>
        <label>Native ROI angle<select aria-label="Native convention angle" value={request.conventions.roiAngle} onChange={e => edit(r => ({ ...r, conventions: { ...r.conventions, roiAngle: e.target.value as typeof r.conventions.roiAngle } }))}><option value="unknown">Unknown</option><option value="clockwise">Clockwise degrees</option><option value="counterclockwise">Counterclockwise degrees</option></select></label>
        <label>Image distortion assumption<select aria-label="Image distortion assumption" value={request.conventions.distortion} onChange={e => edit(r => ({ ...r, conventions: { ...r.conventions, distortion: e.target.value as typeof r.conventions.distortion } }))}><option value="unknown">Unknown · held</option><option value="uniform-similarity">One uniform similarity · no local warps</option></select></label>
        <p>Anchor: literal native Roi/cx,cy. Qualify its physical meaning explicitly; stored centers, body origin, pad binding and inspection windows remain separate.</p>
        <label>Native units / axes / anchor / distortion evidence<textarea aria-label="Native convention evidence" maxLength={2048} value={request.conventions.evidence} onChange={e => edit(r => ({ ...r, conventions: { ...r.conventions, evidence: e.target.value } }))} /></label>
        <button onClick={() => setStep(2)}>Continue to correspondences</button>
      </div>}
      {step === 2 && <><p>Choose each exact native ROI feature, then select its same physical feature in the photo. Pixel picks are measurements, not pad ownership. Check point must be independent.</p>{request.points.map((pt, i) => <div className={styles.detail} key={pt.id}>
        <button aria-pressed={active === pt.id} onClick={() => { setActive(pt.id); openPhoto(); }}>Pick {pt.role} {i + 1} on photograph</button>
        <label>Native feature {i + 1}<select aria-label={`Native image control ${i + 1}`} value={pt.identity?.path ?? ""} onChange={e => edit(r => ({ ...r, points: r.points.map(point => point.id === pt.id && p ? nativeImageControl(p, e.target.value, point) : point) }))}><option value="">Select exact source identity</option>{entities.filter(e => e.module === request.scope.module).map(e => <option value={e.path} key={e.key}>{e.ref} · Part {e.id} · Master {e.master} · ({e.x}, {e.y})</option>)}</select></label>
        {pt.identity && <><small>Native ({pt.native?.join(", ")}) · module {pt.identity.module}</small><button onClick={() => inspectNative(pt.identity!.path)}>Inspect native control {i + 1}</button></>}
        {([0, 1] as const).map(axis => <label key={axis}>Pixel {axis === 0 ? "X" : "Y"}<input aria-label={`Control ${i + 1} pixel ${axis === 0 ? "X" : "Y"}`} type="number" step="any" placeholder="Unknown" value={imagePixelDraft(state!, pt.id)[axis]} onChange={e => { setAck(false); const value=e.target.value; s.visual.setView(old => old.imageRegistration ? { ...old, imageRegistration: editImagePixel(old.imageRegistration, pt.id, axis, value) } : old); }} /></label>)}
        <label>Same-feature / anchor evidence<textarea aria-label={`Control ${i + 1} evidence`} maxLength={512} value={pt.evidence} onChange={e => edit(r => ({ ...r, points: r.points.map(point => point.id === pt.id ? { ...point, evidence: e.target.value } : point) }))} /></label>
      </div>)}<button onClick={() => setStep(3)}>Continue to independent check</button></>}
      {step === 3 && <>
        <label>Pixel tolerance<input aria-label="Image registration tolerance" type="number" min="0.01" max="25" step="0.01" value={request.tolerancePx} onChange={e => { const n = Number(e.target.value); if (n >= .01 && n <= 25) edit(r => ({ ...r, tolerancePx: n })); }} /></label>
        <label>Engineering tolerance justification<textarea aria-label="Image tolerance evidence" maxLength={2048} value={request.toleranceEvidence} onChange={e => edit(r => ({ ...r, toleranceEvidence: e.target.value }))} /></label>
        <label>Reviewer<input aria-label="Image mapping reviewer" maxLength={256} value={request.reviewer} onChange={e => edit(r => ({ ...r, reviewer: e.target.value }))} /></label>
        <button disabled={registration.busy || registration.holds.length > 0} onClick={registration.calculate}>Calculate image registration</button>
        {registration.busy && <p role="status">Calculating measured pixel fit and independent check…</p>}{registration.error && <p role="alert">{registration.error}</p>}
        {registration.fit && <div data-testid="image-registration-result"><h3>{registration.fit.status === "success" ? "Controls pass · review required" : "Registration held · independent check"}</h3><p>{registration.fit.pixelsPerMm.toFixed(4)} pixels/mm · maximum {registration.fit.maxResidualPx.toFixed(4)} px / {(registration.fit.maxResidualPx/registration.fit.pixelsPerMm).toFixed(6)} mm from the declared scale. Uniform model only. Tolerance {request.tolerancePx} px / {(request.tolerancePx/registration.fit.pixelsPerMm).toFixed(6)} mm.</p><table className={styles.geometryTable}><thead><tr><th>Control</th><th>Role</th><th>Residual px</th><th>Derived mm</th></tr></thead><tbody>{registration.fit.residuals.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.role}</td><td>{r.residualPx.toFixed(4)} {r.withinTolerance ? "✓" : "held"}</td><td>{(r.residualPx/registration.fit!.pixelsPerMm).toFixed(6)}</td></tr>)}</tbody></table>{registration.fit.holds.map(h => <p className={styles.heldText} key={h}>{h}</p>)}<p>{registration.fit.qualification}</p></div>}
        <label className={styles.check}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I reviewed the physical/source conventions and independent check evidence.</label>
        <button className={styles.primary} disabled={!ack || registration.fit?.status !== "success" || registration.holds.length > 0 || registration.busy} onClick={() => { s.visual.setView(old => old.imageRegistration ? { ...old, imageRegistration: acceptImageReview(old.imageRegistration, registration.fit!.fingerprint) } : old); openPhoto(); }}>Use reviewed image mapping</button>
        {registration.reviewHolds.map((h,i)=><p key={i} className={styles.heldText} data-testid="image-review-hold">{h}</p>)}<p className={styles.muted}>Saved fingerprints detect changed context; they are not tamper-proof approval or machine authority.</p><p className={styles.heldText}>{registration.usable ? "Previously reviewed; freshly numerically rechecked · Eagle and physical/optical qualification unverified." : "No qualified automatic on-board crop until source binding, controls and review pass."}</p>
      </>}
      <button disabled={!image || !p} onClick={() => { if (image && p) s.visual.setView(old => ({ ...old, imageRegistration: newImageRegistration(p, image) })); setStep(1); setAck(false); }}>Reset draft for current image</button>
    </>}
  </div>;
}
