# ChatGPT Remote Commander — Project Brain

Brain revision: R18
Status: CURRENT / v0.8.23 RELEASE CANDIDATE
As of: 2026-09-22
Project root: %USERPROFILE%\source\repos\ChatGPTRemoteCommander
Public repository: GOD13emad/ChatGPTRemoteCommander

## Final objective and Definition of Done

Deliver a stable Remote Commander release that can run in explicit Full Power on trusted machines, preserves all known capabilities unless a capability is explicitly opted out, supports native Windows GUI control, durable workflows and Project Brain integration, and updates itself candidate-first with local validation, zero-downtime routing, rollback boundaries and no blind mutation replay.

DoD for the current release requires: an immutable stable release tag and assets; clean-checkout check/test/security gates; scope-appropriate GUI evidence (fresh interactive native E2E when native input behavior changes, otherwise byte-identical prior native baseline + current no-input/native/controller regression); candidate validation on the target machine; promotion of every live profile; canonical-route doctor checks; durable-workflow integrity after schema finalization; tunnel profiles targeting canonical routers; autostart/supervisor continuity; removal of superseded release directories; and a post-promotion updater no-op returning CURRENT.

## Authoritative current change set — v0.8.15 release candidate

- Accepted upstream product authority remains cumulative through v0.8.13: zero-interference desktop authority (v0.8.10), stable-router downstream response-drain accounting (v0.8.11), monotonic no-downgrade updater (v0.8.12), and fail-closed supervisor continuity (v0.8.13).
- v0.8.14 candidate added ownership-tracked candidate cleanup on Windows/Linux, removed unattended dependence on shared interactive `gui_status`, and introduced a checksum-manifested Full Power installer bundle. Its source gates and first isolated installer acceptance on code commit `a8ed68c...` passed.
- During exact-tag installer-bundle acceptance from final v0.8.14 tag/commit `36fbaed...`, fresh install correctly pinned the tag, installed verified tunnel-client and enabled Full Power + GUI, but its built-in `npm run check` exposed a nondeterministic test-harness failure before publication: `test/stable-router.test.mjs` received Node `fetch failed / bad port`.
- Root cause: test helper `freePort()` accepts any free TCP port allocated by the OS, while Node Fetch applies browser Fetch blocked-port policy and can reject otherwise valid ports such as 5060 before any local request is sent. This is test infrastructure, not router runtime behavior.
- v0.8.15 replaces local stable-router test traffic with `node:http`, matching the transport under test and eliminating Fetch blocked-port semantics. Product/router runtime code is unchanged by this fix.
- Focused corrected stable-router suite passed 10 consecutive runs before full v0.8.15 release gates.
- v0.8.14 was never published as a GitHub Release; its pushed candidate tag is superseded and must not be treated as stable authority. v0.8.15 carries all v0.8.14 hardening forward.
- Installer DoD remains: exact release/commit pin, candidate-first upgrade, isolated fresh Full Power + GUI acceptance from the final tag, official tunnel-client SHA-256 verification, installer bundle internal manifest, release SHA256SUMS verification, and no StartServer during acceptance so production routes/desktop remain untouched.
- GUI input implementation is unchanged; no mouse/keyboard/focus takeover is authorized or required.
- Full v0.8.15 source gates are PASS: stable-router 10x focused repetition, 106/106 core, 73/73 GUI, check/test/audit, native no-input X64 layout and Linux Bash syntax. Exact next action: commit/push if origin/main still matches current authority; retire the unpublished v0.8.14 candidate tag; create v0.8.15 tag; build and execute exact-tag installer bundle in a fresh sandbox; create draft release, verify all local/remote digests, publish immutable, candidate-only validate both production profiles, promote/maintain, verify routes/router source/tunnels/workflows/supervisor/orphan absence, require final stable updater `CURRENT`, then close R11 as FINAL in a docs-only post-release evidence commit.

## Superseded historical state retained from R5

- Stable release: v0.8.6
- Release commit: 1a5c7613252b8f98836bcd26861449a792d4651f
- Release URL: https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/tag/v0.8.6
- Installed control checkout: %LOCALAPPDATA%\ChatGPTRemoteCommander\app, detached at the release commit.
- Active release directory: %LOCALAPPDATA%\ChatGPTRemoteCommander\releases\v0.8.6-1a5c7613252b
- Only active release directory after cleanup: v0.8.6-1a5c7613252b.
- Default canonical router: 127.0.0.1:47831 -> backend 48831.
- saeed-emad canonical router: 127.0.0.1:47834 -> backend 48832.
- Tunnel profile chatgpt-remote-commander targets http://127.0.0.1:47831/mcp.
- Tunnel profile saeed-emad targets http://127.0.0.1:47834/mcp.
- Both profiles: FULL_POWER, explicitly authorized, persistAcrossUpdates=true, autoEnableNewCapabilities=true, disabledCapabilities=[].
- Both profiles grant all 22 capabilities present in Capability Profile v2, including full filesystem, unrestricted shell, process control/terminate, permanent delete, persistent terminals, all four GUI capabilities, durable/autonomous workflow capabilities, auto-update and zero-downtime update.
- Automatic update channel: stable; enabled; zero-downtime enabled; interval 15 minutes.
- Durable Workflows: R2, schema/database version 2, database integrity ok, scheduler enabled, autonomous continuation enabled, one-writer-per-root enabled.
- Windows autostart is registered and a single current supervisor is running from the installed app.
- Final updater self-check after promotion/maintenance: AUTO_UPDATE_CURRENT version=0.8.6.
- Deep re-audit on 2026-09-20 reran check, test, security audit, both canonical doctors and native Windows GUI E2E: all PASS; tunnel readiness is PASS for both profiles.
- Release artifact integrity was reverified by downloading the v0.8.5 assets: all 11 non-checksum assets matched SHA256SUMS.txt exactly.
- Supply-chain DoD caveat: GitHub reports v0.8.5 isImmutable=false and repository immutable-release policy is disabled; the annotated v0.8.5 tag has no cryptographic Git signature. Therefore v0.8.5 is operationally validated but does not satisfy the literal immutable-release part of the stated DoD.

