# Chat-Safe Durable Completion Register

This branch is the qualification authority for chat-safe completion. PASS is evidence-gated; host-external limits stay explicit.

Baseline: `a36ec05ea2c530ef52473b6a6f851a4484a31a35`. Qualification head: `6372bfa61bf265d7f337172c333f64b45072ba5d`.

## Completion SLO

- `accepted_job_without_durable_identity = 0`
- `blind_duplicate_mutation_after_retry = 0`
- `commander_caused_transport_deadline_drop = 0 during qualification`
- `silent_WAITING_BLOCKED_EXHAUSTED = 0`
- `COMPLETED_without_discoverable_result = 0`
- `oversized_result_breaks_transport = 0`
- `update_or_restart_loses_accepted_job = 0`

## Execution Register

| ID | Priority | Status | Work | Acceptance |
|---|---:|---|---|---|
| CSDC-001 | P0 | PASS | **Durable delivery store** — Persist completion/delivery records independently of chat context. | A completed job survives process/chat restart with delivery state and immutable result hash. |
| CSDC-002 | P0 | IN_PROGRESS | **Correlation identity** — Carry one correlationId across request, workflow/run, operation, artifact and delivery. | A support trace can map one accepted request end-to-end without heuristic log matching. |
| CSDC-003 | P0 | PASS | **Delivery state machine** — Implement COMPLETED_UNDELIVERED -> DELIVERY_PENDING -> DELIVERED/DEAD_LETTER. | Transitions are durable, idempotent and covered by restart/lost-ack tests. |
| CSDC-004 | P0 | PASS | **Pending-delivery inbox** — Expose bounded read/claim/ack paths for undelivered results. | A later chat can discover and claim an earlier completed result without re-running effects. |
| CSDC-005 | P0 | BLOCKED_EXTERNAL | **Chat completion bridge** — Use a supported host mechanism to wake/resume delivery when available; retain polling fallback. | Real ChatGPT qualification proves autonomous delivery, or capability is marked external/unavailable with safe fallback. |
| CSDC-006 | P0 | PASS | **WAITING/BLOCKED delivery** — Create durable user-visible events for WAITING_INPUT, BLOCKED, EXHAUSTED and quota pauses. | No terminal/wait state can become silent. |
| CSDC-007 | P0 | PASS | **Lost-ack idempotency for mutations** — Stable durable request identity now guards direct mutating file/process/terminal/browser/GUI operations. | Lost response never causes a blind duplicate effect. |
| CSDC-008 | P0 | TODO | **Universal deferred execution** — Extend deferred/durable work beyond run_shell/run_project_command to all potentially slow tools. | Any uncertain-duration tool can return a small durable handle before transport deadline. |
| CSDC-009 | P0 | PASS | **Transport safety budget** — Reserve explicit margin below tunnel response deadline for every synchronous call. | No Commander synchronous call can consume the full tunnel deadline. |
| CSDC-010 | P0 | IN_PROGRESS | **Turn-safe orchestration** — Prevent long chains of MCP calls from keeping one chat turn alive until failure. | Large projects acknowledge quickly and continue from durable state rather than a single long turn. |
| CSDC-011 | P0 | PASS | **Result envelope** — Separate compact chat summary from full artifact/output. | Final chat payload stays bounded while complete evidence remains retrievable. |
| CSDC-012 | P0 | PASS | **Exactly-once delivery receipt** — Persist delivery attempt/ack identities and suppress duplicate final answers. | Retrying delivery cannot re-execute work or duplicate an acknowledged result. |
| CSDC-013 | P1 | TODO | **Native MCP Tasks capability probe** — Probe ChatGPT Plugin support for MCP Tasks/subscriptions and implement only when negotiated. | Capability is runtime-proven; no speculative protocol claim. |
| CSDC-014 | P1 | PASS | **Paged/ranged reads** — Add paging/range contracts for large text/binary/list/search results. | Files/results larger than one MCP envelope remain retrievable without 413. |
| CSDC-015 | P1 | PASS | **Request/response size alignment** — Align tool schemas with request/response envelopes or move content to artifacts. | No advertised payload size is impossible to transport. |
| CSDC-016 | P1 | TODO | **Project Engine execution primitive** — Permit safe background build/run/test via a durable bounded execution primitive. | Enrolled execution projects can perform verified command work without unrestricted planner shell. |
| CSDC-017 | P1 | TODO | **Long-project decomposition** — Split projects into durable milestone/subrun units beyond the default five-minute run window. | Hour-scale projects progress through checkpoints instead of EXHAUSTED due solely to wall time. |
| CSDC-018 | P1 | PASS | **Pause human-wait clock** — Do not consume execution wall-clock while legitimately waiting for user input. | WAITING_INPUT does not expire before the user can answer. |
| CSDC-019 | P1 | TODO | **Quota/rate-limit state** — Classify provider quota/rate-limit as durable PAUSED_QUOTA with safe resume. | Quota exhaustion never becomes an ambiguous failure or duplicate execution. |
| CSDC-020 | P1 | TODO | **Context retrieval/compaction** — Keep working context bounded using durable refs/indexes rather than raw transcript growth. | Large projects do not fail solely because history grew. |
| CSDC-021 | P1 | TODO | **Workflow rollover/archive** — Compact/archive state before workflow/event/note/count limits are reached. | Long-lived projects remain writable and auditable. |
| CSDC-022 | P1 | TODO | **External mutation detection** — Detect project-root changes made outside Commander locks before applying/replaying planned mutations. | One-writer violations become explicit blockers rather than silent overwrite. |
| CSDC-023 | P1 | TODO | **Process-tree lifecycle** — Guarantee timeout/cancel handles descendant processes and records durable outcome. | No timed-out command leaves untracked children that can mutate later. |
| CSDC-024 | P1 | TODO | **Transient filesystem/network-drive policy** — Classify and bounded-retry safe transient EPERM/EBUSY/network-share failures. | Transient storage failures do not silently strand projects. |
| CSDC-025 | P1 | TODO | **Browser/session escalation** — Persist browser-auth/CAPTCHA/MFA blockers and deliver a minimal foreground-approval request. | Background jobs never silently hang on authentication. |
| CSDC-026 | P1 | TODO | **Update-safe run migration** — Keep active workflow/run/delivery authority stable across auto-update and policy migrations. | Updates do not strand or invalidate accepted jobs without explicit compatible migration. |
| CSDC-027 | P1 | IN_PROGRESS | **Tunnel-client v0.0.15 qualification** — Candidate-test current upstream tunnel-client on Windows/Linux and pin if it passes. | Exact binary/hash, regression and live canaries pass before promotion. |
| CSDC-028 | P1 | IN_PROGRESS | **Linux v0.9.4 completion** — Finish retained-terminal cutover, Firefox background browser, current CSDC/retry hardening, full qualification and release. | Linux canonical connector reaches the current qualified release without killing active terminals and with Windows/Linux behavior parity where platform permits. |
| CSDC-029 | P1 | TODO | **Cross-device parity** — Make Windows/Linux capability and Project Engine behavior equivalent where platform permits. | System-status parity matrix has no unexplained functional gaps. |
| CSDC-030 | P1 | TODO | **End-to-end telemetry** — Record correlationId, transport request, tool, operation, workflow, result and delivery metrics. | Deadline/post failures can be attributed to exact work instead of heuristic timestamps. |
| CSDC-031 | P1 | TODO | **Durable alerting/dead-letter** — Surface COMPLETED_UNDELIVERED, blocked and dead-letter records in health/status. | No failed delivery can remain invisible. |
| CSDC-032 | P1 | TODO | **Acceptance-strength profiles** — Support domain-specific validators instead of treating weak text checks as correctness. | COMPLETED means the configured technical/scientific acceptance really passed. |
| CSDC-033 | P0 | IN_PROGRESS | **Fault-injection regression suite** — Test disconnects before ack, after effect, during planner, after completion and during delivery. | Every injected cut preserves at-most-once effects and eventual discoverable result. |
| CSDC-034 | P0 | TODO | **Multi-chat/account concurrency regression** — Test same project from concurrent chats/accounts with ownership/delivery isolation. | No cross-chat result leakage, duplicate writer or duplicate effect. |
| CSDC-035 | P0 | TODO | **Long soak qualification** — Run 24-48h real workload qualification after fixes. | Zero Commander-caused deadline drops, silent terminal states and unrecoverable completed-undelivered jobs. |
| CSDC-036 | P0 | TODO | **Release gate** — Block stable release unless chat-safe completion SLO passes on Windows and Linux. | Release checklist requires evidence for all P0 items and accepted dispositions for remaining P1 items. |
| CSDC-037 | P0 | PASS | **Chat stream turn budget** — Prevent unbounded direct MCP call chains from causing ChatGPT UI/network/input-stream Retry before a final response is returned. | MCP initialize instructions and Plugin skill enforce a bounded direct-call batch, long work is moved to durable background state, and qualification distinguishes Commander transport failures from external Chat/UI stream failures. |

