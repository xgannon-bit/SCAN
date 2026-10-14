# Visual Rebuild Mode — implementation checkpoint

Base: `eb50b4b09f76819159ec42a7e0a55b6c416cd890`, clean `scan-gerber-native-workflow` checkout. Work continues on local `scan-visual-rebuild`. Supplied brief and kickoff read completely; all four screenshots reviewed as existing UI, not target designs. Current canonical plans were read, but this task explicitly prohibits updating them. Historical branch instructions do not replace the actual baseline.

## Confirmed baseline

- `ScanSession`, `PlacementIntake`, `placement-worker`: fresh CSV/XLSX/XLS parsing, raw and normalized coordinates, source-row selection and invalidation.
- `GerberSession`, `GerberWorkspace`, `geometry-types`: bounded standard flashes/linear draws, interpretation holds, separate rigid registration with three fit controls and an independent check. No image registration or pad ownership inferred.
- `ArchiveSession`, `archive_browser_cli`: immutable archive inventory/preflight, explicit main/Temp/backup selection, literal native records. Image filenames are inventoried; no image decoder/viewer or qualified full-map-to-board mapping exists.
- `NativeDiagnosisReview`, `SourceRegistrationReview`, `OriginReview`: existing evidence/transform/proposal models. They remain engineering authority.
- `RepairReview`, preparation reviews, candidate panels: guarded review, atomic paired axes, copy-only writer, exact preservation/read-back and separate candidate history. Existing teaching, DNP, unsupported binding and FOV holds stay intact.
- `project-session`: original bytes/hashes, mappings, decisions and history are saved and freshly parsed on reopen. No live processing event journal or saved replay exists.

## Execution plan

1. **A + event foundation:** add a persistent viewport canvas and contextual inspector to `/workspace`; plot scoped source records at actual normalized coordinates, with search, selection, pan/zoom, outliers, keyboard navigation and an honest grid. Save only view preferences and presentation history beside existing project state. Instrument real completed batches/states, not invented per-part work.
2. **A images / B geometry:** read explicitly selected supported image bytes from verified copied archives with bounds and provenance; keep them in an unregistered pixel view until a supported mapping exists. Render actual supported Gerber primitives with clear polarity and inspect recorded fit/check residuals. Keep source/native/image frames distinct. Preserve specialist forms in contextual tools.
3. **C:** visualize existing exact proposal groups with baseline ghosts and display-only previews; use the same reviewed decisions and guarded candidate controls. Confirm written/checked state only from real writer/read-back evidence. Deep-link selected source/native entities.
4. **D supported portion:** persistent event dock, scoped counters and read-only recorded replay; eligible native preparation uses the existing reviewed build route. Unsupported capabilities show concrete next actions.
5. Verify geometry, image holds/bounds, event duplicate/stale/failure/cancellation handling, preview immutability, project compatibility, real candidate preservation/reopen and browser layouts. Use public invented fixtures and private authorized sources. Launch a separate `.next-visual-rebuild` build on loopback port 3218 and retain screenshots privately. Preserve all delivered build trees. No push or canonical Drive edits.

## Deferred / qualification boundaries

No nearest-pad correction, guessed image calibration, native enablement, machine readiness, UV/split-screen/Layer Lift/3D, new dependencies or framework replacement. Actual physical diagnosis remains subject to the existing side/frame/package evidence. A successful visual preview or replay never executes a repair or grants release.

## Implemented behavior

The existing Board workspace is now the visual work surface, with a large navy/cyan canvas, contextual inspector and event/history dock. It remains inside the existing application shell. Specialist engineering forms open from the workspace; their original validation and candidate controls remain authoritative.

| Milestone | Delivered scope | Explicit limit |
| --- | --- | --- |
| A — actual job | Source-coordinate crosses, scope, reference labels, search/list selection, pan/zoom, outlier-aware fit and fit-all, saved cameras/layers/selection; hash-verified preserved PNG/JPEG/BMP images | Images are a separate, clearly unregistered pixel view. No guessed pixel-to-board transform. TIFF/proprietary decoding is unavailable. |
| B — alignment evidence | Actual supported Gerber flashes/solid circular draws, ordered dark/clear polarity and flash holes; scoped control residual graphics, measured differences and source evidence; source-derived native findings in the inspector | An independent correspondence is required. Circular draws with aperture holes are held in the new canvas until swept-hole rendering is implemented and tested. Existing unsupported parser constructs remain held. |
| C — reviewed correction | Stable native identity selection, original/proposed geometry, display-only scrub, exact accept/reject/undo, original guarded export, written receipt and freshly reparsed candidate view | Historical replay is a writer/workflow test. Source-derived experimental diagnosis is labeled separately. Neither proves physical correction or Eagle compatibility. |
| D — supported preparation/history | Existing disabled-model preparation is available in workspace tools; actual candidate records, retained preparation receipts, fresh component-work checks, saved bounded event journal and read-only event playback | Events describe actual operations/batch completions. Per-component streaming and reconstruction of historical geometry are not implemented. Playback explicitly shows that the current canvas is not an earlier engineering state. |
| E — polish | Responsive desktop/laptop/narrow layout, accessible list alternatives, keyboard focus, reduced-motion processing indicator, manual camera control | No automatic camera-follow, split-screen, UV, Layer Lift or 3D. |

