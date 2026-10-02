# Remote Commander v0.10.5

Date: 2026-10-02
Scope: ChatGPT stream-resume resilience / background-first transport hardening.

## Problem

Frequent ChatGPT "Resume stream unavailable" failures were observed during long Commander-heavy turns, while another account and Desktop Commander appeared less affected. A plan-tier-only cause is not proven. The actionable engineering difference is that Desktop Commander keeps long work in a persistent process and returns short, paged tool responses instead of coupling the whole workload/output to one response stream.

Remote Commander already had durable operation tools, MCP Tasks, durable delivery, retry/idempotency and workflow recovery, but two gaps remained:

1. a ChatGPT custom app can expose a stale/cached tool catalog that omits newer operation tools even though the backend implements them;
2. the compatibility fallback read_terminal could return all unread buffered output in one response, while direct synchronous shell/project calls still permitted comparatively large payloads.

## v0.10.5 change

- direct synchronous command budget: 10 seconds;
- direct shell/project output: max 32 KiB;
- direct synchronous Commander calls per assistant turn: max 2;
- read_terminal: default 32 KiB/page/stream, max 64 KiB, explicit stdout/stderr offsets and remaining counts;
- read_terminal wait: bounded long-poll, maximum 5 seconds;
- start_terminal: documented background fallback when operation tools are missing from a stale client catalog;
- background work still prefers durable operation_start / MCP Tasks whenever exposed.

This does not claim Commander can repair ChatGPT's host-side stream-resume service. It reduces dependence on one long-lived response stream.

## Evidence

Targeted regression:
- 13/13 PASS for retry guard + terminal lifecycle + paging.
- 31/31 PASS for MCP conformance, MCP Tasks, async HTTP, retry HTTP, paged I/O, schema continuity, process lifecycle and stream-safety contracts.

The same approximately 16-second test group timed out when executed as one direct synchronous Commander call, then completed when started with start_terminal and read separately. This reproduces the transport-pressure pattern and validates the background-handoff mitigation.

## Tool-catalog refresh

The backend tool list contains operation tools, but an already-open ChatGPT app/chat may retain an older scanned tool catalog. After rollout, use the Custom MCP App Refresh/Scan Tools flow (or recreate the draft app if the current ChatGPT surface requires it) and open a fresh chat to expose the new schema. The compatibility fallback remains safe before refresh.

## Acceptance gates

Do not call v0.10.5 production accepted until:
1. exact-tree check + test qualification passes;
2. Git diff/source-integrity/release contracts pass;
3. candidate-first zero-downtime rollout passes on Emad PC;
4. live readback reports v0.10.5 and the expected commit/config;
5. live terminal paging and 10-second sync guard are verified;
6. app tool scan is refreshed when the ChatGPT surface permits it; stale app catalog is recorded as an external host-cache gate rather than hidden.
