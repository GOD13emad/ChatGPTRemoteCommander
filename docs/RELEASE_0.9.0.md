# v0.9.0 qualification record

Date: 2026-09-25

This file records the exact qualification target for the v0.9.0 capability-parity milestone. GitHub tag/Release metadata remains publication authority; this document by itself does not claim publication or deployment.

## Objective

Unify the proven Windows and Linux Remote Commander capability contract without rewriting already-working subsystems:

- background-first durable command execution and retry/response-budget hardening;
- built-in GUI on Windows and GNOME/Wayland Linux with explicit takeover authority;
- durable workflow memory, checkpoints, reconciliation, scheduler and Project Brain;
- an optional bounded Project Engine provider/runner configured consistently across platforms;
- a live tool-catalog fingerprint so stale ChatGPT app scans are distinguishable from missing server capability.

## Compatibility baseline

v0.9.0 includes the v0.8.42 hotfix semantics. Historical configured provider timeouts such as 120000 ms remain valid configuration, while the effective planner process deadline is capped at 30000 ms. Candidate migration preserves that valid stored value; the new cross-platform runner configurator accepts the same historical range and never embeds provider credentials.

A machine without an installed/authenticated provider remains recovery/readiness-only and must not pretend model-driven automatic execution is available.

## Required gates before publication

1. Focused runner/catalog regressions on the rebased source.
2. Full `npm run check`, `npm test`, and repository security audit on Windows.
3. Hosted Windows and Linux CI for the exact PR head.
4. Exact-tag installer acceptance and release-asset checksum verification.
5. Candidate-first rollout on the two directly managed Emad targets while preserving persistent-terminal/drain safety.
6. Post-rollout `system_status`, GUI readiness, workflow health and tool-catalog fingerprint verification.
7. ChatGPT custom-app **Scan Tools** refresh wherever the connector inventory is stale.

Any gate not evidenced remains OPEN; activity or version metadata alone is not PASS.
