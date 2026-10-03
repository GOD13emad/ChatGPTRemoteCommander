# Remote Commander v0.10.7

Date: 2026-10-03

## Objective

Harden Windows host qualification under real workstation load without changing production runtime semantics.

## Root cause

On Emad-PC, official v0.10.6 source and runtime logic were healthy, but updater qualification could fail or stall when process-heavy fixtures ran inside the bulk Node test batch at concurrency 2.

Observed evidence:
- `test/browser-process.test.mjs` passed 7/7 when rerun alone after clearing one stale test-owned process tree.
- `test/mcp-tasks-extension.test.mjs` passed 1/1 alone on the same v0.10.6 candidate, taking about 18.3 seconds.
- The same MCP Tasks test produced a false-negative while embedded in the bulk concurrency=2 qualification batch.
- Hosted Windows/Ubuntu CI and the released v0.10.6 runtime had already passed, so this is a qualification-harness/load issue rather than a production-runtime defect.

## v0.10.7 change

- Run `test/mcp-tasks-extension.test.mjs` as its own isolated test-file command in both `check` and `test`.
- Add MCP Tasks to the sensitive qualification ordering with tunnel-log, async-operations and workflow-http.
- On Windows, the bounded qualification wrapper automatically prioritizes sensitive isolated fixtures before the bulk batch, including updater/install qualification paths that do not explicitly pass `--prioritize-sensitive`.
- Preserve all v0.10.6 runtime, stream-resume, operation lifecycle, browser, workflow, rollback and policy behavior unchanged.

## Acceptance

Before publication:
1. exact branch check/test/audit and qualification harness regressions pass;
2. hosted Windows and Ubuntu CI pass;
3. Windows Server and clean Linux install canaries pass;
4. Emad-PC updater completes candidate-first qualification and cutover;
5. tag/release readback is immutable and exact.

Rollback remains v0.10.6 until v0.10.7 rollout is verified.
