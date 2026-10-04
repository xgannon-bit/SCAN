# A04 source snapshots

The local Python worker inventories a ZIP and captures an explicitly selected job
and master snapshot into a new `.scan-snapshot` file outside the checkout. This
container is a SCAN source record, not an Eagle/Athena job or compatibility test.
The browser demonstration does not yet invoke this workflow.

Run `py -3 -m workers.scan.worker_cli` from the repository with one UTF-8 JSON
request on stdin. Responses contain `protocolVersion: "1"` and `result`. Exit
codes: 0 success, 2 blocked, 3 unsupported. Requests are limited to 16 KiB. The
calling host must impose a timeout and support cancellation.

Inventory request fields: `protocolVersion`, `action: "inventory"`, and an
absolute `source` ZIP path. Capture adds `action: "capture"`, an absolute new
`destination`, `expectedArchiveSha256` from inventory, and `selection` with exact
`root`, `jobMember`, `jobRole`, `masterMember`, `masterRole` fields. Roles are
`main`, `temp`, or `backup`. Both master fields may be null, but dependent
analysis remains on hold. Selection never follows modification times.

For a wholly fictional example, use `action: "make-example"` with a new absolute
`.zip` destination outside the checkout. The authored XML is deliberately not a
native machine schema. Every destination's parent must already exist.

Capture rechecks the source hash, copies original ZIP bytes, validates the copied
inventory, and streams every member to verify CRC and actual decompression size.
Only selected opaque bytes are staged under fixed filenames; archive member names
never become filesystem extraction paths. The manifest records member hashes,
selected roles, all discovered roots, source hash and limits. Original archive
bytes and selected job/master bytes accompany the manifest.

Publication uses a same-volume hard link to a closed, flushed package. Existing
destinations and racing publication fail without overwriting. Filesystems without
this operation return a hold; there is no partial-copy fallback. Temporary data
is cleaned from the newly allocated staging directory. Packages are immutable
through this API, not protected by OS access controls. There is not yet a separate
package verifier or native schema reader.

Limits: 100 MB archive, 10,000 entries, 250 MB per decompressed member, 1 GB total,
250:1 declared compression ratio, 512-character member paths. The CLI does not
allow callers to raise them. Unknown fields and invalid requests are rejected.

Validation on Windows/Python 3.14: 38 unit tests including the A03 regression,
source mutation, malformed/unsafe archives, CRC failure in an unselected asset,
decompression limits, distinct main/temp/backup selection, deterministic packages,
interrupted writes, existing/racing destinations and real subprocess requests.
No machine import or hardware test is implied.
