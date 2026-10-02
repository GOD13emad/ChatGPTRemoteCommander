# Project Brain — ChatGPT Remote Commander

Status: CURRENT — SCOPED FINAL / ACCEPTED
Updated: 2026-09-28
Authority: immutable release/tag -> exact live route records -> exact-SHA CI/canary evidence -> project control/evidence records.

## Final objective

Maintain a cross-platform Remote Commander that safely executes substantial work in the background, survives interruption/update, preserves one-writer/evidence semantics, supports explicit owner-authorized GUI/Codex paths without hidden delegation, and routes relevant separately installed domain Skills without bundling them into Commander Core.

## Accepted current baseline

**v0.9.20 — SCOPED FINAL / ACCEPTED**

Release/tag commit: `cbbc6dc19f63a87e651a8f1af9f429aa7b6a5063`.
Qualified candidate tree: `674990c743fc996d84d0b0c4e008f0255078e44c` with no file diff against the merge commit.

Accepted evidence:
- local Windows exact-SHA full gate PASS;
- local Linux exact-SHA full gate PASS;
- hosted Windows/Ubuntu CI PASS on run `36445899951`;
- disposable Windows Server + clean Ubuntu Server canary PASS on run `36445899940`;
- immutable release verification PASS with 15 assets and 14 verified payload checksums;
- candidate-first live rollout complete on primary Windows, Windows `saeed-emad`, Linux, and HPC Windows;
- all accepted route records point to exact v0.9.20 commit with `previous=null`;
- live Skill routing canaries PASS on Windows/Linux/HPC.

Official separately installed Agent Extensions:
- ansys-modeling v1.1.1
- comsol-modeling v1.1.1
- project-execution-brain v1.0.0
- final-thesis-report v1.0.0

The owner-private video-trend extension remains intentionally outside the official catalog. Domain extensions remain lifecycle-independent from Commander Core and are not bundled by the Commander installer/release.

## Locked decisions

- Background/headless execution is default. Console/terminal windows are not a progress UI.
- Actual task UI or an explicit official progress UI may be foregrounded.
- Domain Agent Extensions are separately installed; Commander owns validation/routing/policy intersection only.
- Explicit trigger evidence dominates weak lexical routing; compatible project-method and domain Skills may layer.
- Hidden/background project runners remain No-Codex. Local Codex launch is only the explicitly authorized owner path defined by policy.
- Immutable releases remain enabled.
- Windows Server bootstrap remains verification/allowlist based; it does not disable Defender/EDR or create AV exclusions.
- Fresh-server qualification is a permanent release gate: Windows Server bootstrap and clean Ubuntu bootstrap.
- Do not mass-cancel durable workflows belonging to unrelated user projects merely to make release dashboards empty.
- No blind rerun after meaningful failure; repeated failure families require root-cause audit and prevention.

## v0.9.20 closure

Root causes closed:
1. fresh Linux bootstrap omitted Python 3 although qualification requires it;
2. headless Linux server qualification incorrectly required native GNOME/PyGObject integration;
3. inherited-stdio async regression mixed hosted scheduling latency with the intended post-ready drain invariant.

Prevention now retained in code/tests:
- Python 3 is installed/required by supported Linux fresh-server paths;
- headless server validation keeps static GUI checks but skips only the native GNOME probe;
- normal Linux GUI qualification still exercises native GNOME integration;
- permanent disposable Windows/Linux server canary;
- async fixture ready-handshake and bounded post-ready assertion window.

A single local Windows full-gate attempt on the final candidate observed one clean fixture-server exit in the HTTP conversation test while several qualification workloads were concurrent. The same exact test then passed 10/10 in isolation, hosted Windows passed, and a clean full Windows exact-SHA rerun passed. Root cause of that one local occurrence is therefore UNVERIFIED; no product patch was made from it.

## Deferred / external — not v0.9.20 blockers

- ChatGPT host/UI stream errors such as Resume stream unavailable are outside Commander transport authority; Commander reduces exposure through durable/background execution but cannot guarantee the host UI stream.
- Historical/other-project durable workflow records are retained when they belong to unrelated projects. Integrity is checked; they are not mass-cancelled for cosmetic cleanup.
- Broader provider expansion, monetary accounting, additional integrations, and equal-model/equal-budget competitive benchmarks are future roadmap items.
- Claims that Commander is universally superior to every external agent/work product remain UNPROVEN without comparable benchmark evidence.
- Dependency-update PRs and legacy historical branches are maintenance/history, not release acceptance evidence.

## Post-release repository closure

Main closure commit: `f0157ccff98da9e42c25e5ea0bd55bc9ee7de0ab`.

Exact closure-head evidence:
- focused Windows fixture-startup stress: 36/36 PASS;
- hosted CI run `36451298406`: Windows PASS, Ubuntu PASS;
- Server Install Canary run `36451298534`: Windows Server PASS, clean Ubuntu PASS;
- Actions pins refreshed to checkout v7.0.1 / setup-node v7.0.0;
- stale/superseded PRs #43, #3, #4 and legacy draft #30 closed without deleting Git history.

No runtime/release bytes changed after immutable v0.9.20 publication.

## Exact next action

No action is required for the accepted v0.9.20 scope. For new work, start from v0.9.20 as the production baseline and open one bounded change set only when a new requirement, reproducible defect, security issue, or evidence-backed improvement is identified.

## History pointers

Detailed append-only evidence: `docs/PROJECT_KNOWLEDGE_EVIDENCE.md`.
Current/release roadmap: `docs/PROJECT_CONTROL_STATE.md`.
Historical snapshots: `docs/history/`.


## Milestone — 2026-09-28 — v0.9.21 owner-authorized runner closure

**Previous accepted state:** GitHub main at 4a93d5475447f751e81ceaa87495b8c684fd1e87, release 0.9.20. Live FULL_POWER Windows configuration explicitly requested a local Codex Project Engine runner, but runtime reported runnerConfigured=false / automaticExecution=false.

**Current delta:** repaired the policy/configuration mismatch so an explicitly configured local Codex runner is preserved only when FULL_POWER, explicit owner authorization, powerMode.codexControl.allowLaunch=true, exact provider kind=codex, and a real Codex executable are all present. All other Codex paths remain default-deny. Planner remains proposal-only under the existing restricted launch contract. Release/version/install/plugin metadata are aligned to 0.9.21.

**Evidence / V&V:** local final gate PASS at 2026-09-28T21:50:18.6502700+03:30. Project Engine 222 pass / 0 fail / 1 environment skip; comprehensive check and test suites completed with zero failures; SECURITY_AUDIT_PASS; source-integrity/runtime/installer/plugin/release-asset gates passed; git diff --check passed. Gate log SHA-256: 406a95addaff1ccc343969c2d4097bf401eac2145b36e5ad18431429108bb569.

