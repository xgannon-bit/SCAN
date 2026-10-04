// Authored fictional presentation data. Not an analyzer result or native job model.
export const DEMO_LABEL = "SYNTHETIC DEMO — NOT REAL JOB ANALYSIS";

export type DemoFinding = Readonly<{
  id: string;
  moduleId: string;
  side: "Top" | "Bottom";
  placementId: string;
  refDes: string;
  title: string;
  evidence: string;
  before: string;
  proposed: string;
  debugId: string;
}>;

export const DEMO_FINDINGS: readonly DemoFinding[] = [
  {
    id: "DEMO-F001",
    moduleId: "MODULE-A",
    side: "Top",
    placementId: "DEMO-PLACE-A-T-R7",
    refDes: "R7",
    title: "Orientation evidence missing",
    evidence: "This authored example has no optical teaching evidence. Its orientation cannot be verified from the illustration.",
    before: "Review note: absent",
    proposed: "Review note: request an orientation check on MODULE-A / Top / DEMO-PLACE-A-T-R7.",
    debugId: "DEMO-DBG001",
  },
  {
    id: "DEMO-F002",
    moduleId: "MODULE-B",
    side: "Top",
    placementId: "DEMO-PLACE-B-T-R7",
    refDes: "R7",
    title: "Duplicate RefDes control example",
    evidence: "R7 also exists on MODULE-A. This fictional placement belongs only to MODULE-B; a shared RefDes does not establish shared identity.",
    before: "Review note: absent",
    proposed: "Review note: confirm the independent identity of MODULE-B / Top / DEMO-PLACE-B-T-R7.",
    debugId: "DEMO-DBG002",
  },
  {
    id: "DEMO-F003",
    moduleId: "MODULE-A",
    side: "Bottom",
    placementId: "DEMO-PLACE-A-B-U3",
    refDes: "U3",
    title: "Bottom-side evidence missing",
    evidence: "No bottom-side image or coordinate transform exists in this authored example. Top-side evidence cannot validate this placement.",
    before: "Review note: absent",
    proposed: "Review note: request bottom-side evidence for MODULE-A / Bottom / DEMO-PLACE-A-B-U3.",
    debugId: "DEMO-DBG003",
  },
];

export function demoIdentity(finding: DemoFinding): string {
  return `${finding.moduleId} / ${finding.side} / ${finding.placementId}`;
}
