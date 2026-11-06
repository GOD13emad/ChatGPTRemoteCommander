# Remote Commander Core v0.10.21

## 2026-10-14 verified source integration (R498, before immutable tag)

The 0.10.21 release **source** is now integrated on `main` at commit `bf9df020cbe7943ab20548685c13f49909cb9ff9`. The merged tree is `5ffd0e398cf90b1140d0feb119d5613e35249df0`. Two post-merge workflows, CI and Release Sync, succeeded for that exact commit. The source branch's six pre-merge workflows (Windows/Ubuntu CI, Windows NoPromote updater, Linux isolated real promotion and rollback, Server Install Canary, Release Sync) succeeded at `9ae1448271725c3b02c5f74bf0b66c5a15dc2b8a`. The exact tag build, 20-asset checksum manifest, final Windows setup attestation and tag publication are **separate gates** and must succeed before `v0.10.21` is described as released.

Integrated features and safeguards include:
- The Core process-tree ownership and bounded Windows qualification repair, including the isolated descendant-stop regression; no timeout or coverage relaxation.
- Commander Transfer Mesh V2 portable backend, durable/quotas/resume support, pilot CLI, tests and explicit no-secret-scoping guards. A retained real 10 GiB Emad-PC to Emad-Linux two-host payload was SHA-256 verified on both endpoints; four-host rollout and arbitrary power-loss acceptance remain separate.
- Durable native GUI J01 no-replay incident storage and fail-closed protection **for new candidate operations**. This does **not** determine or clear the existing `NATIVE_OUTCOME_UNCERTAIN_RESTART_REQUIRED` historical outcome on Emad Windows. Do not restart or replay to force clearance.
- Source-level Control Center functionality and visual contracts available in `main`; owner native visual, installed binary, accessibility, icon, RTL/HiDPI and profile-continuity acceptance remain open. The installed Desktop is a separate product from Core.
- Stable browser `v0.8.1` remains separate. No automatic Chrome sandbox bypass, login/cookie migration, GUI takeover or broad auto-deployment is included.

**Not included/accepted:** optional model planner PR #204 and its local-only R496 integration are not present in this source commit; it remains proposal-only with no autonomous Runner enabled. Authenticated Work/MCP Events same-chat reply (PR #199), four-host delivery, final Power-Loss/soak, and canonical cumulative account-transfer Brain remain open. The Saeid host is unreachable through its tunnel, possibly powered off; it is not diagnosed as broken.

**Distribution policy:** the Windows executable is unsigned in Authenticode. The exact-version allowlist plus the tagged GitHub Sigstore provenance and final installer SHA-256 must be verified by release automation *before* an immutable Release is created. Never suppress SmartScreen or Smart App Control. Source CI success is not publisher trust or authorization for unattended in-place upgrade. Preserve Core v0.10.20 as rollback baseline on all user hosts until qualified serial installation and validation.


## Scope

This narrow successor to immutable Core v0.10.20 fixes a Windows updater qualification escape of detached Node child/grandchild processes. The Windows native Job runner now launches executable targets suspended, assigns them to a kill-on-close Job before resume, invokes the verified npm CLI through Node, and rejects unsupported shell wrappers. It retains ownership, failure, timeout and zero-orphan verification.

## Qualification and boundaries

The exact fix source of PR #174 (`c0c4d8dac264d7e1745df486492ceaac3584eecd`) passed hosted Windows/Ubuntu CI, native Windows descendant/listener regressions, full isolated Windows check:qualification, test:qualification and security audit, plus a separate real isolated updater -NoPromote candidate-first E2E yielding CANDIDATE_PASS. None of these historic pre-version-bump checks alone accepts the v0.10.21 release commit or authorizes a live machine cutover.

Release requires new exact-version Windows/Linux hosted CI, server/installer canaries, immutable annotated tag and 20-asset SHA-256 attestation, then serial safe live promotion with rollback/protocol identity verification. The existing stable baseline remains in place until those gates pass.

## Unchanged dependency and user controls

- Browser stays at immutable v0.8.1; no Browser 0.8.2/0.8.3 preview is silently promoted.
- No browser login/cookie migration, no root/sandbox bypass, no unattended GUI takeover, no automatic Commander Codex launch or enabled autonomous Runner is added.
- Native Browser/Control Center visual acceptance, authenticated same-chat workflow ACK, signer trust, complete fleet rollback and integrated product FINAL remain separate open gates.
- No reboot, shutdown or logout is performed by this patch.

See `docs/RELEASE_AUTHORITY.md` for dated released-baseline authority; older historical Brain and roadmap "CURRENT" labels are preserved as history.

## Windows installer: UNSIGNED — explicit distribution limitation

Windows installer: UNSIGNED. No trusted Authenticode publisher certificate is available for this version. Windows Defender SmartScreen or Smart App Control may warn or block execution. Do not disable or bypass those protections. Before considering the downloaded file, verify its SHA-256 against the immutable GitHub Release SHA256SUMS.txt and verify the GitHub attestation tied to the official repository, release tag and build workflow (see docs/UNSIGNED_WINDOWS_RELEASE_POLICY.md). A GitHub attestation proves build provenance, not OS publisher trust, software harmlessness or compatibility. Production unattended auto-update must not treat an unsigned release as equivalent to an Authenticode-signed release.
