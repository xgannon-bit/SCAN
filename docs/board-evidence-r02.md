# Board Evidence R02

Preserve the 3221 full-board management build and prior 3222 Board Evidence build.
This increment uses `SCAN_BOARD_EVIDENCE_R02_BUILD=1`, `.next-board-evidence-r02`
and loopback port 3223. It continues the existing native board and writers.

The display and native-overlay paths now share a finite proper-rigid validator:
unit columns, zero dot product, positive unit determinant, bounded translation.
The authored near-rigid shear from R02-F04 is rejected in normal and diagnostic
views. Failed genuine rigid fits still have the explicit unregistered diagnostic.

Saved presentation history remains bounded to 500 events / 850 KB. New journals
count events actually omitted by either bound; legacy totals remain unknown.
Replay discloses partial history, retained per-run sequence ranges, and observed
worker transport drops separately. Trimming a complete earlier run still retains
the global omission warning. Metadata is optional for older projects, validated,
presentation-only and never a source of candidate proof or engineering counts.
Reopening cancels retained in-flight runs; it cannot resume them. Restoration
uses the same bounds and drops component-only fields from terminal cancellation.

Live activity exists only while the corresponding real worker run is active.
Completion/cancellation hides transient rings. **Show results of last run** enables
a labelled static event layer; Recorded Replay enables a separate historical layer.
Checked, held, started and incomplete events have distinct ring styles. Reduced
motion disables animation. No failure or success is assigned to an individual part
when only a batch interruption is known. Native geometry and engineering state
colors remain independent of event-ring colors.

The existing analysis worker's actual unaccepted XY targets have a separate cyan
preview style after strict source/snapshot/context/identity/before-geometry matching.
**Locate worker component** selects its existing native record on the same board;
it never creates or moves a record. New preparation ghosts remain staged until
candidate read-back. The writer protocol and native processing code are unchanged.

An authored 1,000/3,000-placement, 500-event join benchmark motivated a small identity
index and memoized phase map. Duplicates remain multiple matches and are refused.
The benchmark reports timings, including index construction, without an FPS claim
or hardware-dependent assertion. Run `node --import tsx scripts/benchmark-board-processing.mjs`.

Regression coverage includes the shear, stale and duplicate joins, both trim bounds,
whole-run omission, legacy metadata, >500-event save/reopen/replay on a complete board,
candidate proof independent of journal trimming, real worker completion/cancellation,
return to live, reduced motion and existing native candidate exports. Only the browser
test transport is deliberately delayed to make actual in-flight events observable;
the application does not delay or synthesize processing.

Actual R04 registration remains held. Its Gerber format/revision, physical side/module,
units/handedness/rotation/anchor and independent corresponding control evidence are
still required. Existing CAD/PCB arithmetic is not physical native registration.
Native bindings, FOV coverage, Eagle compatibility and optical teaching remain separate.
No native repairs, blanket enable, machine writes, release or GitHub push are implied.
