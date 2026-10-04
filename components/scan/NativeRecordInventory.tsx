"use client";
import { useState } from "react";
import type { SnapshotPreflight } from "@/lib/scan/archive-types";

export function NativeRecordInventory({ report }: { report: SnapshotPreflight }) {
  const [filter, setFilter] = useState("");
  const records = Object.entries(report.nativeRecords).flatMap(([document, value]) => value.records.map(record => ({ document, ...record })));
  const matches = records.filter(record => `${record.document} ${record.kind} ${record.sourcePath} ${Object.values(record.rawFields).flat().join(" ")}`.toLowerCase().includes(filter.toLowerCase()));
  return <details className="scan-native-records"><summary>Native record inventory</summary>
    <p>Read-only field inventory for the observed JobContainer 10.2 structure. Values remain source strings. Units, sides, identities and dependencies have not been semantically qualified.</p>
    {Object.entries(report.nativeRecords).map(([document, value]) => <p key={document}><strong>{document}:</strong> {value.status === "recorded" ? `${value.records.length} XML records read; ${value.duplicateScalarFields?.length ?? 0} repeated scalar fields. Format claim ${value.schemaVersionClaim}; this is not the Eagle software version.` : value.reason}</p>)}
    {records.length > 0 && <><label className="scan-field">Find native record by raw field or source path<input value={filter} onChange={event => setFilter(event.target.value)} /></label><p>{matches.length} matching records. Showing {Math.min(matches.length, 50)}; the archive report includes all records.</p>
      {matches.slice(0, 50).map(record => <details key={`${record.document}:${record.sourcePath}`}><summary>{record.document} · {record.kind} · {record.sourcePath}</summary><dl className="scan-detail-grid">{Object.entries(record.rawFields).map(([field, values]) => <div key={field}><dt>{field}</dt><dd>{values.map((value, index) => <div key={index}>{value === "" ? "(empty source value)" : value}</div>)}</dd></div>)}</dl></details>)}
    </>}
    <p className="scan-caption">XML record counts are not programmed-component or inspection-coverage counts. Every original field and asset remains in the source snapshot.</p>
  </details>;
}
