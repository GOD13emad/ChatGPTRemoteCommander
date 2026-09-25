# Project engine qualification history

Date: 2026-09-23. Baseline: `2ad46c544907f6ca2c6c47ebf5d88b6a661e7047`.
Scope: development and release qualification history. Current publication and scoped rollout evidence is recorded in [v0.8.35](RELEASE_0.8.35.md); historical entries below retain their original dates, versions and limits.

## Historical candidate qualification — milestone 4A

From baseline `67d01533d1ddb7ea511c5410290b617752456659`, the adaptive planning/team increment passed `npm test`, `npm run check` and `npm run audit` on Windows with both Node 22.23.2 and 26.7.0. Core tests: **292 passed, 1 skipped, 0 failed**. Separate GUI contracts: **75/75 passed**. These are repeated version checks, not additional distinct test totals. The skipped leaf-symlink test requires a Windows privilege unavailable to this account.

Focused evidence includes 42 store extension cases, 20 team cases, 20 adaptive integration cases, five write-guard cases and existing verifier/path-safety checks. Real child-process exits exercise both sides of the plan commit; matching receipts recover once, missing/mismatched receipts block, and pause/criteria changes remain authoritative. Independent final review found no additional reproduced blocker in the scoped implementation.

`node examples/project-engine/adaptive.mjs` completed: two proposal workers plus one coordinator, one prerequisite insertion, three planning rounds, nine reserved/observed provider invocations, observed source read, real artifact write, independent verification and Brain finalization. This uses a deterministic fixture provider. A live model run of the new team/adaptive flow remains UNEXECUTED; the earlier live Codex single-step qualification below is historical evidence for the first increment.

Restricted-environment diagnosis and correction are recorded in E062 of the [historical engineering record](history/PROJECT_KNOWLEDGE_EVIDENCE_20260924.md). Full test commands used a process-local TEMP/TMP directory under the development workspace because the existing Windows runtime test could not clean a profile-short-name temporary path under current restrictions. No test assertion was skipped or weakened, and no global environment setting changed. New alias/hardlink/identity regressions pass after full-target canonicalization replaced unnecessary ancestor canonicalization.

Publication status: PR #5 now includes exact 4A commit 1f98f03. GitHub access and hosted execution are restored. Windows hosted CI passed; Ubuntu exposed a missing GdkPixbuf runner dependency. v0.8.32 provisions that dependency before the unchanged helper test. Final candidate CI, native, installer and deployment results are tracked in RELEASE_0.8.34.md.

## Historical results — first increment

| Gate | Result | Scope |
|---|---|---|
| `npm test` | PASS | 203 Node tests passed, 1 skipped; separate GUI contracts 75/75 passed; smoke, concurrency, filesystem safety, Linux/Windows contracts and source integrity passed |
| `npm run check` | PASS | Syntax, installer/onboarding, existing regression, platform contract and source integrity checks |
| Independent engine review | PASS | 16/16 focused regressions after review fixes; no remaining blocker identified within the reviewed scope |
| `npm run audit` | PASS | Repository secret/configuration audit; not a penetration test |
| Live Codex qualification | PASS | CLI 0.146.0 proposed one action; journaled execution wrote an isolated artifact; independent predicate/hash verification and Brain finalization completed |

Qualification ran on Windows with Node 26.7.0. An independent repeat of `npm test` and `npm run check` on the exact clean code commit `27827fb93575687a821874421953689e78d8fca1` also passed with official portable Node 22.23.2 / npm 10.9.8. Its archive SHA-256 matched the official release manifest: `1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97`. The repeated test result was again 203 passed / 1 skipped plus GUI contracts 75/75.

The skipped test requires Windows file-symlink privileges; junction and hardlink regressions passed. Linux contract checks are not a live Linux run of the new engine. Live GUI input, production deployment, long-duration unattended projects, Claude integration and comparative benchmarks remain UNEXECUTED.