**Authority:** the single writer is the clean canonical writer clone on the primary Windows host, on branch finalize/v0.9.21. The legacy dirty checkout remains non-authoritative and untouched.

**Open gates / critical path:** GitHub promotion/CI and live runtime deployment/readback. Native ChatGPT host wake/push remains external. Long-soak qualification is UNPROVEN until elapsed evidence exists.

**Exact next action:** commit and push the clean branch, open/validate GitHub PR, merge only after available CI/status gates, then deploy the immutable promoted revision and verify live Windows/Linux status.


## Milestone delta — 2026-09-28 — Windows hosted qualification correction

Hosted Linux gates on the amended v0.9.21 candidate passed. Two Windows-only qualification failures were isolated to browser lifecycle tests: an 80 ms setup-sensitive timeout and a raw-PID liveness predicate for a profile-owned process. Production browser cleanup remains unchanged. The candidate now uses the fixture-default 1000 ms timeout for the intended timeout-cleanup test and verifies profile-owned descendants by exact browser profile identity rather than numeric PID existence. Promotion remains open pending targeted stress, full local gate, and fresh hosted Windows gates.


## Milestone delta — 2026-09-28 — Local requalification complete

The Windows qualification correction is locally requalified. Browser-process tests are 7/7 PASS and the two previously failing hosted-Windows scenarios passed 20/20 repeated targeted runs. The complete release gate then passed: Project Engine 222 pass / 0 fail / 1 environment skip, full suite 481 pass / 0 fail / 6 environment skips, security audit PASS, and diff-check PASS. Gate-log SHA-256 is 107D33026CD9294B07ED8B7AAB79B0A6B63B5EE325E634A663E184C505FD80DB. Promotion remains open until fresh hosted CI and both server canaries pass on the amended commit.


## Milestone delta — 2026-09-28 — Hosted Windows spawn/PID fixture race

A third meaningful hosted-Windows browser qualification occurrence triggered stop-patching review. The new failure was not cleanup: the fixture marker contained an invalid PID because it serialized child.pid immediately after asynchronous spawn. Primary Node documentation confirms the spawn event as the successful-creation boundary and that pid can be undefined. The fixture now awaits spawn before recording PID on both child-process paths. Production browser lifecycle code is unchanged. Promotion remains blocked pending targeted regression, one final local gate, and fresh hosted gates.


## Milestone delta — 2026-09-28 — Final local candidate requalified

The spawn/PID fixture guard passed targeted validation (browser-process 7/7; affected child-spawn stress 10/10) and the complete release gate then passed. Project Engine: 222 pass / 0 fail / 1 environment skip. Full suite: 481 pass / 0 fail / 6 environment skips. GUI contract: 77/77. Security audit and diff check passed. Final gate marker: 2026-09-28T23:06:39.5908545+03:30; gate-log SHA-256: 0DC03CE86CF73A2847B68ECC566D7CDF916F91F7B3E0D69DB33A51DF8DA5F817. The source candidate is locally accepted but not yet promoted; fresh hosted CI and server canaries remain mandatory.


## Milestone delta — 2026-09-28 — v0.9.21 post-qualification local gate PASS

The Windows qualification blockers were isolated to test predicates/teardown rather than production behavior: browser profile-owned cleanup now verifies exact profile ownership instead of raw PID existence, the timeout-cleanup fixture no longer imposes an unrelated 80 ms setup requirement, and async-continuation teardown uses the repository's established Windows retry policy. Production browser and continuation runtime code remain unchanged by these qualification corrections. Targeted browser qualification stress passed 20/20; targeted async-continuation cleanup stress passed 20/20. The complete local promotion gate then passed at 2026-09-28T23:37:31.6925697+03:30 with zero failures, including security audit and diff check. GitHub hosted CI/canary, merge, immutable deployment, and live runtime readback remain open; native host wake/push and elapsed soak remain external/unproven.


## Milestone delta — 2026-09-28 — v0.9.22 runner-policy rollout repair

v0.9.21 source/hosted gates passed, but live validation exposed a rollout-precedence defect: canonical owner policy had the enabled Codex Project Engine runner while the routed runtime retained the historical `NO_CODEX_VIA_COMMANDER` disabled runner. The v0.9.22 hotfix keeps routed runtime config as the baseline and permits only a narrowly validated runner-policy overlay from canonical local configuration. No unrelated canonical settings are copied. FINAL remains UNPROVEN pending full gates, hosted CI, candidate-first rollout, and live `runnerConfigured=true / automaticExecution=true` readback.


## Milestone delta — 2026-09-29 — v0.9.22 local gate accepted

The narrow Windows runner-policy overlay hotfix passed the complete local promotion gate. The exact gate artifact is `var/final-gate-v0.9.22.log` with SHA-256 `a06b87e9a80be2bd0853207f3a9f33e191d27b12199af16e7cd0de79fe066b7f`. The next authority gates are hosted CI, merge, release publication and live candidate-first rollout. FINAL is still UNPROVEN until the routed runtime reports both runner configuration and automatic execution enabled.


## Milestone delta — 2026-09-29 — Windows hosted starvation control qualified

A Windows-hosted-only test-file concurrency bound of 2 was selected instead of increasing functional timeouts. The exact bounded path, complete CHECK, and full local v0.9.22 promotion gate all passed. Evidence log SHA-256 is `5f2bb611d2e43e921f57695119f1f3692313b4eb5ca6df1a7d71c631c157e87c`. Production runtime semantics are unchanged by this CI control. FINAL remains UNPROVEN pending fresh hosted gates, merge, release, live rollout, and live `runnerConfigured=true / automaticExecution=true` readback.


## Milestone delta — 2026-09-29 — qualification harness stabilized

PR #50's release candidate now uses one generic bounded qualification path (`test:qualification`, concurrency 2) for hosted/install/update qualification while retaining ordinary unbounded `npm test` for development/final-gate detection. Local targeted contracts, the exact qualification path, and the complete unbounded v0.9.22 final gate all pass. The latest final-gate artifact is `var/final-gate-v0.9.22.log`, SHA-256 `1338cc7cd5e3d5b65739342fe4e3b8b0fdeffbd0501fe0d9f514d04196af751c`. Hosted CI and both install canaries on the new commit remain the next authority gates; FINAL remains UNPROVEN until release rollout and live runner readback succeed.


## Milestone delta — 2026-09-29 — v0.9.23 closes the remaining Windows updater qualification gap

v0.9.22 was published successfully, its candidate-only live qualification passed, and its runner-policy repair was confirmed in the candidate. The first promotion safely deferred default while an older route drained and promoted the independent `saeed-emad` profile. After the old default previous backend disappeared, an evidence-backed updater resume exposed the last unbounded qualification path: Windows auto-update still ran raw `npm test` and one isolated workflow HTTP health test starved for ~30 seconds while 482 tests passed. The exact failing file then passed 3/3 in ~2.5 seconds. Official Node documentation confirms CLI test-file concurrency defaults to available parallelism minus one under process isolation. Because this is the third occurrence in the same qualification-starvation family, v0.9.22 remains immutable and v0.9.23 applies the minimum control: Windows auto-update reuses `test:qualification` concurrency=2 and the regression contract now covers that path. FINAL remains UNPROVEN pending v0.9.23 gates, release, and live default runner readback.


