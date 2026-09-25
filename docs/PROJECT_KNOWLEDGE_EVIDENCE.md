# Engineering decisions and evidence

Updated: 2026-09-25. Current immutable published-release authority is [v0.8.37](RELEASE_0.8.37.md). [v0.8.40](RELEASE_0.8.40.md) is the current release candidate; v0.8.38 and v0.8.39 remain historical unpublished tags. This public index separates reusable engineering decisions from historical deployment observations.

## Current guarantees and their regression locations

| Decision / failure prevention | Evidence |
| --- | --- |
| Long-running command work can detach from the initiating MCP request and be polled/cancelled by durable operation ID | `test/async-operations.test.mjs`, `test/async-http.test.mjs` |
| Lost acknowledgement reuses the same effect through a stable request ID; changed inputs under that ID fail closed | `test/async-operations.test.mjs`, `test/async-http.test.mjs` |
| Valid exact completion receipts outrank lossy state projections; Windows transient atomic-renames are bounded-retried rather than turning a completed effect into false uncertainty | `test/async-operations.test.mjs`; direct 30-operation race regression |
| Child process exit is completion evidence independent of indefinitely inherited stdio; drain is bounded and output completeness is explicit | `test/async-operations.test.mjs` (`linger-stdio` regression) |
| Captured command output is file-backed and bounded while complete-stream total bytes and SHA-256 remain available | `test/async-operations.test.mjs` large-output regression |
| Pause/cancel authority survives late receipts; ambiguous workflow effects are not blindly replayed | `test/workflow-control.test.mjs`, `test/project-engine-review.test.mjs` |
| Persist attempts, observations and provider-call budgets before continuation | `test/project-engine.test.mjs`, `test/project-engine-integration.test.mjs` |
| Independent immutable checks and fresh artifact hashes determine workflow completion | `test/project-verifier.test.mjs`, `test/project-engine-review.test.mjs` |
| Reject hardlinked and aliased mutation/evidence paths | `test/file-write-guard.test.mjs`, `test/project-engine-integration.test.mjs` |
| Background web automation uses an instance-isolated Commander-owned Chromium profile first and requires explicit current-task authorization before same-profile foreground exposure | `test/browser-safety.test.mjs`, `test/browser-process.test.mjs`, `test/browser-owned-processes.test.mjs`, [v0.8.39 historical candidate](RELEASE_0.8.39.md) |
| Custom no-start installers preserve live routing; updates retain active terminal workloads | `test/linux-installer-isolation.test.mjs`, `test/auto-update-contract.test.mjs` |
| Native and legacy plugin manifests retain matching identity/version, discoverable skills and public assets | `test/onboarding-plugin-check.mjs` |

## E063 — durable background command operations

**Date/Context:** 2026-09-25; retry/disconnection reduction and zero-interference execution.

**Claim/Decision:** Introduce a compatibility-level `operation_start/status/result/cancel` surface for long or high-output `run_project_command` / `run_shell` work. Initial calls return quickly; state and receipts live outside chat context; request IDs are stable idempotency keys; `UNCERTAIN` never authorizes blind replay.

**Method evidence:** MCP 2026-07-28 defines an experimental Tasks extension for durable/pollable/cancellable work: <https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks>. Host negotiation/support in the current ChatGPT Plugin path is **UNVERIFIED**, so this project does not claim native Tasks support and retains the minimal custom compatibility surface. If the host later advertises Tasks reliably, native protocol alignment should be evaluated before adding more custom orchestration.

**Confidence/Status:** CONFIRMED for the project implementation and local HTTP/MCP behavior; UNVERIFIED for ChatGPT host support of the official Tasks extension.

**Reuse targets:** runtime architecture, Plugin skill, release notes, retry-prevention guidance.

## E064 — false UNCERTAIN after successful Windows operation

**Date/Context:** 2026-09-25; repeated failure family reached the project stop-patching threshold and triggered historical/concurrency audit.

