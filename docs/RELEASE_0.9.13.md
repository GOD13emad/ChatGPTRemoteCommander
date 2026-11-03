# ChatGPT Remote Commander v0.9.13

Date: 2026-09-28

## Objective

Make long/unknown-duration Commander work survive ChatGPT stream/client interruptions and return to the same conversation without converting execution into Codex/Work/API usage.

## Previous accepted state

v0.9.12 is the accepted live baseline. It enforces the ChatGPT-first / No-Codex invariant, preserves the legacy Project Engine tool schema while the model runner is disabled, and is live on Windows default, Windows `saeed-emad`, and Linux default.

## Current delta

### 1. MCP Tasks mapping for durable operations

When a modern MCP client negotiates `io.modelcontextprotocol/tasks`, `operation_start` may return a standard task handle. The client can recover after stream/client restart with `tasks/get`; task cancellation maps to the existing durable Commander operation cancellation path. Clients without Tasks retain the existing `operationId` fallback.

A bounded `operation_status.waitMs` follow window (maximum 5 seconds) is available when completion is expected imminently. It waits for filesystem state changes and returns early on terminal state; it is not the primary orchestration loop.

### 2. Native same-conversation continuation

A project can be explicitly bound to one already-open ChatGPT browser tab. Long operations and durable workflows can attach a stable event key. Terminal/NEEDS_CHAT events are written to a private SQLite outbox and delivered idempotently to that same conversation.

Windows delivery uses short-lived hidden PowerShell 7 UI Automation in MTA mode. It does not open a ChatGPT URL, create a new tab, use clipboard/mouse takeover, read cookies/passwords/session tokens, or launch Codex. Linux preserves durable queue state and waits for a Windows UIA chat host.

### 3. Failure handling

- duplicate event keys with identical payloads are idempotent;
- conflicting event reuse fails closed;
- known pre-send conditions defer with bounded backoff;
- post-invoke ambiguity becomes `UNCERTAIN` and is never blindly retried;
- restart recovery reconciles durable operation receipts/outbox state without replaying the machine effect;
- project-provided summary/reason/evidence strings are untrusted status hints inside a fixed Commander-owned envelope;
- UIA exact-targeting requires one bound tab, one composer, one send action, an idle user, and a non-busy chat.

### 4. No-Codex invariant remains locked

Commander still never launches Codex, Work, or an API model. If ChatGPT recommends Work/Codex, explicit current-chat user choice is required and the handoff occurs outside Commander.

## Benchmark basis

The architecture follows established durable-orchestration patterns rather than a custom polling loop:

- Microsoft Durable Task / Durable Functions: checkpointed long-running orchestration, external-event wake-up, at-least-once delivery and deduplication.
- AWS Step Functions: callback/wait patterns for long external work.
- Temporal: idempotent activity/task execution under retries.
- Microsoft UI Automation: desktop-wide clients on a separate MTA thread and semantic control patterns (SelectionItem, Value, Invoke).

See `docs/CONVERSATION_CONTINUATION_R1.md` and `docs/PROJECT_KNOWLEDGE_EVIDENCE.md`.

## Validation state

Already PASS on the integrated candidate:
- MCP Tasks focused contract;
- same-conversation focused suite;
- async/workflow regressions on the feature candidate.

Release gates before promotion:
1. full Windows `check/test/audit` on the exact commit;
2. exact-tree Linux `check/test/audit`;
3. hosted Windows/Ubuntu CI;
4. schema-continuity/update qualification;
5. candidate-first rollout and post-promotion canaries.

FINAL is UNPROVEN until those gates complete.
