# ChatGPT Remote Commander v0.9.14

Date: 2026-09-28

## Objective

Standards-hardening release after the v0.9.13 durable automation rollout. Preserve the proven event-driven/same-conversation architecture and fix the remaining MCP Tasks wire-level error-mapping gap without adding new orchestration layers.

## Previous accepted state

v0.9.13 is the live accepted baseline on Windows default, Windows `saeed-emad`, and Linux default at commit `f7aa867e28765d40772b953f31fbff93cbaa77fc`.

It provides:
- durable background operations with bounded ChatGPT stream interaction;
- MCP Tasks extension mapping when the client negotiates `io.modelcontextprotocol/tasks`;
- private SQLite same-conversation continuation with stable event-key deduplication;
- workflow `NEEDS_CHAT` pause/evidence/Brain/handoff;
- short-lived hidden Windows MTA UI Automation delivery;
- No-Codex invariant: Commander never launches Codex or an API model.

## Evidence-first architecture audit

Primary references checked 2026-09-28:

1. MCP Tasks Extension SEP-2663 (Final):
   https://tasks.extensions.modelcontextprotocol.io/seps/2663-tasks-extension
2. MCP Tasks draft/specification:
   https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks
3. Microsoft Durable Functions external events:
   https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-external-events
4. AWS Step Functions callback/service integration patterns:
   https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html
5. Temporal Tasks:
   https://docs.temporal.io/tasks
6. Microsoft UI Automation threading guidance:
   https://learn.microsoft.com/windows/win32/winauto/uiauto-threading

The current architecture matches the established pattern: durable creation before acknowledgement, idempotent external-event keys, sparse callback/polling semantics, separate cancellation/status reads, fail-closed uncertainty, and MTA UIA isolation.

## Defect found

SEP-2663 requires `tasks/get` for an invalid/nonexistent task ID to return JSON-RPC `-32602 Invalid params`; `tasks/update` and `tasks/cancel` should do the same for a clearly unknown task.

v0.9.13 validated the task-id shape but allowed the underlying durable operation store's `operation not found` exception to escape into the generic server error path, producing `-32000`.

This was a protocol-compliance defect only. It did not duplicate effects, lose tasks, bypass No-Codex, or weaken durable operation state.

## Fix

- Add a narrow Tasks-to-operation adapter that maps only `operation not found` to protocol error `-32602 Task not found`.
- Apply it consistently to `tasks/get`, `tasks/update`, and `tasks/cancel`.
- Preserve every other operation error as-is.
- Add regression coverage for all three unknown-task methods.
- No change to task creation, cancellation semantics, operation fallback, continuation outbox, workflow state, or UIA delivery.

## Controls deliberately not added

- no extra workflow database;
- no browser extension;
- no high-frequency polling;
- no fixed expiry for same-conversation handoffs;
- no automatic retry after an uncertain send;
- no task notifications requirement when polling is already negotiated and sufficient;
- no Codex/Work/API model execution inside Commander.

## Acceptance gates

1. focused MCP Tasks regression;
2. full Windows `npm run check`, `npm test`, `npm run audit`;
3. exact-tree Linux check/test plus Ubuntu hosted audit;
4. hosted Windows/Ubuntu CI on the exact commit;
5. schema-continuity/update qualification;
6. candidate-first rollout to Windows default + `saeed-emad` + Linux default;
7. post-promotion verification of:
   - `automaticExecution=false`;
   - `runnerConfigured=false`;
   - `commanderMayLaunchCodex=false`;
   - conversation continuation state healthy;
   - no previous backend left routed.

FINAL remains UNPROVEN until these gates complete.
