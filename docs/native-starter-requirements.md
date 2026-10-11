# Native starter requirements

SCAN's current writer prepares new **disabled qualification drafts** inside a
complete separately copied job. Its existing-job route stays available. A real
Eagle job containing only scan images, fiducials and PCB color has not yet been
qualified. An empty list parsing successfully is not proof of a usable starter.

## What the writer currently requires

Select the main JobContainer 10.2 job and its main local Master explicitly. The
job must contain its module and unique matching native CAD rows. Originals,
images, companions, Temp and backup snapshots remain separate and preserved.

Each constructor uses an explicitly selected job-local placement, its uniquely
linked Master, and independent rectangular **Mount** and **Solder** window
records as structural format seeds. Their supported fields must pass validation;
special fiducial/linked/FOV structures, unknown dependencies and opaque learned
window data are held. A same-footprint reuse route instead needs a compatible
existing source-owned template and its supported closed window set.

These records provide native field structure, not proof of body dimensions,
origin, polarity, native coordinate meaning or correct teaching. Owned source
geometry and separately reviewed package evidence establish new geometry. New
binding/FOV lists and algorithm lists remain empty, and new placements/windows
remain disabled. No universal production template or default algorithm is
invented. Existing algorithms are preserved only in their original records.

The review response and `starter-seed-requirements.json` export identify each
required content type, present/missing state, selected profile seed check, exact
hold code and next action. These diagnostics are derived from source bytes and
do not alter accepted proposal digests. “Present” does not mean machine qualified.

## Empty and sparse collections

The version-bounded insertion helper accepts one explicit or self-closing
`PartDataList` / `WindowDataList` at its exact supported document path. Explicit
lists receive reviewed new records immediately before their existing closing
tag. For a self-closing list, only that list's slash delimiter is expanded and
the reviewed records plus matching closing delimiter are added. No other
original XML is serialized. Recorded inverse edits must recover every original
byte, including original whitespace, comments, unknown preserved record fields
and the original empty-tag spelling.

Missing/repeated collections, collection attributes, mixed collection text,
unknown direct record kinds and unsupported schemas stay held. Expansion is
serialization support only: an all-empty starter still lacks the job-local
placement, Master and window seeds needed to create a model. SCAN exposes that
specific missing structure rather than inventing it or misreporting a generic
empty-container error.

Wholly synthetic derived tests cover explicit and self-closing empty lists,
sparse lists, untaught structural seeds, exact rollback, rejected stale/repeated
apply, unknown schema holds and preservation of existing teaching. Private
checks can strip a copy of a known job to exercise the same refusal. Neither
kind replaces a genuine Eagle starter open/save/reopen qualification.

## Smallest remaining qualification

A separately copied genuine scan/fiducials/color-only job from the intended
Eagle build would establish which structural records Eagle actually saves at
that stage. Inspect its missing-content report first. If it has no supported
seed records, the current route remains held; defining a validated minimal seed
is a separate format qualification, not permission to borrow unrelated teaching.
The already supported existing-job route continues independently.
