# SCAN

**Smart Component Analysis Navigator**

A local-first engineering companion for automated optical inspection programming.

## Current status

Locally runnable UI foundation with pinned dependencies and repeatable browser
acceptance. See [local setup and limits](docs/ui-foundation.md). This is not an
installed analyzer, machine-compatible job writer, or released AOI program.
Capability descriptions below are development goals, not completed functionality.

A connected dashboard at `/` shares a working
[placement intake](docs/placement-intake.md) at `/intake`, source findings at
`/findings`, and placement coordinate review at `/workspace`.
It reads local XLSX/CSV, supports combined or separate XY columns, validates
explicit units/rotation/identity, and downloads a normalized placement JSON.
This is not a native machine job. Install the pinned Python worker dependencies
in `.venv` as described in that guide before starting the app.
File, mapping, results, notes and exact source-row selection survive navigation.
Use **Save review** before refresh or close, then **Open saved review** to restore
the embedded placement source and reparse it locally. No browser storage is used.
Source findings link to exact rows; `/handoff` exports all findings, parsed
placements and remaining work, including blocked reviews. See the
[connected demo workflow](docs/demo-workflow.md).

The UI and CLI provide [snapshot preflight](docs/snapshot-preflight.md): independent
capture-hash and full asset verification, safe XML envelope inspection and an
explicit report of unsupported native checks. It produces no machine candidate.
In Source intake, select an existing job ZIP, inventory it, explicitly select
the job/master snapshots and capture/verify them. Save the source snapshot and
preflight report separately from the placement review.

A [synthetic walkthrough](docs/synthetic-demo.md) is available at `/demo`.
It demonstrates exact placement selection and simulated review decisions with
fictional data; it does not analyze files or produce machine jobs.
Presenter notes, restart controls and downloadable synthetic review records are
included. On Windows, run `.\scripts\start-demo.ps1` from this checkout to check
prerequisites, build current source and start the local presentation.

## Intended workflow

CAD/placement + Gerber, with an existing native job or supported starter when
required -> independent source and native diagnostics -> reviewed corrections ->
a complete native ATHENA/Eagle engineering candidate package, reports and a
machine-side work queue. This supports both new preparation and existing-job
recovery. See the [product requirements and bundle contract](docs/product-requirements.md).
The current importers and demo are milestones toward that output, not substitutes.

SCAN handles programming assistance and diagnosis. The companion release-control system retains validation and release authority; the inspection machine and SPC system retain their own operational responsibilities.

## Data boundary

This repository is public. Commit only newly authored application code, generic documentation, and wholly synthetic test fixtures. Never commit customer/employer CAD, Gerber, job archives, board images, library databases, production logs, detailed private test oracles, credentials, or local workspace data. A public repository is not permission to publish private inputs or another private project's source.

Original files remain immutable in approved private storage. Main, temporary, and backup snapshots must remain distinct. All proposed repairs are copy-only and require explicit review. Unknown schemas, ambiguous geometry, or unproved writer compatibility block export.

## Planned stack

A standalone React/TypeScript/Next.js frontend with Tailwind, shadcn/Base UI and
lucide, using a dark navy/slate and cyan design language, plus a bounded local
Python ZIP inventory worker. Actual versions are pinned in package.json and
package-lock.json. No cloud database, remote inference, or production-machine
integration is required for core analysis.

See `AGENTS.md` and `docs/` on the development branch for the foundation and next implementation task. No third-party code or private repository history is being imported by this initialization.

No open-source license has been selected by the owner yet.