## Evidence rules

- `PASS` requires executable/code/live evidence appropriate to the item.
- `BLOCKED_EXTERNAL` means Commander-side fallback is implemented but a host/platform capability is outside Commander authority.
- Lost acknowledgement never authorizes blind replay of a mutation.
- A chat turn is never the sole owner of long-running accepted work.
- Release qualification additionally requires live Windows/Linux candidate canaries and the release gate.

## Current qualified evidence

### CSDC-001 — PASS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Durable SQLite delivery core persists records across reopen/restart and keeps state private from project roots; delivery-store regression suite is included in full CI.

### CSDC-002 — IN_PROGRESS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Opaque correlationId is persisted through detached operations and Project Engine runs into delivery artifacts/events.
- Residual: End-to-end Chat request/tunnel request correlation is not yet proven; CSDC-030 remains outstanding.

### CSDC-003 — PASS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Delivery transitions COMPLETED_UNDELIVERED -> DELIVERY_PENDING -> DELIVERED and bounded DEAD_LETTER semantics are durable/idempotent in delivery-store tests.

### CSDC-004 — PASS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Bounded MCP delivery_status/list/get/claim/ack/read_artifact surface is integrated; correlation mismatch fails closed; artifacts are chunked.

### CSDC-005 — BLOCKED_EXTERNAL

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Commander-side durable inbox fallback is implemented and cross-platform CI passes.
- Residual: Autonomous ChatGPT wake/push cannot be claimed unless the host advertises the MCP Tasks/subscriptions capability on the actual request. Native host capability still requires live observation.