## Milestone delta — 2026-09-29 — v0.9.23 local qualification complete

The Windows auto-update qualification hotfix is locally accepted. Focused Project Engine passed 222/0/1 skip; the exact bounded qualification path passed 483/0/6 skips with concurrency=2; and the complete unbounded final gate passed at 2026-09-29T08:44:21.1074309+03:30. Security audit, source integrity, GUI contracts, schema continuity and diff check all passed. Evidence artifact `var/final-gate-v0.9.23.log` has SHA-256 `caf3697d100ab9d6ccdcac913178a2bb424938b5e8cf6dd40dbf684a851b53d5`. The next authority gates are fresh hosted CI and both server-install canaries on the committed hotfix SHA; FINAL remains UNPROVEN pending immutable release and live default runner readback.


## Milestone delta — 2026-09-29 — qualification CHECK starvation gap

PR #51's first head passed Ubuntu CI and both server-install canaries, but Windows hosted CHECK exposed the remaining half of the same qualification-starvation problem: the CHECK script contains its own large unbounded Node test batch, and an isolated MCP conformance server missed the existing 10-second health window under hosted Windows load. The failure carried no runtime error beyond the SQLite experimental warning. The minimum control is to reuse the existing concurrency-2 wrapper as `check:qualification` in hosted/install/update qualification paths while keeping ordinary CHECK unbounded in the local final gate. Merge remains blocked pending a fresh head and fresh hosted evidence.


## Milestone delta — 2026-09-29 — CHECK qualification control locally accepted

The remaining hosted-Windows starvation gap is now locally closed with the minimum control: `check:qualification` reuses the existing bounded Node test wrapper at concurrency 2 only in CI/install/update qualification paths, while ordinary `npm run check` remains unbounded in the complete local final gate. Focused contracts passed; bounded CHECK and TEST qualification passed; and the unbounded final gate passed at 2026-09-29T09:19:39.7374006+03:30. Evidence log `var/final-gate-v0.9.23.log` has SHA-256 `b9e5945c7155a95212d5c2864fadca2acc15680e8e00c896980b62d14486a156`. The next authority gates are fresh hosted CI and both server-install canaries on the new commit SHA.


## Milestone delta — 2026-09-29 — v0.9.23 live FINAL

v0.9.23 is published and live on the Windows default route at merge commit `a1b5368edf33d629111407aecd7f4c6a136a6122`. Candidate-first qualification passed, the live cutover succeeded, and final readback shows Full Power preserved with `runnerConfigured=true` and `automaticExecution=true`. Default route generation 116 has no previous backend. The independent `saeed-emad` profile is also on v0.9.23 while correctly preserving its explicit runner-disabled policy. The old v0.9.21 backend was not killed because it owns a persistent terminal; it was moved to the retained-backend registry and removed from routing authority, so active work is preserved without leaving a drain blocker. `last-update.status=CURRENT`. The v0.9.23 release/rollout objective is FINAL PASS; retained historical backends remain lifecycle-managed preservation state until their terminal descendants exit.


## Milestone delta — 2026-09-29 — live deployment audit and Windows persistence repair

A fresh post-release audit reconfirmed the Windows executable authority as v0.9.23 at `a1b5368edf33d629111407aecd7f4c6a136a6122`; the later repository head was docs-only. Both routed profiles remain healthy on v0.9.23, the installed stable app executable files match the immutable v0.9.23 release bytes for the router/supervisor/updater/server paths audited, and both v0.0.15 tunnel profiles are ready.

Six historical Remote Commander maintenance workflows that were superseded by the accepted v0.9.23 live state were retired through the official revision-guarded workflow control surface without replaying any step. Scheduler pending moved from 811 to 805 and RUNNING from 553 to 547; unrelated electromagnetic-generator and FreeNetHub workflows were explicitly excluded. Workflow SQLite integrity is `ok`, ordinary operation queue is empty, durable delivery has no dead letters or unfinished requests, and accumulated `COMPLETED_UNDELIVERED` items remain classified as durable unacknowledged result state rather than an executing-queue failure.

The Windows logon Run registration was found missing and was repaired with the authoritative `enable-autostart.ps1 -NoStart`; the existing DPAPI credential was reused, no process restart occurred, the Run command is hidden PowerShell 7, and both tunnel readiness endpoints remained healthy. The exact historical cause of the missing registration is unverified; source audit shows only the explicit disable-autostart path removes the value, so no updater defect is asserted without evidence.

A fresh regression against the exact installed release passed: focused lifecycle/delivery/router tests 42/0, `npm run check` exit 0, `npm test` 483 pass / 0 fail / 6 skip, security audit PASS, and doctor PASS with live/expected version 0.9.23. Release/runtime status remains **FINAL PASS**.

One machine-level deployment gate remains separate from the release: the SYSTEM `ChatGPTRemoteCommander-BootRecovery` and `ChatGPTRemoteCommander-UserSessionHandoff` tasks are absent. Two LocalMachine credential artifacts already exist, but the current execution token is not elevated. No UAC bypass was attempted. A bounded local admin runner was prepared to call only the authoritative `enable-boot-recovery.ps1 -NoStart`, verify both tasks/autostart/tunnel readiness, emit `RETURN.json`, and perform no reboot. Therefore boot-before-logon power-loss recovery remains an owner/admin gate, not a v0.9.23 release blocker.


## Milestone delta — 2026-09-29 — v0.10.0 product-finalization candidate locally accepted

The post-v0.9.23 product gap was narrowed to installation/distribution usability rather than a core execution defect. Current OpenAI primary documentation was rechecked before design: Secure MCP Tunnel remains private connectivity; app-backed Plugins reference an already-registered app through .app.json; native compatibility points .codex-plugin/plugin.json apps to ./.app.json; eligible workspace owners/admins may upload Plugin ZIPs through ChatGPT when that option is available. Tunnel credentials do not create the registered ChatGPT app.

The minimum sufficient product change is therefore a thin Setup layer around the already-qualified installers, not an Electron/Tauri/MSI/deb runtime rewrite. v0.10.0 adds stable and versioned Windows/Linux Setup ZIP release assets, interactive Standard/Full/Full+GUI selection, persistent tunnel onboarding, truthful WAITING_APP_ID continuation, and a dependency-free device Plugin packager. The packager derives a stable per-machine/per-profile fingerprint, creates distinct Plugin names/display names/brand colors/icons/logos for multi-computer accounts, binds the exact App ID in both portable and native manifests, and rejects secret-shaped tunnel/runtime credential material.

