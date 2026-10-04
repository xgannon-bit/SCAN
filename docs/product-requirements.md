# SCAN native engineering job preparation

The product inputs are CAD/placement and Gerber, optionally accompanied by an
existing AOI job and additional engineering evidence. The target output is a
complete native ATHENA/Eagle engineering candidate package with reports and an
actionable machine-side work queue. Placement conversion, viewers, snapshots,
diagnostic reports and the synthetic walkthrough are intermediate capabilities.
They do not replace this objective.

## Two connected workflows

**Troubleshoot or continue an existing job.** Start with the complete archived
native job and its companion assets, independently check supplied source evidence,
and prepare a separately named native candidate. Preserve useful teaching, models,
images, algorithms, limits, OCR/polarity expectations and unrelated configuration.
Only reviewed, demonstrated, version-supported changes may enter the candidate.

**Prepare a new program.** Start with placement/CAD and Gerber plus available
identity, population and orientation evidence. Use a supported Eagle-created
starter job/template or documented vendor creation route if required. Identify
the exact missing prerequisite. Never invent native structures, calibration,
images, model identities or learned inspection parameters. Account for every
in-scope reference and make remaining image-dependent work explicit.

An earlier assisted repair is a behavioral example, never a known-good native
oracle. Reproduce the method and handoff structure using independent evidence;
do not copy a private case's coordinates, counts, thresholds or assumptions.

## Diagnose the correct layer

| Layer | Evidence and correction scope |
| --- | --- |
| Source format | Column mappings, combined XY, literal numeric data, missing values, units, rotations and Gerber declarations |
| Source scope/registration | Revision, side, board/panel scope, module identity, origins and transformations between independent coordinate frames |
| Footprint/model anchors | Distinguish native footprint origin, pad midpoint, optical body center and inspection-model anchor |
| Saved job structure | Scoped duplicate enabled inspections, missing records, dangling references, identity conflicts and stale dependencies |
| Local inspection geometry | Demonstrated placement/ROI displacement and supported window-to-pad relationships |

Never move correct CAD to hide an ROI error, rewrite correct Gerber to hide a bad
pad binding, snap all placements to body centers, stretch/shear a board to force
agreement or infer ownership from nearest-pad distance alone. Show the evidence,
affected side/module/reference/placement and appropriate correction layer.

## Meaning of complete

These independent states must remain visible:

- **Package complete:** required native files and internal dependencies are
  present and consistent according to a supported adapter.
- **Offline preparation coverage:** every in-scope reference is accounted for as
  existing, prepared draft, unresolved/missing, excluded pending approval, or held
  for a stated reason. Unknown population is not zero.
- **Machine compatibility:** the exact candidate has authorized Eagle
  load/save/reopen evidence for the supported application/schema version.
- **Optical teaching/validation:** image-dependent work was performed and its
  results were recorded, with precise remaining work by family and orientation.
- **Production release:** controlled separately by RCP and company procedure.

Keep represented, enabled, taught, verified and released counts distinct. A CAD
row is not a programmed inspection. Capturing an unchanged archive is not native
preparation. File presence alone does not prove dependency completeness.

## Engineering handoff bundle v1

The outer application contract is `scan.engineering-handoff`, version `1`. It is
separate from every vendor's inner native folder structure. An eventual native
writer must derive and test the inner layout against the supported format.

| Path | Required contents and conditions |
| --- | --- |
| `JOB_COPY/` | Entire separately named native candidate directory tree and all required dependencies; populate only through a qualified adapter, never guessed scaffolding |
| `SOURCE_REVIEW/` | Inventory, source provenance, import profiles/checklists and justified source derivative copies; unchanged sources need no corrective derivative |
| `REPORTS/` | Findings, exact before/after fields, preserved-field/asset verification, coverage/holds and relevant visual evidence labeled by origin |
| `DEBUG_QUEUE/` | Stable entries for exact side/module/reference/placement and family, why outstanding, next machine action and untested examples/rotations |
| `MANIFEST/` | Input/output hashes, explicit snapshot selection, app/adapter/schema versions, candidate identity, dependency results and validation evidence |
| `START_HERE.txt` | Bundle contents, qualification/blocking status, approved opening workflow, remaining checks, limitations and rollback instructions |