## Roadmap and state

1. Baseline/authority audit — Completed / evidence-backed.
2. Candidate-first updater and Full Power capability profile — Completed.
3. Clean-checkout release integrity — Completed.
4. Native Windows GUI E2E — Completed.
5. Security/history audit — Completed.
6. Duplicate target-discovery root cause and regression — Completed in v0.8.4.
7. Candidate-only dry run on the validated Windows target — Completed: CANDIDATE_PASS.
8. Blue/green promotion of default and saeed-emad — Completed: PROMOTED.
9. Canonical route/tunnel/workflow/autostart post-validation — Completed.
10. Auto-update idempotency on current release — Completed: CURRENT.
11. Project Brain / Knowledge Evidence handoff — CURRENT: completed by this revision.
12. Cross-platform Linux release-gate portability audit — Completed; v0.8.4 reproduced four Linux fixture failures under Ubuntu 24.04 / Node 22.
13. Portable profile-instance fixture hotfix — Completed in v0.8.5; production local-path guard unchanged.
14. Windows + Ubuntu/Node22 validation of v0.8.5 — Completed / PASS.
15. Candidate-only and automatic blue/green promotion to v0.8.5 — Completed / PASS.
16. GitHub-hosted CI — OPEN EXTERNAL GATE: the account is already GitHub Free and Copilot Free with zero observed usage/payments, but a stale failed payment-authorization hold keeps the account billing-locked. An official GitHub Support ticket remains open with no staff reply visible in the latest audit; no runner is assigned until GitHub clears it.
17. Full live-system re-audit — Completed / PASS for runtime, local regression, native GUI, routes, tunnels, updater and release-asset hashes.
18. Durable Remote Commander workflow authority reconciliation — Completed: default and saeed-emad workflow checkpoints advanced from stale v0.7.3 evidence to v0.8.5 audit evidence, then were explicitly paused so persisted state and scheduler/list both report WAITING with scheduler disabled; unrelated thesis workflow was not changed.
19. Supply-chain hardening — Completed for release immutability, least-privilege Actions permission and full-SHA action pinning in v0.8.6; signed Git tag remains optional/open because no signing identity was configured.
20. v0.8.6 clean Windows + Ubuntu/Node22 validation — Completed / PASS.
21. v0.8.6 immutable GitHub publication — Completed / PASS.
22. v0.8.6 candidate validation, generation-3 cutover and post-commit maintenance recovery — Completed / PASS; long-lived old saeed request caused one DRAIN_TIMEOUT and is retained as future updater-regression evidence.
23. GUI read-performance optimization — ← CURRENT next phase.

No product/runtime blocker remains for published v0.8.6. GitHub-hosted Actions remains externally blocked by the stale account-level billing lock; local Windows, native-GUI and Ubuntu/Node22 gates are PASS. GitHub Support remains the owner of that external server-side lock.

## Closed failure chain

- Windows updater gate helper used a PowerShell automatic-variable name and launched npm without intended arguments. Prevention: dedicated command-argument parameter plus missing-argument guard.
- Clean staged update depended on an untracked helper. Prevention: source-integrity checks now require lifecycle/updater dependencies to be Git-tracked.
- Native GUI clean checkout assumed an ignored runtime directory existed. Prevention: E2E creates its own runtime directory.
- Security history scan treated an uppercase status symbol as a tunnel identifier. Prevention: canonical lowercase tunnel_ detector plus regression.
- v0.8.3 candidate cleanup failed with repeated saeed-emad candidates. Root cause: recursive discovery included historical instance.json files inside backup trees. Prevention in v0.8.4: enumerate only immediate profile directories, bind exactly one instance.json per profile directory, and fail closed on directory/profile identity mismatch.
- A later GUI gate observed GUI_NATIVE_BUSY. Evidence showed the global GUI helper mutex was contended; a controlled run with no competing GUI helper passed full capture/focus/click/Unicode typing/screenshot verification. Existing behavior remains fail-closed; no mutation retry was added to mask uncertain GUI outcomes.

## Current R5 release baseline — v0.8.6

- Published release: v0.8.6 at commit `1a5c7613252b8f98836bcd26861449a792d4651f`.
- GitHub immutable-release repository policy: enabled before publication.
- Release publication flow: draft -> all 12 assets uploaded -> GitHub digest comparison 12/12 PASS -> publish.
- Published release state: `isDraft=false`, `isImmutable=true`; v0.8.6 is the first immutable Remote Commander release.
- Supply-chain CI hardening included in the release: `permissions: contents: read`; checkout/setup-node are pinned to full commit SHAs instead of floating major tags.
- Workflow consistency defect from R4 is fixed in source and regression-tested: checkpoint lifecycle and scheduler projection are updated in the same SQLite transaction.
- Windows source gates: check/test/security PASS. Clean detached Windows checkout: check/test/security/native-GUI E2E PASS.
- Ubuntu 24.04 / Node 22.23.2 exact public commit: check/test/security PASS.
- Candidate-only updater on the validated Windows target: CANDIDATE_PASS for exactly default and saeed-emad, both doctor/hardware/shadow/live-store PASS.
- Cutover committed both canonical routes to generation 3 / v0.8.6. A pre-cutover long-lived request on the old saeed-emad backend did not drain within 60 seconds and produced `DRAIN_TIMEOUT` after commit. The old backend had no child workload; exact marker/listener ownership was verified, it was stopped narrowly, router inflight cleared, and the updater's explicit post-commit maintenance path completed.
- Post-maintenance state: app control checkout equals release commit; supervisor recycle PASS; only v0.8.6 release directory remains; updater returns CURRENT v0.8.6.
- Both canonical doctors PASS at v0.8.6; both tunnel `/readyz` endpoints return HTTP 200 ready; workflow databases are schema 2 / integrity ok.
- Full Power remains unchanged: 22 granted capabilities, no disabled capabilities.
- Tag is annotated but unsigned because no configured signing key/GPG installation was present. Immutable GitHub release integrity is confirmed; signed-tag identity remains a separate optional hardening item.
- Next product phase is GUI-read latency/performance. The release baseline is frozen; GUI optimization will start from benchmarked read-only timings before mutation.

