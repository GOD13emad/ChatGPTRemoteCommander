# Current project state

Updated: 2026-09-28. Scope: public Remote Commander product/release status.

## Accepted release baseline

**v0.9.20 is SCOPED FINAL / ACCEPTED for the current release objective.**

- Immutable tag/release commit: `cbbc6dc19f63a87e651a8f1af9f429aa7b6a5063`.
- Qualified candidate tree: `674990c743fc996d84d0b0c4e008f0255078e44c`; merge-tree comparison reported no file differences.
- Local exact-tree qualification: Windows PASS after a clean isolated rerun; Linux PASS including release-asset build/checksums and security audit.
- Hosted exact-SHA CI run `36445899951`: Windows PASS; Ubuntu PASS.
- Permanent disposable Server Install Canary run `36445899940`: Windows Server bootstrap PASS with Node/Git absent from PATH; clean Ubuntu 24.04 bootstrap PASS.
- Published release verification: immutable=true; 15 assets present; 14/14 payload checksum entries matched; stable latest `plugin-template.zip` matched the release checksum.
- Live candidate-first rollout: primary Windows default, Windows `saeed-emad`, Linux, and audited HPC Windows routes all point to v0.9.20 / exact release commit with `previous=null`.
- Official separately installed Extension set remains `ansys-modeling` v1.1.1, `comsol-modeling` v1.1.1, `project-execution-brain` v1.0.0, and `final-thesis-report` v1.0.0. The owner-private `video-trend` extension is intentionally outside the official set.
- Live routing acceptance on Windows/Linux/HPC: COMSOL -> COMSOL only; ANSYS audit/continue -> ANSYS + Project Execution Brain; Persian final-thesis request -> Final Thesis Report only; diagnostics empty.
- Headless execution invariant remains accepted: Commander/runtime/qualification PowerShell child paths are hidden/no-window by default; console windows are not an approved progress surface.
- Windows server bootstrap does not disable Defender/EDR and does not add antivirus exclusions.

## Current status

No open blocker remains for the **v0.9.20 release objective**.

Post-release repository closure is also ACCEPTED: PR #45 exact head `bb973bb9f1de2f644d9a5e33fbbb854780897aa2` passed hosted Windows/Ubuntu CI run `36451298406` and Windows/Linux Server Install Canary run `36451298534`, then merged to main as `f0157ccff98da9e42c25e5ea0bd55bc9ee7de0ab`. This post-release main commit updates docs, GitHub Actions pins and test-fixture readiness only; immutable v0.9.20 release bytes remain unchanged.

Broader product ambitions and host-platform limitations remain outside this scoped release acceptance and are listed under Remaining roadmap / Deferred below. They must not be interpreted as completed by this release.

## Remaining roadmap

Broader blocker escalation, monetary accounting, additional providers/integrations and equal-model/equal-budget project benchmarks remain open. The complete ambition of a universally superior project agent is **UNPROVEN**. A configured provider and explicit project enrollment are required for model-driven execution. Installation, service health, account authentication and task acceptance are separate checks. The release does not establish an OS sandbox or new autonomous browser authority.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.9.3 candidate](RELEASE_0.9.3.md), [v0.9.1 published baseline](RELEASE_0.9.1.md), [v0.9.2 historical candidate](RELEASE_0.9.2.md), [v0.9.0 published](RELEASE_0.9.0.md), [v0.8.42 historical published baseline](RELEASE_0.8.42.md), [v0.8.40 historical candidate](RELEASE_0.8.40.md), [v0.8.39 historical candidate](RELEASE_0.8.39.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md) and [current Project Brain](PROJECT_BRAIN.md).

Historical checkpoints are preserved in the [archived project state](history/PROJECT_CONTROL_STATE_20260924.md). Their former “current”, “final” and “next action” labels are historical. Account bindings, machine paths, process inventories and operational receipts belong in private deployment handoffs rather than this public status page.


## CURRENT CHANGE SET — v0.9.9 bounded delivery reconciliation

- Objective: stop repeated historical-operation rediscovery/state churn while preserving durable lost-ack and restart recovery.
- Baseline authority: v0.9.8 / `7e48fe1b23192064091f4c39a50c723d077f5a07`; Windows and Linux live runtime parity confirmed before mutation.
- Root cause: every periodic reconciliation cycle rediscovered every historical operation directory.
- Change: discover historical operations once at manager startup; thereafter reconcile only the tracked set. New operations are already added at start; failed/unresolved delivery stays tracked.
- Regression: focused async/HTTP/correlation suite PASS 14/14; second historical reconciliation requires checked=0 and unchanged state mtime.
- Stream incident: ChatGPT host/UI stream termination remains OPEN as a separate boundary. v0.9.9 reduces avoidable Commander I/O pressure but does not claim to control host-side thinking/stream expiry.
- Current gate: exact candidate full Windows check/test/audit, commit/push/tag/release, candidate-first promotion, then Windows/Linux live parity and post-promotion no-churn verification.
- FINAL status: UNPROVEN until those gates complete.


## CURRENT CHANGE SET — v0.9.10 receipt-backed corrupt-projection recovery

- Objective: eliminate the remaining repeated reconciliation of 22 unreadable historical operation projections without deleting evidence or replaying effects.
- Baseline authority: v0.9.9 / `a0f577b4943f6ae93c34a5795df3fc131d814dd4`, published immutable and live on Windows/Linux before this mutation.
- Confirmed production evidence: 22/22 state projections all-zero; 22/22 exact final receipts; 22/22 exact request mappings and correlations.
- Change: exact evidence-backed reconstruction with content-addressed corrupt-byte backup; mismatch remains fail-closed.
- Validation: focused suite PASS 16/16; real-data copy recovery 22/22 with tracked=0 and no invalid cases.
- Current gate: full cross-platform candidate qualification → commit/tag/release → candidate-first rollout → live tracked=0 verification.
- FINAL status: UNPROVEN until those gates complete.


## CURRENT CHANGE SET — v0.9.11 ChatGPT-first / No-Codex Commander invariant

