# v0.8.35 qualification

Status: CANDIDATE, 2026-09-24.

This release packages milestone 4B.1: durable missing-input questions and explicit bounded responses. Waiting runs preserve their questions across restart and yield to other enrolled projects. Exact response retries are idempotent; conflicting/stale answers, changed scope/policy, pause/cancel and exhausted budgets cannot grant continuation. Independent acceptance checks and original budgets remain binding.

The implementation was reviewed and merged in PR #7 after Windows/Ubuntu CI passed. This release candidate changes version metadata and public documentation; final pinned installer, candidate compatibility, asset and deployment gates remain required.

| Gate | Status |
| --- | --- |
| Exact release Windows/Ubuntu CI | PENDING |
| Fresh/repeated installers on both platforms | PENDING |
| Candidate-first compatibility and no-input native checks | PENDING |
| Reproducible assets and downloaded hashes | PENDING |
| Public immutable release and all discovered profile deployment checks | PENDING |

Existing configured runners retain their settings; this release does not install/authenticate a missing model provider or enroll existing projects automatically. Native GUI implementation is unchanged from v0.8.34. Current no-input checks qualify helper readiness; inherited Windows interactive evidence and unproven Linux interactive input/DPI/session coverage remain explicitly separate. No foreground desktop takeover is needed for these changes.

General executing workers, external notification delivery, monetary accounting, Claude execution and comparative superiority remain outside this release. Local operational evidence belongs in the private handoff; this public record contains only release-level evidence.