## Open external blocker — GitHub billing state

- Confirmed account plan: GitHub Free, USD 0/month.
- Confirmed Copilot plan: Copilot Free, USD 0/month.
- Billing Overview showed zero observed usage; Payment History showed no payments.
- Payment Information reported Invalid payment method - authorization hold failed; no saved payment method with an Edit/Remove control was observed.
- GitHub Support's own guided solution identified the condition as a billing lock on a free account tied to a failed payment authorization.
- Hosted CI run attempt 3 was repeated after dismissing the alert; Windows and Ubuntu again executed zero steps and returned the same account-lock annotation.
- An official GitHub Support ticket was successfully submitted and is open. Its private identifier/URL is retained only in local private evidence, not this public repository.
- Status: external / server-side / awaiting GitHub Support. Product code and runtime remain PASS.
## Deep audit R4 — current result

- Core/runtime: PASS. Both canonical endpoints report v0.8.5, FULL_POWER, full filesystem, GUI enabled, 54 tools / 15 GUI tools, and no doctor warnings.
- Regression: PASS. Current `npm run check`, `npm test`, project security audit, source-integrity/runtime-contract gates and native Windows GUI E2E all passed. Native GUI validated focus, click, multilingual Unicode typing, button activation, screenshot change, cursor restore and foreground restore.
- Durable workflow databases: PASS for integrity/schema 2. `runnerConfigured=false` is a documented execution boundary, not a failure. The two Remote Commander workflow checkpoints were stale at v0.7.3 and were reconciled to v0.8.5, then explicitly paused; workflow list now reports revision 4 / WAITING / scheduler disabled for both. Audit also exposed a low-severity implementation consistency gap: `workflow_checkpoint` changes snapshot lifecycle to WAITING without synchronizing `scheduler_jobs` until a control transition.
- Release artifacts: PASS for present integrity; 11/11 downloaded v0.8.5 assets matched `SHA256SUMS.txt`.
- Release immutability: NOT MET. GitHub API reports repository immutable releases disabled and v0.8.5 `isImmutable=false`. GitHub documents that enabling release immutability applies only to future releases, so this release cannot be retroactively promoted to an immutable one.
- Tag authenticity: HARDENING OPEN. `git verify-tag v0.8.5` reports no signature. The annotated tag does dereference to the accepted release commit.
- CI workflow hardening: PARTIAL. `.github/workflows/ci.yml` uses `actions/checkout@v4` and `actions/setup-node@v4` rather than full commit SHAs and does not declare explicit least-privilege `permissions`. GitHub recommends full-SHA action pinning and minimum `GITHUB_TOKEN` permissions.
- Dependency vulnerability audit: NOT APPLICABLE/UNPROVEN through `npm audit` because no package-lock exists; `npm audit` returned ENOLOCK. The current `package.json` declares no dependency fields, so this is not evidence of a vulnerable dependency.
- Tunnel observations: both `/readyz` endpoints are currently PASS. The default tunnel recovered from transient control-plane/Cloudflare HTTP 502 responses; saeed-emad logged one startup OAuth-discovery metadata warning but remains ready.
- Repository hygiene: tracked tree is clean, but the source root contains a large unrelated untracked GCAD/engineering scratch set. It is excluded from release authority and intentionally not deleted without separate ownership authority.
- Legacy workflow Brain mirror: root `PROJECT_BRAIN.md` is untracked and its historical top section still states v0.7.3, although its generated Remote Commander workflow sections were updated. It is STALE as project authority; `docs/PROJECT_CONTROL_STATE.md` remains the authoritative Project Brain.
- Overall: operational core and local release validation are PASS, but whole-project FINAL is not yet evidence-backed because hosted CI is externally blocked and the immutable-release DoD is not met.
## Verification versus validation

Verification evidence includes clean repository gates, contract tests, security audit, source integrity, native GUI E2E, doctor checks and workflow database integrity. Validation on the target machine includes the candidate-only updater run, exact two-profile discovery, blue/green cutover, canonical router checks, tunnel target checks, autostart continuity and CURRENT no-op behavior.

## Deferred / non-blocking observations

- The source working directory contains many unrelated untracked GCAD/engineering files. They were not modified or included in the release; all release gates were run from a separate clean detached worktree. Cleanup requires separate ownership/authority and is intentionally deferred.
- Legacy profile baseline files under instances are not the active routed runtime authority after promotion. The durable route files are authoritative and the supervisor starts routed backends from their active.configPath. Do not delete legacy baselines without a separate rollback-policy change.
- Workflow health reports runnerConfigured=false; scheduler/continuation state is healthy and this is not a capability-profile regression. Any external host-runner integration is a separate future scope.
- GitHub Actions hosted CI is currently unavailable because a stale failed payment-authorization hold keeps the otherwise-Free account billing-locked. The v0.8.5 Ubuntu job was reproduced locally on Ubuntu 24.04 with Node 22 and check/test/audit PASS. Three hosted-CI attempts executed zero workflow steps, including one after dismissing the billing alert, proving the remaining lock is server-side. GitHub Support has accepted a ticket; hosted CI remains UNPROVEN until Support clears the lock and one clean rerun passes.

## Authoritative evidence locations

