# Coordinate contract and reviewed source registration

The Board workspace includes a reference-pair review for source placements,
comparison placements, source PCB origins and selected native CAD literals.
The existing Gerber workspace remains the artwork registration path. All source
bytes remain immutable. Neither workflow writes native coordinates or bindings.

| Link | Established offline | Still unqualified |
| --- | --- | --- |
| Placement row to normalized placement | Exact columns, declared mm/inch/mil factor, module/side, original strings and explicit CW/CCW conversion | Whether the selected revision, physical side and footprint-origin convention are appropriate for this board |
| PCB pattern to source board | Source-owned numbered pad coordinates, local origin and source rotation; unsupported geometry and flips retain holds | A footprint anchor being the physical body center; board side when source parser reports null |
| Gerber to physical mm | Declared/effective FS, MO units, interpolation assumptions, polarity and repeat instances | Pad ownership, correct board instance and native artwork equivalence |
| Reviewed source scope to target source scope | Proper rigid transform at fixed scale one, at least three noncollinear fit origins and a distinct independent checkpoint | Native frames, optical alignment and release authority |
| Native CAD to module/Part ROI | Exact literal identities and fields; original module records preserved | Numeric units, module transform semantics, origin conventions and runtime propagation |
| Master/window local to Part | Exact Master/parent/group links; separate local offsets and rotation; constructor geometry hypothesis | Image-dependent teaching, native pad binding tuples, shared propagation and position retention |
| Board/FOV to image pixels | Asset identity, literal FOV inventory | Origin, pitch, extent, distortion and side/module mapping; no unqualified board-image overlay |

The new review refuses to infer a mirror or fit a scale. Pairwise control-point
distances must agree within twice the reviewed residual threshold; fit and held-out
residuals must each pass. Controls cannot repeat a physical point. Every reference
is matched uniquely inside explicitly selected module/side scopes. Missing,
duplicate or source-held references remain visible. Unselected local outliers
block a blanket coordinate derivative; they are not automatically CAD defects.

Both source revisions and reviewed physical sides must be recorded. A mismatch
keeps the numeric comparison available but holds correction. Filename revision
hints are consistency checks, never approval. Null PCB side requires documented
source evidence; unflipped geometry alone is not labeled top. Native CAD values
always remain a numeric hypothesis with unqualified units, even when a reviewer
checks the source frame acknowledgement.

Before/after SVG views show source and target origins with residual lines. Exact
source identities, module scopes and residuals remain available in the table and
download. The view does not move native CAD to conceal an inspection-window error.

An accepted, current source-only transform can produce a separately named AOI-only
JSON derivative containing original identity/coordinates, transformed millimeters,
rotation convention, exact hashes, interpretation, frame, scopes and reviewer
decision. It is not an Eagle import profile or native job. Missing rotation stays
explicitly null. Rejected or stale decisions cannot produce the derivative.

Projects retain bounded source-review settings and a digest-bound decision, never
a stored transform or restored authority. Reopening reparses the original bytes,
rebuilds all pairs and the transform, and rehashes source data, interpretations and
evidence. Source, mapping, scope, revision, evidence or reference-role changes make
the old decision unusable. Repeated exports derive the same records without
mutating inputs or appending records.

Tests use authored source origins: cardinal rotations and nonzero translations,
explicit unit normalization, wrong units, swapped axes/reflections, side/revision
conflicts, local-origin outliers, duplicate/missing references, independent checks,
stale/rejected decisions, save/reopen and browser export. Actual-source results
belong in private delivery evidence; synthetic tests do not qualify Eagle.