Minimum machine-readable manifest fields: `artifactType`, `schemaVersion`,
`bundleId`, `candidateId` (null when no candidate exists), `workflow`,
`sourceSnapshots`, `sourceHashes`, `outputFiles`, `appVersion`, `adapterVersions`,
`nativeSchema`, `packageCompleteness`, `offlineCoverage`, `machineCompatibility`,
`opticalValidation`, `releaseAuthority`, `holds`, `changes`, `debugQueue`.
File records carry relative path, byte size, SHA-256, role and evidence origin.
Every change carries exact before/after values and its reviewed evidence identity.
Every unresolved reference retains its exact identity; job-level prerequisites
must be explicitly job-scoped instead of receiving invented placement IDs.

A blocked preflight report is a different artifact (`scan.snapshot-preflight`).
It must not claim to implement this complete bundle or contain a native candidate.
An empty `JOB_COPY/` is not a package-complete result. The output manifest hashes
payload files; an external bundle receipt hashes the final bundle, avoiding a
self-referential archive hash.

## Qualification and operating boundaries

Preserve original bytes/hashes and distinct main/Temp/backup selections. Never
select by newest timestamp or silently merge snapshots. Candidates are copy-only
and explicitly reviewed. Unknown schemas and ambiguous origins, models or pad
ownership block the affected correction.

Before native writer enablement, require no-op round-trip, protected-field and
asset checks, dependency validation, fresh-input checks, idempotence, failed-write
cleanup, rollback and version-specific machine compatibility evidence. Continue
useful diagnostics, overlays and report/debug exports while blocked, but do not
call that completion of the native-job objective.

No live job, library, calibration, camera, conveyor, SPC or company-share writes.
No threshold relaxation, enable-all, guessed OCR, Init Cad Offset or global
rematching. RCP remains separate.

Public development uses wholly synthetic fixtures. Real material and private
oracles stay in approved private storage and require appropriate explicit
authorization before inspection, screenshots or external inference. A filename
containing "demo" or "corrected" establishes neither provenance nor permission.
Check available authorized inputs before asking for them again.

## Current implementation and retained queue

Latest local increment: source intake/capture/preflight are integrated into the
dashboard; saved placement reviews reparse on reopen. The observed JobContainer
10.2 read-only profile inventories literal native records, and handoff compares
all original/returned archive files. See [qualification](native-output-qualification.md).
No native schema/writer or Eagle application version is qualified. The historical
checkpoint below remains for A# task provenance.

| Capability | Actual state at the start of A05 |
| --- | --- |
| A03 source intake / A04 snapshots | ZIP inventory and explicit hashed capture, CLI-only; A04 committed `caed93a` with 38 tests at that checkpoint |
| A07 placement preflight | Working local XLSX/CSV UI and adapter, normalized placement JSON; committed `f5e490d` |
| A09 Gerber preflight | Separate unreviewed branch remains restricted and untouched; not enabled |
| A05 native reader / dependency inventory | Next bounded work: verify snapshots and report preserved assets/XML envelope before any semantic adapter |
| Structural/geometry findings / visual evidence | Native diagnostics and geometry not implemented; synthetic walkthrough is presentation-only |
| Reviewed correction plan | Synthetic decisions only; no real repair planner |
| Version-qualified native writer | Not implemented, no version qualified, controls disabled |
| Complete bundle / machine debug queue | Contract above established; generation and exact-identity native queue not implemented |

The first A05 increment now verifies captured archives and selected bytes against
an independent capture hash, reports preserved files and safely inspects XML
envelopes. It is CLI-only and has no native semantic adapter or dependency graph.
See [snapshot preflight](snapshot-preflight.md) for exact limits and behavior.

Retain the existing A# queue and safety gates; one active implementation claim.
Use planned libraries at first need: openpyxl, qualified XML tooling, NumPy,
Shapely and the established UI stack. No replacement framework or repeated setup.