- Objective: prevent Remote Commander from consuming Codex/model-provider quota unless the user explicitly leaves Commander for an external Work/Codex handoff.
- Trigger: live R28 executor audit proved a Commander-launched private Codex CLI was using ChatGPT Plus Codex/agentic allowance.
- Root cause: Full Power auto-provisioned `provider=codex` and general script execution did not prohibit indirect Codex launch.
- Locked policy (superseded by v0.9.15 owner authorization): **local Codex launch is default-deny, not absolutely forbidden.** It is permitted only for an explicitly authorized `FULL_POWER` owner profile with `powerMode.codexControl.allowLaunch=true` and a current request that explicitly calls for Codex. Hidden/background project runners remain No-Codex. External Work/Codex handoff still requires the current-chat choice **Move to Work/Codex** vs **Continue in this chat with Remote Commander**; default is continue-chat.
- Implementation: Codex provisioning removed; legacy runner disabled; direct/shell/terminal/package-manager/script-mediated Codex guarded; child model credentials stripped; Plugin/MCP instructions updated; legacy Commander-private provider cleanup added.
- Focused regression: no-Codex/planner/runner **33/33 PASS**; installer check PASS; onboarding PASS; updater contract **13/13 PASS**.
- Current gate: full Windows check/test/audit → Linux exact-tree check/test/audit → commit/push/hosted CI → immutable v0.9.11 publication → candidate-first Windows/Linux rollout → live no-Codex/config/route verification.
- FINAL status: UNPROVEN until those release/rollout gates complete.


## CURRENT CHANGE SET — v0.9.13 durable task + same-conversation automation

- Previous accepted state: v0.9.12 / ChatGPT-first, no Commander-side Codex execution.
- Objective: long work returns immediately, survives stream/client interruption, and resumes reasoning in the same ChatGPT conversation when a durable event requires it.
- Architecture: MCP Tasks capability mapping + legacy operationId fallback; bounded event-driven status follow; private SQLite conversation outbox; exact existing-tab UIA delivery; workflow NEEDS_CHAT atomic pause/evidence/Brain sync.
- Failure prevention: stable event-key dedupe, no blind retry after uncertain UI send, restart receipt reconciliation, fixed anti-injection handoff envelope, no new-tab/clipboard/mouse/Codex fallback.
- Focused validation: MCP Tasks contract PASS; conversation suite PASS; feature Windows full and exact-tree Linux full PASS; feature hosted Windows/Ubuntu CI PASS before integration.
- Integration gate: full Windows → exact-tree Linux → hosted CI → immutable publication → candidate-first rollout → live canaries.
- FINAL status: UNPROVEN until integration release/rollout gates complete.


## CURRENT CHANGE SET — v0.9.14 MCP Tasks compliance

- Objective: map unknown MCP task IDs to protocol-compliant `-32602 Task not found` without changing durable execution semantics.
- Baseline authority: v0.9.13 / `f7aa867e28765d40772b953f31fbff93cbaa77fc`.
- Candidate authority: `5116163` on `finalize/v0.9.14-r1`.
- Windows local qualification: focused MCP Tasks regression PASS; `npm run check` PASS exit 0; `npm test` PASS exit 0; `npm run audit` PASS with `SECURITY_AUDIT_PASS`.
- Remaining release gates: hosted Windows/Ubuntu CI, exact-tag installer/update acceptance, immutable publication, and candidate-first Windows/Linux rollout with post-promotion runtime canaries.
- FINAL status: UNPROVEN until remaining release gates complete.


## CURRENT CHANGE SET — v0.9.15 explicit owner authorization

- Objective: make explicit owner authorization effective for stale-schema GUI takeover and local Codex launch without weakening default-deny behavior.
- Baseline authority: v0.9.14 integrated on main via merge commit `5e08c1356ee4802da12295ebc89cd9c9a4e7175e`; v0.9.15 branch is derived from the qualified v0.9.14 head.
- Confirmed root causes: active ChatGPT connector schema can remain stale while live server schema has takeover fields; Codex launch was hard-blocked regardless of owner intent.
- Minimum controls: both persistent opt-ins require `FULL_POWER + explicitlyAuthorized=true`; ordinary/default profiles remain observe-only/Codex-denied.
- Focused regression: first run FAIL 103/104 due missing response provenance only; narrow fix applied; second run PASS 104/104.
- TinyFish benchmark: hosted search/fetch/proxy/vault/stealth/browser-profile/webhook features are complementary and are not duplicated into the local Commander core without demonstrated need.
- Current gate: full Windows check/test/audit, hosted CI, exact-tag installer/update acceptance, candidate-first rollout and live authorization canaries.
- FINAL status: UNPROVEN until those gates complete.

- Windows full qualification delta: `npm run check` operation `75d71f03-da21-4b05-92b3-75c3e5594e4b` PASS exit 0; `npm test` operation `83494e4f-3ec1-4924-bba5-c0473fae5657` PASS exit 0; `npm run audit` PASS with `SECURITY_AUDIT_PASS`. First full-check operation `f75eb1e0-7ba3-4928-b1d1-6899837983d7` failed because helper `capture()` referenced out-of-scope `ctx`; targeted process-tree/auth suite then PASS 109/109 after explicit `allowCodex` wiring, followed by full PASS.


- Hosted CI delta: PR #36 exact head `3a5c49c` passed Ubuntu but Windows `npm test` failed one pre-existing async corrupt-projection race (GitHub Actions run `36393301881`, job `108833771646`): expected no delivery event after deliberate receipt/reservation hash mismatch, but transient tracked state was still 1 while the just-terminal worker process had not fully exited.
- Narrow prevention: the two corrupt-projection tests now wait for the exact worker PID to exit before mutating `state.json` / `result.json`; product runtime behavior is unchanged.
- Regression: `test/async-operations.test.mjs` repeated 10 times on Windows, **140/140 PASS**, terminal `term-27`, exit 0. Next gate: full exact-tree Windows check/test/audit, then updated exact-SHA hosted CI.

- Post-race-fix full exact-tree Windows gate: `npm run check` PASS; `npm test` PASS (core runner 475 PASS / 6 SKIP / 0 FAIL plus downstream GUI/concurrency/runtime/schema gates); `npm run audit` PASS with `SECURITY_AUDIT_PASS`; terminal `term-28`, final exit 0.


### Async lifecycle gate before v0.9.16

- Repeated timing failures in the async lifecycle test family triggered a historical/source audit rather than another blind retry.
- Ubuntu PR #37 failure was isolated to the `linger-stdio` fixture assumption; production worker logic was not changed.
- Fixture now forces the direct child to exit after flushing its own output while a detached grandchild retains inherited stdio, deterministically exercising Node's documented `exit` vs `close` distinction.
- Focused Windows async regression: 14/14 PASS, exit 0.
- Cross-platform status: UNPROVEN until exact-SHA hosted Windows/Ubuntu CI passes.


