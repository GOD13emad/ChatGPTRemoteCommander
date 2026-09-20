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
