# A05 snapshot preflight

Implemented: independent verification of an A04 `.scan-snapshot` and bounded
read-only XML envelope inspection. This is the first A05 increment, not a complete
native semantic reader or dependency resolver. The browser remains the tested
A07 placement importer; this new action is CLI-only.

Use the pinned `.venv` interpreter from the repository root. Send one UTF-8 JSON
request to `workers.scan.worker_cli`:

```json
{
  "protocolVersion": "1",
  "action": "inspect-snapshot",
  "source": "C:\\approved-private-storage\\selected.scan-snapshot",
  "expectedPackageSha256": "<lowercase SHA-256 returned by capture>"
}
```

The expected hash must come from the original capture receipt or another trusted
record. Computing a new hash of a suspicious package cannot prove it is the same
capture. The original source ZIP need not remain available for inspection because
the snapshot contains its exact bytes. A report can be redirected into approved
private storage; source paths, member names and hashes are confidential runtime
data and must not be published or pasted into hosted tools without authorization.

The response is a `protocolVersion: "1"` envelope containing `result`. A successful
report has artifact type `scan.snapshot-preflight`, schema version `1` and reader
version `a05-envelope-1`. Exit 0 means the preflight report was recorded, not that
the native job is complete or compatible. Exit 2 is a blocked integrity/request
failure; exit 3 is an unsupported snapshot schema version. XML preflight failures
appear as document-level holds after byte integrity verification succeeds.

## What is verified

The reader checks the expected package hash, creates a bounded opaque temporary
copy, and verifies that copy has exactly the expected bytes. It then verifies:

- Outer member names, roles, compression, sizes and manifest structure.
- Original archive SHA-256/size and every inner member's actual size, CRC and hash,
  including unselected images/history/unknown assets.
- Recorded inventory membership, classifications, roots and holds against a
  freshly computed inventory, including duplicate/colliding/traversal rejection.
- Exact selected job/master bytes against their archived members and role/root.
- Deterministic snapshot ID against the archive hash and explicit selection.
- Fresh source hash and fingerprint before returning the result.

No member name becomes an extraction path. Temporary files use fixed opaque names
in an owned OS temporary directory, removed on normal success/failure. An abnormal
process/OS crash can leave temporary files. The CLI host must enforce cancellation
and a wall-clock timeout; the browser does not yet invoke this action.

Limits are independent of the manifest's recorded limits. Current reader limits:
620 MB outer package, 20 MB manifest, 100 MB original ZIP, 250 MB per inner file,
1 GB total inner payload, 10,000 inner entries and 250:1 inner compression ratio.
Outer snapshot v1 entries must be uncompressed. Captured limits are returned as
provenance and can never increase these limits. Duplicate JSON keys, nonfinite
values, unsupported versions, mismatched types and capability-authorizing flags
are rejected.

A shared bounded central-directory scan runs before Python allocates ZIP entry
objects (also applied to A03 inventory and A07 XLSX intake). It checks actual
record counts rather than trusting the declared count. Directory metadata limits
are 256 KB for outer snapshots and 16 MB for inner archives. Split archives,
self-extracting prefixes, trailing data and ZIP64 end directories are currently
unsupported and fail closed. ZIP64 local headers used by A04's small stored
members remain supported; they do not require a ZIP64 end directory.

## What XML inspection means

The pinned defusedxml 0.7.1 parser forbids DTDs, entities and external access.
A streaming target retains structural counts and bounded root/direct-child version
claims without constructing a full XML tree. Limits: 16 MB selected XML, 250,000
elements, depth 128, 4,096 distinct names, 64 attributes per element and bounded
version claims. Comments and processing instructions are counted, never executed.
An over-limit XML document remains preserved and byte-verified but unread.

Root names and version text are opaque source claims. They do not select a native
adapter, identify the installed Eagle build, establish units, resolve models, or
prove compatibility. Unknown fields remain in the original bytes; nothing is
serialized back to native XML. No file path mentioned inside XML is opened.

## Readiness and product boundary

`integrity.status = verified-against-capture-hash` is independent of native readiness.
`packageComplete`, offline coverage, machine compatibility, teaching/validation
and release remain null. Represented/enabled/taught/verified/released counts are
also null. `dependencyGraph` and `candidateId` are null. Native schema support and
machine export are false. `changes` is empty.

`preservedFiles` records every captured asset with its original path, hash, size
and conservative file classification. This is not a required-dependency list.
Holds are explicitly job- or document-scoped and name the missing native adapter,
dependency rules, machine evidence, selected master or XML preflight prerequisite.
No placement identities or machine teaching actions are invented from filenames.

The complete native engineering bundle remains the product destination, described
in [product requirements](product-requirements.md). This JSON preflight report is
an intermediate artifact, not that bundle. The next A05 semantic increment needs
version-specific format evidence and independently authored adapter fixtures;
writer gates, repair review and authorized Eagle compatibility evidence remain.