## CURRENT CHANGE SET — v0.9.16 owner-authorized Codex environment

- Objective: make explicit owner-authorized Codex launch end-to-end correct while preserving default-deny and hidden-runner No-Codex controls.
- Baseline authority: v0.9.15 tag / merge commit `538c1dee6a0723f91ff1bd8f68585fbc60b6f8a2`.
- Live GUI blocker: RESOLVED and verified on the actual stale ChatGPT tool schema; `gui_session_begin({ttlSeconds})` returns takeover with `owner-persisted`.
- Remaining root cause: authorized Codex can inherit Commander's generated no-Codex `CODEX_HOME` sentinel from an older parent process.
- Fix scope: environment decontamination only for Commander-generated sentinel paths; legitimate owner `CODEX_HOME` remains intact. Current plugin/tool text is aligned with the live policy. Background project runner remains No-Codex.
- Related release gate: async exit/close fixture made cross-platform deterministic after repeated CI timing failures; production worker unchanged.
- Current gate: focused regressions → full Windows check/test/audit → hosted exact-SHA Windows/Ubuntu CI → immutable publication → candidate-first rollout/live Codex canary.
- FINAL status: UNPROVEN until all gates pass.


### v0.9.16 Windows qualification

- Focused authorization/async regression: PASS 22/22.
- Installer and onboarding/plugin checks: PASS.
- Full Windows `npm run check`: PASS.
- Full Windows `npm test`: PASS; core 475 PASS / 6 SKIP / 0 FAIL plus downstream contract gates.
- Windows `npm run audit`: PASS / `SECURITY_AUDIT_PASS`.
- Current gate: commit/push → hosted exact-SHA Windows/Ubuntu CI.


### v0.9.16 Windows qualification

- Focused authorization/async regression: 22/22 PASS.
- Installer parser/check: PASS.
- Onboarding/plugin check: PASS.
- Full Windows exact-tree gate: `npm run check && npm test && npm run audit` via PowerShell 7 strict wrapper, terminal `term-17`, exit 0.
- Full test core: 475 PASS / 6 SKIP / 0 FAIL; GUI contract: 77/77 PASS.
- Next gate: clean Linux exact-tree qualification, then hosted exact-SHA Windows/Ubuntu CI.


### v0.9.16 Linux qualification

- Clean detached Linux worktree: exact SHA `32b85b8`.
- Full gate: `npm run check`, `npm test`, `npm run audit`, exit 0.
- Full test: 480 PASS / 1 SKIP / 0 FAIL.
- GUI contract: 77/77 PASS.
- Concurrency smoke, source integrity, installer check, security audit: PASS.
- Final marker: `V0916_FULL_LINUX_PASS`.
- Next gate: hosted Windows + Ubuntu CI on the final evidence-bearing candidate SHA.


### v0.9.16 hosted security-audit correction

- Hosted Ubuntu on the prior candidate: `check` PASS, `test` PASS, `audit` FAIL solely because evidence contained a developer-specific absolute Windows checkout path.
- Audit policy remains strict; no exemption added.
- Unmerged candidate evidence was sanitized to role/SHA provenance.
- Local security audit: PASS.
- Focused Codex policy regression after status-metadata clarification: 8/8 PASS.
- Current gate: renewed hosted Windows + Ubuntu CI on the new exact SHA.


### v0.9.16 current-guidance consistency

- Superseded absolute “Commander never launches Codex” wording was found in current README/runtime instructions.
- Current text now matches the implemented policy: default-deny local Codex, explicit trusted Full-Power owner opt-in only, hidden/background project runner still No-Codex, external handoff still explicit-choice only.
- No runtime authorization broadening was introduced by this text-alignment change.


### Server bootstrap change set

- Added raw-server Windows bootstrap: no WinGet dependency; verified PowerShell/Node/Git prerequisites; exact source commit handoff; Server Core GUI auto-disable; health validation.
- Added Linux server bootstrap: apt/dnf/yum/zypper/pacman prerequisite path; exact source commit; headless GUI opt-out by default.
- Antivirus/EDR policy: no automatic exclusions. Installer emits allowlist evidence for admin-controlled publisher/hash rules.
- Windows static/onboarding/security gates: PASS.
- Linux overlay syntax/installer/focused/security gates: PASS.
- Fresh disposable server installation canary: OPEN.


### Windows hosted CI lifecycle correction

- Prior hosted candidate: Ubuntu fully PASS; Windows `check` PASS, test FAIL only in isolated-server fixture lifecycle.
- Failure family: 3 temp cleanup `EBUSY` errors + 1 15-second health-start timeout under hosted parallel load.
- Fix is test infrastructure only: child `close` before cleanup, bounded Windows rm retries, 30-second fixture startup budget.
- Focused Windows regression: 5 rounds / 35 of 35 PASS.
- Linux overlay affected suite: 7 of 7 PASS.
- Next gate: full exact-tree Windows + clean Linux, then hosted exact-SHA Windows/Ubuntu.


## CURRENT CHANGE SET — v0.9.17 immutable release assets

- Previous accepted runtime state: v0.9.16 / `981e0b2a8856043b862da8a3ec63d75c5d906588`, qualified and live on Windows, Linux and the audited HPC target.
- Main blocker: v0.9.16 immutable release contains no attached assets while current Work/plugin onboarding depends on `releases/latest/download/plugin-template.zip`.
- Root cause: Release Sync crossed the immutable publication boundary before attaching assets; post-publication upload is blocked by design.
- Minimum fix: deterministic 16-asset build + SHA-256 verification, then attach the complete set during `gh release create`; keep immutable releases enabled.
- Runtime delta: version only; no authorization, updater, workflow, browser, GUI or execution-policy broadening.
- FINAL status: UNPROVEN until exact-SHA local/hosted gates, immutable publication, asset download verification and rollout pass.


## CURRENT CHANGE SET — v0.9.18 operational closure

- Installer cleanup failure: CONFIRMED root cause; successful candidate update could be followed by cleanup-only exit 1. Prevention implemented as best-effort temp cleanup with warning-only defer.
- PowerShell visibility: CONFIRMED gap in test/qualification helpers; main runtime paths were already hidden/no-window. Remaining helper launches now use `windowsHide:true`; regression gate PASS.
- Agent Extensions: `agent_extension_route` and `agent_extension_skill` added as read-only tools. Local separately installed acceptance set is `ansys-modeling`, `project-execution-brain`, and `final-thesis-report`. Owner-private `video-trend` is excluded from this rollout. Standalone COMSOL Skill is MISSING/UNVERIFIED in the current local catalog.
- FINAL status: UNPROVEN until full exact-SHA gates, hosted CI, immutable release verification, and rollout pass.


