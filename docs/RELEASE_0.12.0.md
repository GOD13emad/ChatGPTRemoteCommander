# Commander 1 v0.12.0 — authorized UNSIGNED Stable release, pending independent acceptance

**Release status:** The project owner expressly authorized public distribution as an **UNSIGNED Stable** release of Commander 1 `v0.12.0` on **2026-11-10**. This document records the version-specific *signature waiver*, not a published GitHub Release, completed installation, successful hosted CI, or final Stable acceptance. The release train is currently `INTEGRATION_CANDIDATE_NOT_FINAL` / `NoPromote`. Do **not** create the `v0.12.0` tag, release, Latest-channel switch, or unattended fleet update before the remaining independent gates pass.

**Project brand:** TandemVector Labs (project metadata, not a Windows-trusted publisher). Source: https://github.com/GOD13emad/ChatGPTRemoteCommander. Principal source maintainer: Dr. Aliakbar Emadoddin (@GOD13emad). Supporting maintainer: MMZ (@mohammadmohammadzadeh19960-code).

## Windows installer: UNSIGNED

The Windows installer will have **no Authenticode publisher signature**; Windows may identify it as **Unknown publisher**. Microsoft Defender **SmartScreen** can warn or block the download or execution, and **Smart App Control** or organization policy may block unsigned software completely. Do not disable, bypass, weaken, or provide instructions to bypass those protections. The brand, GitHub repository, SHA-256 checksums and **GitHub attestation** (GitHub Sigstore build provenance) **do not replace Authenticode** and do not establish Microsoft-trusted publisher identity.

The owner authorizes distribution without a signing certificate for **this exact `v0.12.0` Stable version only**. The authorization is **not** evidence that the code, GUI, all features, installed access, or fleet is ready. The existing independent requirements for production admission, required features, OS compatibility, exact-source CI, release integrity and safe rollback remain mandatory. Do not silently elevate access rights or mutate existing profiles.

## Integrity and public release admission

1. Freeze a single exact `v0.12.0` source commit and annotated Git tag. Build Windows and Linux release assets from that tree; verify the version inside each binary/package is `0.12.0`, not `0.12.0-dev.1`.
2. Run and pass hosted Windows and Linux CI plus the exact release-specific R157 installation/rollback workflows. Confirm all required product components against the same source and published artifact identifiers; a local QA PASS is not a hosted or installed PASS.
3. Produce a complete `SHA256SUMS.txt` for every immutable released binary; verify each byte against the download. Verify the **GitHub attestation** and expected signer workflow tied to the repository, tag, commit and SHA-256. These controls establish integrity/build provenance, **not** Authenticode.
4. Verify that Windows artifacts report `NotSigned`, and that the published unsigned release notice documents SmartScreen, Smart App Control and Unknown publisher. The version-scoped waiver is in `docs/UNSIGNED_WINDOWS_RELEASE_POLICY_0.12.0.json`.
5. Obtain real owner-approved G1/J01 and native GUI positive/negative evidence, authenticated installed version and rollback on Windows/Linux/Headless, all mandatory feature receipts, then reconcile actual host identity mapping and accept all eight known connectors before `RELEASE_APPROVED`. Offline targets remain pending.
6. Never label the build `Stable` based solely on a manifest edit, tag, a passing test script, or this waiver. Preserve the previously installed version and its rollback data until exact candidate installation has been independently verified.

## Current bounded, not-yet-released QA evidence

The integrated **development** source commit `8c1993eadb7d4370d90238967f0830877b1e3ab8` passed local source `check:qualification`, `test:qualification` and historical security scan, and produced unsigned QA binaries. These are **not** assets for a `v0.12.0` Stable release until version identities and release gates close.

- Windows QA installer (`0.12.0-dev.1`) SHA-256: `1bb725a817323910dc0e763d04cbcd6122b9c4af470e249cee967efff5fdfc2c`.
- Windows QA Desktop SHA-256: `ce034581a72681c96721a08f931a4550940e6b255a636ed096aeb6b207ecaa9d`.
- Linux QA .deb (`0.12.0~dev1-2`, pinned Node.js `22.23.4`) SHA-256: `374430a54bfc621bb33f6252f501c1604a12d5091b4a44cf936e6021a0a4def2`.

At the last verified release manifest snapshot, `isStable=false`, `publishApproved=false`, and `fleetCoverage.acceptedHostIds=[]` (0/8). GitHub-hosted CI/R157 and real production G1/J01, install, rollback and publisher provenance remain unverified for this exact development commit. New upstream Node.js security advisories must be assessed again at the time of release.

**Unsigned authorization is now accepted. Stable distribution is conditional on the remaining independent release acceptance gates; no public publication is claimed by this file.**
