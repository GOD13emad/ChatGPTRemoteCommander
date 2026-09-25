# Engineering decisions and evidence

Updated: 2026-09-25. Current immutable published-release authority is [v0.8.41](RELEASE_0.8.41.md). v0.8.42 is merged live-compatibility code on main but is not the published-release authority at this checkpoint. [v0.9.0](RELEASE_0.9.0.md) is the current capability-parity qualification target.

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
- `npm run check`: **156 PASS / 4 SKIP / 0 FAIL**, plus GUI **75/75**, installer/onboarding/helper/runtime/source-integrity PASS.
- `npm run audit`: **SECURITY_AUDIT_PASS**, with no secret/token/private-key/tracked-local-config/developer-path finding.
- npm dependency vulnerability scan is **N/A for this checkpoint**: `package.json` declares no dependencies/devDependencies and there is no lockfile; the network `npm audit` command produced no result and is not counted as PASS.

These candidate-development results were followed by the exact v0.8.40 Windows gate: `npm test` **373/5/0**, `npm run check` **152/4/0**, GUI **75/75**, Windows runtime/source-integrity PASS and repository security audit PASS. Independent Linux verification of exact commit `2245495e6554f86bdfd97c15483b6d3b77408108` then passed `npm test` **377/1/0**, `npm run check` with exit 0 and all tail contracts PASS, and `npm run audit` with `SECURITY_AUDIT_PASS`. The Linux production checkout/service was not mutated; verification used a separate detached worktree. Remote/hosted/publication gates remain separate.

## Publication records

- [v0.8.42 candidate](RELEASE_0.8.42.md): compatibility hotfix retaining v0.8.41 transport bounds while accepting persisted legacy provider timeout values.
- [v0.8.41 published/deployment-superseded](RELEASE_0.8.41.md): immutable retry/connection hardening release; package/CI gates passed, but first Windows live candidate failed before cutover.
- [v0.8.40 historical candidate](RELEASE_0.8.40.md): durable background operations tag; not published as a GitHub Release and superseded by v0.8.41.
- [v0.8.39 historical candidate](RELEASE_0.8.39.md): hardened zero-interference browser; tag exists but no GitHub Release was published.
- [v0.8.38 superseded candidate](RELEASE_0.8.38.md): pre-hardening browser candidate; historical tag is not moved.
- [v0.8.37 published qualification](RELEASE_0.8.37.md): immutable published baseline at this checkpoint.
- [Project-engine qualification history](PROJECT_ENGINE_VALIDATION.md): historical candidate results and permanent failure regressions.
- [Historical E001–E062 records](history/PROJECT_KNOWLEDGE_EVIDENCE_20260924.md): dated decisions, failures, corrections and original test scopes. These records are retained as history, not evidence of today's machine/account state.

## Repository maintenance decision

Historical checkpoints remain append-only archives. Current release/control claims live in this file and `PROJECT_CONTROL_STATE.md`. Personal host/profile examples and secrets are excluded from public evidence; exact operational receipts remain local when they would expose machine-specific state.


## E066 — Secure MCP Tunnel deadline and oversized-response retry failures

**Date/Context:** 2026-09-25; user-visible Retry / `Connection interrupted. Waiting for the complete answer` investigation on an audited Windows deployment.

**Observed evidence:** Real Secure MCP Tunnel logs repeatedly recorded `command response deadline reached; dropping without posting a response`. Independent tool exercises also produced multi-megabyte successful MCP payloads, matching the earlier historical 413 failure family. A separate control-plane poll timeout/backoff was observed but did not explain the repeated command-response drops.

**Root cause:** Some direct synchronous tools were allowed to run near or beyond the tunnel command response deadline, and large successful results could duplicate the same payload in both MCP `content` text and `structuredContent`. Either condition could prevent a complete response from reaching ChatGPT even when local work succeeded.

**Method evidence:** OpenAI tunnel-client protocol documents that the response deadline bounds the whole MCP command lifecycle and late responses are dropped: <https://github.com/openai/tunnel-client/blob/master/docs/protocol.md>. MCP Tasks 2026-07-28 defines durable task handles with polling/cancellation for deferred work: <https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks>. The project therefore uses the minimum compatibility control rather than extending tunnel deadlines blindly.

**Prevention/Guard:** Direct command/browser/planner work is bounded to 30 seconds before effect where applicable; longer or uncertain-duration command work uses durable `operation_start/status/result/cancel`. Tool success rendering stops duplicating structured payloads above 128 KiB. The final serialized MCP response has an 8 MiB safe envelope; oversize responses become a compact JSON-RPC `MCP_RESPONSE_TOO_LARGE` error rather than being sent into the transport.

