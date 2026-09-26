# Power-Outage Recovery Checklist R1

Purpose: recover the 2026-09-26 CSDC change-set without destroying uncommitted evidence.

## Absolute first rule

Do **not** run install/update/reset/clean/checkout/restore, do not delete state directories, and do not promote a candidate until the local dirty trees and durable stores are captured.

## Windows first boot

1. Confirm OS/storage/network are stable.
2. Read-only probe Commander health; do not start a duplicate service if supervisor already recovered it.
3. Capture:
   - active process/service/tunnel inventory;
   - canonical routing state;
   - installed Commander/tunnel-client versions;
   - tunnel log tail starting before outage if retained.
4. In `ChatGPTRemoteCommander-v092` capture:
   - current branch;
   - HEAD;
   - `git status --short`;
   - `git diff --stat`;
   - hashes of untracked/modified CSDC files.
5. Verify HEAD is still expected local authority `defb3ae95ef14cd9ce2c8f88f7dae134f855ddad` or document the actual value before any mutation.
6. Syntax-check changed JavaScript only.
7. Inspect SQLite databases with integrity checks before opening them for mutation.
8. Determine whether the long test/terminal processes were interrupted by power loss; do not infer success from missing PIDs.
9. Reconcile the local dirty tree against cloud branch `audit/chat-safe-completion-r1`; prefer preserving both copies and comparing hashes rather than overwriting.
10. Only after reconciliation resume CSDC implementation.

## Linux first boot

1. Confirm old canonical connector version and route before updating.
2. Capture retained-terminal child state and updater blocker evidence.
3. Verify branch/source candidate independently.
4. Run filesystem/SQLite integrity checks.
5. Do not kill preserved user terminal sessions to force an update.
6. Resume v0.9.3 candidate qualification only after Windows/local authority is understood.

## Tunnel recovery

For both machines:
- verify exactly one intended tunnel poller/profile;
- verify local MCP health independently from control-plane health;
- inspect first post-boot poll and reconnect;
- record any `command response deadline reached`, 413, auth, 429/5xx, reset, or routing-correction events;
- verify short system_status before any long command;
- route every long test to durable/background execution.

## CSDC local reconciliation

Expected pre-outage local facts:
- register commit: `defb3ae95ef14cd9ce2c8f88f7dae134f855ddad`;
- branch: `codex/v0.9.2-linux-complete-r1`;
- baseline before register: `a36ec05ea2c530ef52473b6a6f851a4484a31a35`;
- known local new/modified files included delivery-store/tools/tests and CSDC docs;
- delivery-store focused tests reached 7/7 PASS before integration work;
- async-operations integration was restored once from HEAD after a bad patch, then re-applied narrowly; final post-outage syntax/test status must be re-established and must not be assumed.

## Cloud recovery authority

Cloud branch:
`audit/chat-safe-completion-r1`

It contains:
- the 36-item CSDC register;
- cloud-tested core delivery snapshot;
- architecture/fault-injection/recovery documents.

The cloud branch is a recovery/test branch, not a replacement for the local dirty tree and not a release authority.

## Exit criteria for recovery phase

Recovery phase ends only when:
- both filesystems and relevant SQLite stores pass integrity checks;
- local git authority and dirty changes are captured;
- tunnel pollers are healthy;
- no duplicate services/pollers exist unexpectedly;
- local vs cloud CSDC delta is understood;
- a new clean change-set baseline is committed before further major integration.
