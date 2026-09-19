# Durable workflows R1

## Purpose

Durable workflows give a later authorized session a verifiable project state, goal, acceptance criteria, notes, checkpoint hashes and exact next action. An action intent is recorded before invoking an existing host tool and a bounded receipt is recorded afterwards.

A missing receipt means the outcome is uncertain, not permission to repeat the action.

This subsystem is not a model, scheduler, background reasoning service or authorization system. When ChatGPT/API execution ends, reasoning ends. A later authorized session can call `workflow_resume` and continue deliberately.

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

## Eleven tools

`workflow_status`, `workflow_create`, `workflow_get`, `workflow_list`,
`workflow_note`, `workflow_search`, `workflow_checkpoint`, `workflow_resume`,
`workflow_call`, `workflow_reconcile`, `workflow_export`.

Every mutation has a revision precondition. Stored notes are caller-supplied untrusted data and never confer authority.

## Interruption safety

The execution sequence is:

`intent -> host action -> receipt -> independent evidence/acceptance`

An already-recorded identical call returns only its receipt and does not execute again.

If an external effect may have occurred but the result could not be durably recorded, the step becomes uncertain. Normal continuation is blocked until evidence is inspected and `workflow_reconcile` records the outcome. Reconciliation never retries automatically.

Device/config changes, stale/missing checkpoint evidence, unfinished intents and invalid dependency order also block continuation.

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

Only a fixed host-configured tool set can be wrapped. Shell, deletion, process kill, terminal control and recursive workflow calls are excluded from the adapter. `run_project_command` must be explicitly present in the configured execution list.

Workflow-dispatched filesystem tools are scoped to that workflow's project root even when the containing MCP instance has full Power Mode.

GUI actions, when explicitly allowed, still require the existing lease + fresh frame + foreground + local stop guards. An isolated profile configured with both Power Mode and GUI can journal the bounded GUI tool set plus scoped power/file operations; shell, delete, process-kill and terminal control remain outside durable workflow execution. Memory never revives a stale GUI frame or clears an uncertain GUI outcome.

## Multi-account rule

Do not enable one shared workflow store behind multiple principals that share a tunnel target. Use per-profile MCP isolation first. See `PROFILE_ISOLATION_R1.md`.

This is a local configuration boundary, not OS-user isolation. Principals with materially different trust levels should use different Windows users, VMs or devices.

## Tests

`npm run test:workflows` exercises memory, duplicate delivery, stale evidence, interruption and process-restart behavior.

Profile-isolation tests additionally verify a real separate MCP process with its own marker/database and ensure the primary marker is unchanged.

The optional `examples/browser` fixture uses an owned localhost page and pinned Playwright to test form/game-like steps, screenshots, trace, checkpoint and reopen. It is not proof of arbitrary website or commercial-game compatibility.
