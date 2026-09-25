# Engineering decisions and evidence

Updated: 2026-09-25. Current immutable release authority is [v0.8.37](RELEASE_0.8.37.md), published as Latest and CURRENT on the audited Windows/Linux targets. This public index separates reusable engineering decisions from historical deployment observations.

## Current guarantees and their regression locations

| Decision / failure prevention | Evidence |
| --- | --- |
| Pause/cancel authority survives late receipts; ambiguous effects are not blindly replayed | `test/workflow-control.test.mjs`, `test/project-engine-review.test.mjs` |
| Persist attempts, observations and provider-call budgets before continuation | `test/project-engine.test.mjs`, `test/project-engine-integration.test.mjs` |
| Independent immutable checks and fresh artifact hashes determine completion | `test/project-verifier.test.mjs`, `test/project-engine-review.test.mjs` |
| Reject hardlinked and aliased mutation/evidence paths | `test/file-write-guard.test.mjs`, `test/project-engine-integration.test.mjs` |
| Adaptive prerequisites preserve scope and recover plan commits exactly once | `test/workflow-plan.test.mjs`, `test/project-adaptive.test.mjs` |
| Waiting questions yield to other projects; explicit responses cannot reset budgets or grant authority | [Project decisions](PROJECT_ENGINE_DECISIONS.md), `test/project-engine-review.test.mjs` |
| Bounded artifact workers cannot mutate project files directly; import is SHA-256/inputHash/operationId-bound, remains bound to the delegated step, and crash recovery never blindly replays | `test/project-engine-integration.test.mjs`, [v0.8.37 release](RELEASE_0.8.37.md) |
| Codex CLI provider diagnostics stay fail-closed across the qualified 0.146/0.156 formats; only the exact intentionally-disabled `code_mode_host` diagnostic is admitted | `test/project-planner.test.mjs`, [v0.8.37 release](RELEASE_0.8.37.md) |
| Custom no-start installers preserve live routing; updates retain active terminal workloads | `test/linux-installer-isolation.test.mjs`, `test/auto-update-contract.test.mjs` |
| Native and legacy plugin manifests retain matching identity/version, discoverable skills and public assets | `test/onboarding-plugin-check.mjs`, [PR #9](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/9) |

## Publication records

- [v0.8.37 qualification](RELEASE_0.8.37.md): Codex 0.156 compatibility, independently reviewed worker-invariant hardening, reproducible assets, pinned installer acceptance and scoped cross-platform rollout.
- [v0.8.36 qualification](RELEASE_0.8.36.md): bounded artifact-worker release baseline and its release/deployment gates.
- [v0.8.35 qualification](RELEASE_0.8.35.md): Windows/Linux release and scoped deployment gates, exact runtime identity and remaining limits.
- [Project-engine qualification history](PROJECT_ENGINE_VALIDATION.md): historical candidate results and permanent failure regressions.
- [Historical E001–E062 records](history/PROJECT_KNOWLEDGE_EVIDENCE_20260924.md): dated decisions, failures, corrections and original test scopes. These records are retained as history, not evidence of today's machine/account state.

## Repository maintenance decision

The post-v0.8.35 review found several old checkpoints still labeled current and a long public handoff mixed with private deployment details. Current release/roadmap links now lead from a short public state page; historical engineering records have a separate location and explicit scope. Personal host/profile examples were generalized and private paths/process snapshots omitted from those public archives. Exact originals were backed up locally before cleanup; Git history and immutable releases were not rewritten.

Repository cleanup preserves compatibility entry points and the duplicate icon/logo assets required by the standalone plugin package. Generated workspaces, output folders and Python caches are excluded from future commits. Link/inventory checks, onboarding, source integrity and security audit qualify this documentation change; they do not imply a new runtime release or new model/GUI qualification.