- %LOCALAPPDATA%\ChatGPTRemoteCommander\last-update.json
- %LOCALAPPDATA%\ChatGPTRemoteCommander\update-logs\auto-update.log
- %LOCALAPPDATA%\ChatGPTRemoteCommander\routing\default.json
- %LOCALAPPDATA%\ChatGPTRemoteCommander\routing\saeed-emad.json
- %LOCALAPPDATA%\ChatGPTRemoteCommander\runtimes\1a5c7613252b8f98836bcd26861449a792d4651f\...
- %LOCALAPPDATA%\ChatGPTRemoteCommander\update-backups\1a5c7613252b8f98836bcd26861449a792d4651f\...
- Clean validation logs listed in PROJECT_KNOWLEDGE_EVIDENCE.md.
- Git tag v0.8.6 and immutable GitHub Release v0.8.6.
- Private external support evidence: %LOCALAPPDATA%\ChatGPTRemoteCommander\private-evidence\github-billing-support-ticket.json, SHA-256 6b21efb925486ce78f5c419496609b8c9634c65d264c9c0be9cdbb92d30c848e. The public repository intentionally does not expose the private support ticket identifier/URL.
- Deep audit evidence: %LOCALAPPDATA%\ChatGPTRemoteCommander\audit\REMOTE_COMMANDER_DEEP_AUDIT_20260920.json, SHA-256 8c7943b53fdc5beeb808361b8f6b17196e57e1c5b90b9c4a1e7d14b097b76cbe.

## Exact next action

Start the GUI read-performance phase from v0.8.6 without changing the frozen release. First benchmark status/list-windows/screenshot latency and payload size, split process-startup/helper-load/capture/encode/transport costs, then choose the minimum sufficient optimization that preserves lease/frame/uncertain-outcome safety. Keep the GitHub billing-support gate separate; do not block GUI performance work on hosted CI.

## HISTORY — append only

- 2026-09-20 / R1: Established v0.8.4 as the promoted stable baseline on the validated Windows target; both profiles Full Power; zero-downtime routes, durable workflows, tunnels, autostart and auto-update post-check verified. v0.8.3 is superseded.
- 2026-09-20 / R2: Reproduced the otherwise-hidden Linux CI fixture defect under Ubuntu 24.04 / Node 22, fixed it without relaxing production guards, released and automatically promoted v0.8.5, and recorded GitHub hosted CI as an external billing-blocked gate rather than a product failure.
- 2026-09-20 / R3: Proved the GitHub account is already Free with no payment history or paid subscription, isolated the blocker to a stale failed payment-authorization hold, confirmed the lock persists server-side after another zero-step CI rerun, and submitted a private GitHub Support ticket for lock removal without adding a payment method.
- 2026-09-20 / R4: Performed a full live re-audit; reran local regression/security/native-GUI and both doctor gates; verified 11/11 release assets; identified immutable-release, unsigned-tag and CI-permission/SHA-pinning hardening gaps; reconciled stale Remote Commander durable-workflow checkpoints to v0.8.5; kept the unrelated thesis workflow untouched.
- 2026-09-20 / R5: Released v0.8.6 from exact cross-platform-validated commit; enabled immutable releases; published draft-first with 12/12 asset digests verified; fixed workflow checkpoint/scheduler consistency; hardened Actions SHA pinning/permissions; promoted both profiles to generation 3; recovered one post-commit saeed drain timeout with ownership-proven old-backend stop and official maintenance path; final updater state CURRENT v0.8.6. GUI read latency is the next phase.

## Current Linux hardening phase — v0.8.16 candidate

- Objective: close Linux-specific lifecycle/release gaps found on the real `aliemad-Labtop` deployment without changing Windows GUI/runtime semantics.
- Previous accepted source: v0.8.15 at `221fcc7adb88c001c238eb6e6af52e4ec53e3f64`.
- Live Linux runtime at audit start: v0.8.13, FULL_POWER, tunnel ready, canonical router/backend healthy; source/runtime version drift existed because scheduled auto-update was not launching.
- Confirmed root cause on target: systemd supervisor PATH excluded the portable Node/npm installed by Remote Commander; scheduler function therefore could not execute its Node-based config reads and silently returned through the supervisor's tolerant loop.
- Change Set (one Linux lifecycle objective): portable-runtime PATH bootstrap + explicit runtime failure; Git 100755 executable metadata for Linux scripts; ownership-aware routed shutdown cleanup; bounded tunnel-client asset download; self-safe systemd updater recycle ordering; source-integrity/updater regressions.
- Verification so far: public v0.8.15 Ubuntu baseline check/test/audit PASS; changed shell syntax PASS on live Ubuntu after one rejected pre-commit patch-generation failure; full Windows source check/test/audit PASS including 106/106 core tests, 73/73 GUI contract tests and SECURITY_AUDIT_PASS.
- Conditional/deferred: systemd user lingering remains OFF on the target and is not automatically changed. This only matters if Remote Commander must remain active after user logout; current login-bound desktop requirement is satisfied.
- Current gate: exact committed-tree Ubuntu validation, then immutable v0.8.16 publication and live Linux promotion.
- Exact next action: commit only tracked Remote Commander v0.8.16 files, push, validate exact commit from clean Ubuntu clone, then publish/promote only on PASS.

## HISTORY — Linux R1 delta

- 2026-09-21: Deep Linux audit converted live failures into four bounded product fixes and regression guards; no unrelated untracked engineering/GCAD files were modified.

## Linux hardening successor — v0.8.17

- Trigger: live v0.8.16 promotion was blocked by `AUTO_UPDATE_ALREADY_RUNNING` despite no updater process.
- Confirmed blocker: active v0.8.13 backend and stable router inherited and retained fd 9 for `auto-update.lock`; this is why the scheduler/update path remained permanently locked after the first cutover.
- Change: close fd 9 explicitly in long-lived backend/router spawn paths; add source regression.
- Authority rule: v0.8.16 remains immutable historical release; correction is a new v0.8.17 release.
- Current gate: source/full regression -> exact commit Ubuntu validation -> immutable release -> one-time live stale-lock recovery -> v0.8.17 promotion -> second-update/lock-free regression.
- Exact next action: validate and publish the successor only after all gates pass.

## HISTORY — Linux R2 delta

- 2026-09-21: Live post-publish evidence exposed updater-lock FD inheritance; no blind rerun performed, and successor release path selected instead of mutating immutable v0.8.16.

## Linux hardening closeout state — v0.8.17 published

