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


## E075 — stable-router schema continuity and schema-breaking update gate

**Date/Context:** 2026-09-26; root cause follow-up after the v0.9.4 live rollout left an already-open ChatGPT host on the pre-update mutation schema.

**Claim/Decision:** Tool-list change authority belongs at the stable router, not an ephemeral backend generation. A route swap can retire the old backend while the client must keep one stable subscription endpoint. Schema-breaking hot updates are fail-closed unless refresh continuity is negotiated; strict mutation requestId safety is not weakened to mask a stale host.

**Method evidence:** Official MCP 2026-07-28 SDK documentation defines tools.listChanged, client-opened subscriptions/listen, leading notifications/subscriptions/acknowledged, and notifications/tools/list_changed as a level-trigger that instructs clients to refetch tools/list. The modern server must not send unrequested list-change notifications. This is the minimum standards-based mechanism; unsupported/legacy hosts require an explicit compatibility disposition rather than speculative push.

**Implementation:** src/stable-router.mjs now owns modern tools-list subscriptions across blue/green backend generations, augments modern server/discover with capabilities.tools.listChanged=true, publishes notifications/tools/list_changed after an atomic route generation change, and exposes bounded continuity state (toolsListSubscribers, total subscriptions, modern/legacy-seen flags, observed generation) without retaining tool arguments. tools/schema-continuity-gate.mjs hashes canonical tool name + inputSchema and blocks schema-changing promotion when continuity is unavailable, legacy traffic has been observed, or no modern tools-list subscriber is present. Windows and Linux updaters invoke the same helper before promotion.

**Evidence/Source:** Focused router/gate regression 6/6 PASS; Windows updater -SelfTest PASS. Latest exact integration validation after router-bootstrap integration: independent npm run check exit artifact = 0; independent npm test exit artifact = 0 with 432 total / 426 PASS / 6 SKIP / 0 FAIL; GUI contract 75/75 PASS; CONCURRENCY_SMOKE_PASS; FS_SAFETY_PASS; Linux GUI, Windows runtime and source integrity PASS; SECURITY_AUDIT_PASS; git diff --check PASS. Focused router/schema-continuity regression 6/6 PASS, updater/bootstrap regression 18/18 PASS, real router source replacement/rollback regression 2/2 PASS, and Windows updater -SelfTest PASS.

**Confidence/Status:** implementation and local Windows qualification CONFIRMED. Live exact-commit Windows/Linux candidate qualification and live subscription/cutover canary remain UNPROVEN; CSDC-038 therefore remains IN_PROGRESS.

**Reuse Targets:** hot-update architecture, stable router, MCP protocol compatibility, mutation safety, release gate, updater policy.

**Provenance:** integration branch finalize/rc-v094-r2, baseline live commit bc8f7baedfae4053ffb200f2a2a8f988fab951f0.


## E076 — CSDC-008 universal deferred coverage and CSDC-010 turn-safe closeout

**Date/Context:** 2026-09-26; semantic integration of the previously isolated CSDC-008 work onto the CSDC-038/Linux-fix finalization branch.

**Claim/Decision:** Recursive path mutations are the remaining direct tool family whose effect duration was intrinsically unbounded by payload/transport contracts. `copy_path`, `move_path`, and `delete_path` now auto-defer into the durable operation engine. Other process/search/browser/GUI direct tools have explicit hard deadlines; single-file and directory-list operations are size/count bounded. Transient or stalled filesystem/network-drive behavior remains a separate CSDC-024 responsibility and is not misrepresented as solved by CSDC-008.

**Implementation:** `operation_start` now accepts copy/move/delete plans. Duplicate request lookup precedes effect-dependent preflight. `prepareDeferredPowerMutation` validates authority/source/destination before reservation. Detached worker plans carry a config path/hash and re-establish canonical roots before invoking the existing transactional Power tool; durable result receipts include structured `toolResult` while raw arguments remain absent from the request/state journal. Direct server dispatch for copy/move/delete immediately enters this durable path.

**Turn-safety consequence:** The server contract advertises a maximum of six direct synchronous MCP calls per assistant turn, disallows rapid polling, declares long work as durable-background, and directs unknown-duration/substantial work to durable workflows, Project Engine, or `operation_start`. CSDC-008 removes the recorded non-command duration gap, so the Commander-side CSDC-010 acceptance is met. ChatGPT host stream availability/wake remains external under CSDC-005.

**Evidence/Source:** Combined focused integration regression 24/24 PASS; dedicated deferred coverage/HTTP/idempotency acceptance 6/6 PASS; schema-continuity test repeated ten times without the prior OS-selected bad-port flake after using a Fetch-safe deterministic range. Latest exact integration validation after router-bootstrap integration independently confirmed npm run check exit 0 and npm test exit 0 with 432 total / 426 PASS / 6 SKIP / 0 FAIL; GUI 75/75 PASS; CONCURRENCY_SMOKE_PASS; FS_SAFETY_PASS; Linux GUI, Windows runtime and source integrity PASS; SECURITY_AUDIT_PASS; git diff --check PASS.

**Failure→Root Cause→Prevention:** The first integrated full run exposed a test-only WHATWG bad-port flake because `listen(0)` could select a Fetch-prohibited port. The schema-gate test now binds a deterministic safe range with bounded EADDRINUSE retry and passed ten repeated runs. A separate one-off Windows browser-child cleanup assertion failed once in a full run; browser production source was unchanged and three complete focused reruns passed, followed by the exact full gate passing. No production browser patch was made without repeated evidence.

**Confidence/Status:** CSDC-008 and Commander-side CSDC-010 CONFIRMED on the exact integration tree. Cross-platform candidate/live rollout remains a release gate under CSDC-036/CSDC-038; storage transient policy remains CSDC-024.

**Reuse Targets:** async/deferred architecture, retry safety, chat-stream operating contract, updater/release qualification, CSDC-024 boundary.

**Provenance:** integration branch `finalize/rc-v094-r2`; baseline live commit `bc8f7baedfae4053ffb200f2a2a8f988fab951f0`; CSDC-038 integration commit `5cffe7bf7b9427edb104133780cd13aa768f3408`.


## E077 — stable-router source bootstrap before schema cutover

**Date/Context:** 2026-09-26; release-readiness audit after CSDC-038 implementation showed that an already-running stable router was reused solely because its canonical endpoint was healthy, so new schema-continuity code could be present in a candidate release while the live router process still executed old source.

**Claim/Decision:** Router source generation is part of the hot-update compatibility boundary. Candidate qualification remains read-only with respect to the live router. During promotion, a shared cross-platform bootstrap helper may replace the owned stable-router process only after verifying runtime/process/source identity and preserving exact route bytes. If both router source and tool schema change in one attempt, the updater bootstraps only the router, stops candidate backends, emits an explicit ROUTER_BOOTSTRAPPED_RETRY_REQUIRED disposition, and does not cut over the backend. A later promotion attempt may proceed only through the normal schema-continuity gate.

**Rationale / rejected alternatives:** Merely copying new stable-router source does not change the already-running router process. Restarting a router by process name or canonical port alone risks killing an unrelated listener. Continuing backend cutover immediately after first installing list-change support cannot prove that the already-open host negotiated the new subscription. Relaxing mandatory mutation requestId would hide the stale-host symptom by weakening lost-ack safety. The minimum sufficient control is ownership-checked router replacement plus rollback, exact route-state preservation, and a two-stage disposition for simultaneous router/schema changes.

**Implementation:** tools/router-source-bootstrap.mjs verifies router status SHA, runtime pid/port/state-file/source identity, process command identity, and the prior router source obtained from route.active.projectDir. It hashes exact route bytes, terminates only the owned router, starts the candidate router, verifies source SHA and route-byte immutability, and restores the exact prior router source if replacement fails. Both Windows and Linux updaters exit NoPromote before this helper can run. Promotion probes schema first, bootstraps router source, and explicitly defers backend cutover when both router source and schema changed.

**Failure→Root Cause→Prevention:** Two initial patch attempts were not promoted: one workflow tool exception applied no target-file changes; a second text-patch wrapper exited 127 because backslashes inside a generated PowerShell template were interpreted during wrapper construction. Both outcomes were independently checked by hashes/markers and reconciled as NOT_APPLIED before any retry. The implementation was then split into a shared helper plus hash-preconditioned direct file writes, eliminating duplicated Windows/Linux process mechanics and fragile patch-string escaping. The first helper regression failed only during Windows temp-directory cleanup with EBUSY after process termination; production assertions had already run. Test cleanup was changed to wait for process exit and retry directory removal; production helper was not changed for that fixture-only failure.

**Evidence/Source:** Real temp-router source replacement preserves exact route bytes; invalid candidate source rolls back to the exact prior router source: 2/2 PASS. Focused updater/schema/bootstrap tests: 18/18 PASS; Windows updater -SelfTest PASS. Latest exact tree: npm run check exit artifact 0; npm test exit artifact 0 with 432 total / 426 PASS / 6 SKIP / 0 FAIL; CONCURRENCY_SMOKE_PASS; FS_SAFETY_PASS; GUI contract 75/75; Linux GUI, Windows runtime and source integrity PASS; SECURITY_AUDIT_PASS; git diff --check exit 0.

**Confidence/Status:** CONFIRMED for local implementation, replacement/rollback semantics, and exact-tree regression. Live Windows/Linux candidate qualification, live router bootstrap, host subscription observation, and backend cutover remain separate release evidence; CSDC-038 therefore remains IN_PROGRESS.

**Reuse Targets:** stable-router lifecycle, zero-downtime updater, MCP schema continuity, release gate, rollback design, multi-platform updater policy.

**Provenance:** integration branch `finalize/rc-v094-r2`; baseline live commit `bc8f7baedfae4053ffb200f2a2a8f988fab951f0`; prior integrated commit `651926adbd22b979c41f473b49906036261823a4`.

## E076 — backward-compatible schema admission

**Date/Context:** 2026-09-26; refinement of CSDC-038 after reproducing stale host schemas in already-open ChatGPT sessions.

**Claim/Decision:** Hot-update admission distinguishes backward-compatible tool-schema extensions from breaking changes. A candidate that preserves every old tool and accepts every old valid input may promote without negotiated refresh; breaking changes still require modern tool-list refresh continuity and otherwise fail closed.

**Evidence/Source:** conservative classifier in 	ools/schema-continuity-gate.mjs; dedicated regression in 	est/schema-continuity-gate.test.mjs. Focused classifier 9/9 PASS; router/bootstrap/updater set 16/16 PASS; exact full worktree gate exit 0 with 436 tests / 430 pass / 6 skip / 0 fail, GUI 75/75, concurrency/fs/runtime/source-integrity and SECURITY_AUDIT_PASS. Isolated live Windows probe compared active c8f7ba... against candidate
63f314... and returned BACKWARD_COMPATIBLE_SCHEMA with distinct old/candidate hashes.

**Confidence/Status:** CONFIRMED for compatibility classification and current live-to-candidate disposition. Live promotion/cutover canary remains required before CSDC-038 may be PASS.

**Reuse Targets:** release admission, hot update safety, MCP schema evolution.

**Provenance:** branch
inalize/rc-v094-r2, baseline live commit c8f7baedfae4053ffb200f2a2a8f988fab951f0.


## E077 — exact live 0b965d7 cutover and post-cutover canaries

**Date/Context:** 2026-09-26; finalization integration promoted after exact Windows/Linux candidate-first qualification.

**Claim/Decision:** `0b965d7904a08a5eb04078bc61602687cf198552` is the current evidence-backed live Commander source on Windows default, Windows saeed-emad and Linux default. The promoted build includes stable-router schema continuity, conservative backward-compatible schema admission, Linux non-login `run_shell`, and CSDC-008 deferred path mutations.

**Evidence/Source:** Live route generations Windows default=53, Windows saeed-emad=90, Linux default=37 point to exact commit. Both canonical routers advertise tools.listChanged and ACK live modern subscriptions. Live deferred canaries: Windows handle latency 66 ms; Linux 39 ms; same requestId reused the exact operation; copy/move/delete completed SUCCEEDED and receipts matched. Candidate/full regression: 436 total / 430 PASS / 6 SKIP / 0 FAIL plus GUI 75/75 and security/integrity gates.

**Confidence/Status:** CONFIRMED for live source identity, CSDC-038 and CSDC-008 on both OSes.

**Reuse Targets:** release notes, CSDC register, hot-update architecture, turn-safe orchestration.

**Provenance:** branch `finalize/rc-v094-r2`; live commit `0b965d7904a08a5eb04078bc61602687cf198552`.


## E078 — tunnel-client v0.0.15 live promotion

**Date/Context:** 2026-09-26; CSDC-027 candidate-to-live rollout.

**Claim/Decision:** tunnel-client v0.0.15 promotion is CONFIRMED on Windows and Linux. Rollback artifacts remain retained while the Linux lifecycle guard is integrated.

**Evidence/Source:** Windows official ZIP SHA-256 `3b53133a1e24d43f63088d843860cb1701a4c3ed6390de2e19f69089e43bddc1`; installed binary SHA-256 `1946de55a038313a9b9b2458d05fe1719fa9cf1f20a94dd5f38fc26a98bfdd42`; upstream `a390c168ff1b2d14e73a95991c186c6aba3ff5a0`. Both Windows profiles report ready on 47832/47833, exactly two v0.0.15 processes exist, zero v0.0.14 processes remain, supervisor count=1 and old binary/pin backup are retained. Linux candidate reverified against official ZIP SHA-256 `8c836dc5d68d68b663d9a5c5b28ff9fa780d9f7a3fffb1c306880b8f32fab5f1` and binary SHA-256 `286769f6b1b1837e89896b4684a3ec59c919f860fa2bc159442e3839b6468711`. After reconnect, `chatgpt-remote-commander.service` is active, v0.0.15 is the only managed profile tunnel, readiness on 47832 is `ready`, and tunnel logs show forwarded commands.

**Confidence/Status:** Windows CONFIRMED; Linux CONFIRMED; CSDC-027 PASS.

**Reuse Targets:** tunnel qualification, release gate, rollback guide.

**Provenance:** v0.0.15 upstream tag target `a390c168ff1b2d14e73a95991c186c6aba3ff5a0`; Commander live source `0b965d7904a08a5eb04078bc61602687cf198552`.


## E079 — Linux tunnel lifecycle self-kill root cause and guard

**Date/Context:** 2026-09-26; postmortem after the first Linux v0.0.15 cutover temporarily removed the connector until the service was reconnected.

**Failure→Root Cause:** The one-off cutover runner was launched from a command executed inside `chatgpt-remote-commander.service`. It then called `systemctl --user stop chatgpt-remote-commander.service`. systemd stopped the service cgroup, which included the runner itself, so the runner was killed before its rollback handler could execute. Journal evidence shows the stop at 17:00:52 and the later service start at 17:47:42. The absence of the runner result file is consistent with self-termination before its final write.

**Post-state evidence:** After service recovery, the managed tunnel is v0.0.15 at upstream `a390c168ff1b2d14e73a95991c186c6aba3ff5a0`; readiness on port 47832 is `ready`; command forwarding through the v0.0.15 dispatcher is visible in the tunnel log. Therefore the candidate itself was not the failure.

**Prevention/Guard:** Linux tunnel lifecycle is moved into `autostart-linux.sh` profile-scoped supervision. The supervisor selects versioned candidates, refuses external profile conflicts, stops only Commander-owned profile tunnel processes, validates `/readyz`, records rejected candidate paths, and rolls back to a prior executable without stopping its own systemd service. Fresh installs delegate to one pinned helper (`tools/install-tunnel-client-linux.sh`) using exact v0.0.15 release provenance from `tools/tunnel-client-pin.json`.

**Regression:** `test/linux-tunnel-lifecycle.test.mjs` 4/4 PASS; `test/auto-update-contract.test.mjs` 13/13 PASS. Exact full tree after browser timing-test stabilization: `npm run check`, `npm test`, `npm run audit`, and `git diff --check` all exit 0; main test set 440 total / 434 pass / 6 skip / 0 fail; GUI contract 75/75 PASS; `SECURITY_AUDIT_PASS`.

**Confidence/Status:** CONFIRMED root cause and local prevention. Live deployment of this guard requires exact post-commit candidate qualification/promotion.

**Reuse Targets:** Linux autostart, tunnel upgrade lifecycle, rollback, release checklist, failure-prevention guidance.

**Provenance:** branch `finalize/rc-v094-r2`; live Commander source before guard deployment `0b965d7904a08a5eb04078bc61602687cf198552`.

## E077 — transport-to-correlation trace

**Date/Context:** 2026-09-26; CSDC-002 support-trace gap after durable operation/workflow/delivery correlation was already implemented.

**Claim/Decision:** The control-plane `X-Request-Id` forwarded by OpenAI tunnel-client is recorded as bounded `transportRequestId` on each accepted `tools/call`, alongside JSON-RPC request ID and the existing requestId/correlationId/runId/workflowId. No raw tool arguments, Authorization, shard/session headers or content are added to this trace record.

**Evidence/Source:** OpenAI tunnel-client v0.0.15 upstream processor forwards command headers unchanged to the MCP transport while logging the incoming control-plane `X-Request-Id` as `cmd_request_id`; Commander implementation is in `src/server-v0.3.mjs`. `test/transport-correlation-http.test.mjs` proves exact transport→correlation mapping and negative leakage assertions. Focused correlation + lost-ack regression: 3/3 PASS; syntax and diff-check PASS.

**Confidence/Status:** CONFIRMED implementation/regression. Live equality between a real tunnel log `cmd_request_id` and Commander audit `transportRequestId` remains required before CSDC-002 becomes PASS.

**Reuse Targets:** support tracing, incident attribution, CSDC-030 telemetry, delivery correlation.

**Provenance:** `finalize/rc-v094-r2`.

## E078 — machine-global cross-profile writer lease

**Date/Context:** 2026-09-26; CSDC-034 audit found `root_leases` was stored inside each profile-specific workflow SQLite database, so Windows default and `saeed-emad` profiles could each believe they exclusively owned the same physical project root.

**Claim/Decision:** Workflow/event/delivery databases remain profile-isolated, but project-root writer authority is now a machine-global private SQLite lease store. Candidate configs derive `durableWorkflows.rootLeaseDirectory` from the existing machine state root (`<StateRoot>/shared/root-leases`). Lease acquisition is `BEGIN IMMEDIATE` fail-closed; a crash before durable intent can only strand a bounded TTL lease, not begin an effect.

**Evidence/Source:** `src/workflow-store.mjs`, `src/workflow-tools.mjs`, `src/profile-instances.mjs`, `tools/build-candidate-config.mjs`, `test/multi-profile-concurrency.test.mjs`. Focused acceptance 35/35 PASS. Full `npm run check` completed 206 tests / 201 pass / 5 skip / 0 fail plus GUI 75/75 and platform/source gates; full `npm test` completed 447 tests / 441 pass / 6 skip / 0 fail plus concurrency/GUI/fs/runtime/source gates. Security audit current tree was clean after sanitizing the CSDC-002 synthetic authorization marker; the only history finding came from the superseded local `finalize/rc-v094-r2` ref, whose conflicting delta was preserved externally and whose remote branch was deleted.

**Confidence/Status:** CONFIRMED implementation/regression. Live two-profile same-root contention on the final exact candidate is still required before CSDC-034 may be PASS.

**Reuse Targets:** multi-account safety, scheduler ownership, one-writer invariant, release qualification.

**Provenance:** `finalize/rc-v094-r3`; superseded local-r2 evidence metadata SHA-256 `5cd0c713a8205633f165d83710a6f8368cf0eaa832278c1b164ea8caa949c53c`.


## E080 — Windows mains-power boot recovery architecture

**Date/Context:** 2026-09-27; final v0.9.4 power-loss hardening before restarting the release soak.

**Fact / pre-state:** Windows Remote Commander startup was login-dependent: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\ChatGPTRemoteCommander` launched the user-session supervisor, no Remote Commander Windows service/boot task existed, and AutoAdminLogon was disabled. Tunnel credentials were CurrentUser DPAPI blobs under the owner's LocalAppData. The current process token was medium-integrity with the Administrators SID deny-only, so installation of a SYSTEM startup task requires normal UAC elevation.

**Method choice:** Task Scheduler S4U was rejected because Microsoft documents that S4U tasks have no network access and cannot access encrypted files. AutoAdminLogon was rejected because it is unnecessary and weakens the login boundary. Selected architecture: SYSTEM AtStartup headless boot core + DPAPI LocalMachine machine-credential copies restricted by ACL to SYSTEM and Administrators + explicit owner-profile paths + safe AtLogOn handoff back to the user session.

**Implementation:** `autostart-windows.ps1` now supports BootCore, explicit owner paths, CurrentUser/LocalMachine credential scopes, explicit node/npm paths and bounded credential self-test. Helper `windows-supervisor-runtime.ps1` holds owner-path/profile/credential logic while preserving the supervisor source-size integrity envelope. `enable-boot-recovery.ps1` performs elevated machine-credential migration, ACL hardening, a temporary SYSTEM probe, and registers SYSTEM AtStartup/AtLogOn tasks. `handoff-user-session-windows.ps1` defers while active operations or root leases exist and retires only SYSTEM-owned Commander processes before verifying user-session recovery. `disable-boot-recovery.ps1` is the bounded rollback.

**Project recovery policy:** The Remote Commander skill now requires a durable workflow before the first meaningful mutation for multi-step, persistent-mutation, unknown-duration or power-loss-resumable tasks. GUI/foreground continuation remains user-session scoped; headless durable work may resume pre-login. Blind replay of uncertain mutations remains forbidden.

**Evidence/Source:** Windows live-state audit; Microsoft Task Scheduler S4U documentation; Windows DPAPI DataProtectionScope LocalMachine documentation; branch `power-recovery/v094-r2` based on live `ca97ced5b4e39ff727af83eee95b46c6c8ef52b4`; `test/windows-runtime-contract.mjs`; `test/source-integrity.mjs`.

**Confidence/Status:** Implementation CONFIRMED in source; candidate qualification PENDING after helper refactor; real post-mains-power boot remains a required external validation because no automatic reboot/shutdown/logoff is permitted.

**Reuse Targets:** installer, power-loss runbook, release gate, Project Brain, user documentation.

**Provenance:** see `docs/POWER_RECOVERY_R1.md`; exact final candidate SHA must be recorded after qualification.


## E081 — Power-recovery install postmortem and browser cleanup timing guard

**Date/Context:** 2026-09-27; exact power-recovery candidate validation.

**Failure / Root Cause 1:** The first elevated boot-recovery install exited before any task or machine credential was created. Read-only post-state showed no BootRecovery/Handoff/Probe task, no `*.machine.dpapi`, no probe result, and AutoAdminLogon unchanged. Two source defects were then reproduced: `autostart-windows.ps1` retained one pre-refactor `Get-ProfileMcpPort` call after helper extraction, and `enable-boot-recovery.ps1` incorrectly required the release-local `var` directory to pre-exist although the supervisor owns its creation.

**Prevention / Guard:** The remaining call site now uses `Get-RcProfileMcpPort`; the installer creates its runtime `var` directory before the SYSTEM probe. `test/windows-runtime-contract.mjs` now fails if stale pre-refactor profile helper calls remain or if the installer stops creating the probe directory.

**Failure / Root Cause 2:** A later Windows full gate produced one failure in the unchanged `browser-process.test.mjs` cleanup assertion. The test allowed only 2–2.5 seconds after helper exit, while the Windows cleanup implementation may synchronously spend up to 6 seconds discovering profile-owned processes and up to 6 seconds in `taskkill /T /F`. The browser source/test blob was identical to the previously qualified `ca97ced5` baseline and the same test had passed earlier, so this was a timing-test defect rather than a power-recovery behavior regression.

**Method Evidence:** Node.js documents that synchronous child-process APIs block until the child exits or the configured timeout is reached. Test cleanup polling is now capped at 15 seconds, exceeding the implementation's bounded worst-case without increasing production cleanup timeouts.

**Confidence/Status:** Root causes CONFIRMED. Corrected final candidate requires full Windows + Linux requalification before promotion/install.

**Reuse Targets:** release qualification, failure-prevention guide, power-recovery runbook, CI reliability.

**Provenance:** `autostart-windows.ps1`, `enable-boot-recovery.ps1`, `test/windows-runtime-contract.mjs`, `test/browser-process.test.mjs`; failed elevated-install post-state and candidate gate receipts from 2026-09-27.


## E082 — Chat stream resilience and retained terminal pressure

**Date/Context:** 2026-09-27; repeated ChatGPT errors including `ChatGPT stream recovery polling timed out` and `Resume stream unavailable` while several chats were used concurrently.

**External evidence / method:** OpenAI Help Center documents that ChatGPT uses secure WebSocket traffic over TCP 443, including `wss://ws.chatgpt.com`, and warns that proxies, TLS inspection, web filtering, idle timeouts, or frame/message policies can stall or prematurely close long-lived WebSocket sessions. OpenAI troubleshooting also lists transient server-side problems as a possible cause. Recent OpenAI community reports describe the same `Resume stream unavailable` pattern on long responses; these are corroborating user reports, not an official incident declaration.

**Local network evidence:** Windows WinHTTP is direct, the user proxy is disabled (`ProxyEnable=0`), and DNS/TCP 443 tests to both `ws.chatgpt.com` and `chatgpt.com` pass. A stale proxy endpoint remains stored in `ProxyServer` but is inactive. No DNS/firewall/proxy mutation is justified by current evidence.

**Local pressure root cause:** Audit found ten concurrent Remote Commander MCP backend listeners and roughly one hundred PowerShell processes. `retained-backends.json` showed eight non-route historical backends retained because `start_terminal(command=...)` had left interactive `pwsh.exe -NoLogo -NoProfile` shells sitting at a prompt. `src/stable-router.mjs` sends normal MCP traffic only to `state.active.port` and has no terminal-ID affinity to retired backends; therefore prompt-idle terminals on detached backends are not reachable through the canonical connector.

**Immediate cleanup evidence:** retained backends were queried directly with read-only `read_terminal`. Prompt-idle sessions were distinguished from no-prompt, multiline, or still-running states. Legacy v0.9.1 idle sessions were stopped after two prompt confirmations. Newer backends correctly required stable mutation `requestId`; a later long cleanup call hit its synchronous deadline, so its result was treated as uncertain and reconciled rather than blindly replayed. Canonical default and `saeed-emad` health remained PASS throughout.

**Prevention / decision:** `start_terminal` now defaults to one-shot when `command` is supplied: the shell process exits with the command and does not stay at a prompt. Persistent behavior with an initial command requires explicit `interactive=true`; a terminal without a command remains interactive. `send_terminal` rejects one-shot sessions. The Remote Commander skill prohibits using interactive terminals as a substitute for detached/background execution and requires explicit cleanup after genuine interactive use. Chat-stream guidance is tightened from six to three direct synchronous Commander calls per assistant turn; longer/unknown work must use detached/durable execution and compact receipts.

**Confidence/Status:** Platform-side resume availability for a specific failed ChatGPT turn remains EXTERNAL/UNVERIFIED. The local terminal-retention defect is CONFIRMED by process tree, retained-state, router behavior, and terminal buffers. Prevention implementation is CANDIDATE until cross-platform qualification and live promotion.

**Reuse Targets:** stream/retry runbook, multi-chat operating policy, terminal lifecycle tests, release qualification, Project Brain.

**Provenance:** `src/power-tools-v0.3.mjs`, `src/server-v0.3.mjs`, `plugin-template/skills/remote-commander/SKILL.md`, `src/stable-router.mjs`, local `retained-backends.json`; OpenAI Help Center network/troubleshooting documentation reviewed 2026-09-27.


## E083 — Final branch authority reconciliation before v0.9.4 closeout

**Date/Context:** 2026-09-27; closeout after repeated ChatGPT stream-recovery failures and parallel development.

**Authority audit:** Windows default, Windows `saeed-emad`, and Linux canonical routes were all observed on exact commit `87ed15912591131e3cc3130692677d97db0ef028`, the head of `stream-resilience/v094-r1`. GitHub `main` was not authoritative: it diverged by five commits while the stream-resilience branch carried the current v0.9.4 implementation.

**Main-only content audit:** The five main-only commits reduce to two logical changes. The Linux non-login-shell fix (`bash -c`) and its `LOGIN_SHELL_REGRESSION_PASS` test were already present in the v0.9.4 candidate. The Linux-first Remote Commander skill section was not present and is therefore merged into the current skill without removing the newer background-first, terminal one-shot, or three-direct-call stream-safety rules.

**Open gates at this record:** Windows BootRecovery and UserSessionHandoff scheduled tasks were absent and require installation plus SYSTEM probe. Six historical retained backends were still recorded/listening and require lifecycle cleanup using the current one-shot-terminal implementation. Exact Windows/Linux qualification and GitHub main reconciliation remain required before FINAL.

**Confidence/Status:** Facts CONFIRMED by live routes, GitHub compare/fetch, and Windows read-only state audit. FINAL remains UNPROVEN until the open gates above are closed.

**Reuse Targets:** release closeout, Project Brain, installer/runbook, stream-resilience guidance.


## E082 — Linux Firefox updater false-negative probe

**Date/Context:** 2026-09-27; final cross-device parity audit on live v0.9.4.

**Failure / Root Cause:** Linux updater logged `BROWSER_BACKEND_UNAVAILABLE authorized=true reason=no-safe-local-browser-backend` even though Firefox remained configured. Read-only host evidence showed `firefox=/usr/bin/firefox` and an executable `/snap/bin/geckodriver`, while `command -v geckodriver` returned no PATH result. The runtime Firefox helper already checks `/snap/bin/geckodriver` and `/usr/bin/geckodriver`, but `auto-update-linux.sh` only checked PATH. This created an updater false negative and could omit browser configuration on a fresh candidate.

**Fix / Prevention:** Linux updater now prefers PATH and then checks explicit executable fallbacks `/snap/bin/geckodriver`, `/usr/bin/geckodriver`, `/usr/local/bin/geckodriver`, and `$HOME/.local/bin/geckodriver`. The auto-update contract test requires these fallbacks so updater detection stays aligned with the runtime browser helper.

**Confidence/Status:** Root cause CONFIRMED; exact candidate requires Windows/Linux qualification before promotion.

**Reuse Targets:** Linux install/update guide, parity matrix, release evidence.


## 2026-09-27 — v0.9.6 Chat-Closeout, Cross-Platform Stable Release, and Agent Benchmark

**Date/Context:** 2026-09-27 finalization after repeated ChatGPT host/UI errors including `Resume stream unavailable` and `Stream cache expired`, missing visible end-of-task chat closeouts, real mains-outage recovery evidence, and cross-platform lifecycle cleanup.

**Stream root-cause split / Confirmed:** Two independent layers remain. (1) ChatGPT host/UI streams can expire outside Commander authority. (2) Commander previously completed durable work but could leave results in `COMPLETED_UNDELIVERED` when the initiating chat turn died. The second layer is now corrected for discoverability; the first remains host-external.

**v0.9.6 prevention / Confirmed:** `system_status` now exposes a bounded metadata-only `completionBeacon` from the durable delivery store without changing the tool schema, so a chat with a cached older MCP tool catalog can discover pending completion/blocker records on its next surviving status call. Artifact contents, raw arguments and secrets are not inlined. Server/Skill contracts require interrupted/long-task continuations to inspect pending closeouts before unrelated work and require every execution turn to visibly close as COMPLETED/BACKGROUND/BLOCKED/WAITING/FAILED. Exact result access remains correlation-scoped.

**Live backward-compatibility evidence / Confirmed:** The existing chat session, whose visible MCP catalog did not expose the newer `delivery_*` tools, successfully received `completionBeacon` through the pre-existing `system_status` tool on live Linux v0.9.6. This proves the fallback does not require host tool-list refresh. `hostWakeAvailable=false` remains explicit: no unsupported claim of autonomously waking a dead ChatGPT conversation is made.

**Release authority / Confirmed:** Immutable public Stable release `v0.9.6` was published at exact runtime commit `4be0ebcd7a30b412de31e2b40f75dc3c504ec8ce` on 2026-09-27. Windows default and `saeed-emad` routes are both v0.9.6 at this commit with `previous=null`; Windows control checkout is clean at the same commit. Linux route and control checkout are also exact `4be0...`, `previous=null`, user service enabled/active, and `linger=yes`. Both Stable-channel canaries returned `AUTO_UPDATE_CURRENT version=0.9.6`.

**Qualification / Confirmed:** Current source passed focused delivery/stream/HTTP regressions, Windows updater/retained-work regressions, stable-router tests, Security Audit, clean full `npm test` (451 PASS, 6 SKIP, 0 FAIL), GUI contract 75/75, Linux GUI contract, Windows runtime contract and source-integrity checks. Exact production Windows updater subsequently recorded `GATE_PASS check`, `GATE_PASS test`, `GATE_PASS audit`, GUI native self-test PASS, schema-continuity `UNCHANGED_SCHEMA` for default+saeed, and `AUTO_UPDATE_PASS version=0.9.6 commit=4be0...`. Linux exact updater likewise passed check/test/audit, Firefox/geckodriver hardware backend, schema continuity and cutover/maintenance.

**Long-work update safety / Confirmed:** Windows updater gained a narrow retained-backend admission for old non-cancellable `tools/call` `run_shell/run_project_command` workloads: one direct old-backend-owned `pwsh -NonInteractive` root per matching inflight request, older than 60 s, no mixed inflight kinds, with stable recheck. Production-shaped router regression proves an already-started upstream request remains bound to its old backend and drains to real completion after route generation changes. A live canary initially exposed a parameter-recheck bug; fail-closed behavior preserved the scientific workload, the bug was repaired and regression-locked. During final rollout, the earlier scientific workload completed naturally; a later COMSOL process tree remained alive through the v0.9.6 current-main rollout and was not terminated for cleanup.

