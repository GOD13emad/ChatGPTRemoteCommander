# ChatGPT Remote Commander — Project Knowledge / Evidence Record

Record revision: R1
Status: CURRENT
Date: 2026-09-20
This file is append-only for substantive project claims, decisions, failures, prevention controls and reusable evidence.

## E001 — Security history false positive

- Context: v0.8.3 release-candidate security audit.
- Claim/Decision: A case-insensitive tunnel-ID regex falsely classified the uppercase status symbol TUNNEL_HEALTH_UNKNOWN_LISTENER in reachable Git history as a credential-shaped tunnel identifier.
- Evidence/Source: test/security-audit.mjs, SECURITY_AUDIT.md, Git history scan.
- Resolution: Restrict the detector to the canonical lowercase tunnel_ prefix and add a regression proving lowercase tunnel-shaped values match while uppercase status/error symbols do not.
- Status/Confidence: Confirmed / high.
- Reuse targets: security audit design, release checklist, incident/failure history.

## E002 — v0.8.3 duplicate profile discovery

- Context: candidate-only updater run; no cutover had occurred.
- Claim/Decision: Get-Targets recursively enumerated every instance.json below the instances root. Historical saeed-emad backup records were therefore treated as live targets, producing repeated saeed-emad candidates and eventually CANDIDATE_CLEANUP_OWNERSHIP_MISMATCH.
- Evidence/Source: failed v0.8.3 last-update state showed one default plus repeated saeed-emad candidates; source inspection showed recursive instance.json discovery.
- Root Cause -> Prevention -> Guard -> Regression: recursive backup discovery -> immediate profile-directory enumeration only -> PROFILE_DIRECTORY_MISMATCH fail-closed identity guard -> test/auto-update-contract.test.mjs forbids recursive instance discovery.
- Result: Fixed in v0.8.4.
- Status/Confidence: Confirmed / high.
- Provenance: release commit 4fdfd76143fb3a3ac4d54709223599a613cc3c06; auto-update-windows.ps1; test/auto-update-contract.test.mjs.

## E003 — GUI gate contention

- Context: a v0.8.4 native GUI gate returned GUI_NATIVE_BUSY.
- Claim/Decision: The native helper uses the named mutex Local\ChatGPTRemoteCommander.GuiInput; the failure occurred at session-begin/status admission before test GUI mutation. A controlled run on the same staged release with no competing GUI helper then passed complete native E2E.
- Evidence/Source: %LOCALAPPDATA%\ChatGPTRemoteCommander\v084-staged-gui-1.log; tools/gui-control.ps1; src/gui-tools-windows.mjs; controlled pass log %LOCALAPPDATA%\ChatGPTRemoteCommander\v084-gui-controlled2.log.
- Decision: Keep fail-closed semantics. Do not add blind input retries; scheduled update attempts can try again later when the GUI mutex is free.
- Status/Confidence: Confirmed contention; exact competing requester not retained / high for mechanism, probable for external concurrency source.
- Controlled-pass log SHA-256: 93963aaa42a73e740e0c5638e2110b85fd435a72a329563c405af3bff3074eb2.

## E004 — Clean v0.8.4 artifact verification

- Context: detached clean worktree at exact release commit.
- Claim/Decision: Release code passed check, full tests, security audit and Windows native GUI E2E.
- Evidence/Source:
  - v084-check.log SHA-256 cc53f150b470563eaadf2e1943de213d6cad3a436f4e202858967d2117123bdf
  - v084-test.log SHA-256 ce484ad8239f5ddf5ea9a2a876fcc409a2727d3d51918e65ee3d6c5b59a0746a
  - v084-audit.log SHA-256 be855fdff91eed87e2ecb46be9c27b860b67734a72321e43b3e7907c5285da2d
  - v084-gui.log SHA-256 aaac22e95c2d169bfbeec3bbf4b96dcf2d8248bdb55e076986c735bd9b84b5b5
- Native GUI proof: real window focus, mouse click, Farsi/Japanese Unicode typing marker GUI_E2E_PASS_سلام_日本語_123, button activation, changed screenshot hash, cursor restore and foreground restore.
- Status/Confidence: Confirmed / high.
- Reuse targets: release acceptance, Windows compatibility evidence.

## E005 — Candidate-only validation

- Context: v0.8.4 updater with NoPromote, Force, PowerMode and GuiControl.
- Claim/Decision: Exactly two targets were discovered: default and saeed-emad. Both passed hardware, doctor, shadow workflow store and live-store compatibility gates. Candidate processes were ownership-verified and stopped before cutover.
- Evidence/Source: candidate milestone state reported CANDIDATE_PASS, commit 4fdfd76143fb3a3ac4d54709223599a613cc3c06, candidate ports 48831 and 48832.
- Status/Confidence: Confirmed / high.
- Reuse targets: updater regression and release promotion gate.

## E006 — Production promotion

- Context: v0.8.4 blue/green promotion on the validated Windows target.
- Claim/Decision: Both profiles were promoted only after gates and canonical verification. The cutover committed, previous direct backends were drained, workflow schema finalized and supervisor recycled successfully.
- Evidence/Source: %LOCALAPPDATA%\ChatGPTRemoteCommander\update-logs\auto-update.log contains SUPERVISOR_RECYCLE_PASS and AUTO_UPDATE_PASS version=0.8.4 commit=4fdfd76143fb3a3ac4d54709223599a613cc3c06.
- Promotion-log SHA-256 after final checks: e2ee66cde63e30e5804be389168edc557b8208910bc564daf8973ee12259a011.
- Promotion-state evidence: the immediately post-promotion last-update.json had SHA-256 0e5eace93bc7342f74b06e5100f50d550f1f659e5209a5510a48a0bc4ec9a233 and status PROMOTED.
- Status/Confidence: Confirmed / high.

## E007 — Post-promotion runtime validation

- Context: independent checks after connector continuity was restored through the new route.
- Claim/Decision: Both canonical routers pass doctor for version 0.8.4, device the validated Windows target, exact config hashes and tool catalogs (54 tools / 15 GUI tools).
- Default config SHA-256: c55e596e4e2891c1cee17613472f2c5e98c0707d1b3b7d5efdb0806dbbf44de9.
- saeed-emad config SHA-256: 7d9d201378e42bb45a2a8d32a6a23f0b6dbf67a516458face284ba2232f2f22d.
- Route file SHA-256: default 973bedd39405f9ca23ac3964ca3551394bb0277096a44c65f8c39afd23a1795f; saeed-emad 8510c30e4a5b414bb227235bb65897e7ea9446380f51e5d3dddbd8ca664b8765.
- Workflow health: both ok=true, schema/database version 2, integrity ok, scheduler and automatic continuation enabled.
- Authority: both Capability Profiles are FULL_POWER, explicitly authorized, persist across updates, auto-enable new capabilities, and have no disabled capabilities.
- Tunnel routing: YAML targets are 47831 for default and 47834 for saeed-emad; tunnel-client processes remain running.
- Cleanup: only v0.8.4-4fdfd76143fb remains under the release directory.
- Status/Confidence: Confirmed / high.

## E008 — Automatic-update idempotency

- Context: updater invoked after successful promotion with no new release.
- Claim/Decision: The updater fetched v0.8.4, matched the active route and installed control commit, returned AUTO_UPDATE_CURRENT version=0.8.4, and did not rebuild or cut over another candidate.
- Current last-update SHA-256: 681d771bfaddcc76f747cfddd1a786f127f2e14450fbbb31ec80fa041741a5cc.
- Status/Confidence: Confirmed / high.
- Reuse targets: automatic-update operational acceptance.

## E009 — Workspace hygiene boundary

- Context: source working directory contains many unrelated untracked engineering/GCAD helper files.
- Claim/Decision: These files are not authoritative Remote Commander source and were not included in the release because validation and packaging used a separate clean detached worktree. They were intentionally left untouched to avoid cross-project data loss.
- Status/Confidence: Confirmed / high.
- Reuse targets: future repository cleanup/handoff.
- Action: Deferred; requires separate ownership decision.

## E010 — Release authority

- Claim/Decision: Git tag v0.8.4, origin/main at release time, and the installed control checkout all resolved to 4fdfd76143fb3a3ac4d54709223599a613cc3c06. GitHub Release v0.8.4 was published as Latest with installer assets, stable and versioned plugin ZIPs, icons and SHA256SUMS.txt.
- Status/Confidence: Confirmed / high.
- Reuse targets: distribution, rollback, support and audit.

## HISTORY — append only

- 2026-09-20 / R1: Created cumulative evidence record for v0.8.4 finalization and promotion.


## E011 — Hidden Linux release-gate defect found after v0.8.4

- Context: GitHub Actions appeared red, but GitHub annotations showed hosted jobs never started because the account was billing-locked. To separate infrastructure failure from product behavior, the Ubuntu job was reproduced locally on Ubuntu 24.04 with Node 22.
- Finding: v0.8.4 npm run check produced four failures in test/profile-instances.test.mjs. All four used Windows-only fixture paths such as C:\State\... while the production validator correctly required POSIX absolute paths on Linux.
- Root Cause -> Prevention -> Guard -> Regression: OS-specific test fixture -> platform-native fixtureRoot/stateRoot -> production validateLocalAbsolute unchanged -> Windows and Ubuntu/Node22 release gates both exercised.
- Status/Confidence: Confirmed / high.
- Reuse targets: CI portability, Linux auto-update release gating, cross-platform testing.

## E012 — v0.8.5 cross-platform validation

- Release commit: 540d7e596686406e102e4a835c9ad4d7745cef5c.
- Windows clean detached-worktree evidence:
  - v085-clean-check.log SHA-256 24b73bdf47934dacefe67320ccc06e3fababf3e4ccfdae37ac4476001a000098
  - v085-clean-test.log SHA-256 a4c1fe62e105b24f96c648b1d6688324eccb3f5e416c1f57ece46fef5a0b9e40
  - v085-clean-audit.log SHA-256 398ca142ee01b4157e76ef9d2aeec4c7c3780f59ba7982e8e2cb3840c036012f
  - v085-clean-gui.log SHA-256 3e1ec7902ac9e01c5c1155adca697bedb3dcbf687a7f3a1a3d94b661bec7a83b
- Ubuntu 24.04 / Node 22 reproduction evidence:
  - check SHA-256 4756be1c37f38d954f26425c8deee0b5d8dff64b9483013a9d138c15d966138a
  - test SHA-256 82bd192d45186e6018db840716b37794b529923911684748e847996477f28b67
  - audit SHA-256 0a9521e03e0436497bca1c2599c36d5d7c9e0ff582be613bfd534b3dee5caa96
- Native Windows GUI proof again passed real focus/click/Farsi-Japanese Unicode typing/screenshot verification and foreground/cursor restoration.
- Status/Confidence: Confirmed / high.

## E013 — v0.8.5 promotion and runtime authority

- GitHub Release v0.8.5 is Latest and tag/main at publication resolved to 540d7e596686406e102e4a835c9ad4d7745cef5c.
- Candidate-only validation returned CANDIDATE_PASS for exactly default and saeed-emad.
- Automatic updater later acquired the single-writer update mutex, independently reran check/test/audit/native-GUI gates, and completed AUTO_UPDATE_PASS version=0.8.5 commit=540d7e596686406e102e4a835c9ad4d7745cef5c.
- Post-promotion auto-update returned CURRENT for v0.8.5.
- Active routes are generation 2:
  - default canonical 47831 -> backend 48833; config SHA-256 464806e6775e01c2ac95240d9b2a26d9cc5c4638c7caeacc37a730259d1b7f73.
  - saeed-emad canonical 47834 -> backend 48834; config SHA-256 438453876b955316a7498e3312f66b515e7e8541bbdd8722986d900dcc4604db.
- Both canonical endpoints pass doctor with 54 tools / 15 GUI tools; both workflow databases report schema 2, integrity ok, scheduler and automatic continuation enabled, and FULL_POWER authority with all 22 current capabilities.
- Only release directory v0.8.5-540d7e596686 remains after cleanup.
- Update-log SHA-256 after promotion/current checks: 86f62e09f445c6d72d0ef1a9332ed7306719a00d1957fece302aed40bcf0fb28.
- Status/Confidence: Confirmed / high.

## E014 — GitHub-hosted CI external gate

- GitHub Actions runs for v0.8.5 are marked failure, but both check-run annotations state: "The job was not started because your account is locked due to a billing issue."
- The API reports no runner execution and zero workflow steps for the affected jobs.
- Decision: Do not disable or weaken CI to manufacture green status. Keep this as an external owner gate.
- Local equivalent Ubuntu/Node22 check/test/audit gates are PASS, but hosted CI remains UNPROVEN until the account billing lock is resolved and the workflow is rerun.
- Status/Confidence: Confirmed external blocker / high.
- Exact owner next action: resolve the GitHub billing lock, then rerun the existing CI workflow without product-code changes unless a runner subsequently reveals a real test failure.

## HISTORY — R2 delta

- 2026-09-20 / R2: Added Linux CI reproduction, cross-platform fixture root cause/prevention, v0.8.5 validation/promotion evidence, and explicit GitHub billing-blocked hosted-CI status.

## E015 — GitHub Free account billing-lock root cause and escalation

- Context: Hosted CI remained red even though repository Actions settings were enabled, the repository is public, and local Windows/Linux release gates were PASS.
- Account/billing facts observed in the signed-in GitHub Billing UI:
  - GitHub plan: Free, USD 0.00/month.
  - Copilot plan: Free, USD 0.00/month.
  - Billing Overview: zero observed usage for the inspected period.
  - Payment History: no payments.
  - Payment Information: "Invalid payment method - authorization hold failed."
  - No saved payment method with an Edit/Remove control was observed.