## CURRENT CHANGE SET — v0.9.19 Skill-routing specificity

- Previous accepted state: v0.9.18 / `b277c30ee9c1ecceb9e68638cf413fe4f7b75d4c`, immutable release verified and live on Windows/Linux/HPC.
- Trigger: acceptance of external COMSOL showed `ansys-modeling` could appear as a weak lexical candidate for an explicitly COMSOL task because both domain descriptions contain generic terms such as modeling/condensation.
- Prevention: when at least one declared trigger matches, suppress lexical-only candidates; use lexical-only routing only when no trigger evidence exists.
- Layering: multiword triggers may match by complete token presence even when separated, allowing `project-execution-brain` to layer with a directly relevant domain Skill.
- External official set: `ansys-modeling` v1.1.1, `comsol-modeling` v1.1.1, `project-execution-brain` current installed version, `final-thesis-report` v1.0.0. `video-trend` remains owner-private/excluded.
- Focused regression: Agent Extension suite 13/13 PASS; installer/onboarding/release-asset checks PASS.
- FINAL status: UNPROVEN until exact-SHA full gates, hosted CI, immutable publication verification and rollout pass.


## 2026-09-28 — v0.9.21 runner-authorization closure

- Previous accepted source baseline: main@4a93d5475447f751e81ceaa87495b8c684fd1e87 (0.9.20).
- Current mutation objective: repair the owner-authorized Codex Project Engine contract without weakening default-deny.
- Authority: one clean writer clone ChatGPTRemoteCommander-finalize-20260928; legacy dirty checkout is non-authoritative and untouched.
- Validation gate before promotion: focused policy/runner/planner/Project Engine tests, full npm run check, npm test, npm run audit, git diff --check, then GitHub CI and live runtime readback.
- Residual external gate: native host wake/push (hostWakeAvailable=false) is outside Commander authority. Long-soak qualification remains evidence-dependent and cannot be marked PASS without elapsed evidence.


## 2026-09-28 — local promotion gate result

- Local release candidate 0.9.21: **PASS for immediate reproducible gates**.
- Gate marker: FINAL_GATE_PASS 2026-09-28T21:50:18.6502700+03:30.
- Gate log SHA-256: 406a95addaff1ccc343969c2d4097bf401eac2145b36e5ad18431429108bb569.
- Zero test failures in the final gate; platform skips were retained rather than converted to PASS.
- Promotion state: GitHub/CI/live deployment still OPEN.
- Long-soak and external host wake: UNPROVEN / external.

## 2026-09-28 — Hosted pre-promotion security-audit correction

- First hosted v0.9.21 attempt: Ubuntu CI and clean-Ubuntu canary failed at security audit only.
- Root cause: a personal absolute checkout path was written into repository-facing Brain content.
- Corrective action: anonymize repository provenance, amend the still-unmerged release commit, force-push with lease, and rerun local/hosted audit gates.
- Merge remains BLOCKED until the amended SHA passes CI and server-install canary.


## 2026-09-28 — Hosted Windows browser qualification blocker

- Amended SHA d297ec212ec4d3a670a1a5081d1d00888851298e: Ubuntu CI PASS; clean-Ubuntu server canary PASS.
- Windows CI blocker: one test used an 80 ms request timeout for both setup/start and the intended hang timeout; production has no 80 ms response contract.
- Windows Server blocker: one profile-owned cleanup test asserted raw PID nonexistence rather than exact profile-owned process identity.
- Mutation: test-only qualification correction; production browser lifecycle code and production timeouts remain unchanged.
- Promotion remains BLOCKED until targeted stress + local final gate + hosted Windows CI + Windows Server canary pass.


## 2026-09-28 — Local gate requalification PASS

- Browser qualification regression: 7/7 PASS; targeted hosted-Windows scenarios stress: 20/20 PASS.
- Full local release gate: PASS with Project Engine 222/0/1-skip and full suite 481/0/6-skips; SECURITY_AUDIT_PASS; diff-check PASS.
- Evidence log SHA-256: 107D33026CD9294B07ED8B7AAB79B0A6B63B5EE325E634A663E184C505FD80DB.
- Next gate: amend the unmerged release candidate, push with explicit SHA lease, and require fresh GitHub CI plus Windows/Linux server-install canaries before merge.


## 2026-09-28 — Third hosted-Windows browser qualification occurrence

- Stop-patching threshold reached for the hosted-Windows browser failure family; historical audit plus primary Node documentation review performed before the next mutation.
- Candidate 812d3fd failed before cleanup validation because the test fixture recorded child.pid immediately after asynchronous spawn.
- Root cause: test fixture spawn/PID race. Guard: await child spawn before PID evidence is written.
- Product/runtime browser code remains unchanged.
- Promotion remains BLOCKED pending targeted regression, final local gate, and fresh hosted gates.


## 2026-09-28 — Final local requalification PASS after child-spawn guard

- Targeted browser-process regression: 7/7 PASS; repeated child-spawn paths: 10/10 PASS.
- Full local release gate: PASS. Project Engine 222/0/1-skip; full suite 481/0/6-skips; GUI 77/77; SECURITY_AUDIT_PASS; diff-check PASS.
- Final gate marker: 2026-09-28T23:06:39.5908545+03:30.
- Gate log SHA-256: 0DC03CE86CF73A2847B68ECC566D7CDF916F91F7B3E0D69DB33A51DF8DA5F817.
- Exact next gate: amend the still-unmerged candidate, push with explicit lease against 812d3fdedc9d58c655aa6237a8e6c4b5d0d4284d, then require fresh hosted CI/canaries.


## 2026-09-28 — Async-continuation cleanup gate

- Full gate after browser qualification fix had one failure only: Windows fixture cleanup returned `ENOTEMPTY` after the idempotency assertions had passed.
- Mutation: test-fixture teardown only, using the repository's established recursive cleanup retry policy (`maxRetries:20`, `retryDelay:50`).
- Runtime/contract code unchanged. Promotion remains BLOCKED until targeted stress and full final gate pass.


## 2026-09-28 — v0.9.22 current blocker / policy-overlay hotfix

