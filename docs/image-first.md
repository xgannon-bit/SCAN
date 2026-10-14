# Image-first milestone A and supported B

This document describes the preserved 3224 evaluation increment. The later
[image registration increment](image-registration.md) adds a reviewed mapping
wizard, supported photographic crops/layers and real processing integration on
a separate build/port; actual R04 registration remains held.

Built on `scan-visual-rebuild` base `eb50b4b`, preserving its uncommitted full-board
and Board Evidence R02 work. Local image-first development uses port 3224 and
`.next-image-first`; 3221 and 3223 builds are not overwritten. Start with
`scripts/start-image-first.ps1` after building with `SCAN_IMAGE_FIRST_BUILD=1`.

## Implemented route

Open a saved project or explicit native Job/Master snapshot in Board workspace.
Photo gallery verifies an on-demand image catalog from the preserved original
archive. It groups exact job-root rasters, selected Master PartImage assets,
PatternModel assets and other rasters. Folder categories are storage roles only;
filenames cannot establish physical side, module instance or capture channel.
No largest/newest-image selection. TIFF remains a visible decoder hold.

Raster catalog dimensions are bounded headers, not proof of a successful decode.
Only the selected original JPEG/PNG/BMP is decoded after fresh archive/capture,
member hash, byte size, MIME/magic and dimension checks. The pixel canvas supports
pan/zoom/fit, 100% CSS pixel view, a viewport overview and saved display brightness/
opacity. Unregistered photography contains no native, CAD, Gerber or processing
geometry. Native coordinate evidence remains in the same workspace, unchanged.

Select an original native component and open Reference image. A supported observed
JobContainer 10.1/10.2 reader must resolve one exact module/RefID/Part ID/MasterKey
placement and one exact selected MasterKey record. Its safe scalar PartCode must
correspond to one exact preserved PartImage filename stem; a conflicting placement
PartCode, duplicates, stale context or missing assets holds association. There is
no normalization, substring, RefDes, appearance or proximity matching. This is an
observed model-reference storage correspondence, not certified vendor semantics.
Model photos are explicitly not current board-instance or Eagle OK images.
Candidate reference viewing is held; this catalog belongs to the original snapshot.
Opaque pattern algorithm identifiers are not guessed into image associations.

On-board detail states registration required. Bookmark visible pixel region saves
a source/member/hash-bound manual note, explicitly without a component association.
It is shown only when the current verified image/hash/dimensions still match.
Saved views retain image selection, camera, component selection and display settings;
no raster blobs/derivatives are duplicated in projects. Reopening re-verifies source
archive/member bytes and decodes again. Replay remains native and read only; exiting
restores the preceding view/camera/selection. No presentation setting grants proof.

## Performance and safety

Catalog limit: 256 assets, 256 MB cumulative inspected encoded rasters, with explicit
omission/held reasons. Selected raster limit: existing 32 MB / 80 MP. No gallery-wide
decode. The image consumer closes validation bitmaps and revokes owned object URLs
on selection changes, mode changes and unmount. The reference consumer reads only
on its explicit tab. Archive worker budgets, same-origin checks and timeouts remain.
No new decoder dependency, remote CDN, inference/image service or native writer.
SVG and the existing camera remain the renderer; no new competing viewer scene.

## Remaining milestones

This implements A and supported B, with explicit registration-dependency UX.
The control-point wizard, pixel similarity-transform receipt, qualified mapped
board crops and photographic processing overlays are NOT implemented. They need
exact revision/side/module/panel instance, native/physical/pixel conventions and
same-anchor controls: at least three noncollinear fit features, a disjoint check,
and a justified tolerance. Mapping must bind source/image hashes and invalidate
on changed input. Scale/Y inversion needs a separate pixel-frame contract; the
proper-rigid CAD/Gerber guard is unchanged. Actual R04 remains unregistered and
the two photographed PCB areas have no inferred module assignment.

Next: build that read-only registration contract and wizard, positive/negative
authored fixtures, then qualified same-canvas geometry/crops/processing. Rich
engineering presets/filters, pattern TIFF conversion and a microscope follow the
qualified geometry. Eagle teaching, bindings/FOV coverage and release remain separate.

## Verification boundaries

Public fixtures contain authored colored PNGs and fictional native structures.
Image/reference/stale identity tests, malformed/oversized raster tests, optional
presentation validation and browser save/reopen/replay tests are local. A 25.6 MP
authored raster and 3,000 native records exercise the retained SVG architecture.
Private actual R04 image execution, hashes, screenshots and preservation checks
belong outside Git/source ZIP. They are not machine compatibility or optical tests.
Exact run commands, results, source manifest and limitations accompany the private
milestone handoff. No hosted CI, push or production operation is authorized.
