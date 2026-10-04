# SCAN contributor instructions

## Read first
Read README.md, docs/architecture.md, docs/data-policy.md, docs/capabilities.md and docs/first-build.md. Work in this repository, not in the companion release-control repository. Check current branch, HEAD, owner changes and workflow triggers before editing. Never reset, clean, auto-stash, merge or force-push someone else's work.

## Confidentiality
This repository is public. Use wholly synthetic fixtures. Do not copy private job XML, manufacturer/customer mappings, board images, geometry, archives, database contents, detailed private oracles, credentials, or private application source into this repository or hosted logs. Do not read local .env values into output. Ignore rules are a guardrail, not permission or a complete data-loss prevention system.

## Product authority
SCAN analyzes and prepares engineering candidates. It cannot grant product release. The inspection machine owns acquisition/teaching; the companion release-control system owns approval; SPC owns production history. Do not claim representation, enabled inspection, taught inspection, verification and release are equivalent.

## Engineering invariants
Preserve original input bytes and hashes. Keep main, temporary and backup snapshots distinct; no newest-file heuristic. Separate board side, module, reference designator, placement ID and master-model identity. Separate native, CAD, Gerber, model, local ROI and image coordinate frames. Preserve unknown fields and legitimate off-center origins. Never infer pad ownership from nearest distance alone.

Every repair is an explicitly reviewed, version-supported, copy-only proposal. Require exact before values, fresh source hashes, unambiguous geometry, no-op/idempotence tests, protected-field checks, rollback and required machine compatibility evidence. Unsupported schemas and ambiguous origins/pads block writing. Never relax limits, guess identity, enable all, globally rematch or change calibration to get a passing result.

## Delivery
Keep implementation increments narrow and tested. Record exact source revision, actual commands/platform/results and unperformed checks. Synthetic tests are not a private-case run; XML export is not a machine load; a machine load is not defect-detection validation. No hosted CI, network service exposure, dependency installation, billing change or machine operation without appropriate authorization. Do not install a local model.

## Project knowledge in Google Drive
Use the owner's `10_SCAN` Google Drive folder as the shared project knowledge repository. Read `START HERE — SCAN`, the current Gerber-First AOI Workflow and Implementation Plan, and the latest Hourly Development Queue & Handoff before substantive development. Reconcile planning status against the actual Git branch, revision and local evidence; historical planning notes are not proof that implementation is missing.

After a meaningful milestone, update the existing canonical handoff with the branch and exact commit, implemented behavior, actual test results, unresolved limits and next work. Preserve earlier evidence and owner notes; use revision-protected writes and verify the readback. Keep GitHub for code and synthetic fixtures, and keep manufacturing inputs and detailed private evidence outside this public repository. If Drive is unavailable, report the documentation gap and retain a local handoff for later synchronization.
