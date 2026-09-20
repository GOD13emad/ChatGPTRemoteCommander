# ChatGPT Remote Commander — Project Brain

Brain revision: R3
Status: CURRENT
As of: 2026-09-20
Project root: %USERPROFILE%\source\repos\ChatGPTRemoteCommander
Public repository: GOD13emad/ChatGPTRemoteCommander

## Final objective and Definition of Done

Deliver a stable Remote Commander release that can run in explicit Full Power on trusted machines, preserves all known capabilities unless a capability is explicitly opted out, supports native Windows GUI control, durable workflows and Project Brain integration, and updates itself candidate-first with local validation, zero-downtime routing, rollback boundaries and no blind mutation replay.

DoD for the current release requires: an immutable stable release tag and assets; clean-checkout check/test/security/native-GUI gates; candidate validation on the target machine; promotion of every live profile; canonical-route doctor checks; durable-workflow integrity after schema finalization; tunnel profiles targeting canonical routers; autostart/supervisor continuity; removal of superseded release directories; and a post-promotion updater no-op returning CURRENT.

## Authoritative current state

- Stable release: v0.8.5
- Release commit: 540d7e596686406e102e4a835c9ad4d7745cef5c
- Release URL: https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/tag/v0.8.5
- Installed control checkout: %LOCALAPPDATA%\ChatGPTRemoteCommander\app, detached at the release commit.
- Active release directory: %LOCALAPPDATA%\ChatGPTRemoteCommander\releases\v0.8.5-540d7e596686
- Only active release directory after cleanup: v0.8.5-540d7e596686.
- Default canonical router: 127.0.0.1:47831 -> backend 48833.
- saeed-emad canonical router: 127.0.0.1:47834 -> backend 48834.
- Tunnel profile chatgpt-remote-commander targets http://127.0.0.1:47831/mcp.
- Tunnel profile saeed-emad targets http://127.0.0.1:47834/mcp.
- Both profiles: FULL_POWER, explicitly authorized, persistAcrossUpdates=true, autoEnableNewCapabilities=true, disabledCapabilities=[].
- Both profiles grant all 22 capabilities present in Capability Profile v2, including full filesystem, unrestricted shell, process control/terminate, permanent delete, persistent terminals, all four GUI capabilities, durable/autonomous workflow capabilities, auto-update and zero-downtime update.
- Automatic update channel: stable; enabled; zero-downtime enabled; interval 15 minutes.
- Durable Workflows: R2, schema/database version 2, database integrity ok, scheduler enabled, autonomous continuation enabled, one-writer-per-root enabled.
- Windows autostart is registered and a single current supervisor is running from the installed app.
- Final updater self-check after promotion: AUTO_UPDATE_CURRENT version=0.8.5.

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
16. GitHub-hosted CI — OPEN EXTERNAL GATE: the account is already GitHub Free and Copilot Free with zero observed usage/payments, but a stale failed payment-authorization hold keeps the account billing-locked. An official GitHub Support ticket is open for server-side lock removal; no runner is assigned until GitHub clears it.

No product/runtime blocker remains for v0.8.5. GitHub-hosted Actions is externally blocked by a stale account-level billing lock. Billing UI evidence confirms GitHub Free, Copilot Free, zero observed usage, no payment history, no saved payment method control, and an Invalid payment method - authorization hold failed state. GitHub Support accepted an open billing ticket to clear this server-side lock without activating a paid plan.

## Closed failure chain

- Windows updater gate helper used a PowerShell automatic-variable name and launched npm without intended arguments. Prevention: dedicated command-argument parameter plus missing-argument guard.
- Clean staged update depended on an untracked helper. Prevention: source-integrity checks now require lifecycle/updater dependencies to be Git-tracked.
- Native GUI clean checkout assumed an ignored runtime directory existed. Prevention: E2E creates its own runtime directory.
- Security history scan treated an uppercase status symbol as a tunnel identifier. Prevention: canonical lowercase tunnel_ detector plus regression.
- v0.8.3 candidate cleanup failed with repeated saeed-emad candidates. Root cause: recursive discovery included historical instance.json files inside backup trees. Prevention in v0.8.4: enumerate only immediate profile directories, bind exactly one instance.json per profile directory, and fail closed on directory/profile identity mismatch.
- A later GUI gate observed GUI_NATIVE_BUSY. Evidence showed the global GUI helper mutex was contended; a controlled run with no competing GUI helper passed full capture/focus/click/Unicode typing/screenshot verification. Existing behavior remains fail-closed; no mutation retry was added to mask uncertain GUI outcomes.

## Open external blocker — GitHub billing state

- Confirmed account plan: GitHub Free, USD 0/month.
- Confirmed Copilot plan: Copilot Free, USD 0/month.
- Billing Overview showed zero observed usage; Payment History showed no payments.
- Payment Information reported Invalid payment method - authorization hold failed; no saved payment method with an Edit/Remove control was observed.
- GitHub Support's own guided solution identified the condition as a billing lock on a free account tied to a failed payment authorization.
- Hosted CI run attempt 3 was repeated after dismissing the alert; Windows and Ubuntu again executed zero steps and returned the same account-lock annotation.
- An official GitHub Support ticket was successfully submitted and is open. Its private identifier/URL is retained only in local private evidence, not this public repository.
- Status: external / server-side / awaiting GitHub Support. Product code and runtime remain PASS.
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
- %LOCALAPPDATA%\ChatGPTRemoteCommander\runtimes\540d7e596686406e102e4a835c9ad4d7745cef5c\...
- %LOCALAPPDATA%\ChatGPTRemoteCommander\update-backups\540d7e596686406e102e4a835c9ad4d7745cef5c\...
- Clean validation logs listed in PROJECT_KNOWLEDGE_EVIDENCE.md.
- Git tag v0.8.5 and GitHub Release v0.8.5.
- Private external support evidence: %LOCALAPPDATA%\ChatGPTRemoteCommander\private-evidence\github-billing-support-ticket.json, SHA-256 6b21efb925486ce78f5c419496609b8c9634c65d264c9c0be9cdbb92d30c848e. The public repository intentionally does not expose the private support ticket identifier/URL.

## Exact next action

No product or billing-plan action is required for the current release: the account is already on GitHub Free. Await GitHub Support clearing the stale server-side billing lock; do not add a payment method or activate a paid plan for this purpose. After Support clears the lock, rerun the existing hosted CI once without product-code changes; only investigate code if a runner then executes steps and reveals a real failure. For a future product change, start from this Brain and the exact release commit/tag, create one new change objective, validate in a clean worktree, run candidate-only validation, then promote only after all gates pass. If the updater reports CURRENT, do not force a rerun without a new release or a diagnosed fault.

## HISTORY — append only

- 2026-09-20 / R1: Established v0.8.4 as the promoted stable baseline on the validated Windows target; both profiles Full Power; zero-downtime routes, durable workflows, tunnels, autostart and auto-update post-check verified. v0.8.3 is superseded.
- 2026-09-20 / R2: Reproduced the otherwise-hidden Linux CI fixture defect under Ubuntu 24.04 / Node 22, fixed it without relaxing production guards, released and automatically promoted v0.8.5, and recorded GitHub hosted CI as an external billing-blocked gate rather than a product failure.
- 2026-09-20 / R3: Proved the GitHub account is already Free with no payment history or paid subscription, isolated the blocker to a stale failed payment-authorization hold, confirmed the lock persists server-side after another zero-step CI rerun, and submitted a private GitHub Support ticket for lock removal without adding a payment method.
