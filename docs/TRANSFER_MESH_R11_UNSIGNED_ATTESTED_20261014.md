# Commander Transfer Mesh R11 — Version-scoped unsigned Windows distribution

Date: 2026-10-14
Branch: feature/commander-transfer-mesh-r05; PR #202 Draft.
User release constraint: verified Windows Authenticode certificate cannot be obtained in Iran. Do not describe the unsigned final installer as Authenticode signed.

## Real security model
- Windows setup may be unsigned for one explicitly audited release tag only: `v0.10.21`. The version-scoped opt-in is tracked in `docs/UNSIGNED_WINDOWS_RELEASE_POLICY.json`; any unsigned later version is denied until the owner records a fresh reviewed decision.
- Existing final-EXE `Get-AuthenticodeSignature` check remains and reports `installer_signed` from `Status=Valid` and a non-null signer certificate.
- On production tag release, before publication require annotated tag points to exact source commit, matching version docs, fixed 20-asset manifest and valid SHA256SUMS.txt.
- `tools/verify-windows-release-policy.mjs` enforces Authenticode-signed or explicitly permitted unsigned-mode, exact tag, recorded risk acknowledgement and release notes warning about SmartScreen.
- GitHub `actions/attest` generates signed Sigstore SLSA build provenance. `gh attestation verify` then checks the specific Windows setup against the repository, the release tag/source commit and exact signer workflow, with bounded retries. Failure prevents `gh release create`.
- PR builds may create unsigned test artifacts without publishing; no automated unattended update permission follows from this policy.
- End users must verify SHA-256 and provenance, and obey OS security controls; SmartScreen may warn, Smart App Control may block. No Windows security bypass.

## Boundaries
SHA-256 protects integrity **against a known trustworthy reference** but does not independently authenticate publisher identity; GitHub Attestation authenticates GitHub build provenance, not software benignness or Authenticode publisher trust. A compromise of repository/workflow or CI could still affect the release.
Secure updater/publisher release mode must not confuse unsigned provenance-approved mode with Authenticode signed mode.

## Completed evidence
- R10 commit b2599eb0b2ba75db9a13c56d71654e1678180ff6: GitHub CI, Server Install Canary, Windows isolated updater NoPromote and Release Sync all SUCCESS.
- R11 release policy unit tests seven scenarios PASS locally. Release-assets contract checks required exact source/attestation order; PASS.
- Full local npm run check and npm test run separately; capture exit code before declaring final.
- Four stable Commander Core connectors remain v0.10.20. No on-device Core upgrade or deletion, network/firewall changes, OS reboot, or automatic browser-login disruption authorized by this release-policy-only change.

## Remaining actual product gates
R11 GitHub CI readback. An annotated release tag and functioning attestation verification on actual tag workflow have NOT been executed at this moment. Signed Linux/Windows installers, native compatible four-device rollout plus verified automatic rollback, power-loss/OS-reboot recovery and retention/direct-versus-relay performance still need qualification. Full product status remains PARTIAL_NOT_FINAL.

## Official source references
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline
- https://cli.github.com/manual/gh_attestation_verify
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
