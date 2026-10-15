# Windows unsigned release policy — v0.10.24: NOT YET AUTHORIZED

The prior v0.10.23 unsigned-with-provenance exception is explicitly NOT reused for v0.10.24. The active policy sets allowUnsignedWithGitHubAttestation=false and scope=only-this-version.

- A true Authenticode publisher-signed installer may pass the signed route if version/tag match.
- An unsigned installer, even with valid SHA256SUMS and GitHub Sigstore provenance, is currently denied. Source provenance cannot provide Windows publisher identity or prevent SmartScreen warnings.
- No security dialog, Smart App Control policy, code signing or release tag should be bypassed, rewritten or suppressed.
- The 20 assets, annotated immutable exact tag, notes, attestation source-ref/commit/signer and client-side checksum checks remain mandatory whenever a release is independently authorized.
- Automatic Stable promotion and unattended fleet update remain forbidden until all native user, data-continuity and rollout gates close. Core v0.10.20 stays Stable, and old v0.10.23 Draft stays immutable.

A new scoped owner approval would require an independently reviewed policy and regression change. This document itself does NOT grant approval.
