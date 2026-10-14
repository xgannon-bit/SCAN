# Image registration and photographic engineering workspace

Local increment on `scan-visual-rebuild`, base `eb50b4b`. Existing uncommitted
native, full-board, Board Evidence R02 and Image-First work is retained. Build with
`$env:SCAN_IMAGE_REGISTRATION_BUILD='1'; npm run build`; start with
`scripts/start-image-registration.ps1`. This uses port 3226 and
`.next-image-registration`, leaving the 3221 and 3224 evaluation builds intact.

## Implemented workflow

Photo gallery has an explicit inventory retry. A transient failure can recover
without a page reload; abort/context checks prevent an old inventory response
from replacing the current source. Successful catalogs remain cached.

The Image mapping tab is a three-step wizard in the existing Board workspace:

1. Bind one preserved original board-image member/hash/dimensions to an exact
   native Job/Master snapshot, physical side, module/panel instance and matching
   revision. Establish units, native Y and ROI angle conventions, the physical
   meaning of the literal ROI anchor, and uniform-distortion assumptions.
2. Select exact native module/RefID/Part ID/Master identities and original ROI
   values. Pick or enter same-feature image pixels, with evidence. Three fit
   features and a spatially separate independent check are required. Native
   inspection and photo views remain available on this same canvas.
3. Supply a justified pixel tolerance and reviewer. Calculate a uniform
   similarity, inspect fit/check residuals, then separately review the mapping.

The worker uses fit points only; it never fits the independent check. Both native
and pixel fit controls must be noncollinear, and fit controls must span at least
25% of both native scope extents. A uniform pixel scale/rotation/translation and
explicit Y inversion are supported. Unapproved reflection, shear, local warps,
unknown conventions and failed residuals are held. The pixel contract is separate
from the unchanged proper-rigid CAD/Gerber guard. Numeric success does not prove
the physical correspondences, calibration, body center or optical correctness.

The application independently reproduces the returned residuals and checks the
exact request fingerprint. A saved project contains controls, assumptions,
source identities and the review decision, never a trusted transform or machine
proof. Reopening rereads sources and image metadata and computes a fresh fit.
Changed hashes, selection, schema, dimensions, identities, paths or before-values
invalidate display. Candidate photo registration is explicitly held pending
separately bound frame-equivalence evidence.

After successful checks and review, component selection projects its literal native
ROI into the selected photograph, smoothly focuses the canvas (instant with reduced
motion), and provides an adjustable crop of original pixels. Arbitrary ROI angles
use the declared axes/angle convention. Return restores the preceding photo
viewport during the current session; that return checkpoint is not saved across
reloads. The current viewport/crop radius and selection are saved. Model-reference
photographs remain a separate tab and never become current-board inspection images.
Unregistered, other-instance and off-image component crops are held.

Six photographic layer presets and current engineering-state filters control
native ROI/origins, independently supported CAD/Gerber diagnostics, fit/check
controls, reviewed proposal previews and actual worker-event layers. Each source
retains its existing guards; no distance-based pad ownership is introduced.
Native windows, bindings and FOV coverage remain explicitly held. Read-only
presentation cannot accept repairs or change native files.

Analyze on board keeps a reviewed photograph visible. Genuine worker events
highlight scoped components; cancellation removes live activity. Completed-run
results require explicit display and remain static. Recorded Replay reuses recorded
outcomes on that photograph without issuing repair or image-fit requests. Existing
candidate receipts remain distinct from in-flight work and machine qualification.

Archive admission still permits one archive worker at a time. The API now identifies
contention with 429/WORKER_BUSY before reading another upload. Saved-project
inventory/preflight reads can wait up to twenty one-second intervals for that
budget to be released. Other failures are not retried; cancellation stops the wait.
No engineering writer/export is automatically retried.

## Demonstration and limits

Public tests use authored geometry, native-like XML and colored raster grids.
They are labeled SYNTHETIC and establish software behavior, not machine validation.
Actual R04 photography remains unregistered. Its missing evidence is the exact
photographed revision/physical side/panel instance, native ROI units/axes/angle/
anchor conventions, raster orientation/calibration/distortion assumptions, three
noncollinear same-feature fit controls, a disjoint check, and justified tolerance.
Existing local R04/Rev11 files are retained; duplicate files are not needed.

Matched inspection-window coordinate semantics, candidate frame equivalence,
binding/FOV coverage, TIFF pattern conversion, Eagle open/save/reopen and physical
teaching/defect validation remain separate milestones. RCP retains release authority.
No push, deployment, machine/shared-library write or enabling operation occurs here.

## Verification

See `tests/image-registration.test.mjs`, `tests/archive-source-read.test.mjs`,
`tests/e2e/image-registration.spec.ts`, and
`workers/scan/tests/test_image_registration.py` for focused guards and integration.
Run `npm test`, the Python regression suite, the isolated production build, and
the existing full-board/image/replay/source-registration/native writer browser
regressions. Private actual-source, preservation and laptop stress results are
delivered outside the public repository, with exact commands and limitations.
