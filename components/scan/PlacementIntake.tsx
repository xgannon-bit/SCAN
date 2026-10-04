"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, Download, Upload, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useScanSession } from "./ScanSession";
import styles from "./PlacementIntake.module.css";

const columnName = (index: number): string => index > 26 ? columnName(Math.floor((index - 1) / 26)) + String.fromCharCode(65 + (index - 1) % 26) : String.fromCharCode(64 + index);

export function PlacementIntake() {
  const { file, preview, result, config, sheet, delimiter, busy, error, edit, changeFile, changeSheet, changeDelimiter, reset, cancel, run, download } = useScanSession();
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!file && fileInput.current) fileInput.current.value = ""; }, [file]);

  return <div className={styles.page}>
    <div className={styles.header}>
      <p>Read your placement spreadsheet and review its coordinates locally.</p>
      <Button variant="outline" onClick={reset}><X size={16} /> Clear file</Button>
    </div>
    <section className={styles.panel} aria-labelledby="source-title">
      <h2 id="source-title">1. Select source</h2>
      <p>Files are processed on this laptop. Originals are read only. Your selected file and mapping stay available across SCAN screens. Refresh or Clear file resets the session.</p>
      <fieldset disabled={busy} className={styles.grid}>
        <label>Placement file (.xlsx or .csv)<input ref={fileInput} type="file" accept=".xlsx,.csv" onChange={(e) => changeFile(e.target.files?.[0] || null)} /></label>
        <label>CSV delimiter<select value={delimiter} onChange={(e) => changeDelimiter(e.target.value)}><option value=",">Comma</option><option value=";">Semicolon</option><option value={"\t"}>Tab</option></select></label>
        <label>Worksheet index (starts at 0)<input type="number" min="0" max="19" value={sheet} onChange={(e) => changeSheet(Number(e.target.value))} /></label>
      </fieldset>
      <div className={styles.actions}><Button disabled={!file || busy} onClick={() => run("inspect")}><Upload size={16} /> Read file</Button>{busy && <Button variant="outline" onClick={cancel}>Cancel import</Button>}<span aria-live="polite">{busy ? "Reading and validating source…" : file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "8 MB maximum"}</span></div>
      {preview && <><p>{preview.rowCount} source rows · {preview.columnCount} columns · sheet {preview.sheetIndex}. Worksheets: {preview.sheets.map(s => `${s.index}: ${s.name}`).join(", ")}.</p><div className={styles.scroll}><table><caption>First six rows, including any headers. Confirm the column meanings below.</caption><thead><tr><th>Row</th>{Array.from({ length: preview.columnCount }, (_, i) => <th key={i}>{columnName(i + 1)}</th>)}</tr></thead><tbody>{preview.preview.map((row, i) => <tr key={i}><th>{i + 1}</th>{row.map((value, j) => <td key={j}>{value === null ? "—" : String(value)}</td>)}</tr>)}</tbody></table></div></>}
    </section>
    {preview && <section className={styles.panel} aria-labelledby="mapping-title">
      <h2 id="mapping-title">2. Confirm mapping and conventions</h2>
      <p>Column choices are editable starting points. Check them against the preview. Headerless sheets start at row 1. Board side does not apply a mirror.</p>
      <fieldset disabled={busy} className={styles.grid}>
        <label>Coordinate layout<select value={config.columns.xy ? "combined" : "separate"} onChange={(e) => { const columns = { ...config.columns }; delete columns.xy; delete columns.x; delete columns.y; if (e.target.value === "combined") columns.xy = 4; else { columns.x = 3; columns.y = 4; } edit({ columns }); }}><option value="combined">Combined XY cell</option><option value="separate">Separate X and Y columns</option></select></label>
        <label>First data row<input type="number" min="1" max={preview.rowCount} value={config.startRow} onChange={(e) => edit({ startRow: Number(e.target.value) })} /></label>
        {([['refdes', 'Reference designator'], ['mpn', 'MPN'], ...(config.columns.xy ? [['xy', 'Combined XY']] : [['x', 'X'], ['y', 'Y']]), ['rotation', 'Rotation'], ['side', 'Board side'], ['module', 'Module'], ['footprint', 'Footprint']] as string[][]).map(([field, label]) => <label key={field}>{label} column<select value={config.columns[field] || 0} onChange={(e) => { const columns = { ...config.columns }; if (Number(e.target.value)) columns[field] = Number(e.target.value); else delete columns[field]; edit({ columns }); }}><option value="0">Not mapped</option>{Array.from({ length: preview.columnCount }, (_, i) => <option key={i} value={i + 1}>{columnName(i + 1)}</option>)}</select></label>)}
        {!config.columns.module && <label>Module for this sheet<input value={config.module} maxLength={256} placeholder="Enter the module identity" onChange={(e) => edit({ module: e.target.value })} /></label>}
        {!config.columns.side && <label>Board side for this sheet<select value={config.side} onChange={(e) => edit({ side: e.target.value })}><option value="">Select side</option><option>Top</option><option>Bottom</option></select></label>}
        <label>Placement units<select value={config.units} onChange={(e) => edit({ units: e.target.value })}><option value="unknown">Unconfirmed</option><option value="mm">Millimeters</option><option value="inch">Inches</option><option value="mil">Mils (0.001 inch)</option></select></label>
        <label>Source rotation direction<select value={config.rotationDirection} onChange={(e) => edit({ rotationDirection: e.target.value })}><option value="unknown">Unconfirmed</option><option value="ccw">Counterclockwise degrees</option><option value="cw">Clockwise degrees</option></select></label>
        <label>Decimal separator<select value={config.decimalSeparator} onChange={(e) => edit({ decimalSeparator: e.target.value })}><option value=".">Point (1.25)</option><option value=",">Comma (1,25)</option></select></label>
        {config.columns.xy && <label>XY separator<select value={config.pairSeparator} onChange={(e) => edit({ pairSeparator: e.target.value })}><option value=",">Comma</option><option value=";">Semicolon</option><option value="space">Whitespace</option></select></label>}
      </fieldset>
      <Button disabled={busy} onClick={() => run("normalize")}>Validate placements</Button>
    </section>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {result && <section className={styles.panel} aria-labelledby="result-title">
      <h2 id="result-title">3. Placement review</h2>
      <p role="status"><strong>{result.status === "success" ? "Placement parsing complete" : "Placement review needs attention"}</strong> · {result.counts.parsed} parsed · {result.counts.errors} errors · {result.counts.warnings} warnings · {result.counts.skippedBlank} blank rows skipped</p>
      {result.holds.length > 0 && <ul>{result.holds.map(hold => <li key={hold}>{hold}</li>)}</ul>}
      <p>Coordinates below remain in the source CAD frame, converted to millimeters where confirmed. No origin shift, Gerber alignment, or bottom-side mirror has been applied. Rotation is counterclockwise where confirmed.</p>
      <div className={styles.scroll}><table><caption>First {Math.min(result.placements.length, 50)} parsed placements</caption><thead><tr>{['Module', 'Side', 'Reference', 'MPN', 'X (mm)', 'Y (mm)', 'Rotation (°)'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{result.placements.slice(0, 50).map((p, i) => <tr key={`${p.placementId}-${i}`}><td>{p.module}</td><td>{p.side}</td><td>{p.refdes}</td><td>{p.mpn ?? "Unknown"}</td><td>{p.xMm ?? "Unconfirmed"}</td><td>{p.yMm ?? "Unconfirmed"}</td><td>{p.rotationCcwDegrees ?? "Unconfirmed"}</td></tr>)}</tbody></table></div>
      {result.issues.length > 0 && <details open><summary>Row issues ({result.issues.length})</summary><ul>{result.issues.slice(0, 100).map((issue, i) => <li key={i}>Row {issue.row} · {issue.severity}: {issue.message}</li>)}</ul>{result.issues.length > 100 && <p>Showing the first 100 issues. Resolve these and validate again.</p>}</details>}
      <details><summary>Source identity</summary><p className={styles.hash}>SHA-256: {result.sourceSha256}</p></details>
      <div className={styles.actions}><Button disabled={result.status !== "success"} onClick={download}><Download size={16} /> Save placement record (JSON)</Button><Button variant="outline" disabled>Export Eagle/Athena job</Button><Link href="/workspace" className={buttonVariants({ variant: "outline" })}>Open board workspace<ArrowRight aria-hidden="true" /></Link><Link href="/findings" className={buttonVariants({ variant: "ghost" })}>Review source findings</Link></div>
      <p>The JSON contains the complete parsed placement set and its source hash. It is a SCAN record, not a machine job. Native job construction, model binding, and machine compatibility checks remain outstanding.</p>
    </section>}
  </div>;
}
