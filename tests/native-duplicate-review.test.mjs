import test from "node:test";
import assert from "node:assert/strict";
import { duplicateDecision, duplicateReviewExport, recordDuplicateDecision } from "../lib/scan/native-duplicate-review.ts";
import { validateRepairSession } from "../lib/scan/repair-session.ts";

const pair = { digest: "d".repeat(64), leftPath: "parts[1]", rightPath: "parts[2]", holds: ["SUPPRESSION_SIDE_EFFECTS_UNQUALIFIED"] };
const report = { status: "recorded", sourceContext: { archiveSha256: "a".repeat(64), snapshotId: "b".repeat(64) }, groups: [{ reference: "FICTION1", module: "one", pairs: [pair] }] };
const decision = { disposition: "prefer-left", reviewer: "Synthetic tester", reason: "Fictional independent evidence; still no suppression qualification." };

test("exact comparison preference persists through repair session and exports without native authority", () => {
  const work = recordDuplicateDecision(report, pair, decision, []);
  const restored = validateRepairSession(JSON.parse(JSON.stringify({ request: null, history: [], work })));
  assert.equal(duplicateDecision(report, pair, restored.work).disposition, "prefer-left");
  const output = duplicateReviewExport(report, restored.work);
  assert.equal(output.decisions.length, 1);
  assert.equal(output.nativeEditsApplied, false);
  assert.equal(output.suppressionAuthorized, false);
});

test("changed pair, source or snapshot cannot inherit a previous preference", () => {
  const work = recordDuplicateDecision(report, pair, decision, []);
  for (const edited of [
    { ...report, sourceContext: { ...report.sourceContext, archiveSha256: "c".repeat(64) } },
    { ...report, sourceContext: { ...report.sourceContext, snapshotId: "e".repeat(64) } },
    { ...report, groups: [{ ...report.groups[0], pairs: [{ ...pair, digest: "f".repeat(64) }] }] },
  ]) {
    assert.equal(duplicateDecision(edited, edited.groups[0].pairs[0], work), null);
    assert.equal(duplicateReviewExport(edited, work).staleDecisions.length, 1);
  }
});

test("review updates are idempotent, preserve unrelated work and retain both is actionable", () => {
  const unrelated = { key: "other", note: "Keep unrelated teaching review", sourceSha256: "a".repeat(64), snapshotId: "b".repeat(64), status: "machine-work" };
  const first = recordDuplicateDecision(report, pair, decision, [unrelated]);
  const next = recordDuplicateDecision(report, pair, { ...decision, disposition: "retain-both" }, first);
  assert.equal(next.length, 2);
  assert.deepEqual(next[0], unrelated);
  assert.equal(duplicateDecision(report, pair, next).disposition, "retain-both");
  assert.deepEqual(recordDuplicateDecision(report, pair, { ...decision, disposition: "retain-both" }, next), next);
});

test("missing reasons, malformed saved notes, duplicate decisions and inferred authority are refused", () => {
  assert.throws(() => recordDuplicateDecision(report, pair, { ...decision, reason: " " }, []));
  assert.throws(() => recordDuplicateDecision(report, pair, { ...decision, suppressionAuthorized: true, invented: true }, []));
  const work = recordDuplicateDecision(report, pair, decision, []);
  assert.equal(duplicateDecision(report, pair, [...work, ...work]), null);
  assert.equal(duplicateDecision(report, pair, [{ ...work[0], note: "not JSON" }]), null);
  const changed = JSON.parse(work[0].note); changed.suppressionAuthorized = true;
  assert.equal(duplicateDecision(report, pair, [{ ...work[0], note: JSON.stringify(changed) }]), null);
});

test("ambiguous identities can request evidence but cannot pick a survivor", () => {
  const ambiguous = { ...pair, holds: ["PLACEMENT_IDENTITY_AMBIGUOUS"] };
  const current = { ...report, groups: [{ ...report.groups[0], pairs: [ambiguous] }] };
  assert.throws(() => recordDuplicateDecision(current, ambiguous, decision, []));
  assert.equal(duplicateDecision(current, ambiguous, recordDuplicateDecision(current, ambiguous, { ...decision, disposition: "needs-evidence" }, [])).disposition, "needs-evidence");
});