- CI regression evidence: hosted run 35504469498 attempt 3, after dismissing the payment alert, again completed both Windows and Ubuntu jobs with zero workflow steps. Both jobs retained the account-level billing-lock annotation.
- Root-cause classification: server-side stale failed payment-authorization/account-lock state on an already-Free account; not a Remote Commander defect, not a workflow syntax/configuration defect, and not a paid-plan requirement for this public repository.
- GitHub Support's guided solution independently stated that restoring Actions on the free account requires clearing the billing lock tied to failed payment authorization.
- Resolution action: submitted an official GitHub Support ticket under Billing and payments -> General billing and payments, classified as Payment method authorization and GitHub Actions or Packages. Submission success was verified and the ticket is open.
- Privacy/provenance: the private ticket identifier and URL are intentionally not committed to this public repository. They are stored in %LOCALAPPDATA%\ChatGPTRemoteCommander\private-evidence\github-billing-support-ticket.json, SHA-256 6b21efb925486ce78f5c419496609b8c9634c65d264c9c0be9cdbb92d30c848e.
- Prevention/guard: do not add a payment method, activate a paid plan, weaken CI, or repeat blind reruns merely to obtain a green status. Await GitHub Support's server-side clear, then rerun hosted CI once and inspect real executed steps.
- Status/Confidence: Confirmed external blocker / high; remediation submitted / pending GitHub Support.
- Reuse targets: CI incident history, billing troubleshooting, support handoff, release acceptance.

## HISTORY — R3 delta

- 2026-09-20 / R3: Confirmed the account is already GitHub Free/Copilot Free with no payment history, isolated the stale authorization-hold lock, proved it survives a third zero-step hosted CI attempt, and submitted the official support escalation while keeping the account free.

## E016 — Full live-system deep audit of v0.8.5

- Date/Context: 2026-09-20, full read-only audit of source authority, installed runtime, both profiles, updater/supervisor, tunnels, durable workflows, release artifacts, CI state and support state.
- Current source authority: `main` and `origin/main` resolved to 12f686544243d2000b5e520d56177572a856b1ef; tracked working tree was clean. The large unrelated untracked GCAD/engineering scratch set remains outside Remote Commander release authority and was intentionally not deleted.
- Runtime authority: installed app remains detached at release commit 540d7e596686406e102e4a835c9ad4d7745cef5c; only release directory `v0.8.5-540d7e596686` is active.
- Both canonical doctors PASS:
  - default 47831 -> 48833: v0.8.5, expected device match, 54 tools / 15 GUI tools, FULL_POWER, no doctor warning.
  - saeed-emad 47834 -> 48834: v0.8.5, expected device match, 54 tools / 15 GUI tools, FULL_POWER, no doctor warning.
- Current tunnel readiness: health ports 47832 and 47833 both returned HTTP 200 `ready`.
- Current updater state: `CURRENT` for v0.8.5; repeated 15-minute supervisor checks continue to return `AUTO_UPDATE_CURRENT` without unnecessary promotion.
- Current regression rerun:
  - `npm run check`: PASS.
  - `npm test`: PASS.
  - project security audit: `SECURITY_AUDIT_PASS`.
  - native Windows GUI E2E: PASS with real focus/click/Farsi+Japanese Unicode typing/button activation/screenshot change and successful cursor/foreground restoration.
  - `git fsck --full --no-reflogs`: exit 0; only unreachable dangling objects were reported, not repository corruption.
- `npm audit --audit-level=high --omit=dev` could not run because no `package-lock.json` exists (`ENOLOCK`). Current package.json has no declared dependency fields; therefore this is recorded as NOT APPLICABLE/UNPROVEN through npm audit, not as a vulnerability PASS.
- Tunnel log observations: the default tunnel recovered from transient Cloudflare/control-plane HTTP 502 responses; saeed-emad logged a startup OAuth-discovery metadata warning. Current readiness is PASS for both, so these are non-blocking observations rather than active failures.
- GitHub Support billing ticket remains Open; no staff reply was visible during this audit. Hosted Actions remains an external blocker and current jobs still execute zero repository steps when the account lock is applied.
- Provenance: `%LOCALAPPDATA%\ChatGPTRemoteCommander\audit\REMOTE_COMMANDER_DEEP_AUDIT_20260920.json`, SHA-256 `8c7943b53fdc5beeb808361b8f6b17196e57e1c5b90b9c4a1e7d14b097b76cbe`.
- Status/Confidence: Confirmed / high for current local runtime and release-artifact state; hosted CI remains externally blocked.
- Reuse targets: release acceptance, incident response, future hardening, account transfer, support handoff.

## E017 — Release and CI supply-chain hardening audit

- Release asset integrity: all 11 downloaded non-checksum assets of GitHub Release v0.8.5 matched `SHA256SUMS.txt` exactly. Present artifact integrity is Confirmed.
- GitHub Release API reports v0.8.5 `isImmutable=false`; repository immutable-release policy reports `enabled=false`. This contradicts the literal DoD requirement for an immutable stable release.
- `git verify-tag v0.8.5` reports `no signature found`. The annotated tag itself dereferences correctly to accepted release commit 540d7e596686406e102e4a835c9ad4d7745cef5c. Classification: authenticity hardening gap, not evidence of tampering.
- `.github/workflows/ci.yml` currently references `actions/checkout@v4` and `actions/setup-node@v4`, not full commit SHAs, and does not declare an explicit top-level/job `permissions` policy.
- Method evidence:
  - GitHub Docs, `Preventing changes to your releases`: enabling release immutability prevents changes but applies only to future releases.
  - GitHub Docs, `Immutable releases`: immutable releases lock associated tags/assets and generate release attestation; recommended publication flow is draft -> attach all assets -> publish.
  - GitHub Docs, `Secure use reference`: full-length commit SHA is the immutable way to reference an action; grant the GITHUB_TOKEN minimum required permissions.
  - GitHub Docs, `Managing GitHub Actions settings for a repository`: repositories can require full-length SHA pinning.
- Decision: do not rewrite or republish v0.8.5 merely to manufacture compliance while hosted CI is externally blocked. Use a separate future hardening change set, then publish the next release under immutable-release policy after hosted CI is restored.
- Status/Confidence: Confirmed hardening/DoD gap / high.
- Reuse targets: next release architecture, CI security, supply-chain policy, release DoD.

## E018 — Durable Remote Commander workflow authority reconciliation

- Prestate: `remote-commander-primary` and `remote-commander-saeed-profile` were healthy but their durable checkpoints still stated v0.7.3 as the current published/runtime authority. This was stale project-memory state, not a runtime defect.
- Mutation objective: reconcile only the two Remote Commander workflow checkpoints to current v0.8.5 evidence. The unrelated `thesis_s3_r257` workflow was explicitly not changed.
- Poststate: both Remote Commander workflows checkpointed current v0.8.5 evidence and then were explicitly paused. Both now report revision 4, lifecycle `WAITING`, schedulerEnabled=false in `workflow_list`; default scheduler pending count fell to 1 (the untouched thesis workflow) and saeed-emad pending count fell to 0. Their next action points to the external billing gate and a separate future supply-chain hardening change set.
- Workflow databases remain schema 2 / integrity `ok`; the global scheduler engine remains enabled. `runnerConfigured=false` is an intentional design boundary documented/tested by the implementation and is not treated as failure. Audit found a low-severity consistency gap: `workflow_checkpoint` changes the workflow snapshot lifecycle to `WAITING` but does not update the `scheduler_jobs.lifecycle` row, so `workflow_get` and `workflow_list` can disagree until `workflow_control`/another lifecycle transition synchronizes the scheduler row. Live Remote Commander records are synchronized now; a future regression fix should make checkpoint update both representations atomically.
- Additional audit observation: root `PROJECT_BRAIN.md` is an untracked legacy/workflow mirror whose historical narrative still contains v0.7.3 statements even though generated workflow sections are current. It is therefore STALE as authority. `docs/PROJECT_CONTROL_STATE.md` remains the authoritative Project Brain.
- Status/Confidence: Reconciliation PASS / high; legacy mirror hygiene remains deferred.
- Prevention: future handoff/audit must resolve authority from the tracked Project Brain first and must not treat the untracked legacy workflow mirror as authoritative.

## HISTORY — R4 delta

- 2026-09-20 / R4: Added live v0.8.5 deep-audit evidence, release-asset hash verification, supply-chain/immutability findings, current tunnel/support observations, and reconciliation of stale Remote Commander durable-workflow checkpoints without touching the thesis workflow.

## E019 — v0.8.6 workflow-consistency and supply-chain release

- Date/Context: 2026-09-20, release change set from v0.8.5 baseline.
- Exact release commit: `1a5c7613252b8f98836bcd26861449a792d4651f`.
- Main code change: `workflow_checkpoint` now updates workflow snapshot lifecycle and the `scheduler_jobs` projection inside the same SQLite transaction, preventing the R4 `workflow_get` / `workflow_list` divergence.
- Regression: targeted workflow/doctor set passed 47/47 after correcting one test-fixture assumption; full Windows check/test/security subsequently PASS.
- CI hardening: GitHub Actions top-level `permissions: contents: read`; checkout pinned to `11d5960a326750d5838078e36cf38b85af677262`; setup-node pinned to `49933ea5288caeca8642d1e84afbd3f7d6820020`.
- No Git signing identity was configured: no `user.signingkey` and no gpg executable were present. Decision: create an annotated unsigned tag rather than inventing an identity/key. GitHub immutable-release integrity is used for this release; signed tag remains separate optional hardening.
- Status/Confidence: Confirmed / high.
- Reuse targets: workflow durability, release policy, next-version regression.

## E020 — v0.8.6 clean cross-platform validation

- Windows detached clean worktree at exact release commit:
  - check log SHA-256 `8cf93819c75627414820155282b4f6ee2883166f5c825cde9305e7536e07a77d`.
  - test log SHA-256 `30618fd98cfba4566c7f6ae14bc2be5e448ef66652910c6ced464e4ca71479af`.
  - security audit log SHA-256 `17181ee897aebe337b4429d0287304eb6545f1235906f2c6a6aa328cef4c62d2`.
  - native GUI E2E log SHA-256 `6e4a96a838b4d07ab48c4330e956340744c39035ee6df4968a0336097388af19`.
- Native GUI proof: real focus/click, marker `GUI_E2E_PASS_سلام_日本語_123`, button activation, changed screenshot hash, cursor restore and foreground restore.
- First clean GUI retry was refused while Windows Secure Desktop/UAC was active. Evidence: `consent.exe` existed in the interactive session and `OpenInputDesktop` failed; after Secure Desktop ended, the same clean artifact passed E2E. This is correct fail-closed behavior, not a release defect.
- Ubuntu 24.04 / Node 22.23.2 cloned the exact public commit and passed `npm run check`, `npm test`, and project security audit.
- Status/Confidence: Confirmed / high.
- Reuse targets: Windows/Linux compatibility, GUI safety, release acceptance.

## E021 — First immutable Remote Commander publication

- Repository immutable-release policy was enabled through GitHub before release creation and read back as enabled.
- v0.8.6 publication followed draft -> attach all assets -> verify -> publish.
- Draft contained 12 assets. Every GitHub-provided SHA-256 digest matched the corresponding local artifact before publication: 12/12 PASS.
- Published release state after publication: `isDraft=false`, `isImmutable=true`, tag `v0.8.6`.
- The tag peels to exact release commit `1a5c7613252b8f98836bcd26861449a792d4651f`; `origin/main` was the same commit at publication.
- Result: the previous R4 immutable-release DoD gap is closed for v0.8.6 and future releases while the repository policy remains enabled.
- Status/Confidence: Confirmed / high.
- Reuse targets: supply-chain DoD, release handbook, distribution.

## E022 — v0.8.6 candidate validation, cutover drain incident and recovery

- Candidate-only updater validation returned `CANDIDATE_PASS` for exactly `default` and `saeed-emad`. Both profiles passed hardware, doctor, shadow workflow-store and live-store compatibility gates.
- Promotion independently reran check/test/security/native-GUI gates and committed both canonical routes to generation 3 / v0.8.6:
  - default 47831 -> 48831, config SHA-256 `c9924cfc7f1edba8decff2709506bb49d7cceb3003675ec32ef791b6cdfe824f`.
  - saeed-emad 47834 -> 48832, config SHA-256 `a3d2f2da1e23e5e97b3047fa91418269f74f2cf98c8d5884bf3753487ee47764`.
- Post-commit drain incident: the old saeed-emad backend on 48834 retained one router-counted in-flight request past the 60-second drain budget, producing `DRAIN_TIMEOUT profile=saeed-emad` and `PROMOTED_MAINTENANCE_REQUIRED` after routes were already committed.
- Evidence distinguishing real connection from counter-only drift: Windows TCP state showed an established loopback connection between router PID and owned old backend 48834, created before cutover; router status showed `inflightByPort.48834=1`.
- The old backend audit showed real activity from another project until seconds before cutover. After timeout, process-tree audit showed no remaining child workload. The old runtime marker exactly matched listener PID 5604, profile `saeed-emad`, port 48834, release v0.8.5 and old project directory.
- Recovery: only that ownership-proven superseded backend was stopped. The listener disappeared and router in-flight map immediately became empty. No unrelated process/workflow was stopped.
- The updater's explicit post-commit maintenance path then finalized workflow schemas (already schema 2), promoted the control checkout, recycled the supervisor, removed the superseded release and reported `AUTO_UPDATE_MAINTENANCE_PASS version=0.8.6` followed by `AUTO_UPDATE_CURRENT version=0.8.6`.
- Final updater evidence:
  - update log SHA-256 `03bad8c8a612a9e0f0e1c64987e0a1592b121eb07c0bef2ccdeb3c6c92f777d6`.
  - last-update CURRENT file SHA-256 `d57c293c60ced69853970102162ae57a432d7efc8d67b5c53688af2215c3aca5`.
