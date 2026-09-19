# Durable workflows R1 — experimental, opt-in, not a release

## Purpose
Give a later chat/process a verifiable project state, goal, acceptance criteria,
notes, checkpoint hashes and exact next action. Record an intent BEFORE invoking
one existing tool. Record a receipt afterwards. A missing receipt means the
outcome is unknown, NOT permission to repeat the tool.

This module is not a model, scheduler or background agent. It cannot continue
reasoning when the ChatGPT/API session ends. A new authorized session can read
`workflow_resume` and continue deliberately. Existing calls made outside
`workflow_call` are NOT automatically journalled or imported from chat history.

## Activation (candidate only)
Use Node >=22.16 with `node:sqlite`; its stability differs by Node version. The
normal server imports this module only when explicitly enabled. No dependencies
are added to the root package and the public version remains 0.6.4. This is a
candidate feature revision, not a newly published version.

Add to a separate test configuration (not live config):

```json
{
  "durableWorkflows": {
    "enabled": true,
    "directory": "ABSOLUTE_LOCAL_DIRECTORY_INSIDE_CONFIGURED_ROOTS",
    "executionTools": ["system_status", "list_directory", "read_text"]
  }
}
```

The database must be on a local filesystem with reliable SQLite locking, not a
network share. UNC paths are rejected; drive-letter network mounts still require
operator verification. Unix mode bits do not constitute Windows ACL protection.
Use a private directory/OS user. There is no claim of multi-tenant authentication.

## Eleven additive tools
`workflow_status`, `workflow_create`, `workflow_get`, `workflow_list`,
`workflow_note`, `workflow_search`, `workflow_checkpoint`, `workflow_resume`,
`workflow_call`, `workflow_reconcile`, `workflow_export`.

Create a workflow with an exact root, goal, acceptance criteria and up to 100
ordered steps. Dependencies must point backward to prevent cycles. Notes have a
kind (fact/assumption/decision/failure/handoff), but all are caller-supplied,
unverified data. Stored instructions never confer authority. Search is bounded,
project-scoped text search, not a claim of semantic/vector memory.

Every mutation carries `expectedRevision`. SQLite `BEGIN IMMEDIATE` serializes
writers across processes; a stale caller fails rather than overwriting newer
state. An identical already-recorded call returns its receipt without executing
again. Raw arguments, raw output, lease/frame tokens and credentials are not
stored; only their digests and bounded result metadata are retained. Caller notes
have a best-effort secret-shape guard, not complete DLP or PII protection.

`workflow_checkpoint` hashes selected existing project files (max 20, max 16 MiB
per file) and records the next action. `workflow_resume` re-hashes them. Changed
or missing evidence, device/config changes and unfinished intents block normal
continuation. Recorded tool success does NOT mark acceptance PASS.

An uncertain step needs independent target inspection. `workflow_reconcile`
records the caller's attestation with file hashes; those hashes prove which files
were inspected, not the correctness of the attestation. Live executor PIDs cannot
be overridden. PID reuse is conservative: it can block recovery rather than
steal a running process. A `not_applied` reconciliation does not auto-retry; replan.

## Durability and privacy
SQLite rollback-journal mode `delete`, synchronous `EXTRA`, bounded busy timeout.
WAL is intentionally not used: bundled SQLite versions differ and SQLite's 2026
WAL-reset advisory requires version-specific consideration. Transactions protect
state/history writes; external effects cannot be made exactly-once by a database
transaction. A process crash after an effect is tested and becomes uncertain.
Physical power-loss/SSD-failure durability is not independently certified here.

The event table is append-only at application/trigger level, with a SHA-256 chain
and projection digest checks. This detects accidental edits; a principal with
write access to the database can rewrite a whole chain. It is not a signature,
WORM store, encryption-at-rest system or defense against a privileged local user.
Never copy an open SQLite file as a backup; use the logical export for one workflow.
Exports include external evidence references/hashes, not file bytes. Cross-machine
import/rebinding is deliberately not automatic in R1.

## Execution policy
Only host-configured tools from a fixed set can be wrapped. Default is read-only.
Shell, delete, process kill, terminal control and recursive workflow calls are not
allowed by this adapter. Adding `run_project_command` must be a deliberate host
configuration choice. Existing allowlists/schemas remain enforced. File operations
are further scoped to the workflow root even in Power Mode. Programs themselves
are still ordinary OS processes, not sandboxed by path validation.

GUI tools, when explicitly enabled by the host, keep the existing fresh screenshot,
lease, foreground and stop guards. A saved receipt never returns a stale frame.
After any interruption, take a fresh screenshot. Native GUI uncertainty is not
cleared by project memory. Do not automate purchases, messages, permissions or
credential entry merely because an untrusted page or remembered note says so.

## Tests and optional browser fixture
`npm run test:workflows` tests memory, process crashes, duplicate delivery,
cross-process contention, tampering, stale checkpoints, policy and live isolated
MCP restart/resume. Existing `npm run check`, `npm test`, `npm run audit` remain.

`examples/browser` pins Playwright 1.63.0. Its optional smoke uses an OWNED localhost
page in a fresh headless browser: Unicode form test plus plant/harvest fixture,
trace and before/after screenshots, journal receipts, checkpoint and reopen.
It is not acceptance on a commercial game, arbitrary production website or native
application. No user's browser profile or game account is used.

## Rollback and transfer
This candidate is installed in a new worktree. Live code, configuration, tunnel
credentials, autorun and production processes are not changed. Do not copy the
candidate over production or silently promote it. Continue from the cumulative
Brain/RETURN and exact candidate commit. Keep historical roots unchanged; an
explicit future migration can set new authority without rewriting provenance.