Draft candidate: [PR #5](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/5). [Hosted CI run](https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/35783715237) was BLOCKED_BEFORE_EXECUTION: GitHub reported an account billing lock; both Windows and Ubuntu jobs ran zero steps. Local passes do not turn that CI result into a pass. This historical billing block was resolved before v0.8.32 qualification; current hosted CI is required separately and must pass on the release candidate.

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

The current engine consumes atomic workflow steps and can insert bounded prerequisites when adaptive planning is explicitly enabled. Proposal workers advise a single executing coordinator. It does not dispatch an isolated mutating worker fleet, impose monetary budgets, validate arbitrary scientific claims or provide an OS sandbox. Pause/cancel prevents new effects; it cannot undo an already dispatched external action. Configured command providers and explicitly allowlisted project commands retain the host user's OS privileges.

The first increment's next milestone was revision-safe plan extension and scoped proposal coordination; its 4A qualification is recorded above. Parallel mutating workers and monetary budgets remain planned. A release additionally needs exact-candidate Linux execution and existing cross-platform release gates. Superiority against other products remains UNPROVEN until a pinned, equal-model/equal-budget project benchmark is completed.

## Historical published qualification — v0.8.34

v0.8.34 / 86af9fe7e803bbba19fa2d3126d81389509bd176 passed exact Windows/Ubuntu CI, real-device source/native no-input qualification, both platforms' fresh and repeated pinned installers, candidate-first compatibility and official rollout. Both updaters subsequently reported CURRENT. Windows core: 302 PASS, 5 platform/privilege SKIP; GUI contracts: 75 PASS. See [release closeout](RELEASE_0.8.34.md) for publication, hashes, configuration preservation, retained workloads and remaining qualification limits. These final gates supersede earlier candidate release failures; their historical records remain below/above for provenance.


## Development candidate qualification — milestone 4B.2 bounded artifact workers

Date: 2026-09-25. Development baseline: \`a6bb67d4cca5e1b6a04d8690f1530e964925657a\`. Stable production remains immutable v0.8.35; no live service or release asset is changed by this candidate.

The candidate adds an opt-in \`runner.worker\` path in which a delegated worker can create one bounded UTF-8 text artifact only in private project-engine state. It receives no Commander project-effect tool catalog. A coordinator may import only exact receipt-bound bytes through the existing journaled write path; regular-file identity, single-link status, size, UTF-8, secret guard and SHA-256 are checked again before use and after import. The boundary is not an OS sandbox and does not make an untrusted provider executable safe.

Focused acceptance currently covers: successful private artifact → exact import → deterministic finalization; worker-workspace content tamper; hardlink alias after receipt; delegation without opt-in; durable provider-call budget exhaustion before worker start; cancel during worker planning; provider failure after durable reservation with no blind retry; crash after a committed journaled import with exact one-time adoption; tampered imported project bytes after crash with no replay; and Team+Worker maximum derived-budget clamping.

Windows local qualification on the candidate after these regressions:
- \`npm test\`: 334 total Node tests, 329 PASS, 5 platform/privilege SKIP, 0 FAIL.
- GUI contract: 75/75 PASS.
- \`npm run check\`: PASS.
- \`npm run audit\`: PASS.
- Focused engine/team/integration set after final edge-case correction: 74/74 PASS.

Open release gates at this record point: exact Linux execution of the same commit, independent diff review, hosted Windows/Ubuntu CI, PR merge and normal version/install/reproducibility/rollout gates. These results therefore establish a Windows-qualified development candidate, not a release.


## 2026-09-25 — 4B.2 artifact-worker recovery hardening

The bounded artifact-worker candidate was independently hardened after its initial local commit. Worker artifact reads now normalize missing/raced filesystem failures to bounded project error codes. A worker import persists the canonical `write_text` input hash before dispatch; normal closeout and crash recovery require that hash plus the workflow operation receipt/operation ID and the final target bytes to match the artifact SHA-256. A regression intentionally journals a different `write_text` call that produces the same target bytes and confirms recovery blocks with `PROJECT_WORKER_IMPORT_UNCONFIRMED` instead of adopting the effect. Focused integration after this change: 26/26 PASS.
