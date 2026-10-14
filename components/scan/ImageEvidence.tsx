"use client";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { imageRoles, referenceForPlacement, type ImageCatalog, type ImageAsset } from "@/lib/scan/image-evidence";
import type { VisualEntity, VisualWorkspaceState } from "@/lib/scan/visual-workspace";
import { useScanSession } from "./ScanSession";
import { usePreservedRaster } from "./VisualImage";
import styles from "./VisualWorkspace.module.css";

export const defaultImageDisplay = () => ({ preset: "native-evidence" as "clean-image" | "native-evidence", role: "all" as "all" | ImageAsset["role"], opacity: 1, brightness: 1, referenceOpen: false, note: null });

export function SelectedImageControls({ image, note, bookmark }: { image: { url: string; width: number; height: number; sha256: string; member: string }; note: NonNullable<VisualWorkspaceState["imageDisplay"]>["note"]; bookmark: () => void }) {
  const s = useScanSession(), d = s.visual.view.imageDisplay ?? defaultImageDisplay();
  return <div className={styles.detail}><h3>Selected original pixels</h3><p>{image.width} × {image.height} px · original bytes verified</p><p className={styles.hash}>{image.member}<br />SHA-256 {image.sha256}</p>
    <label>Image opacity<input aria-label="Image opacity" type="range" min="0.1" max="1" step="0.1" value={d.opacity} onChange={e => s.visual.setView(old => ({ ...old, imageDisplay: { ...(old.imageDisplay ?? defaultImageDisplay()), opacity: Number(e.target.value) } }))} /></label>
    <label>Display brightness<input aria-label="Display brightness" type="range" min="0.5" max="2" step="0.1" value={d.brightness} onChange={e => s.visual.setView(old => ({ ...old, imageDisplay: { ...(old.imageDisplay ?? defaultImageDisplay()), brightness: Number(e.target.value) } }))} /></label>
    <button onClick={bookmark}>Bookmark visible pixel region</button>
    {note && <><h3>Unregistered image note</h3><p>Pixel box ({note.x.toFixed(1)}, {note.y.toFixed(1)}) · {note.width.toFixed(1)} × {note.height.toFixed(1)}. No component association or calibrated crop.</p><svg className={styles.pixelNote} role="img" aria-label="Unregistered manual pixel note" viewBox={`${note.x} ${note.y} ${note.width} ${note.height}`}><image href={image.url} x={0} y={0} width={image.width} height={image.height} /></svg></>}
  </div>;
}

