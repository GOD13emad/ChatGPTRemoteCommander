# ChatGPT Remote Commander — Project Brain

Brain revision: R7
Status: CURRENT / v0.8.11 HOTFIX RELEASE CANDIDATE
As of: 2026-09-21
Project root: %USERPROFILE%\source\repos\ChatGPTRemoteCommander
Public repository: GOD13emad/ChatGPTRemoteCommander

## Final objective and Definition of Done

Deliver a stable Remote Commander release that can run in explicit Full Power on trusted machines, preserves all known capabilities unless a capability is explicitly opted out, supports native Windows GUI control, durable workflows and Project Brain integration, and updates itself candidate-first with local validation, zero-downtime routing, rollback boundaries and no blind mutation replay.

DoD for the current release requires: an immutable stable release tag and assets; clean-checkout check/test/security gates; scope-appropriate GUI evidence (fresh interactive native E2E when native input behavior changes, otherwise byte-identical prior native baseline + current no-input/native/controller regression); candidate validation on the target machine; promotion of every live profile; canonical-route doctor checks; durable-workflow integrity after schema finalization; tunnel profiles targeting canonical routers; autostart/supervisor continuity; removal of superseded release directories; and a post-promotion updater no-op returning CURRENT.

## Authoritative current change set — v0.8.11 hotfix candidate

- Public GitHub `main` was advanced to v0.8.10 commit `076e22c32c589a4ddfb04651e2ae774a2dba8c0a` after all tracked source gates passed.
- v0.8.10 candidate-first `-NoPromote` validation PASSed on both `default` and `saeed-emad`: 54 tools / 15 GUI tools, FULL_POWER authority preserved, doctor PASS, hardware PASS, workflow shadow/live-store integrity PASS, native no-input self-test PASS.
- Blue/green v0.8.10 cutover committed both canonical routes to generation 7 and active v0.8.10. The control checkout was promoted to the same exact commit.
- During default-profile old-backend drain, router inflight accounting retained one completed `run_shell` request after its downstream MCP client disconnected. Old-backend audit independently recorded that action `ok=true` at 2026-09-21T03:37:06Z; no non-console child workload remained; route previous commit/port and runtime marker/PID/profile matched exactly.
- Recovery was ownership-proven and narrow: only the superseded v0.8.9 default backend PID 25928 was stopped after the completed-operation evidence above. Router old-backend inflight immediately cleared. Official updater maintenance then finalized both workflow stores at schema 2, recycled the supervisor ownership-safely and reported `AUTO_UPDATE_MAINTENANCE_PASS version=0.8.10`.
- Root cause is reproducible in the stable router: when the downstream response closes, Node stream piping can leave the upstream response paused; because inflight retirement intentionally waits for upstream end/close/error, a completed backend operation can remain permanently counted even though it must not be cancelled or replayed.
- v0.8.11 fix: on downstream close, the router unpipes the dead downstream destination and resumes consuming the upstream backend response to its real completion. It does not cancel, duplicate or blind-retry the upstream request.
- Regression evidence: the new production-shaped downstream-disconnect test failed before the fix with `1 !== 0` after ~3.2 s and passes after the fix; full stable-router focused suite is 6/6 PASS.
- v0.8.10 zero-interference desktop authority remains unchanged in v0.8.11: GUI observe-only default, explicit-current-request takeover, direct-session-only desktop mutation, and no durable-workflow GUI takeover.
- Native GUI helper files remain unchanged from the accepted baseline, so no foreground/mouse/focus test is introduced by this router-only hotfix.
- Headless Stockfish and competitive-audit evidence remain in `docs/CHESS_STRESS_BENCHMARK_20260921.md` and `docs/COMPETITIVE_AUDIT_20260921.md`.
- External GitHub-hosted Actions account/runner availability remains a separate external gate; it is not evidence against the locally reproduced Windows gates.
- Exact next action: run full v0.8.11 check/test/audit + native no-input gate, commit/push only the hotfix set, candidate-only validate exact commit, promote both profiles, require router source-hash recycle to the new fixed router, verify doctors/tunnels/workflows and CURRENT no-op, then package/hash/publish immutable v0.8.11 and close Brain R7.

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