**Windows boot authority / Confirmed:** After Stable publication, official stable-root `enable-boot-recovery.ps1 -NoStart` was run elevated. Result SHA-256 `5e6606541303a7c22314185665c90f0629fab592739da24f59c5f453f90de286`: `ok=true`, two LocalMachine credentials verified, `systemProbe=true`, no AutoAdminLogon requirement, no plaintext credential, no reboot, no task start. `ChatGPTRemoteCommander-BootRecovery` and `ChatGPTRemoteCommander-UserSessionHandoff` are Ready, SYSTEM/ServiceAccount, and their actions point to stable `%LOCALAPPDATA%\ChatGPTRemoteCommander\app\autostart-windows.ps1` and `handoff-user-session-windows.ps1`.

**Linux recovery / Confirmed implementation, real-reboot validation open:** `linger=yes`; Commander user service is enabled/active. Supervisor checks tunnel-client control-plane freshness using `commands_poll_last_successful_timestamp_seconds` rather than treating local `/readyz` as proof of upstream connectivity, and recycles only when a network route is present. The earlier outage did not reboot the laptop, so a genuine post-fix Linux boot remains environmental validation rather than an implementation blocker.

**Capability state / Confirmed:** Windows and Linux live `system_status` report v0.9.6 FULL_POWER, `disabledCapabilities=[]`, with full filesystem/permanent delete, unrestricted shell, process control, persistent terminal, background browser, native GUI backend, auto/zero-downtime update, durable/reconcilable workflows, scheduler, Project Brain, Project Engine, checkpoint/crash recovery and execution-profile persistence. Direct sync-call budget remains 3 and long work mode is durable-background.

**Benchmark / Decision:** `docs/AGENT_CAPABILITY_BENCHMARK_20260927.md` compares Commander with ChatGPT Work, OpenAI Codex/Agents, GitHub Copilot Agents, Claude Code, Cursor Background Agents, Kiro, Devin, Cline, OpenHands, Gemini CLI and Aider using primary documentation. No superiority ranking is asserted. Commander’s distinctive verified strengths are physical-host breadth, power/lifecycle recovery, evidence-first durable mutation/reconciliation and zero-downtime routing. Broader native cloud fleets, SaaS marketplaces, product-native issue/PR UX and host wake should be integrated through Plugins/MCP/cloud providers rather than reimplemented without evidence.

**Acceptance boundary / Open:** The software implementation/release is CURRENT and qualified. The following are intentionally not called PASS without future evidence: next genuine Windows mains-return on the corrected stable-root path, genuine Linux reboot/power-return, cumulative 24–48 h soak, remaining full fault-injection/multi-chat matrix, and native host wake/push (external unless ChatGPT negotiates a supported task/subscription mechanism). These are environmental/time/external gates, not incomplete hidden code work.

**Reuse Targets:** stream/retry runbook, release checklist, power-recovery runbook, cross-platform parity, agent-platform strategy, Project Brain, final user closeout.

**Provenance:** GitHub release/tag v0.9.6 and commit 4be0ebcd7a30b412de31e2b40f75dc3c504ec8ce; live Windows/Linux routes/system_status/update logs; Windows elevated boot-rebind result; Linux systemd/loginctl state; benchmark primary sources listed in `docs/AGENT_CAPABILITY_BENCHMARK_20260927.md`.


## E-STREAM-20260927-R2 — Host stream symptom and bounded-reconciliation root cause

- Date/Context: 2026-09-27; repeated ChatGPT conversations can display `Our systems are thinking a bit more about this request before responding.` and later lose the response stream with `Resume stream unavailable`-class or other interruption errors.
- Fact / Confirmed as observed: the UI symptom occurs across chats. It is not by itself proof that Remote Commander caused the host stream termination.
- Internal finding / Confirmed: v0.9.8 durable operation delivery reconciliation rediscovered all historical operation directories every five seconds. Already-published terminal operations were repeatedly reprocessed; receipt adoption could rewrite `state.json` without a new effect/result.
- Root Cause → Prevention → Guard → Regression: periodic full-history rediscovery → one startup discovery plus live tracked set → retain failed/unresolved deliveries and never auto-ack/purge/cross-correlate → second reconciliation must check zero historical terminal operations and leave state-file mtime unchanged.
- Validation so far: focused async/HTTP/correlation suite PASS 14/14 after the fix. v0.9.8 exact baseline separately passed check/test/audit/doctor before mutation.
- Boundary: ChatGPT host response-stream expiry and native wake/push remain external unless the host exposes a supported capability. Commander acceptance is durable result survival, idempotent no-duplicate effect, bounded reconciliation, and retrievable correlation-scoped results.
- Status/Confidence: Internal reconciliation defect CONFIRMED/high; causal contribution to the ChatGPT UI stream failure PROBABLE-UNVERIFIED until correlated host evidence exists.
- Reuse Targets: release 0.9.9, stream resilience, incident response, durable delivery design, performance/load testing.


## E-STREAM-20260927-R3 — Exact recovery of all-zero historical operation projections

- Date/Context: 2026-09-27; continuation of the stream/durable-delivery audit after v0.9.9 promotion.
- Fact / Confirmed: Windows default operation storage contained 22 historical `state.json` files whose byte content was entirely NUL. Counts: bad=22, valid terminal receipt=22, request mapping=22, exact receipt/reservation inputHash pair=22, correlation present=22, all-zero=22.
- Fact / Confirmed: the 22 invalid projections explain the remaining `deliveryIntegration.tracked=22`: the reconciliation catch path removed and immediately re-added unreadable operations indefinitely.
- Unknown: the original cause of the NUL overwrite is UNVERIFIED; no storage/power/process cause is asserted.
- Decision: do not delete or blindly overwrite historical state. Recover only from exact request reservation + terminal final receipt, preserve corrupt bytes as content-addressed evidence, and never replay the external effect.
- Guard: mismatched inputHash/correlation/operation evidence does not repair and does not publish a delivery.
- Regression: focused async/HTTP/correlation suite PASS 16/16. Positive corrupt-projection recovery and mismatch fail-closed cases are included.
- Real-data validation: on a temporary copy of the 22 production-corrupt operations and reservation files, recovery produced copied=22, repaired=22, backups=22, invalid=0, tracked=0, events=22. Live operation storage was not modified by this validation.
- Related stream finding: two long-lived pre-v0.9.9 synchronous `run_shell` requests remain on a detached v0.9.8 backend because they own real external jobs; v0.9.9 live guard rejects >15 s synchronous calls before effect. Causality from these historical requests to ChatGPT UI `Resume stream unavailable` remains PROBABLE-UNVERIFIED.
- Reuse Targets: durable delivery, crash/power recovery, stream resilience, release 0.9.10, incident runbook.


## E-DRAIN-20260927-R1 — Windows retire output contamination
- Date/Context: 2026-09-27, post-promotion reconciliation of immutable v0.9.10.
- Fact / Confirmed: default route safely retired v0.9.9 and reached previous=null, but the first hidden reconcile emitted `AUTO_UPDATE_DRAIN_PENDING profiles={"ok":true,"retired":true,"generation":94}`. The next maintenance cycle correctly reached `CURRENT`.
- Root Cause / Confirmed: PowerShell function `Retire-PreviousRoute` invoked `tools/router-retire.mjs` without suppressing its diagnostic JSON stdout. Because PowerShell functions return pipeline output, `Complete-DeferredDrains` interpreted that JSON string as a pending-profile item.
- Risk: transient false DRAIN_PENDING status only; cutover, route generation, old-backend stop, and workload safety were independently verified correct.
- Prevention/Guard: pipe router-retire diagnostic stdout to `Out-Null` while retaining `$LASTEXITCODE` enforcement; contract regression requires suppression.
- Release decision: do not mint a new release solely for this self-correcting status artifact. Fix is committed on main for the next substantive release; immutable v0.9.10 remains the current live release.
- Reuse Targets: updater status correctness, zero-downtime drain reconciliation, release diagnostics.


## E-NOCODEX-20260927-R1 — ChatGPT-first execution invariant after live R28 quota incident

**Date/Context:** 2026-09-27; live audit of `D:\\uni\\PhD\\electromagnetic generator free energy` R28 background execution.

**Fact / Confirmed:** The R28 wrapper launched the Commander-private Codex CLI 0.156.1 from `%LOCALAPPDATA%\\ChatGPTRemoteCommander\\tools\\codex-cli\\...`. The exact live Codex session reported `Logged in using ChatGPT`, `plan_type=plus`, no API-key environment, no purchased credit balance, and substantial token usage. This proved that Commander-mediated background execution had shifted reasoning consumption from the current ChatGPT conversation into Codex/agentic allowance.

**Root Cause / Confirmed:** Historical v0.9.0+ Full Power policy auto-provisioned a private Codex provider and Project Engine runner. Separately, authorized script execution had no product-level prohibition against a project script spawning Codex. Full Power machine authority was therefore incorrectly coupled to model-provider availability.

**Decision:** Remote Commander is ChatGPT-first. Commander never launches Codex. If ChatGPT recommends Work/Codex, it must obtain an explicit current-chat choice between **Move to Work/Codex** and **Continue in this chat with Remote Commander**. Default is continue-chat. A Work/Codex selection is an external product handoff; it does not create Commander-side Codex launch authority.

**Prevention:** remove Codex bootstrap from Windows/Linux install/update; disable legacy `provider=codex`; block direct/package-manager/script-mediated Codex launches; strip model credentials from Commander child environments; expose only read-only handoff-requirement/status policy; embed the rule in MCP operating instructions and Plugin Skill.

**Guard / Regression:** `test/no-codex-policy.test.mjs`, `test/project-runner-config.test.mjs`, `test/project-planner.test.mjs`, installer/onboarding/update contract tests. Focused policy/planner/runner suite PASS 33/33; installer/onboarding PASS; updater contract PASS 13/13 before full release qualification.

**Scope:** Independent user-owned Codex Desktop processes/installations are outside Commander and are not terminated or removed. Only Commander-private provider state is retired.

**Confidence/Status:** Root cause CONFIRMED. v0.9.11 release/promotion remains pending full qualification at this record.

**Reuse Targets:** Commander architecture, Plugin Skill, install/update policy, Project Engine, quota/cost prevention, incident runbook.


## E-CONVERSATION-20260928-R1 — Native same-conversation durable continuation

**Date/Context:** 2026-09-28; audit of the electromagnetic-generator project handoff PoC plus official workflow/UI Automation benchmarks.

**Claim/Decision:** Remote Commander should support event-driven continuation of the same already-open ChatGPT conversation for long-running/background work, without launching Codex, opening a new chat tab, using clipboard/mouse takeover, or converting Commander into a model runner.

**Project Evidence:** The project PoC demonstrated a successful one-shot semantic UIA send to the existing ChatGPT tab. The permanent Python/ctypes supervisor path later suffered an access-violation failure, so that implementation is not promoted.

**External Evidence:** Azure Durable Task/Durable Functions documents checkpointed long-running orchestrations, external-event wake-up, and at-least-once delivery requiring event IDs/deduplication. AWS Step Functions documents wait-for-callback task-token orchestration. Temporal documents idempotent task/operation handlers for durable retry. Microsoft UI Automation documents use of a separate MTA thread for desktop-wide UIA clients plus SelectionItemPattern/ValuePattern/InvokePattern control actions.

**Sources:**
- https://learn.microsoft.com/en-us/azure/durable-task/common/durable-task-orchestrations
- https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events
- https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html
- https://docs.temporal.io/tasks
- https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading
- https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue
- https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.selectionitempattern.select
- https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.invokepattern.invoke

**Architecture:** Private SQLite outbox/binding authority; stable eventKey deduplication; QUEUED/CLAIMED/DEFERRED/SENT/UNCERTAIN delivery states; explicit resolution for UNCERTAIN; detached-operation terminal callback; restart-only bounded reconciliation; workflow NEEDS_CHAT atomic pause + evidence + Brain sync; exact-tab semantic UIA through hidden MTA pwsh helper; fixed Commander-owned anti-injection envelope.

**Rejected Options:** fixed polling loop as the primary mechanism; browser extension as a required dependency; OCR/mouse/keyboard takeover; Python/ctypes permanent bridge; duplicate project-state authority; automatic uncertain-send retry; new-tab fallback; Codex/API execution.

**Confidence/Status:** Architecture HIGH confidence; implementation candidate tests are passing in the feature worktree. Release/live validation remains OPEN.

**Reuse Targets:** Remote Commander architecture, durable workflows, async operations, Project Brain/Handoff, long-run project execution, power/network/stream recovery.


## E-AUTOMATION-20260928-R1 — MCP Tasks + same-conversation continuation integration

**Date/Context:** 2026-09-28; integration of the parallel MCP Tasks change set with the independently qualified Native Same-Conversation Continuation feature.

**Fact / Confirmed:** MCP Tasks and same-conversation continuation are complementary. Tasks preserve durable operation identity across host/client stream restart; conversation continuation provides a durable event-to-reasoning callback into the exact already-open ChatGPT conversation.

**Integration defect found / fixed:** the parallel MCP Tasks change set referenced `operation_status.waitMs` in instructions/tests but did not implement it in the async-operation schema/runtime. Integration added a maximum-5-second bounded follow window. Initial Windows `fs.watch` on an 8.3 temp-path alias triggered a libuv `fs-event.c` assertion; canonicalizing the operation directory with `realpath` before watching prevents that crash. This is now regression-covered.

**Decision:** primary automation remains event-driven. MCP task polling is sparse host recovery/status access, not the project execution loop. Same-conversation delivery is driven by durable terminal/NEEDS_CHAT events and idempotent outbox state.

**Security/Cost boundary:** Commander does not launch Codex/Work/API models. Project-supplied handoff fields are untrusted hints. UIA does not read browser credentials/session data and does not open a new ChatGPT tab.

**Status:** integrated candidate; focused contracts PASS. Full integrated release gates remain OPEN.

**Reuse Targets:** stream-loss recovery, long-run project execution, power/network recovery, Remote Commander product architecture, Project Brain/Handoff.


## E-AUTOMATION-20260928-R2 — Post-v0.9.13 durable automation standards audit

**Date/Context:** 2026-09-28; post-release audit of v0.9.13 against current durable-workflow, MCP Tasks, callback, retry/idempotency, and Windows UI Automation guidance.

**Claim/Decision:** v0.9.13's architecture is retained: ChatGPT remains the reasoning layer; Commander executes durable local work; long operations return immediately; terminal/NEEDS_CHAT events persist to an idempotent outbox and may resume the same already-open conversation. No second reasoning agent, Codex runner, browser extension, OCR loop, or duplicate project-state authority is justified by the evidence.

**External Evidence/Source:** MCP Tasks Extension SEP-2663 (Final) requires durable task creation before returning a task handle, uses `tasks/get/update/cancel`, requires `-32602` for unknown `tasks/get` IDs and recommends it for update/cancel; Azure Durable external events are at-least-once and recommend event-ID deduplication; AWS Step Functions documents run-job and callback/task-token patterns; Temporal requires idempotent operation/task handlers under retries; Microsoft UI Automation recommends a separate MTA thread for desktop-wide UIA. Sources: `https://tasks.extensions.modelcontextprotocol.io/seps/2663-tasks-extension`; `https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-external-events`; `https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html`; `https://docs.temporal.io/tasks`; `https://learn.microsoft.com/windows/win32/winauto/uiauto-threading`.

**Project Evidence / Confirmed:** v0.9.13 is live on Windows default, Windows saeed-emad, and Linux default at `f7aa867e28765d40772b953f31fbff93cbaa77fc`. Runtime status reports `automaticExecution=false`, `runnerConfigured=false`, same-conversation continuation schema=1, and delegation policy `commanderMayLaunchCodex=false`. The native continuation feature candidate passed Windows full check/test/audit, Linux exact-tree check/test, and hosted Windows/Ubuntu CI on the exact feature SHA before integration.

**Defect / Confirmed:** v0.9.13 mapped an unknown but syntactically valid MCP task ID through generic `operation not found` handling, yielding generic RPC error instead of the spec-required/recommended `-32602 Invalid params` task-not-found response.

**Root Cause → Prevention → Guard → Regression:** operation-store exception leaked across the protocol adapter → narrow task-operation adapter maps only `operation not found` to `-32602` → no broad exception rewriting and no task lifecycle changes → focused regression checks unknown `tasks/get`, `tasks/update`, and `tasks/cancel`.

**Rejected Options:** adding a new orchestration service, permanent browser bridge, task-expiry policy for same-conversation callbacks, mandatory task notifications, faster polling, or any model runner. These add complexity without evidence of better outcomes for the observed risks.

**Confidence/Status:** Architecture CONFIRMED/HIGH. v0.9.14 compliance patch focused test PASS; full release qualification pending.

**Reuse Targets:** durable automation architecture, stream/retry resilience, MCP Tasks compatibility, same-conversation callbacks, Project Brain, release checklist.

**Provenance:** main v0.9.13 commit `f7aa867e28765d40772b953f31fbff93cbaa77fc`; live route/system_status evidence; `src/server-v0.3.mjs`; `test/mcp-tasks-extension.test.mjs`; official sources above.


## E-AUTOMATION-20260928-R3 — v0.9.14 Windows qualification checkpoint

**Date/Context:** 2026-09-28; clean dedicated worktree `finalize/v0.9.14-r1` based on `5116163` after v0.9.13 production audit.

**Claim/Decision:** The MCP Tasks unknown-task error mapping patch is locally qualified on Windows and does not justify any additional orchestration control.

**Evidence/Source:** Focused `node --test test/mcp-tasks-extension.test.mjs` PASS 1/1; durable background `npm run check` operation `aebde577-6687-4857-a561-7ec0ddeb9bca` SUCCEEDED with exit 0; durable background `npm test` operation `45082011-094b-4f85-99b0-5b6e1c818548` SUCCEEDED with exit 0; `npm run audit` exit 0 and `SECURITY_AUDIT_PASS`.

**Confidence/Status:** CONFIRMED/HIGH for Windows local qualification. Hosted CI, immutable publication and production rollout remain OPEN.

**Reuse Targets:** release qualification, MCP Tasks compliance, stream-safe release workflow.

**Provenance:** `src/server-v0.3.mjs`, `test/mcp-tasks-extension.test.mjs`, commit `5116163`, local durable operation receipts listed above.


## E-AUTH-20260928-R1 — Explicit owner authorization + TinyFish capability audit

**Date/Context:** 2026-09-28; live Windows v0.9.13/v0.9.14-line audit after an explicitly authorized foreground action still produced `GUI_TAKEOVER_NOT_AUTHORIZED`, plus a user report that Codex was explicitly allowed but locally blocked.

**Claim/Decision:** Preserve safe defaults, but allow narrow persisted owner opt-ins for trusted Full-Power profiles. Do not make GUI takeover or Codex launch globally permissive.

**Evidence/Source:** Live `system_status` confirms `FULL_POWER`, `explicitlyAuthorized=true`, all GUI capabilities granted, but default GUI session mode observe. Live server `tools/list` includes `mode` and `explicitUserAuthorization` for `gui_session_begin`; the active ChatGPT-side tool schema exposes only `ttlSeconds`, proving a stale-host-schema compatibility gap. Source audit confirms hard-coded `CODEX_DELEGATION_FORBIDDEN`. Connected TinyFish tool catalog confirms hosted search/fetch plus browser automation runs with browser profiles, optional vault, stealth/proxy, webhooks, structured output and capture controls.

**Root Cause → Prevention → Guard → Regression:** stale connector schema cannot serialize modern GUI authorization → persisted owner fallback for omitted mode → require Full-Power + explicit authorization + opt-in flag, while Standard remains observe-only → focused GUI tests. Absolute Codex block ignores explicit owner intent → default-deny configurable policy → require Full-Power + explicit authorization + `codexControl.allowLaunch=true` → focused Codex tests.

**Failure/Regression:** First focused authorization run operation `5bb9e558-ead5-44af-84a8-5ec4c0117020` FAIL 103/104 because takeover worked but response omitted authorization provenance. Narrow response fix applied. Second focused run operation `324137b3-6641-4c92-8ef8-8112ff658983` PASS 104/104, exit 0.

**Rejected Options:** globally defaulting GUI to takeover; accepting any Full-Power flag without explicit profile authority; globally enabling Codex; embedding TinyFish-style hosted proxy/vault/search infrastructure into Commander. These add risk/complexity without necessity.

**Confidence/Status:** Root causes CONFIRMED/HIGH; focused implementation regression PASS; full release qualification OPEN.

**Reuse Targets:** GUI authorization, stale schema compatibility, Codex delegation, capability policy, competitive architecture, release documentation.

**Provenance:** live runtime `system_status` and live MCP `tools/list`; `src/gui-tools-windows.mjs`, `src/no-codex-policy.mjs`, `src/capability-profile.mjs`, focused operation receipts above; TinyFish connected tool catalog.


## E-AUTH-20260928-R2 — v0.9.15 Windows full qualification

**Date/Context:** 2026-09-28; same clean v0.9.15 authorization worktree after focused PASS.

**Failure/Root Cause:** First full `npm run check` operation `f75eb1e0-7ba3-4928-b1d1-6899837983d7` failed one process-tree regression because internal `capture()` referenced `ctx`, which is not in its scope. This was introduced by the Codex environment policy wiring.

**Prevention/Guard:** Pass `allowCodex` explicitly from `prepareShellCommand()` through the prepared command into `capture()`; do not let low-level process helpers reach upward for authorization context. Targeted process-tree + GUI + Codex + capability suite PASS 109/109.

**Full Evidence:** `npm run check` operation `75d71f03-da21-4b05-92b3-75c3e5594e4b` SUCCEEDED exit 0. `npm test` operation `83494e4f-3ec1-4924-bba5-c0473fae5657` SUCCEEDED exit 0. `npm run audit` exit 0 with `SECURITY_AUDIT_PASS`.

**Confidence/Status:** Windows candidate qualification CONFIRMED/HIGH. Hosted exact-SHA CI, immutable integration/tag, installer/update acceptance and production rollout remain OPEN.

**Reuse Targets:** authorization wiring, process lifecycle, release regression, failure-prevention guidance.


## E-AUTH-20260928-R3 — Hosted Windows async test race during v0.9.15 qualification

**Date/Context:** 2026-09-28; PR #36 exact head `3a5c49c63cf33a75cad003ebb7872704dd7eb037`, GitHub Actions run `36393301881`.

**Observed Evidence:** Ubuntu job passed. Windows `npm run check` passed, then `npm test` failed exactly one test: `corrupt terminal projection is not repaired when receipt and reservation hashes differ` at `test/async-operations.test.mjs:407`, assertion `1 !== 0`. All authorization/Codex/GUI tests passed. The failure occurred after `waitFor()` observed a terminal operation state but before the detached worker process was guaranteed to have exited.

**Root Cause → Prevention → Guard:** terminal state and final worker-process exit are distinct events on Windows; the regression intentionally corrupts durable projection/receipt files and could race the tail of worker cleanup → wait for the exact recorded `workerPid` to become nonexistent before deliberate test corruption → bounded 10-second PID-exit wait used only by the two corrupt-projection tests. No production retry, sleep, delivery, or authorization semantics changed.

**Regression:** `test/async-operations.test.mjs` executed 10 consecutive times with the fix on Windows: **140/140 PASS**, no skips/failures, terminal `term-27`, final exit 0. `git diff --check` PASS.

**Confidence/Status:** Root cause CONFIRMED/HIGH for the hosted failure family. Full exact-tree regression and renewed hosted exact-SHA CI remain OPEN.

**Reuse Targets:** Windows CI stability, async durability tests, corrupt-projection recovery, release qualification.

**Post-fix Full Gate:** exact-tree Windows `npm run check && npm test && npm run audit` completed in terminal `term-28` with final exit 0; test core runner reported 475 PASS / 6 SKIP / 0 FAIL and security audit reported `SECURITY_AUDIT_PASS`.


## E-AUTH-20260928-R4 — Cross-platform async child-exit/stdio test stabilization

**Date/Context:** 2026-09-28; after v0.9.15 authorization candidate qualification. A second meaningful async-lifecycle CI failure occurred on Ubuntu in the docs-only PR #37: `child exit completes operation even when inherited stdio delays close` reached `TIMED_OUT` instead of `SUCCEEDED`.

**Project Evidence / Failure:** Earlier Windows hosted CI had exposed a distinct worker-exit timing race in deliberate corruption tests. The later Ubuntu failure lasted about 10.2 s and matched the fixture grandchild's 10 s lifetime, showing that the fixture itself did not reliably force the direct child to exit before inherited stdio closed on that platform.

**Method Evidence:** Node.js child_process documentation distinguishes `exit` from `close`: `exit` occurs when the child ends while stdio may still be open; `close` occurs only after stdio is closed and may be delayed when multiple processes share streams. Node also documents that detached background children should not keep parent-connected stdio when independent lifetime is required. Sources checked 2026-09-28: https://nodejs.org/download/release/latest-jod/docs/api/child_process.html and https://nodejs.org/api/child_process.html.

**Root Cause → Prevention → Guard → Regression:** OS-sensitive fixture relied on a detached Node grandchild with inherited stdout/stderr plus natural parent event-loop exit → make the direct fixture process explicitly exit only after its own stdout write callback fires, while the detached grandchild continues holding inherited descriptors → no production worker/runtime code changed → focused Windows `node --test test/async-operations.test.mjs` PASS 14/14, exit 0. Hosted Ubuntu exact-SHA CI remains the cross-platform promotion gate.

**Confidence/Status:** Root cause PROBABLE/HIGH from timing match, official event semantics, and focused regression. Cross-platform confirmation pending hosted CI.

**Reuse Targets:** async operation durability tests, child-process lifecycle testing, CI failure prevention, v0.9.16 release gate.


## E-AUTH-20260928-R5 — Authorized Codex inherited no-Codex sentinel

**Date/Context:** 2026-09-28; live Windows v0.9.15 after successful stale-schema GUI authorization rollout on both `default` and `saeed-emad`.

**Confirmed live result:** The actual cached ChatGPT connector schema, which exposes only `gui_session_begin({ttlSeconds})`, returned `mode=takeover` and `authorization=owner-persisted` on the v0.9.15 default backend. Both Windows profiles also reported `commanderMayLaunchCodex=true` and delegation policy `owner-authorized-local-launch`.

**Failure:** Authorized `codex --version` found the installed Codex executable, exited 0 and reported `codex-cli 0.146.0`, but emitted a warning that `CODEX_HOME` pointed to Commander's generated `chatgpt-remote-commander-no-codex` temporary path.

**Root Cause → Prevention → Guard → Regression:** v0.9.15 removed the no-Codex boolean sentinel for authorized child processes but preserved an inherited Commander-generated `CODEX_HOME` → recognize only paths inside Commander's generated no-Codex root and remove that stale value when Codex is authorized → preserve all legitimate user `CODEX_HOME` values → focused regression checks both sentinel removal and owner home preservation.

**Instruction audit:** Current plugin/tool guidance still contained unconditional statements that Commander never launches Codex, contradicting the v0.9.15 live policy. Current operational text is updated to default-deny + explicit Full-Power owner authorization. Historical release records and the hidden/background project-runner No-Codex invariant remain unchanged.

**Confidence/Status:** Root cause CONFIRMED/HIGH from live executable output and source inspection. v0.9.16 candidate qualification pending.

**Reuse Targets:** Codex authorization, child-process environment hygiene, plugin instructions, updater inheritance, release acceptance.

**Provenance:** live v0.9.15 `system_status`, direct stale-schema GUI canary, `rc_codex_canary_v0915.ps1`, `src/no-codex-policy.mjs`, `plugin-template/skills/remote-commander/SKILL.md`.


## E-AUTH-20260928-R6 — v0.9.16 Windows full qualification

**Date/Context:** 2026-09-28; v0.9.16 candidate worktree after authorized-Codex sentinel cleanup, current-instruction alignment, and cross-platform async fixture stabilization.

**Evidence:** Focused Codex-policy + async suite PASS 22/22. Installer check PASS. Onboarding/plugin check PASS. Full Windows gate terminal `term-17` completed with exit 0: `npm run check` PASS; `npm test` PASS with core runner 475 PASS / 6 SKIP / 0 FAIL plus downstream browser, GUI, concurrency, filesystem, runtime and schema gates; `npm run audit` PASS with `SECURITY_AUDIT_PASS`.

**Key regression:** authorized child environment removes only Commander's generated no-Codex `CODEX_HOME` sentinel while preserving a legitimate owner-specified `CODEX_HOME`. Hidden project-runner No-Codex tests remain PASS.

**Confidence/Status:** Windows local candidate qualification CONFIRMED/HIGH. Hosted exact-SHA Windows/Ubuntu CI, immutable publication and production rollout remain OPEN.

**Reuse Targets:** v0.9.16 release qualification, Codex authorization, environment inheritance, async lifecycle testing.

**Provenance:** `term-17`; `src/no-codex-policy.mjs`; `test/no-codex-policy.test.mjs`; `test/async-operation-fixture.mjs`; `docs/RELEASE_0.9.16.md`.


## E-AUTH-20260928-R6 — v0.9.16 full Windows qualification

**Date/Context:** 2026-09-28; v0.9.16 owner-authorized Codex environment candidate after focused regressions.

**Focused regressions:** `test/no-codex-policy.test.mjs` + `test/async-operations.test.mjs` completed 22/22 PASS. Installer and onboarding checks also PASS.

**Full Windows exact-tree gate:** PowerShell 7 gate script executed `npm run check`, `npm test`, and `npm run audit` sequentially with strict exit-code propagation. Final terminal `term-17` exited 0. Full test runner reported 475 PASS / 6 SKIP / 0 FAIL; GUI contract reported 77/77 PASS; source integrity and Windows runtime contract PASS.

**Status:** Windows qualification CONFIRMED. Cross-platform promotion remains UNPROVEN until clean Linux and hosted exact-SHA Windows/Ubuntu CI pass.

**Reuse Targets:** v0.9.16 release qualification, owner-authorized Codex, async lifecycle stabilization, installer/onboarding consistency.

**Provenance:** dedicated v0.9.16 Windows qualification worktree; terminal `term-17`, exit 0.


## E-AUTH-20260928-R7 — Codex home and status-metadata semantics

**Date/Context:** 2026-09-28; final v0.9.16 pre-release audit.

**Method evidence:** OpenAI Codex maintainers document `CODEX_HOME` as the supported way to select a different independent Codex home directory; Codex configuration/auth/session data can therefore legitimately depend on this environment value. Primary-source references: https://github.com/openai/codex/issues/7971 and https://github.com/openai/codex/issues/15410.

**Decision:** Authorized Commander launches must preserve a legitimate owner `CODEX_HOME`; only Commander's own generated `chatgpt-remote-commander-no-codex` sentinel may be removed. Status metadata is renamed to `CODEX_DELEGATION_DEFAULT_DENY` while the blocked-attempt error remains `CODEX_DELEGATION_FORBIDDEN`.

**Regression:** Focused `test/no-codex-policy.test.mjs` PASS 8/8 after the status-metadata change. Full exact-candidate local and hosted qualification remain release gates.

**Confidence/Status:** CONFIRMED/HIGH for method choice and focused behavior.

**Reuse Targets:** Codex home preservation, authorization diagnostics, user-facing status interpretation, v0.9.16 release.


## E-AUTH-20260928-R7 — v0.9.16 clean Linux qualification

**Date/Context:** 2026-09-28; detached clean Linux worktree at exact candidate SHA `32b85b8`.

**Environment:** `/home/aliemad/source/repos/ChatGPTRemoteCommander-v0916-ci`, detached from `origin/fix/v0.9.16-codex-env`; the user's dirty Linux development tree was not modified.

**Gate:** `npm run check` → `npm test` → `npm run audit` under `set -euo pipefail`.

**Result:** exit 0; installer check PASS on Linux; async exit/stdio regression PASS; full test runner 480 PASS / 1 SKIP / 0 FAIL; GUI contract 77/77 PASS; concurrency smoke PASS; source integrity PASS; `SECURITY_AUDIT_PASS`; final marker `V0916_FULL_LINUX_PASS`.

**Status:** Clean Linux qualification CONFIRMED for `32b85b8`. Hosted exact-SHA Windows/Ubuntu CI remains the promotion gate.

**Reuse Targets:** v0.9.16 release qualification, Linux installer, server deployment confidence, cross-platform async stabilization.

**Provenance:** Linux terminal `term-1`, exact worktree SHA `32b85b8`, exit 0.


## E-AUTH-20260928-R8 — Hosted security-audit provenance-path failure

**Date/Context:** 2026-09-28; PR #38 hosted CI on the first evidence-bearing v0.9.16 candidate.

**Failure:** Ubuntu hosted `check` and full `test` passed, but `npm run audit` failed. The audit reported exactly one class of finding: a developer-specific absolute Windows checkout path recorded as provenance in `docs/PROJECT_KNOWLEDGE_EVIDENCE.md`, which also appeared in candidate Git history.

**Root Cause → Prevention → Guard → Regression:** evidence recording embedded an unnecessary machine/user-specific absolute checkout path → provenance records now use role + commit/SHA rather than personal checkout paths unless a path is technically necessary → keep the existing security audit's CURRENT + HISTORY developer-path checks strict; do not weaken or exempt evidence files → the unmerged evidence commit was sanitized before integration, local security audit PASS, and focused Codex policy regression PASS 8/8.

**Decision:** Since the offending commit was an unmerged/unreleased candidate, rewriting that candidate evidence commit was preferable to weakening the audit or permanently retaining developer identity/path metadata.

**Confidence/Status:** Root cause CONFIRMED/HIGH. Renewed exact-SHA hosted CI remains the promotion gate.

**Reuse Targets:** Project Knowledge provenance hygiene, security audit, release qualification, account-transfer-ready Brain.


## E-AUTH-20260928-R9 — current Codex guidance consistency

**Date/Context:** 2026-09-28; final v0.9.16 current-text audit after policy implementation and focused regression.

**Finding:** Two current surfaces still carried the superseded absolute statement that Commander never launches Codex: the top-level README and the runtime operating-instruction string. That contradicted the already-qualified v0.9.15/v0.9.16 policy where local Codex launch is default-deny but may be explicitly authorized for a trusted Full-Power owner request.