- Source/release: PASS. `main` release commit `6bd826502a048640baf3c77fa4b74bc40e8e977d`; tag `v0.8.17` resolves to it; GitHub Latest is v0.8.17 and immutable.
- Cross-platform verification: PASS. Windows full check/test/audit/security gates PASS; exact Ubuntu 24.04.4 WSL2 checkout PASS including shell parse, 100755 executable modes, updater lock-FD guards, check/test/audit.
- Release artifacts: PASS. 13/13 draft assets matched local SHA-256 before publish.
- Root causes closed in product: systemd portable-runtime PATH; Linux executable-bit release drift; ownership-aware routed shutdown cleanup; bounded tunnel-client download; self-safe systemd updater restart ordering; updater lock descriptor inheritance into long-lived backend/router children.
- Live `aliemad-Labtop`: BLOCKED BY ACCESS, not by release validation. Device is alive on LAN at 192.168.10.6 but tunnel-client is not polling; no SSH/RDP/VNC/WinRM/canonical MCP or bounded common remote-management port is reachable. Live runtime remains last-confirmed v0.8.13 until directly revalidated.
- DoD: release engineering DONE; live Linux deployment gate OPEN. FINAL-LIVE must not be claimed until direct target evidence shows v0.8.17 route/backend/tunnel health and a second updater run no longer reports `AUTO_UPDATE_ALREADY_RUNNING`.
- Brain authority: this file remains CURRENT. Root `PROJECT_BRAIN.md` is a legacy/untracked mirror and remains STALE by prior decision; do not create a second competing authority.
- Exact next action: execute the single recovery runner locally on `aliemad-Labtop` (or regain Remote Commander), then capture the generated Return and complete live promotion/second-update verification.

## HISTORY — Linux R3 delta

- 2026-09-21: Published immutable v0.8.17 after exact Ubuntu and Windows validation; all product-level Linux defects found in R1/R2 are guarded. Live promotion is explicitly OPEN solely because the laptop currently exposes no authorized remote execution channel.

## Linux local-recovery fallback

- Runner: `RC_LINUX_RECOVERY_V0817.zip`, SHA-256 `db3ceb41df02ada77c988335b72ef79ae05f34eadd446b63cc4a3ae5dd8e3944`.
- Exact pinned authority: v0.8.17 / `6bd826502a048640baf3c77fa4b74bc40e8e977d` / release `install.sh` SHA-256 `486b69e33d537768761887bbe4b39f0fc3ded6efc5b28d18932bbd39b1cc7d49`.
- Execution scope: local on `aliemad-Labtop` only; fail-closed if existing tunnel identity/credential is missing; no secret capture or credential deletion.
- Expected Return: one `RETURN_RC_LINUX_V0817_<UTC timestamp>.zip`.
- Promotion status remains OPEN until Return or restored live connector proves PASS.


## Windows drain/version successor — v0.8.18

- Trigger: live v0.8.15 promotion exposed a non-cancellable stale router entry after the updater was invoked through MCP `run_shell`; the old backend itself reported zero active/queued operations while the router retained the updater request.
- Confirmed root cause: the Windows updater spawned long-lived backend children from a piped shell context without an explicit detach boundary. Behavioral reproduction showed child stdio inheritance can keep the caller pipe open after the updater process exits.
- Prevention: staged Windows backends use detached `Start-Process` without stdout/stderr redirection; behavioral test `BACKEND_STDIO_DETACH_PASS` requires parent EOF while child remains alive.
- Recovery policy: stale drain retirement is evidence-based, not version-based. Required proof is exact old-backend ownership/version/profile, activeOperations=0, queued=0, only canonical-router TCP peer, GUI not busy/leased, no persistent terminal or other unsafe descendant, and a second immediate proof before stop.
- Route-state prevention: successful ownership-proven drain/cleanup atomically clears `route.previous` with generation/profile/previous-port/previous-commit preconditions on Windows and Linux.
- Additional authority defect: public v0.8.16/v0.8.17 package/plugin metadata advanced while `src/server-v0.3.mjs` still declared 0.8.15. v0.8.18 restores package/plugin/server equality and adds a release regression.
- GUI/native input behavior is unchanged; no interactive desktop takeover is needed for this release.
- Current verification: source/full release gates PASS — 109/109 core, 73/73 GUI, check/test/audit, native no-input Windows self-test, Linux syntax, stdio detach, stale-drain policy, route-retire and version-authority regressions.
- Exact next action: run full v0.8.18 gates; commit only this isolated worktree if origin/main still equals the audited baseline; then exact-tag installer acceptance, immutable draft-first publication, candidate-only validation, production promotion and orphan cleanup with ownership evidence.

## HISTORY — R12 delta

- 2026-09-21: Converted the v0.8.15 Windows drain incident into stdio-inheritance prevention, evidence-gated recovery, persistent-terminal protection, atomic route retirement, and runtime-version authority regression.


## Maintenance-loop successor — v0.8.19

- Trigger: the GUI/chess stress test exposed repeated supervisor recycle/tunnel churn while production routes were already healthy on v0.8.18.
- Confirmed root cause: stale superseded-release directories remained locked by three old unrouted backend processes. `Has-SupersededRelease` treated those directories as maintenance, `Cleanup-Releases` silently ignored failed deletion, and maintenance unconditionally called `Recycle-ControlSupervisor`. Supervisor restart reset the auto-update due time, causing an immediate maintenance/recycle feedback loop.
- Production recovery: v0.8.9/v0.8.10/v0.8.11 orphan backends were stopped only after ownership proof, unrouted-state proof, exact listener ownership, zero active/queued operations, zero established connections and no unsafe descendants. Only v0.8.18 release runtime remained afterward.
- Live stability evidence: scheduled update checks from 14:09 through 18:25 repeatedly reported `AUTO_UPDATE_CURRENT` with no further supervisor recycle loop.
- Product prevention: cleanup-only maintenance no longer recycles the supervisor. Windows cleanup emits explicit PASS/DEFER events and persists `CLEANUP_PENDING`; Linux receives the equivalent separation. Supervisor recycle remains allowed only for actual control-code promotion.
- Behavioral regression: a removable stale-release fixture was deleted while supervisor PID 40124 remained unchanged; an intentionally locked stale-release fixture returned `AUTO_UPDATE_CLEANUP_PENDING`, emitted no supervisor recycle, and preserved the same supervisor PID.
- Source validation: full v0.8.19 release-candidate gates PASS — 109/109 core, 73/73 GUI, check/test/audit, installer/onboarding/source-integrity/security, Windows native self-test, Linux syntax and diff integrity.
- Desktop interference policy remains unchanged and enforced: observe-only is default; mutation requires explicit takeover authorization. No interactive desktop input is required for this release.
- Open release gates: commit/remote authority check, exact-tag installer acceptance, immutable publication, candidate-only validation, production promotion, post-promotion `CURRENT` verification.
- Exact next action: complete those release gates in order; do not publish or promote on any regression or remote-authority drift.