Presentation state is an optional, strictly validated saved-project field. It cannot authorize a writer, recover a machine-verified state, or replace fresh source analysis. Older saved projects continue to reopen. In-flight events become cancelled when reopened; replay never resumes them. Duplicate/stale/out-of-order and late terminal events are rejected. Independent diagnosis findings remain derived session data and are regenerated on request, not trusted from a saved report.

Image reads retain the existing archive worker limits and selected-root/hash checks. Browser decoding verifies dimensions and original bytes before display. Image selection is retained but decoding starts only in the pixel view, after project/native work is idle. No background decode competes with candidate read-back in the native view. Loading an image never establishes registration.

The new Gerber canvas uses a shared display-geometry helper; the original alignment-control form is retained for editing correspondence evidence. No native repair math, constructor geometry, original archive content, DNP decision or machine-enable rule was changed.

## Try the local build

1. Open `http://127.0.0.1:3218/workspace`. If stopped, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-visual-rebuild.ps1` from this repository. Keep that terminal open. The launcher refuses an occupied port and never stops another build.
2. Use **Open saved review or project**, or **Import job / sources**. Select **CAD / placement**, module/side, then search a reference and press Enter. Use the wheel or zoom buttons, drag to pan, and **Fit view** to reset.
3. Use **Gerber + registration → Findings** for measured correspondence evidence. **Layers → Preserved image** opens a separately labeled pixel view. A missing image leaves the grid usable.
4. In **Review**, select an exact proposal, compare original/proposed, scrub the drawing, and accept/reject/undo. **Open guarded review & candidate build** retains the existing qualification acknowledgement and writer checks.
5. **Engineering tools → Candidate checks** freshly reproduces edits and remaining work. **Native placement ROI → Reparsed candidate** shows written records. **Save project** retains original bytes, exact decisions/history and the view. **Recorded replay** is read-only event history.

## Verification record

Windows / PowerShell, local Node.js 24.18.0 and the existing repository Python virtual environment. No dependencies installed. Public tests use authored synthetic fixtures; private source archives, projects, screenshots and detailed preservation oracles remain outside Git.

Commands run from the repository (the explicit executable avoids shell PATH assumptions):

```powershell
$env:SCAN_VISUAL_BUILD='1'
$env:NEXT_TELEMETRY_DISABLED='1'
& 'C:\Program Files\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit
& 'C:\Program Files\nodejs\node.exe' --import tsx --test tests/*.test.mjs
.venv\Scripts\python.exe -m unittest discover -s workers/scan/tests
& 'C:\Program Files\nodejs\node.exe' node_modules/next/dist/bin/next build
$env:SCAN_PORT='3220'
$env:PATH='C:\Program Files\nodejs;'+$env:PATH
# SCAN_EVIDENCE_DIR pointed outside this public repository for every browser run.
& 'C:\Program Files\nodejs\node.exe' node_modules/@playwright/test/cli.js test
& 'C:\Program Files\nodejs\node.exe' node_modules/@playwright/test/cli.js test tests/e2e/visual-workspace.spec.ts tests/e2e/scan-foundation.spec.ts tests/e2e/composed-repair.spec.ts tests/e2e/native-preparation.spec.ts
& 'C:\Program Files\nodejs\node.exe' node_modules/@playwright/test/cli.js test tests/e2e/visual-workspace.spec.ts tests/e2e/scan-gerber.spec.ts
& 'C:\Program Files\nodejs\node.exe' node_modules/@playwright/test/cli.js test tests/e2e/visual-workspace.spec.ts --grep 'supported preserved raster'
& 'C:\Program Files\nodejs\node.exe' node_modules/@playwright/test/cli.js test tests/e2e/visual-workspace.spec.ts
& 'C:\Program Files\nodejs\node.exe' --import tsx --test tests/visual-workspace.test.mjs
git diff --check
```

Results and delivery identities are finalized in the accompanying local delivery receipt. Earlier failures are retained in private test evidence: the full run initially had three old CTA-label assertions; a stronger image-reopen test then exposed duplicate requests and background decode contention. Those were fixed, and the affected workflows were rerun. A temporary request-count assertion was corrected to observe actual image responses because Playwright did not expose the multipart request body in that test.

Verified results for this increment:

- TypeScript and the separate production build: passed. `git diff --check`: passed; Git only reported normal LF/CRLF conversion notices.
- Complete JavaScript/API suite: **173 passed**. The final display helper refinements were subsequently checked by all **7 visual-workspace unit tests**, including dense bounds, label decluttering, stable identity and immutability.
- Complete Python regression suite: **421 passed**.
- Initial full browser run: **138 passed / 3 failed**, all three failures in the old CTA-label assertion; corrected and passed in the focused foundation rerun. The 42-case foundation/preparation/composed/visual rerun passed 39 cases and exposed the three viewport variants of the image-selection race; these were fixed.
- Final visual-workspace + Gerber browser run: **18 passed / 0 failed**, covering desktop, laptop and narrow layouts. This includes fresh source-derived review/export/reopen with a retained raster, image provenance/holds, read-only event replay, measured alignment findings, and actual disabled native preparation through the workspace with saved receipt/read-back. The final build only changes observation wording from a write claim to a retained-receipt observation; geometry and workflow behavior are unchanged.
- Private real-source preservation: **6,514 checks passed**. Two complete candidate exports were independently compared; original input and unrelated native payloads were preserved. A new browser context reopened the saved project and freshly verified its candidate. Scan-image bytes/dimensions were checked without registration.
- Private source display: every primary-source cross matched its normalized source coordinate; every supported Gerber primitive was rendered. Comparison-file responses were explicitly separated from the primary source. The saved source project reopened with original source bytes intact.
- Previous delivery manifests and all four existing evaluation/development build payload sets passed their preservation checks. No Eagle or machine test was performed.

Screenshots and detailed private receipts are delivered locally. Synthetic screenshots are explicitly prefixed `SYNTHETIC`; actual-source screenshots are prefixed `ACTUAL`. No private evidence is included in the public tests or this repository.

The actual-source trial independently checks the intended edits, unchanged selected Master, unrelated teaching/assets, distinct Temp/backups, unchanged FOV assignments, repeated candidate equality, source hashes, identity/stale-input refusal, and fresh saved-project reopening. It is not a synthetic test and is not an Eagle open/save/reopen. Real CAD/Gerber display is checked separately against the primary parser source, rather than a comparison file's response. No physical alignment is inferred from that display.

## Next bounded milestone

Add authoritative per-component preparation/build events and deterministic historical geometry snapshots, using the current candidate receipts and exact source identities. Then qualify pixel-to-board registration from explicit calibration/correspondence evidence. Keep image decoder work independent. Eagle open/save/reopen, body/terminal retention, binding semantics, acquisition coverage and optical teaching still require machine evidence; the interface cannot certify them. Full starter-job preparation remains unfinished.

No push, deployment, production release, shared-library/machine write or canonical Drive update was performed. Earlier evaluation builds and delivered packages are preserved. The current local branch is `scan-visual-rebuild`, based on the exact revision above; implementation changes are local and uncommitted at this delivery.

## Changed repository paths

- `.gitignore`
- `app/(scan)/workspace/page.tsx`
- `app/api/archive/route.ts`
- `app/globals.css`
- `components/scan/CandidateRepairPanel.tsx`
- `components/scan/CandidateWorkPanel.tsx`
- `components/scan/NativeDiagnosisReview.tsx`
- `components/scan/NativePreparationReview.tsx`
- `components/scan/PlacementFindings.tsx`
- `components/scan/RepairReview.tsx`
- `components/scan/ReviewControls.tsx`
- `components/scan/ReviewHandoff.tsx`
- `components/scan/ScanSession.tsx`
- `components/scan/ScanShell.tsx`
- `components/scan/VisualGerber.tsx`
- `components/scan/VisualImage.ts`
- `components/scan/VisualSession.ts`
- `components/scan/VisualWorkspace.module.css`
- `components/scan/VisualWorkspace.tsx`
- `docs/visual-rebuild-implementation.md`
- `lib/scan/archive-worker.ts`
- `lib/scan/gerber-display.ts`
- `lib/scan/project-session.ts`
- `lib/scan/visual-workspace.ts`
- `next.config.ts`
- `scripts/start-visual-rebuild.ps1`
- `tests/e2e/origin-review.spec.ts`
- `tests/e2e/project-session.spec.ts`
- `tests/e2e/scan-foundation.spec.ts`
- `tests/e2e/scan-gerber.spec.ts`
- `tests/e2e/source-registration.spec.ts`
- `tests/e2e/visual-workspace.spec.ts`
- `tests/visual-image-api.test.mjs`
- `tests/visual-workspace.test.mjs`
- `tsconfig.json`
- `workers/scan/archive_browser_cli.py`
- `workers/scan/tests/test_visual_image.py`
- `workers/scan/visual_image.py`