- Final runtime: both doctors PASS v0.8.6 / 54 tools / 15 GUI tools; workflow databases schema 2 / integrity ok; both tunnel health ports HTTP 200 ready; app control checkout equals release commit; only release directory `v0.8.6-1a5c7613252b` remains.
- Root-cause status: confirmed long-lived old HTTP request / drain-timeout mechanism; exact higher-level transport method (for example an SSE-style request) was not captured and remains unverified. Do not label it SSE without new evidence.
- Prevention proposal for a later updater change set: make post-cutover drain handling explicitly classify bounded request vs long-lived transport, prove ownership/no child mutation, and transition to maintenance without leaving the control checkout stale. This is not required to reopen immutable v0.8.6 publication.
- Status/Confidence: Promotion and recovery Confirmed / high; exact request type Unverified.
- Reuse targets: updater drain design, zero-downtime semantics, incident regression.

## E023 — v0.8.6 publication closeout and next phase

- Current updater state: CURRENT v0.8.6.
- Current runtime authority: FULL_POWER, 22 granted capabilities, `disabledCapabilities=[]`.
- Current GitHub release: published and immutable.
- Hosted GitHub Actions remains externally blocked by the pre-existing GitHub account billing lock; local/cross-platform validation is independent and PASS.
- Project phase transition: publication/hardening milestone closed; next main objective is GUI read-performance latency. Baseline must be measured before mutation and safety invariants (lease, frame freshness, uncertain-outcome suspension, local stop and no blind retry) must remain intact.
- Status/Confidence: Confirmed / high.

## HISTORY — R5 delta

- 2026-09-20 / R5: Published immutable v0.8.6 from the exact Windows+Ubuntu validated commit, closed workflow scheduler-projection and Actions hardening gaps, promoted both profiles, recovered one ownership-proven post-commit drain timeout through the designed maintenance path, and established GUI read latency as the next phase.


## E024 — GUI read-latency baseline and method choice

- Date/Context: 2026-09-21, v0.8.6 immutable release baseline, start of GUI read-performance phase.
- Measured current one-shot helper latency on the validated Windows target:
  - `status`: median 1775.44 ms, 140 output characters.
  - `listWindows`: median 1804.30 ms, 586 output characters.
  - JPEG screenshot 1000 px / quality 45: median 1691.91 ms, ~41.6k JSON characters.
  - JPEG screenshot 1600 px / quality 70: median 2207.64 ms, ~122.7k JSON characters.
- Warm in-process native baseline after loading GUI assemblies/types once:
  - one-time assembly/type load: 1288.72 ms.
  - warm status median: 19.98 ms.
  - warm window list median: 0.15 ms.
  - warm screenshot 1000/q45 median: 123.44 ms.
  - warm screenshot 1600/q70 median: 127.24 ms.
- Root-cause inference: repeated PowerShell process startup plus repeated `Add-Type` source compilation dominates ordinary GUI read latency; image capture/encode is secondary for the tested sizes. Confidence: high because status has tiny output yet ~1.8 s one-shot latency, while the same native operation is ~20 ms warm.
- Official method evidence:
  - Microsoft PowerShell `Add-Type` documentation states that source-code input is compiled into an in-memory assembly in the PowerShell session; therefore a new session repeats compilation/load work. Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/add-type
  - Microsoft `about_Pwsh` documents that each `pwsh -File` invocation starts a PowerShell session; `-NoProfile` avoids profiles but does not make the process/session persistent. Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh
  - Node.js `child_process.spawn()` officially supports long-running child processes with piped stdin/stdout, which fits a bounded request/response helper without introducing a shell. Source: https://nodejs.org/api/child_process.html
- Method decision: prefer one persistent, lazily-started PowerShell GUI helper per MCP process using newline-delimited JSON over existing stdin/stdout pipes. Keep the current one-shot helper function as a tested fallback/compatibility primitive. Do not weaken the lease, fresh-frame, emergency-stop, global GUI mutex, foreground check, output bounds, timeout, or uncertain-mutation rules.
- Rejected alternatives:
  - reducing screenshot quality/size alone: insufficient, because tiny `status` and `listWindows` calls are already ~1.8 s.
  - removing safety checks: rejected; measured warm native work shows safety-preserving persistence can remove the dominant cost.
  - introducing a new external service/IPC stack: unnecessary complexity; Node child pipes already provide the required bounded local transport.
- Benchmark provenance:
  - `%LOCALAPPDATA%\ChatGPTRemoteCommander\audit\gui-helper-baseline.json` (raw one-shot timings).
  - `%LOCALAPPDATA%\ChatGPTRemoteCommander\audit\gui-warm-native-baseline.ps1` (warm native timing script).
- Status/Confidence: Root cause Confirmed / high; persistent-helper implementation Proposed until regression and live benchmarks PASS.
- Reuse targets: GUI architecture, performance report, updater/release notes, failure-prevention regression.


## E025 — Persistent GUI helper implementation and measured result

- Date/Context: 2026-09-21, GUI latency change set on top of v0.8.6.
- Implementation:
  - added a bounded persistent child-process client in `src/gui-process.mjs`;
  - kept the existing one-shot helper path for compatibility and independent regression;
  - added `-Server` newline-delimited JSON mode to `tools/gui-control.ps1`, loading Windows Forms, Drawing and `gui-native.cs` once per helper lifetime;
  - default Windows GUI controller now lazily reuses one helper per MCP process;
  - request concurrency remains rejected by the controller; the helper client also refuses overlapping direct requests;
  - process start, stdin, stderr, output-size, timeout, malformed-JSON and native-error failures remain fail-closed; timed-out/crashed helpers are restarted only on a later read request, never by blindly replaying a mutation.
- Safety regression: GUI contract/transport suite PASS 68/68, including lease isolation, fresh-frame single use, local stop, uncertain-mutation latch, malformed image rejection, output bounds and persistent-helper timeout/restart behavior.
- Real Windows native E2E PASS with focus, click, multilingual Unicode typing, button activation, screenshot change, cursor restoration and foreground restoration.
- Full project gates after the change: `npm run check` PASS; `npm test` PASS; `SECURITY_AUDIT_PASS`.
- Performance after implementation:
  - first cold status: 963.69 ms versus old one-shot median 1775.44 ms (~45.7% lower latency before warm reuse);
  - warm status median: 16.09 ms, ~110x faster than old median;
  - controller window-list median: 36.76 ms, ~49x faster than old one-shot median;
  - controller screenshot 1000/q45 median: 87.40 ms, ~19x faster than old one-shot median;
  - warm screenshot 1600/q70 median: 83.87 ms, ~26x faster than old one-shot median.
- Provenance/hashes:
  - baseline JSON: `%LOCALAPPDATA%\ChatGPTRemoteCommander\audit\gui-helper-baseline.json`, SHA-256 `3a5b58f432ce2fb68111581e87467f18922e7dc7fe7e3a50c3402b4a86965b9d`;
  - persistent benchmark JSON: `%LOCALAPPDATA%\ChatGPTRemoteCommander\audit\gui-persistent-benchmark.json`, SHA-256 `0133f2f9f21671967728b469d4bccebe4d843912ea1c8bb72fd2c3ebf0337913`;
  - full check log SHA-256 `0687171b8d4db8356d08c0c4ecaaaed802170dfbb7fc5f0df27d62068e4739de`;
  - full test log SHA-256 `90f0853bdb5133bc2be4315bb9d387572ef17adb44c3cf92fe6d28d1a14b146b`;
  - security audit log SHA-256 `17181ee897aebe337b4429d0287304eb6545f1235906f2c6a6aa328cef4c62d2`.
- Status/Confidence: implementation PASS / high on the current Windows source tree; release/promotion still pending.
- Reuse targets: performance claims, release notes, GUI architecture, failure prevention.

## E026 — Post-cutover drain failure analysis and recovery design

- Date/Context: 2026-09-21, follow-up to the v0.8.6 `DRAIN_TIMEOUT profile=saeed-emad` incident.
- Confirmed mechanism: route cutover had already committed to the new backend, while the router still tracked one old-backend request. The updater treated any nonzero old in-flight count after 60 seconds as an exception, which moved the run into `PROMOTED_MAINTENANCE_REQUIRED` and left control checkout/schema cleanup for a later manual recovery.
- Safety constraint: an arbitrary long-running request cannot be force-killed after a timeout because it may be a mutating tool call with an uncertain external side effect. Therefore “just increase timeout” or “always kill the old backend” is rejected.
- Protocol evidence:
  - MCP 2026-07-28 Streamable HTTP permits request-scoped SSE responses and defines `subscriptions/listen` as a long-lived change-notification request. It also defines closing an SSE response stream as cancellation of that request. Source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx
  - The same specification removed the standalone GET stream for the 2026-07-28 transport but documents backward compatibility with older Streamable HTTP / HTTP+SSE transports, where a GET can hold a long-lived SSE stream.
  - Node HTTP exposes connection/request lifecycle and supports explicit connection closing, but generic connection termination alone does not prove application-level safety. Source: https://nodejs.org/api/http.html
- Minimum-sufficient design:
  1. Extend router status with bounded per-request metadata (`method`, path, JSON-RPC method/name, start time) and a conservative `cancellable` flag.
  2. Mark only known long-lived transport requests as automatically cancellable: `subscriptions/listen`, plus legacy GET stream endpoints. Ordinary `tools/call` and unknown requests remain non-cancellable.
  3. On drain timeout, if every old in-flight request is proven cancellable, stop the ownership-proven old backend and continue maintenance.
  4. Otherwise do **not** throw after committed cutover. Promote the control checkout, record a drain-pending state, retain the old release/schema compatibility, and let later updater runs re-check. Once the old request naturally ends, finalize schema/recycle/cleanup automatically.
  5. Keep rollback only for pre-commit failures; never roll back a committed route merely because cleanup is pending.
- Why not more complexity: no new service or database is required. Existing route state, router status, ownership markers and updater loop are sufficient.
- Status/Confidence: design Accepted for implementation / high; exact v0.8.6 incident request type remains Unverified, so the migration from the old router must use the conservative deferred path rather than assuming it was SSE.
- Reuse targets: updater architecture, zero-downtime semantics, incident prevention, release validation.

## E027 — Deferred drain implementation and regression result

- Date/Context: 2026-09-21, zero-downtime updater failure-prevention change set.
- Router now retains only bounded, non-argument request metadata for in-flight requests: request id, HTTP method, pathname, JSON-RPC method/name, cancellable flag and start time. Tool arguments/body content are not retained; regression explicitly verifies that a sentinel argument string never appears in router status.
- Conservative cancellation classification is implemented: `subscriptions/listen` and legacy GET `/mcp` or `/sse` streams are cancellable; ordinary `tools/call` is not.
- `router-status.mjs --json` returns count, bounded details and `cancellableOnly`; the old numeric interface remains unchanged.
- Windows updater behavior after committed cutover:
  - waits for the configured drain window;
  - if only proven cancellable long-lived requests remain, stops only the ownership-proven old backend and continues;
  - otherwise records `PROMOTED_DRAIN_PENDING` / `DRAIN_PENDING`, promotes control checkout, preserves old release/schema compatibility and exits successfully without rollback or blind process kill;
  - later scheduled updater runs re-check old route state and automatically finalize schema, recycle supervisor and clean superseded releases once the old work is gone.
- Linux updater now applies the same conservative policy for the default routed profile.
- Regression evidence:
  - stable-router + updater contract tests PASS, including simultaneous `subscriptions/listen` (cancellable) and `tools/call` (non-cancellable) metadata and argument-redaction assertion;
  - Windows updater parses successfully; Linux updater passes `bash -n` in Ubuntu;
  - full `npm run check`, `npm test`, and security audit PASS.
- Provenance:
  - check log SHA-256 `50d6ea575a75e77c8f4c400ede19acc699738fd88d2404f54ab3edc21d1e017b`;
  - test log SHA-256 `73594d3280152659fc50f02a8e2e887b22317ea2f742db5d4c906c71546874b8`;
  - security audit SHA-256 `17181ee897aebe337b4429d0287304eb6545f1235906f2c6a6aa328cef4c62d2`.
- Validation limitation: the original v0.8.6 router did not expose request details, so the first upgrade from v0.8.6 must conservatively defer any still-busy old request rather than retroactively classifying it. After the new router is active, future upgrades gain cancellable-request classification.
- Status/Confidence: implementation/regression PASS / high; full clean cross-platform release validation and live promotion pending.
- Reuse targets: updater release notes, zero-downtime design, incident regression, operations handbook.

## E028 — Persistent GUI helper lifecycle failure and prevention

- Date/Context: 2026-09-21, v0.8.7 release-preparation regression.
- Failure: the first combined release gate reached successful native GUI E2E output but the Node test process did not exit because the new persistent PowerShell helper still held child-process pipes after `gui_session_end`.
- Root cause: persistence lifetime was bound to the MCP process rather than the active GUI lease, so short-lived CLI/E2E hosts retained a live helper even after GUI work was finished.
- Prevention: the GUI controller now closes the persistent helper on explicit `gui_session_end` and on lease expiry. The production MCP server still gets reuse throughout an active lease/session; the helper is not kept alive after its coordination lifetime ends.
- Regression: added a test that requires both explicit session end and lease expiry to invoke helper close. GUI/HTTP safety suite is now 69/69 PASS.
- Real validation after fix: native Windows E2E returned `GUI_NATIVE_E2E_PASS`, verified multilingual text/button/screenshot/cursor/foreground behavior, and the command exited normally with exit code 0.
- Status/Confidence: Confirmed root cause / PASS / high.
- Reuse targets: GUI helper lifecycle, CLI test design, process-leak prevention, release acceptance.

## E029 — Router process source-drift discovered after v0.8.7 promotion

