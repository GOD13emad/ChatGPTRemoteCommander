# MMZ Linux — two-step authorized read-only native Workflow E2E (2026-10-14)

**Status: PASS for two-step isolated native execution and re-observation; stable release NOT ACCEPTED.**

## State/authority and single mutation objective

- Baseline: Draft PR #204 at exact commit `a39fda5c35109c1fbfdb9edc0b29ad2e86b3c0ef`, tree `836a266673e9eba6cfec46345a1b19a77c5fa130`. The four corresponding GitHub workflows CI (Windows+Ubuntu), Release Sync, Windows updater NoPromote, Server Install Canary all completed SUCCESS. Local clone clean at this baseline.
- Installed Commander stable `0.10.20`, 11 valid Agent Extensions, production runnerConfigured=false and automaticExecution=false. Qwen3-4B-Q4_K_M GPU runtime in the user-local `rc-local-qwen3.service`, on-demand only, no system-wide changes.
- **One objective:** qualify an authorized *two-step dependent* read-only Workflow using a real local model, actual Commander Planner and Workflow Engine, two host-verified `read_text` dispatches, persisted transition and independent evidence verification, without permissions for mutations or shell actions.

## Exact test, controls, and result

- Source: `examples/provider-adapter/qualify-linux-multistep-read.mjs`, SHA-256 `fba2cd4df927b3e14a1233eeb910358bff4f860ab2b1c9bbacbbb940f5dccd28`.
- Exact Linux `--live` opt-in is mandatory; omitted flag → exit 2 `EXPLICIT_LINUX_LIVE_FLAG_REQUIRED`, syntax `node --check` PASS.
- Unique scoped temporary root `/tmp/rc-mmz-tworead-*`; two synthetic files `requirements.txt` and `evidence.txt`, both 0600 and pre-created solely for this acceptance test. Contents contain no owner project or secret data. Scoped runner `autoTick=false`, `maxActions=2`, `maxPlannerCalls=2`, deadline 120 seconds. The only host tool is `read_text`; dispatcher rejects every other tool/path and incorrect step order. No direct user or source filesystem write permitted to model.
- Workflow steps: first inspect `requirements.txt`, second inspect `evidence.txt` with `dependsOn=['requirements']`. Two independent file_sha256 checks require original file hashes. Dispatch validates full `read_text` text, whole-file SHA, `truncated=false`, exact path and order; post-test directly checks that both files are unchanged. Durable steps and run status read back.
- Live success result: `NATIVE_TWO_STEP_READ_E2E_PASS`, exact ticks `QUEUED/PROJECT_STEP_RECORDED`, `QUEUED/PROJECT_STEP_RECORDED`, `COMPLETED/PROJECT_ACCEPTANCE_VERIFIED`. Durable run and workflow lifecycle both COMPLETED, both steps verified. Exactly **2 actual authorized tool effects**, exactly **2 planner calls**, and **1** deterministic internal re-observation of the first read before the second plan. The observation was included in second planner context with exact expected text and SHA. Elapsed 3598 ms. No model-generated writes or commands.
- Synthetic hashes: `requirements.txt` SHA `06f6b1313b9fa1187f9a7ffdf6f6c6dbd9831d16c873a75616ac04c76972150d`; `evidence.txt` SHA `e0a038f1d1f9cf0a50a457a9879fbafb56d1e778b5bfa6b937d976b95b5d151e`.
- Private successful execution log `/tmp/rc_mmz_multi_read_e2e_fixed_20261014.log`, SHA-256 `be1367cee425fe46b5f50b818d92886a8fc228e1510d17724e11c8f246cbbe89`, EXTERNAL to Git. No credentials logged.

## Failure, root cause, and prevention

- Initial test attempt returned BLOCKED/PROJECT_EXECUTION_FAILED after the first recorded successful read. The harness counted an *automatic re-observation* of the first already-verified read (performed by the Workflow Engine before the next plan) as a second model-requested tool action, and rejected it as out-of-order. This was a **test-harness accounting defect**, not evidence of an unauthorized model action.
- The initial failing log SHA-256 `c056946e780f28005724fa683f061303a904987c88f37337d976a1fad16591eb`, path `/tmp/rc_mmz_multi_read_e2e_20261014.log`; retain as FAIL history, never overwrite.
- Narrow correction: instrument the Planner's call-boundary to distinguish `read_text` re-observation before the second planner invocation from the two actual effect dispatches; independently confirm the replayed data and that the second planner context receives it. Keep exact tool/path ordering and all existing independent hashes/acceptance checks. Corrected guarded rerun PASS. **Guard:** two actual effects, one replay, two plans, every observation correct, two persisted verified steps.
- This distinction matters for crash-safe/read-only context resumption; deleting re-observation to make a naive action counter pass would weaken verification. No Core source code was changed.

## Postcondition, limitations, and exact next action

- Qwen3 unit was stopped *after* checking exact owned MainPID and executable. Final `ActiveState=inactive`, `SubState=dead`, `MainPID=0`, `UnitFileState=static`, port 18080 closed, GPU at 41MiB used (~5732MiB free), temporary roots deleted. Installed Commander and browser profiles unchanged.
- Verified outcome: model can sequentially call exactly two authorized `read_text` tools in isolated two-step workflow with independent receipt checks and state completion. **Not proven:** scientific reasoning, unbounded autonomy, multiple real-project tool operations, write/shell tool safety, automatic scheduler, or stable production release. Previous MMLU 64-item benchmark is a separate knowledge test, not interchangeable with operational E2E V&V.
- Source-level `check/test/audit` and exact GitHub hosted CI for **this new source file** are still open at creation of this evidence record. They must pass before calling source gate accepted. Only then review PR #204 for an explicit release decision. Keep PR Draft; no autoTick, stable Core change or model promotion.
- Reuse: Project Brain/Knowledge, failure prevention, Linux user guide, release gate evidence, scientific method (verification vs validation). Brain state CURRENT when propagated; overall project PARTIAL_NOT_FINAL.

## Post-change source qualification closeout

The exact local source after the single harness correction passed `npm run check`, `npm test` and `npm run audit` (`SECURITY_AUDIT_PASS`). Full log external at `/tmp/rc_mmz_multistep_source_20261014.log`, SHA-256 `87542e43b9c865c879d41130e3530c4397817c078f2823a277dec881d0c8a540`. This local source qualification is evidence for this tree only; hosted CI for the subsequent new commit is a separate, currently OPEN gate.