**Regression:** 5 MiB read succeeds with structured content and compact duplicate text; 9 MiB read returns a sub-2 KiB bounded error; >30s direct command requests fail before execution; durable async/idempotency tests pass. Ten consecutive retry-transport runs completed **40/40 PASS**. Current full Windows suite: **377 PASS / 5 SKIP / 0 FAIL**; current check gate: **156 PASS / 4 SKIP / 0 FAIL** plus GUI/integrity contracts.

**Confidence/Status:** CONFIRMED for the identified Commander/tunnel failure classes. Platform/UI interruptions with no corresponding tunnel/MCP failure remain outside Commander authority and are not claimed eliminated.

**Reuse targets:** transport architecture, Plugin skill, release notes, operations handbook.

## E067 — fresh `SkipTunnelClient` acceptance failure

**Date/Context:** 2026-09-25; isolated v0.8.40 release acceptance.

**Observed evidence:** A fresh exact-tag Windows install with `-SkipTunnelClient` fetched and verified the source correctly, then failed because no tunnel-client executable already existed.

**Root cause:** The switch meant “reuse a pinned client or throw” rather than “skip tunnel-client installation”, contradicting isolated/no-start release acceptance semantics.

**Prevention/Guard:** On fresh/custom installs, `-SkipTunnelClient` now returns without downloading or requiring the client. If the pinned executable already exists it is still verified/recorded and reused. Installer contract tests assert both the new behavior marker and absence of the old throw path.

**Confidence/Status:** CONFIRMED in source/contract tests; exact-tag fresh/repeated acceptance remains a release gate until v0.8.41 is tagged.

**Reuse targets:** installer docs, release qualification.

## E068 — stale isolated-profile config hash caused supervisor error loop

**Date/Context:** 2026-09-25; multi-account Windows live-state audit.

**Observed evidence:** An isolated profile's `instance.json` recorded a stale config SHA while its `config.json` bytes had a different SHA. The supervisor emitted `instance config hash mismatch` every five seconds even though the routed 0.8.37 backend and tunnel were currently healthy.

**Repair/evidence:** The profile config/record pair was transactionally regenerated with omitted mode so explicit Full Power authority was preserved. Post-state record SHA equals actual config SHA, the existing routed backend stayed healthy, and the repeating supervisor hash-mismatch entries stopped. The route itself was not blindly restarted.

**Limitation discovered:** The legacy reconfigure wrapper's timeout rollback assumes the backed-up record SHA already matched the backed-up config; that assumption is false for this corruption class. The live metadata repair succeeded before that rollback check, but the wrapper emitted a rollback-verification error. This edge case is recorded as a separate maintenance limitation and is not counted as a clean reconfigure PASS.

**Confidence/Status:** LIVE METADATA REPAIR CONFIRMED; legacy stale-prestate rollback edge case remains OPEN/DEFERRED unless it recurs in normal v0.8.41 update paths.

**Reuse targets:** multi-account recovery, supervisor diagnostics, future reconfigure hardening.


## E069 — v0.8.41 live upgrade rejected persisted 120 s planner configuration

**Date/Context:** 2026-09-25; first candidate-first Windows production rollout after immutable v0.8.41 publication.

**Observed evidence:** v0.8.41 passed local/hosted CI, reproducible assets and fresh/repeated no-start installer acceptance. During live candidate-first update, repository gates `check/test/audit/gui-native-selftest` all passed and a diagnostic config was generated from the persisted Full Power profile. The candidate backend never reached health and the updater ended `FAILED: CANDIDATE_HEALTH_TIMEOUT profile=default port=48836`. No route switched; both canonical profiles remained healthy on v0.8.37.

**Root cause:** The persisted Project Engine runner configuration contains `provider.timeoutMs=120000`, which was valid in prior releases. v0.8.41 changed `createCommandPlanner` validation from an accepted maximum of 600000 ms to 30000 ms in order to keep synchronous work below the tunnel response deadline. Startup constructs the planner whenever the runner is enabled, so the existing configuration threw `PLANNER_INVALID_CONFIG` before the candidate backend could become healthy. CI and isolated no-start installation did not instantiate this exact persisted-runner compatibility path.

**Prevention/Guard:** Configuration acceptance and effective execution deadline are separated. Historical configured values remain valid in the prior 10..600000 ms range, while the effective planner process timeout is clamped to 30000 ms. This preserves the retry/deadline control without making previously valid persisted profiles unloadable.

**Regression:** `test/project-planner.test.mjs` asserts a configured 120000 ms provider constructs successfully and reports an effective 30000 ms timeout. The focused planner suite passes **27/27**. Full Windows qualification also passes `npm run check` **156/4/0**, `npm test` **378/5/0**, GUI **75/75**, integrity tails, and security audit. v0.8.42 must additionally pass candidate-first live validation against the same persisted profile before publication/deployment is accepted.