- Date/Context: 2026-09-21, independent post-promotion closeout of immutable v0.8.7.
- Finding: both canonical routers stayed alive across control-checkout/supervisor promotion. Their processes were created on 2026-09-20 and still ran the already-loaded `app/src/stable-router.mjs` code from the older release even though the file path on disk had been replaced by v0.8.7.
- Evidence: canonical router PIDs 2776/7688 predated v0.8.7; default `/router/status` after promotion still lacked the new `inflightDetailsByPort` field and retained stale old-port accounting after the old backend exited. `Recycle-ControlSupervisor` stops/restarts only the PowerShell supervisor; `Start-RouterForRoute` considers any healthy router/profile sufficient and therefore does not reload changed router source.
- Impact: v0.8.7 backend features are active and healthy, but its new router request-classification/drain metadata would not become active until the router process itself restarts. This is a lifecycle/version-activation defect, not a data-integrity or authority failure.
- Root cause: router readiness proves endpoint/profile health but not that the running router binary/source matches the promoted control checkout.
- Minimum-sufficient prevention: make each router expose and persist a SHA-256 of its loaded router source; supervisors compare that hash with the current authoritative source. If a healthy canonical listener is an ownership-proven Remote Commander router with a stale/missing source hash, recycle only that router and revalidate readiness. Unknown canonical listeners remain fail-closed. Apply the same rule on Windows and Linux.
- Status/Confidence: Confirmed / high. v0.8.7 remains published/immutable and is superseded for final acceptance by the forthcoming hotfix; whole-product FINAL remains open until the router source-activation fix is cleanly validated, published and promoted.
- Reuse targets: updater lifecycle, router zero-downtime architecture, release closeout, failure prevention.

## E030 — Router source-activation hotfix implementation

- Date/Context: 2026-09-21, hotfix change set following E029.
- Implementation:
  - `stable-router.mjs` now computes SHA-256 of the exact source file loaded by the running process and exposes it as `sourceSha256` in `/router/status`, `status()` and the router runtime marker.
  - Windows supervisor computes the authoritative current router-source SHA. A router is considered ready only when profile and source hash both match. A stale/missing hash triggers recycle only after runtime-marker/listener/process ownership is proven; an unknown canonical listener remains fail-closed.
  - Linux supervisor applies the same source-hash readiness rule and ownership-proven recycle using its runtime marker and `/proc/<pid>/cmdline`.
  - This intentionally makes pre-hotfix routers (which do not expose `sourceSha256`) self-identify as stale on the first hotfix supervisor cycle.
- Regression:
  - stable-router tests now require `/router/status` and runtime marker to contain the SHA-256 of the exact loaded `stable-router.mjs` source;
  - Windows updater/supervisor contract requires source-hash comparison and `ROUTER_RECYCLE_SOURCE_DRIFT`; PowerShell parser PASS;
  - Linux supervisor/updater/install/autostart scripts pass `bash -n`; contract requires the same source-drift recycle controls;
  - full `npm run check`, `npm test`, and security audit PASS.
- Provenance:
  - check log SHA-256 `0cf72b1f6db27220932196c2eb74ad71dfc6eccf5a013061b6a84a805b780caf`;
  - test log SHA-256 `0fad36a6c91c4788f0fd89e52650084d5cdf5b08247f4b774ddaae81ab77d4e3`;
  - security audit SHA-256 `26b2967a392390ead9e637749023a3a57034051c1f4110a9ebaa9d4295e57823`.
- Status/Confidence: implementation/regression PASS / high; clean cross-platform release validation and live source-drift recycle still required before FINAL.
- Reuse targets: update lifecycle, router activation, zero-downtime operations, release acceptance.

## E031 — v0.8.8 release-preparation gates

- Date/Context: 2026-09-21, release-preparation tree after router source-activation hotfix and version bump to 0.8.8.
- Windows source-tree release gates: `npm run check` PASS; `npm test` PASS; `npm run audit` PASS; native GUI E2E PASS.
- GUI/transport regression remains 69/69 PASS and the real native E2E again verifies focus, click, multilingual Unicode typing, button activation, screenshot change, cursor restoration and foreground restoration.
- Provenance:
  - check log SHA-256 `4f18cf4404df218e8d1f25a24555dbaa9db9fd711ba28f11e1a738909190e3d6`;
  - test log SHA-256 `00d560f30b2601a8ed85b551d1cab6afac1f0951efef8dc84f4f3157103bf394`;
  - security audit log SHA-256 `447ab70f4b592286448cdf91f868b26a3f8443817383561054ff2dc64953b650`;
  - native GUI E2E log SHA-256 `8edd865291b3858e56793351ddfe9d26ff7ae22f0922a7954f701279da6be7ca`.
- Status/Confidence: source release-prep PASS / high. Clean detached Windows, exact-public Ubuntu/Node22, immutable publication, candidate-only update, live promotion and router source-drift recycle remain OPEN gates.
- Reuse targets: v0.8.8 release acceptance, release notes, Project Brain.

## E032 — Automatic-update GUI E2E focus failure and gate redesign

- Date/Context: 2026-09-21, v0.8.8 candidate-only validation on the live Windows target.
- Failure: candidate `check`, `test`, and security audit all passed, but the automatic updater's `gui-native` gate failed at the real interactive focus step with `GUI_FOCUS_NOT_CONFIRMED`. The same exact release commit had already passed native GUI E2E from a clean detached worktree.
- Root cause: the scheduled/candidate updater was using the full interactive GUI E2E as an unattended release gate. Microsoft documents that `SetForegroundWindow` is intentionally restricted and may be denied even when documented conditions are met; an application cannot force itself to foreground while the user is working with another window. Sources: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow and https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow.
- Risk: an unattended auto-update should not steal focus, synthesize desktop interaction, or fail a valid candidate merely because the user is actively using another application.
- Minimum-sufficient correction:
  - keep full real GUI E2E as a release-validation gate on the exact clean release commit;
  - in unattended Windows candidate updates, replace the interactive E2E with the existing native `gui-control.ps1 -SelfTest`, which compiles/loads native code and verifies input layout/key validation without capture or input;
  - retain candidate MCP hardware self-test `gui_status` so the candidate process must still prove that the Windows GUI backend is available on the target machine;
  - do not weaken lease/frame/foreground/input safety in production to make a background test pass.
- Status/Confidence: Root cause Confirmed / high. v0.8.8 immutable publication remains valid but live promotion is blocked; hotfix release required so unattended candidate validation is deterministic and non-intrusive.
- Reuse targets: updater release gates, GUI acceptance, failure prevention, v0.8.9 release notes.

## E033 — v0.8.9 unattended-GUI-gate hotfix release preparation

- Date/Context: 2026-09-21, source-tree validation after replacing the unattended interactive GUI E2E with native no-input self-test and bumping to v0.8.9.
- Windows source-tree release gates: `npm run check` PASS; `npm test` PASS; `npm run audit` PASS; full real native GUI E2E PASS.
- The real E2E still validates focus, click, multilingual Unicode typing, button activation, before/after screenshot change, cursor restoration and foreground restoration; the product GUI safety model was not relaxed to address unattended-update focus denial.
- Updater contract now requires `Run-GuiNativeSelfTest`, `gui-control.ps1 -SelfTest`, and explicitly forbids invoking interactive `test:gui-native` from the unattended updater path.
- Candidate hardware self-test remains responsible for proving `gui_status` on the candidate MCP process before promotion.
- Provenance:
  - check log SHA-256 `548fb6a14c1680cf208bb3177b218b5cec8b149bfeb4fcbb89fb468bf29bb56f`;
  - test log SHA-256 `253aea599e099eb323bc530b2ba1351d04ff03f6e5833660fdc38e31d8c9f760`;
  - security audit log SHA-256 `b5367c370a7221bdc1b6b5fdf1482aaa45d2912bc584f7deb556cab82b8c312b`;
  - native GUI E2E log SHA-256 `7fa1ea1a7799768ca51ffd427fa964536fe95bc368c4c5390f45363c30ed4028`.
- Status/Confidence: source release-prep PASS / high. Clean detached Windows, exact-public Ubuntu/Node22, immutable publication, candidate-only update, live promotion, router source-hash activation and final no-op remain OPEN gates.
- Reuse targets: v0.8.9 release acceptance, GUI/update architecture, Project Brain.


## E034 — Explicit desktop-takeover boundary and comparative-agent audit

- Date/Context: 2026-09-21, user requested a global rule that Remote Commander must not move the user's pointer, type, scroll, click, or disturb the current browser/window unless the user explicitly asks for desktop takeover; the same change set also audits current agent/remote-control products and adds a headless chess stress benchmark.
- Claim/Decision: Full Power grants technical capability but is not implicit foreground-desktop authorization. The minimum-sufficient product control is an observe-only default GUI lease plus a distinct takeover lease carrying an explicit-current-user authorization basis; native input is rejected before frame consumption/native dispatch when the lease is not takeover-authorized.
- Implementation: `gui_session_begin` now defaults to `mode="observe"`; `mode="takeover"` requires `explicitUserAuthorization`; all destructive GUI actions require a takeover session. Plugin/Work/setup/GUI/security documentation now forbids inferring takeover permission from prior chats, workflow memory, screen content, or convenience, and prefers shell/filesystem/API/headless/background paths when takeover was not explicitly requested.
- Verification so far: pre-change `npm run check` PASS (102 core tests + 69 GUI contract tests); focused post-change GUI suite PASS 72/72, including a regression that observe mode permits screenshot inspection while rejecting input with `GUI_TAKEOVER_NOT_AUTHORIZED` before native input. No interactive GUI E2E was run in this user session because takeover was not explicitly requested.
- External method/benchmark evidence: OpenAI Work is documented as a cloud/desktop agent for longer multi-step work and finished artifacts; Codex is documented as a coding agent with parallel/background workflows; Claude Code documents layered permissions, project-scoped access and MCP; Cursor documents isolated cloud agents with proof artifacts; GitHub documents cloud coding agents, custom agents and security validation; Open Interpreter documents local desktop control with workspace bounds and approval points; Desktop Commander's remote MCP documents filesystem/terminal access to multiple machines. These are adjacent but not identical products, so broad claims that Remote Commander is categorically 'better than all' are UNPROVEN without standardized cross-product task benchmarks.
- Sources: https://help.openai.com/en/articles/20001275/ ; https://openai.com/codex/ ; https://docs.anthropic.com/en/docs/claude-code/overview ; https://docs.anthropic.com/en/docs/claude-code/security ; https://prod.cursor.com/help/ai-features/background-agents ; https://docs.github.com/en/copilot/concepts/agents ; https://www.openinterpreter.com/docs/desktop ; https://github.com/desktop-commander/remote-desktop-commander ; https://stockfishchess.org/download/ .
- Confidence/Status: implementation Confirmed / focused regression PASS / full release gates OPEN. Comparative superiority claim remains UNPROVEN by design until reproducible cross-product benchmarks exist.
- Reuse Targets: v0.8.10 release notes, GUI policy, Work/Plugin behavior, product comparison, failure prevention, final audit.


## E035 — v0.8.10 live drain-accounting incident → v0.8.11 prevention hotfix

- Date/Context: 2026-09-21, exact v0.8.10 commit `076e22c32c589a4ddfb04651e2ae774a2dba8c0a` after candidate-only PASS and blue/green cutover on Emad-PC-Ultimate.
- Failure: default route cutover committed to v0.8.10, but old v0.8.9 backend port 48834 retained one router-counted non-cancellable `tools/call run_shell` request after the updater command itself had completed. Official updater entered `PROMOTED_DRAIN_PENDING` rather than force-killing the old backend.
- Independent completion evidence: old-backend audit log records the relevant `run_shell` as `ok=true` at `2026-09-21T03:37:06.851Z`; process inspection found no non-console child workload; previous route was exactly commit `eb9607687f4ff994eb52bcb9c80cecfde902e48d` / port 48834; runtime marker matched PID 25928 / port 48834 / profile default.
- Recovery: ownership-proven stop of only superseded PID 25928 cleared old inflight accounting. The official maintenance path then finalized workflow DB schema 2 for both profiles, recycled the supervisor and returned `AUTO_UPDATE_MAINTENANCE_PASS version=0.8.10`.
- Reproduction: a new stable-router regression intentionally disconnects the downstream client while a mutating-shaped upstream response is still being produced. Pre-fix result: FAIL, inflight remained `1` instead of `0` after ~3.2 s.
- Root Cause: stable-router retired inflight entries only on upstream `end/close/error`. When the downstream response closed mid-pipe, the upstream readable could remain paused after the destination disappeared, preventing its completion event even though the backend action had already finished. The router correctly avoided blind cancellation, but lacked response-drain continuation after downstream disconnect.
- Prevention/Guard: v0.8.11 tracks downstream closure, unpipes the dead response destination and resumes consuming the upstream response until its real end/close/error. It does not cancel, retry or duplicate the upstream operation. If the downstream closes before upstream headers arrive, the upstream response is drained without writing to the destroyed client response.
- Regression: focused stable-router suite PASS 6/6 after fix; the formerly failing downstream-disconnect case completes in ~88 ms and inflight returns to zero.
- Status/Confidence: Root cause CONFIRMED / implementation PASS focused / full release gates pending at record creation.
- Provenance: `src/stable-router.mjs`, `test/stable-router.test.mjs`, `%LOCALAPPDATA%\ChatGPTRemoteCommander\routing\default.json`, prior runtime `...\runtimes\eb960768...\default\audit.jsonl`, `last-update.json`, updater log.
- Reuse Targets: v0.8.11 release notes, zero-downtime updater architecture, drain failure prevention, Project Brain, regression catalog.


## E036 — Stable auto-update monotonicity failure → v0.8.12 downgrade prevention

