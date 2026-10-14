# Component processing and geometry replay

Baseline: local `scan-visual-rebuild`, `eb50b4b09f76819159ec42a7e0a55b6c416cd890`, plus the delivered Visual Rebuild increment. All 38 delivered source hashes matched before work began. Preserve the delivered 3218 build and private evidence; use a separate build directory and port for this increment.

1. Instrument actual guarded scalar verification and disabled part insertion/closure checks. Send bounded, source-bound component events from the worker to the existing browser workflow. Events do not authorize writes.
2. Retain immutable before/after geometry for the affected native component in the presentation journal. Replay that recorded scope without executing an operation or mixing current sources into historical geometry.
3. Save/reopen the journal with legacy project compatibility. Retain batch publication, download verification and machine qualification as separate states. Missing event history must never imply successful work.
4. Test event ordering, bounds, failure/cancellation, saved-history validation and read-only replay. Exercise actual reviewed exports and private preservation/reopening separately from public synthetic tests.

This increment does not register scan imagery, qualify native bindings/FOV coverage, diagnose physical correctness, enable inspections or grant release. No machine/shared-library writes, push or canonical Drive edits.

## Implemented scope

The guarded placement writer emits one event per affected placement after its exact scalar preservation checks. Disabled part preparation emits one event per accepted component after insertion closure and original-byte rollback checks. Dry-run review and scalar rollback do not emit forward-write events. The composed route uses the same instrumentation.

Only opt-in, prefixed and shape-validated stderr events reach an ephemeral local journal. Other stderr remains private. Transport is loopback/same-origin, source/hash-bound, random-run addressed, bounded to 16 retained runs and 256 component events per run, and expires automatically. Missing/truncated telemetry is reported; it cannot approve or change an export. Timestamps record actual event receipt, with no synthetic work delays or progress percentages.

The browser records these events during the existing export. Immutable component before/after geometry is saved in the optional presentation journal. Recorded replay displays that affected component alone and does not replace missing historical geometry with a current board, rerun a worker, or expose repair actions. Save uses the latest journal reference, including events received during an in-flight export. Legacy projects remain supported. Incomplete earlier operations are marked cancelled when reopened, never resumed.

Worker checks, package return, client hash verification, candidate reanalysis and machine verification remain separate. An event may describe staged geometry even if a later packaging step fails. Saved event history is presentation data, not an independently authenticated engineering receipt.

## Verification

On Windows, Node 24.18.0 and the existing Python environment:

- `node --import tsx --test tests/*.test.mjs`: 176 passed.
- `.venv\Scripts\python.exe -m unittest discover -s workers/scan/tests`: 423 passed.
- `npm run typecheck`, with `SCAN_PROCESSING_BUILD=1`: passed.
- `npm run build`, with `SCAN_PROCESSING_BUILD=1`: passed.
- `npx playwright test tests/e2e/visual-workspace.spec.ts`, with `SCAN_PROCESSING_BUILD=1`, `SCAN_PORT=3220` and a private `SCAN_EVIDENCE_DIR`: 12 passed across desktop, laptop and narrow viewports. Covers literal geometry, preview/decisions, real export/extraction, component history saved/reopened, disabled preparation, and replay with no POST operations.
- `npx playwright test tests/e2e/repair-review.spec.ts tests/e2e/native-preparation.spec.ts tests/e2e/composed-repair.spec.ts tests/e2e/project-session.spec.ts`, with the same build/port settings: 39 passed. Includes the existing constructor families, partial-window holds, composed candidates and project persistence. These are authored synthetic cases, not validation of the held private diode family.

Private actual-source verification was run separately: repeated reviewed placement exports, fresh reopening, exact historical component geometry, live events received before the export response, and 6,514 independent preservation checks passed. Native candidate bytes match the earlier qualified offline writer result. This is actual-source software preservation evidence, not Eagle or physical inspection validation. Private inputs, project, screenshots, exact measurements and detailed receipts remain outside this repository.

## Remaining work

This completes component-check transport and recorded component geometry for the supported candidate writers. It does not complete whole-board scene reconstruction or per-entity events for every parser, diagnosis and registration stage. Those still retain honest batch observations. Scan imagery remains explicitly unregistered; TIFF/proprietary decoding and source-supported image registration are separate work. The next increment can extend the same event contract to actual source/diagnosis processing, then add independently supported pixel-to-board registration without using replay or visual proximity as evidence.

Run `scripts/start-visual-processing.ps1` to start the separate local build at `http://127.0.0.1:3219/workspace`. The prior Visual Rebuild build and delivered package remain intact on port 3218.