Fresh Windows candidate evidence: focused setup/plugin tests 7/7 PASS; a real build-device-plugin.ps1 smoke generated a valid device ZIP with normalized App ID and no secrets; Git Bash syntax checks for all new/changed shell paths PASS; setup-wizard.ps1 machine-path smoke PASS against the live v0.9.23 service. The complete local final gate PASSed with full test 490 pass / 0 fail / 6 skip, security audit PASS and diff check PASS. Exact final-gate log SHA-256: 8ede55b433ed03a64f4d6dc536f5daf49fcc053aad4db4613e544e1fe134045a.

Linux live hygiene audit proved the untracked nested app/ checkout was an orphan old commit (981e0b2...) with no live process/systemd/route/config references; only historical audit logs mentioned its path. Before deletion the complete 64 MB tree was archived to local state backups. Archive SHA-256: b21d02f646dda980aa65e2cec1dc39898170c1d28517e12a10536b52c71a0c73; compressed bytes: 30153972. The nested tree was then removed; the outer live v0.9.23 checkout is clean, systemd service remains active and health remains OK.

The CHANGELOG projection gap for v0.9.11-v0.9.23 was repaired from authoritative per-release evidence files without changing historical release records.

Current status: v0.10.0 source candidate is LOCAL PASS. Hosted CI/server canaries, clean Linux exact-tree qualification, immutable publication and live Windows/Linux rollout remain open. Windows SYSTEM BootRecovery/UserSessionHandoff task creation remains a separate owner/admin OS privilege gate; no UAC bypass is introduced.

## Final seal — 2026-09-29 — v0.10.0 released and live

v0.10.0 is now the accepted product release for the audited Windows and Linux targets.

Authoritative release identity:
- tag: v0.10.0
- merge commit: 26b8df90838f449bc61710981fc31b7a467e021d
- qualified candidate commit: 5bb6f541380514daf8924db7cb215d232405a8be
- candidate and merge tree: ef76b567ead34d0ca26c0c8b7c42d9b28cd3eefe
- immutable GitHub Release: published, 19 assets
- downloaded release verification: 19/19 assets present and SHA256SUMS verified.

Hosted acceptance:
- GitHub CI Windows: PASS.
- GitHub CI Ubuntu: PASS.
- Server Install Canary Linux: PASS.
- Server Install Canary Windows: first attempt had one transient interactive-terminal readiness timing failure under hosted contention; no affected runtime code changed. Exact-job rerun PASS, and seven consecutive local repetitions of the exact process-tree test file PASS. No timeout/runtime weakening was introduced.

Live Windows acceptance:
- default route generation 118 -> v0.10.0, commit 26b8df90838f449bc61710981fc31b7a467e021d, previous=null.
- saeed-emad route generation 162 -> v0.10.0, same commit, previous=null.
- last-update.json status=PROMOTED; doctor/hardware/shadowStore/liveStoreCompatibility all PASS for both profiles.
- live status FULL_POWER authority preserved; activeOperations=0, queued=0, lockedKeys=0.
- tunnel chatgpt-remote-commander: ready on local health port 47832.
- tunnel saeed-emad: ready on local health port 47833.
- auto-update log ends with AUTO_UPDATE_PASS version=0.10.0 commit=26b8df90838f449bc61710981fc31b7a467e021d.

Live Linux acceptance:
- default route generation 95 -> v0.10.0, same exact commit, previous=null.
- live status FULL_POWER authority preserved; activeOperations=0, queued=0, lockedKeys=0.
- systemd user service active.
- MCP health on routed port 48832 reports v0.10.0 and matching config identity.
- tunnel chatgpt-remote-commander ready on local health port 47832.
- updater log records check PASS, test PASS, audit PASS, schema continuity PASS, CUTOVER_COMMIT v0.10.0, previous retirement, GUI backend sync, maintenance PASS and supervisor recycle request.

Product delivery:
- stable Windows Setup asset: ChatGPT-Remote-Commander-Windows-Setup.zip.
- stable Linux Setup asset: ChatGPT-Remote-Commander-Linux-Setup.zip.
- complete installer asset: ChatGPT-Remote-Commander-v0.10.0-Installer.zip.
- setup wizard installs/updates Commander, enrolls the private tunnel using local-only credential prompts, verifies readiness, then waits for the registered ChatGPT App ID.
- once the App ID is available after ChatGPT Scan Tools, the local device builder creates a complete app-bound Plugin ZIP with deterministic per-device/per-profile name, icon/logo and provenance; it contains no Runtime API key, Tunnel ID or tunnel credential.
- one account may therefore connect to multiple systems through intentionally distinct Plugin identities.

Remaining external/owner gates are not product defects:
1. Per-device final Plugin ZIP is WAITING_APP_ID on a machine where the ChatGPT surface has not exposed/provided the registered App ID. No ID is fabricated from tunnel credentials.
2. Windows pre-logon BootRecovery SYSTEM/UserSessionHandoff task creation remains an explicit elevated-owner OS action if operation before interactive logon is required. The product does not bypass UAC.

Project status: PRODUCT FINAL PASS for v0.10.0 release/build/install/update/runtime/plugin-generation capability. Project Brain status CURRENT. Exact next action for a new machine: run the OS Setup bundle; after creating/scanning the custom ChatGPT app, provide its App ID to the local wizard to emit that machine's unique Plugin ZIP.


## Owner/admin gate closure — 2026-09-29 — Windows BootRecovery tasks installed

The previously open Windows owner/admin deployment gate was executed after explicit owner approval, without reboot/shutdown/logoff.

- The first elevated run of `enable-boot-recovery.ps1 -NoStart` hit `BOOT_RECOVERY_SYSTEM_PROBE_TIMEOUT`. No completion was claimed from that attempt.
- Read-only diagnosis proved SYSTEM ACL access to the app/var/profile/credential paths and proved that the Microsoft Store PowerShell 7 executable, Windows PowerShell 5.1 and cmd can all launch successfully as SYSTEM.
- One temporary diagnostic wrapper was rejected as non-authoritative after it demonstrated a local quoting defect in its own `Start-Process -ArgumentList` handling of `C:\Program Files\nodejs\node.exe`.
- An exact SYSTEM probe using the same `New-ScheduledTaskAction` argument string as the production boot setup passed in 1.303 seconds with `BootCore=true`, `CredentialScope=LocalMachine`, and both tunnel credentials `credentialReady=true`.
- The production `enable-boot-recovery.ps1 -NoStart` path was then rerun under elevation and returned `ok=true`.

