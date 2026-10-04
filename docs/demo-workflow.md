# Connected source review demo

This increment connects source review and immutable archive preflight inside the
existing dashboard. It is not the complete native engineering candidate package
defined in product-requirements.md. No native XML, source file or machine state is
modified. Gerber registration, native semantics, dependency binding, reviewed
repairs, a qualified native writer and Eagle compatibility remain unfinished.

The subsequent [native-output increment](native-output-qualification.md) adds
observed native record inventory and original/returned archive comparison within
the same workflow. It still produces no native candidate.

## Presentation path

1. From Job dashboard, open Source intake and select a local XLSX/CSV. Read the
   preview, confirm worksheet and columns, module/side, units and rotation, then
   validate. Confirmed coordinates stay in their CAD source frame.
2. Open Source findings. Filter by reference, row or reason; use the exact row
   link to inspect its module/side/reference and add an engineering note. Invalid
   rows without parsed placements link back to mapping instead of inventing one.
3. Save review. Refresh, then Open saved review: original embedded source bytes
   are checked against their hash and parsed again. A blocked review remains
   blocked. A saved draft with incorrect settings remains editable after restore.
4. Optionally select an existing native job ZIP in Source intake. Inventory it,
   select a root, exact main/temp/backup job and exact master (or explicitly omit
   the master). Capture and verify selection. XML well-formedness and source byte
   integrity do not establish a supported native schema or machine readiness.
5. Save source snapshot and archive report. Review handoff exports a readable TXT
   or full JSON with every parsed placement, issue, note, exact source/capture
   identity and remaining work. It never clears holds or creates JOB_COPY.

## Save and recovery

Placement `.scan-review.json` includes original source bytes, mapping, worksheet,
delimiter, prior validation intent, selected source row and notes. No derived
result is trusted on reopen. Limits: 8 MB embedded source, 14 MB serialized review,
1,000 notes of at most 2,000 characters each. Save rejects a serialized document
larger than the reopen limit. Hash mismatch, unsupported schema, unexpected fields
and capability-authorizing flags reject before replacing the active source.

Notes annotate the exact source row; they do not approve or correct its data.
Source/mapping/worksheet/delimiter changes clear notes to avoid stale attachment.
Opening a valid saved placement source clears the separate active archive so a
prior unrelated archive cannot silently enter the reopened handoff.

Archive state is separate and stays in memory until cleared or refreshed. Save
source snapshot recreates the selected capture from the same source ZIP, checks
its package hash against the prior verified receipt and streams the result. The
browser verifies receipt header and byte count without making several large hash
buffers. A `.scan-snapshot` preserves inputs; it is not an Eagle-importable job.
Browser reopening of `.scan-snapshot` is not implemented; retain its archive
report and use the CLI reader with the original receipt hash when needed.

## Runtime boundaries

### Windows desktop launch

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/desktop-scan.ps1 -Mode Install`
once from this checkout to install **Open SCAN** on the current user's desktop.
The existing **Open SCAN Demo** shortcut is refreshed to the same launcher.
Double-click either shortcut to build/start SCAN and open `http://127.0.0.1:3210/`.
Allow up to three minutes for a cold build. Reopening the shortcut reuses the
running server. An unrelated port owner is never stopped.

The server belongs to an on-demand Windows scheduled task for the signed-in
user, independent of Codex and terminal windows. It needs no administrator
privileges or stored password. It has no scheduled or sign-in trigger; after
restarting Windows or signing back in, use the shortcut again. Windows may
suspend SCAN while the laptop sleeps. The task allows battery operation, has no
execution time limit, and retries failures three times at one-minute intervals.
Startup logs are under `%LOCALAPPDATA%\SCAN\desktop-server`.

The shortcut starts the local application; it does not install dependencies or
host a public website. Save the current review before closing/refreshing the
browser. Saved reviews can be reopened from the dashboard. Server persistence
does not change the application's in-memory review storage.

Only same-origin loopback multipart requests are accepted. The browser cannot
specify filesystem paths, destinations or worker limits. The host uses fixed
opaque filenames in an owned OS temporary folder. Python is invoked directly
without a shell; TEMP/TMP/TMPDIR point into that owned folder for nested cleanup.
Private worker stderr and arbitrary exceptions are not logged.

Archive uploads are admitted before reading their body: at most one archive and
two total workers. Limits are 100 MB ZIP, 120-second upload/worker/download phases,
16 KiB control request and 24 MB worker output. Existing archive/capture/reader
structural limits remain unchanged; outer snapshots are limited to 620 MB.
Downloads retain their slot until completion/cancellation and temporary cleanup.
Normal and aborted operations clean owned paths after processes/file handles close,
with bounded Windows removal retries. A process/OS crash or persistent filesystem
failure can leave temporary files; this is not a crash-proof storage service.

Handoff exports include the complete parsed set and queue even when the UI shows
only 100 filtered findings. Native package completeness, offline preparation
coverage, machine compatibility, optical teaching and release remain unknown.
Placement-to-archive revision/population/coordinate correspondence is not inferred.

## Verification

Use `npm run check`, the Python unittest suite, and `npm run test:e2e`. Tests use
wholly authored files and in-memory ZIPs. They cover source-byte round trips,
tampered saved documents, large serialized notes, exact duplicate row identity,
real archive inventory/capture/preflight/download hashes, explicit roles, omitted
master, malformed XML, wrong hashes, stream cancellation, worker failure, early
upload admission, cross-origin/unknown field rejection and responsive navigation.
Actual command results and screenshots belong in the local delivery evidence,
not private job fixtures in this public checkout.