## HISTORY — R13 delta

- 2026-09-21: Converted chess/GUI stress-test maintenance churn into a confirmed updater/supervisor feedback-loop root cause, ownership-safe orphan recovery, cleanup/no-recycle product fix and behavioral regression.


## v0.8.19 release closeout and terminal-drain successor — v0.8.20

- v0.8.19 release authority: public GitHub release, Latest and immutable; tag `v0.8.19^{}` resolves to commit `4538b1b7931c8f709dfb77553e21e22fd7b4dc9f`. Draft-first publication verified 13/13 asset SHA-256 and sizes. Exact-tag Full Power installer acceptance PASS with package/server 0.8.19, 22 granted capabilities and GUI enabled.
- Windows live state after v0.8.19: default and saeed-emad canonical routes both run exact v0.8.19 commit. saeed-emad drained fully. default intentionally retains previous v0.8.18 because three Remote Commander persistent terminals are still children of that backend; one is confirmed to own a live `python -m http.server 8765` workload under `H:\Nima`. No force stop was performed.
- Linux live state after v0.8.19: `aliemad-Labtop` runs exact commit `4538b1b...`, package/runtime 0.8.19, route `previous=null`, only the v0.8.19 release directory, updater lock FREE, user service active and canonical health/tunnel ready.
- Newly confirmed product gap: v0.8.19 protects persistent terminals in one stale-drain evidence branch, but pre-cutover route switching can make the old terminal session unreachable from the new canonical backend; additionally both platforms had stop paths that could retire an old backend when router inflight became zero without first checking terminal ownership.
- Method choice / external benchmark: VS Code documents terminal process reconnection and detach/attach; tmux keeps terminal programs in a separate persistent server; Kubernetes documents graceful endpoint/connection draining before termination. These support preserving the session owner or deferring cutover. A new cross-version terminal broker would provide richer reconnect semantics but is disproportionate for this change set. Minimum sufficient control is pre-cutover terminal admission plus pre-retirement terminal guard.
- v0.8.20 implementation: Windows detects direct child `pwsh.exe -NoLogo -NoProfile`; Linux detects direct child shell `--noprofile --norc`. Automatic candidate promotion is stopped before any route mutation when such a terminal exists. Deferred-drain retirement also checks the same evidence before every backend stop path.
- Focused validation: updater contract 9/9 PASS; Windows updater self-test PASS; Linux `bash -n` PASS; diff integrity PASS.
- Full v0.8.20 release-candidate validation: check/test/audit/native no-input GUI/Linux syntax PASS; core 109/109 and GUI 73/73 PASS; installer/onboarding/source-integrity/security PASS.
- GUI/non-interference scope: no mouse movement, click, keyboard injection or window focus is required or used by this successor.
- Remote-CAS/push PASS: v0.8.20 product-code commit `c7c086c2900f5190423f30b60a78d000d94f2fb5` is on `origin/main`. Independent clean Linux exact-commit validation PASS (`check`, `test`, audit, updater contract 9/9, shell syntax).
- Open release gates: documentation closeout commit, exact-tag installer acceptance, immutable release publication, Linux promotion where safe, Windows promotion subject to live persistent-terminal admission.
- Exact next action: complete v0.8.20 release gates; never terminate the existing default-profile persistent terminals merely to make deployment look clean.

## HISTORY — R14 delta

- 2026-09-21: Closed the persistent-terminal update safety gap with proportional pre-cutover and pre-retirement guards; retained the user's live H:\Nima workload without force mutation.


## GitHub Actions dependency-maintenance hardening — 2026-09-22

- Baseline release authority remains immutable v0.8.19 at `4538b1b7931c8f709dfb77553e21e22fd7b4dc9f`.
- Governance-only successor on `main`: `a7d0fa6db5b609ea3c134f351c16ccb9159fc49b`, adding `.github/dependabot.yml` for weekly GitHub Actions updates.
- Product/runtime source behavior is unchanged by this successor.
- Existing CI already uses explicit `contents: read` and full commit-SHA action pins; Dependabot now provides controlled maintenance for those pins.
- Hosted CI remains externally blocked before step execution by the GitHub account billing authorization lock. A controlled rerun of the v0.8.19 CI on 2026-09-22 produced a second zero-step failure on both Windows and Ubuntu.
- GitHub Support response was not present in connected Gmail at audit time. The official GitHub recovery path for a failed authorization hold requires billing/payment information to be updated in the account UI; the current GitHub connector exposes no billing/admin write action.
- Exact next action for the external gate: clear the account billing authorization lock in GitHub Billing & Licensing, then rerun unchanged hosted CI and require real non-null steps on both hosted OS jobs before closing the gate.


### Dependabot pause delta — 2026-09-22

- The temporary GitHub Actions Dependabot configuration was removed after it immediately created major-version update branches while hosted CI is account-billing locked.
- Reason: those branches generated additional zero-step CI failures and email noise without providing executable validation.
- Existing workflow protections remain in place: explicit least-privilege permissions and full commit-SHA pins.
- Dependabot branch refs created during the short-lived configuration are not merged and must not be treated as accepted updates. No PR is currently open for them.
- Reactivate automated dependency update PRs only after hosted CI can execute real steps again.

