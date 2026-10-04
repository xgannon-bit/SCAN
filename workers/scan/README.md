# Local analysis worker

Implemented: bounded ZIP inventory (A03), explicit snapshot capture (A04), and a
single-request JSON CLI. Run `py -3 -m workers.scan.worker_cli` from the checkout.
See [snapshot capture](../../docs/snapshot-capture.md) for the request contract.

A07 CSV/XLSX intake is implemented in `placement_intake.py` and exposed through
`placement_cli.py` and `/intake`. Use the pinned `.venv` interpreter and see
[placement intake](../../docs/placement-intake.md) for setup, limits and tests.

Future modules: versioned read adapters, coordinate frames, structural/geometry
rules, evidence and gated copy-only exporters. The worker has no network listener
and never executes file contents. Original bytes remain unchanged. The host must
enforce subprocess cancellation and a wall-clock timeout.
