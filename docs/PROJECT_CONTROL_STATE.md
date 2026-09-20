# ChatGPT Remote Commander — Project Brain

Brain revision: R1
Status: CURRENT
As of: 2026-09-20
Project root: %USERPROFILE%\source\repos\ChatGPTRemoteCommander
Public repository: GOD13emad/ChatGPTRemoteCommander

## Final objective and Definition of Done

Deliver a stable Remote Commander release that can run in explicit Full Power on trusted machines, preserves all known capabilities unless a capability is explicitly opted out, supports native Windows GUI control, durable workflows and Project Brain integration, and updates itself candidate-first with local validation, zero-downtime routing, rollback boundaries and no blind mutation replay.

DoD for the current release requires: an immutable stable release tag and assets; clean-checkout check/test/security/native-GUI gates; candidate validation on the target machine; promotion of every live profile; canonical-route doctor checks; durable-workflow integrity after schema finalization; tunnel profiles targeting canonical routers; autostart/supervisor continuity; removal of superseded release directories; and a post-promotion updater no-op returning CURRENT.

## Authoritative current state

- Stable release: v0.8.4
- Release commit: 4fdfd76143fb3a3ac4d54709223599a613cc3c06
- Release URL: https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/tag/v0.8.4
- Installed control checkout: %LOCALAPPDATA%\ChatGPTRemoteCommander\app, detached at the release commit.
- Active release directory: %LOCALAPPDATA%\ChatGPTRemoteCommander\releases\v0.8.4-4fdfd76143fb
- Only active release directory after cleanup: v0.8.4-4fdfd76143fb.
- Default canonical router: 127.0.0.1:47831 -> backend 48831.
- saeed-emad canonical router: 127.0.0.1:47834 -> backend 48832.
- Tunnel profile chatgpt-remote-commander targets http://127.0.0.1:47831/mcp.
- Tunnel profile saeed-emad targets http://127.0.0.1:47834/mcp.
- Both profiles: FULL_POWER, explicitly authorized, persistAcrossUpdates=true, autoEnableNewCapabilities=true, disabledCapabilities=[].
- Both profiles grant all 22 capabilities present in Capability Profile v2, including full filesystem, unrestricted shell, process control/terminate, permanent delete, persistent terminals, all four GUI capabilities, durable/autonomous workflow capabilities, auto-update and zero-downtime update.
- Automatic update channel: stable; enabled; zero-downtime enabled; interval 15 minutes.
- Durable Workflows: R2, schema/database version 2, database integrity ok, scheduler enabled, autonomous continuation enabled, one-writer-per-root enabled.
- Windows autostart is registered and a single current supervisor is running from the installed app.
- Final updater self-check after promotion: AUTO_UPDATE_CURRENT version=0.8.4.

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

No release blocker remains for v0.8.4.

## Closed failure chain

- Windows updater gate helper used a PowerShell automatic-variable name and launched npm without intended arguments. Prevention: dedicated command-argument parameter plus missing-argument guard.
- Clean staged update depended on an untracked helper. Prevention: source-integrity checks now require lifecycle/updater dependencies to be Git-tracked.
- Native GUI clean checkout assumed an ignored runtime directory existed. Prevention: E2E creates its own runtime directory.
- Security history scan treated an uppercase status symbol as a tunnel identifier. Prevention: canonical lowercase tunnel_ detector plus regression.
- v0.8.3 candidate cleanup failed with repeated saeed-emad candidates. Root cause: recursive discovery included historical instance.json files inside backup trees. Prevention in v0.8.4: enumerate only immediate profile directories, bind exactly one instance.json per profile directory, and fail closed on directory/profile identity mismatch.
- A later GUI gate observed GUI_NATIVE_BUSY. Evidence showed the global GUI helper mutex was contended; a controlled run with no competing GUI helper passed full capture/focus/click/Unicode typing/screenshot verification. Existing behavior remains fail-closed; no mutation retry was added to mask uncertain GUI outcomes.

## Verification versus validation

Verification evidence includes clean repository gates, contract tests, security audit, source integrity, native GUI E2E, doctor checks and workflow database integrity. Validation on the target machine includes the candidate-only updater run, exact two-profile discovery, blue/green cutover, canonical router checks, tunnel target checks, autostart continuity and CURRENT no-op behavior.

## Deferred / non-blocking observations

- The source working directory contains many unrelated untracked GCAD/engineering files. They were not modified or included in the release; all release gates were run from a separate clean detached worktree. Cleanup requires separate ownership/authority and is intentionally deferred.
- Legacy profile baseline files under instances are not the active routed runtime authority after promotion. The durable route files are authoritative and the supervisor starts routed backends from their active.configPath. Do not delete legacy baselines without a separate rollback-policy change.
- Workflow health reports runnerConfigured=false; scheduler/continuation state is healthy and this is not a capability-profile regression. Any external host-runner integration is a separate future scope.

## Authoritative evidence locations

- %LOCALAPPDATA%\ChatGPTRemoteCommander\last-update.json
- %LOCALAPPDATA%\ChatGPTRemoteCommander\update-logs\auto-update.log
- %LOCALAPPDATA%\ChatGPTRemoteCommander\routing\default.json
- %LOCALAPPDATA%\ChatGPTRemoteCommander\routing\saeed-emad.json
- %LOCALAPPDATA%\ChatGPTRemoteCommander\runtimes\4fdfd76143fb3a3ac4d54709223599a613cc3c06\...
- %LOCALAPPDATA%\ChatGPTRemoteCommander\update-backups\4fdfd76143fb3a3ac4d54709223599a613cc3c06\...
- Clean validation logs listed in PROJECT_KNOWLEDGE_EVIDENCE.md.
- Git tag v0.8.4 and GitHub Release v0.8.4.

## Exact next action

No action is required for the current release. For a future product change, start from this Brain and the exact release commit/tag, create one new change objective, validate in a clean worktree, run candidate-only validation, then promote only after all gates pass. If the updater reports CURRENT, do not force a rerun without a new release or a diagnosed fault.

## HISTORY — append only

- 2026-09-20 / R1: Established v0.8.4 as the promoted stable baseline on the validated Windows target; both profiles Full Power; zero-downtime routes, durable workflows, tunnels, autostart and auto-update post-check verified. v0.8.3 is superseded.
