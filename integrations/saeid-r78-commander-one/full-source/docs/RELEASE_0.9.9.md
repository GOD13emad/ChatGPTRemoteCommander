# v0.9.9 qualification

Status: CANDIDATE — Bounded durable-delivery reconciliation release.

## Objective

Remove unnecessary historical-operation I/O churn from the durable completion reconciler without weakening lost-ack recovery, restart backfill, correlation isolation, idempotency or result retention.

## Root cause

`reconcileDeliveriesOnce()` called `discoverForDelivery()` on every periodic cycle. Discovery re-added every historical operation directory to the live tracked set. Terminal operations whose delivery event had already been published were therefore repeatedly re-read; exact receipts could be re-adopted and `state.json` rewritten even though no new result existed. On a long-lived Windows profile with a large operation history this created avoidable filesystem churn every five seconds.

## Change

- Historical operation discovery is performed once per async-operation manager lifetime.
- New operations remain tracked immediately at `operation_start`.
- Operations discovered during restart remain tracked until terminal delivery succeeds.
- Failed delivery publication stays tracked for retry.
- No delivery record is purged, auto-acked or reassigned across correlations.
- No host-stream timeout or wake capability is claimed.

## Regression

The restart-backfill regression records terminal state-file mtime after first reconciliation, runs a second reconciliation, requires `checked=0`, requires exactly one delivery event, and requires the state-file mtime to remain unchanged.

## Acceptance gates

- Focused async/delivery/retry/idempotency regressions.
- Full `npm run check`.
- Full `npm test`.
- `npm run audit`.
- Exact version equality across package/server/plugin/installer defaults.
- Windows installed candidate doctor and post-promotion route verification.
- Linux exact-commit check/test/audit and live version parity before FINAL-LIVE.

Promotion is forbidden until exact-commit gates pass. ChatGPT UI/host messages such as `Our systems are thinking a bit more about this request before responding.` followed by stream termination remain separately tracked: Commander must preserve work/results through such loss, but cannot eliminate a host-side stream failure without a supported host capability.
