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
