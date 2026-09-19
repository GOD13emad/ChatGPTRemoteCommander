# Append-only History

## 2026-09-19 — v0.7.3 baseline

- Published/live baseline confirmed at `70e297194614b7cfd35825ba4cd9609d41e06a0c`.
- Emad hosts default and isolated `saeed-emad`; Saeed hosts default.
- Full Power, full filesystem, GUI, and durable workflows were enabled locally; permanent delete remained off.

## 2026-09-19 — v0.8.0 revision opened

- Added stable router, canonical backend identity, generation-CAS pointer control, drain evidence, side-by-side release records, and Windows supervisor/control-plane scripts.
- Added fail-closed runtime-marker creation, uncertain-effect routing semantics, per-profile candidate gates, ownership-only stop/delete, and exact release manifests.
- Added a release-asset builder with exact commit pinning, closed asset set, plugin ZIP verification, SHA-256 manifest, and release authority record.
- Explicitly retained the limitation that stateful terminal zero downtime is not implemented.
- Live canary, real tunnel E2E, old-install retirement, both-PC convergence, and final release promotion remain evidence-gated.

## 2026-09-19 — pre-release failure/prevention delta

- `DRAIN-ADMISSION-R1`: a mutating call now increments `activeMutations` before the asynchronous drain snapshot. The controller also requires `activeCalls=0`; a source-order regression and live drain tests prevent an admission/fence linearization gap.
- `GUI-E2E-R1`: the first native gate selected the PATH-visible .NET 8 SDK although a user-local .NET 10 SDK existed; after selecting .NET 10, the GUI app could not write readiness because a clean release tree has no runtime `var` directory. The runner now discovers an actual .NET 10 SDK (including the user-local install), uses an OS temporary scratch directory, reports early child exit, and always cleans its owned app/scratch state. A corrected run passed Unicode input, screenshot change, cursor restore, and focus restore. A later contended-desktop run first reported an interaction success with failed focus restoration and exposed a false-PASS in the harness; acceptance now requires both interaction and focus cleanup, and the next foreground-contention run failed closed with `GUI_FOREGROUND_CHANGED`. Exact tagged-candidate native evidence remains a live target gate, not a source-only PASS.
- These failures occurred only in the isolated development worktree before production mutation. The v0.7.3 production Baseline was unchanged.
