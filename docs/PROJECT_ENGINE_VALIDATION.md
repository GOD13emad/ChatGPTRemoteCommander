# Project engine candidate qualification

Date: 2026-09-23. Baseline: `2ad46c544907f6ca2c6c47ebf5d88b6a661e7047`.
Scope: unreleased `codex/project-execution-engine` development increment. This record does not supersede the v0.8.31 production acceptance record.

## Results

| Gate | Result | Scope |
|---|---|---|
| `npm test` | PASS | 203 Node tests passed, 1 skipped; separate GUI contracts 75/75 passed; smoke, concurrency, filesystem safety, Linux/Windows contracts and source integrity passed |
| `npm run check` | PASS | Syntax, installer/onboarding, existing regression, platform contract and source integrity checks |
| Independent engine review | PASS | 16/16 focused regressions after review fixes; no remaining blocker identified within the reviewed scope |
| `npm run audit` | PASS | Repository secret/configuration audit; not a penetration test |
| Live Codex qualification | PASS | CLI 0.146.0 proposed one action; journaled execution wrote an isolated artifact; independent predicate/hash verification and Brain finalization completed |

Qualification ran on Windows with Node 26.7.0. The skipped test requires Windows file-symlink privileges; junction and hardlink regressions passed. Linux contract checks are not a live Linux run of the new engine. Live GUI input, production deployment, long-duration unattended projects, Claude integration and comparative benchmarks remain UNEXECUTED.

Reproduce the isolated live provider check with `node examples/project-engine/run.mjs --codex`, using existing operator authentication. Its test artifact hash was `c18e2d1a4af992e00e6db1885f0e651c686ac3a3cb9ac4b047e4a1ab98b42813`; the run returned `PROJECT_ACCEPTANCE_VERIFIED`, `COMPLETED`, `artifactVerified=true` and `brainCreated=true`. This small qualification establishes a working integration, not general project competence.

## Failures found and permanent regressions

| Failure/root cause | Correction | Regression evidence |
|---|---|---|
| Scheduler enablement conflated with user pause; late receipts could override control | Persistent control intent/generation, admission gates, retained leases for outstanding effects | `workflow-control.test.mjs` |
| Optional tool description produced undefined in canonical JSON | Normalize missing description before planning | `project-engine.test.mjs` |
| Durable read receipt survived a crash but observation reference did not | Persist typed reference before dispatch; restore only successfully recorded steps | Real child-process crash in `project-engine-review.test.mjs` |
| Externally attested completion could bypass enrolled acceptance checks | Re-verify immutable predicates and compare final evidence | `project-engine-review.test.mjs` |
| Paused first run starved eligible runs; status/annotations overstated or understated execution | Skip paused runs in queue selection; derive status and scheduler annotations from effective configuration | `project-engine-review.test.mjs` |
| Configured unavailable provider or exact-model mismatch admitted unusable work | Reject unsupported provider and incompatible execution profile before enrollment | `project-engine-review.test.mjs` |
| Hardlinked write target changed an outside file | Shared pre-mutation regular-file, alias and identity guard | Six standard/full append/overwrite cases in `project-engine-integration.test.mjs` |

Additional tests cover immutable checks, bounded output/time, persisted attempt budgets, cancellation during an effect, revision races, cross-process claims, uncertain-effect non-replay, path escapes, nested Windows evidence paths and unchanged disabled-mode catalog behavior.

## Limits and next acceptance gate

The current engine consumes predeclared atomic workflow steps. It does not autonomously revise a plan, dispatch a parallel worker fleet, impose monetary budgets, validate arbitrary scientific claims or provide an OS sandbox. Pause/cancel prevents new effects; it cannot undo an already dispatched external action. Configured command providers and explicitly allowlisted project commands retain the host user's OS privileges.

Next milestone: revision-safe plan extension and scoped worker coordination, with adversarial recovery tests before expanding unattended execution. A release additionally needs exact-candidate Linux execution and existing cross-platform release gates. Superiority against other products remains UNPROVEN until a pinned, equal-model/equal-budget project benchmark is completed.
