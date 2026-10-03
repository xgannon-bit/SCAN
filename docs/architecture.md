# Standalone architecture

Status: foundation specification; no analyzer or runtime has shipped from this scaffold.

## Repository layout

- app/: Next.js pages, layout and loopback-only server endpoints.
- components/: shared UI primitives and SCAN shell, findings and viewer components.
- styles/: semantic theme tokens, independent of business logic.
- lib/: TypeScript contracts, validation and bounded worker orchestration.
- workers/scan/: deterministic Python intake, format adapters, diagnostics and later gated exporters.
- schemas/: versioned interprocess and handoff contracts.
- tests/synthetic/: generated fictional inputs with explicit provenance.
- scripts/: local setup, start, stop and integrity checks when implemented.
- docs/: architecture, capability limits, UI specification and development handoff.

Directory README files declare boundaries; they are not working services. Add modules only as their implementation task needs them. A single frontend plus a worker does not require a monorepo, microservices, cloud database or Docker.

## Data flow

User-selected local input -> bounded inventory -> explicit snapshot selection -> immutable hashed capture -> version-specific readers -> neutral model -> evidence findings -> visual review -> approved proposals -> gated candidate/debug export.

Node invokes the Python worker through a bounded subprocess with structured JSON and no shell interpolation. The worker has no network listener. The frontend targets 127.0.0.1 on configurable port 3210. Actual runtime and dependency versions must be verified and pinned in the first runnable build.

## Storage outside Git

An approved per-user local workspace contains originals/, snapshots/, sessions/, candidates/, reports/ and logs/. Never use an active machine job directory or a cloud-synced development repository as runtime storage. No source gets opened for write. Completed outputs publish atomically; partial results never masquerade as complete.

## Boundaries

The companion release-control application remains separate. Exchange a versioned ProgrammingSessionRecord with source hashes, evidence, candidate identity, holds and verification results. No shared mutable release database and no automatic release. Theme parity does not require copying private source, fixtures or database records.

## Write safety

Writer compatibility is per adapter and software/schema version. Unsupported data, stale hashes, ambiguous pad ownership, conflicting identities, or untested serialization block writes. Diagnostics and debug-report export remain useful while machine-job export is disabled.
