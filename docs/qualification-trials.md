# Restricted qualification trial writer

`workers.scan.qualification_candidate.create_qualification_candidate` creates a
separate transport package for an explicitly accepted engineering experiment.
It does not generate proposals, interpret geometric evidence, establish required
dependencies, operate Eagle or approve production use. The regular application
repair/export control remains unavailable.

The caller supplies the original ZIP path, a new local destination outside the
checkout ending in `.scan-qualification.zip`, and a versioned request. The
module docstring defines the exact fields. No extraction into a machine job
directory is performed. The caller must choose isolated private storage.

## Required review inputs

- Exact original archive hash, explicitly selected main member/root, and main
  XML hash. The observed literal XML format claim must be exactly `10.2`; this is
  not an Eagle application version. Unknown target build/machine remain null.
- Independently supported evidence declarations, each with a summary and hashed
  references. The writer binds these declarations but cannot establish whether
  they are correct or complete.
- Exact original part ID, parent/module literal, Master key and `RefID`, ordinal field
  path, before/after text and evidence links for each proposal.
- Explicit reviewer, trial purpose and exact acceptance digest. `proposal_digest`
  computes a binding hash; computing it does not constitute approval. Never
  create accepted decisions from a user note or historical candidate diff.

The ordinal is only a location hint: native identity must resolve uniquely there,
and exactly one plain `RefID` must match. A matching reference cannot disambiguate
duplicate native identities. Requests missing `RefID` are refused; adding it
changes the proposal digest and requires review of the revised proposal.

Supported mechanical targets are narrowly limited to placement `Roi/cx`,
`CenterPosX`, `WND_PAD`, `ListGerPadId1`, `ListGerbPadId_Common1`, and the exact
`ENABLE` transition `True` to `False`. Inclusion in this list is not proof that
an operation is appropriate for any job. Other fields and enabling are refused.

Pending, rejected and unreviewed proposals do not apply. Optional
`dependencyProposalIds` bind changes that must be accepted together. Every
dependency of an accepted proposal must also be accepted; a partial dependent
operation is refused. A request with no accepted changes is refused.

## Preservation and output

The writer freezes and rechecks the source, locates literal XML text with a
bounded parser, checks exact identities and before values, replaces only the
accepted byte spans, and reparses. Duplicate target/owning structures, attributed
or entity-containing target scalars, actual namespaced native elements, unsupported
encodings and stale approvals are refused. Unused prefixed namespace declarations
are preserved; they do not put unprefixed elements in a namespace.

Every other original member payload remains byte-identical, including Master,
temporary/backup snapshots, images, unknown files and teaching. Repacking may
change ZIP container bytes. Each original/candidate asset hash is recorded.
Preserved Temp/backup snapshots retain their original state, not the candidate
edits. They must not be silently substituted for the selected main XML during
testing. The receipt and README name the selected main member and warn about this.
Publication is atomic and cannot overwrite an existing file. Cancellation before
publication produces no final output. A cleanup problem after successful
publication is reported separately from publication success.

The wrapper contains:

- `CANDIDATE.zip`: complete original native member names/layout plus accepted
  scalar edits. The ZIP is transport; no Eagle import procedure is implied.
- `qualification-receipt.json`: exact changes/decisions, unapplied proposal
  identities, source and candidate hashes, per-asset before/after hashes and
  explicitly unqualified machine/semantic/release states.
- `README.txt`: qualification-only instructions and preservation boundary.

This does not satisfy the full engineering handoff by itself. Required asset
resolution, intended geometry, exact remaining teaching, controlled OEM saves,
Eagle open/save/reopen, fresh-board optical tests and release need separate
evidence. One trial must not qualify another operation, version or machine.
The receipt explicitly leaves pad-binding and dependent-window qualification
unresolved and inspection repair unestablished. Even a successful Eagle open
cannot clear those checks; placement acceptance alone does not prove inspection
geometry or teaching is correct.