**Observed evidence:** A diagnostic captured `result.json` with matching operation ID/input hash and `status=SUCCEEDED`, while the state projection had become `UNCERTAIN/WORKER_EXCEPTION` because Windows returned `EPERM` replacing `state.json` after the receipt was already durable.

**Root cause:** Two durable files represented completion, but recovery gave the fallible state projection precedence over the exact receipt. Transient Windows rename sharing failures were not bounded-retried.

**Prevention/Guard:** Exact valid receipt is authoritative for completed operation outcome; state is a repairable projection. Atomic JSON replacement retries only transient Windows `EPERM/EACCES/EBUSY` within a bounded budget. No effect is rerun to repair metadata.

**Regression:** receipt-first recovery test; ten-run focused stress (**80/80 PASS**) and direct 30-operation race diagnostic (**30/30 PASS**) after the final fix.

**Confidence/Status:** CONFIRMED.

## E065 — process exit stranded by inherited stdio

**Date/Context:** 2026-09-25; diagnostic found a different operation with child process gone but worker still awaiting completion and no receipt.

**Root cause:** Worker awaited Node's `close` event, which occurs after stdio closes; descendants can inherit a pipe after the direct child exits. Official Node documentation distinguishes `exit` from later `close`: <https://nodejs.org/api/child_process.html#event-exit> and <https://nodejs.org/api/child_process.html#event-close>.

**Prevention/Guard:** Record direct-child `exit` outcome, allow a bounded two-second stdio drain, then close local streams and finish the receipt if descendants keep them open. Receipt field `outputComplete` distinguishes complete drain from a bounded partial capture.

**Regression:** dedicated inherited-stdio fixture; five consecutive post-fix async runs (**45/45 PASS**); full parallel suite subsequently passed.

**Confidence/Status:** CONFIRMED.

## Current qualification evidence

Before the v0.8.40 version-authority bump, the exact working tree completed:
- `npm test`: **373 PASS / 5 SKIP / 0 FAIL**, plus GUI **75/75**, concurrency 1200, filesystem safety, Linux GUI contract, Windows runtime contract and source integrity PASS.
- `npm run check`: **152 PASS / 4 SKIP / 0 FAIL**, plus GUI **75/75**, installer/onboarding/helper/runtime/source-integrity PASS.
- `npm run audit`: **SECURITY_AUDIT_PASS**, with no secret/token/private-key/tracked-local-config/developer-path finding.
- npm dependency vulnerability scan is **N/A for this checkpoint**: `package.json` declares no dependencies/devDependencies and there is no lockfile; the network `npm audit` command produced no result and is not counted as PASS.

These candidate-development results were followed by the exact v0.8.40 Windows gate: `npm test` **373/5/0**, `npm run check` **152/4/0**, GUI **75/75**, Windows runtime/source-integrity PASS and repository security audit PASS. Linux/remote/publication gates remain separate and are not inferred from Windows evidence.

## Publication records

- [v0.8.40 candidate](RELEASE_0.8.40.md): hardened browser plus durable background command operations; publication gates remain open until evidenced.
- [v0.8.39 historical candidate](RELEASE_0.8.39.md): hardened zero-interference browser; tag exists but no GitHub Release was published.
- [v0.8.38 superseded candidate](RELEASE_0.8.38.md): pre-hardening browser candidate; historical tag is not moved.
- [v0.8.37 published qualification](RELEASE_0.8.37.md): immutable published baseline at this checkpoint.
- [Project-engine qualification history](PROJECT_ENGINE_VALIDATION.md): historical candidate results and permanent failure regressions.
- [Historical E001–E062 records](history/PROJECT_KNOWLEDGE_EVIDENCE_20260924.md): dated decisions, failures, corrections and original test scopes. These records are retained as history, not evidence of today's machine/account state.

## Repository maintenance decision

Historical checkpoints remain append-only archives. Current release/control claims live in this file and `PROJECT_CONTROL_STATE.md`. Personal host/profile examples and secrets are excluded from public evidence; exact operational receipts remain local when they would expose machine-specific state.