## Linux GUI / zero-interference successor — v0.8.21

- Previous authority: origin/main v0.8.20 commit c7c086c2900f5190423f30b60a78d000d94f2fb5. The earlier local GUI candidate was based on v0.8.18 and was not pushed after remote authority advanced through public v0.8.19/v0.8.20; its patch was preserved with SHA-256 13f7623fcd35e1e51cb5030d119c8406d8f9994faa4eac866127e557bf8af23b and rebased semantically onto v0.8.20 instead of overwriting upstream.
- Objective: add Linux GNOME/Wayland GUI capability while preserving v0.8.20 persistent-terminal protection, v0.8.19 cleanup/no-recycle behavior and the v0.8.10 explicit desktop-takeover boundary.
- Linux GUI architecture: GNOME Shell extension plus bounded Python helper. X11-only tooling and denied public Shell/Mutter introspection were rejected as incomplete for the real Wayland target. The extension rechecks foreground/geometry immediately before mutation, honors local stop files and uses a per-user mode-0600 token.
- Zero-interference invariant: interactionPolicy=explicit-current-request-only; defaultSessionMode=observe; backgroundPreferred=true; workflowTakeoverAllowed=false; foregroundInterferenceByDefault=false. Full Power grants capability, not permission to seize the foreground desktop.
- Updater integration: Git tag discovery is primary with Releases API fallback. GUI backend synchronization is additive to the v0.8.20 control-promotion paths; cleanup-only maintenance still never recycles the supervisor, and persistent terminals still block route cutover/retirement.
- Scheduler truthfulness: automaticContinuationScope=RECOVERY_AND_READINESS_ONLY, automaticExecution=false, runnerConfigured=false. No duplicate model runtime is introduced.
- Performance/stress evidence: direct local system_status p50 was about 2.52 ms on backend and 3.00 ms through the stable router; ChatGPT-to-connector shell median was about 1.81 s. Verified Stockfish 19 bench reached about 8.20M nodes/s; a rapid manual game did not beat Stockfish and exposed a decision-quality failure, establishing that latency and reasoning quality require separate gates.
- Competitive audit: official OpenAI Work documentation confirms a separate cloud browser/session; GitHub documents custom agents/subagents and MCP; Anthropic documents native subagent orchestration and cautions against overuse. Universal superiority over Work/Codex/Claude/Copilot remains UNPROVEN and is not a release claim. Remote Commander targets differentiated evidence-backed strengths in real-machine control, explicit authority, rollback/recovery, auditability, one-writer coordination and foreground non-interference.
- Full v0.8.21 source validation after semantic rebase onto v0.8.20: PASS. `npm run check`, `npm test`, `npm run audit`, source-integrity, Linux GUI contract and Windows runtime contract all returned zero; core suite 109 PASS + 1 Windows-only skip, GUI suite 75/75 PASS.
- Linux native GUI interactive E2E remains OPEN because GNOME 46 does not hot-load the new local extension into the already-running Wayland session. No forced logout, Shell restart or reboot is authorized merely to satisfy the gate.
- Post-d037 rebase validation: PASS. Full `npm run check`, `npm test`, `npm run audit`, source-integrity, Linux GUI contract and Windows runtime contract all returned zero again on commit candidate `fa61252...`; core 109 PASS + 1 Windows-only skip, GUI 75/75.
- Remote authority advanced again through governance-only commits `489ff6e`/`d8efbd3` that pause Dependabot while hosted CI is billing-blocked; no runtime/product source changed in that delta. This upstream state is preserved.
- Current gate: rerun full source and exact clean-commit validation after the d8efbd3 rebase, then require a final remote-CAS check before push/tag/publication/promotion.

## HISTORY — R15 delta

- 2026-09-22: Preserved unexpected upstream v0.8.19/v0.8.20 authority, rebased the Linux GUI/zero-interference work as v0.8.21, retained persistent-terminal and cleanup-loop protections, and kept current-session Linux native GUI E2E explicitly unproven rather than forcing desktop disruption.


## Route-generation invariant successor — v0.8.22

- Previous stable authority: immutable v0.8.21 at `31414b65f8292fdc3111f9c31bf886e14458f0cb`, with 13 published assets. Its Linux GNOME/Wayland GUI, zero-interference policy, Git-tag-first updater discovery and scheduler truthfulness are retained unchanged.
- v0.8.20 remains an unpublished tagged candidate only; no v0.8.20 GitHub Release exists.
- Trigger: exact route-lifecycle audit proved a second cutover could overwrite an unresolved `route.previous`; Windows deferred maintenance also had one direct stop path without a persistent-terminal check.
- v0.8.22 objective: one bounded failure-prevention change set — resolve or block every existing previous generation before any new cutover, guard every deferred stop against persistent terminals, and enforce the invariant inside router-switch itself.
- Focused gates PASS: updater/router 13/13, Windows updater self-test, Linux shell syntax, router syntax, Linux GUI contract and diff integrity.
- Desktop policy: no GUI takeover, mouse, keyboard or focus mutation is needed for this release. Existing explicit-current-request-only behavior remains authoritative.
- Live Windows user workload remains protected: the old default backend with persistent terminals must be allowed to keep running until the user/workload ends or is explicitly closed; release rollout must report a safe blocker rather than force cleanup.
- Hosted GitHub Actions remains an external billing-lock gate and does not substitute for local cross-platform release validation.
- Full v0.8.22 source validation PASS: core 111/111, GUI 75/75, check/test/audit, Linux GUI contract, Windows runtime/native no-input, installer/onboarding, source-integrity, security and Linux syntax all PASS.
- Remote-CAS product commit PASS: `968ac2d10da8cc30c66827c625e4a7da636194a3` is on `origin/main`. Independent fresh Linux exact-commit validation PASS (`check`, `test`, audit, focused 13/13, Linux GUI contract, shell syntax).
- Open gates: docs closeout/final tag, exact-tag artifact/installer acceptance, immutable publication, safe Linux rollout, and Windows blocker behavior verification.
- Exact next action: run the complete release suite on version-authoritative v0.8.22, then continue only if every gate passes and origin/main still equals the v0.8.21 authority.

