# v0.9.4 qualification

Status: CANDIDATE — evidence-gated, not yet published.

v0.9.4 consolidates the v0.9.3 Linux-completeness work with Chat-Safe Durable Completion hardening and tunnel-client v0.0.15 qualification. It is intended to become the single active Commander line on Windows and Linux after exact-commit qualification and candidate-first live rollout.

## Included

- Linux retained-backend cutover that preserves persistent terminal children while moving canonical routing to the new backend.
- Linux owned Firefox/geckodriver background-browser fallback without reusing the user browser profile.
- Durable completion delivery store in Commander-private local state.
- Bounded delivery MCP surface: status/list/get/claim/ack/read-artifact.
- Opaque correlation IDs propagated through detached operations and Project Engine runs.
- Detached-operation terminal receipt backfill into the delivery inbox after restart/disconnect.
- Project WAITING_INPUT/BLOCKED and mapped terminal states projected into durable delivery records.
- Content-addressed bounded artifacts instead of returning large full results in chat envelopes.
- Reduced synchronous command budget with explicit transport headroom; unknown/long command work remains background-first.
- Official OpenAI tunnel-client v0.0.15 pinned by installers, subject to live candidate qualification.

## Safety invariants

- Lost acknowledgement never authorizes blind replay of a mutation.
- Unknown mutation outcome remains UNCERTAIN/reconcile-first.
- Delivery retry is separate from execution retry.
- Correlation ID is a routing key inside a trusted Commander profile, not authenticated ChatGPT conversation identity.
- Native MCP Tasks/push is never claimed unless the actual ChatGPT host advertises the extension on the request.
- Existing GUI/browser foreground takeover policy is unchanged: background-first and explicit-current-request-only for foreground interaction.
- Project/scientific evidence is never removed as part of runtime cleanup.

## Proven CI

The CSDC implementation reached cross-platform full GitHub Actions PASS on:
- 6372bfa61bf265d7f337172c333f64b45072ba5d — Windows + Ubuntu PASS for durable inbox, operation backfill, project wait/block delivery and transport guards.
- ef77401748083b343ccc0fd4b46d6e23281c7ca7 — Windows + Ubuntu PASS after project-correlation fixture repair.
- fd8bec724c17b9ed04de42db36ff509f46cc8bdf — Windows + Ubuntu PASS for synchronous transport-headroom guard.

The final v0.9.4 HEAD must independently pass check/test/audit on hosted Windows + Ubuntu and on both target machines before promotion.

## Live rollout gate

1. Capture dirty/local authority and state DB integrity.
2. Qualify exact v0.9.4 commit without promoting canonical route.
3. Verify tunnel-client v0.0.15 exact official asset/hash.
4. Run doctor + hardware selftest + focused delivery canaries.
5. Run actual ChatGPT tunnel canaries and inspect only new log lines for deadline/413/post failures.
6. Promote candidate-first while preserving active terminal-bearing old backends until safe drain.
7. Verify Windows/Linux system_status/capability parity.
8. Remove obsolete active releases/tools/checkouts only after route authority and terminal ownership prove they are unused. Retain compressed evidence snapshots and scientific evidence.
9. Stable publication remains blocked until release gate evidence is recorded.

## Known external boundary

ChatGPT UI stream interruption cannot be globally prevented by Commander. v0.9.4 removes the need for an accepted long-running Commander operation to depend on one chat turn and provides a durable inbox fallback. Autonomous host wake/push remains capability-negotiated and is not assumed.
