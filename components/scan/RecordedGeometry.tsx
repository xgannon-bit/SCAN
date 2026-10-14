"use client";
import { useId, useState } from "react";
import type { VisualEvent } from "@/lib/scan/visual-workspace";
import styles from "./VisualWorkspace.module.css";

/** A frozen component scope. Never reads current engineering data or calls an API. */
export function RecordedGeometry({ event, exit }: { event: VisualEvent; exit: () => void }) {
  const [zoom, setZoom] = useState(1), grid = useId().replace(/:/g, "");
  const geometry = event.geometry, identity = geometry?.identity;
  const points = geometry ? [geometry.before, geometry.after].filter(p => p !== null) : [];
  const x = points.length ? (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2 : 0;
  const y = points.length ? (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2 : 0;
  const span = Math.max(10, ...points.map(p => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) * 2 + Math.max(p.width, p.height) * 3)) / zoom;
  const mark = span / 100;
  return <div className={styles.body} aria-label="Recorded geometry view">
    <div className={styles.canvasWrap}>
      <div className={styles.replayBanner}>Recorded event replay · read only · affected component only<button onClick={exit}>Return to live</button></div>
      <svg className={styles.canvas} role="img" aria-label="Recorded component geometry" viewBox={`${x - span / 2} ${y - span / 2} ${span} ${span}`}>
        <defs><pattern id={grid} width={span / 12} height={span / 12} patternUnits="userSpaceOnUse"><path d={`M ${span / 12} 0 L 0 0 0 ${span / 12}`} fill="none" stroke="#243d52" strokeWidth={mark / 12} /></pattern></defs>
        <rect x={x - span / 2} y={y - span / 2} width={span} height={span} fill={`url(#${grid})`} />
        {geometry?.before && <line x1={geometry.before.x} y1={geometry.before.y} x2={geometry.after.x} y2={geometry.after.y} stroke="#e7b778" strokeWidth={mark / 4} strokeDasharray={`${mark} ${mark}`} />}
        {geometry && ([['before', geometry.before], ['after', geometry.after]] as const).map(([phase, roi]) => roi && <g key={phase} data-recorded-phase={phase} data-ref={identity!.ref} data-x={roi.x} data-y={roi.y} stroke={phase === 'before' ? '#65d7e5' : '#e7b778'} fill="none" strokeWidth={mark / 4}>
          <rect x={roi.x - roi.width / 2} y={roi.y - roi.height / 2} width={roi.width} height={roi.height} transform={`rotate(${roi.angle} ${roi.x} ${roi.y})`} strokeDasharray={phase === 'before' ? `${mark} ${mark / 2}` : undefined} />
          <path d={`M${roi.x - mark} ${roi.y}h${mark * 2}M${roi.x} ${roi.y - mark}v${mark * 2}`} />
          <text x={roi.x} y={roi.y + (phase === 'before' ? -1 : 1) * (Math.max(roi.width, roi.height) / 2 + mark * 4)} fontSize={mark * 2.5} textAnchor="middle" stroke="none" fill={phase === 'before' ? '#65d7e5' : '#e7b778'}>{identity!.ref} · {phase === 'before' ? 'original' : 'checked staged result'}</text>
        </g>)}
      </svg>
      {!geometry && <div className={styles.empty}><h2>No geometry recorded for this event</h2><p>Its recorded message is available. Current source geometry is not substituted into the past.</p></div>}
      <div className={styles.canvasLegend}>Frozen native ROI literals · side, units and angle convention unqualified · no scan registration</div>
      {geometry && <div className={styles.cameraTools}><button onClick={() => setZoom(z => Math.min(8, z * 1.3))}>Zoom in</button><button onClick={() => setZoom(z => Math.max(.25, z / 1.3))}>Zoom out</button><button onClick={() => setZoom(1)}>Fit recorded scope</button></div>}
    </div>
    <aside className={styles.inspector} aria-label="Recorded event inspector"><div className={styles.inspectorBody}>
      <p className={styles.eyebrow}>Recorded worker evidence · presentation only</p><h2>{identity?.ref ?? event.stage}</h2><p>{event.message}</p>
      {identity && geometry && <><dl><dt>Module / Part / Master</dt><dd>{identity.module} / {identity.id} / {identity.master}</dd></dl><div className={styles.detail}><h3>Original → checked result</h3>{(['x', 'y', 'width', 'height', 'angle'] as const).map(key => <p key={key}>{key}: <code>{geometry.before?.[key] ?? 'new record'} → {geometry.after[key]}</code></p>)}</div><p>Recorded after the worker checked the affected XML geometry. It is not an independent diagnosis or proof of a published candidate. Use the candidate receipt and fresh read-back for delivery verification.</p></>}
      <p className={styles.hash}>Source context / archive SHA-256<br />{event.source}</p><p>{event.at}</p><p className={styles.heldText}>Binding, FOV coverage, teaching, position retention and Eagle compatibility are unverified. Replay cannot accept a proposal or execute a repair.</p>
    </div></aside>
  </div>;
}