export function ImageGallery({ catalog, busy, error, request, choose, selectedUrl }: { catalog: ImageCatalog | null; busy: boolean; error: string; request: () => void; choose: (asset: ImageAsset) => void; selectedUrl?: string }) {
  const s = useScanSession(), d = s.visual.view.imageDisplay ?? defaultImageDisplay();
  return <div aria-label="Eagle image gallery">
    <p className={styles.eyebrow}>Preserved source photography</p><h2>Eagle image gallery</h2>
    <p className={styles.muted}>Explicit asset selection. Storage folders identify image roles; side, module, illumination and optical OK status remain unknown.</p>
    {!catalog && <button onClick={request} disabled={busy || !s.archiveReview}>Read image inventory</button>}
    {busy && <p role="status">Verifying image inventory…</p>}{error && <p role="alert">{error}</p>}
    {catalog && <><p>{catalog.entries.length} assets · {catalog.omittedAssets} omitted by bounds. Raster headers verified; pixels decode only on selection.</p>
      <label>Image role<select aria-label="Image gallery role" value={d.role} onChange={e => s.visual.setView(old => ({ ...old, imageDisplay: { ...(old.imageDisplay ?? defaultImageDisplay()), role: e.target.value as typeof d.role } }))}><option value="all">All roles</option>{Object.entries(imageRoles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {Object.entries(imageRoles).filter(([key]) => d.role === "all" || d.role === key).map(([key, label]) => <section key={key} className={styles.imageGroup}><h3>{label} <span>{catalog.entries.filter(e => e.role === key).length}</span></h3>
        {catalog.entries.filter(e => e.role === key).map(a => <button className={styles.imageCard} key={a.member} aria-label={`View ${a.member.split("/").at(-1)} · ${imageRoles[a.role]}`} aria-pressed={s.visual.view.image?.member === a.member} disabled={busy || a.preview === "held"} onClick={() => choose(a)} title={a.reason}>
          {selectedUrl && s.visual.view.image?.member === a.member ? <img src={selectedUrl} alt="Selected preserved raster thumbnail" /> : <span className={styles.assetIcon} aria-hidden="true">{a.preview === "held" ? "◇" : "▧"}</span>}
          <span><strong>{a.member.split("/").at(-1)}</strong><small>{a.width ? `${a.width} × ${a.height} px` : "Preview held"} · {(a.size / 1e6).toFixed(2)} MB</small><small>{a.reason}</small></span>
        </button>)}
      </section>)}
      <details><summary>Selected snapshot provenance</summary><p className={styles.hash}>Archive {catalog.sourceSha256}<br />Job {catalog.selection.job.member}<br />Master {catalog.selection.master?.member ?? "not selected"}<br />Capture {catalog.packageSha256}</p></details>
    </>}
  </div>;
}

export function ComponentImageEvidence({ entity, catalog, candidateView, blocked, request, onBusy, onBoard }: { entity: VisualEntity; catalog: ImageCatalog | null; candidateView: boolean; blocked: boolean; request: () => void; onBusy: (busy: boolean) => void; onBoard?: ReactNode }) {
  const s = useScanSession(), d = s.visual.view.imageDisplay ?? defaultImageDisplay();
  const linked = candidateView ? { asset: null, reason: "Candidate reference viewing is held; select the original snapshot for this image catalog.", masterPath: null, code: null } : referenceForPlacement(s.archiveReview?.preflight, catalog, entity);
  const raster = usePreservedRaster(linked.asset && catalog ? { archiveSha256: catalog.sourceSha256, member: linked.asset.member } : null, d.referenceOpen && !blocked && linked.asset?.preview === "supported-header", "Model reference image");
  useEffect(() => { onBusy(raster.busy); return () => onBusy(false); }, [raster.busy, onBusy]);
  return <div className={styles.detail} aria-label="Component image evidence">
    <div className={styles.decisions}><button aria-pressed={!d.referenceOpen} onClick={() => s.visual.setView(old => ({ ...old, imageDisplay: { ...(old.imageDisplay ?? defaultImageDisplay()), referenceOpen: false } }))}>On-board detail</button><button aria-pressed={d.referenceOpen} onClick={() => { request(); s.visual.setView(old => ({ ...old, imageDisplay: { ...(old.imageDisplay ?? defaultImageDisplay()), referenceOpen: true } })); }}>Reference image</button></div>
    {!d.referenceOpen ? onBoard ?? <><h3>On-board crop — registration required</h3><p className={styles.heldText}>No qualified pixel mapping for module {entity.module}, Part {entity.id}. This reference photograph cannot locate the board instance.</p></> : <>
      <h3>Model reference photo</h3><p className={styles.referenceBadge}>Reference/model image — not this board capture or an Eagle OK image</p>
      <p>{linked.reason}</p>{!catalog && <button disabled={blocked} onClick={request}>Read image inventory</button>}
      {raster.busy && <p role="status">Verifying model reference pixels…</p>}{raster.error && <><p role="alert">{raster.error}</p><button disabled={blocked || raster.busy} onClick={raster.retry}>Retry reference preview</button></>}
      {linked.asset?.preview === "held" && <p className={styles.heldText}>{linked.asset.reason}</p>}
      {raster.image && <><img className={styles.referencePhoto} data-testid="model-reference-photo" src={raster.image.url} alt={`Model reference for ${entity.ref}, Master ${entity.master}; not this board instance`} /><p>{raster.image.width} × {raster.image.height} original pixels · preserved bytes and decode verified</p></>}
      {linked.asset && <details><summary>Exact model/image correspondence</summary><p>Module {entity.module} · RefID {entity.ref} · Part {entity.id} · MasterKey {entity.master}</p><p className={styles.hash}>{entity.path}<br />{linked.masterPath}<br />PartCode {linked.code}<br />{linked.asset.member}<br />Image SHA-256 {linked.asset.sha256}<br />Master SHA-256 {catalog?.selection.master?.sha256}</p><p>No nearest match, filename normalization or component appearance match.</p></details>}
    </>}
  </div>;
}
