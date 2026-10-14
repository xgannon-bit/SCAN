"use client";
import { useScanSession } from "./ScanSession";
import { defaultImageLayers } from "./ImageMicroscope";
import styles from "./VisualWorkspace.module.css";
export const photoPresets = { "clean-board": "Clean Board", "placement-review": "Placement Review", "alignment-analysis": "Alignment Analysis", "component-inspection": "Component Inspection", "repair-review": "Repair Review", "visual-rebuild": "Visual Rebuild" };
export function ImageLayers({ mapped, cad, gerber, holds }: { mapped: boolean; cad: boolean; gerber: boolean; holds: string[] }) {
  const s = useScanSession(), layers = s.visual.view.imageLayers ?? defaultImageLayers();
  function preset(p: typeof layers.preset) {
    s.visual.setView(old=>({...old,imageLayers:{...(old.imageLayers??defaultImageLayers()),preset:p,native:p!=="clean-board",cad:p==="alignment-analysis",gerber:p==="alignment-analysis",controls:p==="alignment-analysis",processing:p==="visual-rebuild",proposals:p==="repair-review",dimUnselected:p==="component-inspection"}}));
  }
  return <div className={styles.detail} aria-label="Photographic engineering layers"><h3>Photographic layers</h3>
    <label>Layer preset<select aria-label="Photographic layer preset" value={layers.preset} onChange={e=>preset(e.target.value as typeof layers.preset)}>{Object.entries(photoPresets).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label>
    <p>Original photography · verified member pixels. Geometry needs its independently reviewed frame; visibility grants no authority.</p>
    {(["native","cad","gerber","controls","proposals","processing","dimUnselected"] as const).map(k=><label className={styles.check} key={k}><input type="checkbox" checked={layers[k]} disabled={k==="cad"?!cad:k==="gerber"?!gerber:!mapped} onChange={e=>s.visual.setView(old=>({...old,imageLayers:{...(old.imageLayers??defaultImageLayers()),[k]:e.target.checked}}))} />{{native:"Native ROI / origins",cad:"CAD origins · source-frame diagnostic",gerber:"Gerber geometry · source-frame diagnostic",controls:"Fit/check controls and measured residuals",proposals:"Original / proposed repair previews",processing:"Real component processing / recorded outcomes",dimUnselected:"Dim unrelated components"}[k]}</label>)}
    <label>Engineering filter<select aria-label="Photographic engineering filter" value={layers.filter} onChange={e=>s.visual.setView(old=>({...old,imageLayers:{...(old.imageLayers??defaultImageLayers()),filter:e.target.value as typeof layers.filter}}))}><option value="all">All scoped native placements</option><option value="held">Held by current engineering findings</option><option value="proposed">Exact current proposals</option><option value="written">Fresh candidate literal write read-back</option></select></label>
    <p className={styles.heldText}>Inspection windows, binding/FOV coverage and image-dependent teaching stay held. Native ROI is not a taught window.</p>
    {!mapped && <p className={styles.heldText}>Image geometry held: registration/source evidence or review is incomplete.</p>}{holds.map((h,i)=><p className={styles.heldText} key={i}>{h}</p>)}
    <p className={styles.hash}>Archive {s.archiveReview?.preflight.source.sha256}<br />Image {s.visual.view.imageRegistration?.request.image.sha256??"not registered"}<br />Native job {s.archiveReview?.preflight.selection.job.sha256}</p>
  </div>;
}
