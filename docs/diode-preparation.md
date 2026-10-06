# Offline diode preparation

`polarized-two-terminal-body-v1` constructs a new job-local body model and two
owned terminal-land reference windows. It supports unequal cardinal rectangular
top-layer lands. It reuses the existing reviewed, append-only preparation writer,
complete native archive export and saved-project history. It does not transfer
algorithms, pad bindings, FOVs, learned polarity positions or library membership.
All new placements/windows remain disabled. Eagle interpretation, teaching and
position retention after binding/save/reopen remain unverified.

## Required evidence

An explicit profile identifies the literal source pattern, graphics, component
definition and attached-pattern alias, the matched native CAD identity, drawing
URL/hash/page and structural format seeds. The fresh owned pad map must close on
exactly two component-definition pins. No role is inferred from reference names,
numeric pin conventions, silkscreen or a visible mark alone.

The diode-specific fields are:

- `body`: positive `widthMm` across the terminals and `heightMm` along them.
- `polarity`: `pinRoles` assigns the two linked pins to `anode` and `cathode`,
  plus explicit source-bound `evidence`.
- `anchor`: numbered source `padNumber`, `offsetAlongMm` and `offsetAcrossMm`
  from that land center to the physical body center, plus its own `evidence`.
  Unequal-pad midpoint or outer-land midpoint is never an automatic body datum.
- `electrodes`: separate manufacturer contact projections for anode/cathode,
  each with `role`, `widthMm`, `heightMm`, `centerAlongMm`, `centerAcrossMm`
  relative to the documented body center and `minimumOverlapFraction` (0.5–1).
  Actual source land shapes are preserved as window geometry; recommended lands
  do not replace them. Insufficient electrode overlap blocks preparation.

Along runs from anode to cathode; across is the positive 90-degree rotation of
that direction in the source pattern. Offsets rotate with the source placement.
The direction in the native board frame is recorded under the same explicitly
unqualified coordinate convention used by the paired-terminal constructor.

Both evidence records contain `documentId`, `sha256`, `page`, `locator`,
`statement`, `layoutSha256` and `method`. Supported methods describe numbered
footprint/library, dimensioned assembly or manufacturer package correspondence.
These are reviewed evidence declarations, not automatic document authentication
or interpretation. The statement must explain the actual dimension/pin
correspondence. Source hashes are rechecked before writing.

`anchor`, `polarity` and `electrodes` may be `null` to persist precisely what is
missing. Such a profile produces `PACKAGE_DIODE_EVIDENCE_MISSING` holds, no native
records, no allocations and no prepared-component credit. Generic code/fixtures
never contain a manufacturing board's identities, geometry or pin assignments.

## Preservation and review

Append new profiles after existing profiles to retain deterministic earlier
allocation order. Overlapping profiles and competing template routes refuse.
After recomputation, exact item decisions from the same captured archive/layout
can survive a changed plan; altered records require fresh review. Historical
profile snapshots remain intact. Fresh acknowledgment is required for every
export, including after project reopening.

Qualification tests cover both footprint axes, every cardinal rotation, nonzero
body datums, unequal terminals and explicitly reversed electrical roles; missing
or stale evidence, mismatched contacts, rollback and repeated application.
Archive and browser tests exercise real linked-record insertion and project
reopening using wholly invented sources. Actual manufacturing runs must be
reported separately, including refusals. A reference in a hold/report is never
counted as a prepared part.