- Date/Context: 2026-09-21, release finalization after v0.8.10/v0.8.11 candidate promotion while public GitHub Latest was still v0.8.9.
- Failure: the scheduled stable updater resolved the older public v0.8.9 and began a candidate/cutover path even though the active runtime was newer. Timeline evidence in `auto-update.log` shows v0.8.10 maintenance PASS followed immediately by another stable gate sequence and route state later returning to v0.8.9 before the next candidate was applied.
- Root Cause: both automatic updaters guarded only the exact-current case. They did not compare semantic versions and therefore treated active-newer/staged-older as an ordinary update. Release sequencing (promoting before publishing the matching stable release) exposed the defect.
- Decision: stable automatic update is monotonic by default. Non-forced updates must never downgrade. Deliberate downgrade/rollback remains possible only through explicit force/exact-ref authority.
- Prevention: Windows uses a fail-closed `[version]` semantic comparison and records `NEWER_CURRENT` / `AUTO_UPDATE_NEWER_CURRENT`; Linux adds numeric x.y.z comparison and the same no-cutover marker. Guards execute before candidate gates and route mutation.
- Release-process prevention: for normal stable releases, follow GitHub's immutable-release sequence draft → upload all assets → verify → publish, then promote the exact published commit. This aligns scheduled stable authority with manual production authority.
- Method evidence: GitHub immutable releases lock the associated tag/assets after publication and GitHub recommends attaching all assets to a draft before publishing. Sources: https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases and https://cli.github.com/manual/gh_release_create.
- Status/Confidence: Root cause CONFIRMED / implementation pending full regression at record creation.
- Reuse Targets: v0.8.12 release notes, updater policy, release runbook, failure prevention, Project Brain.


### E036 validation delta

- v0.8.12 targeted updater/router regression: PASS 14/14; Git-for-Windows Bash syntax validation of `auto-update-linux.sh`: PASS.
- Live Windows negative regression while active v0.8.11 > GitHub Latest v0.8.9: `AUTO_UPDATE_NEWER_CURRENT current=0.8.11 latest=0.8.9`, exit 0; both canonical route files remained generation 9 / active v0.8.11 exact commit, proving no downgrade/cutover occurred.
- Full v0.8.12 source gates: `npm run check` PASS; `npm test` PASS; `npm run audit` PASS; native no-input GUI self-test PASS (X64 INPUT size 40); Linux `bash -n` PASS. Full test run includes 105 core tests and 73 GUI contract tests with zero failures.
- Status/Confidence: implementation + source regression PASS / high. Publication and exact published-commit production promotion remain OPEN at this point.


## E037 — v0.8.13 supervisor liveness and canonical-listener continuity

- Date/Context: 2026-09-21, additive change on top of upstream v0.8.12 downgrade-prevention commit c5b998318959fd402fed06c6fdebcf7afadb1634.
- Authority chain retained: v0.8.10 zero-interference desktop takeover boundary; v0.8.11 stable-router downstream-disconnect response-drain accounting; v0.8.12 monotonic stable updater that refuses non-forced downgrade.
- Confirmed live backend incident from the earlier v0.8.9 runtime: the Windows supervisor recycled the active default backend at 06:17:58 local time after a failed health probe; tunnel telemetry then recorded at least 13 HTTP 502 upstream responses from 06:18:02 through 06:18:09 across multiple concurrent command/conversation identifiers.
- Root cause: Start-RoutedBackend treated one failed two-second /health probe as sufficient for an ownership-proven force stop and did not consult the canonical router's already-available inflightByPort/inflightDetailsByPort before destructive recovery.
- Confirmed canonical-router incident: separate 502 responses aligned with ROUTER_RECYCLE_SOURCE_DRIFT while the canonical listener itself was intentionally stopped/restarted solely to activate changed router source.
- Prevention:
  - three consecutive backend health misses before recycle is eligible;
  - canonical router status must be readable and report zero in-flight work;
  - final backend health and router-activity re-check immediately before stop;
  - unknown/busy activity defers recovery;
  - a healthy canonical router with stale loaded-source hash remains serving and records ROUTER_SOURCE_ACTIVATION_DEFERRED rather than creating an update-time listener gap.
- Behavioral regression: test/supervisor-recovery-policy-windows.ps1 drives four repeated health misses while router status reports two in-flight calls and fails if Stop-OwnedRoutedBackend executes. It also fails if healthy stale-source router handling invokes Stop-OwnedRouter.
- Contract merge preserves all v0.8.12 AUTO_UPDATE_NEWER_CURRENT/Test-VersionGreater/version_gt downgrade assertions while adding supervisor continuity assertions; downgrade prevention and continuity are complementary.
- Firefox/browser evidence remains separate: six isolated authenticated ChatGPT conversations ranged from 2.984 to 18.374 CPU-seconds per 10-second sample and roughly 1.85-2.37 GiB working set. AI-RTL and hardware-acceleration A/B changes were not material, so browser conversation weight is a performance amplifier, not the confirmed transport root cause.
- Status/Confidence: root causes Confirmed / high; merged v0.8.13 candidate prepared; exact merged gates, publication and live promotion OPEN at record creation.
- Reuse targets: Retry diagnosis, supervisor liveness policy, zero-downtime operations, release acceptance, regression catalog.


### E037 validation delta

- v0.8.13 source candidate gates on the Windows target: `npm run check` PASS (log SHA-256 `09c7d9f3357be835ebadbec09c158fb00b494ae9ff0c3a01c4023bb030025471`); `npm test` PASS with zero failures (log SHA-256 `a306c8da76bac94d809b3108ea96074c854d43d475ac15fd6a9ba31936b11a18`); `npm run audit` PASS / `SECURITY_AUDIT_PASS` (log SHA-256 `e61be9724b2d466fedae822ae5c703f8114e886fd31d06332828c756afd9526f`).
- Windows behavioral recovery policy PASS: repeated health misses while router activity reported two in-flight calls did not invoke backend stop; stale-source healthy-router handling did not invoke router stop.
- PowerShell supervisor/test parsers PASS; Linux supervisor `bash -n` PASS; GUI native/controller files are byte-identical to authoritative v0.8.12 commit `c5b998318959fd402fed06c6fdebcf7afadb1634`; current no-input native self-test PASS (X64 input size 40).
- Candidate diff remained unchanged through gates, SHA-256 `12acc14a4daf7d69bf8d0543d611a96b2d6e2e6077450ce9aecc48a0fb72fd47` before this evidence-only update.
- Operational confirmation after v0.8.12 was published but before it was installed: a still-running v0.8.11 updater cycle beginning 07:25 local resolved stable v0.8.9 and returned production routes/control checkout to v0.8.9 with `PROMOTED_DRAIN_PENDING`. This is the already-documented E036 failure class occurring under the older updater; it does not contradict the v0.8.12 monotonic guard because that guard was not yet live in that updater process.
- Status/Confidence: merged implementation + source regression PASS / high; exact committed-tree clean Windows + Ubuntu/Node22 validation, immutable publication and live promotion remain OPEN.


## E038 — v0.8.14 candidate cleanup, non-interactive update validation and installer closeout

- Date/Context: 2026-09-21, additive change on immutable v0.8.13 commit `2629149ce577afc91469315c89685f9bbfa01459`.
- Previous accepted state: v0.8.13 added fail-closed supervisor recovery: three consecutive misses + known zero inflight + final re-check before routed-backend recycle, and no healthy-router restart solely for source-hash drift.
- New failures carried forward from exact-public v0.8.12 validation: `GUI_NATIVE_BUSY` caused by updater use of shared interactive `gui_status`; a failed saeed-emad candidate remained listening because Windows cleanup tracked only candidates that had completed all checks; the next run failed workflow-shadow copy.
- Recovery evidence: candidate PID 14380 / port 48837 / profile saeed-emad / v0.8.12 runtime marker was proven non-active against canonical route and stopped narrowly.
- Decision: candidate lifecycle authority begins at spawn, not after validation. Cleanup must be ownership-proven. Unattended GUI validation must not acquire or contend for an interactive desktop helper when equivalent no-input/policy evidence exists.
- Implementation: Windows `Stop-OwnedCandidate` + immediate `$currentCandidate`; catch cleanup before cutover; candidate GUI backend/policy verification through `system_status`. Linux `validation_cleanup` trap + cwd-bound `stop_owned_candidate`. No native GUI input behavior changes.
- Installer decision: release must include a standalone installer bundle in addition to individual assets; bundle contains pinned installers/plugin installers/setup docs and SHA-256 manifest. Fresh-install acceptance must run from exact pushed release commit in an isolated directory before publication.
- Confidence/Status: implementation prepared on current v0.8.13 authority; full source gates, exact-commit installer acceptance, immutable publication and live promotion OPEN at record creation.
- Reuse Targets: v0.8.14 changelog, installer/readme, updater failure prevention, release acceptance, Project Brain/final report.


### E038 validation delta — source gates

- v0.8.14 full source validation PASS on Emad-PC-Ultimate: `npm run check`, `npm test`, `npm run audit`, Windows native no-input GUI self-test and Git-for-Windows Bash syntax validation all returned zero.
- Core test run: 106 tests / 106 PASS / 0 FAIL, including v0.8.13 supervisor continuity regressions plus v0.8.14 updater lifecycle contracts. GUI contract/helper/HTTP suite: 73/73 PASS.
- Security audit: PASS with no secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked local-config or developer-path finding.
- Native GUI evidence: X64 INPUT layout size 40, no-input only; no mouse/keyboard/focus takeover was performed.
- Status/Confidence: source implementation PASS / high. Exact pushed-commit isolated installer acceptance, immutable publication and live production promotion remain OPEN at this point.


### E038 validation delta — isolated fresh installer

- Exact pushed code commit tested: `a8ed68c5fbafaf7276f33e3e19ef19856d8f4b1f` from `origin/main`.
- Fresh Windows install path: `%LOCALAPPDATA%\ChatGPTRemoteCommander\installer-accept-v0.8.14-a8ed68c`; prestate proved the path did not exist. Installer was invoked with explicit `-PowerMode -GuiControl -SourceRef main -ExpectedCommit a8ed68c...` and without `-StartServer`, so production canonical ports/routes and desktop focus were not touched.
- Result: `INSTALL_PASS`; installed HEAD exactly matched the expected commit. Installer reran check/test/audit successfully from the fresh checkout.
- Authority result: capability tier `FULL_POWER`, `explicitlyAuthorized=true`, `persistAcrossUpdates=true`, `autoEnableNewCapabilities=true`, `disabledCapabilities=[]`; all 22 current capabilities granted. Full filesystem, permanent delete, unrestricted shell, process control and all four GUI capabilities enabled.
- Tunnel-client supply chain: official OpenAI tunnel-client v0.0.14 windows-amd64 installed into the isolated checkout after upstream SHA256SUMS verification; recorded executable SHA-256 `fcc85a69ec0ad82518e4f8964f60c45e31787957782a0fc9c1b0c44e82d61b9b`.
- No persistent sandbox server/tunnel process was started; process inspection showed only the transient read-only audit commands referencing the acceptance path.
- Status/Confidence: fresh installer acceptance PASS / high. Release commit may add only evidence/docs after this tested code commit; any executable/installer-byte change requires rerun.


## E039 — Exact-bundle acceptance found Fetch blocked-port test flake → v0.8.15

- Date/Context: 2026-09-21, final installer-bundle acceptance for unpublished v0.8.14 candidate tag, exact commit `36fbaeddad1c80abaacfc9532b5c057558d9cf7c`.
- What passed before failure: wrapper pinned `v0.8.14` and ExpectedCommit correctly; fresh checkout HEAD matched; official OpenAI tunnel-client v0.0.14 downloaded and SHA256SUMS-verified; capability migration produced explicit persistent FULL_POWER + GUI with permanent delete; no production server was started.
- Failure: fresh checkout `npm run check` failed only in `stable-router.test.mjs` test 'upstream failure cannot underflow inflight accounting' with Node `TypeError: fetch failed`, cause `Error: bad port`.
- Root Cause: `freePort()` obtains an arbitrary OS-assigned free TCP port. Tests then used global Fetch to contact the local router. Fetch intentionally blocks a standards-defined set of ports regardless of OS availability, so a free port such as 5060 can produce a client-side failure before the router is contacted.
- Prevention: local stable-router tests now use a small `node:http` request helper for loopback traffic. This removes browser Fetch blocked-port policy from a Node HTTP-router unit/integration test and better matches the implementation transport. Runtime router source is unchanged.
- Regression evidence: corrected stable-router suite passed 10 consecutive runs. Full v0.8.15 gates remain required after version/docs update.
- Release decision: no v0.8.14 GitHub Release was published. The v0.8.14 tag is a failed unpublished candidate and is superseded by v0.8.15; all v0.8.14 candidate-cleanup and installer hardening carries forward.
- Confidence/Status: root cause CONFIRMED / focused regression PASS / final release gates OPEN at record creation.
- Reuse Targets: release acceptance, installer QA, test-harness reliability, Project Brain, final report.


### E039 validation delta — full v0.8.15 gates

- Corrected stable-router suite: 10 consecutive focused runs PASS before the full suite.
- Full v0.8.15 validation PASS on Windows target: `npm run check`, `npm test`, `npm run audit`, native no-input GUI self-test and Linux Bash syntax check all returned zero.
- Core suite: 106/106 PASS; GUI contract/helper/HTTP suite: 73/73 PASS; security audit PASS with no credential/developer-path finding.
- No product/router/GUI runtime source changed for E039 beyond version metadata; the behavioral delta is confined to test/stable-router.test.mjs using node:http instead of Fetch.
- Status/Confidence: source release candidate PASS / high. Exact-tag installer-bundle acceptance, immutable publication and live promotion remain OPEN at this point.

## E040 — Linux live audit and v0.8.16 lifecycle/package hardening

