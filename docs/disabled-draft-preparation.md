# Disabled native part preparation

Repair Review now derives complete missing-part proposals from verified ACCEL
source layout and explicitly selected main native job/Master snapshots. Source
family review links directly to this workflow. Pre-arrival CAD/Gerber/BOM
reconciliation remains available without a native template.

## Supported job-local route

`native_preparation.py` implements `job-local-same-footprint-disabled-1` for the
observed JobContainer 10.2 record fields. The adapter requires a unique source
reference, explicit owned pad outlines, zero-hole/unflipped evidence, the same
source pattern/graphics/local geometry and source orientation/side as an existing
placement, and the same native CAD angle in the same module. Literal package
names alone cannot qualify a model. Duplicated template references, special
linked/fiducial/Z-map/FOV templates, polygon windows, unknown fields and external
window links are held. Different rotation and missing-model families need a
separate adapter; no nearest-pad association or scan-free job invention occurs.

A compatible existing job-local Master provides rectangle/window structure.
Each accepted part gets a unique placement ID, MasterKey and number, complete
new Master record, and complete disabled windows. Window IDs and groups retain their exact local keys and links within the new
Master scope. The source can use alphabetic window keys and reuse them across
Masters; these are not global numeric placement IDs. Only placement, Master and
number identities are newly allocated, reserving observed numeric identities and
references across both documents, including dangling references.

Placement ROI and stored center translate by target native CAD minus template
native CAD. Existing legitimate ROI/center offsets, local Master ROI, CAD offset,
window rectangles and orientation are preserved. Source-to-native registration
is not invented. Target identity comes from its unique native CAD correspondence.
The complete old placement, Master, teaching and algorithms remain byte-identical.

In NEW records only: inspection is disabled, pad/FOV binding lists are empty and
algorithms are omitted. Other template settings, including ModelNo and polar
position, are copied as explicitly unqualified settings. Polar position is not
silently translated. The remaining-work list requires reviewing its coordinate
frame and target suitability at Eagle. This is structural model preparation,
not completed binding, optical teaching or defect-detection validation.

## Review, apply and resume

The worker computes complete XML append records before review. The UI requires
an individual decision for each component, a named reviewer and qualification
acknowledgement. Every export re-derives the complete plan from fresh source bytes
and compares exact digests, archive identity, selected snapshots and source layout.
Held items cannot be accepted, arbitrary XML cannot be supplied, and no accepted
items means no candidate. Reapplying a recipe to an already modified candidate
fails source/digest checks. Original sources are never modified.

Only the selected main job and Master XML payloads change in the copied archive.
Removing precisely the appended byte spans restores both original documents.
All other members, Temp/backup payloads, images, archive order, comment and entry
metadata are preserved and independently reopened/hash-checked. No machine files
or shared libraries are written. Existing destinations are never overwritten.

The engineering download contains the complete native candidate, exact appended
records, reviewer decisions, source/software identities, payload preservation
receipt, actual candidate component accounting, freshly rebuilt candidate
Master/window/algorithm work and remaining Athena checklist. Candidate accounting
marks preparation only when the actual new disabled placement identity exists;
a reference in a proposal does not count as prepared. Unaccepted and unsupported
parts remain separately visible. Population and intentional exclusion remain
unresolved until the appropriate evidence is supplied.

The browser wraps this with a reopenable project containing original sources,
source selection, exact decision digests and candidate history. Reopening verifies
sources and rebuilds analysis. It retains decisions only for an identical fresh
plan and source context. Candidate bytes remain in their downloaded revision;
reopening never silently makes that candidate the original baseline.

## Qualification boundaries

Every output is **QUALIFICATION ONLY**. Offline XML structure, dependency closure,
byte preservation and transport tests do not prove Eagle compatibility or
inspection behavior. New parts/windows stay disabled. Pad ownership, dependent
window geometry, polar frame, template settings, FOV assignment, image algorithms,
population and physical verification remain explicit Athena work. Existing
teaching is preserved but never promoted to verified teaching.

Temp and backup snapshots retain ORIGINAL state. Do not substitute them for the
two selected candidate main documents during qualification. Record machine and
exact Eagle build, original control save, candidate open/save/reopen and fresh
board optical results separately for each Athena. RCP retains release authority.
Rollback means abandoning the candidate and returning to the untouched original.

The older `disabled-two-rect-pad-structural-1` minimal synthetic trial remains a
separate test profile. Its restrictions and scalar C18 approval do not authorize
or qualify this complete-record route.