**Live regression evidence:** The exact hotfix commit `1d2308fb3873870e7bd47e394c8d96cffe74c28d` completed updater `NoPromote` validation as `CANDIDATE_PASS` against the real persisted Full Power profiles. Default and saeed-emad each passed doctor, hardware, shadow-store and live-store compatibility while preserving configured `provider.timeoutMs=120000`. Production route SHA-256 values remained `8d5f275ab835c9790bb1fadfdb109dd07db14e0b4d8c4d18c18da46c860d62b1` (default) and `3f6a274a9a10ea664c2ae57d4f83102173563137f3ea127d2e9ac17bc42972c3` (saeed-emad); live services remained v0.8.37 and candidate listeners were removed after validation.

**Confidence/Status:** ROOT CAUSE CONFIRMED; v0.8.41 LIVE DEPLOYMENT REJECTED SAFELY; v0.8.42 HOTFIX LIVE-COMPATIBILITY GATE PASS.

**Reuse targets:** update compatibility policy, release gates, Project Engine configuration migration, retry hardening.


## E070 — connector tool-catalog drift is not missing Linux capability

**Date/Context:** 2026-09-25; direct comparison of the two Emad targets after a prior report inferred missing Linux GUI/workflow features from the ChatGPT-visible connector schema.

**Observed evidence:** The Linux MCP server's loopback `tools/list` includes the full GUI family and durable workflow tools, and direct `gui_status` reports GNOME/Wayland available with screenshot, cursor, window listing, mouse, keyboard and focus. The current ChatGPT connector surface exposes fewer tools.

**Claim/Decision:** Treat this mismatch as custom-app/tool-scan freshness unless the live MCP catalog itself lacks the capability. v0.9.0 adds `system_status.toolCatalog` count/SHA-256 fingerprinting and requires **Scan Tools** again when that fingerprint changes.

**Confidence/Status:** CONFIRMED on the directly managed Linux target and live server; ChatGPT app re-scan remains a registration gate.

**Reuse targets:** onboarding, Work Plugin skill, deployment audit, support diagnostics.

## E071 — v0.9.0 parity keeps v0.8.42 compatibility semantics

**Date/Context:** 2026-09-25; rebase of capability-parity work onto the v0.8.42 live compatibility hotfix.

**Decision:** Do not rewrite valid historical configured provider timeouts during candidate migration. v0.8.42 already implements the minimum sufficient control: configuration accepts the prior 10..600000 ms range while effective planner execution is capped at 30000 ms. The v0.9.0 cross-platform runner configurator follows the same contract.

**Rationale:** Forced normalization of stored 120000 ms values would add mutation without improving the transport outcome and would duplicate the upstream hotfix.

**Confidence/Status:** CONFIRMED by source comparison; exact rebased v0.9.0 regression gates pending.

**Reuse targets:** runner configuration, updater migration policy, release notes.


## E072 — exact rebased v0.9.0 local qualification

**Date/Context:** 2026-09-25; capability-parity branch after rebase onto the v0.8.42 live-compatibility baseline.

**Evidence:** exact HEAD `04b2dc45696d0b0d3eac531ccba701da6265dfde`; focused runner/catalog/planner tests **31/31 PASS**; `npm run check` **156 PASS / 4 SKIP / 0 FAIL** plus GUI **75/75**, Linux GUI contract, filesystem safety, Windows runtime and source integrity PASS; `npm test` **378 PASS / 5 SKIP / 0 FAIL** plus browser/concurrency/GUI/platform tails; repository audit reports `SECURITY_AUDIT_PASS`.

**Durable evidence:** detached fail-fast receipt status `PASS`, SHA-256 `e10f12d125169e6168566d562b00606af976ed8f44e06c80944f64c3e47bf9d9`. The receipt recorded predecessor HEAD `f7370b7778e56d0f56760f16caea1856a10f0900` because the already-tested `package.json` syntax-gate hardening was still unstaged during the run; the subsequent package-only amend produced product commit `04b2dc45696d0b0d3eac531ccba701da6265dfde` with those same tested product/test bytes. Check/test/audit stdout SHA-256 values are respectively `51e9f700e09f5ce2a6577bcfdfff9084a028f2bfcb46dcb04fb3b1eb6127814b`, `fe29accc1e25cdaffe502ba4e6c5c54df71063dcacade8c7e5c4170a95f6680d`, and `d89263829a435bd41f7a0bb9906258e1a99a2b881af7400dcfeb1492b8c56ebd`.

**Limitation:** the receipt's optional per-gate array is empty because the temporary PowerShell harness used function-local array scope. Its top-level `PASS` path is still fail-fast and reachable only after all three child exit codes are zero; independent gate logs provide the detailed evidence. This is a release-harness limitation, not a product runtime result, and is not used to weaken any acceptance gate.

**Confidence/Status:** CONFIRMED local Windows qualification. Hosted CI, exact-tag installer/assets, publication and live rollout remain separate gates.

**Reuse targets:** v0.9.0 release record, Project Control, deployment handoff.