**Decision / Guard:** Align only current operational guidance. Hidden/background project runners remain No-Codex; external Work/Codex handoff still requires an explicit current-chat choice; local launch remains permitted only when the current request explicitly asks for Codex and runtime policy reports owner authorization. Historical release records are not rewritten.

**Evidence:** `README.md`; `src/server-v0.3.mjs`; focused no-Codex regression previously PASS 8/8; security audit PASS after the policy/status correction.

**Confidence/Status:** CONFIRMED/HIGH.

**Reuse Targets:** user guidance, runtime operating instructions, Codex authorization semantics, release notes.


## E-INSTALL-20260928-R1 — raw Windows Server + Linux server bootstrap

**Date/Context:** 2026-09-28; v0.9.16 deployment hardening for fresh servers where WinGet, Git, Node.js, PowerShell 7, desktop GUI, or distribution prerequisites may be absent.

**Method evidence:** Microsoft documents MSI as a supported PowerShell-on-Windows deployment path and PowerShell 7 support on Windows Server 2016/2019/2022. PowerShell 7.6 is the current LTS line. Node.js lists Windows x64 >= Windows 10 / Server 2016 as Tier 1. Microsoft Defender guidance states that each custom exclusion reduces protection and should be used sparingly; Windows Server 2016+ already receives built-in/automatic server-role exclusions. Primary sources: https://learn.microsoft.com/powershell/scripting/install/install-powershell-on-windows ; https://learn.microsoft.com/powershell/scripting/whats-new/migrating-from-windows-powershell-51-to-powershell-7 ; https://learn.microsoft.com/powershell/scripting/install/powershell-support-lifecycle ; https://github.com/nodejs/node/blob/main/BUILDING.md ; https://nodejs.org/download/release/latest-jod/ ; https://learn.microsoft.com/defender-endpoint/microsoft-defender-antivirus-exclusions-overview ; https://learn.microsoft.com/defender-endpoint/microsoft-defender-antivirus-exclusions-windows-server .

**Decision:** Add thin server bootstrap wrappers instead of duplicating the product installer. Windows bootstrap starts from built-in Windows PowerShell, does not depend on WinGet, installs only missing prerequisites, verifies PowerShell MSI with pinned upstream SHA-256 + Authenticode, verifies Node 22.23.3 MSI against upstream SHASUMS256 + Authenticode, verifies Git for Windows using official release-asset SHA-256 digest + Authenticode, resolves the requested Commander ref to one exact commit, then hands off to the normal candidate-first installer. Linux bootstrap supports apt/dnf/yum/zypper/pacman, resolves one exact commit, then hands off to install.sh.

**Server policy:** Full Power is the server wrapper default because this package is for owner-managed Remote Commander servers. GUI capabilities are automatically disabled on Windows Server Core and by default on Linux servers. Windows desktop/server-with-GUI can opt in; Linux desktop can opt in explicitly.

**Security decision:** Do not add Microsoft Defender/EDR exclusions automatically. Generate a local allowlist-evidence manifest with source commit, hashes, signer metadata and Defender state. If enterprise controls block a verified artifact, prefer administrator-managed publisher/signature or exact-hash allow rules. Broad path/process exclusions are rejected because they create a protection gap and are unnecessary for normal installation.

**Validation:** Windows installer parser/static gate PASS; onboarding/plugin check PASS; security audit PASS. Linux overlay: bash syntax PASS, installer-check PASS, focused HTTP/lifecycle suite 7/7 PASS, security audit PASS.

**Confidence/Status:** IMPLEMENTATION CONFIRMED/HIGH for static/cross-platform qualification. Fresh-VM destructive installation canary remains OPEN until release-candidate CI is green and a disposable clean server target is available.

**Reuse Targets:** Windows Server deployment, Linux server deployment, enterprise allowlisting, installation troubleshooting, release packaging.


## E-CI-20260928-R1 — Windows hosted temp-lifecycle hardening

**Date/Context:** 2026-09-28; GitHub Actions run `36406635441` on v0.9.16 candidate `762e309`.

**Observed evidence:** Ubuntu hosted `check`, `test`, and `audit` all passed. Windows `check` passed but `npm test` reported four failures: three `EBUSY: resource busy or locked, rmdir ...\\server` failures during test teardown, plus one isolated workflow fixture health-start timeout at the existing 15-second deadline. The failing tests exercise isolated copied servers; no production assertion failed.

**Root Cause → Prevention → Guard:** two affected teardown paths killed the isolated child and waited only for `exit`, then immediately removed its temp tree with no Windows retry policy → wait for child `close` (stdio lifecycle complete) and use the repository's existing bounded `fs.rm(..., {maxRetries:20,retryDelay:50})` Windows cleanup pattern. The workflow fixture already waits for `close`; its only failure was startup under hosted parallel load, so the fixture-only readiness budget is raised from 15 to 30 seconds. No product server timeout, retry, idempotency, workflow, or mutation semantics changed.

**Regression:** Affected Windows files executed together for five consecutive rounds: 35/35 PASS, no skips/failures. Installer static gate PASS and security audit PASS after the same working-tree changes. Linux overlay of the same affected tests: 7/7 PASS; installer gate and security audit PASS.

**Confidence/Status:** CI root cause CONFIRMED/HIGH. Full exact-tree and renewed hosted exact-SHA CI remain promotion gates.

**Reuse Targets:** Windows test process lifecycle, isolated-server fixtures, CI reliability, cleanup guidance.


## E-QUAL-20260928-R1 — final combined Windows local gate

**Date/Context:** 2026-09-28; combined v0.9.16 candidate after current-guidance alignment, raw-server bootstrap, and Windows hosted fixture lifecycle hardening.

**Gate:** full `npm run check` → `npm test` → `npm run audit` with strict exit propagation.

**Result:** exit 0; final marker `V0916_FINAL_FULL_WINDOWS_PASS`. Installer and onboarding checks PASS; `npm test` core runner reported 475 PASS / 6 SKIP / 0 FAIL; GUI contract 77/77 PASS; concurrency, filesystem safety, Windows runtime contract, source integrity and schema-continuity gates PASS; `SECURITY_AUDIT_PASS`.

**Status:** Windows local combined candidate qualification CONFIRMED/HIGH. Because this evidence record itself changes the candidate commit, the evidence-bearing exact SHA still requires the final qualification/hosted gates before promotion.

**Reuse Targets:** v0.9.16 final release gate, server installer qualification, Windows CI stabilization.


## E-REL-20260928-R2 — immutable release asset publication failure and v0.9.17 prevention

**Date/Context:** 2026-09-28; post-publication audit of v0.9.16 after exact-SHA Windows/Linux/hosted qualification and live rollout.

**Observed evidence:** v0.9.16 was published as an immutable GitHub Release with no attached assets. A direct post-publication upload attempt returned HTTP 422. Current Work/plugin installers resolve `releases/latest/download/plugin-template.zip`, so a latest release without that asset breaks the documented install path even though the source tree itself is healthy.

**Method evidence:** GitHub documents that immutable releases lock release assets after publication and recommends draft -> attach assets -> publish. Current GitHub CLI documentation states that `gh release create <tag> <files...>` internally creates a draft, uploads the assets, then publishes when release immutability is enabled. Sources checked 2026-09-28: https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases and https://cli.github.com/manual/gh_release_create .

**Root Cause -> Prevention -> Guard:** Release Sync created the release with notes only and therefore crossed the immutability boundary before assets existed -> build all assets and checksums first, then pass the complete asset array to the single `gh release create` operation -> static contract forbids `gh release upload` in the release workflow and requires an exact 15-file asset set plus checksum verification before publication.

**Scope decision:** do not delete/recreate or weaken v0.9.16 immutability. Repair packaging in patch release v0.9.17; runtime logic remains unchanged apart from the version identifier.

**Confidence/Status:** Root cause CONFIRMED/HIGH. v0.9.17 implementation in progress; publication/download acceptance OPEN.

**Reuse Targets:** immutable GitHub releases, release asset integrity, Work/plugin onboarding, server installer distribution, supply-chain release process.

**Provenance:** v0.9.16 release asset inventory, rejected post-publication asset upload, `.github/workflows/release-sync.yml`, `install-work-plugin.ps1/.sh`.


## E-REL-20260928-R3 — v0.9.17 release-asset count guard correction

**Date/Context:** 2026-09-28; first clean Linux execution of the new release-asset builder at candidate `d94ad841be3740212ed28ce7c096d4c6741c9afd`.

**Observed evidence:** every intended payload built successfully and both installer-internal and top-level SHA-256 verification passed. The builder then exited 1 only because its final count guard expected 16 files while the actual complete set is 15: 14 payload assets plus `SHA256SUMS.txt`.

**Root Cause -> Prevention -> Guard:** manual cardinality miscount in the newly introduced gate -> correct builder, workflow and static contract to exact count 15 -> retain explicit filename/content checks plus checksum verification, so the count guard supplements rather than substitutes for asset identity/integrity checks.

**Scope:** packaging/test/documentation only; no runtime source or policy change after the already-PASS d94ad84 Windows full gate.

**Confidence/Status:** CONFIRMED/HIGH. Final exact-SHA Linux/Windows/hosted qualification pending the corrected commit.

**Reuse Targets:** release packaging, immutable assets, failure-prevention gate design.


## E-OPS-20260928-R4 — visible PowerShell root cause and headless enforcement

**Date/Context:** 2026-09-28; owner reported PowerShell windows surfacing during Commander/project work despite the project-level headless rule.

**Observed evidence:** primary runtime execution paths use hidden/no-window launch semantics, but Windows qualification helpers in `test/gui-native-run.mjs`, `test/profile-reconfigure-windows-parser.test.mjs`, `test/windows-runtime-contract.mjs`, and the installer parser helper spawned `pwsh.exe` without `windowsHide:true`. These helpers execute during candidate qualification and can surface console windows even though production child execution is hidden.

**Root Cause -> Prevention -> Guard:** headless policy existed in project instructions but was not enforced across all Windows child-process launch sites -> harden remaining PowerShell test/helper spawns -> add a Windows runtime regression gate covering audited pwsh child launch paths.

**Policy decision:** background/headless is the default for project execution. Visible console/terminal windows are forbidden as a progress surface. Only the actual task UI or an explicit official progress/UI surface may be foregrounded.

**Confidence/Status:** root cause CONFIRMED/HIGH for qualification-time PowerShell flashes; final regression qualification pending v0.9.18 gates.

## E-EXT-20260928-R5 — Skill-aware external Agent Extension routing

**Date/Context:** 2026-09-28; owner required Commander to use project Skills automatically when the task is relevant, while keeping extensions separate from Commander Core and excluding the private film-making extension.

**Authoritative architecture:** domain Skills/Agents remain external packages under `~/.agents/extensions`; Commander Core owns validation, discovery, policy intersection, relevance routing and skill retrieval only. Core installer/release assets do not bundle those domain packages.

**Implemented contract delta:** add read-only `agent_extension_route(task)` and `agent_extension_skill(id)`. Routing uses manifest-declared triggers/domain metadata; skill retrieval is bounded, validated, and SHA-256 identified. No extension execution authority is added.

**External packages selected for this rollout:** `ansys-modeling`, `project-execution-brain`, `final-thesis-report`. `video-trend` is explicitly excluded by owner instruction. COMSOL standalone Skill was not found in the current authoritative local Skill catalog, status MISSING/UNVERIFIED.

**Reuse Targets:** domain agent routing, separate extension lifecycle, Skill selection, least-authority integration.


## E-EXT-20260928-R6 — official project Skill catalog and routing specificity

**Date/Context:** 2026-09-28; post-v0.9.18 external Extension acceptance and rollout.

**Project-truth correction:** a narrow filename/source search found the authoritative COMSOL Skill that the earlier local installed-skill scan missed: `COMSOLModelingSkill`, clean `main`, tag `v1.1.1`, commit `bd51db0`, plus final archive `COMSOLModelingSkill_v1.1.1_FINAL.zip` with SHA-256 `5abc90bec1197fde81f44804816c674f9c4281287f31af6604b2ee73f03d13c6`. The earlier R5 COMSOL=MISSING observation is therefore superseded for current state, not erased historically.

**Official external set:** `ansys-modeling` v1.1.1; `comsol-modeling` v1.1.1; `project-execution-brain` current installed project version; `final-thesis-report` v1.0.0. `video-trend` remains owner-private and excluded from the official catalog/rollout. Packages are installed separately under each host's external Extension root and are not bundled in Commander release assets.

**Cross-host acceptance:** v0.9.18 live on Windows, Linux, and HPC Windows. Linux and HPC each discover four official extensions with zero invalid diagnostics; the primary Windows host discovers those four plus the owner's private `video-trend`.

**Routing failure found:** explicit COMSOL acceptance returned COMSOL first but also a weak ANSYS lexical candidate because shared generic terms matched. This is not acceptable for automatic Skill selection.

**Root Cause -> Prevention -> Guard:** lexical fallback remained active even when explicit trigger evidence existed -> explicit trigger dominance; lexical-only candidates are suppressed whenever any trigger matches -> regression fixture requires COMSOL task to return COMSOL only. Multiword trigger matching is also token-complete rather than substring-only so project-method Skills can layer with domain Skills. Focused Agent Extension regression 13/13 PASS.

**Confidence/Status:** implementation CONFIRMED/HIGH; v0.9.19 full release gates OPEN.

**Reuse Targets:** Skill auto-routing, domain/project-method composition, false-positive prevention, external Extension lifecycle.


## E-SRV-20260928-R7 — disposable fresh-server canary and Linux Python prerequisite defect

**Date/Context:** 2026-09-28; closure audit of the long-open fresh-server installation gate after v0.9.19 release and live rollout.

**Authoritative canary provenance:** temporary GitHub branch commit `efdfb5a40cfa04d77e636151df076dbdbeb5a847`; workflow run `36437156497`. The temporary branch exists only to exercise immutable v0.9.19 release assets without modifying main or live targets.

**Windows Server fact — CONFIRMED/HIGH:** job `108977912241` on Windows Server 2022 completed successfully. Node.js and Git were removed from PATH before the published server bootstrap ran. The bootstrap downloaded/verified Node.js 22.23.3 and Git for Windows, installed exact commit `e04cff5a4985f905afe08a6b4a791baadc54bc46`, emitted `SERVER_INSTALL_WINDOWS_PASS` and `WINDOWS_DISPOSABLE_SERVER_CANARY_PASS`, reported no reboot requirement, and explicitly reported that no antivirus exclusions were added.

**Linux fact — CONFIRMED/HIGH:** job `108977911768` ran the published v0.9.19 Linux server bootstrap inside a clean Ubuntu 24.04 container. OS prerequisites, exact source fetch, portable Node 22.23.3 and the pinned tunnel client succeeded. Qualification then failed in `test/installer-check.mjs` because `python3` was absent.

**Root Cause -> Prevention -> Guard -> Regression:** Linux fresh-server package lists omitted Python 3 although the product's own qualification parses `tools/gui-control-linux.py` using Python 3 -> install Python 3 on supported package-manager families and require `python3` before qualification -> static installer contract plus a permanent disposable `Server Install Canary` workflow for Windows Server and clean Ubuntu -> v0.9.20 candidate must pass both system canaries before promotion.

**Security decision:** do not weaken qualification by skipping the Python check on headless servers. Python is a real supported runtime/tool dependency in the product and installing it is the simpler, more faithful fix. Do not add Defender/AV exclusions; keep Windows bootstrap verification and allowlisting evidence.

**Confidence/Status:** root cause CONFIRMED/HIGH; v0.9.20 implementation present, full candidate qualification OPEN.

**Reuse Targets:** raw-server installer, dependency completeness, release gating, immutable deployment, failure-prevention.


## E-SRV-20260928-R8 — headless Linux qualification must not require GNOME runtime

**Date/Context:** 2026-09-28; permanent Server Install Canary run `36443138568` on first v0.9.20 candidate `be89ce9c75ee0e998e03c649171cd9a0cc9a6255`.

**Observed evidence:** after Python 3 was added, the clean Ubuntu 24.04 container progressed through OS bootstrap, source fetch, portable Node, tunnel-client, installer static checks, 248 Node tests and the GUI schema/controller contract. It then failed when `test/linux-gui-contract.mjs` launched `tools/gui-control-linux.py --self-test` and Python raised `ModuleNotFoundError: No module named 'gi'`.

**Root Cause:** the product's full Linux GUI integration qualification was unconditional on Linux, even when `server-install-linux.sh` explicitly disabled all GUI capabilities for a headless server. The failure therefore mixed two distinct validation populations: headless server installation and GNOME desktop integration.

**Method choice:** installing PyGObject/GNOME packages on every headless server would add desktop dependencies with no runtime benefit. The minimum-sufficient control is to retain all static/schema/source GUI checks for headless validation while skipping only the native GNOME helper probe. Normal Linux CI and `--enable-gui` installations continue to require and execute the native GUI probe.

**Prevention/Guard:** `server-install-linux.sh` scopes `REMOTE_COMMANDER_HEADLESS_VALIDATE=1` only to its child installer when GUI is disabled. `test/linux-gui-contract.mjs` honors that explicit mode only for the native Linux block and emits a distinct headless-static PASS marker. Installer contract tests require this wiring.

**Candidate status:** `be89ce9c75ee0e998e03c649171cd9a0cc9a6255` is REJECTED/SUPERSEDED for promotion despite Windows and Linux local full gates passing, because the disposable clean-server gate failed.

**Confidence/Status:** root cause CONFIRMED/HIGH; corrected v0.9.20 candidate not yet frozen.

**Reuse Targets:** headless server qualification, GUI dependency boundaries, proportional release gating, clean-install canaries.


## E-CI-20260928-R9 — third child-exit/stdio qualification failure; deterministic ready-handshake

**Date/Context:** 2026-09-28; v0.9.20 corrected fresh-server candidate `d620ce96e48da818df0801e708d5ea788cbea8d9`, PR #44, hosted CI run `36443869681`, Ubuntu job `109001004378`.

**Observed evidence:** Windows hosted CI passed; Windows and Linux local exact-SHA full gates passed; disposable Windows/Linux server canaries passed. Hosted Ubuntu failed exactly one pre-existing async test, `child exit completes operation even when inherited stdio delays close`: operation status was `TIMED_OUT` rather than `SUCCEEDED`, with ~10.1 s test duration. This is the same named failure family recorded in E-AUTH-20260928-R4 after PR #37.

**Historical audit:** original production bug E065 was fixed by using direct-child `exit` as completion evidence plus a bounded 2 s stdio drain. A later fixture fix at commit `611d9866d63c52fde564aabc5bda87d0e4c688a3` forced the direct fixture process to exit after its stdout write callback. Timing hardening at `6e7ab6719d83e4bac8302e80d53e8aca86860ac7` only expanded the outer polling window; the operation itself still had an 8 s wall-clock timeout beginning before the fixture had necessarily received CPU on a loaded hosted runner.

**Method evidence:** Node.js v22 child_process documentation states that `exit` is emitted after the child process ends even though stdio may still be open, while `close` occurs only after child stdio closes and can be delayed because multiple processes share the same streams. Node also documents that detached children with parent-connected stdio remain attached through those descriptors. Sources checked 2026-09-28: https://nodejs.org/download/release/latest-jod/docs/api/child_process.html and https://nodejs.org/api/child_process.html.

**Root Cause -> Prevention -> Guard:** the regression test conflated two clocks: (1) hosted scheduling/startup latency before the direct fixture process actually established the inherited-stdio condition and (2) the intended post-exit bounded-drain invariant. Repeatedly raising an arbitrary operation timeout would not isolate the invariant -> fixture now writes a ready marker only after the detached grandchild with inherited stdio is created; the test allows a generous operation wall-clock timeout for scheduling, waits for that ready marker, then requires terminal completion within a bounded post-ready window shorter than the grandchild's stdio hold time. A runtime regression that waits for `close` still fails, while unrelated CI startup latency no longer consumes the assertion budget.

**Scope:** test/evidence only. No async worker/runtime code, timeout semantics, receipt semantics, or user execution authority changed.

**Candidate status:** `d620ce96e48da818df0801e708d5ea788cbea8d9` is REJECTED/SUPERSEDED for promotion because hosted Ubuntu CI failed, despite the fresh-server objective itself passing both disposable canaries.

**Focused regression:** Windows `node --test test/async-operations.test.mjs` executed 10 consecutive times after the ready-handshake change: **140/140 PASS**, terminal exit 0. The inherited-stdio regression itself completed consistently at roughly 2.1–2.3 s after the fixture condition was established; the tenth overall suite run slowed materially but the targeted invariant remained bounded and passed. The exact same committed source (`ec1df954ee5e15fa4b9cbddbc5e8c61969beaf31`) then executed 10 consecutive times on Linux: **140/140 PASS**, terminal exit 0; the targeted invariant completed at roughly 2.07–2.11 s. Combined focused stress: **280/280 PASS**.

**Confidence/Status:** root cause and deterministic-test prevention CONFIRMED/HIGH from repeated historical evidence, official Node event semantics, and 10× Windows + 10× Linux focused stress. Renewed full exact-SHA local/hosted qualification remains required on the final documentation-complete SHA.

**Reuse Targets:** async lifecycle CI, inherited-stdio regression design, release qualification, failure-prevention.


## E-REL-20260928-R10 — v0.9.20 final qualification, immutable publication, and live rollout

**Date/Context:** 2026-09-28; final closure after repeated host-stream interruption.

**Release truth:** qualified candidate `674990c743fc996d84d0b0c4e008f0255078e44c` was merged as `cbbc6dc19f63a87e651a8f1af9f429aa7b6a5063`. Candidate-vs-merge comparison contained no file differences. Annotated tag `v0.9.20` points to the merge commit.

**Exact-SHA qualification — CONFIRMED/HIGH:** Linux exact-SHA check/test/audit and release-asset build/checksum PASS. Hosted CI run `36445899951` completed Windows and Ubuntu check/test/audit successfully. Permanent Server Install Canary run `36445899940` completed both Windows Server bootstrap and clean Ubuntu container bootstrap successfully. Windows local exact-SHA full gate initially observed one non-reproduced conversation-fixture startup exit while multiple qualification workloads were concurrent; the focused test then passed 10/10 in isolation, hosted Windows passed, and a subsequent clean full Windows exact-SHA check/test/audit rerun emitted `V0920_WINDOWS_FINAL_EXACT_SHA_PASS`. No runtime patch was inferred from the one non-reproduced occurrence.

**Immutable publication — CONFIRMED/HIGH:** Release Sync run `36447207822` succeeded. Published release id `398403065` reports immutable=true. Re-downloaded release contained 15 assets; all 14 payload entries in `SHA256SUMS.txt` matched; the stable latest `plugin-template.zip` download matched SHA-256 `81b5874bec785e2d7d209f54ac2564f2e588a1118ff9c06884ceb129903a265d`.

**Live rollout — CONFIRMED/HIGH:** candidate-first rollout completed on the primary Windows default profile, Windows `saeed-emad`, Linux target, and audited HPC Windows target. Final route records all show active version `0.9.20`, exact commit `cbbc6dc19f63a87e651a8f1af9f429aa7b6a5063`, and `previous=null`. No forced kill was needed to retire the primary Windows previous route; it drained/retired naturally.

**External Extension acceptance — CONFIRMED/HIGH:** official Skill content remained separately installed and unchanged by the Commander rollout. Live v0.9.20 routing on Windows/Linux/HPC returned: COMSOL task -> `comsol-modeling` only; ANSYS audit/continue -> `ansys-modeling` + `project-execution-brain`; Persian final thesis request -> `final-thesis-report` only; diagnostics empty.

**Security/operations:** headless/no-window PowerShell invariant retained. Windows server canary proves Node/Git bootstrap with no antivirus exclusions. HPC durable delivery remains clean at closure; unrelated historical workflow/delivery records on other profiles are not release blockers and are not mass-deleted.

**Decision:** v0.9.20 is **SCOPED FINAL / ACCEPTED** for the current release objective. Broader superiority claims, external host-stream guarantees, unrelated project workflow cleanup, and future provider/integration work remain outside this acceptance.

**Reuse Targets:** release qualification, fresh-server installer, immutable publication, live rollout, Agent Extension routing, failure-prevention, project handoff.


## E-MAINT-20260928-R11 — post-release GitHub Actions pin closure

**Date/Context:** 2026-09-28; final repository hygiene after v0.9.20 production acceptance.

**Finding:** open PRs #3/#4 and superseded closure PR #43 carried current GitHub Actions pins while main still used older v4 commits. Hosted runs emitted the GitHub warning that Node.js 20-targeting action revisions were being forced onto Node.js 24.

**Decision:** port only the action-pin maintenance onto the current v0.9.20 closure branch instead of merging stale v0.9.19 documentation. Update all current workflow call sites, including the newly added permanent Server Install Canary.

**Pins:** `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) and `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (v7.0.0).

**Scope:** repository CI/release infrastructure only. No v0.9.20 runtime/release bytes change; the immutable tag remains authoritative for production.

**Status:** implementation present on closure branch; PR CI must pass before merge. After merge, Dependabot PRs #3/#4 and stale PR #43 are superseded.


## E-CI-20260928-R12 — Windows hosted fixture startup budget under Actions v7

**Date/Context:** 2026-09-28; post-release closure PR #45 after refreshing GitHub Actions pins to checkout v7.0.1/setup-node v7.0.0.

**Observed evidence:** Ubuntu CI passed. Windows CI run `36450036292` failed two HTTP fixture tests while runtime source was unchanged from accepted v0.9.20. Both failures occurred before any behavior assertion because copied fixture servers did not become healthy within their local startup loops. `mcp-conformance.test.mjs` allowed 100×25 ms (2.5 s); `mutation-idempotency-http.test.mjs` also allowed 100×25 ms. The latter stderr contained only the SQLite experimental warning, not a product initialization error.

**Historical family audit:** several HTTP fixture tests still used 2.5–5 s process-start budgets while hardened fixtures already allow approximately 10 s or a 30 s deadline. Hosted qualification runs test files concurrently, so process scheduling/startup latency is not the invariant these tests intend to measure.

**Root Cause -> Prevention -> Guard:** inconsistent short fixture-server readiness budgets allowed host scheduling latency to fail unrelated HTTP behavior tests -> normalize copied/local fixture health waits to approximately 10 s without changing product runtime deadlines -> run the affected fixture suite repeatedly on Windows and require renewed hosted Windows/Ubuntu CI PASS.

**Scope:** test infrastructure only. No Commander runtime, transport, installer, release bytes, authority, timeout semantics, or user-visible behavior changed.

**Focused regression:** affected fixture suite executed three consecutive times on Windows: 36/36 PASS, terminal marker `V0920_FIXTURE_STARTUP_STRESS_PASS`, exit 0. Both originally failing tests passed in every run. **Status:** local prevention CONFIRMED/HIGH; renewed hosted CI on the committed head is required before merge.


## E-CLOSE-20260928-R13 — final post-release repository closure

**Date/Context:** 2026-09-28; final audit after v0.9.20 production acceptance and post-release CI/hygiene maintenance.

**Release authority:** immutable v0.9.20 remains tag/commit `cbbc6dc19f63a87e651a8f1af9f429aa7b6a5063`. Independent published-byte verification reconfirmed immutable=true, 15 assets and 14/14 payload checksum entries. Production routes on Windows default, Windows `saeed-emad`, Linux and HPC all point to exact v0.9.20 commit with `previous=null`.

**Post-release main maintenance:** PR #45 exact head `bb973bb9f1de2f644d9a5e33fbbb854780897aa2` carried only closure documentation, GitHub Actions pin maintenance and test-fixture readiness hardening. Focused Windows affected-fixture stress passed 36/36. Hosted CI run `36451298406` passed Windows and Ubuntu check/test/audit. Server Install Canary run `36451298534` passed clean Ubuntu and Windows Server bootstrap. PR #45 merged as main commit `f0157ccff98da9e42c25e5ea0bd55bc9ee7de0ab`.

**Actions maintenance:** current workflows use `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) and `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (v7.0.0), including the permanent Server Install Canary.

**Historical PR hygiene:** stale v0.9.19 closure PR #43, superseded Dependabot PRs #3/#4 and legacy v0.9.4 draft PR #30 were closed with history preserved in Git. No superseded PR is treated as current project authority.

**Operational scope:** Linux durable-workflow database integrity is `ok`, `currentLeases=0`, and `automaticExecution=false`; its historical pending/interrupted records belong to other retained projects and are intentionally not mass-cancelled. HPC workflow integrity is `ok`, pending/interrupted/reconciliationRequired=0; HPC durable delivery pending/deadLetter/unfinishedRequests=0.

**Decision:** v0.9.20 remains **SCOPED FINAL / ACCEPTED** for the release objective. Post-release repository closure is ACCEPTED. No current release blocker remains.

**Deferred/external:** ChatGPT host/UI stream failures such as `Resume stream unavailable` remain outside Commander transport authority. Future provider expansion, broad competitive benchmarking and unrelated historical-project cleanup remain separate work, not release blockers.

**Confidence/Status:** CONFIRMED/HIGH from exact run, release, route, workflow and Git evidence.


## 2026-09-28 — Owner-authorized Project Engine runner contract repair (v0.9.21 candidate)

- **Context:** Live Windows 0.9.20 reported runnerConfigured=false / automaticExecution=false although config.local.json explicitly had runner.enabled=true, autoTick=true, a local Codex provider, and the active FULL_POWER capability profile reported codexControl.allowLaunch=true.
- **Claim / root cause — CONFIRMED / HIGH:** src/no-codex-policy.mjs already encoded owner-authorized local Codex launch, but src/project-runner-config.mjs and src/project-planner.mjs still unconditionally rejected Codex. This contract mismatch disabled the configured Project Engine runner.
- **Decision:** Preserve default-deny and automatic-discovery prohibition. Permit an explicitly configured Codex provider only when FULL_POWER, explicit owner authorization, powerMode.codexControl.allowLaunch=true, exact provider kind=codex, and a real Codex executable are all present. Planner remains proposal-only under the existing read-only/ephemeral/no-approval/no-web/tool-disabled controls.
- **Rejected option:** An Ollama adapter prototype passed its mock contract, but a live qwen3-coder:30b proposal exceeded the planner latency budget. It was removed from this change set to avoid mixing provider expansion with the root-cause repair.
- **Safety / limitation:** Unauthorized, Standard, disguised-command, missing-executable, and auto-discovered Codex paths remain fail-closed. ChatGPT native wake/push remains an external host capability and is not claimed fixed here.
- **Reuse targets:** release notes, architecture/security rationale, failure-prevention history, Project Engine documentation.
- **Provenance:** clean writer clone ChatGPTRemoteCommander-finalize-20260928, baseline main@4a93d5475447f751e81ceaa87495b8c684fd1e87.


## 2026-09-28 — v0.9.21 local promotion gate

- **Status:** CONFIRMED / HIGH — local promotion gate PASS.
- **Focused Project Engine:** 223 tests total; 222 passed, 0 failed, 1 environment skip (Windows symlink privilege).
- **Comprehensive check suite:** completed with no failures. Representative aggregate suites included 487 tests / 481 pass / 6 environment skips and GUI contract 77/77 pass; installer, onboarding plugin, release asset, runtime, source-integrity, retry/recovery and schema-continuity gates passed.
- **Security audit:** SECURITY_AUDIT_PASS; no secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked local-config, or developer-path finding.
- **Diff gate:** git diff --check PASS.
- **Final marker:** FINAL_GATE_PASS at 2026-09-28T21:50:18.6502700+03:30.
- **Evidence artifact:** var/final-gate-v0.9.21.log, SHA-256 406a95addaff1ccc343969c2d4097bf401eac2145b36e5ad18431429108bb569.
- **Limitation:** elapsed 24/48-hour soak and native ChatGPT host wake/push are not proven by this gate.

## 2026-09-28 — Hosted pre-promotion security-audit correction

- **Failure — CONFIRMED / HIGH:** the first hosted Ubuntu CI and clean-Ubuntu canary for the v0.9.21 candidate failed only at the security audit after functional/runtime tests had passed.
- **Root cause:** Project Brain recorded an absolute developer Windows checkout path. The audit correctly rejected that path in both the current tree and the unmerged branch history.
- **Prevention / guard:** repository-facing Brain and evidence records must use role/host-relative provenance rather than personal developer filesystem paths. Because the offending commit had not been merged, the branch commit was amended so the sensitive path does not remain reachable in branch history.
- **Regression:** local security audit and hosted CI/canary must both pass on the amended SHA before merge.
- **Reuse targets:** release process, security-audit guidance, Brain authoring rules.


## 2026-09-28 — Hosted Windows browser qualification hardening

