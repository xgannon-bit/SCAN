# Image Registration R02 follow-up

This increment retains the 3226 milestone, with a separate
`.next-image-registration-r02` build and port 3228. Build with
`SCAN_IMAGE_REGISTRATION_R02_BUILD=1`; launch using
`scripts/start-image-registration-r02.ps1`. No existing demonstration is rebuilt.

## Review corrections

IR-01: pixel axes now have independently optional drafts. A partially entered or
cleared pair stays null in the numeric request; unknown is never measured zero.
Drafts survive save/reopen. A literal zero is supported, and a photo pick sets
both axes. Request/draft inconsistencies in saved JSON are rejected.

IR-02: explicit review records bind a SHA-256 of the exact canonical request,
source/capture and snapshot identity, image/hash/dimensions, reviewer and time.
Unmodified reviewed context must still pass fresh source checks and a new numerical
fit on reopening. Changes to controls, evidence, tolerance or conventions invalidate
the review. Legacy reviewed flags without a bound receipt retain their request but
require explicit re-review. The viewer blocks overlays while checking identity.
Fingerprints stored in editable JSON provide context integrity, not authenticated
approval; someone who deliberately rewrites both request and receipt can fabricate
an annotation. This never grants native-write, machine or release authority.

IR-05: the fit table reports pixel residuals and lengths derived from the declared
scale, alongside pixel/derived-mm tolerance, fit/check roles and qualification
limits. Clean Board and the existing layer controls hide engineering overlays.
Neither mm conversion nor numerical success establishes physical calibration.

## Image performance improvement

IR-04: an ephemeral tab-local cache keeps only rehashed encoded originals, at most
three assets / 32 MB, with a five-minute TTL. Exact verified source/capture and
Job/Master selection define one cache epoch. Source changes/clear/reopen invalidate
it. Every hit verifies member hash and byte length against fresh preserved-file
evidence and rehashes the Blob; every display rechecks natural decode dimensions.
Delayed reads cannot publish or populate another source epoch. The cache contains
no decoded textures, object URLs, candidate authority, persistent disk files or
saved derivatives. Object URL/bitmap ownership remains with each consumer.

Repeated same-source selections can avoid transferring/parsing the whole archive.
This does not remove large embedded-project memory or browser/GPU decoded-image
retention. Private profiling reports per-process working sets, lifetime peaks,
renderer heap, transfer count and latency distributions. A browser-only bounded
overview prototype is measured separately; it is not substituted for original
pixels, used as a control image or persisted into a project. Pillow is absent from
the current worker environment; no new decoder is installed.

## Actual-source boundary

IR-03: actual R04 scan properties and dedicated global fiducial parameters are
present, but they do not by themselves prove coordinate units/axes/ROI anchor,
pixel calibration, capture-member correspondence or physical panel instance.
Some scan-dimension/resolution groups differ and require interpretation evidence.
No placement is marked as a fiducial in this inspected R04 copy. The current
ROI-center wizard cannot select those distinct global fiducial records. A new
adapter is held until its scope and coordinate semantics can be qualified.

Keep R04 unregistered. Existing originals, revision-matched manufacturing sources
and private evidence are inspected locally; do not request duplicate archives or
use historical repaired coordinates as controls. The private evidence map gives
the exact read-only screenshots/export needed to resolve each unknown. Two known
fiducials do not replace three noncollinear controls and a disjoint check.

Public fixtures are wholly authored. Negative units/browser tests cover partial
axes, explicit zero, clears/picks, saved draft consistency, edited review/evidence,
within-tolerance changed controls, legacy flags, exact fresh reopen and cache
scope/corruption/eviction/expiry. Existing replay, full-board and writer protections
remain required. Actual-source, preservation and performance results are delivered
outside the public repository, with executed commands and testing limitations.
