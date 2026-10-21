# Remote Commander Core v0.10.26 — SOURCE CANDIDATE ONLY

**State: NOT TAGGED, NOT RELEASED, NOT INSTALLED, NOT APPROVED FOR UNSIGNED DISTRIBUTION.**

This document identifies a prospective, independently versioned Core source candidate based on the protected `main` source at `66dfe5e0097ba2a246dd3374140b8619b74a6888` (2026-10-21). It is not a publisher release note and is not an approval record. It preserves the publicly published immutable `v0.10.25` **UNSIGNED Preview** and the separately maintained `v0.10.20` Stable. The source candidate adds **no entitlement to replace** either release or modify their assets.

## Source-only scope

- Consistently identify version `0.10.26` in `package.json`, MCP server status, Plugin templates and Windows Desktop assembly metadata.
- Carry forward qualified source-only bounded read-only observation admission fixes from PRs #320/#322 and the exact-head Windows CI scheduling correction from PR #324.
- Retain installer defaults, stable updater channel, current user profiles, durable journal/incident J01 state and existing rollback copies unchanged.
- Preserve a separate, non-publishing test identity; source CI and disposable promotion/rollback PASS do not equal installation acceptance.

## Release admission: BLOCKED

An unsigned Windows Setup for `v0.10.26` is **not authorized**. The version-specific `docs/UNSIGNED_WINDOWS_RELEASE_POLICY_0.10.25.json` authorizes **only v0.10.25** and does NOT authorize unsigned v0.10.26. The historical v0.10.24 policy does not authorize this version either. The checked-in Windows release verifier must reject `v0.10.26` as unsigned. No new policy waiver is created here.

Before any immutable tag, installer upload, GitHub public release or Stable promotion, independently prove: (1) exact source SHA and reproducible 20-asset package/attestation integrity, including a newly authored exact-version release note; (2) Authenticode signer verification **or** a distinct owner-authorized, version-scoped unsigned Preview with documented SmartScreen/Unknown Publisher risk and GitHub provenance; (3) hosted Windows and Ubuntu full qualification, CodeQL, version-specific Windows NoPromote and reversible isolated installer tests; (4) opt-in named first host/profile, data checkpoint, production-route continuity, rollback and readback; (5) J01 and independent authorized GUI acceptance insofar as they are claimed in release notes. No security control may be bypassed.

**Publisher/legal attribution:** TandemVector Labs (GitHub organization brand); principal source maintainer Dr. Aliakbar Emadoddin. Brand and repository provenance are not an Authenticode certificate or operating-system publisher trust.

## Next decision

Complete source candidate qualification and reviewer reconciliation with concurrent PRs. Hold any `v0.10.26` release/signing/install until its own accepted publisher admission. Do not assert Fleet FINAL, independently authenticated ChatGPT multi-seat GUI or J01 owner disposition from this source candidate.