- **Context:** On amended v0.9.21 SHA d297ec212ec4d3a670a1a5081d1d00888851298e, Ubuntu CI and clean-Ubuntu server canary passed. Windows CI failed one browser-process test because its setup/start request shared an 80 ms request timeout with the intentionally hanging request. Windows Server canary failed a different browser-process assertion after polling only raw PID existence.
- **Evidence:** The 80 ms test passed 30/30 on the primary Windows host but failed once on hosted Windows, showing scheduler/environment sensitivity rather than a stable product contract. The production browser request timeout remains 15 s. The Windows Server assertion observed only that the numeric PID still existed after cleanup; it did not verify that the PID still identified the profile-owned browser process.
- **Method benchmark / primary sources:** Node.js process documentation states that signal 0 tests process existence and warns that PIDs may be reassigned after process exit (https://nodejs.org/api/process.html; https://nodejs.org/api/child_process.html). Microsoft taskkill documentation states that /T terminates the selected process and child processes and /F forces termination (https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).
- **Assessment:** The exact reason the raw PID remained observable on Windows Server is **PROBABLE/UNVERIFIED** (PID reuse or process-object visibility are both compatible with the evidence). The qualification predicate itself is **CONFIRMED insufficient** because it tests numeric PID existence rather than browser ownership identity.
- **Decision / prevention:** Do not weaken production cleanup or extend product timeouts. Align profile-owned lifecycle tests with the production ownership predicate: exact --user-data-dir identity. Keep raw PID liveness only for the non-profile process-tree test. Restore the timeout-cleanup fixture to its 1000 ms default so the test measures timeout cleanup without imposing an unrelated 80 ms setup-performance requirement.
- **Regression requirement:** targeted Windows stress, full local final gate, hosted Windows CI, and Windows Server canary must pass on the amended SHA before merge.
- **Reuse targets:** browser lifecycle qualification, CI stability, release acceptance, failure-prevention guidance.


## 2026-09-28 — Local final gate after Windows qualification correction

- **Targeted browser qualification:** full browser-process suite 7/7 PASS; repeated stress of the two previously failing hosted-Windows scenarios 20/20 PASS.
- **Full local release gate — PASS / CONFIRMED:** Project Engine 222 pass, 0 fail, 1 environment skip; full suite 481 pass, 0 fail, 6 environment skips; GUI contract 77/77 pass; installer/onboarding/release-asset/runtime/source-integrity/schema-continuity gates passed; security audit passed; git diff check passed.
- **Final marker:** FINAL_GATE_PASS at 2026-09-28T22:56:14.0725938+03:30.
- **Gate log SHA-256:** 107D33026CD9294B07ED8B7AAB79B0A6B63B5EE325E634A663E184C505FD80DB.
- **Status:** local verification PASS. Promotion remains blocked only on fresh hosted CI and server-install canary for the amended candidate.


## 2026-09-28 — Hosted Windows child-spawn fixture race root cause

- **Failure — CONFIRMED / HIGH:** fresh hosted Windows CI on candidate 812d3fdedc9d58c655aa6237a8e6c4b5d0d4284d failed the isolated-profile child-process test before cleanup assertions because the marker contained a non-numeric PID.
- **Root cause — CONFIRMED:** the test helper called child_process.spawn() and immediately serialized child.pid. Node documents ChildProcess.pid as number or undefined and defines the spawn event as the boundary indicating successful child creation. Under hosted-Windows scheduling, PID observation raced process creation.
- **Primary method evidence:** Node.js ChildProcess documentation: https://nodejs.org/api/child_process.html. The spawn event is emitted once the child has spawned successfully; subprocess.pid may be undefined when spawn fails.
- **Prevention:** fixture child processes that expose a PID now await the spawn event before persisting PID evidence. Both hangWithChild and crashWithChild paths use the same guard.
- **Scope:** test-fixture correction only; production browser lifecycle code and production timeouts are unchanged.
- **Regression gate:** browser-process suite plus repeated affected-child scenarios, then one complete local release gate and fresh hosted Windows/Linux CI and server canaries.


## 2026-09-28 — Final local release gate after spawn/PID guard

- **Targeted regression — PASS / CONFIRMED:** browser-process suite 7/7; affected child-spawn scenarios repeated 10/10 without failure.
- **Full local release gate — PASS / CONFIRMED:** Project Engine 222 pass / 0 fail / 1 environment skip; full suite 481 pass / 0 fail / 6 environment skips; GUI contract 77/77 pass; Windows/Linux runtime contracts, source integrity, schema continuity, installer/onboarding/release-asset checks, security audit, and diff check all passed.
- **Final marker:** FINAL_GATE_PASS 2026-09-28T23:06:39.5908545+03:30.
- **Gate log SHA-256:** 0DC03CE86CF73A2847B68ECC566D7CDF916F91F7B3E0D69DB33A51DF8DA5F817.
- **Promotion status:** local gate accepted; GitHub CI and both server-install canaries on the amended SHA remain required before merge.


## 2026-09-28 — Async continuation cleanup qualification correction

- **Failure — CONFIRMED / HIGH:** after the Windows browser qualification correction, the full local gate had exactly one failure in `continuation metadata is part of request idempotency identity`.
- **Root cause:** the contract assertions had passed; the test failed only in `finally` because its temporary-root cleanup used synchronous recursive removal with no retries and Windows returned `ENOTEMPTY` while async-operation state files were still settling.
- **Comparable project evidence:** existing async-operation/process-tree/HTTP tests in this repository already use recursive cleanup with `maxRetries:20` and `retryDelay:50` for Windows-safe teardown.
- **Decision:** align only this fixture teardown with that established repository pattern. Runtime async continuation behavior, idempotency identity, and production code remain unchanged.
- **Prevention / regression:** targeted repetition of the exact test plus a complete final gate must pass before promotion.
- **Reuse targets:** Windows CI hygiene, async-operation fixture guidance, release qualification.


## 2026-09-28 — v0.9.21 post-qualification local promotion evidence

- **Status:** CONFIRMED / HIGH — complete local promotion gate PASS at `2026-09-28T23:37:31.6925697+03:30`.
- **Focused Project Engine:** 223 total; 222 pass, 0 fail, 1 platform skip.
- **CHECK:** completed with zero failures after both Windows qualification corrections.
- **FULL_TEST:** representative aggregate 487 total; 481 pass, 0 fail, 6 platform skips; downstream GUI/schema/runtime/source-integrity gates also passed.
- **Security / diff:** `SECURITY_AUDIT_PASS`; `git diff --check` PASS.
- **Evidence artifact:** `var/final-gate-v0.9.21.log`, SHA-256 `2e4402ddddcf21240fc59f478734f3833c11d5b614bf2698a5aa0b39ef00bf12`.
- **Open gates:** hosted CI + Server Install Canary on the new commit, PR merge, immutable deployment, and live runtime readback. Native ChatGPT host wake/push and elapsed soak remain external/unproven.


## 2026-09-28 — v0.9.22 Windows owner-runner policy-overlay root cause and prevention

- **Live evidence — CONFIRMED / HIGH:** v0.9.21 canonical local policy contains `durableWorkflows.runner.enabled=true`, `autoTick=true`, exact `provider.kind=codex`, a real local Codex executable and `powerMode.codexControl.allowLaunch=true`; the active routed v0.9.21 runtime still contains the historical disabled runner with reason `NO_CODEX_VIA_COMMANDER`, so live `system_status` reports `runnerConfigured=false` and `automaticExecution=false`.
- **Root cause — CONFIRMED / HIGH:** Windows `Get-PrimaryConfig` has preferred `route.active.configPath` since v0.8.0. Thus the v0.9.21 updater used the historical runtime policy as its candidate input and ignored the newer explicit canonical owner runner policy. The v0.9.21 code contract itself is valid: an isolated candidate build using canonical local policy preserves the owner-authorized Codex runner and clamps provider timeout to 30 seconds.
- **Correction to earlier inference:** `workflow.project_engine` is a capability name; the configured runner lives under `durableWorkflows.runner`. Earlier checks of a nonexistent `workflow.project_engine` config block are superseded by the direct `durableWorkflows.runner` evidence.
- **Decision / minimum sufficient control:** keep active routed config as baseline. Recover only the runner block when active state is specifically historical `NO_CODEX_VIA_COMMANDER` and both canonical policy and merged active authority pass the same explicit-owner Codex contract. Do not copy unrelated canonical fields and do not override Standard/explicit opt-out/other disabled states.
- **Prevention / regression:** centralize the merge through `project-runner-config` authorization logic, add unit regressions for allowed and denied overlays, add updater contract markers, and require live readback after candidate-first rollout.
- **Reuse targets:** release notes, updater architecture, policy migration, failure prevention.


## 2026-09-29 — v0.9.22 complete local promotion gate

- **Status:** CONFIRMED / HIGH — `FINAL_GATE_PASS` at `2026-09-29T00:09:04.6782491+03:30`.
- **Focused Project Engine:** 223 total; 222 pass, 0 fail, 1 platform skip.
- **Release metadata contracts:** installer, onboarding/plugin, release-assets, source-integrity, Windows runtime contract and security audit passed after v0.9.22 alignment.
- **Live-config proof before promotion:** the policy merge recovered `runnerEnabled=true`, `autoTick=true`, provider `codex` while preserving active `runtimeState`, workflow directory and port.
- **Evidence artifact:** `var/final-gate-v0.9.22.log`, SHA-256 `a06b87e9a80be2bd0853207f3a9f33e191d27b12199af16e7cd0de79fe066b7f`.
- **Open gates:** hosted CI, merge, immutable release publication, candidate-first live rollout, and live `system_status` readback.


## 2026-09-29 — PR #50 hosted Windows qualification failures

- **Hosted evidence — CONFIRMED / HIGH:** PR #50 Windows `npm run check` had exactly two failures while local full gate was green.
- **Failure 1:** `same async requestId with a changed correlation fails closed` failed only during fixture teardown with Windows `EBUSY` on temp-root removal. The test's cleanup was the only nearby async-operation cleanup missing the established `maxRetries:20, retryDelay:50` policy.
- **Failure 2:** `unexpected helper exit terminates the independently owned browser process and removes an isolated profile` failed on the PID-validity assertion. The helper writes the PID with async `writeFile`; file creation can become visible before the content is ready, so gating only on path existence is insufficient.
- **Decision:** qualification-only hardening. Add the same Windows cleanup retry policy to the async fixture and wait for a parseable positive PID marker before asserting process cleanup. Production runtime code remains unchanged.
- **Prevention / regression:** exact-test stress on Windows plus a complete local final gate before pushing a new SHA; hosted CI/canary must then rerun on that SHA.


## 2026-09-29 — PR #50 Windows qualification fixes revalidated

- **Targeted regression — CONFIRMED / HIGH:** async correlation cleanup stress passed 20/20; browser unexpected-helper-exit stress passed 5/5; forced helper shutdown exact test passed.
- **Complete local gate — CONFIRMED / HIGH:** `FINAL_GATE_PASS` at `2026-09-29T00:26:55.8341065+03:30`; focused Project Engine 222 pass / 0 fail / 1 platform skip; full test aggregate 483 pass / 0 fail / 6 platform skips; security audit, Windows runtime contract, source integrity and diff check passed.
- **Evidence artifact:** `var/final-gate-v0.9.22.log`, SHA-256 `1996b17a4bad9c958de46ddf693ec507dece49e5a5e12cc3a839fdf71256b16b`.
- **Scope:** qualification-only fixes; production runner-policy code remains unchanged from PR #50 head `8129441eec60ea21944b5c0b1c1bbc41ab0ab7ce`.
- **Next authority gate:** push a narrow follow-up commit to PR #50 and require fresh hosted CI + Server Install Canary on the new head SHA before merge.


## 2026-09-29 — Windows hosted full-suite concurrency control

- **Hosted evidence — CONFIRMED / HIGH:** on PR #50 head `3f1ea4f9c598db78fdd15e0b70ce85411f2d6bff`, Ubuntu CI and both Server Install Canary jobs passed, while Windows `npm test` failed only in two time-sensitive tests: a 1 s Project Engine WAITING_INPUT deadline was exhausted under load, and an isolated workflow HTTP server missed a 30 s health-start deadline without exiting.
- **Method evidence:** Node.js test runner executes test files in parallel child processes; `--test-concurrency` controls the maximum concurrent test processes and defaults from available parallelism. GitHub's standard public `windows-latest` runner provides four vCPUs. With this public repository, default Node file concurrency is therefore three on that runner.
- **Sources:** Node.js Test Runner / CLI documentation (`https://nodejs.org/api/test.html`, `https://nodejs.org/api/cli.html#--test-concurrencyconcurrency`); GitHub hosted runner specifications (`https://docs.github.com/actions/reference/runners/github-hosted-runners`).
- **Decision / minimum sufficient control:** do not inflate functional timeouts. Leave local and Ubuntu `npm test` unchanged; bound only Windows hosted full-test file concurrency to 2 through a tracked wrapper that transforms the existing package `test` script, avoiding a duplicated test list.
- **Regression guard:** CI contract verifies the Windows-only conditional, exact bounded command, complete replacement of all `node --test` invocations, and invalid-wrapper inputs fail closed.
- **Reuse targets:** CI reliability, Windows qualification, release engineering, failure-prevention guidance.


## 2026-09-29 — Windows bounded-CI control fully qualified

- **Exact Windows CI path — CONFIRMED / HIGH:** `npm run test:ci:windows` executed the tracked test script with `--test-concurrency=2` injected into both `node --test` invocations; aggregate 483 pass / 0 fail / 6 platform skips. The two prior hosted starvation failures both passed in this path.
- **CHECK — CONFIRMED / HIGH:** complete `npm run check` passed after the new CI contract/helper was added.
- **Complete local promotion gate — CONFIRMED / HIGH:** `FINAL_GATE_PASS` at `2026-09-29T00:50:53.5926011+03:30`; focused Project Engine 222 pass / 0 fail / 1 skip; full aggregate 483 pass / 0 fail / 6 skips; security audit, source integrity, Windows runtime contract and diff check passed.
- **Evidence artifact:** `var/final-gate-v0.9.22.log`, SHA-256 `5f2bb611d2e43e921f57695119f1f3692313b4eb5ca6df1a7d71c631c157e87c`.
- **Next authority gate:** fresh hosted CI + Server Install Canary on the new PR head SHA. Merge remains blocked until success.


## 2026-09-29 — Linux install canary exposed qualification oversubscription

- **Hosted evidence — CONFIRMED / HIGH:** PR #50 head `47c40616c30b37b23451cd237790f45bf81c4656` passed GitHub CI and Windows Server bootstrap. Linux clean-container canary failed only inside the install qualification suite: 486 pass / 2 fail / 1 skip.
- **Exact failures:** `dead-worker reconciliation adopts an exact final receipt instead of overwriting it UNCERTAIN` and `corrupt terminal projection is not repaired when receipt and reservation hashes differ`; both failed in `waitFor()` at ~10.02 s with `operation did not finish` while neighboring tests passed.
- **Root-cause class — PROBABLE/HIGH:** qualification file-process oversubscription/resource starvation, same failure family previously observed on hosted Windows. No production assertion, bootstrap integrity check, source pin, or runtime behavior failed.
- **Scope evidence:** `install.ps1`, `install.sh`, and `auto-update-linux.sh` each invoked the full test suite with default Node test-file concurrency. The bounded helper already qualified successfully with concurrency 2.
- **Decision / minimum sufficient control:** expose one generic `test:qualification` command using the existing bounded wrapper at concurrency 2 and reuse it in hosted Windows CI plus Windows/Linux install qualification and Linux updater qualification. Keep ordinary `npm test` and the complete local final gate unbounded.
- **Validation state:** PATCH APPLIED; targeted contracts, exact qualification run, full local gate, fresh hosted CI/canary remain required before merge.


## 2026-09-29 — Generic qualification path local validation PASS

- **Targeted contracts — CONFIRMED / HIGH:** qualification-concurrency contract 2/2 PASS; Windows/Linux installer contract PASS; Linux auto-update contract 13/13 PASS.
- **Exact qualification path — CONFIRMED / HIGH:** `npm run test:qualification` ran with `CI_TEST_CONCURRENCY script=test concurrency=2 replacements=2`; full aggregate 483 pass / 0 fail / 6 platform skips. Both prior Linux canary timeout tests passed within hundreds of milliseconds.
- **Complete local gate — CONFIRMED / HIGH:** `FINAL_GATE_PASS` at `2026-09-29T07:26:17.2585959+03:30`; focused Project Engine 222 pass / 0 fail / 1 platform skip; unbounded full test aggregate 483 pass / 0 fail / 6 platform skips; security audit, source integrity, Windows runtime contract and diff check passed.
- **Evidence artifact:** `var/final-gate-v0.9.22.log`, SHA-256 `1338cc7cd5e3d5b65739342fe4e3b8b0fdeffbd0501fe0d9f514d04196af751c`.
- **Scope:** qualification harness/install-update gate only; production runner-policy/runtime behavior and functional timeouts unchanged.
- **Next authority gate:** commit/push this delta, then require fresh GitHub CI and both Server Install Canary jobs on the new head SHA before merge.


## 2026-09-29 — Ubuntu hosted check caught stale Linux installer expectation

- **Hosted evidence — CONFIRMED / HIGH:** PR #50 head `e7fa42ab33a3633a7d290b8b47c25cbfade0c639` failed Ubuntu `npm run check` only in three Linux installer-isolation assertions.
- **Exact mismatch:** installer fixture correctly recorded `run test:qualification`, while the Linux-only test still expected legacy `test` in two no-start reuse cases and one skip-tunnel-client case. Ubuntu aggregate for that CHECK segment: 248 pass / 3 fail / 1 skip.
- **Root cause — CONFIRMED:** stale test oracle after intentional qualification-command rename; production/install behavior matched the new contract. Local Windows qualification did not execute these Linux-only isolation cases, so hosted Ubuntu was the first authority to expose the stale oracle.
- **Fix:** update only the two expected npm-call arrays in `test/linux-installer-isolation.test.mjs` to `run test:qualification`; no runtime, installer, timeout, or concurrency behavior changed.
- **Next authority gate:** local syntax/CHECK/audit/diff validation, then a fresh commit and fresh Ubuntu/Windows CI plus both install canaries. Do not rerun the old failed SHA as promotion evidence.


## 2026-09-29 — v0.9.22 live Windows updater exposed the remaining unbounded qualification path

- **Release authority — CONFIRMED / HIGH:** PR #50 merged at `1149ad23bbbce397d52e61663bbd3063fec76e17`; immutable `v0.9.22` Release Sync passed and published the full 15-asset contract. The tag is not to be moved or rewritten.
- **Candidate qualification — CONFIRMED / HIGH:** exact pinned v0.9.22 candidate-only update passed check/test/audit/native GUI, including 483 pass / 0 fail / 6 platform skips, and recovered the explicit owner Codex provider for the default profile.
- **First promotion — CONFIRMED / HIGH:** the updater safely promoted the independent `saeed-emad` profile but left default as `PROMOTED_PARTIAL` because an older default route generation was still draining. No blind retry was performed.
- **Independent drain recheck — CONFIRMED / HIGH:** the old default previous port 48835 later had no listener; router status showed current inflight work only on active port 48834. This satisfied the updater's documented idempotent-resume precondition.
- **Resume failure — CONFIRMED / HIGH:** the evidence-backed resume failed before cutover at the candidate test gate: 482 pass / 1 fail / 6 skips. The sole failure was `host-approved wrapper does not inherit full-filesystem access outside workflow root` in `workflow-http.test.mjs`, timing out its isolated health probe at ~30.16 s even though the child printed that it was listening.
- **Diagnostic — CONFIRMED / HIGH:** the exact `node --test test/workflow-http.test.mjs` file immediately passed 3/3 in ~2.51 s; the affected test passed in ~0.57 s. No listener remained on the failed temporary port after cleanup, and live default routing remained on v0.9.21 with `last-update.status=FAILED`.
- **Historical audit — CONFIRMED:** repository search showed Windows hosted CI, `install.ps1`, `install.sh`, `auto-update-linux.sh` use `test:qualification`, while `auto-update-windows.ps1` still used `Run-Gate ... @('test')`. This is the third meaningful occurrence of the same qualification oversubscription/starvation family after hosted Windows CI and Linux install canary.
- **External method evidence:** Node v26 CLI documentation states that `--test-concurrency` limits concurrently executed test files and defaults to `os.availableParallelism() - 1` under process isolation; each test file executes in a child process. Source: https://nodejs.org/dist/latest/docs/api/all.html
- **Root-cause class — PROBABLE / HIGH:** resource starvation caused by the one remaining unbounded Windows auto-update qualification path, not a workflow authorization/runtime regression. Confirmation requires the same live update path to pass after bounded qualification.
- **Decision / minimum sufficient control:** do not increase functional health timeouts and do not alter runtime code. Wire only Windows auto-update candidate qualification to existing `test:qualification` concurrency=2 and add a regression assertion covering that path. Keep ordinary `npm test` unbounded for development/final-gate detection.
- **Versioning:** v0.9.22 is immutable and already published, so the correction is a new v0.9.23 hotfix rather than retagging.


## 2026-09-29 — v0.9.23 version consistency gate

- **CHECK failure — CONFIRMED / LOW RISK:** first v0.9.23 `npm run check` stopped at `test/onboarding-plugin-check.mjs` because release-coupled files still expected v0.9.22.
- **Root cause:** normal release-version dependency set, not a production/runtime defect.
- **Correction:** align server VERSION, Windows/Linux installer default refs, README current-release link, plugin template version, final-gate log filename, installer contract, onboarding check and release-assets contract to v0.9.23. Historical v0.9.22 release/evidence text remains unchanged.
- **Prevention:** existing `npm run check` is the sufficient guard; no additional release-version machinery is added.


## 2026-09-29 — v0.9.23 native Codex manifest version alignment

- **CHECK failure — CONFIRMED / LOW RISK:** the second version-consistency pass caught `plugin-template/.codex-plugin/plugin.json` still at v0.9.22 while the package and legacy public plugin manifest were v0.9.23.
- **Root cause:** hidden native Codex manifest was outside the first ordinary version search, but the existing onboarding contract correctly enforced equality with `package.json`.
- **Correction / prevention:** align the native Codex manifest to v0.9.23; retain the existing onboarding equality guard as the sufficient prevention control.


## 2026-09-29 — v0.9.23 local promotion gate PASS

- **Focused Project Engine — CONFIRMED / HIGH:** 222 pass / 0 fail / 1 environment skip.
- **CHECK — CONFIRMED / HIGH:** complete `npm run check` passed after version-consistency alignment.
- **Exact qualification — CONFIRMED / HIGH:** `npm run test:qualification` used `CI_TEST_CONCURRENCY ... concurrency=2 replacements=2`; aggregate 483 pass / 0 fail / 6 platform skips.
- **Complete unbounded final gate — CONFIRMED / HIGH:** `FINAL_GATE_PASS 2026-09-29T08:44:21.1074309+03:30`; full aggregate 483 pass / 0 fail / 6 skips; GUI contract 77/77; schema continuity 9/9; security audit and diff check passed.
- **Evidence artifact:** `var/final-gate-v0.9.23.log`, SHA-256 `caf3697d100ab9d6ccdcac913178a2bb424938b5e8cf6dd40dbf684a851b53d5`.
- **Next authority gate:** commit/push this exact tree, then require fresh hosted CI and both Server Install Canary jobs on the new head SHA. No merge or release until those gates pass.


## 2026-09-29 — Windows hosted CHECK exposed unbounded check qualification

- **Hosted evidence — CONFIRMED / HIGH:** PR #51 head `fd4a69d31715acb391528d933f07d6070b9237f9` passed Ubuntu CI, Linux clean-container canary, and Windows Server bootstrap canary. Windows CI failed only in `npm run check`.
- **Exact failure:** `dual-era MCP contract, tool validation, cache hints and risk annotations` in `test/mcp-conformance.test.mjs`; line 108 asserted `healthy === true` after 400 × 25 ms startup probes. Hosted duration was ~12.8 s and stderr contained only the Node SQLite experimental warning.
- **Root-cause class — PROBABLE / HIGH:** the same Windows hosted file-process resource starvation family, now inside the CHECK script's large unbounded `node --test` batch. Production/bootstrap regression is contradicted by both server canaries passing and Ubuntu CHECK/full tests passing.
- **Historical audit:** qualification/install/update paths bounded the full TEST suite but all still invoked raw `npm run check`; the CHECK script itself contains multiple `node --test` batches.
- **Decision / minimum sufficient control:** add generic `check:qualification` using the existing bounded wrapper at concurrency 2 and use it only for hosted Windows CI plus Windows/Linux installer and updater qualification. Keep ordinary `npm run check` unbounded for development/local final-gate detection. Do not widen the 10 s MCP health probe.
- **Promotion state:** old failed head remains non-promotable; a new commit SHA must pass focused contracts, exact bounded CHECK/TEST qualification, complete local final gate, and fresh hosted gates.


## 2026-09-29 — qualification CHECK control locally accepted

- **Focused regression — CONFIRMED / HIGH:** qualification/update/installer contract set passed 15/0 with 5 platform skips plus `INSTALLER_CHECK_PASS`.
- **Exact bounded qualification — CONFIRMED / HIGH:** `check:qualification` ran with `concurrency=2 replacements=4`; the previously failing MCP conformance startup case passed. `test:qualification` also passed; aggregate TEST result 483 pass / 0 fail / 6 skips.
- **Complete unbounded final gate — CONFIRMED / HIGH:** `FINAL_GATE_PASS 2026-09-29T09:19:39.7374006+03:30`. Focused Project Engine 222/0/1 skip; CHECK 247/0/5 skip in its large test batch; FULL_TEST 483/0/6 skips; GUI contract 77/77; schema continuity 9/9; security audit, source integrity and diff check passed.
- **Evidence artifact:** `var/final-gate-v0.9.23.log`, SHA-256 `b9e5945c7155a95212d5c2864fadca2acc15680e8e00c896980b62d14486a156`.
- **Decision status:** minimum sufficient control accepted locally. No functional timeout, runtime semantics, router behavior, runner authority, or model-provider policy changed.
- **Next authority gate:** commit/push this exact tree and require fresh Windows+Ubuntu CI plus both server-install canaries on the new head SHA before merge.


## 2026-09-29 — v0.9.23 live rollout final acceptance

- **Release authority — CONFIRMED / HIGH:** immutable tag `v0.9.23` peels to merge commit `a1b5368edf33d629111407aecd7f4c6a136a6122`; the release is published with the complete 15-asset contract.
- **Hosted qualification — CONFIRMED / HIGH:** fresh Windows CI, Ubuntu CI, Linux clean-container install canary and Windows Server bootstrap canary all passed on hotfix head `92e9eec1d725763e1fbf93150765c2bbfba8a2b0` before merge.
- **Local promotion gate — CONFIRMED / HIGH:** complete unbounded final gate passed at `2026-09-29T09:19:39.7374006+03:30`; artifact `var/final-gate-v0.9.23.log` SHA-256 `b9e5945c7155a95212d5c2864fadca2acc15680e8e00c896980b62d14486a156`.
- **Candidate-first rollout — CONFIRMED / HIGH:** pinned candidate `v0.9.23 / a1b5368...` passed bounded CHECK and TEST qualification, security audit, native GUI self-test, doctor/config hash checks and emitted `AUTO_UPDATE_CANDIDATE_PASS`.
- **Live default runtime — CONFIRMED / HIGH:** route generation 116 is active on port 48835 at version `0.9.23`, commit `a1b5368edf33d629111407aecd7f4c6a136a6122`, with no `previous` route. `system_status` reports Full Power, `runnerConfigured=true`, `automaticExecution=true`, scheduler enabled and no current lease at readback. Active config reports runner `enabled=true`, `autoTick=true`, provider `codex`.
- **Independent profile preservation — CONFIRMED / HIGH:** `saeed-emad` is active on v0.9.23 / the same release commit with no previous route, while its independent policy remains `runner.enabled=false`, `autoTick=false`, provider `disabled`, reason `NO_CODEX_VIA_COMMANDER`.
- **Drain closure without work loss — CONFIRMED / HIGH:** old default v0.9.21 backend on port 48834 had no router inflight but owned persistent terminal work. Maintenance recorded it in `retained-backends.json` with terminal PID 69684, emitted `DRAIN_TERMINAL_RETAINED`, then emitted `ROUTER_PREVIOUS_RETIRED`. This preserved the live terminal while removing the old backend from routing authority.
- **Updater terminal state — CONFIRMED / HIGH:** `last-update.json` reports `status=CURRENT`, ref `v0.9.23`, commit `a1b5368edf33d629111407aecd7f4c6a136a6122`, completed at `2026-09-29T06:24:08.7992779Z`.
- **Conclusion:** the v0.9.23 release objective and live Windows rollout DoD are **PASS**. Retained historical backends are preservation state for still-running terminal descendants, not active routing/drain blockers; their later reap is lifecycle cleanup and must not interrupt those jobs.


## 2026-09-29 — live finalization evidence record

- **Claim/Decision:** v0.9.23 at `a1b5368edf33d629111407aecd7f4c6a136a6122` remains the executable authority; later accepted repository changes before this record were docs-only. **Evidence:** live health/routes, last-update CURRENT, commit comparison. **Status:** CONFIRMED / HIGH. **Reuse:** release/deployment handoff.
- **Claim/Decision:** old listeners on 48831–48834 are retained-backend preservation for live terminal descendants, not current routing authority. Do not force-kill; updater reaps only after descendant ownership clears. **Evidence:** retained registry, process liveness, updater retention code, current routes `previous=null`. **Status:** CONFIRMED / HIGH. **Reuse:** lifecycle/resource/retry investigations.
- **Claim/Decision:** six historical Commander scheduler intents were superseded and safely cancelled through revision-guarded `workflow_control`; no mutation was replayed. **Evidence:** consistent SQLite prestate snapshot with `quick_check=ok`, workflow pre/post states. **Result:** pending 811→805, RUNNING 553→547. **Status:** CONFIRMED / HIGH. **Reuse:** durable-workflow hygiene.
- **Claim:** accumulated `COMPLETED_UNDELIVERED` is durable unacknowledged result state and is not by itself proof of a stuck execution queue. **Evidence:** delivery contracts/tests plus live deadLetter=0, unfinishedRequests=0 and ordinary queue 0/0. **Limitation:** historical per-chat delivery completeness is not inferred from the aggregate count. **Status:** CONFIRMED semantics / per-chat completeness UNVERIFIED.
- **Failure/Prevention:** Windows logon Run registration was missing while the supervisor was live. Exact historical cause is UNVERIFIED; only the explicit disable-autostart source path was found to remove the value. **Repair:** authoritative `enable-autostart.ps1 -NoStart`. **Guard:** audit Run registration plus both tunnel `/readyz` endpoints. **Status:** repair CONFIRMED.
- **Verification:** fresh exact-release regression passed: focused 42/0, CHECK 0, TEST 483/0/6 skipped, security audit PASS, doctor PASS. **Status:** CONFIRMED / HIGH.
- **Open gate:** SYSTEM BootRecovery and UserSessionHandoff tasks are absent; current token is non-elevated although two machine credential artifacts already exist. A local bounded admin runner was prepared with SHA-256 `79f85bb610d9c1f710034951f35774eb6501fefb8085550b4096a6377873b34b`; it performs no reboot. **Status:** MISSING owner/admin gate. **Reuse:** power-loss recovery/final DoD closure.


## 2026-09-29 — v0.10.0 final-product knowledge/evidence record

- **Method decision — CONFIRMED / HIGH:** use thin OS Setup bundles around the existing installer/update authority instead of adding Electron/Tauri/MSI/deb lifecycle logic. Evidence: v0.9.23 installers/updaters are already regression/live-qualified; the requested outcome is onboarding/distribution, not a missing runtime primitive. Reuse: future packaging decisions.
- **OpenAI packaging requirement — CONFIRMED / HIGH:** portable plugin identity is root plugin.json; app mappings may live in root .app.json referenced by extensions.com.openai.apps; native compatibility manifest points apps to ./.app.json; the app reference does not create/grant the app. Sources: current OpenAI Plugin packaging/help docs checked 2026-09-29. Reuse: Plugin generator, docs, support.
- **Tunnel boundary — CONFIRMED / HIGH:** Secure MCP Tunnel is private transport and can connect a ChatGPT developer-mode app, but it is not public Plugin distribution and tunnel credentials alone do not provide the registered App ID. Source: current OpenAI Secure MCP Tunnel docs. Reuse: onboarding/support.
- **Plugin ZIP upload — CONFIRMED / HIGH:** where workspace role/plan exposes it, owners/admins can use Admin -> Plugins -> Add -> Upload plugin; Plugin upload does not grant referenced app access. Source: current OpenAI Plugins help. Reuse: final user instructions.
- **Device identity design — CONFIRMED by tests:** machine-local stable ID + profile is hashed to a short fingerprint; Plugin name, display identity and generated visual assets vary by target. Same input produces deterministic package bytes. Targeted tests PASS 7/7 and real Windows wrapper smoke PASS.
- **Secret boundary — CONFIRMED by implementation/tests:** Runtime API key remains in the existing local enrollment prompt/storage; generated Plugin carries App ID but refuses tunnel IDs, OpenAI-key shapes, bearer tokens and API-key assignment patterns. Proven by generator regression and security audit.
- **Historical documentation repair — CONFIRMED:** CHANGELOG lacked v0.9.11-v0.9.23 while docs/RELEASE_*.md existed. Projection repaired from authoritative release files; no historical claims were reconstructed from chat alone.
- **Linux orphan cleanup — CONFIRMED / HIGH:** nested live-install app/ was old detached commit 981e0b2..., locally modified, untracked by outer checkout and had no active process/systemd/route/config references. Full backup created before deletion: /home/aliemad/.local/state/chatgpt-remote-commander/backups/20260929-v0923-orphan-app.tar.gz, SHA-256 b21d02f646dda980aa65e2cec1dc39898170c1d28517e12a10536b52c71a0c73, 30153972 bytes. Post-delete service active and health OK.
- **Local candidate gate — CONFIRMED / HIGH:** v0.10.0 final gate PASS; full suite 490/0/6 skipped, security audit PASS, diff PASS; log SHA-256 8ede55b433ed03a64f4d6dc536f5daf49fcc053aad4db4613e544e1fe134045a.
- **Open gates:** clean Linux exact-tree build/gate; hosted CI/server canaries; immutable release/assets; live rollout/readback. Windows BootRecovery task creation remains owner/admin OS authority.

## 2026-09-29 — v0.10.0 release/live final evidence

- **Release identity — CONFIRMED/HIGH:** tag v0.10.0 resolves to merge commit 26b8df90838f449bc61710981fc31b7a467e021d. Its tree is byte-identical to the fully qualified candidate tree ef76b567ead34d0ca26c0c8b7c42d9b28cd3eefe.
- **Release assets — CONFIRMED/HIGH:** immutable release published with 19 assets; complete download and SHA256SUMS verification PASS.
- **Hosted CI — CONFIRMED/HIGH:** Windows and Ubuntu CI PASS. Linux server canary PASS. Windows server canary rerun PASS after one isolated hosted timing failure in an unchanged terminal readiness test; seven local repeated exact-file runs PASS, supporting transient resource contention rather than functional regression.
- **Windows rollout — CONFIRMED/HIGH:** default and saeed-emad route records both point to v0.10.0 exact merge commit with previous=null. Windows last-update durable result is PROMOTED and records doctor/hardware/shadowStore/liveStoreCompatibility PASS for both profiles. Both tunnel health endpoints are ready.
- **Linux rollout — CONFIRMED/HIGH:** default route points to v0.10.0 exact merge commit with previous=null. systemd user service is active, routed health reports v0.10.0, tunnel readiness returns ready, and updater log records qualification PASS, schema continuity PASS and cutover/retirement evidence.
- **Plugin identity boundary — CONFIRMED/HIGH:** no trustworthy real App ID was found in audited local state; matches were templates/examples/validation caches. Therefore no machine-specific production Plugin ZIP was generated with invented identity. The software path is accepted and remains WAITING_APP_ID until the ChatGPT registered App ID is supplied.
- **Multi-device behavior — CONFIRMED by regression:** stable local machine identity + profile produces deterministic distinct plugin name and icon/logo; same identity is reproducible; different machine/profile differs; package excludes tunnel/runtime credentials.
- **Owner privilege boundary — CONFIRMED:** optional Windows pre-logon SYSTEM tasks require elevation and remain a separate owner action. No privilege bypass was attempted.
- **Reuse targets:** README/onboarding/support, installer distribution, future multi-device deployment, release audits, account transfer/handoff.


## 2026-09-29 — Windows BootRecovery closure evidence

- **Claim:** the SYSTEM task mechanism and LocalMachine credentials are viable on this machine. **Evidence:** production-equivalent SYSTEM self-test completed in 1.303 s with both `chatgpt-remote-commander` and `saeed-emad` credentials ready. **Status:** CONFIRMED/HIGH.
- **Failure/root cause:** the first official elevated setup produced `BOOT_RECOVERY_SYSTEM_PROBE_TIMEOUT`. Subsequent evidence did not reproduce the failure. SYSTEM can launch Store PowerShell 7, Node/npm paths are accessible, and exact production argument quoting passes. Therefore the first timeout is classified **transient / root cause not further proven**; no runtime patch was justified. **Status:** PROBABLE transient; precise causal mechanism UNVERIFIED.
- **Rejected diagnostic evidence:** a temporary `Start-Process -ArgumentList` wrapper split `C:\Program Files\nodejs\node.exe` and produced an invalid `IntervalSeconds` conversion. This was a diagnostic-wrapper defect and was excluded from product conclusions.
- **Decision:** use the authoritative `enable-boot-recovery.ps1 -NoStart` path unchanged after exact SYSTEM probe PASS rather than altering timeouts or weakening checks. **Rationale:** minimum sufficient control; avoids patching a non-reproduced transient.
- **Result:** BootRecovery and UserSessionHandoff registered as SYSTEM/Highest/ServiceAccount with correct enabled triggers; Handoff manually validated to LastTaskResult=0 while v0.10.0 MCP and both tunnels stayed ready.
- **Limitation:** no reboot/shutdown/logoff occurred, so actual AtStartup trigger behavior is not claimed as validated.
- **Provenance:** local acceptance artifact SHA-256 `4817dddef6b497545369758da5be79c940500968b8df7375fb43c892a1ba832a`.
- **Reuse targets:** deployment handoff, boot/power-loss recovery troubleshooting, future reboot validation, support.


## 2026-09-29 — 20-product competitive audit / product-position evidence

Context: deep product audit before real reboot/power-return validation. Authoritative live product remains v0.10.0; Windows and Linux both report FULL_POWER and idle active operation queues. A separate unpromoted local worktree named `fix/v0.10.1-boot-recovery-diagnostics` contains diagnostics/version changes and is explicitly excluded from current-release claims.

### Current product findings

- **Distinctive combined scope — CONFIRMED:** Remote Commander combines private outbound OpenAI Secure MCP Tunnel access, real owner-machine filesystem/shell/process tools, GUI and background-browser tools, durable operation/workflow state, one-writer mutation controls, multi-profile/multi-device routing, candidate-first live updates, per-device Plugin packaging, and OS startup supervision. This is a combination claim about the audited product, not a market-wide uniqueness proof.
- **Windows/Linux live asymmetry — CONFIRMED:** Windows currently has `automaticExecution=true` and `runnerConfigured=true` for enrolled Project Engine work. Linux currently has `automaticExecution=false`, `runnerConfigured=false`, and recovery/readiness-only automatic continuation. Cross-platform runtime feature presence is broad, but autonomous execution parity is not complete.
- **Durable-state hygiene debt — CONFIRMED:** Windows reports scheduler `pending=805`, `interrupted=81`, `reconciliationRequired=109`; Linux reports `pending=105`, `interrupted=4`, `reconciliationRequired=5`. Both hosts are currently idle (`activeOperations=0`, `queued=0`, `currentLeases=0`), so these counters are not evidence of a stuck runtime; they are an observability/state-lifecycle debt that should be classified/archived/reconciled before claiming enterprise-grade fleet operability.
- **Security trade-off — CONFIRMED:** explicit FULL_POWER intentionally exposes unrestricted shell/full filesystem/process control on trusted machines. Standard/root-scoped modes and explicit GUI/foreground policies exist, but there is no general-purpose OS sandbox equivalent to the default/optional sandboxes documented by Claude Code, Gemini CLI, Cursor Cloud Agents, OpenHands, or Open Interpreter.
- **Platform breadth gap — CONFIRMED:** current host implementation is Windows + Linux; no macOS host runtime is shipped.
- **Fleet/governance gap — CONFIRMED:** multi-device and multi-profile routing are supported, but there is no central fleet inventory/policy/RBAC/SSO control plane comparable to UiPath Orchestrator, Automation Anywhere enterprise orchestration, TeamViewer device management, RustDesk Pro, MeshCentral, or Tailscale access policies.
- **Remote-desktop scope boundary — CONFIRMED:** built-in GUI control is agent-oriented and verification-driven; it is not intended to replace high-frame-rate human remote desktop products with multimedia/session collaboration features.
- **RPA scope boundary — CONFIRMED:** Remote Commander can automate browser/desktop actions but does not offer a low-code recorder/designer/process-mining/document-automation suite comparable to Power Automate, UiPath, or Automation Anywhere.
- **Install UX — CONFIRMED:** v0.10.0 provides application-like Windows/Linux Setup ZIPs and per-device Plugin ZIP generation; it is not yet a signed native MSI/PKG/deb/rpm desktop distribution.
- **External onboarding boundary — CONFIRMED:** final per-device Plugin packaging still requires the registered ChatGPT App ID after Scan Tools. Tunnel ID/API key are not valid substitutes and are not embedded in the Plugin ZIP.
- **Power-return validation boundary — CONFIRMED:** BootRecovery/System credential self-test and UserSessionHandoff execution pass, but a real AtStartup cycle after reboot/power loss has not yet been validated because no reboot/shutdown/logoff was performed.

### Benchmark set and method

Twenty overlapping products were compared using current primary/official sources, grouped by function rather than treated as identical substitutes:
OpenAI Codex; ChatGPT Work; Anthropic Claude Code; GitHub Copilot Agents; Google Gemini CLI; Google Antigravity managed agents; Cursor; Devin Desktop (Windsurf successor); Devin Cloud; OpenHands; Continue; Open Interpreter; Microsoft Power Automate Desktop; UiPath; Automation Anywhere; TeamViewer; AnyDesk; RustDesk; MeshCentral; Tailscale SSH/PAM.

Method dimensions: direct control of a real owned host; filesystem/shell/process reach; GUI/browser; long-running durability; MCP/skills/plugins; multi-device/fleet control; sandbox/permissions; install/update/recovery; audit/governance; human handoff.

Primary sources consulted (2026-09-29):
- OpenAI Codex / Work / Secure MCP Tunnel / Plugins: https://openai.com/codex/ ; https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt ; https://developers.openai.com/api/docs/guides/secure-mcp-tunnels ; https://developers.openai.com/plugins/build/plugins
- Anthropic Claude Code/Skills: https://www.anthropic.com/webinars/claude-code-foundations ; https://www.anthropic.com/webinars/claude-code-advanced-patterns ; https://www.anthropic.com/engineering/claude-code-auto-mode ; https://www.anthropic.com/research/skills
- GitHub Copilot Agents: https://docs.github.com/en/copilot/responsible-use/agents
- Google Gemini CLI / managed agents: https://geminicli.com/docs/ ; https://ai.google.dev/gemini-api/docs/agents
- Cursor: https://cursor.com/docs ; https://cursor.com/docs/cloud-agent/capabilities
- Devin: https://devin.ai/ ; https://devin.ai/desktop ; https://devin.ai/cli
- OpenHands: https://www.openhands.dev/product/ ; https://www.openhands.dev/product/canvas
- Continue: https://docs.continue.dev/ ; https://docs.continue.dev/cli/quickstart
- Open Interpreter: https://www.openinterpreter.com/docs/desktop ; https://www.openinterpreter.com/
- Power Automate: https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-unattended-desktop-flows
- UiPath: https://docs.uipath.com/orchestrator/automation-cloud/latest/user-guide/about-robots
- Automation Anywhere: https://www.automationanywhere.com/products/agentic-process-automation-system
- TeamViewer: https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/licenses/licenses-and-features/remote-access-license-feature-overview/
- AnyDesk: https://support.anydesk.com/unattended-access
- RustDesk: https://rustdesk.com/docs/en/
- MeshCentral: https://docs.meshcentral.com/
- Tailscale: https://tailscale.com/docs/features/tailscale-ssh

### Method-choice conclusion

Do not expand Remote Commander by copying every competitor category. Minimum-sufficient next controls are:
(1) durable-state lifecycle/observability cleanup and ownership classification;
(2) intentional Windows/Linux autonomous-execution parity decision;
(3) reconcile/test the unpromoted v0.10.1 boot-diagnostics work before any next release;
(4) minimal fleet inventory/health/version/tunnel/plugin-identity dashboard and policy view;
(5) optional capability-scoped sandbox/privilege escalation rather than weakening FULL_POWER;
then consider macOS, native signed installers, and enterprise RBAC/SSO only if target users require them.
Avoid building high-frame-rate remote desktop, a full low-code RPA studio, or a competing coding-model IDE unless product scope changes; integrate those ecosystems through MCP/Plugins instead.

Status: CURRENT benchmark evidence. Reuse targets: roadmap, release planning, product positioning, architecture review, security review.


## 2026-09-29 — pre-important-task readiness / freeze decision

- **Decision — CONFIRMED/HIGH:** freeze live Commander feature expansion before the owner's important task. Preserve v0.10.0 exact release baseline and mutate only for a blocker directly affecting that task.
- **Windows runtime — CONFIRMED/HIGH:** doctor PASS, exact routes/default+saeed-emad at commit 26b8df90838f449bc61710981fc31b7a467e021d with previous=null, both tunnels ready, logon autostart present, no active operation/queue/lock, GUI live backend ready, security audit PASS, GUI contract 77/77, browser safety 12/12, native Chromium background smoke PASS and browser EOF/lifecycle cleanup PASS.
- **Linux runtime — CONFIRMED/HIGH:** doctor PASS, exact route at same release commit with previous=null, systemd active+enabled, linger=yes, tunnel ready, workflow SQLite integrity ok, no active operation/queue/lock, security audit PASS, Linux GUI contract PASS and browser safety 12/12.
- **Linux browser dependency — MISSING/DEFERRED:** Firefox 156.0.1 is present; geckodriver and Chromium are absent. apt has no geckodriver candidate; noninteractive sudo unavailable. Upstream latest geckodriver is v0.37.1. Its release asset signature reports Mozilla subkey 09BEED63F3462A2DFFAB3B875ECB6497C1A20256 / key id 5ECB6497C1A20256. Mozilla later publicly revoked that subkey after an accidental August 2026 leak and rotated to a new subkey. Installing that executable immediately before important work was rejected under proportional-rigor/supply-chain rules. Reuse: Linux browser packaging roadmap.
- **Durable-state debt — CONFIRMED, NON-BLOCKING:** Windows 805 pending / 81 interrupted / 109 reconciliation-required / 616 completed-undelivered; Linux 105 / 4 / 5 / 39. Current leases/active operations/queued work are zero and dead letters/unfinished requests do not show an active execution blockage. Do not bulk-delete; first classify active vs historical/stale/external-wait/superseded and preserve evidence.
- **Autonomy asymmetry — CONFIRMED:** Windows automaticExecution=true, runnerConfigured=true for enrolled execution; Linux automaticExecution=false, runnerConfigured=false with RECOVERY_AND_READINESS_ONLY automatic continuation. Preserve current policies before important work; decide parity later with explicit scope/risk review.
- **Unpromoted development — UNPROVEN/CURRENTLY EXCLUDED:** a local fix/v0.10.1-boot-recovery-diagnostics worktree exists with improved diagnostic reporting/version changes. It is not release authority and must follow normal focused/full/hosted gates before any promotion.
- **Local evidence:** Windows readiness artifact SHA-256 f1f7ad9c126125d85ef0d5ab8c37d94bad458e2e5c7ed07690a4239e00eea7d4; Linux readiness artifact SHA-256 bcca4f4529350c186f2568a0fac389f2c74b101cc3d83b8c943e9e88dc72038f.
- **Reuse targets:** next release planning, durable-state cleanup design, Linux parity/browser provisioning, fleet dashboard, security/sandbox roadmap, post-important-task expansion.

## 2026-09-29 — v0.10.1 maintenance evidence

- **BootRecovery diagnostics — CONFIRMED/HIGH:** self-test exceptions are now serialized when SelfTestOutput is requested; installer reports exact structured error or, if no result exists, task state + LastTaskResult. Synthetic isolated-profile hash mismatch regression PASS. No automatic repair introduced.
- **Root-cause correction — CONFIRMED/HIGH:** earlier draft text claimed a specific live config-hash drift root cause. Later authoritative activation evidence did not prove that as the cause of the initial timeout; exact SYSTEM probes subsequently passed. Final release text therefore classifies the initial missing result's precise cause as UNVERIFIED while fixing the diagnostic blind spot.
- **Durable-state semantics — CONFIRMED/HIGH:** scheduler pending is a persisted enabled-nonterminal count and must not be read as proof of a live execution queue. v0.10.1 exposes persistedNonterminal, pendingMeaning=PERSISTED_NONTERMINAL_RECORDS_NOT_LIVE_QUEUE, currentLeases, and hasActiveLease without mutating history.
- **CI determinism — CONFIRMED/HIGH:** inherited-stdio regression now tests the actual invariant: operation reaches SUCCEEDED while the stdio-holder PID is still alive. Holder lifetime is 60s, explicit cleanup follows, and production timeout semantics are unchanged. Ten consecutive focused runs PASS.
- **Local candidate gate — CONFIRMED/HIGH:** full suite 493 pass / 0 fail / 6 skip, Project Engine 222/0/1 skip, security audit PASS, diff PASS. Final-gate log SHA-256 50e3bc6acf589884de2d369022e0cb6da89da32f826a4d521a411e501666eee3.
- **Reuse targets:** release notes, support diagnostics, workflow observability, CI reliability, future historical-state reconciliation.


## 2026-09-29 — v0.10.1 publication/live finalization evidence

- **Release identity — CONFIRMED/HIGH:** `v0.10.1` annotated tag peels to `b65c48ff8c2fdacd6fbfe0efef4d90742a9e791c`, the PR #68 merge commit on main.
- **Hosted qualification — CONFIRMED/HIGH:** CI run 36580307031 succeeded on ubuntu-latest and windows-latest. Server Install Canary run 36580307099 succeeded on linux-clean-container and windows-server-bootstrap.
- **Release artifacts — CONFIRMED/HIGH:** GitHub Release published with draft=false/prerelease=false and 19 assets. Independent temporary download verified every one of the 18 payload assets against `SHA256SUMS.txt`; result `RELEASE_ASSET_CHECKSUM_PASS`.
- **Windows live core — CONFIRMED/HIGH:** canonical control HEAD and default/saeed-emad routed backends all exact `b65c48ff...` / v0.10.1; both tunnels ready; doctor PASS; previous=null; no current operations/queue/locks/leases.
- **Linux projection mismatch — FAILURE -> ROOT CAUSE -> PREVENTION evidence:** runtime route promoted to v0.10.1 while canonical install checkout remained detached at v0.10.0, so doctor correctly failed expected-version comparison. Root cause of the observed doctor failure was canonical control projection lag, not runtime failure. Official v0.10.1 maintenance updater was rerun with exact tag+commit; complete check/test/audit/schema/hardware qualification passed, canonical checkout became `b65c48ff...`, doctor/service/tunnel passed, and update log recorded AUTO_UPDATE_PASS. Reuse target: updater post-promotion projection/readback regression.
- **Durable state semantics — CONFIRMED/HIGH:** both live hosts expose `pendingMeaning=PERSISTED_NONTERMINAL_RECORDS_NOT_LIVE_QUEUE`, `currentLeases=0`, `hasActiveLease=false`. Historical counts are not live-queue evidence and were not deleted.
- **Windows recovery task regression — CONFIRMED absence / cause UNVERIFIED:** post-release Task Scheduler inventory found BootRecovery and UserSessionHandoff absent although prior v0.10.0 acceptance had installed/validated them. Search found no update/install path unregistering them; explicit disable script remains the only found intentional remover. Do not attribute deletion to updater without evidence.
- **Repair attempt — BLOCKED:** official v0.10.1 elevated repair was launched with evidence-file output, but UAC returned `operation was canceled by the user`. No task mutation occurred. Blind retry rejected.
- **Issue disposition:** #62 and #65 closed as completed by v0.10.1; #69 opened for missing Windows recovery tasks and prevention guard; #66 remains real reboot/power-return validation.
- **Reuse targets:** release support, installer/updater regression design, recovery readiness, future final-live seal.


## 2026-09-30 — Windows retained-backend CURRENT fast-path cleanup gap

- **Live evidence — CONFIRMED / HIGH:** Windows v0.10.1 default and `saeed-emad` routes are healthy/current with no previous route, but `retained-backends.json` still contains four historical entries.
- **Identity/liveness audit:** v0.9.12:48833, v0.9.21:48834 and v0.10.0:48837 have no listener and no recorded terminal PID still alive. v0.9.10:48831 has no listener but terminal PID 44432 is still alive and must remain protected.
- **Root cause — CONFIRMED:** `Complete-RetainedBackends` exists and runs in full promotion admission, but the already-current fast path performed `Complete-DeferredDrains` and `Cleanup-Releases` without first reconciling retained entries. `Get-ProtectedReleasePaths` therefore kept dead retained release directories protected indefinitely while the system stayed current.
- **Correction — PATCHED:** current fast path now calls `Complete-RetainedBackends` before deferred-drain handling and release cleanup.
- **Focused regression — PASS:** updater + retained registry tests 15/15 PASS; diff check PASS.
- **Safety invariant:** live-terminal entry v0.9.10 / PID 44432 is still preserved by the existing reconciler; no manual registry edit and no process kill is introduced.
- **Reuse targets:** Windows updater lifecycle, retained-backend maintenance, release storage cleanup, failure-prevention guidance.


## 2026-09-30 — retained-maintenance full local regression PASS

- **Focused updater/retained regression:** 15 pass / 0 fail.
- **Complete local regression:** `npm run check` PASS; `npm test` 493 pass / 0 fail / 6 platform skips; `npm run audit` -> `SECURITY_AUDIT_PASS`.
- **Contracts also PASS:** GUI 77/77, Linux GUI contract, Windows runtime contract, source integrity, schema continuity, browser cleanup/path encoding, concurrency smoke, filesystem safety.
- **Scope confirmation:** production delta is one updater fast-path call plus three ordering assertions; no authority, routing, runner, timeout, browser/GUI, Linux policy, or destructive cleanup semantics changed.
- **Promotion status:** LOCAL PASS. Next authority: committed exact tree -> fresh hosted Windows/Ubuntu CI + both server-install canaries -> merge. Live maintenance is deferred until merged/released exact source is authoritative.


## 2026-09-30 — retained-backend liveness correction after current audit

- **New live evidence — CONFIRMED / HIGH:** re-audit on the current Windows v0.10.1 runtime found all four retained entries (v0.9.10:48831, v0.9.12:48833, v0.9.21:48834, v0.10.0:48837) with no listener and no registered terminal PID still alive.
- **Correction to earlier snapshot:** the previous retained-maintenance record correctly identified the CURRENT fast-path cleanup gap, but its liveness snapshot (v0.9.10 / PID 44432 still alive) is now superseded by this newer read-only audit. No historical text is rewritten.
- **Implication:** after authoritative promotion of the existing safe CURRENT-path reconciler, all four retained registry entries are now eligible for normal reconciliation subject to the reconciler's own final precondition checks at execution time.
- **Storage context:** retained release/runtime directories themselves are small (single-digit MiB each); the Windows state tree's main storage consumers are update-backups, release-acceptance, validation, tools, chess-gui-test and benchmarks. Retained-registry cleanup is lifecycle correctness first, not a multi-GB disk cleanup.
- **Safety:** no manual registry edit, process kill or direct directory deletion was performed.


## 2026-09-30 — v0.10.2 publication and Windows rollout qualification failure

- **Release authority — CONFIRMED/HIGH:** immutable `v0.10.2` release published with 19 assets; annotated tag peels to merge commit `bc126ddf6351e107785096c1eec659cdf2982c1d`.
- **Hosted release gates — CONFIRMED/HIGH:** exact-candidate Windows/Ubuntu CI and Windows Server/clean-Linux canaries PASS; post-merge Windows/Ubuntu CI PASS.
- **Linux live rollout — CONFIRMED/HIGH:** candidate-first update promoted routed runtime to v0.10.2 / exact commit `bc126ddf...`; health PASS, FULL_POWER preserved, systemd service active.
- **Windows rollout attempt 1 — ROOT CAUSE CONFIRMED:** stale base `app/config.local.json` reported STANDARD while authoritative active-route runtime config was FULL_POWER. Passing `-StandardMode` changed the candidate tool catalog and the schema-continuity gate correctly blocked promotion with `TOOLS_LIST_REFRESH_UNNEGOTIATED`. Rollback preserved live v0.10.1. **Prevention:** derive rollout authority from the active routed runtime/config, not a stale canonical projection.
- **Windows rollout attempt 2 — FAILURE / runtime defect UNPROVEN:** with correct FULL_POWER authority, full qualification reached 499 tests and failed exactly one test: `profile-instance-http.test.mjs` health readiness after 12.59 s. The server emitted its listening banner; no product/runtime assertion failed.
- **Flake evidence — CONFIRMED/HIGH:** exact v0.10.2 failing test subsequently passed 10/10 isolated repetitions on the same Windows host (~0.46–0.59 s) and had passed hosted Windows CI twice (~0.54–0.55 s). This supports load-sensitive fixed startup-window flake rather than runtime failure.
- **Prevention patch — PATCHED / FOCUSED PASS:** isolated-profile HTTP readiness now uses a 30 s elapsed deadline plus early child-exit diagnostics, reusing the accepted transport-correlation pattern. Patched focused regression: Windows 10/10 PASS, Linux 3/3 PASS.
- **Point-in-time promotion status / later superseded:** at the moment of those failed attempts Windows had rolled back safely to v0.10.1 and no bypass was used. Subsequent fully qualified v0.10.2 publication/deployment completed; current accepted Windows and Linux production authority is v0.10.2 at exact release commit `bc126ddf6351e107785096c1eec659cdf2982c1d`.
- **Reuse targets:** updater authority-source selection, qualification-flake prevention, release/runbook diagnostics, future candidate-first rollout automation.


## 2026-09-30 — v0.10.3 inherited-stdio hosted qualification hardening

- **Hosted evidence — CONFIRMED/HIGH:** PR #79 exact head `8e72bed5dd8f42964e4d140af98e02307c67034d` had successful Windows CI and server-install canary evidence, but Ubuntu pull-request CI attempts 1 and 2 both failed the same `child exit completes operation while inherited-stdio holder is still alive` regression after about 20.1 seconds.
- **Runtime-defect evidence — NOT ESTABLISHED:** the exact unpatched head passed the same regression 20/20 isolated repetitions on the Linux validation host; the production worker already bounds post-exit stdio drain. No production async-operation source is changed by this correction.
- **Root test-harness weakness — CONFIRMED:** the fixture unnecessarily made direct-child exit contingent on the asynchronous stdout write callback even though the property under test is direct-child exit while a detached descendant retains inherited fds.
- **Prevention patch — PATCHED:** fixture writes the tiny marker synchronously to fd 1 and then explicitly exits; the detached holder remains alive, preserving the actual inherited-stdio condition without callback-timing dependence.
- **Focused regression — PASS:** patched inherited-stdio stress Linux 30/30 and Windows 10/10.
- **Complete Linux candidate gate — PASS:** `npm run check` 262 tests / 260 pass / 0 fail / 2 skip; `npm test` 499 tests / 497 pass / 0 fail / 2 skip; GUI/Linux/Windows/source/schema contracts PASS; `SECURITY_AUDIT_PASS`.
- **Promotion boundary:** hosted Windows+Ubuntu exact-new-head CI and server-install canaries remain mandatory before merge. v0.10.2 remains production authority until immutable v0.10.3 publication and candidate-first rollout complete.
- **Reuse targets:** CI determinism, inherited-stdio lifecycle regression design, release qualification, no-runtime-change maintenance policy.


## 2026-09-30 — v0.10.3 post-merge workflow recovery qualification hardening

- **Post-merge evidence — FAILURE/HOSTED WINDOWS:** main merge commit `091cfb9e1ef131f5b18f5cf03976f2271ada4b93` passed Ubuntu CI but Windows full qualification had one failure in pending workflow handoff restart recovery at `assert.ok(recovered)`.
- **Production defect — NOT ESTABLISHED:** the exact merge commit passed the same isolated regression Windows 15/15 and Linux 20/20. v0.10.2 production remains unchanged and authoritative.
- **Root test-harness weakness — CONFIRMED:** the regression observed an automatic startup `queueMicrotask` recovery path through a fixed 3-second wall-clock window, vulnerable to hosted Windows scheduling pressure.
- **Prevention patch — PATCHED:** preserve automatic recovery semantics, but use a bounded 30-second elapsed observation window and include exact controller status in any failure diagnostic.
- **Scope:** test/documentation only. No workflow runtime, scheduler, conversation-store, delivery, routing, authority, or production timeout behavior changed.
- **Promotion boundary:** fresh exact-head Windows+Ubuntu CI and canaries plus local qualification are required before publication. No blind rerun of the failed main build is accepted as proof.


## 2026-10-01 — exact-main repository audit evidence

- Authority: main ac02b9a0ef33f781d3b8cbd6f70a88fbce92092a; immutable production release remains v0.10.3 at 37a57b72c25a793e32e0095f308f065afb1561a2.
- Static PASS: 329 tracked files / about 45,975 lines; node syntax 165/165; bash syntax 16/16; JSON/YAML parse clean; broken relative Markdown links 0; non-doc TODO/FIXME/HACK/XXX 0; secret-pattern hits 0; GitHub Actions full-SHA pinned; git fsck/diff-check clean.
- Dynamic exact-head PASS: Linux and Windows check:qualification, test:qualification, security audit and doctor all exited 0. Linux full test 499/497 pass/0 fail/2 skip; Windows full test 499/493 pass/0 fail/6 platform skips.
- Readiness race CONFIRMED: PR #75 carried a test-only mcp-runtime marker wait that was absent from main. Rebased correction waits for parseable exact port/project identity after health readiness.
- Named-profile owner-policy gap CONFIRMED: main applied merge-primary-policy only for the default Windows profile. Named-profile target discovery could select routed generated config without the newer explicit canonical owner runner policy. The correction reuses the same fail-closed overlay for every profile while preserving active runtime fields.
- Linux tunnel helper mode NOT A DEFECT: source helper is intentionally callable through /bin/bash and fresh installer explicitly chmods the installed helper; regression tests enforce this.
- Storage issues #81, #82 and #83 remain accepted open product debt requiring dedicated design/regression.


## 2026-10-01 — issue #81 backup amplification evidence

- Confirmed source cause: `src/power-tools-v0.3.mjs` copied the full existing target before every append.
- Candidate invariant: append no longer copies prior payload bytes; it writes a verified `append-truncate-recovery` journal before mutation.
- Rollback proof: truncate to journal `beforeBytes`, then verify exact `beforeSha256`.
- Retention invariant: newest rollback point exists and is verified before older file rollback containers for the same target are pruned; minimum retention is 2 and default is 8.
- Safety preserved: expectedSha256 precondition, path locks, canonical/symlink guards and post-write hash checks remain active.


## 2026-10-01 — issue #82 identity-safe delivery compaction evidence

- Logical acknowledgement boundary remains unchanged: only exact claim plus delivery_ack can transition a record to DELIVERED.
- Compaction mutates artifact storage only; it returns logicalStateChanged=false and acknowledgementSynthesized=false.
- Archive integrity is bound to the original content SHA-256 and byte length before plain data is removed.
- Read path transparently reconstructs archived bytes under the existing delivery/correlation identity check.
- Candidate selection excludes live DELIVERY_PENDING, DEAD_LETTER, and unresolved/non-COMPLETED kinds.


## 2026-10-01 — issue #83 tunnel-log rotation evidence

- Upstream capability verified from pinned tunnel-client v0.0.15: `--log.file` defaults to stdout and accepts explicit `stdout`.
- Safety design: tunnel-client does not own the rolling file; Commander wrapper owns the file, so rotation does not mutate a file descriptor held by the live tunnel process.
- Bound: current log <= 8 MiB; at most 3 gzip archives; legacy oversize migration preserves only the newest bounded diagnostic tail.
- Machine-readable status: `tunnel-<profile>.log.rotation.json` records active state, child PID, current bytes, limits, archive count, rotation count/time and terminal reason.
- Credential boundary: wrapper receives the existing process environment only long enough to spawn the tunnel child, then removes CONTROL_PLANE_API_KEY and OPENAI_API_KEY from its own environment copy. No secret is written to status.
- Regression: forced multi-rotation test reconstructs the exact complete stdout+stderr byte stream without child restart; Linux and Windows launch contracts use `--log.file stdout`.


## 2026-10-01 — Git blob normalization evidence

- Authority: main 219f101291ada1488f6f961e3844b94326770474.
- Its tree exactly equals qualified PR #87 head b45fe4e30fe9c1fcf76c15ef1add47c934f400a9.
- PR #87 exact head has hosted CI PASS and Server Install Canary PASS.
- Fresh Linux clone reported exactly two modified paths immediately after checkout: autostart-windows.ps1 and windows-supervisor-runtime.ps1.
- git add --renormalize . identified exactly those two paths; git diff --ignore-space-at-eol was empty.
- Corrective invariant: Git stores canonical LF for both blobs; checkout line endings remain governed by .gitattributes, eliminating dirty-clone drift without changing PowerShell semantics.

## 2026-10-01 — v0.10.4 release-preparation evidence

- Release base: main eaba1122db96f7a47172ee0c1cc5ad96c7840b0e.
- Release reason: main contains accepted post-v0.10.3 runtime/storage hardening and must not continue to advertise package/runtime identity 0.10.3.
- Version projections promoted together: package.json, both Plugin manifests, server runtime constant, onboarding version guard and release-asset contract.
- Unreleased changelog promoted to 0.10.4 dated 2026-10-01 and docs/RELEASE_0.10.4.md created.
- Publication is not accepted until exact-candidate Linux/Windows qualification, hosted CI, server-install canaries, asset checksum verification, immutable tag/release and live rollout all pass.


## 2026-10-01 — v0.10.4 Linux server-canary timing hardening
- PR #89 exact head 8ef7ad3a799c3dc17493d47388e8d391b35fda35: hosted CI PASS and Windows Server canary PASS; clean-Ubuntu server canary reached full test qualification and failed only the corrupt-terminal-projection hash-mismatch regression.
- Failure boundary was exact: the fixture's pre-corruption worker had not reached terminal state before the generic 10-second test wait; failure occurred at about 10.03 seconds before deliberate projection/receipt corruption.
- The same release code passed local Linux qualification and hosted CI; no production async-operation behavior is changed.
- Prevention: the single load-sensitive corruption fixture now uses a 30-second elapsed terminal/worker-exit observation window, and generic wait failure diagnostics include last status/worker PID. This remains test-only synchronization.


## 2026-10-01 — async live-worker reconciliation invariant
- Hosted Ubuntu CI on PR #89 head a5ca9d236b46aa5064aab528b217c7d042639ce1 failed the dead-worker exact-receipt regression at about 10.03 seconds: status became UNCERTAIN before the test could observe the worker final receipt.
- Production root cause: manager deadline is reservation-relative, while worker timeout is start-relative; scheduler delay can therefore make manager reconciliation outrun a live worker.
- New invariant: a live worker is not downgraded at the reservation deadline while its actual startedAt+timeoutMs+10s finalization window remains open.
- If startedAt is not yet persisted but the worker PID is alive, a separate bounded 60s scheduling hard guard prevents indefinite masking.
- Missing worker plus expired deadline behavior is unchanged; it remains fail-closed UNCERTAIN with no automatic replay.


## 2026-10-01 — PR #89 Windows qualification closure

- Exact failing head: 43f4b70f7d51e452fb861a235a6ba1685152b720.
- Ubuntu CI: PASS. Windows check qualification: one failure, inherited-stdio holder PID marker read as empty/invalid before the semantic operation assertion.
- Root cause: readiness helper checked path existence only while fixture used asynchronous direct-to-final-path write; creation visibility can precede readable payload bytes.
- Prevention: fixture publishes the PID marker via completed temporary write plus atomic rename. No production async behavior is changed by this fixture fix.
- Production async live-worker grace remains separately bounded and now has both positive (do not downgrade within actual worker budget) and negative (fail closed after hard finalization deadline) regression coverage.
- Release identity projections are complete across package/runtime/plugins/public installers/installer contract/release contract/final-gate log.


## 2026-10-01 — final hosted qualification determinism evidence

- PR #89 exact head and merge commit share the same tree `7988c877aa2b3d935483e0df6f5cc81c7d24ba56`.
- PR #89 exact head: hosted Windows CI PASS, Ubuntu CI PASS, Windows Server Canary PASS, clean Linux Server Canary PASS.
- Post-merge main Windows check under grouped file concurrency produced tunnel-log/workflow fixture failures; focused exact-main Windows reruns passed tunnel-log 12/12 and workflow-http 8/8.
- Publication-helper rerun exposed a separate async-operation 10-second observation boundary under hosted Ubuntu load.
- Final harness invariant: workflow-http, async-operations and tunnel-log-rotation each run as isolated test-file commands in check/test qualification; affected fixture observation waits are 30 seconds.
- No production source or runtime deadline is changed by this harness closure.


## 2026-10-01 — hosted Windows OOM ordering evidence

- main 2321b887b15b22733a3d2f4a092ad7620bf49290: Ubuntu CI PASS; Windows check PASS; Windows test qualification failed only in the final isolated tunnel-log-rotation command.
- Failure signature: Array buffer allocation failed followed by Node heap OOM in a fixture that allocates sub-megabyte buffers; no production assertion failed beforehand.
- Existing isolation alone was insufficient because the sensitive files still ran after the large batch.
- Candidate guard: hosted Windows CI passes --prioritize-sensitive=1 to the bounded qualification wrapper. The wrapper orders tunnel-log-rotation first, then async-operations and workflow-http, all before the bulk batch; it does not alter production code, package scripts, installer/update qualification concurrency, assertions, or runtime deadlines.


## 2026-10-02 — stream-resume resilience / Desktop Commander comparison

**Context:** repeated ChatGPT "Resume stream unavailable" during Commander-heavy long turns.

**Finding:** the actionable difference in Desktop Commander's public implementation is process/result decoupling: process start returns quickly, running state persists, output is read later with bounded pagination/offsets, and history/buffers are capped. This avoids making completion depend on one long-lived assistant response stream.

**Remote Commander root-cause contribution:** durable operation/MCP Tasks already existed, but a stale ChatGPT app tool catalog can omit them, while the compatibility terminal reader previously returned all unread output and direct synchronous tools could return comparatively large structured payloads.

**Decision/Guard:** long or high-output work never earns a larger synchronous timeout. Prefer durable operation_start; if unavailable in the client catalog, use start_terminal once, read bounded terminal pages, allow at most one <=5 s wait window per turn, then close as BACKGROUND. Direct sync budget is 10 s, output 32 KiB, and two direct calls/turn.

**Regression:** 13/13 focused PASS; 31/31 MCP/transport PASS; final full qualification 483/483 non-skipped PASS in the main batch, 6 platform-gated SKIP, with downstream GUI/source/schema gates PASS.

**Limitation:** this mitigates Commander's contribution; it cannot repair ChatGPT's host-side resume/cache service. Plan/tier differences remain UNPROVEN as a causal explanation.


## 2026-10-02 — v0.10.6 exact-tree local qualification

Status: LOCAL_FULL_GATE_PASS / HOSTED_GATES_OPEN.

Exact release workspace baseline: official v0.10.5 commit d6912c750640ca57a67be4a9cc8e6485653eb36c plus production operation-child lifecycle hardening and versioned non-runtime experimental snapshots.

Evidence on Windows saeid / Node 24.19.0:
- production operation-child lifecycle targeted regression: 14/14 PASS;
- Owned Browser R3 packaging-rebound focused tests: 11/11 PASS;
- project-operations V03 focused suite: 100/100 PASS;
- paused-domain policy: 27/27 PASS;
- check qualification: PASS, including 248 tests / 243 pass / 0 fail / 5 Windows-host platform skips, GUI 77/77, schema continuity 9/9, source integrity and runtime contracts PASS;
- test qualification: 489 tests / 483 pass / 0 fail / 6 platform-gated skips, followed by workflow/async/tunnel/browser/GUI/source/schema downstream gates PASS;
- security audit: PASS with no secret/token/private-key/developer-path finding;
- installer check, onboarding plugin check and release asset contract: PASS.

Acceptance boundary: this is local exact-tree qualification only. GitHub hosted Windows/Ubuntu CI, server-install canaries, merge, tag, release assets and downstream update/readback remain OPEN. v0.10.5 remains rollback authority until those gates pass.


## 2026-10-03 — v0.10.6 publication, Linux rollout, and CEF preview closure

**Context / objective:** move Saeid development from local/draft state into versioned GitHub authority without promoting unqualified experimental components.

**Commander release claim — CONFIRMED / HIGH:** stable GitHub release `v0.10.6` is published, not draft/prerelease, and contains exactly 19 uploaded assets with SHA-256 metadata. Annotated tag peels to exact release commit `3546256e8e7c494d140bc9c33259ddbf345639d3`; exact release tree is `cce09e13b834c17a055b3448e808089966e1125a`.

**Windows test-contract root cause — CONFIRMED / HIGH:** the prior tunnel-log failure treated stdout/stderr as one globally ordered stream even though they are independent OS pipes. Equal byte counts and a boundary-local reorder established a test-contract nondeterminism rather than data-loss evidence. PR #102 changed only the test invariant: exact byte totals/chunk counts and per-stream order remain strict; cross-pipe global arrival order is no longer required. Hosted Windows and Ubuntu CI passed before merge.

**Release-orchestration root cause — CONFIRMED / HIGH:** a tag pushed by GitHub Actions using the repository `GITHUB_TOKEN` did not trigger the downstream tag workflow. Prevention used the already-proven one-shot publisher pattern: verify exact tag target/tree/version, rebuild official assets, verify SHA256SUMS, require exactly 19 assets, then publish. Publisher run completed successfully; one-shot workflows were removed from main after readback.

**Proportional-rigor decision — ACCEPTED:** the asset-publisher PR modified only release workflow code, not product bytes. It was merged after exact product target qualification (hosted Windows/Ubuntu + prior server canaries + independent Linux canary) and exact target/tree guards, without waiting for an unrelated duplicate full-product suite on the publisher-only head. Publisher itself then passed exact-target, asset-build, checksum and publication gates.

**Linux independent canary — CONFIRMED / HIGH:** `aliemad-Labtop` cloned exact tag v0.10.6 and ran official auto-update with `--no-promote`. Qualification/security/doctor/browser/workflow/hardware gates passed; main qualification observed 489 tests with 487 pass / 0 fail / 2 platform skips and final marker `AUTO_UPDATE_CANDIDATE_PASS`.

**Linux live rollout — CONFIRMED / HIGH:** live readback after promotion reports v0.10.6 on port 48831, exact commit `3546256e...`, config SHA-256 `7358d66a665e3fbabb70b76cc09d3180a27e62571d685a28c1793423d6836c02`, route generation 113, FULL_POWER preserved, workflow DB integrity `ok`, active operations 0 and leases 0. The pre-existing dirty development checkout was not modified. v0.10.5 release bytes remain on disk for rollback.

**State/backlog boundary — CONFIRMED:** 105 persisted nonterminal workflow records, 4 interrupted, 5 reconciliation-required and 205 completed-undelivered records remain on the laptop. These are not a live queue and include unrelated real user projects; no mass cleanup/replay was performed. Any UNCERTAIN result remains fail-closed and must not be blindly replayed.

**CEF preview claim — CONFIRMED / HIGH:** `Usefull-Skills/chatgpt-cef-linux` prerelease `v0.8.0-rc.1` was rebuilt and native-qualified on Linux before publication. Annotated tag points to exact candidate `1581c8012dbbb08b88517e01aa5e4f4ab2eb97f3`. Published assets: Linux x86_64 binary SHA-256 `781e6eaf19317c40b2566f5630a7415fe39ed5d6460117e50fdd6564e15d2f66`, source SHA-256 `58e1067b29e5c712af677d47382890f722cf66fbf432a35d7549a10c67484865`, checksum-file asset digest `684994107e226d38a077257973fffb7bd27712c374082b615a94d2fc9160b781`. Stable CEF remains v0.7.1; Windows and end-to-end integration are UNPROVEN.

**Superseded history:** Commander PR #99 and CEF PR #51/#52 were closed with explanatory comments after their required source was preserved/versioned. Branch/history were retained; closing does not imply experimental acceptance.

**Limitations / open gates:** Saeid direct Commander readback was unavailable in this session; Emad Windows connector was not exposed/reliably accessible. Therefore their v0.10.6 rollout is MISSING, not completed. CEF Windows native build/install, V03 native integration, current-session transport and sustained end-to-end acceptance remain open.

**Reuse targets:** release engineering, updater/runbook, Project Brain/handoff, Windows rollout, CEF cross-platform roadmap.


## 2026-10-03 — v0.10.8 release and reachable-host rollout closure

**Context / objective:** finish the v0.10.7 rollout, resolve the real Windows stale-drain blocker discovered during that rollout, publish the corrected release, and update every safely reachable host without blind process termination.

**Root cause — CONFIRMED / HIGH:** on HPC-159-17 the old Commander backend was independently idle, but its owned persistent `tools/browser-control.mjs --server` descendant caused the candidate-first updater to return a blocked existing drain. Process existence alone was insufficient evidence of active browser work.

**Fix — CONFIRMED / HIGH:** v0.10.8 queries `browser_status` from the exact owned old backend and permits the direct Commander browser helper to participate in safe drain retirement only when `active=false`, `busy=false`, `leased=false`, and `uncertain=false`. The same proof is applied to retained-work evidence. Any status failure, activity, lease, uncertainty, identity mismatch, unexpected connection, or unowned descendant remains fail-closed.

**Product provenance — CONFIRMED / HIGH:** accepted product candidate `23dea9881f8d60959f499d7e39e78df676d3b8ae` and main release merge `4ca2efe57ceb6d22a75176420fc41ae904666f00` have the identical tree `92b628765f5d19a090eddb1654e2d936a0e6775e`. Hosted CI and Server Install Canary both passed on the candidate. The main merge adds no product-byte difference.

**Real regression — CONFIRMED / HIGH:** HPC-159-17 was the previously blocked route and successfully reached live v0.10.8 through the updater-owned candidate/drain path without manual killing of the browser helper. Its live route points to `23dea988...`, which is byte-identical to the immutable release tree.

**Release publication — CONFIRMED / HIGH:** immutable stable GitHub release `v0.10.8` is published from annotated tag object `590d162299ccf6d3831c4b8269263884adc31fc6`, peeling to exact commit `4ca2efe57ceb6d22a75176420fc41ae904666f00`. Release is draft=false, prerelease=false and contains exactly 19 uploaded assets with SHA-256 metadata. The tag is unsigned; no signed-release claim is made.

**Representative asset evidence:** Linux setup SHA-256 `7e230dfd6ac0e6a9bde926fb8762958bd3dd233aad91ddb8aa9bf47419d8bffe`; Windows setup SHA-256 `2db196d7b8a217f1d114d73341ed95dd8f9fa7a05f150ae890f9bb3e1866ffcf`; installer ZIP SHA-256 `eae4f432aae1cd438a5767b569fe8b45d0d612dde367bdcb248f5cd5d79345cb`; release `SHA256SUMS.txt` asset digest `a989d0d41fd9641145f1b4f86414e72a24c8c9257571081d27a3650a69e25c50`.

**Linux canary / rollout — CONFIRMED / HIGH:** aliemad-Labtop cloned exact tag v0.10.8, ran candidate-first `--no-promote` qualification with 0 failures, security audit PASS, workflow DB shadow backup integrity `ok`, doctor/version/config match, browser/GUI/hardware gates PASS and `AUTO_UPDATE_CANDIDATE_PASS`. Promotion live readback: version 0.10.8, commit `4ca2efe...`, config `ccd7774466f3b1437c345c3e2b2188b2f2505ea2e4b3fbf5140d660088730d95`, route generation 117, DB integrity `ok`, active operations 0, current leases 0. The dirty development checkout was not overwritten.

**HPC-154-66 canary / rollout — CONFIRMED / HIGH:** exact-tag Windows `-NoPromote -SelfTest` returned `RC0108_WINDOWS_CANARY_PASS`. Promotion live readback: version 0.10.8, commit `4ca2efe...`, config `b32e344d49d7886e5d0f1849879aef7d345aef25c1fac1a9d0e5e25d22324905`, route generation 33, DB integrity `ok`, active operations 0, current leases 0.

**Saeid boundary — MISSING / FAIL-CLOSED:** direct Saeid connector reports that tunnel-client has not been seen for 300 seconds. No blind update, process kill, or inferred live-version claim was performed. Saeid rollout remains OPEN until connectivity and readback return.

**State/backlog boundary:** existing durable workflow/delivery/history records are not release garbage. They remain preserved; no mass cancel, synthetic acknowledgement, or blind replay was used to make rollout numbers look clean.

**Reuse targets:** updater drain policy, release runbook, Windows regression suite, Project Brain/handoff, CEF integration boundary.


## 2026-10-04 — v0.10.9 authority recovery and MMZ Linux fresh-audit start

- **Context:** Continued deep audit on Emad laptop only after the prior session interruption. The visible source worktree was stale at v0.8.20, while the installed Commander runtime/control checkout was v0.10.9.
- **Claim / Decision:** The authoritative stable release is `v0.10.9`, product commit `157d2b18c2c2a2d6a144148230a30b0418eea8c4`. Do not develop from the stale v0.8.20 checkout.
- **Evidence / Source:** GitHub annotated tag object `ef32598f34df99d9c0390ae04749c02088d42ea0` peels to `157d2b18...`; immutable release id `402919128`, published `2026-10-04T08:21:50Z`, stable and not prerelease/draft, exactly 19 digest-bearing assets. Local installed checkout HEAD is `157d2b1`; Remote Commander system status reports `0.10.9`.
- **Confidence / Status:** CONFIRMED / ACCEPTED for release identity and publication.
- **Reuse Targets:** release report, handoff, project Brain, future upgrade baseline.
- **Provenance:** GitHub repository `GOD13emad/ChatGPTRemoteCommander`; local control checkout `/home/mmz/.local/share/ChatGPTRemoteCommander`.

- **Claim / Decision:** Exact release SHA has accepted hosted CI evidence.
- **Evidence / Source:** GitHub Actions `CI` run `37188105744` on branch `main`, head `157d2b18...`, completed success. Ubuntu job completed full check, full test and audit successfully. Windows job completed bounded qualification check, bounded qualification suite and audit successfully. Release Sync run `37188105716` also completed success.
- **Confidence / Status:** CONFIRMED / PASS for those exact hosted runs.
- **Reuse Targets:** release acceptance, regression baseline, audit report.
- **Provenance:** GitHub Actions metadata/job records for exact SHA.

- **Claim / Decision:** A same-SHA publisher-branch Windows failure is contradictory evidence and is not to be hidden or blindly rerun.
- **Evidence / Source:** CI run `37188394413` on `release/v0.10.9-publisher`, same head `157d2b18...`: Ubuntu PASS; Windows failed at `Run qualification check with bounded Windows file concurrency`. Current main comparison against release product SHA changes only `.github/workflows/release-v0.10.9-publish-once.yml`.
- **Confidence / Status:** CONTRADICTORY / ROOT CAUSE UNVERIFIED. It does not invalidate the separate exact-SHA main PASS by itself, but it is an open reproducibility/root-cause item.
- **Reuse Targets:** failure-prevention record, release evidence notes, next regression audit.
- **Provenance:** GitHub Actions run/job metadata; GitHub compare `157d2b18... -> 6f192c96...`.

- **Claim / Decision:** The two apparent local modifications in `enable-autostart.ps1` and `enable-boot-recovery.ps1` are EOL-only, not semantic drift.
- **Evidence / Source:** `git diff --ignore-space-at-eol --exit-code -- enable-autostart.ps1 enable-boot-recovery.ps1` returned exit 0 and no diff.
- **Confidence / Status:** CONFIRMED.
- **Reuse Targets:** host audit, drift triage.
- **Provenance:** MMZ Linux installed control checkout.

- **Claim / Decision:** Fresh local Linux qualification is being executed against exact installed v0.10.9 checkout before any further product mutation.
- **Method / Parameters:** `npm run check:qualification && npm run test:qualification && npm run audit` in `/home/mmz/.local/share/ChatGPTRemoteCommander`.
- **Observed Result So Far:** zero failures in observed check/test batches; one observed major test batch reported `493 pass / 0 fail / 5 skipped`. Windows-only gates are expected platform skips on Linux.
- **Confidence / Status:** IN PROGRESS / FINAL PASS UNPROVEN until terminal exits 0 and audit completes.
- **Reuse Targets:** local acceptance, Project Brain promotion, handoff.
- **Provenance:** Remote Commander persistent terminal `term-64`.


### 2026-10-04 — MMZ Linux v0.10.9 fresh qualification closure

- **Claim / Result:** Fresh local Linux qualification of the exact installed v0.10.9 control checkout completed successfully.
- **Method / Parameters:** `npm run check:qualification && npm run test:qualification && npm run audit` in `/home/mmz/.local/share/ChatGPTRemoteCommander`, persistent terminal `term-64`.
- **Evidence / Result:** terminal exited `0`; observed check/test batches reported zero failures, including a major `test:qualification` batch of `498 tests / 493 pass / 0 fail / 5 skipped` (platform skips), followed by `SECURITY_AUDIT_PASS`. Audit reported no secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked-local-config, or developer-path finding.
- **Confidence / Status:** CONFIRMED / PASS for MMZ Linux fresh qualification at exact v0.10.9 checkout.
- **Limitation:** Windows-native Job Object/backup/BootCore gates are platform-specific and skipped on Linux; Windows acceptance remains grounded in the separate exact-SHA hosted Windows PASS. The publisher-branch duplicate Windows failure remains CONTRADICTORY / ROOT CAUSE UNVERIFIED.
- **Reuse Targets:** Project Brain current baseline, local acceptance, handoff, release audit.
- **Provenance:** Remote Commander terminal `term-64`; local checkout `/home/mmz/.local/share/ChatGPTRemoteCommander`.
\n\n### 2026-10-04 — publisher Windows contradiction classified from job log\n\n- **Failure:** GitHub Actions run `37188394413`, Windows job `111395205264`, exact product SHA `157d2b18...`, had exactly one failing qualification test: `start_terminal remains interactive only when explicitly requested with an initial command` at `test/process-tree-lifecycle.test.mjs:178`; assertion message: `interactive terminal did not accept initial command`.\n- **Comparison:** The same exact-SHA main Windows job passed this test twice, with observed durations `723.0367 ms` and `698.4991 ms`. The failed instance lasted `2533.1981 ms`.\n- **Mechanism evidence:** The test checks readiness up to 80 times with 25 ms waits, giving an approximately 2 s polling window before failing. The failed duration exceeded that window; adjacent process-tree tests continued passing.\n- **Classification:** PROBABLE hosted-Windows startup-latency/timing flake; ROOT CAUSE UNVERIFIED because the log does not contain a direct child-start timing trace proving why `INTERACTIVE_READY` was delayed.\n- **Decision / Prevention:** First observed occurrence only. Do not weaken the test, patch runtime, or blind-rerun solely to make evidence green. Preserve the contradiction and watch ordinary future Windows qualification. On meaningful recurrence, perform historical/root-cause audit before mutation.\n- **Confidence / Status:** failure identity CONFIRMED; timing-flake mechanism PROBABLE; product defect UNPROVEN.\n- **Reuse Targets:** failure-prevention record, future CI regression triage, release audit.\n- **Provenance:** `gh run view 37188394413 --job 111395205264 --log`; successful comparator job `111394323916`; source test `test/process-tree-lifecycle.test.mjs`.\n

### 2026-10-04 — PR #120 Windows fixture-startup historical audit and prevention alignment

- **Context:** PR #120 head `5fe111831aae82a6a844f0224bc93dce26187651` produced two naturally triggered CI executions from the same push: push run `37200361661` and pull-request run `37200363394`.
- **Observed evidence:** push run Windows and Ubuntu both completed PASS. On Windows, `HTTP retry hardening rejects long sync work before effect and bounds oversized responses` passed in both qualification check (`1933.4499 ms`) and qualification suite (`1968.7949 ms`). Pull-request run Ubuntu completed PASS and Windows qualification check completed PASS, but the Windows qualification suite failed exactly one test, the same HTTP retry test, before behavior assertions at `test/retry-http.test.mjs:60`; `healthy` remained false and total test duration was `14667.7206 ms`. Child stderr contained only the Node SQLite experimental warning.
- **Historical family audit:** `retry-http.test.mjs` was previously widened by commit `7e48fe1` from 100×25 ms (~2.5 s) to 400×25 ms (~10 s) as `make retry HTTP readiness load-tolerant`. Later project evidence `E-CI-20260928-R12` identified fixed short fixture startup budgets as unrelated host-scheduling sensitivity. Subsequent accepted project patterns use a 30 s elapsed startup deadline plus early child-exit diagnostics (`transport-correlation-http.test.mjs`, `profile-instance-http.test.mjs`), with prior Windows stress and hosted-CI evidence. Windows qualification is already serialized to test-file concurrency 1, so further concurrency reduction is not available or justified.
- **Root Cause -> Prevention -> Guard:** stale ~10 s readiness harness remains sensitive to hosted Windows startup variance -> align this one stale fixture with the already accepted 30 s elapsed readiness deadline and fail early if the child exits -> focused repeated regression, then full applicable regression and fresh hosted Windows/Ubuntu CI before merge.
- **Scope / Decision:** test infrastructure only. No Commander runtime source, synchronous transport deadline, product timeout, release bytes, routing, authorization, or user-visible behavior is changed. Do not solve this by another blind timeout increase beyond the project’s already accepted 30 s fixture pattern.
- **Confidence / Status:** failure identity CONFIRMED; hosted scheduling/startup sensitivity HIGHLY PROBABLE; deterministic product defect UNPROVEN. Prevention patch implemented locally but promotion remains OPEN pending regression.
- **Reuse Targets:** CI determinism, fixture-server test design, release qualification, future failure-prevention audit.
- **Provenance:** GitHub Actions runs `37200361661` / `37200363394`; jobs `111430614506` / `111430620043`; commits `7e48fe1`, `bb973bb`; current source `test/retry-http.test.mjs`.


### 2026-10-04 — retry HTTP readiness prevention focused regression

- **Mutation:** `test/retry-http.test.mjs` only: replaced legacy 400×25 ms readiness polling with the project’s accepted 30 s elapsed deadline, added fail-fast diagnostics when the child exits, and preserved the same 25 ms polling cadence. Runtime and product timeouts are unchanged.
- **Focused validation:** `node --check test/retry-http.test.mjs` PASS, followed by 10 consecutive `node --test test/retry-http.test.mjs` executions on MMZ Linux. All 10/10 PASS; observed behavior-test durations were approximately 1.44–1.50 s and terminal marker `RETRY_HTTP_STRESS_PASS` completed with exit 0.
- **Interpretation:** normal-case latency is unchanged in practice; the larger bound is startup headroom only. Linux focused regression supports harness correctness but does not substitute for hosted Windows validation of the original failure family.
- **Confidence / Status:** focused local prevention PASS; hosted Windows/Ubuntu promotion gate OPEN.
- **Provenance:** Remote Commander terminal `term-101`; worktree `/home/mmz/source/repos/ChatGPTRemoteCommander-v0109-brain-sync`.


### 2026-10-04 — retry HTTP readiness prevention full local qualification

- **Gate:** `npm run check:qualification && npm run test:qualification && npm run audit` executed on the patched PR worktree.
- **Result:** process exit `0`. Qualification check completed with zero failures; qualification test main batch reported `498 tests / 493 pass / 0 fail / 5 skipped` (platform-specific skips), and the patched HTTP retry test passed in both applicable qualification passes (~1.45–1.49 s observed). Final security audit emitted `SECURITY_AUDIT_PASS` with no secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked-local-config, or developer-path finding.
- **Confidence / Status:** CONFIRMED / LOCAL FULL QUALIFICATION PASS. Original failure family is Windows hosted startup variance, so hosted Windows PR CI remains mandatory before merge.
- **Provenance:** Remote Commander persistent terminal `term-103`; worktree `/home/mmz/source/repos/ChatGPTRemoteCommander-v0109-brain-sync`.

## 2026-10-04 — Emad-PC Windows kernel-resource incident, updater containment, and filesystem enumeration prevention

**Context / main blocker:** Emad-PC-Ultimate remained on Commander v0.10.8 while exact v0.10.9 candidate qualification repeatedly failed on Windows process-lifecycle fixtures. Promotion was stopped before cutover. The main blocker is now host reliability, not a proven v0.10.9 runtime defect.

### Claim 1 — host kernel-resource state is abnormal and invalidates release qualification
- **Type:** Fact.
- **Status:** CONFIRMED / HIGH.
- **Local evidence:** approximately 3.326 million handles in System PID 4, with approximately 3.315 million of type `File`; independent Performance Monitor readback agreed with the System handle count. Paged pool was approximately 23.1 GB and nonpaged pool approximately 15.2 GB while about 59 GB physical RAM remained free.
- **Tool provenance:** Microsoft Sysinternals Handle was downloaded from the official Sysinternals endpoint, Authenticode status was valid/Microsoft, and its ZIP SHA-256 was `279AAF8ECCB6F79147F4DCC6BA091FB895C4CB8B199A0DD186A4C76BC519D2CD`.
- **Implication:** repeated process-spawn/timing qualification failures on this host are not accepted as product failures or product PASS evidence until host recovery and requalification.

### Claim 2 — wcifs is the leading local attribution, but not yet stack-confirmed
- **Type:** Inference from matching local + external evidence.
- **Status:** PROBABLE / HIGH-CONFIDENCE, NOT CONFIRMED.
- **Local evidence:** Windows 11 26H2 build 26300.9550; `wcifs` service RUNNING; wcifs filter instances attached to both C: and D:; `wcifs.sys` version 10.0.26100.9549, SHA-256 `01CCCBD757DDB19630BB356A49F66B7B1A7C86D7CFC827C13EECD551752D251A`; sampled System File handles used GrantedAccess `0x00120089`.
- **External method evidence:** Microsoft-owned/open Windows repository reports describe wcifs-related System PID 4 File-handle accumulation, large paged/nonpaged pool growth, process-creation failure, and matching `0x00120089` File-handle access patterns. References: https://github.com/microsoft/Windows-Containers/issues/646 ; https://github.com/microsoft/Windows-Sandbox/issues/126 ; Sysinternals Handle documentation https://learn.microsoft.com/sysinternals/downloads/handle .
- **Missing confirmation:** no local pool-tag or ETW/kernel stack trace has yet bound the leaked file objects to wcifs. Do not label wcifs root cause as CONFIRMED.

### Claim 3 — v0.10.9 updater correctly failed closed
- **Type:** Fact.
- **Status:** CONFIRMED / HIGH.
- **Evidence:** exact candidate `v0.10.9` / commit `157d2b18c2c2a2d6a144148230a30b0418eea8c4` staged on Emad-PC and ran qualification. Final check result: 253 tests, 246 pass, 2 fail, 5 skip; failures were Job Object fixture exit `1 != 7` and a `stop_terminal` fixture readiness miss. Updater emitted `AUTO_UPDATE_FAIL GATE_FAIL check` and did not promote.
- **Boundary:** manual focused runs of the same Job Object path can pass with zero descendants after cleanup. This contradiction plus the kernel-resource state means the host cannot currently adjudicate product acceptance.

### Claim 4 — an active development auto-update pin was repeatedly exercising the unhealthy host
- **Type:** Fact.
- **Status:** CONFIRMED / HIGH.
- **Evidence:** installed `config.local.json` and active routed runtime config both contained `autoUpdate.sourceRef = fix/windows-lifecycle-qualification`. `app/var/autostart.log` records approximately hourly `AUTO_UPDATE_CHECK_STARTED sourceRef=fix/windows-lifecycle-qualification` from 2026-10-03 17:43 +03:30 through 2026-10-04 17:32 +03:30.
- **Decision:** the branch pin is superseded for production operation. It must not continue unattended qualification while the host is in the current kernel-resource state.

### Containment — live Emad-PC
- **Status:** ACCEPTED CONTAINMENT / REVERSIBLE.
- Installed updater control script was narrowly hot-patched to honor `%LOCALAPPDATA%\ChatGPTRemoteCommander\maintenance\auto-update-paused.json` for non-`-Force` runs.
- Installed updater before SHA-256: `2114b7096252905ddeac0e274f22d12c080eef19e3e87bade046e64ea8617c6d`; after SHA-256: `5fedc45890b74645d095d301c0288f7d8cd2073ac5642b708ad0a75465776b0d`.
- Automatic backup: `C:\Users\Aa.Emad\.chatgpt-remote-commander\backups\2026-10-04T14-20-33.636Z-62024-mutwrkro-8522e94a\C\Users\Aa.Emad\AppData\Local\ChatGPTRemoteCommander\app\auto-update-windows.ps1`.
- Installed `config.local.json` had only the development `sourceRef` removed; all Full Power/capability/workflow settings were preserved. Before SHA-256 `0da327df1939cf494bef411b146e34ebc9b2516afe9e8c65123b4999d9656335`; after `0e03e28f7da12033fac8822ed17611a8909aa435e58f8f2fae454c902947bdc5`.
- Config backup: `C:\Users\Aa.Emad\.chatgpt-remote-commander\backups\2026-10-04T14-20-38.551Z-62024-mutwrok7-38cc3a77\C\Users\Aa.Emad\AppData\Local\ChatGPTRemoteCommander\app\config.local.json`.
- Pause sentinel SHA-256: `43d662858e19cffafeb2b5dd4a888db317abf3b7dc4cebdd15fe438ede9460fd`.
- Post-check: updater invoked without `-Force` exited 0 immediately with `AUTO_UPDATE_PAUSED`; no fetch/stage/qualification started.
- **Safety boundary:** no System handle was closed, wcifs was not unloaded, and no reboot/shutdown/logoff was performed.

### Prevention candidate — source
- **Authority/base:** clean worktree from `origin/main` commit `6f192c96d51efb3eebdad4dfd49ff36df1888d4b`, branch `fix/v0.10.10-windows-qualification-readiness-clean`.
- New guard `src/filesystem-enumeration-guard.mjs` refuses recursive enumeration of a bare Windows volume root and caps synchronous `search_files` entry visits at 5000.
- `list_directory` applies the Windows volume-root recursion guard; `search_files` applies the same guard and reports `visitedEntries` / `visitLimitHit`.
- Windows updater source includes the same reversible pause-sentinel mechanism; explicit owner `-Force` remains available.
- **Regression:** guard-focused 4/4 PASS; targeted MCP/schema/Linux-host compatibility set 14/14 PASS; updater sentinel contract 1/1 PASS; `git diff --check` PASS.
- **Rigor boundary:** no full qualification was rerun on the contaminated Emad-PC host. Hosted healthy-runner CI and post-recovery local qualification remain mandatory.

### Historical shell-attribution boundary
- **Status:** UNPROVEN.
- Commander audit intentionally does not retain raw `run_shell` arguments. Therefore it is not evidence-valid to claim which prior shell command, if any, caused the kernel leak. The audit does prove Power Mode full-filesystem operation and multiple bounded filesystem enumerations, but exact recursive shell sweeps cannot be reconstructed from the privacy-preserving audit log.

### CEF/Saeid delta preserved from this audit
- PR #59 Windows private-file guard originally failed hosted qualification for two qualification-only causes: cppcheck constness and PowerShell JSON quoting.
- Narrow PR #60 corrections passed hosted Build + Windows native preview on exact SHA `b807acec568a864271866afbb20f77f6b518def4`; merged PR #59 head also passed both gates.
- PR #59 was merged into the rc.2 line at merge commit `d20d2d64cc2e6ce8cbdfa30e67508a03c91aae58`.
- **Boundary:** this accepts the rc.2 private-file guard delta only; it does not establish a stable final CEF product or completed Commander↔CEF end-to-end integration.

**Reuse targets:** Windows incident runbook, updater policy, filesystem-tool design, release qualification, CEF Windows preview, Project Brain/handoff.

## 2026-10-04 — Integrator independent verification of kernel-resource gate and prevention candidate

**Context:** reconciliation worktree `integrate/v0.10.10-audit-20261004`, exact base `origin/main@6f192c96d51efb3eebdad4dfd49ff36df1888d4b`. This record independently verifies the parallel resource-recovery work before promotion.

**Live host evidence:** Emad-PC readback measured System PID 4 handle count **3,326,455**, paged pool **23,125,159,936 bytes (21.537 GiB)**, nonpaged pool **14,976,872,448 bytes (13.948 GiB)**, and **65.425 GiB available physical memory**. `wcifs` was RUNNING/AUTO at `C:\WINDOWS\system32\drivers\wcifs.sys`, file version `10.0.26100.9549`; OS build reported `26300`. Status: **CONFIRMED abnormal kernel-resource state**. Attribution to wcifs remains **PROBABLE**, not stack-confirmed.

**Load boundary:** contemporaneous CPU readback was 100%. The dominant consumers were four active LAMMPS `lmp.exe` ranks belonging to an unrelated thesis simulation. They were explicitly preserved and not terminated. High CPU explains scheduler latency but does not explain the persistent System handle/kernel-pool accumulation.

**External evidence used for method choice:** Microsoft-owned issue trackers report matching 2026 failure patterns: System PID 4 File-handle growth, large paged/nonpaged pool, process-creation failures, persistence until reboot, and amplification by recursive drive-root enumeration. References: `microsoft/Windows-Containers#646`, `microsoft/Windows-Sandbox#126`, and `microsoft/WSL#41296`.

**Integrator source delta:** accepted only the minimum prevention/control set from the parallel worktree: Windows bare-volume recursive enumeration refusal for native `list_directory`/`search_files`; a 5000-entry hard visit budget for synchronous `search_files`; reversible auto-update pause sentinel; and the recovery runbook/Brain/Evidence updates. Line-ending-only autostart/boot-recovery changes and speculative Job Object timing changes were not imported.

**Regression wiring:** `test/filesystem-enumeration-guard.test.mjs` is now included in both normal test and qualification/check paths; `src/filesystem-enumeration-guard.mjs` is included in syntax checking.

**Focused local evidence on contaminated host:** `git diff --check` PASS; enumeration guard **4/4 PASS**; updater pause contract **1/1 PASS**; MCP/schema compatibility **2/2 PASS**. Full qualification remains intentionally **DEFERRED/INVALID on this host** until owner-performed recovery because the current kernel state is a known confounder.

**Safety/authority:** no reboot/shutdown/logoff, System-handle closure, filter unload, LAMMPS termination, workflow mass-cancel, or backlog rewriting was performed.

**Exact next gate:** commit/push the isolated Integrator delta and require healthy hosted Windows + Ubuntu CI before merge; local Emad-PC promotion remains blocked on owner recovery and post-reboot baseline.

### 2026-10-04 — Parallel PR reconciliation into v0.10.10 line

- **Context:** PR #120 (`192c74867cedbfce0f7efaf031affd3a2737634e`) and PR #121 (`0f6082b8e55c15a3ab5d4cde7f483dcab4242c08`) were audited before #122 reconciliation.
- **Decision / status:** PR #120 ACCEPTED and merged as `dc1b246c45c80e074199e4a1d3c18e1ddda7bbcc`; its runtime delta is limited to retry-HTTP fixture readiness plus evidence. Hosted CI Windows+Ubuntu PASS on exact head. PR #121 ACCEPTED and merged as `e5aa808c81517cb37fd6154fdb6d6a71d6c5d068`; hosted CI Windows+Ubuntu and Linux/Windows Server install canaries PASS on exact head.
- **Delivery compaction evidence:** #121 moves the compaction budget check after skipping already-archived artifacts, so bounded repeated passes advance without altering pending/ack/correlation state. Direct regression preserves three COMPLETED_UNDELIVERED entries while archiving 3/3 artifacts over three limit=1 passes.
- **Reconciliation:** #122 branch was merged with new main, preserving v0.10.10 identity and guard regression wiring. The only textual conflict was append-only Project Knowledge/Evidence; main history was retained and the kernel-resource incident/integrator records were appended.
- **Focused post-reconcile validation on Emad-PC:** delivery + enumeration suite **18/18 PASS**, `INSTALLER_CHECK_PASS`, updater candidate-first/pause contract **1/1 PASS**, and `git diff --check` PASS. Full local qualification remains intentionally invalid/deferred until owner host recovery.
- **Exact next gate:** push the reconciled #122 head and require fresh hosted CI + Server Install Canary on that new exact SHA before merge.

### 2026-10-04 — Enumeration I/O boundedness gap closed before #122 merge

- **Finding / Type:** Fact. The first prevention candidate applied a 5,000-entry visit budget after `readdir()`; because `readdir()` materializes a directory listing before the caller can stop, the budget bounded processing but did not strictly bound directory enumeration I/O for a single very large non-root directory.
- **Status:** CONFIRMED gap / FIXED in #122 head before merge.
- **Decision:** recursive `list_directory` and `search_files` traversal now use `opendir(..., { bufferSize: 1 })` and consume entries incrementally. Bare Windows volume-root recursion remains refused. The existing result/visit ceilings remain unchanged.
- **Trade-off:** `list_directory` no longer needs a bulk per-directory read in order to recurse. Returned selected entries are sorted before response; when a directory exceeds the response ceiling, selection is bounded rather than attempting to enumerate the complete directory for a globally sorted prefix. Bounded resource use is the higher-priority invariant.
- **Regression:** filesystem-enumeration guard **6/6 PASS**, including source-contract proof that recursive walkers use incremental `opendir` and no bulk `readdir`; `SMOKE_V03_PASS`; Project Engine / integration set **59/59 PASS**; syntax and `git diff --check` PASS.
- **Scope boundary:** no shell parser/restriction was added. FULL_POWER `shell.unrestricted` semantics remain unchanged; recursive whole-volume shell sweeps remain an operationally forbidden default unless explicitly owner-directed.
- **Reuse targets:** v0.10.10 release notes, filesystem safety contract, future Windows kernel-resource incident prevention.


### 2026-10-04 — v0.10.10 canary post-cutover maintenance failure → v0.10.11 prevention

- **Date / context:** healthy Windows canary HPC-154-66 after immutable v0.10.10 publication.
- **Claim / status:** CONFIRMED. v0.10.10 routed runtime cutover succeeded, but control-code post-commit maintenance failed with `CONTROL_TRACKED_DIRTY`; release acceptance and runtime health are distinct from maintenance completion.
- **Persistent evidence:** route `C:\Users\Administrator\AppData\Local\ChatGPTRemoteCommander\routing\default.json` SHA-256 `ac17648ff0b93df73b2f6925f8c386dfe696b7ab9d573accbbf780a9feeb9bc1` identified active v0.10.10 commit `b570d935466665903a776bcca88ff3e51dcdf088`, generation 37, previous=null. `last-update.json` SHA-256 `cbfcfabb71ad65731b23b8b160f4259e54caecbe25b0116ca9528157b6990934` recorded `PROMOTED_MAINTENANCE_REQUIRED` and `CONTROL_TRACKED_DIRTY`. Updater log SHA-256 at audit time: `b1e51ed92547b8ae4ae167fded3d1d56024d5e395226dd8eefea3e4abd79666c`.
- **Root cause evidence:** control HEAD remained v0.10.9 `157d2b18c2c2a2d6a144148230a30b0418eea8c4`. Only `enable-autostart.ps1` and `enable-boot-recovery.ps1` were tracked-dirty; `git diff --ignore-space-at-eol --exit-code` returned 0. `git check-attr` reported `text: set`, `eol: crlf` for both and local `core.autocrlf=true`. Restoring from HEAD reproduced the dirty state, proving a normalization anomaly rather than user content mutation.
- **Prestate preservation:** exact dirty copies were backed up under `update-backups\b570d935...\default\control-dirty-prestate-20261004`; SHA-256 values were `B9F557E2F5EE6E6EF12C3C0DF5882E1F235E218DDCC6FAC7C09421AA9CCC95F2` and `220C241B7534C821BE875DC4554B0986C4A7A3B5914FC0FF257736D8930D32DB`.
- **Decision:** minimum sufficient guard change. If tracked dirtiness exists, promotion requires zero staged diff and zero unstaged diff after `--ignore-space-at-eol`; otherwise it fails with the existing `CONTROL_TRACKED_DIRTY`. Accepted EOL-only drift emits `CONTROL_TRACKED_EOL_DRIFT_ACCEPTED`.
- **Regression:** a temporary Git repo commits an intentional raw CRLF blob using `hash-object --no-filters` plus `update-index --cacheinfo`; classifier accepts that EOL-only state, rejects a substantive unstaged append, and rejects a staged mutation. Targeted updater suite: 16/16 PASS.
- **Confidence:** root cause CONFIRMED; v0.10.11 full release acceptance still UNPROVEN until full/hosted gates.
- **Reuse targets:** Windows updater maintenance, release qualification, historical-EOL migration policy, incident prevention, Project Brain.


#### 2026-10-04 — v0.10.11 full qualification evidence

- **Context:** clean healthy Windows worktree on HPC-154-66, branch `fix/windows-control-eol-maintenance-v01011`.
- **Result / status:** ACCEPTED FOR PR, not yet release-final.
- **Check qualification:** main Node suite 260 total, 255 pass, 0 fail, 5 platform skips. Supplementary evidence: `FS_SAFETY_PASS`; GUI contract 77/77; `LINUX_GUI_CONTRACT_PASS`; `HEADLESS_PROCESS_LAUNCH_POLICY_PASS`; `WINDOWS_RUNTIME_CONTRACT_PASS`; `SOURCE_INTEGRITY_PASS`; schema continuity 9/9.
- **Test qualification:** main Node suite 506 total, 500 pass, 0 fail, 6 platform skips. Supplementary browser initialization cleanup, Unicode/space path encoding, concurrency smoke, filesystem safety, GUI contract 77/77, Linux GUI contract, headless launch, Windows runtime, source integrity, and schema continuity all passed.
- **Security:** `SECURITY_AUDIT_PASS`; no secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked local-config, or developer-path finding.
- **Specific prevention regression:** historical raw-CRLF blob classification plus substantive unstaged and staged rejection is included in the qualification path and passed; Windows Job Object zero-descendant regression also passed.
- **Confidence:** local healthy-host qualification CONFIRMED. Hosted exact-head CI/canaries, merge-tree identity, immutable tag/release, and post-release canary maintenance are still OPEN.
- **Exact next gate:** commit/push the isolated branch and require fresh GitHub hosted gates before merge.


### 2026-10-04 — v0.10.11 hosted, release, and production-canary acceptance

- **Context:** completion of the v0.10.11 Windows control-promotion patch release.
- **Hosted exact-head evidence / status:** CONFIRMED PASS. PR #123 head `39b222a8f3b59046326578a7e410ae81aab40524` passed Windows CI, Ubuntu CI, Linux clean-container Server Install Canary, and Windows Server bootstrap Server Install Canary. PR merged as `8666c29abe1194b314babe4bed24d06a2b398336`.
- **Tree identity:** CONFIRMED. Merge commit tree `2ae494fe55eb318b977762c6c1b76e2056e19270` exactly matches the previously qualified tree.
- **Release provenance:** annotated tag object `c1f6f2d9f2f45fb119adac6f49fa67cf1996e863` peels to `8666c29...`. GitHub Release `v0.10.11` published at 2026-10-04T17:13:40Z, draft=false, prerelease=false, assets=19. Release Sync succeeded.
- **Production canary prestate:** HPC-154-66 running v0.10.10, FULL_POWER, activeOperations=0, queued=0, currentLeases=0.
- **Exact-ref rollout:** updater source was the qualified v0.10.11 tree and target was `SourceRef=v0.10.11`, `ExpectedCommit=8666c29...`, explicit `-Force`.
- **Qualification evidence:** check Job Object PASS, runId `qualification-check-8666c29abe11-49b014e12afa4ebeadedb0a491f8a80c`, childExitCode=0, activeAfterCleanup=0; test Job Object PASS, runId `qualification-test-8666c29abe11-82661cc0b087473884d61555d6066c2f`, childExitCode=0, activeAfterCleanup=0; audit Job Object PASS, runId `qualification-audit-8666c29abe11-7d8e7fdcf9f6404891c7eeca09bb1cf3`, childExitCode=0, activeAfterCleanup=0; `SECURITY_AUDIT_PASS`; native GUI self-test PASS; doctor PASS; hardware/shadow/live-store compatibility PASS; schema continuity decision `UNCHANGED_SCHEMA`.
- **Critical regression closure:** updater log records `CONTROL_TRACKED_EOL_DRIFT_ACCEPTED` followed by `SUPERVISOR_RECYCLE_PASS`, cleanup of superseded v0.10.10/v0.10.9 release trees, and `AUTO_UPDATE_PASS version=0.10.11 commit=8666c29...`. This is direct evidence that the v0.10.10 post-cutover maintenance blocker is fixed.
- **Persistent production evidence:** `routing/default.json` SHA-256 `e73b30f62167af92526c15b1d0aeabcd6b5e83f521f092fcec263554d754f2e7`; generation=39; active port=48832; active version=0.10.11; active commit=`8666c29...`; previous=null. `last-update.json` SHA-256 `571ef0a1e825c0c2de57d7799cbd4fd78279e0195e62652ce8863c87817ca0a5`; status=`PROMOTED`; completedAt=2026-10-04T17:23:30.9613047Z. Updater log SHA-256 at final audit: `fcf4ff7a18f34845eda88813b2dcf6675afbb0d503cd22b14dd189b9fece564b`.
- **Poststate:** system reports v0.10.11 / HPC-154-66 / FULL_POWER / activeOperations=0 / queued=0 / currentLeases=0, config SHA-256 `1b3d22528061d92704ec70c49e2b31871f2583c659a4aa9ed11967148df3b7dd`.
- **Control-checkout boundary:** control HEAD is `8666c29...`. Raw status still lists only `enable-autostart.ps1` and `enable-boot-recovery.ps1` as dirty. Index diff is empty and `git diff --ignore-space-at-eol --exit-code --` returns 0, so no substantive/staged owner mutation is present. This is the accepted historical EOL-only state, not a clean-status claim.
- **Decision / status:** v0.10.11 is ACCEPTED STABLE. No additional product patch is justified without new evidence.
- **Open non-release gates:** Emad-PC owner recovery/post-reboot baseline; Linux laptop GNOME/session host gate.
- **Reuse targets:** release checklist, Windows updater maintenance contract, future EOL migration decisions, incident runbook, stable-baseline handoff.


### 2026-10-04 — v0.10.12 scoped Codex plugin maintenance qualification

- **Fact / live baseline:** Remote Commander v0.10.11 is live and accepted stable; `powerMode.codexControl.allowLaunch=false`; installed standalone Codex is **0.157.1**; canonical `linux-project-skills` source is **1.4.13** while its derived managed cache contains **1.4.9**.
- **Fact / authoritative Codex source:** in OpenAI Codex 0.157.1, local non-curated cache refresh is reached by `plugin/list` with `forceRefetch=true` via `refresh_non_curated_plugin_cache_for_context`. `plugin/reconcile` handles remote installed plugins and is not a local marketplace cache repair path. Logs for the current app-server session showed remote plugin synchronization but no local `plugin/list` after process start.
- **Decision:** do not hand-edit/copy the derived Codex cache; do not inject protocol bytes into the live app-server stdio session; do not restart the whole Commander/tunnel supervisor for a cache refresh. Add a narrowly scoped supported-protocol sidecar instead.
- **Security boundary:** child executable/subcommand are fixed to `codex app-server`; the only client methods are `initialize`, `initialized`, and `plugin/list`; `forceRefetch` is always true; input schema has no `command`, `args`, or `prompt`; explicit current-request confirmation and Full-Power shell/process authority are mandatory; broad Codex launch remains disabled; API/token environment variables are removed; total synchronous budget is <=8 seconds; raw sidecar stderr is not returned to chat.
- **Regression evidence:** focused maintenance tests PASS, including no-spawn without explicit confirmation, exact fixed process invocation, fixed method sequence, force-refetch enforcement, credential stripping, and absence of arbitrary Codex/delegation escape hatches.
- **Full local qualification:** `npm run check` PASS; `npm test` PASS; `SECURITY_AUDIT_PASS`; `check:qualification` main batch **265/259/0/6**; `test:qualification` main batch **511/505/0/6**; GUI **77/77**; Linux GUI, FS safety, headless launch policy, Windows runtime, source integrity, and schema continuity **9/9** PASS.
- **Status:** local source candidate **CONFIRMED QUALIFIED**. Hosted exact-head CI/canaries, release provenance, production rollout, and live cache-refresh E2E remain **OPEN**; no final release claim is made.
- **Exact next gate:** publish the isolated branch through GitHub PR, require Windows/Ubuntu CI plus Linux/Windows Server Install canaries on the exact head, then merge/tag/release only if all pass. After candidate-first rollout, call `codex_plugin_refresh` and verify managed cache version/hashes against the canonical 1.4.13 source.


#### 2026-10-04 — v0.10.12 final-tree boundedness requalification

- **Review finding:** initial sidecar protocol was fixed and time-bounded but its JSONL response line and returned marketplace/plugin summary did not yet have explicit size/count ceilings.
- **Final control:** `plugin/list` now sends `marketplaceKinds:["local"]`; one JSONL frame is capped before parsing; returned marketplace and plugin lists and string fields are bounded; target-plugin lookup is preserved across summary truncation; RPC error text is clipped and raw RPC error objects are not attached.
- **Focused regression:** maintenance suite **7/7 PASS**, including fixed local-only request, bounded summary with a target outside the displayed prefix, and oversized-frame fail-closed behavior.
- **Final-tree qualification:** `check:qualification` **267 total / 261 pass / 0 fail / 6 skip**; `test:qualification` **513 total / 507 pass / 0 fail / 6 skip**; all supplemental gates PASS; `SECURITY_AUDIT_PASS`.
- **Status:** this supersedes the earlier candidate counts as the evidence for the exact tree to be committed. Hosted CI/canaries, merge/release provenance, rollout, and live cache refresh remain OPEN.


### 2026-10-04 — v0.10.13 bounded Codex source observability

- **Fact / live v0.10.12:** runtime cutover succeeded to commit `42a73b9e8db10bad34efb76b62dbd72f8a00f434`; general `powerMode.codexControl.allowLaunch` remained false; the scoped maintenance E2E succeeded through Codex **0.157.1**.
- **Fact / mismatch:** maintenance returned `linux-project-skills@personal localVersion=1.4.12`. Canonical source files at `~/.agents/plugins/plugins/linux-project-skills` report root Agent Plugins version **1.4.13** and Codex overlay **1.4.13+codex.20261004**. Effective Codex config maps marketplace `personal` to `/home/mmz/.agents/plugins` and enables `linux-project-skills@personal`.
- **Fact / upstream protocol:** exact OpenAI Codex tag `rust-v0.157.1` defines `PluginSummary.source` and converts local marketplace sources into `PluginSource::Local { path }`; `plugin/list` with `marketplaceKinds=[local]` and `forceRefetch=true` invokes non-curated cache refresh. Root Agent Plugins v1 manifests are recognized in that exact version.
- **Inference:** because v0.10.12 removed `PluginSummary.source` from its bounded response, the actual path represented by the 1.4.12 listing is still **UNVERIFIED**. Do not infer that it is the canonical 1.4.13 path until the protocol response proves it.
- **Change:** v0.10.13 preserves a bounded source summary for official source types only. Local path, Git URL/path/ref/SHA, and npm package/version/registry are individually capped at 512 characters; remote source returns only its type.
- **Security:** no raw app-server output, no new RPC method, no arbitrary Codex launch, no token/API credential exposure, and no authority expansion.
- **Qualification:** focused **15/15 PASS**; `check:qualification` **267/261/0/6**; `test:qualification` **513/507/0/6**; GUI **77/77**; schema **9/9**; `SECURITY_AUDIT_PASS`.
- **Status:** source candidate **CONFIRMED QUALIFIED LOCALLY**, hosted/release/live-E2E gates **OPEN**.


### 2026-10-04 — v0.10.14 Linux post-cutover maintenance recovery qualification

- **Fact / production baseline:** v0.10.13 runtime is live at `6bdc26f172155cd833c0569083ea34a3d8d64392`, while the Linux control checkout remains at v0.10.9 commit `157d2b18c2c2a2d6a144148230a30b0418eea8c4`. Its only tracked dirtiness is the two historical PowerShell files; index diff is empty and EOL-insensitive diff is zero.
- **Fact / updater history:** v0.10.11, v0.10.12 and v0.10.13 logs all reached successful candidate gates and route cutover; the later generations stopped during the post-cutover maintenance tail before durable control promotion/PASS evidence. v0.10.13 specifically records active-terminal preservation, cutover, previous-backend retirement/retention, and `LINUX_GUI_BACKEND_SYNCED`, then stops.
- **Fact / plugin state before prevention patch:** the personal Remote Commander Work/Codex projection was still 0.10.4 while runtime/template were 0.10.13. It was repaired independently with prestate backup `work-plugin-pre-v01013-20261004T203415Z`, exact release-template source, byte-preserved app binding, and official scoped Codex refresh. Current source/cache are 0.10.13.
- **Fact / linux-project-skills closure:** scoped Codex v0.10.13 maintenance reports `linux-project-skills@personal localVersion=1.4.13`, source type local, canonical source path `/home/mmz/.agents/plugins/plugins/linux-project-skills`; managed cache contains only 1.4.13 and portable/native manifest SHA-256 values exactly equal their canonical sources.
- **Change:** Linux `promote_control` now blocks staged mutation, blocks substantive unstaged mutation, tolerates only CR-at-EOL drift with explicit audit log, force-checks out the exact fetched commit and verifies HEAD. The post-commit ERR trap remains active.
- **Change:** `sync_work_plugin_projection` runs in both same-version maintenance recovery and normal post-cutover promotion. It validates candidate versions and existing binding, never prints the binding ID, preserves `.app.json` bytes by SHA-256, makes a commit-scoped prestate backup, prepares off-path candidate files, applies personal Work metadata/app references, swaps atomically, rolls back on failure and post-verifies before PASS.
- **Focused executable regression:** **17 pass / 0 fail / 1 Windows-only skip**. It proves EOL-only control promotion classification plus successful Work plugin sync, exact app-binding byte preservation, backup creation, absent-plugin no-op, and malformed-binding fail-closed without mutation.
- **Full local qualification:** `check:qualification` **269/263/0/6**; `test:qualification` **515/509/0/6**; GUI **77/77**; schema **9/9**; Linux GUI / FS safety / headless process launch / Windows runtime / source integrity PASS; `SECURITY_AUDIT_PASS`.
- **Status:** local candidate **CONFIRMED QUALIFIED**. Hosted exact-head CI/canaries, merge/release provenance and Linux post-release E2E remain **OPEN**.
- **Exact acceptance evidence required after rollout:** control HEAD equals v0.10.14 merge commit; updater log contains `CONTROL_EOL_DRIFT_TOLERATED`, `CONTROL_PROMOTION_PASS`, `WORK_PLUGIN_SOURCE_SYNC_PASS version=0.10.14`, durable `AUTO_UPDATE_PASS` or maintenance PASS, and supervisor recycle request/pass as applicable; personal Work plugin source and managed Codex cache both report 0.10.14 with binding bytes unchanged.


### 2026-10-05 — Linux updater invocation-ownership hardening

- **Confirmed live failure:** an exact-commit Linux candidate launched through Commander passed candidate qualification, committed the new route, then stopped immediately after retiring the previous backend. The updater process itself was no longer present. The runtime was healthy at 0.10.14, but control/plugin/final PASS work required a second maintenance invocation.
- **Confirmed recovery:** same-version recovery promoted control and synchronized the personal plugin successfully, proving the post-cutover operations themselves work when their process survives.
- **Root cause:** updater lifecycle was still coupled to the retiring Commander's process tree when manually launched via Commander. EOL-only control dirtiness was real but secondary.
- **Control:** before lock acquisition, a bounded 16-level `/proc` ancestry scan recognizes only managed Commander server processes rooted at the canonical install/release/runtime locations. Such invocations re-exec exact original args under `nohup setsid -f` with one-shot recursion guard. Self-test and normal non-Commander ancestry remain in-process.
- **Durable receipt:** Linux PASS paths now write `last-update.json` atomically before PASS logging; schema/platform/status/version/commit/sourceRef/completedAt are persisted with mode 0600. Malformed identity cannot replace an existing receipt.
- **Focused regression:** **24 pass / 0 fail / 1 platform skip**, including real POSIX Work-plugin sync, atomic durable receipt, fail-closed bad receipt identity, Linux installer isolation/schema compatibility, and static bounded-detach contract.
- **Full qualification:** `check:qualification` **270/264/0/6** and `test:qualification` **516/510/0/6**, GUI **77/77**, schema **9/9**, source integrity and security audit PASS.
- **Open acceptance gate:** after commit/push, launch the exact candidate from Commander. One invocation must detach, finish cutover and post-cutover maintenance, persist the PASS receipt, and leave runtime/control/plugin/cache all on the same exact candidate with no follow-up recovery run.


### 2026-10-05 — Linux durable-delivery transport-receipt separation

- **Confirmed Linux scope:** OS was re-read before each execution/mutation; all work in this Change Set is Linux/core-delivery only.
- **Read-only DB evidence:** live pending delivery rows used unique synthetic `transport-<64hex>` correlations, all had zero claim attempts, and delivery request reservations were empty. Artifact metadata distribution was copy_path=353, delete_path=67, move_path=8, run_shell=4; terminal statuses were overwhelmingly SUCCEEDED.
- **Interpretation:** `completionBeacon.pending` was counting internal operation receipts, not proving missing ChatGPT answer delivery. Synthetic transport keys are retry identities, not authenticated chat correlations.
- **Future-state fix:** server marks only transport-derived AUTO_DEFERRED_MUTATIONS as `transport-retry-only`; async state persists the mode, terminal publishing suppresses actionable delivery, and restart discovery excludes those operations. Explicit requestId/correlation operations remain durable delivery.
- **Backward compatibility:** reservations without a historical deliveryMode do not conflict on retry; old operation receipts may still be reconciled idempotently until explicitly reclassified.
- **Legacy-state repair:** `TRANSPORT_RECEIPT` preserves the row and artifact while excluding it from actionable pending/beacon. Reclassification requires state COMPLETED_UNDELIVERED, attempts=0, source=operation, `transport-<sha256>` correlation, and `operation:` event identity. It does not delete artifacts or synthesize acknowledgement.
- **Regression evidence:** focused state/restart/delivery **38/38 PASS**; HTTP transport split **2/2 PASS**; Linux/core relevant combined **50/50 PASS**; source integrity/security/diff checks PASS.
- **Open live gate:** exact-commit rollout, delivery-store backup, bounded reclassification, post-repair pending/transportReceipts verification, and live new-operation A/B test.


### 2026-10-05 — Linux delivery scope continuity and historical-scope inventory

- **Fact / active runtime:** Linux v0.10.14 commit `9fb2dacc96ee86b4e662de050e02d309aa11a85f` currently reports `pending=0`, `deadLetter=0`, `unfinishedRequests=0`, and `TRANSPORT_RECEIPT=439`. A live transport-derived `copy_path` returned `SUCCEEDED` with `deliveryMode=transport-retry-only`; copied bytes matched and the actionable pending count stayed zero.
- **Fact / historical inventory:** `~/.chatgpt-remote-commander/delivery` contains **1790** SQLite scope directories, including **313 empty**; aggregate rows **20,974**, aggregate historical pending rows **20,531**. These are historical stores, not the active completion beacon.
- **Root cause:** legacy `deliveryLocation` hashes `{configPath, profile}`. Managed routed runtime config paths rotate per candidate commit, and qualification/ad-hoc configs can therefore create new home-level delivery scopes even for the same logical profile.
- **Control:** explicit `durableDelivery.scope` is now accepted and validated. Managed candidate generation with `--existing` pins the prior resolved directory+scope; a second routed candidate built from the first preserves the same values despite a different config path. Fresh managed configs derive a stable scope from device name + profile and store it under `~/.chatgpt-remote-commander/delivery/profiles/<scope>`.
- **Diagnostic isolation:** Linux updater builds the diagnostic candidate with an explicit per-candidate `delivery-shadow-$PORT` and `diagnostic-<commit>-$PORT` scope; final candidate uses preserve mode and inherits the live production delivery identity.
- **Backward compatibility:** configs lacking an explicit durable-delivery scope still resolve with the historical config-path-derived identity. This avoids silently coalescing arbitrary legacy/test configs and keeps migration controlled by the managed candidate builder.
- **Regression:** explicit scope survives config-path rotation; two successive candidate configs preserve one active delivery identity; fresh candidate receives a stable explicit identity; Linux updater contract proves diagnostic=shadow and final=preserve. Final Linux-focused evidence: shared delivery/async/candidate/schema **49/49 PASS**; Linux GUI/installer/tunnel **11/11 PASS**; targeted Linux updater contract **1/1 PASS**; shell parse, diff check, source integrity and security audit PASS. The only intermediate failure was a minimal Linux installer fixture missing the newly required `delivery-store/platform` source files; after aligning the fixture with the real dependency graph it passed 11/11.
- **Safety boundary:** no historical store was deleted or bulk-acknowledged. Cleanup is DEFERRED until every active/named Linux profile and routing reference is mapped; unreferenced stores should be moved intact to an evidence archive with a manifest rather than deleted.


### 2026-10-05 — Windows Access & Operations UI integration on cross-platform v0.10.14 baseline

- **Context / authority:** current product candidate starts from commit `383393d`, which reconciles the v0.10.14 Linux stabilization line onto the Windows desktop/product-shell mainline. Live Windows production remains v0.10.13 until exact-head promotion evidence exists.
- **Fact / live profile inventory (CONFIRMED):** authoritative Windows routing/instance state contains `default` and `saeed-emad`; no live profile named `10.04` exists. Therefore the previously visible `10.04` item is treated as stale/non-authoritative display state, not as a deletable profile.
- **Decision / profile permissions:** the existing capability engine already supports persistent per-capability opt-out/opt-in. The isolated-profile reconfigure path now carries `EnableCapability`/`DisableCapability` through PowerShell -> CLI -> profile builder -> capability migration while preserving its backup, config-hash readback, supervisor recycle and rollback semantics. Primary-profile mutations do not edit the live routed config: `auto-update-windows.ps1` now accepts an optional validated `TargetProfile`; the UI uses exact active version+commit with `-TargetProfile default` so the existing candidate/doctor/cutover/rollback pipeline remains the authority.
- **Decision / Admin Runtime (method evidence):** Microsoft Task Scheduler supports a current-user Interactive principal with `RunLevel Highest`; this is the minimum sufficient Windows elevation boundary and avoids inventing a privileged command broker. The product therefore uses task `ChatGPTRemoteCommander-ElevatedRuntime`, current user + Interactive + Highest, stable app-root entry script, one-time UAC for registration, exact Task Scheduler readback, and an elevated runtime probe **before** disabling the legacy HKCU Run launcher. Password/S4U credential storage is not used. Removal restores the captured prior Run value when safe; activation has a non-elevated supervisor fallback.
- **Fact / Task Scheduler API check (CONFIRMED):** on the Windows target, `New-ScheduledTaskPrincipal -LogonType Interactive -RunLevel Highest`, logon trigger, action and zero execution-time-limit settings all construct successfully. Official method sources: Microsoft Learn `New-ScheduledTaskPrincipal`, `New-ScheduledTaskTrigger`, and Task Scheduler security-context documentation.
- **Fact / monitoring root cause:** the prior `workflow-cli.mjs` passed the whole Commander config into `WorkflowStore`, then failed again on unexpanded `%USERPROFILE%` roots. The CLI now maps the full Commander config into the store constructor explicitly and expands configured environment roots before opening the existing store.
- **Fact / live monitoring evidence (CONFIRMED):** the corrected CLI opened the real Windows workflow SQLite store (~15 MB). Current state reported `automaticExecution=false`, `runnerConfigured=false`, scheduler enabled, `persistedNonterminal=807`, `interrupted=81`, `reconciliationRequired=109`, `currentLeases=0`, and lifecycle counts including 547 persisted `RUNNING`. These are persisted lifecycle records, not proof of 547 live processes; the Operations Monitor UI states this distinction explicitly.
- **Change / UI:** Profile Manager now exposes real profile inventory, Full Power/GUI, allowed roots and explicit filesystem/shell/process/delete/browser/workflow/update capabilities. Dashboard adds **Profiles & Access**, **Operations Monitor**, and **Admin Runtime** actions. Desktop package contains dedicated manager scripts. Installer creates four Start Menu entries with the product executable as icon: dashboard, Profiles & Access, Operations Monitor, Admin Runtime.
- **Verification:** focused access/profile/desktop contracts **31/31 PASS**. `npm run test:update` on the integrated tree: **78 PASS / 0 FAIL / 2 platform skips**, plus MCP Tasks extension **1/1 PASS**. Desktop self-contained Windows publish PASS at v0.10.14; artifact `dist/desktop/remote-commander-windows-x64/RemoteCommander.exe` SHA-256 `7af21bbaa8036906b0483eca89154460cd8b10219cd13e6615fcb475a655ea5b`. The candidate dashboard was launched from `dist` and produced a live `Remote Commander` window without mutating runtime authority.
- **Failure prevention:** a full-file remote rewrite attempt on the large Windows updater doubled the file and caused parser errors. It was never executed, was restored exactly from Git, and replaced by exact-anchor local patching. Large PowerShell control files must not be full-file rewritten through the remote text path when a narrow patch is sufficient.
- **Status / confidence:** Access & Operations source + local Windows build are **CONFIRMED / locally qualified**. Live Admin task registration/readback, installed shortcut readback, exact-head full qualification/hosted CI, Linux-laptop parity and Amirreza-server acceptance remain **OPEN**. Timed scheduling is intentionally not represented as complete: the current durable scheduler performs recovery/readiness and has no automatic model runner.
- **Reuse targets:** release notes, Windows operator guide, profile/access documentation, scheduler roadmap, final product acceptance.

- **Method evidence / official sources:** Microsoft Learn documents `New-ScheduledTaskPrincipal -RunLevel Highest` as running with highest privileges and Task Scheduler security contexts as requiring `TASK_RUNLEVEL_HIGHEST` for elevated actions. Sources: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal?view=windowsserver2025-ps and https://learn.microsoft.com/en-us/windows/win32/taskschd/security-contexts-for-running-tasks .


### 2026-10-05 — Interactive PowerShell redirected-stdin contract

- **Context:** PR #129 exact head `263589c...` failed the identical Windows interactive-terminal test in both hosted CI and Windows Server bootstrap, while Ubuntu paths passed.
- **Observed evidence:** failure output showed PowerShell prompt text but no startup marker. A local diagnostic using a longer read wait reproduced the same state, proving the issue was not merely a 2-second test budget.
- **Root cause:** plain interactive `pwsh` plus an immediate write to a pipe is not an explicit redirected-stdin command contract.
- **Method evidence:** Microsoft Learn `about_Pwsh` specifies that `-Command -` reads commands from standard input and executes statements one at a time as if typed at the prompt; `-NoExit` keeps the session open. Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh?view=powershell-7.5
- **Decision:** Windows interactive Commander terminals use `-NoExit -Command -`; initial and follow-up commands use the same stdin stream. This is simpler and more deterministic than adding arbitrary sleeps or larger polling loops.
- **Regression:** Windows process-tree/lifecycle suite 7/7 PASS; interactive test proves startup output, running state, follow-up command output, and cleanup.
- **Failure prevention:** do not classify a repeated hosted timing symptom as flaky when two independent Windows gates fail the same contract. Reproduce the actual stream state and align process invocation with the platform's documented stdin mode.

### 2026-10-05 — Hosted Windows terminal-readiness root cause and repair

- **Context:** PR #129 exact head `263589c6381bfa9a0a62c430584b824b61bcd799` passed hosted Ubuntu CI and Linux clean-container canary, but hosted Windows CI and Windows Server bootstrap each failed exactly one test: `start_terminal remains interactive only when explicitly requested with an initial command`.
- **Root cause (CONFIRMED):** `read_terminal(waitMs)` intentionally returns on the first newly available output. Windows PowerShell interactive startup can emit prompt/control output before the initial command result, while the old implementation also launched `pwsh -NoExit -Command -` and wrote the initial command to stdin immediately. The test incorrectly assumed its first bounded read must already contain the marker. Under heavier local load, PowerShell startup itself also varied materially; observed targeted runs required roughly 3–14 s for the complete interactive readiness test.
- **Minimum-sufficient repair:** Windows interactive shells with an initial command now launch as `pwsh.exe -NoLogo -NoProfile -NoExit -Command <validated command>`, avoiding the pre-readiness stdin write. Follow-up commands continue through the same stdin pipe; a direct probe confirmed `INITIAL_OK` then `FOLLOWUP_OK` on one shell. Linux interactive behavior is unchanged. The test now accumulates successive bounded `read_terminal` chunks until the requested marker or a 15 s readiness deadline; process-tree startup precondition gets an 8 s bounded allowance. No production command timeout or scheduler policy was relaxed.
- **Regression evidence:** after the repair, three sequential targeted runs of both the descendant-stop and interactive-terminal tests completed **6/6 PASS** on the loaded Windows PC. Prior narrow timeout-only attempt was rejected after it reproduced a failure, which is retained as evidence that a product-side Windows launch repair was needed.
- **Cross-platform acceptance before this repair:** exact SHA `263589c` on Linux laptop `aliemad-Labtop` passed 44/44 executed targeted tests with one Windows-only skip, Linux GUI contract, source-integrity and security audit; production runtime was not mutated. Fresh-clone setup used `npm install --ignore-scripts` because this repository intentionally has no package-lock, so `npm ci` is inapplicable.
- **Status:** repair is locally targeted-qualified but not promoted. Exact-head bounded qualification, refreshed hosted CI/Server Canary, Windows Server acceptance and final release/promotion remain OPEN.
- **Reuse targets:** CI reliability notes, terminal-control design, Windows operator documentation, release acceptance.

### 2026-10-05 — v0.10.15 hotfix authority after premature v0.10.14 merge

- **Context:** PR #129 was merged and tagged as `v0.10.14` at merge commit `b91fa4586c7317c46d7e13e1e58297cc407420d3` before the later local terminal-readiness refinement was complete. Tree audit confirmed `b91fa45` is byte-identical to its PR head `db5053e`.
- **Authority:** immutable released baseline = `v0.10.14` / `b91fa45`. Hotfix branch `hotfix/v0.10.15-terminal-readiness` starts exactly from that merge commit; commit `42b4031` applies only the five-file terminal-readiness/evidence delta. No force-move or tag rewrite is permitted.
- **Release decision:** publish the correction as `v0.10.15`, not by mutating `v0.10.14`. `package.json` version and Windows installer default `SourceRef` are bumped to `0.10.15`/ `v0.10.15` only.
- **Writer-control incident:** a scheduled finalization run overlapped the active chat writer and created/merged `db5053e`. The recurring Remote Commander finalization automation was paused before further mutation. This hotfix worktree is now the sole writer for release closure.
- **Open gates:** exact-head Windows qualification after version bump, hosted CI/server canary, Linux laptop exact-head acceptance, Amirreza exact-head acceptance, merge, immutable tag/release, post-release install/readback. Until those pass, v0.10.15 is **UNPROVEN / candidate**.
- **Reuse targets:** release notes, Project Brain handoff, CI/release process and one-writer failure-prevention guidance.

### 2026-10-05 — v0.10.15 exact-code qualification and release-identity closure

- **Candidate code SHA:** `b6cdeec` on `hotfix/v0.10.15-terminal-readiness`.
- **First release-bump attempt:** `09f4e27` failed qualification because `test/installer-check.mjs` still required the v0.10.14 installer identity. This was classified as a release-contract failure, not ignored.
- **Root cause / prevention:** current release identity was distributed across runtime, Linux/Windows installers, server installers, plugin templates, onboarding/release contracts, final-gate naming and server-install documentation. Updating only `package.json` and `install.ps1` was incomplete. The hotfix now advances all current identity surfaces together while leaving historical v0.10.14 evidence and generic test fixtures unchanged.
- **Verification:** `npm run check:qualification` on `b6cdeec` completed with exit code 0. Main bounded batch: **277 total / 270 pass / 0 fail / 7 platform skips**. Installer check, onboarding plugin check, release asset contract, browser initialization/path gates, GUI contract and supplemental qualification gates all completed successfully.
- **Status:** Windows exact-code qualification = **CONFIRMED PASS**. Hosted final-head CI/canary, Linux laptop, Amirreza server, merge/tag/release and post-release rollout remain OPEN.
- **Reuse targets:** release checklist, version-bump procedure, failure-prevention rule: release-version advancement must update the whole declared identity surface atomically, not only package metadata.

### 2026-10-05 — v0.10.15 release and live rollout closure

- **Release authority:** PR #130 merged to `main` as `4438b546035da192999954dd40e78ddbb6a9e7bd`. The merge tree is byte-identical to qualified PR head `4f0d9fffd9300795e5bb596eb176550b2cebde32`.
- **Immutable publication:** annotated tag `v0.10.15` peels to `4438b546035da192999954dd40e78ddbb6a9e7bd`. Official `release-sync` run `37362575649` completed SUCCESS, built immutable assets, verified checksums and published non-draft/non-prerelease GitHub Release `Remote Commander v0.10.15` with Windows/Linux/setup/server/plugin assets plus `SHA256SUMS.txt`.
- **Hosted verification:** exact PR head GitHub CI run `37361222937` = SUCCESS on Windows + Ubuntu; Server Install Canary run `37361222976` = SUCCESS on Windows Server + clean Linux container.
- **Cross-host acceptance:** Linux laptop exact-head acceptance = PASS (44 executed PASS, 1 Windows-only skip, plus Linux GUI/installer/onboarding/release/source-integrity/security gates). Amirreza Windows Server exact-head acceptance = 35/35 PASS plus installer/onboarding/release/source-integrity/security gates.
- **Live rollout / readback:** primary Windows PC default runtime = `0.10.15`, HEAD `4438b546...`, health OK; isolated profile `saeed-emad` on port 47834 health OK and reports `0.10.15`. Linux laptop live runtime = `0.10.15`, HEAD `4438b546...`, updater receipt status `pass`, health OK. Amirreza Server live runtime = `0.10.15`, HEAD `4438b546...`, updater receipt status `CURRENT`, health OK.
- **Failure prevention:** the earlier partial version bump failure was converted into an atomic release-identity rule; v0.10.14 remains immutable and was not force-moved or rewritten. Overlapping finalization automation was paused during release closure to preserve one-writer authority.
- **Status:** software release/rollout objective for v0.10.15 = **CONFIRMED / ACCEPTED** by reproducible qualification, hosted CI/canary, immutable release evidence and live runtime readback. Physical AC-loss/reboot testing remains a separate deferred hardware/operations gate and is not claimed here.
- **Reuse targets:** Project Brain, release checklist, updater/runbook, incident/failure-prevention guidance, future release automation.

### 2026-10-06 — v0.10.16 single-product Windows packaging and installer evidence

- **Context / trigger:** live Start Menu inspection showed `Remote Commander Profiles & Access`, `Remote Commander Operations Monitor`, and `Remote Commander Admin Runtime` as separate application shortcuts. This was a packaging defect, not three independent products. The live Start Menu was repaired with a backup first; only `Remote Commander` and the separately installed `Remote Commander Browser` remain.
- **Product decision:** Windows exposes one Commander shell. Profiles & Access remains available inside Commander in both modes. Operations Monitor and Admin Runtime are installed only in `ControlMonitoring` mode. Internal PowerShell tools are implementation details and must not receive public Start Menu shortcuts.
- **Installer architecture:** one Inno Setup executable provides `Commander Core` and `Commander + Control & Monitoring`. The setup process stays in the original user context; only verified machine-wide prerequisites cross an explicit UAC boundary. This preserves `%LOCALAPPDATA%`, `%APPDATA%`, and DPAPI ownership for the intended Windows user rather than the credential used to approve UAC.
- **Fresh-Windows dependency path:** the setup bootstraps pinned PowerShell 7.6.6 by SHA-256, then reuses the existing verified `server-install-windows.ps1 -PrerequisitesOnly` path for Node.js/Git. Product installation then returns to the non-elevated user context. No Defender/EDR exclusions are added.
- **Profile onboarding:** Setup records one or more validated profile names only. Account-specific `tunnel_id` and Runtime API key are collected after installation by `profile-enrollment-windows.ps1`. Runtime API key is represented as `SecureString`, passed in-process to the enrollment backend, and is not put on a command line; existing tunnel validation and DPAPI persistence remain authoritative.
- **Browser boundary:** installed Browser readback is `v0.8.0-rc.4`. Commander can launch it and the Browser has a read-only Commander Companion snapshot, but fully bidirectional Browser↔Commander integration is **UNPROVEN / not implemented**. Commander browser automation remains the separately qualified Chromium/CDP backend. The Commander Setup therefore has a compile-time Browser component hook but does not expose/bundle it unless a verified standalone Browser installer artifact is supplied.
- **Benchmark / method choice:** official Inno Setup capabilities for Components, Tasks, and custom wizard pages support the minimum-sufficient single-setup design; a separate installer framework or custom bootstrapper was not justified. The resulting control surface is simpler than publishing multiple utility shortcuts or maintaining separate Commander installers.
- **Compiler evidence:** Inno Setup 6.7.3 compiled both the Commander-only path and the conditional Browser-component path successfully. Early compiler failures (`SetupArchitecture`, invalid ICO, unsupported helper assumptions) were converted into fixes: valid architecture directives only, standards-compliant multi-size ICO, and self-contained Pascal helpers. Final compile completed without warnings.
- **Regression evidence:** `desktop-product-contract.test.mjs` + `single-installer-contract.test.mjs` = **9/9 PASS**. `npm run test:update` = **83 pass / 0 fail / 2 platform skips**, then MCP Tasks extension **1/1 PASS**. PowerShell parser gates for touched Windows scripts are PASS.
- **Release automation:** `release-sync.yml` now has a pinned Windows job that builds the single-file Setup with .NET 10 + Inno Setup 6.7.3, transfers it with pinned artifact actions, adds its SHA-256 to `SHA256SUMS.txt`, and raises the immutable release-asset count from 19 to 20.
- **Signing limitation:** production Authenticode signing is **MISSING/EXTERNAL** unless an organization-controlled code-signing certificate is available. Self-signing is not accepted as production evidence. Functional installation and cryptographic release checksums are independent of that trust/reputation layer.
- **Status:** code is a **CURRENT candidate**, not yet release-accepted. Exact-head full qualification, hosted CI/server canary, cross-host exact-head acceptance, merge/tag/release, and post-release live readback remain open.
- **Reuse targets:** release notes, Windows installation docs, product UI/packaging rationale, Browser integration roadmap, future installer regressions.

### 2026-10-06 — Commander v0.10.16 single-shell / monitoring candidate qualification

- **Authority:** branch `feat/v0.10.16-single-shell-installer` remains based exactly on `origin/main=54bb5a1aa8867788a8df2cc5ae98557e1d8a6698`; no upstream drift or concurrent writer was detected before promotion of this change set.
- **Product delta:** one Remote Commander shell/icon; two Windows install modes (`Core` and `ControlMonitoring`); internal Profiles/Access/Monitoring/Admin tools are no longer separate public Start Menu applications; post-install multi-profile enrollment keeps Runtime API keys in SecureString/DPAPI flow; fresh Windows bootstrap verifies/installs PowerShell 7, Node.js and Git without drivers or Defender exclusions.
- **Local installer acceptance:** Core and ControlMonitoring installs were exercised in isolated roots with one public Commander shortcut; component manifests matched the selected mode and live production runtime/profile state was restored unchanged after QA.
- **Qualification:** `npm run check:qualification` completed exit 0 on Windows PC. Main bounded batch: **282 total / 275 pass / 0 fail / 7 platform skips**; supplemental browser, GUI and source-integrity gates completed without failure. The new single-installer contracts passed in the full batch.
- **Open dependency:** official v0.10.16 release must not be tagged until the standalone Browser rc.5 release exists and the Commander release workflow pins/verifies/embeds that exact Browser Setup for users selecting the Browser component. Current Setup source supports compile-time Browser inclusion, but release-sync does not yet supply the artifact.
- **Status:** Commander/Control+Monitoring code change set = locally QUALIFIED; Browser dependency + hosted/cross-host exact-head gates remain OPEN, so v0.10.16 is not FINAL.

### 2026-10-06 — enable-autostart line-ending normalization provenance

- `.gitattributes` declares `*.ps1 text eol=crlf`, so repository blobs are canonically LF and Windows worktrees are CRLF. Historical `enable-autostart.ps1` was an unnormalized CRLF blob.
- v0.10.16 substantively changes only the in-memory `SecureString RuntimeApiKey` parameter and the fallback prompt branch (**6 added / 1 removed semantic lines**). Committing the canonical LF blob makes Git report a larger raw line-count once, but prevents the file from appearing perpetually dirty after checkout and aligns it with the repository policy.
- Audit rule: assess this file with semantic/ignore-EOL diff for the v0.10.15→v0.10.16 transition; future commits should remain normalized.

### 2026-10-06 — PR #132 Windows hosted failures closed locally

- **Windows Server canary root cause — CONFIRMED:** `server-install-windows.ps1` installed or verified Node.js and Git and prepended their exact directories to the live process PATH. The staged `install.ps1` then replaced PATH from Machine/User values only, discarding those validated process-only paths. The clean canary intentionally hides preinstalled Git/Node from persistent PATH, so `git.exe is required` followed.
- **Fix/prevention:** `install.ps1 Refresh-Path` now merges the current process PATH first with refreshed Machine/User PATH and case-insensitively deduplicates entries. Installer contract tests require this behavior.
- **Project Engine hosted failure root cause — CONFIRMED harness assumption:** the early-wake test mocked timeout delay to 5 ms and required more than one timer call, but a busy hosted runner may execute that first callback after the persisted deadline. Runtime already rechecks the remaining wall-clock duration and direct abort at/after deadline is correct.
- **Fix/prevention:** test contract now requires either a reschedule when the callback is genuinely early or wall-clock at/after the persisted deadline when only one callback occurs. Runtime deadline semantics are unchanged.
- **Focused regression:** five consecutive runs of the three affected fixtures (`deadline early=false`, `deadline early=true`, `cancel during effect`) all passed: 15/15 total, 0 failures. The cancellation fixture stayed about 0.19 s and therefore its timeout was not relaxed.
- **Full Windows bounded qualification after fixes:** exit 0; main batch **282 total / 275 pass / 0 fail / 7 platform skips**; supplemental Browser/GUI/source gates completed without failure.
- **Status:** local V&V PASS; hosted exact-head Windows CI and clean Server canary remain required before promotion.

### 2026-10-06 — PR #132 conversation handoff polling flake removed deterministically

- **Context:** exact head `8d40495ce62b43f01a0cd54c68dccc88eda47a93` had push CI Windows PASS, Ubuntu PASS and disposable Windows/Linux server canaries PASS, but the independent PR-event Windows job failed only `resume fails closed while same-conversation handoff is actively claimed` after ~7.6 s. The failure was `assert.ok(sent)` after polling for `SENT`; delivery semantics themselves had no contradictory failure.
- **Root cause — CONFIRMED harness timing dependency:** the conversation controller already serializes delivery on authoritative internal `drainPromise`, and `close()` already waits for that promise. The test instead polled derived store state with a wall-clock retry window after releasing the synthetic send gate. Under hosted Windows load that polling window can expire even though the queued send is still making correct progress.
- **Repair:** expose the existing controller `drainPromise` as an internal `drain()` method and have the integration test await it directly before asserting durable `SENT=1` and absence of the pending event. No production retry, timeout, UI automation or delivery policy changed.
- **Focused regression:** `node --test test/workflow-conversation.test.mjs` completed **10/10 consecutive runs PASS** (30 subtests total, zero failures).
- **Full local Windows gate:** `npm run check:qualification && npm run test:qualification && npm run audit` completed exit 0 on the isolated worktree. Bounded main batch reported **282 total / 275 pass / 0 fail / 7 platform skips**; the repaired conversation test passed inside the full gate; security audit completed without failure.
- **Worktree authority:** changes were developed in separate worktree `_rc_v01016_conversation_drain` based on exact remote head `8d40495`, leaving unrelated dirty conversation changes in the original worktree untouched. Historical `enable-boot-recovery.ps1` checkout drift is EOL-only and is excluded from this change set.
- **Status:** local regression = PASS; fresh hosted PR Windows/Ubuntu CI on the new exact head remains required before merge.

### 2026-10-06 — Competitive/method audit before v0.10.16 promotion

- **Remote Desktop Commander (official hosted MCP):** official docs emphasize OAuth 2.0/PKCE, device authorization pairing, named multi-device control, revocation, terminal/process/session management and an online dashboard. Source: `https://github.com/desktop-commander/remote-desktop-commander`. **Assessment:** Remote Commander already covers named hosts, durable operations, process/session control, profile authority and monitoring; a standards-based hosted OAuth/device-revocation flow is **not evidenced as equivalent** in the current product and is a future distribution/security gap if multi-user hosted deployment becomes a goal. It is not required for the current owner-bound deployment model.
- **Playwright MCP (official Microsoft):** persistent browser profiles preserve login/cookies, isolated profiles intentionally discard state, and one persistent profile may be owned by only one browser at a time. Sources: Microsoft Playwright MCP profile docs and repository. **Assessment:** current Browser design is aligned: persistent/isolated profile modes, explicit profile namespaces, ownership checks, isolated cleanup, persistent-state preservation and no production-login migration during QA are all covered by tests.
- **DesktopCommanderMCP security model:** upstream documentation explicitly states allowed directories/command blocklists are advisory rather than a security boundary when arbitrary terminal execution is enabled. **Assessment:** do not overclaim Commander path/program policies as a sandbox. Current explicit Full-Power authority + OS permissions + one-writer + mutation guards are appropriate for the owner's trusted-machine model; true hostile-client containment would require OS/VM isolation rather than more string blocklists.
- **Windows signing:** Microsoft recommends trusted code signing for non-Store distribution and treats self-signed certificates as development/testing only. Source: Microsoft Learn `Code signing options for Windows app developers`. **Assessment:** Commander/Browser functional release can be validated without signing, but publisher/SmartScreen trust remains **MISSING/EXTERNAL** until a real signing authority/certificate is provisioned. Do not mark that dimension FINAL.
- **Method decision:** no additional feature gate is justified before v0.10.16 beyond the existing exact-head hosted CI/server canaries, Browser immutable release pin, and cross-host acceptance. Adding OAuth hosting or signing without external authority would increase scope without closing the current release-critical path.

### 2026-10-06 — Browser rc.8 promoted as immutable Commander v0.10.16 dependency

- **Browser authority:** `Usefull-Skills/chatgpt-cef-linux` PR #68 exact head `f8104b892f72f80471f2957175996f00e2f3e584` passed Release Windows/Linux, Windows-native, Linux regression and Build gates, then merged as `b45cb2b5042318866fe4287bacd1323f4793718a`. Qualified head and merge tree were tree-equal before tagging.
- **Published release:** tag `v0.8.0-rc.8`; Release run `37454727830` PASS including Windows build/staging/upload, Linux build/upload and publish. Published Setup asset: `Remote-Commander-Browser-Setup-v0.8.0-rc.8.exe`, size 136250749 bytes.
- **Browser Setup SHA-256:** `c1f04ff74bf3f7caf8b192bc35c4bf4d08f1149a890a164df511bcdfd16893c3`. GitHub release asset digest and independent `SHA256SUMS-setup-v0.8.0-rc.8.txt` readback match exactly.
- **Commander decision:** Windows Commander v0.10.16 Setup may now bundle Browser rc.8 as an optional component. CI downloads the immutable versioned release URL, verifies the pinned SHA-256, then passes the verified file to `installer/build-setup.ps1 -BrowserInstaller`.
- **Build-chain hardening:** Commander release CI uses the verified pinned Inno Setup 6.7.3 bootstrap shared with the qualified Browser release path instead of Chocolatey. Current GitHub artifact actions are pinned by exact commit SHA.
- **Pre-release validation:** Release Sync now runs the actual Windows Setup build on release-related pull requests while publish is skipped for PR events. This closes the previous gap where tag-only release construction could fail after promotion.
- **Authority integration:** latest Commander main contribution PR #133 (portable Companion runtime admission, merge `f1570d7`) is merged into the v0.10.16 final integration worktree before release promotion.
- **Status:** implementation complete locally; hosted exact-head validation and final v0.10.16 promotion remain OPEN.

### 2026-10-06 — local pre-push bundled Commander Setup validation PASS

- **Dependency acquisition:** `scripts/fetch-browser-setup.ps1` downloaded Browser `v0.8.0-rc.8` from its immutable GitHub Release URL and verified SHA-256 `c1f04ff74bf3f7caf8b192bc35c4bf4d08f1149a890a164df511bcdfd16893c3`; status `REMOTE_COMMANDER_BROWSER_DEPENDENCY_PASS`. Authenticode status is `NotSigned`, consistent with the known external signing gate.
- **Compiler acquisition:** verified Inno Setup 6.7.3 bootstrap PASS with SHA-256 `9c73c3bae7ed48d44112a0f48e66742c00090bdb5bef71d9d3c056c66e97b732` and signer `Pyrsys B.V.`.
- **Actual bundle compile:** `installer/build-setup.ps1` built `Remote-Commander-Setup-v0.10.16.exe` successfully with `browserBundled=true` and Browser hash matching the published rc.8 dependency. Local pre-push Setup SHA-256: `cb66952e991ea6eca3aee6a473a7778d5f4d0c7d2ef94fa939c9b66ae71c577e`.
- **Scope/authority note:** this build used `-AllowDirty` because the release-integration Change Set had not yet been committed. Therefore it validates compile/bundle mechanics only; it is not promotion evidence. Hosted exact-head build after commit remains required.
- **Static contracts:** `release-assets-contract.test.mjs` PASS; `single-installer-contract.test.mjs` 5/5 PASS; no Browser SHA placeholder remains.

### 2026-10-06 — local qualification cleanup anomaly classified; targeted regression PASS

- **Full local check:** `npm run check:qualification` executed 282 tests: 274 PASS, 7 SKIP, 1 FAIL. The only failure was the after-hook of `test/auto-update-contract.test.mjs` Job Object containment fixture: `fs.rmSync(...rc-job-containment-FT5NUe...)` returned `EPERM` while removing its temporary directory.
- **Product assertions before cleanup:** the fixture had already asserted `activeAfterCleanup=0`, child/server process absence and closed listener. Post-failure audit read every generated PID file; all child and server PIDs were dead. The test source has no diff in this Change Set or latest main integration.
- **Environment evidence:** after the Node test runner exited, the exact generated temp directory was removable immediately with `Remove-Item -LiteralPath ... -Recurse -Force`; result `TEMP_CLEANUP_AFTER_PROCESS_EXIT=True`. This supports a transient Windows handle-release race at test after-hook cleanup rather than a retained descendant/product regression.
- **Targeted regression:** one evidence-driven rerun of only `Windows qualification Job Object leaves zero descendants...` passed 1/1 in ~25 s. No source patch or retry loop was introduced.
- **Status:** local full-check aggregate remains formally **not PASS** because its original run exited 1; root-cause classification is **Probable local cleanup race**, with targeted regression PASS. Fresh hosted exact-head CI remains the promotion authority and must pass before merge.

### 2026-10-06 — hosted Release Sync clean-worktree failure: historical CRLF checkout drift admitted by existing classifier semantics

- **Exact-head hosted evidence:** Commander PR #132 head `c18efe6a498ef0de0c80e7e4d00df8af9ce77cd4`, Release Sync run `37457196824`. Pinned Inno Setup step PASS; verified Browser rc.8 dependency fetch PASS; `Build single-file Windows setup with Browser` failed before compilation because `installer/build-setup.ps1` reported exactly one dirty entry.
- **Reproduction/provenance:** fresh local Windows worktree from the same repository reports `enable-boot-recovery.ps1` as 186/186 changed solely due historical CRLF checkout normalization. `git diff --ignore-space-at-eol --exit-code -- enable-boot-recovery.ps1` returns 0. Repository `.gitattributes` requires `*.ps1 text eol=crlf`.
- **Existing accepted project method:** `auto-update-windows.ps1::Promote-Control` already treats this historical Windows condition fail-closed: staged changes are rejected first, substantive unstaged differences are rejected with `git diff --ignore-space-at-eol`, and only then EOL-only drift is accepted with an auditable marker. `test/auto-update-contract.test.mjs` explicitly qualifies this behavior.
- **Root cause:** the new Setup builder used raw `git status --porcelain` as a binary clean check, which conflicts with the repository's already-qualified Windows CRLF normalization model. This is a release-guard policy mismatch, not product source dirtiness.
- **Fix:** Setup clean guard now independently rejects any untracked files, any staged tracked changes, and any substantive unstaged tracked changes. Only tracked EOL-only drift is accepted and emits `SETUP_TRACKED_EOL_DRIFT_ACCEPTED`. Hosted Release Sync is explicitly prohibited from using `-AllowDirty`.
- **Regression:** single-installer contract asserts all four boundaries. After local commit, actual Setup compile without `-AllowDirty` must PASS on the known EOL-only worktree before push; fresh hosted exact-head Release Sync must then PASS.

### 2026-10-06 — Setup clean guard pre-push negative regression PASS

- With the clean-guard Change Set still substantively unstaged, an actual `installer/build-setup.ps1` invocation without `-AllowDirty` failed before compilation with `Setup release build refuses substantive unstaged tracked changes.`
- This confirms the revised classifier does not convert the release guard into a general dirty-worktree bypass. The remaining positive regression is to commit the Change Set and prove the same command accepts only the known EOL-only checkout drift.

### 2026-10-06 — Setup clean guard positive EOL-only regression PASS

- After committing the clean-guard fix, the local worktree contained only the known historical `enable-boot-recovery.ps1` EOL normalization drift.
- An actual `installer/build-setup.ps1` invocation **without** `-AllowDirty` emitted `SETUP_TRACKED_EOL_DRIFT_ACCEPTED count=1`, then built the full v0.10.16 Setup successfully with Browser rc.8 bundled.
- Build result: `REMOTE_COMMANDER_SETUP_BUILD_PASS`, commit `38adb8006e34d5bdd74556c1d8d31d7108d6cae1`, Setup SHA-256 `cd923b4c9f3bb36b52661e3b384d3f5ae66a16ee20a5a5dd5e15189a28a4b859`, `browserBundled=true`, Browser SHA-256 `c1f04ff74bf3f7caf8b192bc35c4bf4d08f1149a890a164df511bcdfd16893c3`.
- Combined with the pre-commit negative regression, the guard now demonstrates both fail-closed substantive-drift behavior and explicit EOL-only admission locally. Hosted exact-head Release Sync remains the promotion authority.


### 2026-10-06 — v0.10.17 diagnostics finalization candidate

**Previous accepted state:** immutable v0.10.16 release at 46655c5ae7d5504956959dfc7f2126fcc6824b6a. One unattended Windows exact-release qualification failure retained lifecycle metadata but not child stdout/stderr.

**Current delta:** candidate v0.10.17 contains the qualified diagnostics tree from PR #134 while preserving Job Object containment, timeout, cleanup, backoff and fail-closed exit semantics. Release identity advances without modifying the immutable v0.10.16 tag.

**Historical failure audit:** three attempts of the superseded local release runner incorrectly required a cherry-picked commit SHA to equal the source commit SHA. Git records a new commit for a cherry-pick; content equivalence is therefore guarded by exact tree identity. The superseded runner is DO NOT RUN.

**Current gate:** focused local qualification open; no tag or live runtime mutation has occurred.

**Exact next action:** qualify this exact candidate on Windows/Linux and hosted gates, merge only if green, then tag/publish v0.10.17 and perform candidate-first fleet rollout/readback.

### 2026-10-06 — v0.10.17 hosted Windows Job Object harness latency

Exact-head CI run 37496855550 failed only the pre-existing Job Object containment test with missing report at 15.046s. The test outer spawnSync killed pwsh at exactly 15000ms before the runner finally/report path could complete. Local Windows full qualification, Linux cross-host, Ubuntu hosted CI, new qualification-output tests, and Release Sync were already PASS. Mutation is test-only: give the outer wrapper a bounded minimum 30s budget, detect early wrapper exit, and emit explicit timeout diagnostics; production Job Object, child timeout, cleanup and exit semantics are unchanged. Promotion remains blocked pending targeted stress, full local requalification and fresh hosted exact-head Windows CI.


### 2026-10-07 — stable Browser dependency admitted for v0.10.17

Remote Commander Browser v0.8.0 is published non-draft/non-prerelease and immutable. Stable tag peels to Browser merge commit `239a171eebb0f673f3bd57f59de80cf9229b3df6` with qualified tree `a203fbe8b0d3809de21c6647138dc5fbeca3ed98`. Official Setup asset is `Remote-Commander-Browser-Setup-v0.8.0.exe` size 136253241 bytes, SHA-256 `61fd810130845815dd20073f72051aec3b42c1a89b9577b3457f2190bd9b1a5e`. Commander v0.10.17 now pins that exact stable dependency. No user Browser profile/session authority changes.

**Current gate:** real dependency download/hash + bundled Setup compile, then fresh exact-head hosted/cross-host qualification.
### 2026-10-07 — deterministic conversation handoff test closure

**Failure:** push-CI run `37533283937` failed only `conversation-continuation.test.mjs` while Windows Job Object/output-retention tests and Ubuntu CI passed. The acknowledged-handoff fixture polled for only 1500 ms and asserted false after hosted scheduler delay; production controller already exposes its serialized `drainPromise`.

**Root cause / prevention:** stale test polling was replaced by `await controller.drain()` before deterministic state assertions. Production `src/conversation-continuation.mjs` remained byte-identical, SHA-256 `FC2472B024A73AA86655ECF03FD6A9C17C0F7323B946C126C45B00489F0715A3`; no delivery timeout, retry, acknowledgement or runtime behavior changed.

**V&V:** patched test SHA-256 `A7BABA1732CF0A46CD9E4AD134F2AE223699E37B7CB1A62317B1CFAE203BADEA`; 10 independent executions passed 8/8 tests each, zero failures. Stable Browser v0.8.0 dependency bundling is independently PASS on exact parent `a58e2ff` with official Browser Setup SHA-256 `61fd810130845815dd20073f72051aec3b42c1a89b9577b3457f2190bd9b1a5e`.

**Current gate:** commit this harness-only closure and run full exact-head qualification plus fresh hosted CI/Release Sync/Server Canary before merge/tag.
### 2026-10-07 — Windows Job Object ownership-predicate closure

**Failure audit:** exact-head local qualification failed the wrapper-termination fixture after both recorded descendant PIDs were confirmed gone because a raw TCP connect still succeeded on the previously reserved numeric port. This was the third recurrence in the Windows Job/fixture family, so blind timeout/predicate patching stopped and historical + primary-source review was performed.

**Primary semantics:** Microsoft Job Objects documentation states that child processes are associated with the parent job by default unless breakaway limits are enabled, and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` terminates all associated processes when the last job handle closes. The production runner uses `CreateJobObject`, sets only KILL_ON_JOB_CLOSE, creates the root suspended, assigns it before resume, and exposes no breakaway flag. Microsoft `Get-NetTCPConnection` exposes `OwningProcess`, allowing listener identity rather than raw port occupancy to be tested. Sources: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects and https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-nettcpconnection .

**Root cause:** regression predicate conflated numeric port occupancy with original grandchild ownership. A different process may bind the freed port after the Job-owned process exits. Production runner behavior was not changed.

**Mutation / prevention:** test helper now resolves listeners via `Get-NetTCPConnection -LocalPort <port> -State Listen`, captures owning PID + command line, and rejects only the original grandchild identity. When the port is free after cleanup, the test deliberately rebinds it from the test process and proves that foreign reuse is not misclassified as a Job leak.

**V&V:** patched test SHA-256 `019DF03440600C6431F2BD14CE4D1088FF580F073906EA75A9BE5CE5FFB1AB52`; production runner SHA-256 remains `500882E264368794D6155B232991D94CC33EA73C47ABFF01970091280A501E74`. Five independent targeted Windows runs PASS 1/1 each, zero failures; operation `b1989854-4ad5-4361-a14b-70d4fe7e9c1e` completed exit 0. Previous raw-listener predicate is SUPERSEDED—DO NOT RUN.

**Related release state:** Remote Commander Browser v0.8.0 is published immutable/non-prerelease; official Setup SHA-256 `61fd810130845815dd20073f72051aec3b42c1a89b9577b3457f2190bd9b1a5e`. Emad Browser stable rollout PASS preserved 1821 profile files/501 profile directories and old rc.4 rollback; Saeed stable install was reconciled after wrapper timeout from authoritative post-state: version 0.8.0, package `f624fb89136718e99e52cce35d811b2ca96a5c2ff01f5223405e24c3cc367768`, no Browser process auto-launched and no profile created.

**Current gate:** full exact-head Commander qualification after this test-only correction; then fresh hosted CI/Release Sync/Server Canary on one final SHA, merge/tag/publish and fleet rollout.
