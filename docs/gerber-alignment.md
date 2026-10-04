# Gerber intake and rigid registration

Use Source intake to read a local `.gbr` or `.gbx` layer, up to 8 MB. Original
bytes and SHA-256 remain unchanged. A malformed source declaration can be
reviewed explicitly: select an effective FS declaration and/or confirm initial
linear interpolation where the source omitted G01. The report retains declared
and effective formats and every assumption. It does not silently repair files.

The bounded RS-274X profile supports MM/IN, leading-zero absolute FS, standard
C/R/O/P flashes without holes, circular-aperture G01 draws, dark/clear polarity,
file/aperture attributes and bounded rectangular step-repeat. Legacy G54
selection and LN metadata produce warnings. Standalone D01/D03 operations and
legacy modal-state resets are interpreted explicitly. Step-repeat preserves
whole-block polarity order, varying Y before X, and resets the current point.

Macros, regions, arcs, holes, non-circular draws, image transforms and unsupported
commands withhold all drawable geometry. This is a limited profile, not a claim
of universal Gerber support. Geometry output is capped at 30,000 objects and
16 MB serialized JSON. Source, command, numeric and cumulative metadata limits
are enforced before expensive expansion. UTF-8 metadata is accepted; numeric
syntax remains ASCII with no exponent notation.

## Review alignment

Board workspace shows Gerber geometry in physical millimeters with display-only
Y inversion, zoom and pan. Source CAD origins remain in their original frame.
Choose one placement module/side and identify the Gerber board instance. Enter
three widely spaced noncollinear fit correspondences and a separate physical
check point. Select placement source points or enter CAD coordinates in mm;
click a dark flash to copy its Gerber center, or enter reviewed feature coordinates.
Pad centers, package centers and footprint origins are not interchangeable.

NumPy SVD fits a proper rotation and translation at fixed scale one. Reflection,
degenerate geometry, duplicate physical points and malformed values are rejected.
Held-out checks never participate in fitting. Every fit and check residual must
pass the stated positive tolerance using full precision. A failed residual may
show a diagnostic overlay, clearly marked as held.

The alignment identity includes source hashes, normalized placement digest,
normalizer version, delimiter, sheet, mapping, source frame, Gerber reader,
effective format and assumptions. Source/interpretation/scope edits clear control
points and alignment synchronously. Late responses cannot restore an old result.
Successful checks validate the selected physical correspondences only; they do
not assign pad ownership, qualify native geometry or enable native export.

## Save, reopen and handoff

Save review includes original placement/Gerber bytes, interpretations and control
points in a bounded 26 MB source-review file. Reopening validates both source
hashes, reparses locally and recomputes a previously checked alignment. Controls
are cleared if the fresh interpretation identity differs. Stored transforms and
capability flags are not accepted as authority. Corrupt review files leave the
current sources intact. Existing placement-only review files remain supported.
Native archives remain separate and must be selected/verified independently.

Handoff JSON contains full Gerber and alignment evidence; its readable report
contains hashes, assumptions, status, transform, tolerance and residual summary.
Native program construction and Eagle load/save/reopen qualification remain
unfinished, even when source parsing and registration pass.

## Runtime and verification

Runtime dependencies are pinned with hashes: xlrd 2.0.2 for bounded literal-cell
BIFF8 reading, and NumPy 2.5.3 for rigid fitting. The NumPy wheel hash currently
targets **CPython 3.14, Windows AMD64**, matching the demo laptop. Other platforms
need separately reviewed wheel hashes before installation. XLS formulas,
external references, macro streams, encryption and embedded objects are rejected.
BIFF worksheet offsets must match fully scanned BIFF8 substreams, preventing
cached formulas hidden behind forged offsets.

Public tests use independently authored Gerber, OLE/BIFF8 and native XML data.
Private/source-file acceptance evidence belongs outside this repository. Local
tests do not establish machine compatibility or optical defect detection.
