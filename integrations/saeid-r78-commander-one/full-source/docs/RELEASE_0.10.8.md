# Remote Commander v0.10.8

Date: 2026-10-03

## Objective

Close the Windows candidate-first updater drain deadlock found during the real v0.10.7 rollout on HPC-159-17 without weakening process-ownership or no-blind-stop guarantees.

## Root cause

The previous backend was independently proven idle: active operations and queue were zero, GUI was not busy or leased, and the Commander-owned Chromium controller reported no active, busy, leased, or uncertain browser session. Its persistent `tools/browser-control.mjs --server` helper was nevertheless treated as an unsafe descendant, so `Complete-DeferredDrains` returned `BLOCKED_EXISTING_DRAIN` and prevented the already-qualified candidate from cutting over.

## Change

- Query `browser_status` from the exact owned old backend as part of stale-drain evidence.
- Treat a direct Commander-owned `tools/browser-control.mjs --server` helper as safe only when all browser activity/lease/uncertainty flags are false.
- Apply the same proof to retained-work evidence.
- Keep every unknown, active, busy, leased, uncertain, identity-mismatched, externally connected, or otherwise unowned process fail-closed.
- No other production runtime semantics are changed from v0.10.7.

## Acceptance

Publication requires hosted Windows and Ubuntu CI plus a real candidate-first Windows regression on the previously blocked HPC-159-17 route. The regression must retire the exact idle v0.10.4 previous backend through the updater's owned drain path and promote the exact v0.10.8 candidate without manual process killing.

Rollback remains the previously accepted v0.10.7 release on hosts already running it; older hosts retain their locally accepted release bytes until v0.10.8 readback succeeds.
