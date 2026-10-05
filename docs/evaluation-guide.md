# SCAN v0.1 offline evaluation

Double-click **Open SCAN** on the Windows desktop. Open `http://127.0.0.1:3210/` after the launcher reports ready. SCAN runs locally while this Windows session and laptop are running; sleep/shutdown interrupts access. The shortcut starts it again without Codex. **Open SCAN Demo** opens the separately labeled fictional walkthrough.

## First use

1. **Source intake:** select a complete copied native ZIP; inventory it; explicitly select the job root, main/Temp/backup and Master snapshot; capture and verify. Never use a live machine folder. Temp/backup analysis is supported; the current trial writer supports selected main only.
2. Add available XLSX/XLS/CSV placement and GBR/GBX Gerber sources. Confirm columns, worksheet, units, rotation convention, side and module. Gerber interpretation and control-point alignment retain their existing explicit holds. Use Engineering BOM to parse grouped references, quantities, exact MPNs and design-DNP evidence. This does not approve the current work order. Keep a validated placement for comparison before loading another revision. Optional ACCEL ASCII PCB input supplies explicit source-owned pad centers; unsupported shapes remain held.
3. **Source findings / Review handoff:** inspect component accounting, same-reference groups, binding observations and the actual Master/window/algorithm work. Numeric coordinate differences are observations, not confirmed defects. Native windows and CAD/Gerber are distinct frames unless registration is independently established.
4. **Repair Review:** select an actual native placement. Prepare a local ROI-X or stored-center-X trial, or select a redundant placement and retained peer. Supply independent supporting evidence and explain the local scope, intended geometry and unresolved dependencies. Matching RefDes text alone does not prove redundancy. The app does not independently interpret this evidence or choose a survivor.
5. Check the proposal. Review its exact before/after, identity, evidence and protected scope. Accept or reject each item individually. Existing qualification-request JSON can also be imported; imported approvals enter pending review. Unchanged saved decisions survive fresh rechecks through exact digests and source context. Changing source bytes, mappings, control points or supporting evidence holds the stored decision set; rechecking after a context change returns it to pending.
6. Acknowledge **QUALIFICATION ONLY**, then generate the accepted subset. No accepted changes means no candidate. Stale identity/source/before values or unaccepted dependencies block output. Binding writes are held. The original and all unrelated payloads remain preserved.
7. The downloaded evaluation ZIP contains `SCAN.scan-project.json`, `engineering-QUALIFICATION-ONLY.zip`, source reconciliation, source geometry evidence and `OPEN_FIRST.txt`. The engineering ZIP contains the actual changed `CANDIDATE.zip`, exact receipt/changes/decisions, asset hashes, full native accounting, per-component/window remaining work and the portable Eagle checklist. ZIP containers are transport, not an asserted Eagle import format.
8. Open the embedded SCAN project to resume. It verifies original bytes, recomputes analysis and restores mappings, decisions, revision receipts and component/shared-window observations. Use **Save project** after subsequent notes. Work observations never grant teaching, inspection verification or release. Keep earlier downloaded revisions: their hashes and exact requests are recorded, but earlier candidate bytes are not embedded repeatedly.

## Limits that remain

This is an integrated **qualification workflow**, not a completed whole-board repair engine. Independently deriving all local repairs and duplicate survivors from source geometry, qualified native pad ownership/dependent binding updates, native-frame registration, family teaching preparation and from-scratch native generation remain incomplete. The private acceptance oracle is never an analyzer input. A manually supplied trial value is not an independently diagnosed repair.

Candidate creation verifies structural/byte preservation, not complete dependencies, correct inspection geometry, Eagle compatibility, optical behavior or production readiness. It preserves the entire supplied tree but cannot establish that the supplied original itself is a complete valid Eagle job. Preserved Temp/backup snapshots retain their original state; do not substitute them for the selected edited main.

Limits: original/returned native ZIPs 100 MB each; placement/Gerber/BOM/source PCB 8 MB each; up to three retained placement comparisons and three supplementary evidence files of 8 MB each; saved project 300 MB; evaluation transport 600 MB. The supplementary attachment picker does not parse a BOM; use the Engineering BOM panel. No machine, library, company-share, MES/SPC or RCP writes occur.

## Portable later Eagle checks

- Record Athena identity and exact Eagle build; keep results for each machine distinct.
- Open the original copy first. Preserve a no-intentional-edit save to characterize OEM changes.
- Use the established local job-open procedure for a separate candidate copy. Stop and record conversion, synchronization or rematching prompts; no undocumented click sequence is assumed.
- Check every accepted change, corresponding pads/windows and unchanged controls. Review shared scope, limits, OCR/polarity, images, fiducials and calibration preservation.
- Save, close, reopen and copy back the complete resulting job for SCAN comparison. A successful open alone does not establish inspection repair.
- Finish image-dependent teaching and fresh-board optical verification. RCP records validation/release. Rollback means abandon the candidate and return to the untouched original through the established machine procedure.

The same checklist is included in every engineering candidate package, so it can travel to work without this laptop.

## Recoverable source problems

- Inspect the displayed header candidate row and map the first actual data row. Headerless placement exports start at row 1.
- If CSV decoding fails, confirm the exporter encoding before explicitly choosing Windows-1252. A separate option recovers literal quotes only in a final Description column after a recognized header. Errors in coordinate or identity columns remain blocked.
- A Gerber capacity error identifies the exact command and proposes an integer-width-only interpretation for investigation. It preserves the declared decimal precision and does not establish interpolation, scale or alignment. Keep the original and continue other review work while the hold is resolved.
- Source reconciliation accounts for the union of references. Missing references, engineering DNP, quantity disagreements and MPN conflicts remain separate issues. Resolve shared applicability once instead of treating every affected component as independently defective.
- A translation hypothesis uses separate fit and held-out references. Residuals can be legitimate origin differences. Do not move CAD to force agreement or infer pad ownership from nearest distance.

Downloads are requested through the browser. Confirm the file exists in Downloads before closing SCAN. A candidate history entry proves generation and hashes, not successful browser delivery.
