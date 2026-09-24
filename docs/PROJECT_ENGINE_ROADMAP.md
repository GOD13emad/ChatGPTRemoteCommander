# Project execution engine roadmap

Date: 2026-09-24. Released version: v0.8.34.
Baseline: 2ad46c544907f6ca2c6c47ebf5d88b6a661e7047 (runtime code identical to v0.8.31).

## Objective
Develop Remote Commander into a measurable project execution and management system: plan bounded operations, execute through authorized tools, verify outputs, recover interrupted work, and finalize only against recorded acceptance criteria. Universal superiority is an ambition, not a current capability claim.

## Roadmap
1. BASELINE: source/runtime comparison and gap inventory — COMPLETE.
2. EXECUTION FOUNDATION: reliable pause/cancel, opt-in planner/executor/verifier loop, durable attempt budgets, evidence-bound completion — COMPLETE for the first increment.
3. QUALIFICATION: deterministic end-to-end regression, full existing suites, independent review, candidate handoff — COMPLETE for local qualification and the reviewable development candidate.
4. ADAPTIVE MANAGEMENT: 4A prerequisite insertion, bounded parallel proposal workers and durable provider-call budgets, plus 4B.1 durable input requests and explicit responses — RELEASED / Windows and Linux CURRENT. Remaining 4B general worker execution, broader escalation and monetary accounting remain PLANNED.
5. CONNECTOR PARITY: catalog drift diagnostics, qualified providers, browser/application integrations and transparent terminal reconnection — PLANNED.
6. COMPARATIVE EVALUATION: pinned real project corpus, equal models/budgets, completion/correctness/recovery/intervention/cost measurements — PLANNED.

CURRENT: milestone 4B.1 is released in immutable v0.8.35, PRs #7 and #8 are merged, and official updates on both Windows and Linux report CURRENT. [Durable input requests and explicit responses](PROJECT_ENGINE_DECISIONS.md) are qualified; a production runner still requires a configured provider and explicit project enrollment. Worker execution isolation, broader escalation and monetary accounting remain open. See [release gates](RELEASE_0.8.35.md) and [qualification evidence](PROJECT_ENGINE_VALIDATION.md). No percentage or superiority score is asserted. Historical entries below describe their observation time, not the current release status.

## First increment acceptance
- Opt-in execution actually calls a configured planner and dispatches schema-valid proposals through existing journaled workflow tools.
- Disabled configuration retains existing recovery-only behavior and does not enable autonomous execution through Full Power migration.
- Persist attempt reservation before invoking a provider; a restart cannot reset run budgets.
- Pause/cancel and stale revisions prevent new effects; late receipts do not reverse owner control.
- Every acceptance criterion has an independent deterministic check; planner statements cannot mark completion.
- Evidence hashes checked by the verifier match finalization evidence.
- Malformed output, blocked tools, uncertainty and exhausted budgets fail closed with inspectable status.
- Tests use isolated fixture projects, never production services, personal data or GUI input.

## Authority and boundaries
The user authorized implementation and subsequently explicit cross-platform release/deployment. Candidate qualification uses isolated workspaces before official updater promotion. Active workloads must remain intact. Planner executables are operator-configured trusted integrations, not code from workflow notes. File/shell privileges remain those of the existing host policy; this engine is not an OS sandbox.

## Decisions
The first increment uses one tool operation per predeclared workflow step, consistent with the existing journal. Dynamic plan expansion is a later milestone. Separate planner proposals from execution and deterministic verification. No agent can alter its acceptance checks during a run. New execution tools appear only when explicitly configured.

## History
- 2026-09-23: Milestone 4A passed full test/check/audit on Windows Node 22.23.2 and 26.7.0 (292 core PASS, 1 privilege SKIP, 75 GUI contracts PASS). Deterministic two-worker/coordinator demo completed with one extension and nine reserved/observed calls. Final independent review found no remaining blocker in scope. Remote publication is currently unavailable; no production rollout occurred.
- 2026-09-23: Continued milestone 4. Plan extensions insert prerequisites before an unexecuted target without revising scope/acceptance/history. Proposal workers may run in parallel; one coordinator and the existing executor retain mutation authority. Reserve all worker/coordinator calls before invocation and journal extension intent before changing the plan.
- 2026-09-23: Published draft PR #5. Exact clean code commit `27827fb` independently passed full Windows test/check under Node 22.23.2 as well as the original Node 26 qualification. Hosted Windows/Linux CI was blocked before any step by an account billing lock; runtime Linux/release qualification remains open.
- 2026-09-23: Full Windows regression passed (203 Node tests, 1 skipped; GUI contracts 75/75), repository security audit passed, and independent focused review passed 16/16 including the real crash-after-receipt regression. Preparing a reviewable development candidate; production/release qualification remains separate.
- 2026-09-23: A live Codex planner completed an isolated end-to-end artifact task through journaled write, independent predicate/hash check, and Brain finalization. No production service was changed.
- 2026-09-23: Independent review found and regressed observation loss across restart, paused-queue starvation, bypass via external manual completion, status/annotation drift and exact-model mismatch. All fixes passed the full local suite.
- 2026-09-23: An integration test reproduced a hardlinked write target changing an outside file. Shared pre-mutation alias/identity checks now cover standard/full write_text and write_file; six append/overwrite regressions pass.
- 2026-09-23: Recovered v0.8.31 comparison, verified origin/main unchanged and created isolated development worktree. Split implementation into control semantics, bounded planner adapter, deterministic verifier and durable runner/integration.
- 2026-09-23: Identified pause/cancel admission and late-receipt race; blocking prerequisite to unattended execution. Fix and regression are in progress.