- Previous accepted source: main after PR #48; v0.9.21 hosted CI and Server Install Canary passed.
- Live blocker: v0.9.21 runtime remains `runnerConfigured=false / automaticExecution=false` although canonical local owner policy explicitly enables the runner.
- Root cause: Windows updater uses active routed config as the default candidate source and therefore retained the historical policy-disabled runner.
- Current mutation objective: overlay only an independently authorized canonical runner onto the active baseline when the active reason is exactly `NO_CODEX_VIA_COMMANDER`.
- Promotion remains OPEN until focused/full/hosted gates, live candidate-first rollout, and exact live readback pass.


## 2026-09-29 — v0.9.22 local promotion gate PASS

- Complete local promotion gate PASS with security audit, source integrity, runtime contracts and diff check all green.
- Evidence log SHA-256: `a06b87e9a80be2bd0853207f3a9f33e191d27b12199af16e7cd0de79fe066b7f`.
- Current critical path: commit/push -> hosted CI -> merge -> immutable v0.9.22 release -> candidate-first live rollout -> exact live runner readback.
- FINAL remains UNPROVEN until live `runnerConfigured=true` and `automaticExecution=true` are observed on the routed runtime.


## 2026-09-29 — PR #50 hosted Windows gate regression

- Hosted Windows CI for head `8129441eec60ea21944b5c0b1c1bbc41ab0ab7ce` failed on two qualification races only: async temp-root teardown `EBUSY`, and browser PID marker read before valid content was ready.
- Production runner-policy hotfix remains unchanged. Merge stays BLOCKED until targeted stress, full local gate and hosted reruns pass on a new head SHA.


## 2026-09-29 — PR #50 qualification revalidation PASS

- Windows qualification race fixes passed targeted stress and a complete local v0.9.22 promotion gate.
- Gate evidence SHA-256: `1996b17a4bad9c958de46ddf693ec507dece49e5a5e12cc3a839fdf71256b16b`.
- Merge remains BLOCKED until fresh hosted CI and Server Install Canary pass on the new PR head SHA.


## 2026-09-29 — Windows CI resource-starvation control

- Current PR #50 head `3f1ea4f9c598db78fdd15e0b70ce85411f2d6bff`: Ubuntu CI PASS; Linux + Windows Server Canaries PASS; Windows `check` PASS; Windows `npm test` failed two time-sensitive tests under the full parallel suite.
- Root-cause class: hosted Windows file-process concurrency/resource starvation, not production runner-policy behavior.
- Current mutation objective: bound only Windows hosted full-test file concurrency to 2; local/Ubuntu tests and functional timeout contracts remain unchanged.
- Merge remains BLOCKED until this CI harness change passes local bounded-path qualification and fresh hosted CI on a new head SHA.


## 2026-09-29 — Windows bounded-CI local gate PASS

- Windows-specific bounded full-test path PASS, then complete CHECK PASS, then complete v0.9.22 final gate PASS.
- Gate log SHA-256: `5f2bb611d2e43e921f57695119f1f3692313b4eb5ca6df1a7d71c631c157e87c`.
- Current critical path: commit/push CI-harness delta -> fresh hosted CI/Canary -> merge PR #50 -> immutable v0.9.22 release -> candidate-first live rollout -> live runner readback.


## 2026-09-29 — Linux install canary qualification starvation

- PR #50 head `47c40616c30b37b23451cd237790f45bf81c4656`: CI PASS; Windows Server Canary PASS; Linux clean-container canary failed two async-operation waiters at the exact 10 s bound during the installer's full qualification suite.
- Production code remains unchanged by the current mutation objective.
- Current mutation objective: replace platform-specific bounded CI naming with generic `test:qualification` (concurrency=2) and use it in hosted Windows CI, Windows installer qualification, Linux installer qualification and Linux auto-update qualification.
- Merge remains BLOCKED until targeted contracts, exact qualification path, complete local gate and fresh hosted CI/canary all pass on a new head SHA.


## 2026-09-29 — Generic qualification path local PASS

- Generic `test:qualification` (Node test-file concurrency=2) is wired into hosted Windows CI, Windows installer qualification, Linux installer qualification and Linux auto-update qualification; normal `npm test` remains unchanged.
- Targeted contracts PASS; exact bounded qualification full suite PASS; complete unbounded local final gate PASS at `2026-09-29T07:26:17.2585959+03:30`.
- Final-gate log SHA-256: `1338cc7cd5e3d5b65739342fe4e3b8b0fdeffbd0501fe0d9f514d04196af751c`.
- Current critical path: commit/push -> fresh hosted CI + Linux/Windows install canaries -> merge -> immutable v0.9.22 release -> candidate-first live rollout -> live runner/system-status proof.
- FINAL remains UNPROVEN until live routed runtime proves `runnerConfigured=true` and `automaticExecution=true`.


## 2026-09-29 — Ubuntu Linux installer oracle mismatch

- Head `e7fa42ab33a3633a7d290b8b47c25cbfade0c639` failed Ubuntu CHECK because three Linux-only installer-isolation expectations still asserted legacy npm command `test` instead of the intentionally introduced `run test:qualification`.
- Actual installer behavior was correct; mutation objective is test-oracle alignment only.
- Merge remains BLOCKED until a new SHA passes fresh Ubuntu/Windows CI and both Server Install Canary jobs.


## 2026-09-29 — v0.9.23 Windows auto-update qualification hotfix

- v0.9.22 is published and immutable at merge commit `1149ad23bbbce397d52e61663bbd3063fec76e17`.
- Default live runtime remains safely on v0.9.21 after the resumed v0.9.22 updater failed its unbounded candidate test gate; no failed candidate was promoted.
- Exact failing `workflow-http.test.mjs` passed 3/3 in isolation immediately afterward. Repository audit found the remaining gap: `auto-update-windows.ps1` still used raw `npm test`.
- Current mutation objective: v0.9.23 changes only Windows auto-update candidate qualification to `npm run test:qualification`, extends the generic qualification regression contract, and bumps release metadata.
- Runtime semantics, functional timeouts, runner-policy overlay, routing logic and independent `saeed-emad` policy are unchanged.
- Critical path: targeted contract -> exact bounded suite -> complete local final gate -> fresh hosted CI/canaries -> merge -> immutable v0.9.23 release -> candidate-first live rollout -> default live readback with `runnerConfigured=true` and `automaticExecution=true`.
- FINAL remains UNPROVEN until that live readback and drain closure succeed.


## 2026-09-29 — v0.9.23 local gate accepted

