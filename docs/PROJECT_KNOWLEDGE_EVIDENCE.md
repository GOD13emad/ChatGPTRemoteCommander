# Engineering decisions and evidence

Updated: 2026-09-26. Current immutable published-release authority is [v0.9.1](RELEASE_0.9.1.md). [v0.9.3](RELEASE_0.9.3.md) is the current Linux-completeness candidate; v0.9.2 is an unpublished installer-cleanup candidate; v0.8.38, v0.8.39 and v0.8.40 remain historical unpublished tags. This public index separates reusable engineering decisions from historical deployment observations.

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
| Background web automation uses a Commander-owned profile first: Chromium/CDP where available and Firefox/geckodriver WebDriver on qualified Linux hosts; explicit current-task authorization remains required before foreground exposure | `test/browser-safety.test.mjs`, `test/browser-process.test.mjs`, `test/browser-firefox-native.test.mjs`, `test/browser-owned-processes.test.mjs` |
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

- [v0.9.3 candidate](RELEASE_0.9.3.md): v0.9.2 cleanup plus Linux terminal-retention and Firefox WebDriver background-browser parity.
- [v0.9.2 historical candidate](RELEASE_0.9.2.md): unpublished installer-cleanup hotfix candidate.
- [v0.9.1 published](RELEASE_0.9.1.md): immutable release-hardening release with 13 assets.
- [v0.9.0 published](RELEASE_0.9.0.md): immutable capability-parity release with 13 assets; its Windows rollout exposed the cleanup-race false failure corrected by v0.9.2.
- [v0.8.42 published](RELEASE_0.8.42.md): immutable live-compatibility baseline that preserves v0.8.41 transport hardening and restores persisted provider-timeout compatibility.
- [v0.8.41 published](RELEASE_0.8.41.md): immutable retry/connection hardening release, deployment-superseded by v0.8.42.
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

## E069 — Full Power Project Engine parity across Emad deployments

**Date/Context:** 2026-09-25; reconciliation of capabilities created through Saeed's ChatGPT Work account on the accessible Emad Windows PC with the Emad Linux laptop. No direct machine-state claim about Saeed's own physical computer is used as evidence.

**Observed evidence:** Both accessible runtimes were v0.8.37 at the audit checkpoint. Windows Full Power config contained an enabled Project Engine runner with `autoTick=true`, qualified Codex CLI 0.156.1, bounded builder/reviewer proposal team, adaptive extension budget and durable worker-artifact controls. Linux Full Power config had the same qualified Codex CLI 0.156.1 binary installed under its private Commander state root but no runner block; `system_status` therefore reported `automaticExecution=false` and `runnerConfigured=false`.

**Root cause:** capability migration preserved an existing runner but did not create one from the already-qualified local provider. Full Power therefore meant different effective project-execution capability depending on prior machine history.

**Decision/Prevention:** v0.9.0 through v0.9.3 add explicit `workflow.project_engine` capability accounting and cross-platform qualified-provider discovery. Canonical explicitly authorized Full Power installs/updates may bootstrap the pinned private Codex CLI 0.156.1 provider and auto-configure the bounded runner; Standard authority, explicit opt-out and custom/no-start isolation remain fail-closed. Historical configured provider timeouts remain loadable through the v0.8.42 compatibility guard while effective execution remains clamped to 30 seconds.

**Regression:** `test/project-runner-config.test.mjs` covers Linux and Windows provider discovery, preservation + timeout migration, Standard denial, explicit opt-out, missing-provider fail-closed behavior and capability-state accounting. A discovered authority-hash regression in crash-recovery fixtures was corrected by separating capability authorization from runner readiness; the combined parity/capability/recovery gate then passed 73/73. The converged candidate line also passed full Windows check/test/audit, full Linux check/test/audit, real candidate-config parity on both accessible Emad devices, and Linux custom/no-start isolation 4/4.

**Confidence/Status:** implementation and local cross-platform qualification CONFIRMED; hosted CI, immutable v0.9.3 publication and production rollout remain OPEN until separately evidenced.

**Reuse targets:** v0.9.3 release, installer/updater policy, Full Power capability model, Project Brain, Work/Codex setup.


## E070 — post-success Windows installer cleanup race

**Date/Context:** 2026-09-25; first live Windows rollout of immutable v0.9.0.

**Observed evidence:** both configured Windows profiles passed candidate health/doctor and were switched to v0.9.0. The updater emitted `SAFE_UPDATE_PASS`, after which the outer `install.ps1` returned exit code 1 from its `finally` cleanup because the temporary updater tree had already disappeared.

**Root cause:** temporary-tree cleanup was treated as an unconditional final operation. A disappearance race after successful cutover could surface as a terminating cleanup error and overwrite the already-proven update outcome.

