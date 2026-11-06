# Durable workflows R1

## Purpose

Durable workflows give a later authorized session a verifiable project state, goal, acceptance criteria, notes, checkpoint hashes and exact next action. An action intent is recorded before invoking an existing host tool and a bounded receipt is recorded afterwards.

A missing receipt means the outcome is uncertain, not permission to repeat the action.

The durable store does not supply a model or grant authority. Its default scheduler performs recovery/readiness only. The unreleased, separately opt-in [project execution engine](PROJECT_ENGINE.md) can invoke a configured planner for explicitly enrolled, budgeted runs and independently verify acceptance. Without that configuration, a later authorized session calls `workflow_resume` and continues deliberately.

## Activation

Durable workflows are opt-in. The normal server does not expose workflow tools unless `durableWorkflows.enabled=true`.

For the primary profile use:

```powershell
.\configure-durable-workflows.ps1
```

The default private store is:

`%LOCALAPPDATA%\ChatGPTRemoteCommander\instances\default\workflows`

Additional isolated profiles receive separate stores automatically through their per-profile instance config.

The SQLite database must live on a local filesystem with reliable locking. UNC paths are rejected. The store is deliberately separate from ordinary project roots; workflow project/evidence roots remain independently enforced.

## Seventeen durable workflow tools

`workflow_status`, `workflow_create`, `workflow_get`, `workflow_list`,
`workflow_note`, `workflow_search`, `workflow_checkpoint`, `workflow_resume`,
`workflow_call`, `workflow_reconcile`, `workflow_export`, `workflow_health`,
`workflow_operations`, `workflow_finalize`, `workflow_control`, `workflow_revise`,
`workflow_scheduler_tick`.

When the project runner is explicitly configured, `workflow_run_start`, `workflow_run_status` and `workflow_run_tick` are also exposed. Paused/cancelled workflow control persists independently of scheduler settings and fences new effects and finalization.

Every mutation has a revision precondition. Stored notes are caller-supplied untrusted data and never confer authority.

## Interruption safety

The execution sequence is:

`intent -> host action -> receipt -> independent evidence/acceptance`

An already-recorded identical call returns only its receipt and does not execute again.

If an external effect may have occurred but the result could not be durably recorded, the step becomes uncertain. Normal continuation is blocked until evidence is inspected and `workflow_reconcile` records the outcome. Reconciliation never retries automatically.

Device/authority changes, stale/missing checkpoint evidence, unfinished intents and invalid dependency order block continuation. Config hash drift is reported; it does not alone block a workflow when device, root and capabilities remain compatible.

## Data minimization

Raw tool arguments and raw outputs are not persisted. Receipts keep bounded status fields plus a SHA-256 digest. Screenshot frame tokens are never cached for replay. Credentials and credential-shaped notes are rejected by a best-effort leak guard; secrets must never be placed in workflow memory.

Exports contain one workflow, its event chain and external evidence references/hashes; external evidence bytes and credentials are not embedded.

## Integrity and concurrency

SQLite uses rollback-journal mode `delete`, `synchronous=EXTRA`, bounded busy timeout and append-only event triggers. Each event is SHA-256 chained and the materialized state digest is checked on read.

This detects accidental/tampered projections under the application model; it is not a signature/WORM system against a principal who can rewrite the entire database.

Cross-process tests cover:

- stale revision conflicts;
- simultaneous writers;
- process crash after an external effect;
- SQLite rollback of an uncommitted transaction;
- another process attempting to reconcile live work.

## Execution policy

Only a fixed host-configured tool set can be wrapped. Standard policy defaults to a small read-only set. An explicitly configured Full Power workflow can include shell, deletion, process and terminal tools; these are privileged operations, not sandboxed by the journal. Recursive workflow calls remain excluded. The new automatic project runner has its own narrower allowlist and does not inherit all Full Power tools.

Workflow-dispatched filesystem tools are scoped to that workflow's project root even when the containing MCP instance has full Power Mode.

Durable workflows cannot acquire interactive GUI takeover or perform GUI input mutations. Authorized observation still requires the existing lease/frame policy. Interactive input belongs to a current direct user session; memory never revives its authority, a stale frame or an uncertain outcome.

## Multi-account rule

Do not enable one shared workflow store behind multiple principals that share a tunnel target. Use per-profile MCP isolation first. See `PROFILE_ISOLATION_R1.md`.

This is a local configuration boundary, not OS-user isolation. Principals with materially different trust levels should use different Windows users, VMs or devices.

## Tests

`npm run test:workflows` exercises memory, duplicate delivery, stale evidence, interruption and process-restart behavior.

Profile-isolation tests additionally verify a real separate MCP process with its own marker/database and ensure the primary marker is unchanged.

The optional `examples/browser` fixture uses an owned localhost page and pinned Playwright to test form/game-like steps, screenshots, trace, checkpoint and reopen. It is not proof of arbitrary website or commercial-game compatibility.