- Focused Project Engine PASS: 222 / 0 / 1 skip.
- Exact bounded qualification PASS: 483 / 0 / 6 skips with concurrency=2.
- Complete unbounded final gate PASS at `2026-09-29T08:44:21.1074309+03:30`.
- Gate artifact: `var/final-gate-v0.9.23.log`; SHA-256 `caf3697d100ab9d6ccdcac913178a2bb424938b5e8cf6dd40dbf684a851b53d5`.
- Current critical path: commit/push -> fresh hosted CI + Linux/Windows install canaries -> merge -> immutable v0.9.23 release -> candidate-first live rollout -> live default runner readback.
- FINAL remains UNPROVEN until the live default routed runtime reports `runnerConfigured=true` and `automaticExecution=true` and no previous drain remains.


## 2026-09-29 — PR #51 Windows CHECK qualification blocker

- PR #51 head `fd4a69d31715acb391528d933f07d6070b9237f9`: Ubuntu CI PASS; Linux clean-container canary PASS; Windows Server bootstrap canary PASS; Windows CI FAIL only in unbounded `npm run check`.
- Current mutation objective: bound Node test-file concurrency in qualification CHECK paths via existing `check:qualification`; no timeout/runtime/routing/runner-policy changes.
- Merge remains BLOCKED. Exact next gate sequence: focused contract -> `npm run check:qualification` -> `npm run test:qualification` -> complete unbounded local final gate -> new commit/push -> fresh hosted CI/canaries.


## 2026-09-29 — qualification CHECK local promotion gate PASS

- Focused qualification/update/installer regressions PASS.
- `check:qualification` PASS with concurrency=2 and four bounded Node test batches.
- `test:qualification` PASS; aggregate 483 / 0 / 6 skips.
- Complete unbounded final gate PASS at `2026-09-29T09:19:39.7374006+03:30`.
- Gate artifact `var/final-gate-v0.9.23.log`; SHA-256 `b9e5945c7155a95212d5c2864fadca2acc15680e8e00c896980b62d14486a156`.
- Current critical path: commit/push -> fresh hosted CI + Linux/Windows install canaries -> merge/release -> candidate-first live rollout -> live default runner readback.
- FINAL remains UNPROVEN until hosted gates and post-release live runtime criteria pass.


## 2026-09-29 — v0.9.23 live rollout accepted

- Authoritative release: `v0.9.23` -> `a1b5368edf33d629111407aecd7f4c6a136a6122`; release asset contract complete.
- All fresh hosted gates passed before merge; complete local unbounded final gate also passed.
- Default live route: v0.9.23, commit `a1b5368...`, port 48835, generation 116, no previous route.
- Default live workflow authority: Full Power preserved; `runnerConfigured=true`; `automaticExecution=true`; runner provider is owner-authorized Codex.
- `saeed-emad`: v0.9.23, no previous route, intentionally retains its independent `NO_CODEX_VIA_COMMANDER` runner-disabled policy.
- Old v0.9.21 default backend was removed from routing and registered as retained because PID 69684 is an active persistent terminal descendant. No active user work was killed.
- `last-update.status=CURRENT` for v0.9.23.
- **Release/rollout status: FINAL PASS.** Remaining retained-backend entries are lifecycle cleanup tied to still-running terminal jobs, not a release blocker or routing authority.


## Change Set — 2026-09-29 — post-release live finalization

**Objective:** reconcile live Windows deployment state after v0.9.23 acceptance without interrupting retained terminal work.

**Evidence-backed results:**
- Executable authority remains v0.9.23 / `a1b5368edf33d629111407aecd7f4c6a136a6122`; subsequent repository changes before this change set were documentation-only.
- default route generation 116 and saeed-emad generation 160 both point to v0.9.23 with `previous=null`.
- Retained v0.9.10/v0.9.12/v0.9.13/v0.9.21 backends remain intentionally preserved because their registered terminal descendants are still live; they are not routing authority and were not force-killed.
- Six superseded Commander maintenance workflow intents were cancelled with exact revision preconditions. Poststate: all six CANCELLED/scheduler-disabled; scheduler pending 811→805 and RUNNING 553→547.
- Workflow database integrity `ok`; active workflow leases 0; ordinary operation queue 0/0.
- Logon autostart state drift was repaired using `enable-autostart.ps1 -NoStart`; Run registration is restored and both tunnel readiness endpoints are healthy.
- Fresh installed-release regression passed: focused 42/0; CHECK exit 0; TEST 483 pass/0 fail/6 skip; security audit PASS; doctor PASS.
- BootRecovery/UserSessionHandoff SYSTEM tasks remain absent and require an elevated owner token. Current token is not elevated; this is an explicit deployment gate and no privilege-boundary bypass was attempted.

**Status:** v0.9.23 release/runtime = FINAL PASS. Windows logon persistence = PASS. Boot-before-logon autonomous recovery = MISSING owner/admin gate. Exact next action is one elevated run of the bounded boot-recovery runner followed by acceptance of its `RETURN.json`; no reboot is part of that runner.


## Change Set — 2026-09-29 — v0.10.0 installable product and per-device Plugin packaging

**One main objective:** close the remaining product-distribution friction while preserving the accepted v0.9.23 execution/update architecture.

**Implemented:**
- Windows and Linux Setup wizards plus stable/versioned Setup ZIP release packaging.
- Setup mode selection: Standard, Full/Power, Full/Power + guarded GUI.
- Existing secret-safe tunnel enrollment reused; no Runtime API key parameter/state was added to the wizard.
- Local WAITING_APP_ID continuation because OpenAI app registration/Scan Tools is a platform step.
- Device Plugin builders for Windows/Linux and dependency-free Node packager.
- Stable per-machine/per-profile identity -> unique plugin name/display name/icon/logo.
- Exact App ID binding in root plugin.json + .app.json + native .codex-plugin/plugin.json.
- Generated Plugin secret-shape guard and provenance file.
- Work Plugin legacy installers now verify native app binding too.
- Immutable release assets 15 -> 19, including stable latest aliases for Windows/Linux Setup.
- CHANGELOG 0.9.11-0.9.23 projection repaired from release evidence.

**Local V&V:** targeted 7/7 PASS; real Windows device ZIP smoke PASS; shell syntax PASS; Windows wizard machine smoke PASS; complete v0.10.0 local final gate PASS; full suite 490 pass / 0 fail / 6 skip; security audit PASS; diff check PASS. Final gate log SHA-256 8ede55b433ed03a64f4d6dc536f5daf49fcc053aad4db4613e544e1fe134045a.

