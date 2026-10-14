# Independent placement diagnosis and offline qualification

This increment connects original PCB, current placement and actual BOM evidence to the existing native review/export/reopen route. Historical coordinate replay remains separate. A source-derived ROI edit is an isolated experiment; it is not a completed inspection repair or machine qualification.

## Open the development build

Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-diagnosis.ps1` from the repository root on the development laptop, then open http://127.0.0.1:3217/repair. Keep the launcher window open. Ctrl+C stops that server. This launcher uses `.next-independent-diagnosis`; the existing evaluation, development and placement-repair builds are preserved separately. It never rebuilds or stops another listener.

To build from this checkout in PowerShell:

```powershell
$env:SCAN_DIAGNOSIS_BUILD = '1'
$env:NEXT_TELEMETRY_DISABLED = '1'
npm.cmd run build
```

Stop the diagnosis server before rebuilding its directory. The launcher requires the existing local Node and Python runtimes and performs no installation, machine operation or network exposure beyond loopback.

## Use the connected route

1. In Source intake, select an original complete native archive and explicit main job/main Master snapshots. Load and validate the current placement file, owned PCB and actual BOM. Retain legacy revisions as comparisons.
2. In Repair Review, open **Independent source diagnosis → native placement review**. Establish the module, revisions, physical sides, native units/Y/rotation and intended ROI anchor. Name at least three noncollinear footprint-origin controls and a distinct check. Record the physical interpretation and arithmetic tolerance evidence. Unknown facts stay held.
3. Derive findings. SCAN registers current placements to owned PCB origins and separately registers owned origins to original native CAD. The target ROI and any corrected historical job are excluded from both fits. Review global transforms, local outliers, source body geometry, original Master corroboration and affected dependencies.
4. Select an eligible component and send its exact derived group to native review. Accept, reject or undo it there. Paired axes are atomic. A separate existing proposal set is retained until explicitly cleared; its history is not discarded.
5. Acknowledge qualification-only export. The server rereads all three source files, exact mappings, profiles, selected native hashes and before-values; it rederives the finding before applying any scalar. Accepted preparations are preserved in a composed candidate. Export the complete separate archive/project, then inspect its freshly reanalyzed candidate work.
6. Reopen the project. Embedded files are hash-checked and parsed afresh. Source-derived repair accounting requires the original source files and fresh diagnosis, rather than a cached report. Original, generated and returned jobs remain separate.

The package includes complete native output, exact change/preservation receipts, frozen independent findings, source-derived qualification receipts and remaining native component/window work. Repeated export starts from the original; movement never accumulates.

## Deliberate boundaries

- Small offsets of taught placements within the supported body envelope are preserved as possible image adjustments. Nominal source coordinates alone do not justify normalization. This route requires a gross discrepancy plus a unique existing Master corroborating the independently derived datum.
- Unknown side, mirror, revision, identity, pad ownership, package/body evidence and CAD outliers retain scoped holds. Malformed placement/BOM intake holds the writing route. Source-owned PCB geometry does not silently repair or reinterpret malformed Gerber.
- No Master/window/binding/FOV/enable changes are inferred from an ROI move. Existing teaching and companion payloads survive. Complete repair remains held pending native dependency behavior.
- Numbered source-pad intentions and physical/optical roles remain separate from native binding. Read-only binding inventory supports 10.1 and 10.2; that does not qualify a binding writer or extend constructor support to a new schema.
- FOV assignment literals are compared separately with saved `Id` and `PathId` records. Both candidate centers are retained, together with exact `Enb` and legacy `ENABLE` literals. No ID domain, traversal, usable extent or coverage is inferred. Nearest-center assignment is not qualified coverage.
- DEV2 preparation and CURRENT/R04 repair are distinct lineages. Reopening the former does not authorize grafting its teaching into the latter by reference text.
- Genuine scan/fiducial/color-only starter qualification, unresolved polarity, complete native window propagation, Eagle open/save/reopen, optical verification and release remain separate work.

## Minimum native behavior evidence

Preserve complete original and changed copies, exact Eagle build/machine identity and a short operator record. Use the established local job-open procedure; no menu names are asserted here.

For placement: open the original control, open the isolated candidate, inspect changed and retained placements/windows, save/close/reopen, and retain the returned complete job. Record conversion/rematch/synchronization prompts and any position/window movement.

For binding: change only one known window-to-pad binding on a two-terminal model, choosing a pad with distinct position/dimensions; save/reopen. A separate two-placement shared-Master sample must distinguish individual and common binding scope. Literal ID closure alone does not establish component ownership.

For FOV: use a camera with different `Id` and `PathId`, change one assignment, and retain calibrated usable acquisition extents plus a boundary window. Mosaic/full-image dimensions and fiducial areas do not establish each camera's usable coverage.

## Requirements delta

| Plan work | Delivered offline increment | Remaining qualification |
| --- | --- | --- |
| N02–N03 | Fresh placement/BOM interpretation, identity/population guards, revision/scope checks | Ambiguous source identities and reviewed package aliases remain held |
| N04–N05 | Separate source/source and source/native CAD registration; global versus local/outlier and teaching-offset diagnosis | Physical frame/anchor declarations and mirror/module cases beyond the proper rigid profile |
| N06–N07 | Source-owned body/pin evidence connected to exact guarded native ROI proposals | Unknown body/polarity facts and complete dependent inspection repair |
| N09–N11/N16 | Reuses constructors, compatible source/model evidence, composed preparation export; source-pad/window dependency intentions | Genuine starter and additional qualified model/native semantics |
| N13–N14 | 10.1/10.2 read-only binding work, FOV ID-domain ambiguity and exact camera flags | Binding writer, optical visibility, traversal and calibrated coverage |
| N20–N21 | Integrated visual review, atomic decisions, complete separate candidates and fresh project reopening | Machine-returned validation history and full component readiness |
| N23–N24 | Public invented fixtures plus private actual-source/frozen-evidence and preservation verification | Actual physically qualified repair is not inferred from synthetic success |
| N27–N28 | Exact remaining machine observations identified | Athena 1 and Athena 2 validation not performed |

Public tests use invented jobs. Private source verification and delivery artifacts remain outside this repository. No production release, push, machine/library write or blanket enabling is part of this increment.

## Verification for this increment

The final revision passed 419 Python tests, 165 JavaScript tests, TypeScript checking, a production-mode development build and 39 selected browser regressions across desktop, laptop and narrow viewports. The browser checks cover the new connected route and existing historical replay, review, project compatibility, composition, registration, origin and native preparation paths. The source-derived candidate test changes exactly two accepted ROI scalars on one invented placement; unrelated native payloads, teaching, flags and distinct backups are preserved. Fresh extraction, analysis and project reopening verify the same changes.

Private actual-source browser verification reopened the prior 56-draft project, imported the newer original job with its current sources, derived an explicit frame hold, saved the project and reopened it with fresh analysis. No actual-source edit was generated without the missing physical declarations. Separate read-only binding and camera-domain inventories exposed their unresolved contracts. Preservation checks verified 153 previous delivery files, 201 files in the prior placement delivery and all three earlier build trees. These offline checks do not qualify Eagle behavior or establish physical correctness.
