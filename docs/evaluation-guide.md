# SCAN v0.1 offline evaluation

Double-click **Open SCAN** on the Windows desktop. Open `http://127.0.0.1:3210/` after the launcher reports ready. SCAN runs locally while this Windows session and laptop are running; sleep/shutdown interrupts access. The shortcut starts it again without Codex. **Open SCAN Demo** opens the separately labeled fictional walkthrough.

## First use

1. **Source intake:** select a complete copied native ZIP; inventory it; explicitly select the job root, main/Temp/backup and Master snapshot; capture and verify. Never use a live machine folder. Temp/backup analysis is supported; the current trial writer supports selected main only.
2. Add available XLSX/XLS/CSV placement and GBR/GBX Gerber sources. Confirm columns, worksheet, units, rotation convention, side and module. Gerber interpretation and control-point alignment retain their existing explicit holds. Optional BOM/evidence attachments are preserved, not automatically interpreted as approved population.
3. **Source findings / Review handoff:** inspect component accounting, same-reference groups, binding observations and the actual Master/window/algorithm work. Numeric coordinate differences are observations, not confirmed defects. Native windows and CAD/Gerber are distinct frames unless registration is independently established.
4. **Repair Review:** select an actual native placement. Prepare a local ROI-X or stored-center-X trial, or select a redundant placement and retained peer. Supply independent supporting evidence and explain the local scope, intended geometry and unresolved dependencies. Matching RefDes text alone does not prove redundancy. The app does not independently interpret this evidence or choose a survivor.
5. Check the proposal. Review its exact before/after, identity, evidence and protected scope. Accept or reject each item individually. Existing qualification-request JSON can also be imported; imported approvals enter pending review. Unchanged saved decisions survive fresh rechecks through exact digests.
6. Acknowledge **QUALIFICATION ONLY**, then generate the accepted subset. No accepted changes means no candidate. Stale identity/source/before values or unaccepted dependencies block output. Binding writes are held. The original and all unrelated payloads remain preserved.
7. The downloaded evaluation ZIP contains `SCAN.scan-project.json`, `engineering-QUALIFICATION-ONLY.zip` and `OPEN_FIRST.txt`. The engineering ZIP contains the actual changed `CANDIDATE.zip`, exact receipt/changes/decisions, asset hashes, full native accounting, per-component/window remaining work and the portable Eagle checklist. ZIP containers are transport, not an asserted Eagle import format.
8. Open the embedded SCAN project to resume. It verifies original bytes, recomputes analysis and restores mappings, decisions, revision receipts and component/shared-window observations. Use **Save project** after subsequent notes. Work observations never grant teaching, inspection verification or release. Keep earlier downloaded revisions: their hashes and exact requests are recorded, but earlier candidate bytes are not embedded repeatedly.

## Limits that remain

This is an integrated **qualification workflow**, not a completed whole-board repair engine. Independently deriving all local repairs and duplicate survivors from source geometry, qualified native pad ownership/dependent binding updates, BOM reconciliation, native-frame registration, family teaching preparation and from-scratch native generation remain incomplete. The private acceptance oracle is never an analyzer input. A manually supplied trial value is not an independently diagnosed repair.

Candidate creation verifies structural/byte preservation, not complete dependencies, correct inspection geometry, Eagle compatibility, optical behavior or production readiness. It preserves the entire supplied tree but cannot establish that the supplied original itself is a complete valid Eagle job. Preserved Temp/backup snapshots retain their original state; do not substitute them for the selected edited main.

Limits: original/returned native ZIPs 100 MB each; placement/Gerber 8 MB each; at most three additional BOM/evidence files of 8 MB each; saved project 300 MB; evaluation transport 600 MB. The attachment picker does not parse a BOM. No machine, library, company-share, MES/SPC or RCP writes occur.

## Portable later Eagle checks

- Record Athena identity and exact Eagle build; keep results for each machine distinct.
- Open the original copy first. Preserve a no-intentional-edit save to characterize OEM changes.
- Use the established local job-open procedure for a separate candidate copy. Stop and record conversion, synchronization or rematching prompts; no undocumented click sequence is assumed.
- Check every accepted change, corresponding pads/windows and unchanged controls. Review shared scope, limits, OCR/polarity, images, fiducials and calibration preservation.
- Save, close, reopen and copy back the complete resulting job for SCAN comparison. A successful open alone does not establish inspection repair.
- Finish image-dependent teaching and fresh-board optical verification. RCP records validation/release. Rollback means abandon the candidate and return to the untouched original through the established machine procedure.

The same checklist is included in every engineering candidate package, so it can travel to work without this laptop.