**Linux hygiene delta:** orphan nested old app/ checkout backed up (archive SHA-256 b21d02f646dda980aa65e2cec1dc39898170c1d28517e12a10536b52c71a0c73, 30153972 bytes), then removed after proving no live references. Outer v0.9.23 service/health remained PASS.

**Current gate:** LOCAL PASS. Next authority gates are exact-tree Linux qualification + release asset build, hosted CI/server canaries, immutable v0.10.0 publication, published asset verification, and candidate-first Windows/Linux live rollout/readback.

**Separate owner gate:** Windows pre-logon BootRecovery SYSTEM tasks still require one elevated owner run; no privilege bypass is permitted.

## FINAL accepted state — 2026-09-29 — v0.10.0

**Status:** PRODUCT FINAL PASS.

**Authority:** immutable v0.10.0 release, exact merge commit 26b8df90838f449bc61710981fc31b7a467e021d; hosted CI/canaries; live route/readiness evidence on audited Windows and Linux systems.

**Completed roadmap:**
1. Cross-platform runtime + Power/Standard authority — PASS.
2. Persistent Secure MCP Tunnel + supervision — PASS.
3. Candidate-first/rollback-aware update + schema continuity — PASS.
4. Durable long work / retries / crash recovery / completion delivery — PASS.
5. Browser/GUI zero-interference default + explicit owner takeover — PASS.
6. Multi-profile / multi-account isolation — PASS.
7. External Skill routing boundary — PASS.
8. Fresh server install canaries — PASS.
9. Application-like Windows/Linux setup bundles — PASS.
10. Device-specific app-bound Plugin ZIP generator with distinct identity/icons and secret exclusion — PASS.
11. Immutable release packaging/checksums — PASS.
12. Exact live rollout to Windows default + saeed-emad and Linux default — PASS.
13. Project Brain / knowledge / changelog projection — PASS after this final seal.

**Live Windows:** v0.10.0 exact commit on default and saeed-emad; previous=null; tunnels ready; updater durable result PROMOTED; post-rollout concurrency idle.

**Live Linux:** v0.10.0 exact commit on default; previous=null; service active; tunnel ready; post-rollout concurrency idle; updater gates/cutover recorded.

**Open external gates only:**
- WAITING_APP_ID for a machine-specific Plugin ZIP when the registered ChatGPT App ID has not yet been supplied by the ChatGPT surface.
- elevated Windows owner action for optional pre-logon SYSTEM BootRecovery tasks.

These open items are intentionally not auto-promoted or guessed and do not block the v0.10.0 product release.


## Windows BootRecovery owner gate — CLOSED — 2026-09-29

**Previous state:** v0.10.0 product/runtime FINAL PASS, but SYSTEM BootRecovery/UserSessionHandoff task installation required explicit elevated owner approval.

**Current delta:** explicit approval received; official setup executed under UAC elevation; transient first SYSTEM probe timeout was audited rather than blindly retried. Exact production-equivalent SYSTEM probe passed in 1.303 s with both LocalMachine tunnel credentials ready. Official setup was then rerun and returned PASS.

**Accepted poststate:**
- BootRecovery task: Ready / SYSTEM / Highest / ServiceAccount / enabled BootTrigger.
- UserSessionHandoff task: Ready / SYSTEM / Highest / ServiceAccount / enabled user LogonTrigger.
- Handoff functional run: PASS, current LastTaskResult=0.
- MCP v0.10.0 and both Windows tunnels remained ready after handoff validation.
- logon autostart present.
- rebootPerformed=false.

**Verification vs validation:** task registration, SYSTEM credential/readiness path and Handoff execution are VERIFIED/PASS. A real machine restart/power-return cycle was not performed and therefore real AtStartup behavior remains UNVALIDATED in this change set.

**Exact next action:** none for installation. Optional future validation is one controlled real reboot/power-return test when the owner explicitly authorizes it.


## Pre-important-task control state — 2026-09-29

**CURRENT:** freeze product expansion; preserve the qualified v0.10.0 live baseline while the owner performs an important task.

**Windows readiness:** PASS — exact release route, doctor, both tunnels, logon/startup recovery configuration, security audit, GUI contract/live backend and native background browser have current evidence. Runtime is idle (0 active operations / 0 queued / 0 path locks).

**Linux readiness:** core PASS — exact release route, doctor, systemd+linger persistence, tunnel, DB integrity, security audit and GUI/browser contracts have current evidence. Runtime is idle. Native browser execution is DEFERRED because Firefox lacks geckodriver and no clean low-risk provisioning path is currently authorized.

**Do not clean historical durable state now.** Windows scheduler counters (805 pending / 81 interrupted / 109 reconciliation-required; delivery 616 completed-undelivered) and Linux counters (105 / 4 / 5; delivery 39) are observability/lifecycle debt, not evidence of an active stuck queue: active operations, queued operations, leases, dead letters and unfinished requests do not indicate current execution blockage. Ownership/classification must precede cleanup.

**Deferred after important task:** durable-state hygiene; Linux autonomy parity decision; v0.10.1 diagnostics reconciliation; fleet view; sandbox; trusted Linux browser dependency; later platform/enterprise expansion.

**Validation boundary:** a real Windows AtStartup/power-return event remains unvalidated because no reboot/shutdown/logoff was performed.

**Exact next action:** no Commander mutation. Start the owner's important task on the stable v0.10.0 baseline.

## Change Set — 2026-09-29 — v0.10.1 maintenance finalization

**One main objective:** finalize the existing Commander product by improving diagnostics, status semantics and CI determinism without widening authority.

**Local V&V:** focused 44/44 PASS; async inherited-stdio stress 10/10 PASS; full test 493/0/6 skip; security audit PASS; diff check PASS. Final gate log SHA-256: 50e3bc6acf589884de2d369022e0cb6da89da32f826a4d521a411e501666eee3.

**No scope expansion:** no new permission, no Linux runner enablement, no historical-state deletion, no reboot, no tunnel/routing policy change, no GUI/browser authority change.

**Current gate:** LOCAL PASS. Next: immutable candidate commit -> clean Linux exact-tree -> hosted CI/server canaries -> release assets/tag -> candidate-first live rollout/readback.

