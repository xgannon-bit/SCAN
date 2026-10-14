import type { NativeDiagnosisReport } from "@/lib/scan/native-placement-diagnosis";
import type { registeredBoardLayers } from "@/lib/scan/registered-board-layers";
import type { NativeControl } from "@/lib/scan/registration-controls";
import styles from "./VisualWorkspace.module.css";

export function RegistrationEvidence({ layers, report, controls, selected, focus, configure }: { layers: ReturnType<typeof registeredBoardLayers>; report: NativeDiagnosisReport | null; controls: NativeControl[]; selected: string; focus: (control: NativeControl) => void; configure: () => void }) {
  return <section className={styles.detail} aria-label="Native registration evidence">
    <h3>Source registration on this board</h3>
    <p>CAD: {layers.cad.status} · Gerber: {layers.gerber.status}. Scan imagery is separately unregistered.</p>
    {report && <><p>Declared revisions: PCB/CAD {report.settings.sourceRevision || "unknown"} · native {report.settings.nativeRevision || "unknown"} · BOM {report.settings.bomRevision || "unknown"}.</p><p>{report.settings.frameStatement || "Physical coordinate conventions remain unknown."}</p><p>Tolerance {report.settings.toleranceMm} mm — {report.settings.toleranceBasis || "basis missing"}</p></>}
    {[...new Map([...layers.cad.holds, ...layers.gerber.holds].map(h => [h.code, h])).values()].map(h => <details key={h.code}><summary>{h.code}</summary><p>{h.reason}</p></details>)}
    {!!controls.length && <><p>Measured footprint-origin controls, not inspection centers. Select a control to locate it on the full board.</p><table className={styles.geometryTable}><thead><tr><th>Control</th><th>CAD → PCB mm</th><th>PCB → native mm</th></tr></thead><tbody>{controls.map(c => <tr key={c.reference}><th><button aria-pressed={selected === c.reference} onClick={() => focus(c)}>{c.reference} · {c.role}</button></th><td>{c.sourceResidualMm?.toFixed(5) ?? "held"}</td><td>{c.residualMm?.toFixed(5) ?? "held"}</td></tr>)}</tbody></table></>}
    <p>Registration establishes a scoped comparison only. Pad ownership, inspection correctness and Eagle qualification remain separate.</p>
    <button onClick={configure}>Review registration sources / conventions</button>
  </section>;
}