Elevated post-check confirms:
- `ChatGPTRemoteCommander-BootRecovery`: Ready, SYSTEM, Highest, ServiceAccount, enabled BootTrigger, StartWhenAvailable, IgnoreNew, RestartCount 20, RestartInterval 1 minute, unlimited execution time.
- `ChatGPTRemoteCommander-UserSessionHandoff`: Ready, SYSTEM, Highest, ServiceAccount, enabled LogonTrigger for `EMAD-PC-ULTIMAT\Aa.Emad`, StartWhenAvailable, IgnoreNew, RestartCount 12, RestartInterval 1 minute, 12-minute execution limit.
- HKCU logon autostart remains present.
- No reboot was performed.

The historical Handoff `LastTaskResult=76` from 2026-09-27 was actively cleared by one controlled manual task run. Post-run: `LastTaskResult=0`, state Ready, MCP v0.10.0 ready, default tunnel ready, saeed-emad tunnel ready.

Evidence artifact:
`%LOCALAPPDATA%\ChatGPTRemoteCommander\audit\v0100-boot-recovery-20260929\FINAL_BOOT_RECOVERY_ACCEPTANCE.md`
SHA-256: `4817dddef6b497545369758da5be79c940500968b8df7375fb43c892a1ba832a`.

Status: owner/admin installation gate CLOSED / PASS. Real `AtStartup` behavior after an actual reboot/power-loss remains a separate validation event because this change set explicitly performed no reboot/shutdown/logoff.


## Pre-important-task readiness seal — 2026-09-29

Current objective is operational readiness for the owner's next important task, not feature expansion. The authoritative live product remains v0.10.0 / commit 26b8df90838f449bc61710981fc31b7a467e021d.

Windows:
- Doctor PASS, 94 tools, FULL_POWER, activeOperations=0, queued=0, lockedKeys=0, current workflow leases=0.
- default route generation 118 and saeed-emad generation 162 both point to exact v0.10.0 commit with previous=null.
- both Secure MCP Tunnel profiles are ready; HKCU logon autostart is present.
- BootRecovery/UserSessionHandoff owner gate is already closed; Handoff functional validation LastTaskResult=0.
- security audit PASS; GUI contract 77/77 PASS; live GUI backend available and idle.
- browser safety 12/12 PASS; native Chromium background browser PASS with userDesktopTouched=false, passwordStoreExtracted=false, DOM verification PASS; EOF/lifecycle cleanup PASS.
- local readiness artifact: %LOCALAPPDATA%\ChatGPTRemoteCommander\audit\PRE_IMPORTANT_TASK_READINESS_20260929.md
  SHA-256 f1f7ad9c126125d85ef0d5ab8c37d94bad458e2e5c7ed07690a4239e00eea7d4.

Linux:
- Doctor PASS, 94 tools, FULL_POWER, activeOperations=0, queued=0, lockedKeys=0, current workflow leases=0.
- workflow database integrity=ok.
- default route generation 95 points to exact v0.10.0 commit with previous=null.
- systemd user service active+enabled, Linger=yes, Secure MCP Tunnel ready.
- security audit PASS; Linux GUI contract PASS; browser safety 12/12 PASS.
- native Linux browser is not currently runnable: Firefox 156.0.1 is present, but geckodriver/Chromium is absent. apt offers no geckodriver candidate and noninteractive sudo is unavailable. Latest upstream geckodriver v0.37.1 asset is signed with Mozilla subkey 5ECB6497C1A20256, which Mozilla later revoked after an August 2026 key leak. Installing a new user-local executable before the owner's important task was rejected as disproportionate supply-chain risk. This is DEFERRED, not silently treated as PASS.
- Linux automaticExecution=false / runnerConfigured=false and recovery/readiness-only continuation are preserved. No parity change is made immediately before important work.
- local readiness artifact: /home/aliemad/.local/state/chatgpt-remote-commander/audit/PRE_IMPORTANT_TASK_READINESS_20260929.md
  SHA-256 bcca4f4529350c186f2568a0fac389f2c74b101cc3d83b8c943e9e88dc72038f.

Known non-blocking product debt retained for later development:
- durable workflow/delivery lifecycle hygiene and clearer active-vs-historical observability;
- explicit Windows/Linux autonomous-execution parity decision;
- reconcile/test/promote-or-discard the unpromoted v0.10.1 BootRecovery diagnostics work;
- minimal fleet inventory/health/version/tunnel/plugin-identity/policy view;
- optional capability-scoped sandbox/least-privilege execution;
- trusted Linux native browser dependency provisioning;
- macOS/native signed installer/enterprise RBAC only if product scope requires them.

The 20-product benchmark and the above roadmap are recorded in Project Knowledge. Do not mutate live runtime for these deferred items before the owner's important task unless one becomes a direct blocker.

Status: Windows READY/PASS. Linux core runtime READY/PASS; Linux native browser DEFERRED. Project Brain CURRENT.
Exact next action: use the existing v0.10.0 runtime for the important task.

## Milestone — 2026-09-29 — v0.10.1 maintenance candidate locally accepted

Objective: close the remaining current-release maturity gaps without expanding Commander authority or feature scope.

Accepted candidate delta:
- Windows BootRecovery self-test diagnostics now preserve exact profile/integrity exceptions in structured SelfTestOutput and include Task Scheduler state/LastTaskResult when no result file appears. No automatic repair or integrity weakening was added.
- Durable workflow scheduler status now makes the meaning of historical nonterminal records explicit: pending remains backward-compatible, persistedNonterminal exposes the same persisted count, pendingMeaning=PERSISTED_NONTERMINAL_RECORDS_NOT_LIVE_QUEUE, and hasActiveLease distinguishes current root-lease activity. No historical records were deleted or rewritten.
- The inherited-stdio async-operation regression no longer depends on an arbitrary 8-second CI window. The fixture exposes the holder PID, the operation must complete while that holder process is provably still alive, outputComplete remains false, and the holder is explicitly cleaned up afterward. Production operation timeout behavior is unchanged.
- Draft v0.10.1 documentation was corrected to remove an overclaimed BootRecovery root-cause statement. The initial live missing-result event remains precise-cause UNVERIFIED because later production-equivalent SYSTEM probes passed.

Fresh Windows candidate evidence:
- focused maintenance regressions: 44/44 PASS;
- inherited-stdio property stress: 10/10 PASS;
- Project Engine focused suite: 222 pass / 0 fail / 1 skip;
- complete full suite: 493 pass / 0 fail / 6 skip;
- SECURITY_AUDIT_PASS;
- git diff --check PASS;
- final-gate log SHA-256: 50e3bc6acf589884de2d369022e0cb6da89da32f826a4d521a411e501666eee3.

Status: LOCAL PASS / not yet released. Hosted Windows/Ubuntu CI, server-install canaries, clean Linux exact-tree qualification, immutable publication and live Windows/Linux rollout remain open gates.


## v0.10.1 live release seal — 2026-09-29 — one Windows recovery gate remains