### CSDC-006 — PASS

- GitHub Actions run 36227448928: windows-latest PASS; ubuntu-latest PASS; head 3da2278f3233150bc227bf4a0d090b3cfafebb9b.
- Project delivery regression covers WAITING_INPUT, BLOCKED, COMPLETED, EXHAUSTED, CANCELLED and PAUSED as durable correlation-scoped delivery events.


### CSDC-007 — PASS

- Change-set baseline: `44379b11d63585ccaf5305d20b9039f4d5893ef3` on `origin/codex/chat-safe-final-r2`; implementation worktree/branch: `fix/csdc007-lost-ack`.
- Direct mutating MCP tools carry a stable `requestId`; the durable mutation store records PREPARED before effect, stores immutable successful result/hash, replays exact successful retries without re-executing the effect, rejects changed inputs under the same ID, and fails closed as `MUTATION_OUTCOME_UNCERTAIN` after an ambiguous effect.
- Raw mutation arguments are not persisted. Power-disabled tools preserve their existing authorization failure before any idempotency state is created; `run_project_command` also retains allowlist/cwd preflight before durable mutation intent.
- Executable lost-ack HTTP regression uses real `write_text mode=append`: first call writes one token; retry with the same requestId leaves one token; restart + retry still leaves one token; changed input conflicts. Full-Power catalog regression proves direct mutating file/process/terminal/browser/GUI tools expose `requestId`, while read-only tools do not.
- Focused final regressions: mutation/idempotency + isolated-profile compatibility PASS; concurrency smoke passes twice consecutively with per-intent unique request IDs.
- Exact final code/test tree local Windows evidence: `npm run check` PASS; `npm test` **417 total / 411 PASS / 6 SKIP / 0 FAIL**, GUI HTTP/contract **75/75 PASS**, concurrency/FS/Windows-runtime/source-integrity PASS; `npm run audit` = `SECURITY_AUDIT_PASS`; `git diff --check` PASS.
- Scope: this PASS closes blind duplicate direct mutation after lost acknowledgement. Universal deferred execution (CSDC-008), remaining fault injection (CSDC-033), multi-chat concurrency qualification (CSDC-034), soak (CSDC-035) and release gate (CSDC-036) remain open.

