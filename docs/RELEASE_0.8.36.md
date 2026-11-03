# v0.8.36 qualification

Status: CANDIDATE, 2026-09-25.

This release packages milestone 4B.2: an opt-in bounded artifact-worker boundary for explicitly enrolled project runs. A coordinator may delegate one text artifact into private engine state; the worker receives no Commander project filesystem/shell/GUI/process/terminal/deletion/completion tool catalog. The coordinator may import only the exact artifact bytes through the normal journaled `write_text` path.

Worker artifacts are bounded, UTF-8, secret-guarded, regular single-link files with SHA-256 receipts. Import receipts bind the artifact digest to the workflow operation ID and canonical input hash. Crash recovery accepts only the exact journaled `write_text` operation and final target bytes; same-bytes/different-call, tamper, hardlink, missing/raced artifact, uncertain effect and provider failure cases fail closed without blind replay.

The worker boundary is application-level isolation, not an OS sandbox. A trusted external command provider still runs with the OS user's privileges. The feature is disabled unless `durableWorkflows.runner.worker.enabled=true`; existing recovery-only or runner configurations are not auto-enrolled.

| Gate | Status |
| --- | --- |
| Feature Windows full test/check/audit | PASS |
| Feature Linux exact-commit full test/check/audit | PASS |
| PR #11 Windows/Ubuntu hosted CI | PASS |
| Exact release Windows/Ubuntu CI | PENDING |
| Fresh/repeated installers on both platforms | PENDING |
| Candidate-first compatibility and no-input native checks | PENDING |
| Reproducible assets and downloaded hashes | PENDING |
| Public immutable release and discovered-profile deployment | PENDING |

Focused artifact-worker integration includes success/import/finalization, disabled mode, durable planner budgets, cancellation, hardlink/tamper/missing-file races, crash-after-import recovery, same-bytes/different-journal rejection and provider-failure no-replay.

Broader blocker escalation, monetary accounting, external notification delivery, unrestricted mutating worker fleets, Claude execution and comparative superiority remain outside this release.