**Prevention/Guard:** v0.9.2 makes cleanup idempotent only for an already-absent tree. It checks existence before removal; if removal throws, it suppresses the error only when the tree is now absent. If the tree still exists, the cleanup error is rethrown. Candidate-first route switching, backend validation and rollback behavior are unchanged.

**Regression:** Windows installer parser/contract checks require the guarded cleanup pattern; focused parity/recovery/installer gate passed 117/117; full Windows and exact-commit Linux check/test/audit subsequently passed. Final live rollout must additionally prove process exit 0 after `SAFE_UPDATE_PASS`.

**Confidence/Status:** root cause and code guard CONFIRMED; final live v0.9.2 rollout evidence remains OPEN until executed.

**Reuse targets:** installer/update policy, release qualification, false-failure prevention, Project Brain.

## E071 — Linux terminal-preserving route cutover

**Date/Context:** 2026-09-25; v0.9.1 Linux live rollout after all candidate gates passed.

**Observed evidence:** the validated candidate could not promote because the active v0.8.37 backend owned persistent terminal children. The Linux updater treated any such terminal as a pre-cutover blocker. Killing those terminals would violate the project execution policy and user continuity requirement.

**Root cause:** Windows already had a retained-backend registry and terminal-aware route detachment, but Linux only had defer-or-stop drain logic.

**Prevention/Guard:** v0.9.3 adds a durable Linux retained-backend registry. After the normal candidate gates and route switch, a terminal-bearing previous backend may be detached only when routed HTTP inflight for its exact port is zero and its commit/config identity is valid. The backend process is kept alive, its release tree is protected, and later maintenance reaps it only after terminal/child/socket evidence is clear. No terminal is killed merely to finish an update.

**Regression:** retained registry and updater contracts passed 12/12 on the Windows development host and 12/12 on the Emad Linux laptop; candidate-only Linux validation of the retention branch exited 0.

**Confidence/Status:** implementation and candidate-only behavior CONFIRMED; final live route-retention evidence is a v0.9.3 rollout gate.

## E072 — Safe Linux background-browser backend

**Date/Context:** 2026-09-25; activation of all Full Power capabilities on the Emad Linux laptop.

**Observed evidence:** v0.9.1 authorized browser.background/navigation/input/screenshot in Full Power but the laptop had no Chromium backend. Playwright 1.63.0 installed, while its Chrome-for-Testing CDN returned HTTP 403 location blocking. A verified privately extracted Google Chrome package then failed its SUID sandbox requirement; Ubuntu 24.04 AppArmor had kernel.apparmor_restrict_unprivileged_userns=1, and both Chrome namespace sandbox and bubblewrap user namespaces were blocked without elevated OS policy.

**Rejected unsafe workaround:** direct --no-sandbox Chrome was not admitted as a product default.

**Prevention/Guard:** v0.9.3 keeps Chromium/CDP where already available and adds an independent Firefox + geckodriver WebDriver backend on Linux. Firefox Snap uses an owned profile under its permitted ~/snap/firefox/common namespace. Browser tools remain background-first, do not reuse the user's normal browser profile, do not extract password-store data, and retain the same foreground-approval boundary.

**Regression:** manual Firefox 156.0.1 / geckodriver 0.37.1 session, navigation, JavaScript and screenshot PASS; product-level controller E2E status/session/navigate/snapshot/Unicode fill/click/wait/screenshot/end PASS on the Emad Linux laptop. Existing Windows focused browser and updater regressions passed 31/31.

**Confidence/Status:** Linux Firefox background backend CONFIRMED on the audited laptop; cross-platform full/hosted/release gates remain separate.

**Reuse targets:** browser backend selection, Linux installer/update policy, security review, Full Power capability parity.


## E073 — direct mutation lost-ack idempotency

**Date/Context:** 2026-09-26; CSDC-007 P0 closure after the prior chat reached its conversation-length limit. Authority was recovered from GitHub and a clean dedicated worktree rather than mutating the polluted/stale main checkout.

**Claim/Decision:** Direct mutating MCP calls require a stable per-intent `requestId`. Before an effect, Commander persists only the tool name plus canonical input hash in a private SQLite mutation journal. Exact successful retries return the stored result without repeating the effect; reusing the requestId with changed tool/input fails closed; an exception after PREPARED becomes `UNCERTAIN` and never authorizes blind replay.

**Rationale / rejected alternatives:** Blindly retrying a direct mutation after a lost response can duplicate append/input/process/GUI effects. Relying only on per-path locks prevents concurrent overlap but does not solve a retry after the first effect completed. Extending transport deadlines also does not establish at-most-once semantics. The minimum sufficient control is a durable request identity plus PREPARED/SUCCEEDED/UNCERTAIN state. Power-disabled/unauthorized tools must fail authorization before journal state; command allowlist/cwd preflight must also happen before durable intent where a reusable preflight exists.