- Date/Context: 2026-09-21, live audit of the newly enrolled Ubuntu 24.04-class target `aliemad-Labtop` plus exact source authority at origin/main v0.8.15.
- Previous accepted state: Linux target was installed as v0.8.13 FULL_POWER, canonical MCP/tunnel were healthy, `system_status` exposed 39 Linux tools, and tunnel readyz returned `ready`.
- Live finding 1 — automatic update scheduler inactive: active routed config had `autoUpdate.enabled=true`, interval 15 minutes and stable channel, but supervisor log had no `AUTO_UPDATE_CHECK_STARTED` and no next-update epoch file. The systemd user service environment PATH omitted `~/.local/share/ChatGPTRemoteCommander/.runtime/node-current/bin`, while the machine's Node/npm existed only in that portable directory. Root Cause -> Prevention -> Guard -> Regression: systemd sanitized PATH -> bootstrap portable runtime in supervisor/account enrollment and persist it in generated unit -> explicit RUNTIME_MISSING failure instead of silent scheduling loss -> source-integrity assertions plus live Ubuntu post-promotion check.
- Live finding 2 — release executable-mode mismatch: v0.8.15 Git index stored Linux lifecycle scripts as mode 100644. Fresh Linux install chmodded them to executable, creating mode-only tracked dirtiness and reproducing `control tracked dirty` during v0.8.13 promotion. Root Cause -> Prevention -> Guard -> Regression: release metadata mismatch -> store all Linux runtime scripts as 100755 in Git -> source-integrity checks exact staged mode -> fresh Linux install/update gate.
- Finding 3 — disable lifecycle cleanup incomplete: prior `disable-autostart-linux.sh` handled systemd/crontab, tunnel processes, and direct control-checkout server processes but did not explicitly ownership-validate routed release backend/router processes. Prevention: read canonical route/runtime markers and kill only PID/cwd/cmdline-proven routed processes.
- Finding 4 — bounded-download regression: `install.sh` used direct `curl -fsSL` for the tunnel-client binary while checksum download used bounded `curl_fetch`. Prevention: both asset and checksum use shared connect/total timeout helper; source-integrity regression rejects the unbounded form.
- Finding 5 — systemd self-restart ordering: the automatic updater is launched as a child of the user service. A synchronous `systemctl --user restart` can terminate the updater with the service control group before release cleanup and final PASS logging. Prevention: cleanup and durable PASS are completed first, then restart is requested with `--no-block`; source contract asserts the ordering in both maintenance and normal promotion paths.
- Baseline validation before mutation: exact public v0.8.15 clone on live Ubuntu passed `bash -n` for Linux lifecycle scripts, `npm run check`, `npm test`, and `npm run audit`.
- Patch validation: exact changed shell bytes copied to the live Ubuntu target. An initial generated disable-script patch failed `bash -n` and was rejected before commit; root cause was patch-generation corruption around tab parsing. The script was rebuilt from HEAD with cut-based route-field parsing; second Ubuntu `bash -n` gate passed.
- Windows/source regression after patch: full `npm run check`, `npm test`, and `npm run audit` PASS; core suite 106/106 PASS, GUI contract suite 73/73 PASS, security audit PASS, new Linux source-integrity/mode/runtime/download guards PASS.
- Method-choice note: systemd user service persistence beyond logout via user lingering is a host policy choice, not required for the current logged-in workstation scenario. It is intentionally not auto-enabled; minimum sufficient control is login-bound user service plus explicit runtime PATH. Enabling linger remains an optional owner/admin action if unattended post-logout service is required.
- Status/Confidence: implementation/source validation PASS / high; exact committed-tree Ubuntu validation, immutable publication and live Linux promotion remain OPEN at this record point.
- Reuse Targets: Linux release notes, installer/update troubleshooting, autostart policy, future cross-platform release gates.
- Provenance: source paths `autostart-linux.sh`, `enable-autostart-linux.sh`, `disable-autostart-linux.sh`, `connect-chatgpt-account.sh`, `install.sh`, `test/source-integrity.mjs`; live Ubuntu canonical route and systemd evidence captured through Remote Commander on `aliemad-Labtop`.

## HISTORY — E040 delta

- 2026-09-21: Added live Linux audit, four confirmed lifecycle/package defects, rejected pre-commit patch failure, prevention/guards, and v0.8.16 candidate validation state.

## E041 — Linux updater lock inheritance root cause and v0.8.17 successor

- Date/Context: 2026-09-21, live post-publication promotion attempt after immutable v0.8.16 publication.
- Confirmed symptom: official latest-release installer resolved v0.8.16 but returned `AUTO_UPDATE_ALREADY_RUNNING`; control checkout and canonical route remained v0.8.13.
- Read-only forensic evidence: no updater process existed, but `/proc/18094/fd/9` (active backend) and `/proc/18177/fd/9` (stable router) both resolved to `~/.local/state/chatgpt-remote-commander/auto-update.lock`; `fuser` independently named those two Node PIDs as holders.
- Root Cause: `auto-update-linux.sh` opens fd 9 and flocks it, then launches the long-lived backend/router without closing fd 9. Linux descriptor inheritance therefore extended the lock lifetime to those children, making every later updater instance fail its nonblocking flock even though the original updater had exited.
- Prevention: both `start_backend` and `start_router` explicitly redirect `9>&-` on the long-lived Node process invocation.
- Guard/Regression: Linux updater contract now asserts the backend and stable-router launch forms close fd 9. Live post-promotion acceptance requires no long-lived process to hold `auto-update.lock` and a second updater check must reach CURRENT/maintenance rather than `AUTO_UPDATE_ALREADY_RUNNING`.
- Release authority: v0.8.16 was already published with immutable=true before this live defect was exposed; no mutation of that release is allowed. Fix is carried by successor v0.8.17.
- Status/Confidence: root cause CONFIRMED / high; source fix IMPLEMENTED; clean exact-commit Ubuntu gate, immutable v0.8.17 publication, and live recovery/promotion OPEN at this record point.
- Reuse Targets: Linux auto-update architecture, FD inheritance guards, release immutability procedure, incident postmortem.
- Provenance: live `/proc/<pid>/fd/9`, `fuser`, canonical route/update logs on `aliemad-Labtop`; source `auto-update-linux.sh`, `test/auto-update-contract.test.mjs`.

## HISTORY — E041 delta

- 2026-09-21: Converted live stale-lock symptom into descriptor-inheritance root cause; v0.8.17 successor initiated because v0.8.16 is immutable.

## E042 — v0.8.17 exact Linux validation, immutable publication, and live-access gate

- Date/Context: 2026-09-21, successor release closeout after E041.
- Exact source authority: commit `6bd826502a048640baf3c77fa4b74bc40e8e977d`, package/plugin version 0.8.17, annotated tag `v0.8.17^{}` resolving to the same commit.
- Windows/source regression: focused Linux updater contract 9/9 PASS; full `npm run check`, `npm test`, and `npm run audit` PASS. Core suite 106/106 PASS, GUI contract/helper/HTTP suite 73/73 PASS, source-integrity PASS, security audit PASS.
- Independent exact Linux validation: clean exact-commit checkout on WSL2 Ubuntu 24.04.4 LTS with Node v24.18.0/npm 11.16.0. All eight Linux lifecycle scripts parsed with `bash -n`, all eight were Git mode 100755, lock-FD source guards were present, and `check && test && audit` returned exit 0 with marker `WSL_EXACT_V0817_PASS`.
- Linux validation log hashes from the exact checkout: check `9ff66e4cb256f6c035c8487c03539ff322ece2d8cad4830873359e664acfb99d`; test `dec692ee21fa5be289a907f9c4f26a5cae09a18e0eca8749ee14360b4fbc8ae0`; audit `cc26b34580d578353def2e02ab8272ec50964cf9959ccfa8ba6ba2d40f69323c`.
- Publication: GitHub Release `v0.8.17` published 2026-09-21T05:55:07Z with `isImmutable=true`; it is the current Latest release. Draft-first verification matched 13/13 uploaded asset SHA-256 digests before publication.
- Key public asset digests: installer ZIP `9e475cb261815feb8a45f398a6d06db058315d43d6ef915ff07132e8b026fe9f`; `install.sh` `486b69e33d537768761887bbe4b39f0fc3ded6efc5b28d18932bbd39b1cc7d49`; `SHA256SUMS.txt` `b99a480929f8f22f7d2e432a95b27d90fe5e884e95142085e5dd8d1917dae1d3`; plugin template stable/versioned ZIP `cb4fab9b41765b4d1b3fe2cccc8ecb40f1c8dd2c5c01c5628e0685991faed29b`.
- Live target gate: `aliemad-Labtop` is reachable on LAN at 192.168.10.6 and replies to ping, but its OpenAI tunnel-client has not been seen for >300 seconds. SSH, RDP/VNC/WinRM, canonical MCP/tunnel ports and a bounded set of common remote-management ports are closed from the trusted Windows host. Therefore there is presently no authorized remote execution path to restart the local user service.
- Validation status: product/release PASS; live deployment on `aliemad-Labtop` remains UNVERIFIED/OPEN. No claim of live v0.8.17 promotion is made.
- External CI: GitHub Actions for the successor commit did not execute any workflow step because the repository account remains billing-locked; this is external infrastructure evidence, not a code/test failure.
- Exact next action: regain one local execution path on `aliemad-Labtop`, release the legacy inherited updater lock by ownership-safe service/process shutdown, run the exact v0.8.17 installer/update, then require canonical route/tunnel health plus a second updater run proving `AUTO_UPDATE_ALREADY_RUNNING` is gone.
- Reuse Targets: Linux release acceptance, incident recovery, final project report, future updater FD-inheritance regression.
- Provenance: Windows source repo and GitHub release metadata; WSL2 exact Linux checkout/logs; LAN/tunnel probes; E040/E041 live Linux evidence.

## HISTORY — E042 delta

- 2026-09-21: v0.8.17 exact Linux/Windows/security validation and immutable publication PASS; live laptop promotion correctly left OPEN because all authorized remote execution channels are currently unavailable.

## E043 — Exact local-recovery fallback artifact for disconnected Linux target

- Date/Context: 2026-09-21, created only because `aliemad-Labtop` is LAN-reachable but exposes no authorized remote execution channel and its OpenAI tunnel-client is not polling.
- Artifact: `RC_LINUX_RECOVERY_V0817.zip`; SHA-256 `db3ceb41df02ada77c988335b72ef79ae05f34eadd446b63cc4a3ae5dd8e3944`.
- Authority pinned in artifact: release `v0.8.17`; commit `6bd826502a048640baf3c77fa4b74bc40e8e977d`; immutable release `install.sh` SHA-256 `486b69e33d537768761887bbe4b39f0fc3ded6efc5b28d18932bbd39b1cc7d49`.
- Safety model: runner refuses missing existing tunnel profile/credential instead of prompting for secrets; stops the user service; terminates only lock holders whose cmdline and cwd prove Remote Commander backend/router ownership; verifies exact installer SHA; requires exact control/route commit, active systemd service, tunnel readyz, stable-router state, a free updater lock, and a second exact updater run that must not report `AUTO_UPDATE_ALREADY_RUNNING`.
- Return contract: exactly one `RETURN_RC_LINUX_V0817_<UTC timestamp>.zip` is emitted in the Linux user's home with prestate, mutation log, poststate, result/failure and manifest.
- Artifact integrity verification: ZIP internal `SHA256SUMS.txt` verified all three payload files (`RUN_LINUX_RECOVERY.ps1`, `RUNNER_MANIFEST.json`, `README.txt`) before handoff.
- Status: fallback READY; live target execution remains OWNER/LOCAL ACCESS GATE until the runner is executed or Remote Commander reconnects.
- Reuse Targets: exact manual recovery, account-transfer handoff, incident closure.


## E044 — Windows updater stdio inheritance, stale drain recovery, and runtime-version authority

- Date/Context: 2026-09-21, post-v0.8.15 Windows production promotion and v0.8.18 successor engineering.
- Symptom: canonical route cut over to v0.8.15 but `route.previous` retained v0.8.13 and router inflight accounting retained the updater's non-cancellable `run_shell` request after updater work had otherwise completed.
- Independent live evidence: old backend `system_status` reported `activeOperations=0` and `queued=0`; router showed one stale request; the only established TCP peer was the canonical stable router; GUI was `busy=false`, `leased=false`.
- Safety discovery: old backend also owned persistent terminal `term-1`. Two read-only reads showed the scientific sweep completed with `RC=0` and the shell was at prompt. It was closed explicitly through `stop_terminal`; it was not force-classified as idle. Permanent rule: persistent terminals always block automatic stale-backend retirement.
- Root Cause / Prevention: Windows updater launched long-lived backend children inside a piped MCP `run_shell` ancestry without an explicit stdio-detach boundary. Behavioral regression first reproduced a pipe-hold failure; corrected launch uses `Start-Process` without stdout/stderr redirection. Regression marker: `BACKEND_STDIO_DETACH_PASS`.
- Recovery guard: stale cleanup requires exact ownership/version/profile, zero active/queued operations, no unexpected TCP peer besides canonical router, GUI not busy/leased, no persistent terminal/unsafe descendant, and a second immediate evidence check before destructive stop.
- Route-state guard: `tools/router-retire.mjs` clears only the exact `route.previous` under generation/profile/port/commit preconditions and advances generation atomically. Windows and Linux updater paths call it only after successful ownership-proven drain/stop.
- Version-authority defect: v0.8.16/v0.8.17 package/plugin metadata advanced while `src/server-v0.3.mjs` remained `VERSION='0.8.15'`. v0.8.18 sets package/plugin/server/install defaults consistently and onboarding regression now requires server VERSION == package version.
- Focused regression evidence: `BACKEND_STDIO_DETACH_PASS`; `STALE_DRAIN_POLICY_PASS`; router-retire 3/3 PASS; updater contract including Linux v0.8.17 lock-FD guards PASS; Windows runtime contract PASS; Linux `bash -n` PASS.
- Status/Confidence: root causes CONFIRMED / implementation focused-gates PASS / full release gates OPEN at record creation.
- Reuse Targets: updater lifecycle, zero-downtime drain policy, release/version authority, incident postmortem, installer/update troubleshooting.
- Provenance: v0.8.15 production route/runtime/audit/process evidence; isolated successor worktree `fix/windows-drain-stdio-safe`; source/tests listed above.

## HISTORY — E044 delta

- 2026-09-21: Added confirmed Windows stdio-inheritance failure, conservative recovery policy, persistent-terminal guard, atomic route retirement and runtime-version authority regression.


### E044 validation delta — full v0.8.18 source gates

