# Chat-Safe Durable Completion Architecture R1

Status: design authority for the CSDC change-set. This document does not claim release readiness.

## Goal

Once Commander accepts a project/job, the lifetime of the active ChatGPT turn must no longer be a correctness dependency. A chat disconnect, context limit, model quota, tunnel deadline, UI restart or machine restart may delay delivery, but must not silently lose accepted work or authorize blind replay of effects.

## Required invariants

1. **Durable acceptance** — accepted work receives a stable request/job identity before long execution starts.
2. **At-most-once effects** — lost acknowledgement never authorizes automatic replay of a mutation.
3. **Durable completion** — terminal execution state and immutable result metadata are committed before user-visible delivery is attempted.
4. **Separate delivery** — result delivery can be retried independently of execution.
5. **Bounded chat payloads** — Chat gets compact metadata/summary; large output stays content-addressed and chunk-readable.
6. **Explicit uncertainty** — if an effect may have happened but no authoritative receipt exists, state becomes `UNCERTAIN`; reconcile before any new mutation.
7. **No silent terminal/wait state** — COMPLETED, BLOCKED, EXHAUSTED, WAITING_INPUT, PAUSED_QUOTA and UNCERTAIN all create discoverable delivery events.
8. **Profile isolation** — delivery state lives in Commander-private local state and is scoped to profile/config identity, never inside project roots.
9. **Correlation is routing, not authentication** — caller-supplied correlation IDs are opaque routing keys. They must not be described as authenticated ChatGPT conversation IDs unless the host proves such identity.
10. **Host-boundary honesty** — autonomous ChatGPT wake/push is not considered implemented until a supported host mechanism is runtime-proven.

## State model

Execution and delivery are separate state machines.

Execution:

```
ACCEPTED
  -> QUEUED
  -> RUNNING
  -> SUCCEEDED | FAILED | CANCELLED | TIMED_OUT | UNCERTAIN
```

Project/user-interaction states additionally include:

```
WAITING_INPUT | BLOCKED | EXHAUSTED | PAUSED_QUOTA
```

Delivery:

```
COMPLETED_UNDELIVERED
  -> DELIVERY_PENDING
  -> DELIVERED
  -> (lease expiry -> DELIVERY_PENDING again, bounded)
  -> DEAD_LETTER after retry budget exhaustion
```

A delivery retry MUST NOT transition execution back to RUNNING.

## Durable record shape

Metadata record:

- deliveryId
- eventKey (stable idempotency key)
- correlationId
- source + sourceId
- kind + machine-readable code
- immutable resultHash
- optional content-addressed artifact {id, sha256, bytes}
- state
- attemptId / leaseUntil / attemptCount
- receiptId
- createdAt / updatedAt

Never store in delivery metadata:

- raw chat transcript
- secrets/tokens/passwords
- raw tool arguments
- unbounded stdout/stderr
- arbitrary filesystem paths exposed to callers

## Delivery API shape

Bounded read-only:
- delivery_status
- delivery_list(correlationId, cursor, limit)
- delivery_get(deliveryId, correlationId)
- delivery_read_artifact(deliveryId, correlationId, offset, maxBytes)

Idempotent delivery actions:
- delivery_claim(deliveryId, correlationId, attemptId, leaseMs)
- delivery_ack(deliveryId, correlationId, attemptId)

## Long work admission

Potentially long or high-output work must not occupy a synchronous transport request until completion.

Preferred flow:

```
Chat turn
  -> validate + authorize
  -> persist request identity
  -> return small durable handle
  -> background worker
  -> terminal receipt
  -> delivery event
  -> later bounded retrieval/ack
```

The synchronous safety budget must be materially below the tunnel response deadline. Increasing tunnel timeout is not the primary fix.

## Result envelope

A final chat-safe record contains only:
- status
- short machine-readable code
- correlationId/jobId
- timestamps
- bounded summary
- artifact hash/bytes
- pagination/chunk handle

Full logs/results remain outside the MCP response envelope.

## Project Engine integration

Project Engine must use a durable outbox pattern. The transaction that persists a terminal/wait state must also persist an outbox intent. A crash between project-state commit and delivery publication must be repairable by reconciliation without inventing success or repeating effects.

## Detached operation integration

operation_start accepts an optional opaque correlationId while preserving legacy callers. Terminal operation receipts are backfilled into the delivery inbox by reconciliation, even if no chat later calls operation_result.

## External host boundary

MCP 2026-07-28 Tasks/subscriptions may be used only after capability negotiation proves the ChatGPT host supports the needed flow. Until then the safe fallback is durable inbox discovery/polling. Commander cannot truthfully guarantee that the ChatGPT UI itself will never show "Connection interrupted".

## Release gate

Stable release is blocked until:
- all P0 CSDC items have PASS evidence or an explicitly accepted external boundary;
- Windows and Linux full CI pass;
- real tunnel canaries produce zero Commander-caused deadline drops;
- fault injection demonstrates at-most-once mutation semantics;
- long soak has zero silent terminal states and zero unrecoverable completed-undelivered jobs.