**Failure→Root Cause→Prevention:** The first patch corrupted `server-v0.3.mjs` because JavaScript replacement-string `$'` semantics consumed the suffix; it was rebuilt from exact baseline `44379b1` and all patch insertions were switched to replacement callbacks. Regression then found authorization-order changes for disabled Power tools and disallowed programs; the guard was moved behind those preflight boundaries. A repeated concurrency smoke initially reused fixed requestIds after deleting its temp target, correctly causing stale success replay; the fixture now generates a unique run prefix while retaining stable IDs within one intent.

**Evidence/Source:**
- `src/mutation-idempotency.mjs` SHA-256 `1e47fb07934d7b34091cee4000ec1a1a63528e3a24d87a2a96cf3c883b3a69c9`.
- `src/server-v0.3.mjs` post-fix SHA-256 `779e8afc0754c3ffa22bc16ff1e7dc3ae590045dc3c23b619fd080c34944d788`.
- `test/mutation-idempotency.test.mjs`; `test/mutation-idempotency-http.test.mjs`; `test/concurrency-smoke.mjs`; `test/profile-instance-http.test.mjs`; `test/http-admission.test.mjs`.
- HTTP append lost-ack/restart regression PASS; Full-Power catalog coverage confirms requestId on direct mutating file/process/terminal/browser/GUI tools.
- Final local Windows code/test tree: `npm run check` PASS; `npm test` 417 total / 411 PASS / 6 SKIP / 0 FAIL; GUI 75/75 PASS; concurrency/FS/Windows-runtime/source-integrity PASS; security audit PASS; `git diff --check` PASS.

**Confidence/Status:** CONFIRMED for local Windows code/contract/integration behavior and CSDC-007 acceptance. Cross-platform live deployment, long soak and final release remain separate open gates.

**Reuse Targets:** retry/fault-tolerance architecture, Plugin contract, release notes, operations guide, future CSDC fault-injection and multi-chat tests.

**Provenance:** branch `fix/csdc007-lost-ack`, dedicated local worktree (absolute developer path intentionally excluded from tracked evidence), baseline `44379b11d63585ccaf5305d20b9039f4d5893ef3`.


## E074 — release qualification self-test request identity

**Date/Context:** 2026-09-26; exact v0.9.4 candidate qualification after CSDC-007 introduced mandatory stable request identity for direct mutations.

**Claim/Decision:** Release qualification code is part of the mutation-contract surface. Every mutating canary used by the candidate updater or hardware self-test must carry a stable per-intent `requestId`; candidate promotion remains fail-closed until those canaries themselves pass.

**Failure→Root Cause→Prevention:** The first exact `e195f991702035220c15545ee83a77eb1c0c52d1` qualification passed repository check/test/audit and candidate doctor on both machines but stopped before promotion. Linux failed inside `tools/hardware-selftest.mjs` because its `run_shell` call used the pre-CSDC-007 contract. Windows failed in the updater's own direct `run_shell` qualification canary in `auto-update-windows.ps1` for the same reason. The first hotfix added request IDs to hardware self-test mutations and made Linux requalification reach `HARDWARE_SELFTEST_PASS` and `AUTO_UPDATE_CANDIDATE_PASS`; Windows then exposed the remaining updater-canary call. The second hotfix adds a stable candidate/profile request ID to that call. Static regressions now cover both surfaces, preventing future mutation-contract changes from silently invalidating the release canaries.

**Evidence/Source:** Linux hotfix candidate at `5cd2f50670028fcc9e32e2ec16b02ec2df4cb684` completed check/test/audit, two hardware-self-test passes, and `AUTO_UPDATE_CANDIDATE_PASS` with no promotion because qualification used `--no-promote`. Windows at the same commit again reached candidate v0.9.4/Full Power/81 tools but failed only at the remaining updater canary, isolating the second stale call. Current `auto-update-windows.ps1` SHA-256 `86e41855ca665843ceb320f722b816467ff0ec49184e93a5076ecc596b6e60b8`; current updater-contract regression SHA-256 `da3eb0d72634dc933b72bb9042b616bbe91c3c2262bdb6711af4f323b9c240fc`. Exact current tree: `npm run check` exit 0; `npm test` exit 0 (419 total / 413 pass / 6 skip / 0 fail plus downstream GUI/concurrency/runtime checks); `npm run audit` exit 0 with `SECURITY_AUDIT_PASS`; `git diff --check` exit 0; focused updater contract 12/12 PASS; updater `-SelfTest` exit 0.

**Confidence/Status:** CONFIRMED local Windows regression and Linux live no-promote qualification. Windows live no-promote requalification of the second hotfix is still required before promotion.

**Reuse Targets:** updater qualification, release checklist, mutation contract evolution, hardware canary design.

**Provenance:** branch `fix/csdc007-release-selftest`, baseline `e195f991702035220c15545ee83a77eb1c0c52d1`.
