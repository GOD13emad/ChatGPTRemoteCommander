# Current project state

Updated: 2026-09-28. Scope: public product/release closure for Remote Commander v0.9.19.

## FINAL accepted release state

- **Accepted release:** v0.9.19.
- **Authoritative main/tag commit:** `e04cff5a4985f905afe08a6b4a791baadc54bc46`; `origin/main` and `v0.9.19^{commit}` resolve to the same commit.
- **Immutable release:** published, non-draft/non-prerelease, 15 assets, 14 payload checksum entries verified, stable latest `plugin-template.zip` verified against the published SHA-256.
- **Qualification:** exact-SHA Windows local PASS; clean Linux exact-SHA PASS including release-asset build/checksums; hosted Windows + Ubuntu CI PASS; security audit PASS.
- **Live rollout:** Windows default, Windows `saeed-emad`, Linux, and audited HPC Windows routes all serve v0.9.19 / commit `e04cff5a4985f905afe08a6b4a791baadc54bc46`; each active route has `previous=null`.
- **Background/headless invariant:** audited runtime and qualification PowerShell child-launch paths use hidden/no-window semantics. Visible console/terminal windows are not an accepted progress surface; only task UI or explicit official UI/progress surfaces may be foregrounded.
- **Official external Skill set:** `ansys-modeling` v1.1.1, `comsol-modeling` v1.1.1, `project-execution-brain` v1.0.0, `final-thesis-report` v1.0.0. Their SKILL.md hashes are identical across Windows/Linux/HPC. The owner-private `video-trend` remains intentionally outside the official rollout.
- **Live routing canaries:** COMSOL request -> COMSOL only; ANSYS audit/continue request -> ANSYS + Project Execution Brain; Persian final-thesis request -> Final Thesis Report only. All three patterns PASS on Windows, Linux, and HPC with empty diagnostics.
- **Agent-extension boundary:** domain Skills remain independently installed under external extension roots; Commander installer/release assets do not bundle them.
- **HPC rollout incident:** first v0.9.19 candidate promotion failed closed before cutover; the same candidate then passed an independent host-local `npm run check` diagnostic with zero failures, followed by one controlled retry that promoted successfully. Final authoritative live state is v0.9.19.
- **GitHub hygiene:** obsolete PR #39 (v0.9.16-only post-release docs) was closed as superseded rather than rebased/merged. The stale Dependabot deltas were reconciled onto the current closure branch using exact checkout v7.0.1/setup-node v7.0.0 pins and hosted PR #43 Windows/Ubuntu CI passed. The legacy draft branch is not a v0.9.19 release blocker.

## Current blockers

**None for the v0.9.19 product/release scope.**

Historical `CURRENT`, `OPEN`, and `UNPROVEN` labels below are append-only historical checkpoints and are superseded by this accepted state unless explicitly repeated in the current sections above.

## Deferred / external validation

- A clean disposable **Windows Server** VM was not available on the current hosts. The server bootstrap is accepted from static/cross-platform gates, release packaging, and live update/use on the audited HPC Windows target. A truly fresh Windows Server prerequisite-install canary remains an **EXTERNAL/DEFERRED environment validation**, not a blocker for v0.9.19.
- Windows Sandbox supplementary canary: Sandbox ran elevated and independent HTTPS HEAD probes to the PowerShell, Node.js, and Git-for-Windows endpoints all returned HTTP 200. Two full bootstrap attempts stalled at the first PowerShell MSI GET with no subsequent log transition; the Sandbox was terminated to avoid a hung validation. This is classified EXTERNAL/ENVIRONMENT-BLOCKED, not a Commander product failure, and is not treated as equivalent to a clean Windows Server canary.
- Broad claims such as universal superiority over all competing agents, equal-budget benchmark dominance, additional provider integrations, or control of ChatGPT host/UI stream failures remain outside the bounded release DoD and are not claimed.
- Linux durable workflow storage contains independent historical/active project records. Its database integrity is `ok`, automatic execution is disabled, and current leases are zero. Those project records are not Commander-release backlog and are not mass-cancelled by this release closure.

## Exact next action

No release-critical action remains. Future work begins only from a new scoped objective or from evidence of a new regression.

## Remaining roadmap

Broader blocker escalation, monetary accounting, additional providers/integrations and equal-model/equal-budget project benchmarks remain open. The complete ambition of a universally superior project agent is **UNPROVEN**. A configured provider and explicit project enrollment are required for model-driven execution. Installation, service health, account authentication and task acceptance are separate checks. The release does not establish an OS sandbox or new autonomous browser authority.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.9.3 candidate](RELEASE_0.9.3.md), [v0.9.1 published baseline](RELEASE_0.9.1.md), [v0.9.2 historical candidate](RELEASE_0.9.2.md), [v0.9.0 published](RELEASE_0.9.0.md), [v0.8.42 historical published baseline](RELEASE_0.8.42.md), [v0.8.40 historical candidate](RELEASE_0.8.40.md), [v0.8.39 historical candidate](RELEASE_0.8.39.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md).

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