### CSDC-009 — PASS

- GitHub Actions run 36224867884 PASS on Windows and Ubuntu at fd8bec724c17b9ed04de42db36ff509f46cc8bdf.
- Synchronous command safety budget was reduced to reserve transport headroom; long/unknown work remains directed to detached operation_start.
- Residual: Live tunnel canary after rollout is still required by CSDC-035/release qualification; this PASS is for the Commander-side safety-budget requirement.

### CSDC-010 — IN_PROGRESS

- fd8bec transport headroom PASS; durable detached operation + delivery inbox path PASS in cross-platform CI.
- Residual: Potentially slow non-command tools are not universally deferred yet; CSDC-008 remains open.

### CSDC-011 — PASS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Full operation/project result payloads are stored as content-addressed bounded artifacts; delivery metadata remains compact; artifact reads are capped/chunked.

### CSDC-012 — PASS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Same delivery attempt claim/ack is idempotent; duplicate event key returns same delivery; changed payload conflicts fail closed.

### CSDC-027 — IN_PROGRESS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Source installers now pin OpenAI tunnel-client v0.0.15 and official release hashes/tag provenance were captured.
- Residual: Live Windows/Linux candidate qualification is still required before PASS.

### CSDC-033 — IN_PROGRESS

- GitHub Actions run 36225716047: windows-latest PASS; ubuntu-latest PASS; head 6372bfa61bf265d7f337172c333f64b45072ba5d.
- Restart/lost-ack/idempotent delivery, operation receipt backfill and correlation isolation tests are in full CI.
- Residual: Remaining fault matrix cases include real tunnel disconnect, power cuts, process-tree and long soak.


### CSDC-037 — PASS

- User screenshots on 2026-09-26 captured `A network error occurred. Please check your connection and try again.` and `Error in input stream` after very long tool-call turns.
- Post-outage live Windows tunnel audit found response-deadline drops at 10:23:24 and 10:24:25 local, but no new tunnel deadline/413 event at the screenshot times around 10:36 and 11:00.
- Candidate contract limits a Chat turn to 6 direct synchronous Commander calls, forbids rapid polling, and routes larger/unknown-duration work to durable background execution with compact checkpoint/delivery identity.
- GitHub Actions run 36227846681: windows-latest PASS; ubuntu-latest PASS; head 9a8fdb8ca7205a1555b2acc55d00bb6339000968.
- Windows local qualification at the same worktree: npm run check PASS; npm test PASS; npm run audit PASS; git diff --check PASS.
- Boundary: ChatGPT UI/network stream availability is external; this PASS covers Commander-side stream exposure and retry-safe operating contract. CSDC-005 remains the host wake/delivery boundary.


### CSDC-014 — PASS

- GitHub Actions run 36227448928: windows-latest PASS; ubuntu-latest PASS; head 3da2278f3233150bc227bf4a0d090b3cfafebb9b.
- Large text/binary reads use bounded paging (max 256 KiB per page), with UTF-8 boundary guards and nextOffset/truncated metadata.


### CSDC-015 — PASS

- GitHub Actions run 36227448928: windows-latest PASS; ubuntu-latest PASS; head 3da2278f3233150bc227bf4a0d090b3cfafebb9b.
- Synchronous writes are capped below the 1 MiB HTTP request envelope; large reads fail closed into paging; retry HTTP tests cover the bounded response path.


### CSDC-018 — PASS

- GitHub Actions run 36227448928: windows-latest PASS; ubuntu-latest PASS; head 3da2278f3233150bc227bf4a0d090b3cfafebb9b.
- Human WAITING_INPUT time extends the execution deadline by measured wait time while action/planner budgets are not replenished.