## HISTORY — R16 delta

- 2026-09-22: Preserved the immutable v0.8.21 Linux GUI baseline and added the minimum sufficient route-generation invariant needed to prevent nested cutover/orphaned persistent sessions.


## v0.8.22 final release closeout

- FINAL RELEASE authority: v0.8.22 / `cc736eb5bc457972120a60b22d59b19219e9f659`; GitHub release is Public + Latest + Immutable with 13 assets.
- Final Windows installer: `ChatGPT-Remote-Commander-v0.8.22-Installer.zip`, SHA-256 `7c8cdab91ddabc982248fc66982d845765522ad56724dca8fd4c47348269b8bd`.
- Verification: full source, security, installer/onboarding, Windows runtime/native no-input, Linux syntax/GUI contract, focused route/updater 13/13 and exact Linux commit validation PASS.
- Linux validation: FINAL/PASS. Active route/runtime/control are exact v0.8.22, `previous=null`, only v0.8.22 release remains, service active, updater lock free, second updater run `CURRENT`.
- Windows control-plane: PASS at exact v0.8.22. Runtime route remains safely on v0.8.21 because default `route.previous` v0.8.19 still owns six persistent terminals and a non-cancellable old request. v0.8.22 candidates validate and then return `BLOCKED_EXISTING_DRAIN` before route mutation; candidate processes are cleaned.
- Windows runtime rollout status: SAFE-DEFERRED-BY-LIVE-USER-WORKLOAD. This is the intended fail-closed behavior and must not be bypassed by killing user terminals merely to make the version uniform.
- Linux GUI current-session status: extension is installed+Enabled on GNOME 46 Wayland but currently INACTIVE; backend reports `GUI_GNOME_EXTENSION_UNAVAILABLE`. Native interactive E2E is DEFERRED_SESSION_ACTIVATION until a normal future session lifecycle; no logout/restart/reboot is authorized for this gate.
- Desktop policy: PASS. No mouse/keyboard/focus takeover occurred during release closeout. Explicit-current-request-only / observe-by-default remains authoritative.
- External hosted GitHub Actions billing lock remains an external infrastructure limitation and does not invalidate the completed local Windows + exact Linux release validation. It remains separate from product runtime authority.
- Universal competitive superiority claim remains UNPROVEN and is excluded from FINAL criteria.
- Final Objective/DoD status: release engineering FINAL/PASS; Linux deployment FINAL/PASS; Windows product is operational on accepted v0.8.21 runtime with v0.8.22 control-plane and safe deferred runtime promotion; Linux GUI code/product gate PASS with current-session native activation deferred.
- Exact Next Action: no forced action. Allow current Windows persistent terminals to finish/close normally; the scheduled v0.8.22 updater can then retire the old generation and complete runtime cutover. After the next normal Linux GNOME session start, run read-only `gui_status` then native interactive E2E only with explicit current-request desktop takeover authorization.

## HISTORY — R17 delta

- 2026-09-22: Finalized immutable v0.8.22 release and Linux rollout; converted Windows live-terminal blocking and Linux Wayland extension activation into explicit safe deferred states rather than destructive release blockers.

## Stable-release authority successor — v0.8.23

- Previous stable authority: immutable v0.8.22 at `cc736eb5bc457972120a60b22d59b19219e9f659`. Linux production is active and clean on v0.8.22; Windows default remains safely on active v0.8.21 with previous v0.8.19 because live persistent scientific terminals make a new cutover unsafe.
- Confirmed discovery defect: Linux v0.8.21/v0.8.22 selected the highest semantic Git tag before consulting GitHub Releases. Project history contains the counterexample v0.8.20: a tag existed while no GitHub Release existed. A future tagged-but-unpublished candidate could therefore be misclassified as stable.
- Method evidence: GitHub distinguishes releases from tags and documents `/releases/latest` / Releases REST as published-release authority. The latest-release REST endpoint returns the latest published full release; ordinary tags without an associated release are not release-list entries.
- Minimum sufficient prevention: on Linux and Windows, resolve the ordinary GitHub `/releases/latest` redirect first and accept only `vMAJOR.MINOR.PATCH`; use Releases REST only as fallback. If neither published-release source succeeds, fail closed. Raw tag enumeration is not a stable-channel fallback.
- Live method probes PASS before implementation: Linux web redirect and REST independently resolved immutable v0.8.22; Windows PowerShell followed the redirect and parsed v0.8.22.
- Preserved controls: v0.8.22 unresolved-previous route barrier; v0.8.21 Linux GUI/zero-interference; v0.8.20 persistent-terminal admission/drain guards; v0.8.19 cleanup-only/no-recycle.
- Exact next action: run focused discovery/updater regressions and complete v0.8.23 source gates, then exact clean-commit validation, remote-CAS publication and target rollout without terminating live scientific terminals.

## HISTORY — R18 delta

- 2026-09-22: Converted the tagged-but-unpublished stable-channel ambiguity into published-Release authority on both platforms, with web-latest primary, REST fallback and fail-closed semantics.


### v0.8.23 source validation delta

- Full staged source validation PASS on Linux after replacing raw-tag discovery: `git diff --cached --check`, focused updater/router 13/13, `npm run check`, `npm test`, `npm run audit`, Linux GUI contract, Windows runtime contract and source-integrity all returned zero.
- Core suite: 111 total / 110 PASS / 1 Windows-only parser skip. GUI suite: 75/75 PASS. Security audit: PASS.
- Exact candidate `auto-update-windows.ps1` was transferred byte-for-byte to Windows and parsed by the native PowerShell parser with zero errors; published-release redirect + REST fallback markers were present.
- Current gate: exact commit/clean-checkout validation and remote-CAS publication remain OPEN; do not tag/publish before those pass.
