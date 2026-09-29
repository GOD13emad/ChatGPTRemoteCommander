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
