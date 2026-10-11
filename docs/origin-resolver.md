# Source origin and body anchor review

The origin resolver interprets placement sources without editing a native job.
It retains the original point, source units, revision, module, known/unknown
side, rotation convention and the declared meaning of the input anchor.

A fixed-scale proper rotation and translation must have three noncollinear
identity-matched fit origins and an independent checkpoint. The resolver
rechecks the exact source hash, mapping, identities and control coordinates.
Local component residuals do not invalidate an otherwise supported numeric
frame witness, but scale, reflection, revision, control and stale-source errors
do. The resolver does not fit a separate offset for each component.

The PCB footprint origin is the source placement's declared anchor. Owned pad
points and an explicit numbered-layer pad-envelope midpoint are separate
geometric witnesses. A pad-envelope midpoint is **not** automatically a physical
body center, paste opening or optically inspectable joint. Unresolved pad-stack
class layers remain unresolved even when one explicit layer can be displayed.

The read-only body-evidence worker receives the PCB bytes, BOM bytes and reviewed
manufacturer profiles, never a centroid position or proposed corrected value.
It checks source ownership, numbered pin mapping, package/body geometry and the
manufacturer drawing profile through the same evidence functions as the native
constructors. It does not read or insert native Masters, windows or algorithms.
Body local coordinates are rotated about the source footprint origin and their
board coordinates are independently reconstructed again in the resolver.

Exact BOM package matching is intentionally conservative. The existing profile's
`nativePartNames` list is a set of literal identities, not a general manufacturer
alias database. Differences in punctuation, orderable variants or native name
sanitization need explicit identity evidence; the resolver does not remove
punctuation to create a match.

The classifications have different meanings:

- **Already consistent:** the original point agrees with the declared supported
  anchor. Agreement with a footprint origin alone does not prove body center.
- **Explained convention:** a source declared as a center agrees with the
  independent body center while its footprint origin differs. The difference is
  not evidence that the physical part moved.
- **Supported normalization:** a supported input anchor is represented using a
  different, explicitly selected supported output anchor. No physical movement
  is claimed.
- **Supported correction:** an explicitly declared body/footprint anchor
  conflicts with independently supported geometry. This is a source-only
  proposal requiring separate review, not a native repair.
- **Unresolved:** identity, frame, datum or independent package evidence is
  insufficient or conflicting. A generic “center” header alone does not prove
  which package point the exporter intended.

Explanation is separate from export eligibility. Unknown PCB side remains
unknown, even if the source is unflipped or a registration draft says top.
Missing or conflicting rotations, DNP population, stale evidence and duplicate
identities retain explicit row holds. Unknown-side normalized output is refused;
an as-supplied centroid derivative can preserve the original source's separately
known side without claiming a normalized PCB/body anchor.

Output rotations remain the registered placement's declared CCW rotation, and
must agree with the PCB placement rotation. They are not silently replaced by
the body's long-axis direction, pin-1 direction or an Eagle-specific rotation.

Neither numeric agreement nor source normalization qualifies native CAD units,
module transforms, Master/ROI/window frames, `WND_PAD`, FOV/image membership,
inspection teaching, position retention during binding or Eagle import syntax.
Those remain separate controlled machine checks. All native writes, if any,
must pass the native proposal writer's independent guards.

## Reviewed centroid interchange

The board workspace supports an explicitly reviewed as-supplied derivative as
well as evidence-gated footprint/body normalization. The CSV columns are
`RefDes,X_mm,Y_mm,Rotation_CCW_deg,Side,Module,PopulationEvidence`. Every field
is quoted; records use CRLF. Coordinates and angles serialize with six decimal
places and are parsed back within 0.000000501 mm/degrees. This is serialization
precision, not an accuracy specification or a qualified Eagle import format.

The export rederives rows and a digest from original source identity, complete
interpretation, BOM, anchor convention and independent report. Accept/reject
decisions bind to that digest and distinguish development tests from operator
source review. Undo removes the decision; changes make prior decisions stale.
The full output is refused while any row is held/unaccepted. A separately
acknowledged subset lists every excluded identity and reason in its manifest.
Known side is required; engineering DNP evidence is explicit and does not grant
population approval. Formula-like identities are held rather than silently
rewritten. Navigation or a source/decision change cancels a pending download.

Saved projects keep source bytes and review decisions, not a trusted derived
body report. Read the package/body evidence again after reopening when using
normalization. As-supplied review can be reproduced directly from the reparsed
placement/BOM and saved convention. The manifest retains source/BOM hashes,
mapping, original and proposed rows, decisions, exclusions and qualification
limits.
