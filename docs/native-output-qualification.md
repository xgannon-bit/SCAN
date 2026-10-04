# Native output qualification

This increment advances the existing-job path. It does not generate a native
candidate, qualify an Eagle software version or implement the complete engineering
bundle. Native export stays disabled.

## Read native records

After archive capture and full byte verification, the reader recognizes observed
`JobContainer` field paths with one literal `JobXmlVersion` claim of `10.2`.
The format claim is not the installed Eagle software version. This is an observed,
read-only profile, not a qualified vendor schema.

The profile inventories module, part, window and CAD records. It retains selected
identity, relationship and geometry fields as exact source strings, including
repeated scalar values. It does not assign coordinate units, map side codes,
resolve model relationships, infer pad ownership, count programmed components,
or rewrite XML. Uninterpreted fields remain in the verified source snapshot.

Source paths distinguish record ordinals within each collection. Repeated known
collection containers are blocked rather than given ambiguous paths. Namespaced
or unsupported versions are unsupported. Native-record failures enter actionable
holds without losing the independent archive integrity report.

Limits: 16 MB XML, 250,000 nodes, depth 128, 10,000 records, 2,048 characters per
scalar, two million collected text characters, and 2 MB ASCII-escaped serialized
record output per selected document. These supplement envelope and worker limits.
No partial record inventory is called complete after a limit failure.

## Compare original and returned archives

1. Capture and verify the original archive in Source intake with explicit job
   and master roles. Review the native record inventory there.
2. Through an authorized workflow, open a separate copy in the intended Eagle
   version, save and reopen it, then archive the resulting copy.
3. In Review handoff, record the intended software version and independently
   capture/verify the returned ZIP with corresponding explicit selections.
4. Inspect added, removed and changed files. Download qualification JSON/TXT;
   the ordinary handoff downloads include the comparison too.

Comparison covers every archived file payload and explicit directory entry,
including unselected snapshots and opaque assets. ZIP byte equality is distinct
from file-payload equality: repacking can change ZIP bytes without changing files.
Every file has before/after SHA-256 and size. The report retains both archive
hashes, capture hashes, snapshot identities and selected job/master hashes/roles.

Version text is user-supplied and unverified. Identical bytes do not prove that
Eagle ran, resolve dependencies or establish optical validation. No report flags,
format claims or success results enable writing. An unsupported or renamed
selection remains held; no automatic path correspondence is invented.

Changing the baseline file clears the returned archive. Selection changes
invalidate the active preflight and comparison. Archive and comparison state
remain in memory; save both source snapshots and reports before closing. The
placement-review save file does not contain either native archive.

## Recovery and bounded small assets

The intake can discover an exact folder-matching main XML, temporary XML,
`.xml.bak`, or `.bak` even when the main file is missing. It offers the surviving
roles separately; it never selects the newest snapshot or promotes a backup.
Older schema-v1 captures remain verifiable through their exact historical root
inventory derivation from verified bytes.

Compression-ratio policy uses `expanded bytes / max(compressed bytes, 4096)`.
The fixed 4 KiB input budget permits small repetitive assets through 1,024,000
expanded bytes at the default ratio 250. This effective policy ratio is not the
raw compression ratio. Per-member and aggregate expanded-byte caps, bounded
CRC-checked streaming, entry limits, concurrency and timeouts remain in force.

## Remaining native-output gate

Required before a usable writer: exact Eagle application build; approved native
field and relationship semantics; dependency resolution; confirmed source/frame
correspondence; reviewed changes; copy-only serialization and preservation tests;
and exact candidate load/save/reopen compatibility evidence. The separate A09
Gerber branch is still held under the original session instruction.

Public fixtures are independently authored record examples, not vendor-created
native jobs. Private acceptance material and detailed reports stay outside the
repository, screenshots and hosted model context. Only explicitly authorized
redacted field names and format identifiers informed this profile.