- Full Windows/source validation PASS: `npm run check`, `npm test`, `npm run audit`, native no-input GUI self-test, Linux `bash -n`, and cached diff integrity all returned zero.
- Core suite: 109/109 PASS. GUI contract/helper/HTTP suite: 73/73 PASS. Security audit: PASS.
- Focused lifecycle regressions remain PASS: `BACKEND_STDIO_DETACH_PASS`, `STALE_DRAIN_POLICY_PASS`, router-retire 3/3, Windows runtime contract, and Linux v0.8.17 lock-FD assertions.
- Release metadata check PASS: package=0.8.18, plugin=0.8.18, server runtime VERSION=0.8.18, Windows/Linux installer defaults=v0.8.18.
- First full-gate attempt stopped at source-integrity because new router-retire files were intentionally not yet Git-tracked; after staging the exact change set, the guard passed on the complete rerun. No runtime test failure occurred in that first attempt.
- Status/Confidence: source release candidate PASS / high. Exact-tag installer acceptance, immutable publication, live candidate promotion, route retirement and orphan cleanup remain OPEN at this point.


## E045 — GUI/chess stress test exposed auto-update maintenance feedback loop

- Date/Context: 2026-09-21, live Windows GUI stress test using Lucas Chess R6.1.4 with Stockfish 19.
- Stress-test setup: Lucas Chess installed in a dedicated local window; Stockfish 19 selected as the strongest listed internal engine (Lucas UI rating 3700); engine fixed response time configured to 0.1 s. GUI takeover was explicitly scoped to the dedicated Lucas Chess window; browser/other windows were excluded.
- Initial symptom: GUI sessions became uncertain/disconnected and the ChatGPT tunnel intermittently stopped polling. Update logs showed `SUPERVISOR_RECYCLE_STOP/PASS` repeating roughly every scheduler loop despite v0.8.18 routes already being healthy.
- Root cause evidence: active routes for default/saeed-emad both pointed to v0.8.18 with `previous=null`, while release directories v0.8.9/v0.8.10/v0.8.11 remained. Each directory was held by its matching old Node backend listener. `Has-SupersededRelease` therefore stayed true; `Cleanup-Releases` swallowed deletion failure; the maintenance branch always called `Recycle-ControlSupervisor`; supervisor restart reset the auto-update schedule and retriggered the same condition.
- Ownership-safe recovery evidence: v0.8.9 PID 6920/port 48833, v0.8.10 PID 6148/port 48831, and v0.8.11 PID 46692/port 48832 were each proven unrouted, exact-command/listener owned, `activeOperations=0`, `queued=0`, established connections=0, unsafe descendants=0 before stop/removal. After recovery only `v0.8.18-361289acc8d8` remained.
- Post-recovery production evidence: scheduled checks from 14:09 through 18:25 repeatedly logged `AUTO_UPDATE_CURRENT version=0.8.18`; no repeated supervisor recycle was observed.
- Product decision: cleanup-only maintenance must never restart a healthy supervisor. Restart is reserved for actual control-code promotion. Failed stale-release deletion is evidence, not a reason to churn the runtime.
- Windows implementation: `Cleanup-Releases` now records `RELEASE_CLEANUP_PASS/DEFER`, returns remaining cleanup items, and maintenance persists `CLEANUP_PENDING` without supervisor recycle when control code is already current.
- Linux implementation: current-release maintenance similarly separates cleanup-only work from control-code promotion/recycle and logs cleanup pending instead of restarting solely for stale artifacts.
- Behavioral regression 1: synthetic removable release directory was cleaned; output `RELEASE_CLEANUP_PASS` + `AUTO_UPDATE_CURRENT`; supervisor PID remained 40124; no recycle event.
- Behavioral regression 2: synthetic release contained an exclusively locked file; cleanup emitted `RELEASE_CLEANUP_DEFER` and `AUTO_UPDATE_CLEANUP_PENDING`; supervisor PID remained 40124 and no `SUPERVISOR_RECYCLE` appeared. Fixture/locker were then removed.
- Contract regression: updater test requires Windows and Linux cleanup-only branches to contain no supervisor recycle; focused updater contract 9/9 PASS.
- Full pre-version source validation: `npm run check`, `npm test`, `npm run audit`, Windows native GUI self-test, Linux shell parse, and diff integrity PASS; core 109/109, GUI 73/73.
- Status/Confidence: root cause CONFIRMED / live recovery PASS / product fix pre-release PASS / v0.8.19 publication OPEN at record creation.
- Reuse Targets: updater lifecycle, supervisor stability, GUI/tunnel reliability, stress-test methodology, incident postmortem, release acceptance.
- Provenance: production routes/process/listener/status/update-log evidence; isolated worktree `fix/v0819-maintenance-loop`; behavioral fixtures and regression tests described above.

## HISTORY — E045 delta

- 2026-09-21: Added confirmed maintenance-loop root cause, live orphan recovery, cleanup-only no-recycle architecture and two behavioral regression outcomes.


### E045 validation delta — full v0.8.19 source gates

- Version authority PASS: package=0.8.19, plugin=0.8.19, server runtime VERSION=0.8.19, Windows/Linux installer defaults=v0.8.19.
- Full release-candidate validation PASS: `npm run check`, `npm test`, `npm run audit`, Windows native no-input GUI self-test, Linux `bash -n`, and diff integrity all returned zero.
- Core suite: 109/109 PASS. GUI contract/helper/HTTP suite: 73/73 PASS. Security audit: PASS. Installer and onboarding checks: PASS. Source integrity: PASS.
- Existing GUI non-interference guards remain PASS: observe-only default, explicit takeover authorization requirement, single desktop lease, fresh single-use frame requirement, uncertain-outcome fail-closed behavior, and durable workflows forbidden from acquiring interactive desktop takeover.
- Status/Confidence: v0.8.19 source release candidate PASS / high. Commit/tag/artifact/publication/live-promotion gates remain OPEN at this record.


## E046 — v0.8.19 release closeout and persistent-terminal upgrade safety

- Date/Context: 2026-09-21, post-publication/live deployment verification of v0.8.19 and successor design.
- v0.8.19 release evidence: tag `v0.8.19^{}` resolves to `4538b1b7931c8f709dfb77553e21e22fd7b4dc9f`; GitHub release is public, Latest and immutable; draft-first verification matched 13/13 uploaded asset SHA-256 digests and byte sizes. Final installer ZIP SHA-256 is `2a909323b96df8f87f70a20fc14483d1548055921f9f1df27826cc2b4825f584`.
- Exact-tag installer acceptance: fresh Full Power install returned exact commit `4538b1b...`, package/server 0.8.19, 22 granted capabilities and GUI enabled; built-in check/test/audit completed successfully.
- Windows live evidence: both canonical profiles cut over to v0.8.19. `saeed-emad` retired v0.8.18 fully. `default` retained v0.8.18 as `route.previous` because the old backend owns three persistent PowerShell terminals. Read-only terminal evidence showed `term-3` running `H:\Nima\.venv\Scripts\python.exe -m http.server 8765 --bind 0.0.0.0`; no user workload was killed for cleanup.
- Linux live evidence: `aliemad-Labtop` runs exact v0.8.19 commit/package/runtime; route generation 5 has `previous=null`; only release `v0.8.19-4538b1b7931c` remains; updater lock is FREE; systemd user service is active; canonical health returns 0.8.19. Log records `AUTO_UPDATE_PASS version=0.8.19 commit=4538b1b...`.
- Newly confirmed gap: v0.8.19 cutover occurs before persistent-terminal admission. A terminal can therefore remain alive on the old backend while canonical routing moves to the new backend, preserving the process but losing normal canonical control of that terminal session. In addition, Windows zero-inflight retirement and Linux normal/cancellable retirement could stop an old backend without an explicit persistent-terminal check.
- External method evidence:
  - VS Code Terminal Advanced documents process reconnection and session detach/attach: https://code.visualstudio.com/docs/terminal/advanced
  - tmux documents a persistent server owning sessions independently of clients: https://github.com/tmux/tmux/wiki/Getting-Started
  - Kubernetes documents graceful endpoint/connection draining before termination: https://kubernetes.io/docs/tutorials/services/pods-and-endpoint-termination-flow/
- Decision: do not introduce a new cross-platform terminal broker in this change set. It would add a large native/IPC lifecycle surface. The minimum sufficient control is to defer automatic cutover when the current backend owns a Remote Commander interactive terminal and to re-check the same condition before every old-backend retirement.
- v0.8.20 implementation: Windows classifies only the direct child interactive shell shape emitted by `start_terminal` (`pwsh.exe -NoLogo -NoProfile`); Linux classifies direct child shell command lines containing `--noprofile --norc`. Non-interactive updater/run-shell children are not matched. Candidate processes are stopped before any route mutation and Windows persists `BLOCKED_PERSISTENT_TERMINALS`; both platforms log `AUTO_UPDATE_PERSISTENT_TERMINAL_BLOCK`. Deferred drain logs `DRAIN_PERSISTENT_TERMINAL_DEFER` before any backend stop.
- Focused regression: `node --test test/auto-update-contract.test.mjs` 9/9 PASS, Windows updater self-test PASS, Linux `bash -n` PASS, `git diff --check` PASS.
- Full pre-version regression: `npm run check`, `npm test`, `npm run audit`, Windows native GUI no-input self-test and Linux syntax PASS; source-integrity and security audit PASS. Core suite and GUI suite remain fully green.
- Status/Confidence: v0.8.19 release/live closeout CONFIRMED; persistent-terminal root cause/gap CONFIRMED; v0.8.20 source implementation PASS pre-release / high.
- Reuse Targets: updater lifecycle, persistent terminal semantics, safe rolling updates, incident postmortem, release acceptance, architecture rationale.
- Provenance: GitHub release/tag metadata; Windows route/process/terminal/read-only evidence; Linux live route/service/lock/log evidence; source worktree `fix/v0820-terminal-drain-admission`; official references above.

## HISTORY — E046 delta

- 2026-09-21: Recorded v0.8.19 immutable/live closeout and converted the remaining terminal-session cutover/retirement hazard into the bounded v0.8.20 terminal admission/drain guard.


### E046 validation delta — full v0.8.20 source gates

- Version authority PASS: package=0.8.20, plugin=0.8.20, server runtime VERSION=0.8.20, Windows/Linux installer defaults=v0.8.20.
- Full Windows/source validation PASS: `npm run check`, `npm test`, `npm run audit`, Windows native no-input GUI self-test, Linux `bash -n`, and diff integrity all returned zero.
- Core suite: 109/109 PASS. GUI contract/helper/HTTP suite: 73/73 PASS. Security audit, source-integrity, installer and onboarding checks: PASS.
- Terminal-update focused contract remains 9/9 PASS and requires both pre-cutover terminal admission and pre-retirement terminal checks on Windows and Linux.
- Status/Confidence: v0.8.20 source release candidate PASS / high. Exact committed-tree Linux validation, tag/artifact/publication and live rollout remain OPEN at this record.


### E046 release-authority delta — pushed commit and independent Linux validation

- Remote authority PASS: `origin/main` advanced by compare-before-push from audited baseline `4538b1b7931c8f709dfb77553e21e22fd7b4dc9f` to v0.8.20 code commit `c7c086c2900f5190423f30b60a78d000d94f2fb5`; destination tag `v0.8.20` did not exist at the authority check.
- Independent Linux validation used a clean detached checkout at exact commit `c7c086c2900f5190423f30b60a78d000d94f2fb5`, outside the active installation.
- Linux exact-commit results: package=0.8.20; working tree clean; `npm run check` exit 0; `npm test` exit 0; `npm run audit` PASS; `node --test test/auto-update-contract.test.mjs` 9/9 PASS; `bash -n auto-update-linux.sh` PASS.
- This independent validation did not mutate the live Linux route/runtime and did not require GUI interaction.
- Status/Confidence: committed v0.8.20 product code cross-platform validation PASS / high. Final documentation commit/tag/artifact/publication/live rollout remain OPEN at this record.

## E047 — v0.8.21 Linux GUI semantic rebase, zero-interference and benchmark evidence

