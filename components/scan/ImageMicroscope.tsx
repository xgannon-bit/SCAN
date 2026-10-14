"use client";
import type { VisualEntity, VisualWorkspaceState } from "@/lib/scan/visual-workspace";
import { photoRoi, imagePoint, type ImageRegistrationFit, type ImageRegistrationRequest } from "@/lib/scan/image-registration";
import { useScanSession } from "./ScanSession";
import styles from "./VisualWorkspace.module.css";

export const defaultImageLayers = (): NonNullable<VisualWorkspaceState["imageLayers"]> => ({ native: true, cad: false, gerber: false, controls: true, processing: false, proposals: false, dimUnselected: false, filter: "all", preset: "placement-review", cropRadiusMm: 5 });
export function ImageMicroscope({ image, entity, proposed, request, fit, returnToBoard }: { image: { url: string; width: number; height: number; member: string; sha256: string }; entity: VisualEntity; proposed?: VisualEntity | null; request: ImageRegistrationRequest; fit: ImageRegistrationFit; returnToBoard: () => void }) {
  const s = useScanSession(), layers = s.visual.view.imageLayers ?? defaultImageLayers(), radius = layers.cropRadiusMm*fit.pixelsPerMm;
  const center = imagePoint(fit.matrix,entity.x,entity.y), roi = photoRoi(entity,request,fit.matrix);
  if (entity.module !== request.scope.module || center.x < 0 || center.y < 0 || center.x >= image.width || center.y >= image.height) return <p className={styles.heldText}>On-board crop held: component belongs to another mapped instance or lies outside this image.</p>;
  const x=Math.max(0,center.x-radius), y=Math.max(0,center.y-radius), width=Math.min(image.width,center.x+radius)-x, height=Math.min(image.height,center.y+radius)-y;
  return <div aria-label="Component microscope">
    <h3>{entity.ref} · mapped on-board detail</h3><p>Module {entity.module} / {request.scope.physicalSide} / {request.scope.instance}. Literal ROI area; body origin, teaching and optical correctness remain separate.</p>
    <svg className={styles.microscope} role="img" aria-label={`Registered on-board crop ${entity.ref}`} viewBox={`${x} ${y} ${width} ${height}`} data-center-x={center.x} data-center-y={center.y} data-image-sha256={image.sha256}>
      <image href={image.url} width={image.width} height={image.height} />
      {roi && <polygon points={roi} fill="none" stroke="#76e5f4" strokeWidth={width/150} />}
      <path d={`M${center.x-width/20} ${center.y}h${width/10}M${center.x} ${center.y-height/20}v${height/10}`} stroke="#76e5f4" strokeWidth={width/200} />
      {proposed && photoRoi(proposed,request,fit.matrix) && <polygon points={photoRoi(proposed,request,fit.matrix)!} fill="none" stroke="#f4c47a" strokeDasharray={`${width/60} ${width/80}`} strokeWidth={width/150} />}
    </svg>
    <label>Crop context radius · mm<input aria-label="Microscope context radius" type="range" min="0.1" max="20" step="0.1" value={layers.cropRadiusMm} onChange={e => s.visual.setView(old=>({...old,imageLayers:{...(old.imageLayers??defaultImageLayers()),cropRadiusMm:Number(e.target.value)}}))} /></label>
    <p>Measured image point ({center.x.toFixed(2)}, {center.y.toFixed(2)}) px · {image.width} × {image.height} original raster. No OK/NG or inspection PASS claim.</p>
    {!roi && <p className={styles.heldText}>ROI dimensions/orientation unavailable; only the supported origin is shown.</p>}
    <p className={styles.heldText}>Inspection windows, pad binding and FOV coverage require their separate native-coordinate qualification.</p>
    <button onClick={returnToBoard}>Return to previous photo viewport</button>
    <details><summary>Crop / mapping provenance</summary><p className={styles.hash}>{image.member}<br />Image SHA-256 {image.sha256}<br />Job SHA-256 {request.source.jobSha256}<br />Request SHA-256 {fit.fingerprint}</p><p>Pixel box ({x.toFixed(3)}, {y.toFixed(3)}) {width.toFixed(3)} × {height.toFixed(3)}. Reviewer evidence: {request.scopeEvidence}</p></details>
  </div>;
}
