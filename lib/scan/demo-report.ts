import { DEMO_FINDINGS, DEMO_LABEL } from "./demo-fixtures";

export type DemoDecision = "Accepted" | "Rejected";
export type DemoDecisions = Readonly<Record<string, DemoDecision>>;

// A presentation record, deliberately separate from the analyzer/session protocol.
// Null means unknown or absent; a simulated decision never supplies real evidence.
export function createDemoReport(decisions: DemoDecisions, generatedAt = new Date()) {
  const findings = DEMO_FINDINGS.map(finding => {
    const decision = decisions[finding.id];
    const reviewed = decision === "Accepted" || decision === "Rejected";
    return {
      findingId: finding.id,
      debugItemId: reviewed ? finding.debugId : null,
      identity: {
        moduleId: finding.moduleId,
        side: finding.side,
        placementId: finding.placementId,
        refDes: finding.refDes,
        masterModelId: null,
      },
      title: finding.title,
      authoredEvidence: finding.evidence,
      before: finding.before,
      proposedAnnotation: finding.proposed,
      simulatedDecision: reviewed ? decision : "Unreviewed",
      sourceChanged: false,
    };
  });
  const accepted = findings.filter(item => item.simulatedDecision === "Accepted").length;
  const rejected = findings.filter(item => item.simulatedDecision === "Rejected").length;
  return {
    schemaVersion: "1",
    artifactType: "scan.synthetic-review-record",
    classification: DEMO_LABEL,
    fixtureId: "DEMO-SESSION-001",
    generatedAt: generatedAt.toISOString(),
    source: {
      kind: "Authored presentation fixtures",
      revision: "FICTION-R1",
      analyzedFile: null,
      capturedSnapshot: null,
      sourceSha256: null,
      coordinateFrame: "unknown",
      units: "unknown",
    },
    summary: {
      total: findings.length,
      reviewed: accepted + rejected,
      simulatedAccepted: accepted,
      simulatedRejected: rejected,
      unreviewed: findings.length - accepted - rejected,
    },
    coverage: { represented: findings.length, enabled: null, taught: null, verified: null, released: null },
    machineJobExport: { available: false, reason: "No captured source, qualified writer, compatibility evidence or approved repair." },
    limitations: [
      "This is a synthetic presentation record, not an analyzer result or a machine job.",
      "No file was analyzed or changed. All findings and proposals were authored for the demo.",
      "Acceptance records a simulated review choice; it does not verify, teach, validate or release anything.",
      "This record reflects the current choices only; it is not an audit history.",
      "Browser refresh or Restart demo clears the session. Downloaded records remain on this computer.",
    ],
    findings,
  };
}