- Date/Context: 2026-09-22 on aliemad-Labtop, after remote authority unexpectedly advanced from v0.8.18 to public v0.8.19/v0.8.20 during local GUI engineering.
- Authority handling: push was stopped on remote-main drift. The staged GUI candidate was backed up outside the repository at ~/.local/state/chatgpt-remote-commander/candidate-backups/v0.8.19-pre-upstream-audit.patch, SHA-256 13f7623fcd35e1e51cb5030d119c8406d8f9994faa4eac866127e557bf8af23b. A new worktree/branch was created from origin/main c7c086c (v0.8.20), and the candidate was applied with 3-way semantics. Upstream won every conflict first; GUI deltas were then reintroduced additively.
- Preserved upstream controls: cleanup-only maintenance/no-recycle from v0.8.19; persistent-terminal pre-cutover and pre-retirement guards from v0.8.20; candidate-first validation, rollback boundaries, route retirement and inherited lock protections remain intact.
- Linux GUI implementation: GNOME Shell extension plus Python helper; controller/server now report Linux backend support, but gui_status remains unavailable until the extension is active. Fresh install and control-promotion maintenance synchronize the extension; no forced logout/reboot/Shell restart occurs.
- Zero-interference policy: direct current-user request is required for takeover; default session remains observe-only; background work is preferred; workflow takeover is false; foreground interference by default is false. Regression is encoded in GUI and capability-profile tests.
- Updater network prevention: repository tags via git ls-remote --tags --refs are the primary stable-version discovery source; Releases API is fallback only after observed 403/timeout episodes.
- Scheduler semantics: automatic recovery/readiness is distinguished from model execution using automaticContinuationScope=RECOVERY_AND_READINESS_ONLY, automaticExecution=false and runnerConfigured=false.
- Performance evidence: direct backend p50 about 2.52 ms, stable-router p50 about 3.00 ms for 50 local system_status calls; 12 connector shell calls median about 1.81 s and p90 about 2.13 s. Inference: the local MCP core is not the dominant user-visible latency layer.
- Stress evidence: official Stockfish 19 Linux asset matched SHA-256 9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f; local bench searched 53,607,790 nodes in 6,540 ms (~8.20M nodes/s). Rapid manual play did not win; Rh3?? allowed Qxh3 and later evaluation was around -8.31, demonstrating that fast response and decision quality are separate acceptance dimensions.
- Comparative primary-source evidence checked 2026-09-22: OpenAI Help Center 'Using cloud browser in ChatGPT'; OpenAI Help Center 'Plugins in ChatGPT and Codex'; GitHub Docs 'Custom agents and sub-agent orchestration' and 'Custom agents configuration'; Anthropic 'Prompting best practices' section on subagent orchestration. These products provide managed browser/model/subagent runtimes that Remote Commander does not replicate.
- Comparative conclusion: global superiority over Work/Codex/Claude/Copilot is UNPROVEN. Evidence-backed differentiation is local real-machine control, explicit authority, zero-interference foreground policy, durable recovery/reconciliation, one-writer coordination, candidate-first zero-downtime updates, rollback boundaries and audit/evidence retention.
- Status/Confidence: semantic rebase IMPLEMENTED; focused checks PASS; full staged v0.8.21 source gates PASS (check/test/audit, core 109 PASS + 1 Windows-only skip, GUI 75/75, Linux GUI contract, Windows runtime contract, source-integrity, security audit); exact committed-tree/release/promotion gates OPEN; current-session Linux native GUI E2E OPEN.
- Reuse Targets: release notes, security model, performance guide, competitive positioning, incident prevention, Project Brain.
- Provenance: worktree /home/aliemad/source/repos/ChatGPTRemoteCommander-v0821; upstream commits 4538b1b and c7c086c; preserved candidate patch/hash; live GNOME probes and Stockfish benchmark artifacts under ~/.local/share/remote-commander-bench/stockfish19.


### E047 validation delta — full staged v0.8.21 gates

- Date/Context: 2026-09-22, complete v0.8.21 candidate after semantic merge with v0.8.20 runtime/update controls.
- PASS: `git diff --cached --check`, `npm run check`, `npm test`, `npm run audit`.
- Core suite: 110 total, 109 PASS, 1 Windows-only parser SKIP, 0 FAIL. GUI contract/helper/HTTP suite: 75/75 PASS. `LINUX_GUI_CONTRACT_PASS`, `WINDOWS_RUNTIME_CONTRACT_PASS`, `SOURCE_INTEGRITY_PASS`, `SECURITY_AUDIT_PASS`.
- Security audit: no tracked secret-key, tunnel-id, private-key, bearer-token, GitHub-token, local-config or developer-path finding.
- Remote CAS changed again after this run from c7c086c to d037663; the new upstream delta is documentation plus `.github/dependabot.yml`, not runtime/product code. Candidate is therefore preserved and must be rebased/validated again before publication rather than pushed blindly.


### E047 validation delta — post-d037 semantic rebase

- Date/Context: 2026-09-22 after rebasing the v0.8.21 release commit onto `origin/main=d03766331b0b5d0a3441bee44850c531e969fc81`, which added only Dependabot/Actions-maintenance governance evidence beyond c7c086c.
- Full validation PASS again: `npm run check`, `npm test`, `npm run audit`, diff integrity. Core suite 110 total / 109 PASS / 1 Windows-only skip; GUI suite 75/75 PASS; Linux GUI contract, Windows runtime contract, source-integrity and security audit PASS.
- No runtime/product conflict was introduced by the upstream governance commits. Both upstream Actions/billing evidence and v0.8.21 E047 history are retained append-only.
- Status: rebased source candidate PASS. Exact amended commit clean-checkout validation, remote-CAS push, tag/release, live Linux promotion and post-session native Linux GUI E2E remain OPEN.


## E048 — v0.8.22 unresolved-previous route invariant

- Date/Context: 2026-09-22, successor audit after immutable v0.8.21 added Linux GNOME/Wayland GUI support.
- Baseline authority: `origin/main=31414b65f8292fdc3111f9c31bf886e14458f0cb`; tag `v0.8.21^{}` resolves to the same commit; GitHub release v0.8.21 is public, non-prerelease, immutable, published 2026-09-22T01:43:59Z with 13 assets.
- Superseded evidence: v0.8.20 has an annotated tag resolving to `b08f4588a1812cad5081b77ea66d2ad9726fed20` but no GitHub Release. It remains unpublished candidate history only.
- Confirmed gap: `tools/router-switch.mjs` wrote `previous=current.active` without rejecting an already-populated `current.previous`; a new generation could therefore discard route authority for an older still-draining backend.
- Confirmed Windows gap: `Complete-DeferredDrains` could call `Stop-OldBackend` on zero-inflight/cancellable status before checking whether the old backend owned a Remote Commander persistent terminal.
- Prevention:
  1. Windows candidate promotion calls `Complete-DeferredDrains` before active-terminal admission and before any route mutation. Unresolved previous drains stop all unpromoted candidates and persist `BLOCKED_EXISTING_DRAIN` plus `AUTO_UPDATE_EXISTING_DRAIN_BLOCK`.
  2. Linux candidate promotion resolves `previous.port/configPath/projectDir` and calls `drain_previous_once` before active-terminal admission/route switch. Failure stops the candidate and logs `AUTO_UPDATE_EXISTING_DRAIN_BLOCK`.
  3. Windows `Complete-DeferredDrains` checks `Get-PersistentTerminalChildren $old` before all direct stop paths; terminal ownership logs `DRAIN_PERSISTENT_TERMINAL_DEFER` and remains pending.
  4. `tools/router-switch.mjs` independently rejects any switch while `current.previous` exists with `ROUTER_PREVIOUS_NOT_DRAINED`.
- Functional regression: router-switch is invoked against a synthetic route containing active+previous; it must fail with `ROUTER_PREVIOUS_NOT_DRAINED` and leave generation, active and previous byte-semantics unchanged.
- Integration preservation: v0.8.21 Linux GUI updater synchronization (`install_linux_gui_backend`), Git-tag-first discovery, zero-interference policy and Linux GUI contract assertions remain intact.
- Focused validation: combined updater/router suite 13/13 PASS; Windows updater self-test PASS; Linux `bash -n` PASS; `node --check tools/router-switch.mjs` PASS; `LINUX_GUI_CONTRACT_PASS`; diff integrity PASS.
- Method choice: keep one previous generation and make unresolved drain a hard admission barrier rather than expanding the route schema into an unbounded generation chain. This is the minimum sufficient control consistent with session draining and avoids a new terminal/session broker.
- Status/Confidence: root cause CONFIRMED / v0.8.22 focused implementation PASS / high; full release-candidate gates OPEN at record creation.
- Reuse Targets: blue/green update invariant, persistent-terminal safety, route authority, Linux GUI upgrade integration, release preflight.
- Provenance: baseline commit/tag/release metadata above; `auto-update-windows.ps1`, `auto-update-linux.sh`, `tools/router-switch.mjs`, `test/auto-update-contract.test.mjs`, `test/router-retire.test.mjs`.

## HISTORY — E048 delta

- 2026-09-22: Added hard unresolved-previous admission, complete terminal-safe deferred retirement and router-level nested-generation rejection on top of immutable v0.8.21.


### E048 validation delta — full v0.8.22 source gates

- Version authority PASS: package/plugin/server=0.8.22; Windows and Linux installer defaults=v0.8.22.
- Complete release-candidate validation PASS: `npm run check`, `npm test`, `npm run audit`, Windows native no-input GUI self-test, Linux shell syntax, Linux GUI contract and diff integrity.
- Core suite: 111/111 PASS. GUI suite: 75/75 PASS. `LINUX_GUI_CONTRACT_PASS`, `WINDOWS_RUNTIME_CONTRACT_PASS`, `SOURCE_INTEGRITY_PASS`, `SECURITY_AUDIT_PASS`, installer/onboarding PASS.
- v0.8.21 zero-interference and Linux GNOME/Wayland functionality remains covered by the same full regression suite.
- Status/Confidence: v0.8.22 source release candidate PASS / high. Commit/CAS, independent exact-commit Linux validation, tag/artifact/publication/live rollout remain OPEN.


### E048 exact-commit Linux validation delta

- Remote product-code authority: `origin/main=968ac2d10da8cc30c66827c625e4a7da636194a3`.
- Independent Linux validation used a fresh detached clone at that exact commit; active Linux runtime and GNOME session were not mutated.
- Exact checkout was clean and package version was 0.8.22.
- PASS: `npm run check`, `npm test`, `npm run audit`, focused updater/router suite 13/13, `LINUX_GUI_CONTRACT_PASS`, `bash -n auto-update-linux.sh`.
- Security audit reported no secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked local-config or developer-path finding.
- Status/Confidence: exact committed v0.8.22 product tree cross-platform validation PASS / high. Final documentation commit, tag, exact-tag installer/artifacts, publication and live rollout remain OPEN.


## E049 — v0.8.22 immutable release and live rollout closeout

- Date/Context: 2026-09-22, final post-publication/live acceptance after immutable v0.8.22 publication.
- Release authority / CONFIRMED: `origin/main` and `v0.8.22^{}` resolve to `cc736eb5bc457972120a60b22d59b19219e9f659`. GitHub Release v0.8.22 is public, Latest, non-prerelease and immutable. Publication timestamp: 2026-09-22T02:01:46Z.
- Artifact authority / CONFIRMED: release contains 13 uploaded assets. `ChatGPT-Remote-Commander-v0.8.22-Installer.zip` size=168773 bytes, GitHub SHA-256 digest=`7c8cdab91ddabc982248fc66982d845765522ad56724dca8fd4c47348269b8bd`. Exact-tag Windows sandbox installer acceptance had already PASSed with Full Power, GUI enabled and zero-interference policy.
- Linux rollout / PASS: control/runtime exact commit `cc736eb...`; route generation 9 active v0.8.22, `previous=null`; only release directory `v0.8.22-cc736eb5bc45`; updater lock FREE; systemd user service active; Full Power preserved; second exact updater run returned `AUTO_UPDATE_CURRENT version=0.8.22`.
- Linux GUI installation / PARTIAL-VALIDATION: runtime reports GNOME/Wayland GUI backend support and policy enabled. The GNOME extension `chatgpt-remote-commander@god13emad` is installed and Enabled, but GNOME Shell 46 current Wayland session reports State=INACTIVE and MCP `gui_status` reports `GUI_GNOME_EXTENSION_UNAVAILABLE`. No forced Shell restart, logout or reboot was performed. Status=`DEFERRED_SESSION_ACTIVATION`; native interactive Linux GUI E2E remains UNPROVEN for the current already-running session.
- Windows first v0.8.22 attempt / SAFE FAIL-CLOSED: when the v0.8.21 updater staged v0.8.22, candidate gates passed but the staged v0.8.22 router-switch refused unresolved `route.previous`; receipt was `FAILED / ROUTER_SWITCH_FAIL profile=default`, with no route mutation. This demonstrated the router-level `ROUTER_PREVIOUS_NOT_DRAINED` invariant under mixed-version self-update.
- Windows control-plane handoff / PASS: tracked-clean installed control checkout was advanced directly from v0.8.21 `31414b65...` to exact v0.8.22 `cc736eb...` after exact tag fetch/commit verification, without route cutover, GUI mutation or supervisor restart.
- Windows v0.8.22 updater / PASS-AS-SAFE-BLOCKER: both default and saeed-emad v0.8.22 candidates passed doctor/hardware/shadow/live-store compatibility. Before any route mutation the updater found an unresolved default previous generation with six direct Remote Commander persistent terminal children (PIDs 19072, 2760, 31592, 12248, 17564, 23576), logged `DRAIN_PERSISTENT_TERMINAL_DEFER` and exited with receipt status `BLOCKED_EXISTING_DRAIN` / `AUTO_UPDATE_EXISTING_DRAIN_BLOCK profiles=default`.
- Windows preservation evidence: default route remains generation 19, active v0.8.21 and previous v0.8.19; saeed-emad remains generation 20, active v0.8.21 with `previous=null`. No candidate listeners remained on staged ports 48832/48835. Supervisor PID remained 30584. Existing old backend has live persistent terminals and a router-recorded non-cancellable `run_shell` request; it was not force-stopped.
- Desktop non-interference / PASS: this release/rollout closeout used no mouse movement, click, keyboard injection, window focus mutation, logout, reboot or GNOME Shell restart.
- Decision: v0.8.22 product/release engineering is FINAL/PASS and Linux runtime rollout is FINAL/PASS. Windows control-plane is v0.8.22 and the runtime cutover is intentionally `SAFE_DEFERRED_BY_LIVE_USER_WORKLOAD`; it must complete only after the user-owned persistent terminals/old request end safely. Linux native GUI activation is `DEFERRED_SESSION_ACTIVATION` until a normal future GNOME session lifecycle makes the installed extension active.
- Non-claim: universal superiority over Work/Codex/Claude/Copilot remains UNPROVEN; the release claim is limited to the verified Remote Commander capabilities and safety properties above.
- Reuse Targets: release acceptance, self-update mixed-version handoff, persistent-terminal safety, Linux Wayland GUI activation, operator handoff.
- Provenance: GitHub release API/tag refs; Windows control/route/receipt/process/router evidence; Linux route/service/lock/update-log/system_status/GNOME extension evidence.
- Status/Confidence: release FINAL/PASS; Linux rollout FINAL/PASS; Windows runtime rollout SAFE-DEFERRED; current-session Linux native GUI E2E DEFERRED/UNPROVEN / high.

## HISTORY — E049 delta

- 2026-09-22: Closed immutable v0.8.22 release engineering and Linux deployment, proved Windows mixed-version fail-closed plus v0.8.22 safe blocker behavior, and retained live user terminals and current GNOME Wayland session without disruptive cleanup.
