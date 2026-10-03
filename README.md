# SCAN

**Smart Component Analysis Navigator**

A local-first engineering companion for automated optical inspection programming.

## Current status

Repository foundation. This is not yet an installed analyzer, machine-compatible job writer, or released AOI program. Capability descriptions below are development goals, not completed functionality.

## Intended workflow

Open a local job snapshot -> analyze source evidence -> inspect board overlays -> review a proposed correction -> export a debug queue or a separately named, supported repair candidate.

SCAN handles programming assistance and diagnosis. The companion release-control system retains validation and release authority; the inspection machine and SPC system retain their own operational responsibilities.

## Data boundary

This repository is public. Commit only newly authored application code, generic documentation, and wholly synthetic test fixtures. Never commit customer/employer CAD, Gerber, job archives, board images, library databases, production logs, detailed private test oracles, credentials, or local workspace data. A public repository is not permission to publish private inputs or another private project's source.

Original files remain immutable in approved private storage. Main, temporary, and backup snapshots must remain distinct. All proposed repairs are copy-only and require explicit review. Unknown schemas, ambiguous geometry, or unproved writer compatibility block export.

## Planned stack

A standalone React/TypeScript/Next.js frontend with a dark navy/slate and cyan design language, plus a bounded local Python analysis worker. Runtime versions and dependencies will be selected and pinned in the first runnable build. No cloud database, remote inference, or production-machine integration is required for core analysis.

See `AGENTS.md` and `docs/` on the development branch for the foundation and next implementation task. No third-party code or private repository history is being imported by this initialization.

No open-source license has been selected by the owner yet.
