import type { SnapshotPreflight } from "./archive-types";

/** Literal scope only. Runtime propagation and engineering cause stay unknown. */
export function repairImpact(report: SnapshotPreflight, sourcePath: string, field: string, after: string) {
  const record = report.nativeRecords.job?.records.find(r => r.kind === "part-record" && r.sourcePath === sourcePath);
  if (!record) return null;
  const literal = (key: string) => record.rawFields[key]?.length === 1 ? record.rawFields[key][0] : null;
  const number = (key: string) => { const value = literal(key); return value !== null && value.trim() && Number.isFinite(Number(value)) && Math.abs(Number(value)) < 1e6 ? Number(value) : null; };
  const queue = report.nativeInspectionWork;
  const part = queue?.parts.find(p => p.sourcePath === sourcePath);
  const scope = queue?.scopes.find(s => s.id === part?.scopeId);
  const windows = scope?.masterMatchState === "unique-literal-match" ? queue?.windows.filter(w => scope.windowIds.includes(w.id)) ?? [] : [];
  const peers = queue?.parts.filter(p => scope?.partIds.includes(p.id)) ?? [];
  const binding = report.nativeBindings;
  const linked = binding?.bindings.filter(b => b.partSourcePath === sourcePath) ?? [];
  const [x, y, w, h, angle] = ["cx", "cy", "w", "h", "a"].map(k => number(`Roi/${k}`));
  const validAfter = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(after) && Number.isFinite(Number(after)) && Math.abs(Number(after)) < 1e6;
  const box = x !== null && y !== null && w !== null && h !== null && angle !== null && w > 0 && h > 0 ? { x, y, w, h, angle } : null;
  const beforeNumber = number(field);
  return { sourceSha256: report.source.sha256, snapshotId: report.snapshotId, sourcePath,
    identity: { reference: literal("RefID"), module: literal("ParentId"), partId: literal("ID"), masterKey: literal("MasterKey") },
    exactWrite: `${sourcePath}/${field}`, before: literal(field), after, deltaLiteralUnits: validAfter && beforeNumber !== null ? Number(after) - beforeNumber : null,
    beforeBox: box, afterBox: field === "Roi/cx" && box && validAfter ? { ...box, x: Number(after) } : null,
    classification: field === "ENABLE" ? "reviewed placement suppression experiment" : "isolated native scalar geometry experiment",
    cause: "not-established-by-numeric-difference", frame: "native stored placement ROI; units and runtime propagation unqualified",
    masterMatch: scope?.masterMatchState ?? "unavailable", masterPaths: scope?.masterPartSourcePaths ?? [],
    scopePlacements: peers.map(p => ({ sourcePath: p.sourcePath, identity: p.identityLiterals })),
    windows: windows.map(w => ({ sourcePath: w.sourcePath, id: w.rawFields.ID, group: w.rawFields.GroupID, parent: w.rawFields.ParentWndId,
      align: w.rawFields.AlignWndID, geometry: Object.fromEntries(Object.entries(w.rawFields).filter(([k]) => k.startsWith("RelRoi/"))), algorithmIds: w.algorithmIds })),
    bindingObservations: linked, bindingInventoryComplete: binding?.literalObservationsComplete === true,
    preservedBindingFields: Object.fromEntries(Object.entries(record.rawFields).filter(([key]) => /^(WND_PAD|ListGer|FovList|SubFovNum|FovOPT)/.test(key))),
    unresolved: ["Physical cause and intended datum need independent evidence; neither residual nor visual appearance establishes a defect.",
      "Only this scalar is written. Stored center/CAD, Master windows, algorithms, binding and FOV fields remain byte-preserved.",
      "If Eagle propagates placement geometry to dependent windows, their physical behavior can change despite unchanged window bytes; verify all listed windows and bindings.",
      "Native runtime coordinates, binding ownership, teaching and Eagle open/save/reopen remain unqualified."],
    machineQualified: false as const, inspectionRepairEstablished: false as const };
}
