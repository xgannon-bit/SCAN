import assert from "node:assert/strict";
import test from "node:test";
import { createDemoReport } from "../lib/scan/demo-report.ts";

const generatedAt = new Date("2026-10-03T12:00:00.000Z");

test("synthetic report keeps duplicate RefDes decisions and bottom-side identity distinct", () => {
  const decisions = Object.freeze({ "DEMO-F001": "Accepted", "DEMO-F002": "Rejected" });
  const report = createDemoReport(decisions, generatedAt);
  assert.equal(report.artifactType, "scan.synthetic-review-record");
  assert.equal(report.generatedAt, generatedAt.toISOString());
  assert.match(report.classification, /SYNTHETIC DEMO/);
  assert.deepEqual(report.summary, { total: 3, reviewed: 2, simulatedAccepted: 1, simulatedRejected: 1, unreviewed: 1 });
  assert.deepEqual(report.findings.map(item => [item.identity.moduleId, item.identity.side, item.identity.refDes, item.simulatedDecision]), [
    ["MODULE-A", "Top", "R7", "Accepted"],
    ["MODULE-B", "Top", "R7", "Rejected"],
    ["MODULE-A", "Bottom", "U3", "Unreviewed"],
  ]);
  assert.equal(new Set(report.findings.map(item => item.identity.placementId)).size, 3);
  assert.deepEqual(report.findings.map(item => item.debugItemId), ["DEMO-DBG001", "DEMO-DBG002", null]);
});

test("accepting every fictional finding never manufactures evidence or release", () => {
  const report = createDemoReport({ "DEMO-F001": "Accepted", "DEMO-F002": "Accepted", "DEMO-F003": "Accepted" }, generatedAt);
  assert.deepEqual(report.coverage, { represented: 3, enabled: null, taught: null, verified: null, released: null });
  assert.equal(report.source.sourceSha256, null);
  assert.equal(report.source.capturedSnapshot, null);
  assert.equal(report.source.analyzedFile, null);
  assert.equal(report.source.coordinateFrame, "unknown");
  assert.equal(report.machineJobExport.available, false);
  assert.ok(report.findings.every(item => item.sourceChanged === false && item.identity.masterModelId === null));
  assert.match(report.limitations.join(" "), /not an audit history/);
});

test("report ignores unknown identities and invalid choices without mutating fixtures", () => {
  const report = createDemoReport({ "not-a-finding": "Accepted", "DEMO-F001": "Released" }, generatedAt);
  assert.equal(report.summary.reviewed, 0);
  assert.equal(report.summary.unreviewed, 3);
  report.findings[0].identity.moduleId = "modified-copy";
  const fresh = createDemoReport({}, generatedAt);
  assert.equal(fresh.findings[0].identity.moduleId, "MODULE-A");
  assert.deepEqual(fresh, createDemoReport({}, generatedAt));
});