**Deferred/not blockers for v0.10.1:** real reboot/power-return validation; evidence-preserving historical state reconciliation/archive; trusted Linux native-browser provisioning; fleet view; sandbox/least-privilege; macOS; enterprise RBAC; Game Agent.


## v0.10.1 release/live control state — 2026-09-29

**Release authority:** `v0.10.1` / main `b65c48ff8c2fdacd6fbfe0efef4d90742a9e791c`.

**Publication/V&V PASS:** hosted Windows+Ubuntu CI PASS; Windows+clean-Linux server canaries PASS; immutable release published; tag peels to exact main commit; all published payload asset checksums verified.

**Windows core PASS:** canonical control and both routed profiles are exact v0.10.1; previous=null; both tunnels ready; doctor PASS; no active operation/queue/path lock/root lease.

**Linux core PASS after narrow repair:** routed runtime was already v0.10.1 but canonical control checkout was stale at v0.10.0. Official candidate-first updater was rerun in retained terminal, passed check/test/audit/hardware/schema gates, promoted canonical control to exact v0.10.1 and returned AUTO_UPDATE_PASS. Postrepair doctor/service/tunnel/readback PASS.

**Remaining blocker:** desired Windows SYSTEM BootRecovery and UserSessionHandoff scheduled tasks are absent. Cause of disappearance is UNVERIFIED; no updater unregister path was found. Official elevated repair was attempted, but the UAC prompt was canceled by the user. Issue #69 tracks prevention/guard work.

**Do not claim full live-final recovery configuration until task repair evidence exists.**

**Exact next action:** owner accepts UAC for the already-authorized `enable-boot-recovery.ps1 -NoStart`; verify both SYSTEM tasks, run one controlled Handoff test, then close #69. Real reboot/power-return validation remains #66.


## 2026-09-30 — retained-backend maintenance change set

- **ONE mutation objective:** make Windows already-current updater maintenance reconcile retained backends before drain/release cleanup.
- Live v0.10.1 runtime is healthy; this is lifecycle/storage correctness, not an active routing/runtime failure.
- Three dead retained entries are currently removable by the existing safe reconciler; one v0.9.10 entry is still protected by live terminal PID 44432 and must remain.
- Patch: insert `Complete-RetainedBackends` in the CURRENT fast path before `Complete-DeferredDrains` and `Cleanup-Releases`; add ordering regression guards.
- Focused updater/retained tests: 15 PASS / 0 FAIL; diff check PASS.
- Current gate: FOCUSED PASS / FULL REGRESSION OPEN.


## 2026-09-30 — retained-maintenance local PASS

- Focused updater/retained tests: 15/0.
- Full local `check + test + audit`: PASS; full test 493/0/6 skips; security audit PASS.
- Current status: LOCAL PASS / HOSTED GATES OPEN.
- Exact next action: commit/push this change set, require fresh hosted CI/server canaries, then merge. Do not manually clean live retained registry before authoritative code is merged.


## 2026-09-30 — retained maintenance evidence refresh

- Current read-only liveness check supersedes the earlier snapshot: all four registered retained terminal PID sets are now dead and none of the retained ports is listening.
- The existing v0.10.2 retained-maintenance code change remains the minimum sufficient correction: call the already-qualified safe reconciler in the CURRENT fast path before deferred-drain/release cleanup.
- Live registry is intentionally unchanged until this exact branch passes fresh local/hosted authority gates and is merged/released.


### 2026-10-06 — v0.10.17 diagnostics finalization candidate

**Previous accepted state:** immutable v0.10.16 release at 46655c5ae7d5504956959dfc7f2126fcc6824b6a. One unattended Windows exact-release qualification failure retained lifecycle metadata but not child stdout/stderr.

**Current delta:** candidate v0.10.17 contains the qualified diagnostics tree from PR #134 while preserving Job Object containment, timeout, cleanup, backoff and fail-closed exit semantics. Release identity advances without modifying the immutable v0.10.16 tag.

**Historical failure audit:** three attempts of the superseded local release runner incorrectly required a cherry-picked commit SHA to equal the source commit SHA. Git records a new commit for a cherry-pick; content equivalence is therefore guarded by exact tree identity. The superseded runner is DO NOT RUN.

**Current gate:** focused local qualification open; no tag or live runtime mutation has occurred.

**Exact next action:** qualify this exact candidate on Windows/Linux and hosted gates, merge only if green, then tag/publish v0.10.17 and perform candidate-first fleet rollout/readback.


### 2026-10-07 — stable Browser dependency admitted for v0.10.17

Remote Commander Browser v0.8.0 is published non-draft/non-prerelease and immutable. Stable tag peels to Browser merge commit `239a171eebb0f673f3bd57f59de80cf9229b3df6` with qualified tree `a203fbe8b0d3809de21c6647138dc5fbeca3ed98`. Official Setup asset is `Remote-Commander-Browser-Setup-v0.8.0.exe` size 136253241 bytes, SHA-256 `61fd810130845815dd20073f72051aec3b42c1a89b9577b3457f2190bd9b1a5e`. Commander v0.10.17 now pins that exact stable dependency. No user Browser profile/session authority changes.

**Current gate:** real dependency download/hash + bundled Setup compile, then fresh exact-head hosted/cross-host qualification.
### 2026-10-07 — deterministic conversation handoff test closure

**Failure:** push-CI run `37533283937` failed only `conversation-continuation.test.mjs` while Windows Job Object/output-retention tests and Ubuntu CI passed. The acknowledged-handoff fixture polled for only 1500 ms and asserted false after hosted scheduler delay; production controller already exposes its serialized `drainPromise`.

**Root cause / prevention:** stale test polling was replaced by `await controller.drain()` before deterministic state assertions. Production `src/conversation-continuation.mjs` remained byte-identical, SHA-256 `FC2472B024A73AA86655ECF03FD6A9C17C0F7323B946C126C45B00489F0715A3`; no delivery timeout, retry, acknowledgement or runtime behavior changed.

**V&V:** patched test SHA-256 `A7BABA1732CF0A46CD9E4AD134F2AE223699E37B7CB1A62317B1CFAE203BADEA`; 10 independent executions passed 8/8 tests each, zero failures. Stable Browser v0.8.0 dependency bundling is independently PASS on exact parent `a58e2ff` with official Browser Setup SHA-256 `61fd810130845815dd20073f72051aec3b42c1a89b9577b3457f2190bd9b1a5e`.

**Current gate:** commit this harness-only closure and run full exact-head qualification plus fresh hosted CI/Release Sync/Server Canary before merge/tag.
