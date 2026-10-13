# Remote Commander Core v0.10.21

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