Authoritative release:
- main merge commit: `b65c48ff8c2fdacd6fbfe0efef4d90742a9e791c` (PR #68).
- tag: `v0.10.1` annotated tag peels to exact commit `b65c48ff8c2fdacd6fbfe0efef4d90742a9e791c`.
- GitHub Release: published, draft=false, prerelease=false.
- 19 release assets present; all 18 payload assets listed in `SHA256SUMS.txt` independently downloaded and checksum-verified PASS.

Hosted release qualification:
- CI run 36580307031: Ubuntu PASS, Windows PASS.
- Server Install Canary run 36580307099: clean Linux container PASS, Windows server bootstrap PASS.
- local candidate evidence already recorded: focused 44/44 PASS; inherited-stdio stress 10/10 PASS; full suite/security/diff gates PASS.

Windows live:
- runtime version 0.10.1.
- canonical control source HEAD = `b65c48ff8c2fdacd6fbfe0efef4d90742a9e791c`, package=0.10.1.
- default route generation 120 -> exact v0.10.1/main merge commit, previous=null.
- saeed-emad route generation 164 -> exact same commit, previous=null.
- default + saeed-emad tunnels ready.
- Doctor PASS.
- activeOperations=0, queued=0, lockedKeys=0; workflow currentLeases=0, hasActiveLease=false.
- durable scheduler semantics now explicitly report `PERSISTED_NONTERMINAL_RECORDS_NOT_LIVE_QUEUE`.

Linux live:
- runtime version 0.10.1.
- initial final readback found a projection mismatch: routed runtime was v0.10.1 but canonical control checkout remained v0.10.0, causing Doctor expected=0.10.0 / active=0.10.1 FAIL.
- official v0.10.1 `auto-update-linux.sh` maintenance path was run in a retained terminal with exact tag+commit and full qualification; canonical control was promoted to exact `b65c48ff...`.
- postrepair Doctor PASS; package=0.10.1; systemd service active+enabled; Linger=yes; tunnel ready.
- route generation 99 -> exact v0.10.1 commit, previous=null.
- update log records `AUTO_UPDATE_PASS version=0.10.1 commit=b65c48ff...` and supervisor recycle request.
- activeOperations=0, queued=0, lockedKeys=0; workflow currentLeases=0, hasActiveLease=false.

Open Windows recovery gate:
- independent post-release Task Scheduler inventory found `ChatGPTRemoteCommander-BootRecovery` and `ChatGPTRemoteCommander-UserSessionHandoff` absent, despite prior v0.10.0 owner/admin acceptance where both were installed and Handoff was functionally validated.
- source audit found no update/install unregister path for those task names; only explicit `disable-boot-recovery.ps1` intentionally removes them. Precise deletion cause is UNVERIFIED.
- issue #69 records the regression and proposed future persisted-owner-intent/doctor guard.
- official v0.10.1 elevated repair was initiated under prior owner authorization, but Windows UAC returned `operation was canceled by the user`; no repair mutation occurred.
- no blind UAC retry was attempted.
- real reboot/power-return validation remains separately open (#66).

Status:
- v0.10.1 release/publication: FINAL/PASS.
- Windows core runtime/tunnels/routing: PASS.
- Linux core/runtime/control projection: PASS after repair.
- Windows BootRecovery/UserSessionHandoff desired live configuration: OPEN/BLOCKED_BY_OWNER_UAC.
- Project Brain: CURRENT.

Exact next action:
Owner approves the single UAC prompt for the official v0.10.1 `enable-boot-recovery.ps1 -NoStart` repair; then perform elevated task readback + controlled Handoff run, record evidence, and close issue #69. No reboot is required for that repair.


## Milestone delta — 2026-09-30 — retained-backend current-path fix

End-to-end v0.10.1 audit found Windows runtime/routing healthy but retained-backend lifecycle cleanup incomplete while already current. Three dead retained entries remain because `Complete-RetainedBackends` was not called in the CURRENT fast path before release cleanup; a fourth v0.9.10 entry still owns live terminal PID 44432 and must be preserved. The minimum correction has now been patched: run the existing safe reconciler before deferred drains and release cleanup, with ordering guards. Focused updater/registry regression is 15/15 PASS; full regression remains the next gate. No runtime authority, routing, runner, GUI/browser or Linux policy was changed.


## Milestone delta — 2026-09-30 — retained-maintenance local PASS

The Windows CURRENT-path retained-backend maintenance fix passed focused updater/registry tests and the complete local regression. The only production code delta is insertion of the existing safe retained reconciler before deferred-drain/release cleanup. Full test result is 493 pass / 0 fail / 6 platform skips and security audit PASS. Live registry is intentionally unchanged until fresh hosted qualification and merge make the source authoritative.


## Milestone delta — 2026-09-30 — retained liveness refreshed

A fresh Windows read-only audit shows all four retained backend entries now have no live registered terminal PID and no listener. This supersedes the earlier snapshot where one v0.9.10 terminal was still alive, without rewriting history. The existing v0.10.2 retained-maintenance patch remains the minimum safe fix; no manual retained registry edit or process kill is used. Promotion still requires fresh exact-tree regression and hosted gates.


## Milestone delta — 2026-09-30 — v0.10.3 hosted fixture determinism

Current accepted production authority is v0.10.2 on both Windows and Linux at exact immutable release commit `bc126ddf6351e107785096c1eec659cdf2982c1d`. PR #79 is a qualification-only v0.10.3 candidate; production runtime/tool schemas remain unchanged.

Two independent Ubuntu pull-request CI attempts on exact pre-fix head `8e72bed5dd8f42964e4d140af98e02307c67034d` failed the same inherited-stdio regression after about 20 seconds, while Windows CI/server-install canary passed and the exact unpatched Linux regression passed 20/20 isolated repetitions. The test fixture's direct child still depended on an asynchronous stdout callback before exit. The minimum correction is test-only: synchronously write `parent-done` to fd 1, then exit immediately while the detached holder remains alive. Production worker/runtime files are untouched.

Local patched evidence: Linux inherited-stdio 30/30 PASS; Windows 10/10 PASS; Linux full check 262/260 pass/0 fail/2 skip; full test 499/497 pass/0 fail/2 skip; security audit PASS. Exact next gate is fresh hosted Windows+Ubuntu CI plus both server-install canaries on the new committed head. Do not merge or release until those exact-head gates pass.


## Milestone delta — 2026-09-30 — post-merge workflow recovery gate

The first v0.10.3 merge commit `091cfb9e1ef131f5b18f5cf03976f2271ada4b93` is not publishable because post-merge Windows CI exposed a second test-harness timing weakness: workflow restart recovery was observed through a fixed 3-second wait. Exact-commit isolated reproduction passed Windows 15/15 and Linux 20/20, so no production workflow defect is established.

Minimum correction: test-only bounded 30-second elapsed wait plus controller-status failure diagnostics, preserving the automatic `queueMicrotask` recovery property. Production workflow/conversation code remains untouched. Publication stays blocked until fresh exact-head local + hosted qualification succeeds.


## 2026-10-01 — exact-main repository line audit

Audited authority: main ac02b9a0ef33f781d3b8cbd6f70a88fbce92092a, tree 2e06f0c2aa58fb2fbac3037470f7673713b0dfa4. Static coverage: 329 tracked files / approximately 45,975 lines; 165 JS/MJS parse clean; 16 shell scripts parse clean; JSON/YAML parse clean; relative Markdown broken links zero; non-doc TODO/FIXME/HACK/XXX zero; secret-pattern scan zero; workflow actions pinned to full commit SHAs; git fsck and diff-check clean. Exact-head Linux and Windows qualification, security audit and doctor all passed.

Two source defects remain actionable from historical PR audit. PR #75 contains a runtime-marker readiness guard that never reached current main, while current concurrency smoke still reads the marker immediately after HTTP health. The fix is rebased with a bounded 30-second marker-identity wait. Windows updater policy overlay is also generalized from only the default profile to named profiles using the existing narrow merge-primary-policy primitive; active routed runtime state remains authoritative except for explicitly owner-authorized runner policy.

Historical PR #74 is superseded by current deterministic v0.10.3 fixtures and successful bounded-concurrency hosted CI. PR #49 is not adopted wholesale: its canonical-first design has been superseded by guarded active-runtime plus explicit-owner-policy overlay semantics, now applied consistently to named profiles. Storage issues #81, #82 and #83 remain separate product work and are not cosmetically closed by this audit.


## 2026-10-01 — storage hardening #81 candidate

Root cause confirmed: Power Mode `writeAnyFile()` created a complete backup before every append, making a growing file produce quadratic backup bytes. Candidate correction keeps overwrite rollback snapshots but changes append recovery to a small verified journal containing target identity, pre-append byte length/hash and appended length/hash. Recovery is deterministic truncate-to-beforeBytes followed by beforeSha256 verification. File backup retention is per-target and retains the newest N rollback points (default 8; configurable 2–64) only after a new rollback point has been created and verified. Directory backup behavior is unchanged. `power_status.backupPolicy` exposes the effective root, retention count and append recovery mechanism.


## 2026-10-01 — delivery storage hardening #82 candidate

Compaction is deliberately separated from acknowledgement. Eligible completed artifacts may move from plain content-addressed JSON to verified gzip archive storage, but delivery state, attempt, correlation and receipt columns are never mutated. The archive is written to a private temporary file, fsynced, decompressed and hash/size verified, atomically renamed, verified again, and only then is the plain artifact removed. Reads are transparent across live/archive storage and keep exact correlation checks. DELIVERY_PENDING, DEAD_LETTER and non-COMPLETED kinds are excluded. delivery_status.storage reports database/artifact bytes, oldest pending timestamp and archive-candidate bytes.


## 2026-10-01 — storage hardening #83 candidate

Pinned tunnel-client v0.0.15 confirms that `--log.file stdout` is supported and is the safe ownership boundary for rotation. Commander now launches tunnel-client through `tools/tunnel-log-runner.mjs`: the child remains the real tunnel process with unchanged profile/health semantics, while the wrapper owns stdout/stderr persistence. Rotation never renames or truncates a file opened by tunnel-client. The wrapper keeps an 8 MiB current log and up to three gzip archives, retains only a bounded recent tail when migrating an oversized legacy current log, writes atomic `*.log.rotation.json` status, forwards termination on Linux, and Windows readiness-failure cleanup explicitly terminates the exact owned tunnel child before the wrapper to prevent orphaning. The wrapper scrubs control-plane/OpenAI credential variables from its own environment immediately after child spawn.

Acceptance regression forces multiple rotations while one child PID stays alive, reconstructs all stdout/stderr bytes exactly across archives/current file, validates archive count/size/status, and separately proves bounded legacy-tail migration. Linux lifecycle, Windows runtime contract, and source-integrity gates bind both platforms to the same logger architecture.


## 2026-10-01 — post-PR87 Git normalization gate

Fresh Linux checkout of main 219f101291ada1488f6f961e3844b94326770474 exposed a repository hygiene defect: autostart-windows.ps1 and windows-supervisor-runtime.ps1 were stored as CRLF bytes inside their Git blobs while .gitattributes already defines the PowerShell text/eol checkout policy. git add --renormalize . identified exactly those two files, and git diff --ignore-space-at-eol proved semantic content was unchanged. The corrective candidate stores canonical LF blobs while preserving checkout behavior through .gitattributes.

## 2026-10-01 — v0.10.4 release preparation

The post-v0.10.3 maintenance line is intentionally promoted to v0.10.4 rather than leaving main with package identity 0.10.3 plus unreleased runtime/storage changes. Exact release-preparation base is main eaba1122db96f7a47172ee0c1cc5ad96c7840b0e. Release scope is backward-compatible hardening: runtime-marker readiness guard, named-profile owner-policy overlay, bounded Power Mode backup recovery/retention, identity-safe delivery artifact compaction, zero-interruption Commander-owned tunnel log rotation, and canonical Git storage for Windows PowerShell blobs. Production remains v0.10.3 until exact v0.10.4 candidate qualification, hosted CI/canaries, immutable publication and live rollout all pass.


## 2026-10-01 — v0.10.4 clean-Ubuntu canary timing blocker
PR #89 head 8ef7ad3a799c3dc17493d47388e8d391b35fda35 had hosted CI PASS and Windows Server canary PASS. Clean-Ubuntu server canary bootstrapped successfully but one async corruption regression exhausted a generic 10-second pre-corruption terminal wait at about 10.03 seconds. Correction is test-only: that fixture now uses a bounded 30-second terminal/worker-exit window plus last-status/worker diagnostics. Production async operation behavior is unchanged.


## 2026-10-01 — async reconciliation deadline race found by v0.10.4 hosted CI
Updated PR #89 exposed a second 10-second hosted-runner boundary: manager reconciliation could mark an operation UNCERTAIN after reservation deadline+5s even while the owned worker PID was still alive and had only recently begun its own timeout budget. Root cause is mixed clocks: reservation deadline begins before worker scheduling; operation-worker timeout begins at actual child start. Correction makes live-worker finalization authoritative until startedAt+timeoutMs+10s receipt grace, with a bounded 60s scheduling hard guard when startedAt has not yet been persisted. Missing workers after deadline remain UNCERTAIN and no replay is introduced.


## 2026-10-01 — v0.10.4 Windows hosted fixture and release identity closure

PR #89 head 43f4b70f7d51e452fb861a235a6ba1685152b720 passed Ubuntu CI but Windows qualification failed before the inherited-stdio semantic assertion because the holder PID marker path became visible before its asynchronous write bytes were readable. Correction is fixture-only: write PID bytes to a unique temporary file and atomically rename to the ready path. The same change-set completes the four release projections that still referenced v0.10.3 (Windows/Linux public installer defaults, installer contract expectations and final-gate log identity). A second async reconciliation regression proves the new live-worker grace cannot mask a worker forever: once startedAt+timeout+finalization grace is exceeded, status fail-closes to UNCERTAIN without replay.


## 2026-10-01 — v0.10.4 final qualification-harness closure

Post-merge main Windows qualification exposed three load-sensitive failures even though PR #89 exact-head Windows/Ubuntu CI and both server canaries passed the identical source tree. Focused exact-main Windows reruns proved tunnel-log rotation 12/12 and workflow-http 8/8 stable. A subsequent hosted rerun exposed a separate default 10-second async-operation observation boundary. Root cause is qualification file-level scheduler/resource pressure, not production semantics. Final candidate isolates workflow-http, async-operations and tunnel-log-rotation from the large concurrent test-file batch and extends only fixture observation deadlines to 30 seconds. Production timeout/reconciliation/tunnel/workflow behavior is unchanged.


## 2026-10-01 — v0.10.4 hosted Windows final memory-order gate

Post-merge main 2321b887b15b22733a3d2f4a092ad7620bf49290 passed Ubuntu CI but Windows failed only after the large qualification batch, when the already-isolated tunnel-log rotation fixture attempted tiny buffer allocations and Node reported Array buffer allocation failure / heap OOM. The exact fixture and production rotation code had passed focused Windows/Linux qualification and PR canaries. Root cause is residual hosted-runner commit pressure plus ordering: scheduler-sensitive isolated fixtures were moved out of the concurrent batch but still executed after it. Candidate prevention is CI-only ordering: hosted Windows runs tunnel-log-rotation first, then async-operations and workflow-http, each still isolated and concurrency=1, then the bulk qualification command. Package/install/update qualification remains unchanged.


## 2026-10-02 — v0.10.5 stream-resume resilience

A strict comparison against Desktop Commander identified a transferable transport pattern: long work should be detached from one chat response, with persistent process state and bounded paged result reads. The user-observed difference between ChatGPT accounts/plans is recorded as correlation only; plan tier is not accepted as the sole root cause without platform evidence.

The exact v0.10.5 candidate reduces Commander's preventable contribution to host stream expiry:
- direct synchronous command ceiling 10 seconds;
- at most two direct synchronous Commander calls per assistant turn;
- direct run_shell/run_project_command response output capped at 32 KiB;
- read_terminal paged at 32 KiB default / 64 KiB max per stream with explicit continuation offsets and <=5 s bounded wait;
- stale custom-app tool catalogs fall back to one-shot start_terminal + bounded read_terminal rather than increasing sync timeouts;
- durable operation_start/MCP Tasks remain preferred when exposed.

Evidence: targeted 13/13 PASS; broad MCP/transport regression 31/31 PASS; full test qualification final run 483 PASS / 0 FAIL / 6 platform-gated SKIP plus all downstream GUI/source/schema gates PASS. A roughly 16-second test group timed out when held in one direct Commander call but completed through start_terminal + later read_terminal, directly validating the background-handoff mitigation.

Remaining external host gate after rollout: an already-open ChatGPT custom app may retain a stale scanned tool catalog. Refresh/Scan Tools and a fresh chat are required to expose the newest operation/read_terminal schemas when the ChatGPT surface permits it. This is not a reason to widen Commander timeouts or replay uncertain mutations.


## 2026-10-02 — v0.10.6 Saeid release line

Status: RELEASE CANDIDATE / NOT YET PUBLISHED.

Previous accepted baseline: official v0.10.5 commit d6912c750640ca57a67be4a9cc8e6485653eb36c.

Current delta: promote the accepted operation-child lifecycle hardening into the production tree; version Saeid V03 policy/monitor, paused-domain, blocked Q5 private-file and Owned Browser R3 development under experimental/ without production wiring. Browser R3 remains a fixture-only component; Q5 remains STOP/DO NOT RUN. No blocked experimental feature is granted runtime authority.

Evidence before full qualification: operation-child-lifecycle targeted 14/14 PASS; Owned Browser R3 source snapshot 11/11 focused tests PASS after exact dependency packaging; V03 focused suite 100/100 PASS; paused-domain suite 27/27 PASS. Full v0.10.6 Windows/hosted CI/canary/release gates remain open until executed on the exact final tree.

Release DoD: exact-tree parser/static/full qualification + security audit + installer/release contracts + hosted Windows/Ubuntu CI + server-install canaries + immutable tag/release readback. Rollback baseline remains v0.10.5 until those gates pass.


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

Companion preservation delta: PR #99 companion source at 715f99ae229e9e44ccc2e2b4ad6e6c3531b442da is now copied byte-for-byte under experimental/companion-v01 with a manifest. It remains blocked from production because hosted Windows recorded COMPANION_ACL_INVALID; this preserves the development without weakening owner/ACL policy.


## 2026-10-02 — R4 release transport reconciliation

The candidate was reconstructed from immutable Git objects on the publication host. Its complete Git tree matched Saeid tree bdc3175d370f7e4062bea078cec2adede6f12e1b exactly. Source commit f3dba1b177fd53fe58b684c0de16aafa81016cf5 remains provenance. A metadata-only correction updates the packaged Browser R3 client byte count from 3873 to 3822 after its previously tested relative-import rebind; its recorded SHA-256 already matched. Both current component manifests were rechecked for exact hashes and byte counts. Historical source snapshots remain unmodified. Hosted CI/canaries and immutable publication remain required; no host rollout is authorized by a passing source transfer alone.


## 2026-10-02 — R5 repeated Windows failure audit

Prior v0.10.4 CI changes serialized and reordered heavy tests after ArrayBuffer allocation failures. Fresh v0.10.6 Windows run 37059429795/job 111012109746 failed in the FIRST isolated tunnel-log fixture (57.5 s, Array buffer allocation failed), followed by child status 3221225794. This disproves residual pressure from this run's earlier bulk suite as a sufficient explanation. Production logger and fixture bytes are unchanged from baseline. Root cause of the observed allocation failure remains UNPROVEN.

A diagnostic hazard is present: strict deep-equality of two ~917 KiB buffers can format a large binary diff upon mismatch, obscuring the underlying comparison. R5 changes only the test comparator to Buffer.equals with fixed-size length/hash/first-difference diagnostics, preserving exact equality. A one-byte injected mismatch must still fail with under 512 characters of metadata. This is stronger diagnostic coverage, not a product fix or relaxed assertion. Independent stdout/stderr arrival order remains an investigation hypothesis; no ordering assertion is removed in R5.

Primary references checked: Node.js v22 process I/O documentation (https://nodejs.org/docs/latest-v22.x/api/process.html); Node.js Assert documentation (https://nodejs.org/api/assert.html). Exact v22.23.3 assertion source was unavailable from the attempted public URL, so allocation causality is not asserted. No blind rerun or deadline increase. Native fixture/hosted tests must determine the next step.
