# Release Train 0.12 — `0.12.0-dev.1` (NoPromote)

## Purpose

Create one unified development line for the cross-platform Remote Commander suite. This identity supersedes the local-only `0.11.0-dev.105` preview as the current development candidate; it does not erase or rewrite historical releases, branches, tags, or Commander 2 lineage.

## Source authority

- Exact recovered base commit: `40256873627780cc7b62359935e43bac5ef856b3` from the owner-local immutable `0.11.0-dev.23` release checkout.
- Current candidate worktree: `integration/v108-dev105-dev23-20261107`; the latest verified implementation checkpoint is `2dc5cf6f899b7d111a520437ad3586b7c67a6bec` (`0.12.0-dev.1`), including the accepted V1-05 integration and V1-08 candidate-version updater fix. The worktree was clean on 2026-11-08 at verification. This is a private QA candidate, not a signed or published release.
- The V1-05 accepted source commit is `110f25ceef30c2058a886c04dc2d0d699c549ec0`; it was integrated into this QA candidate as nine paths (+580/-30).
- Commander 2 / `0.11.0-dev.19` is a separate source lineage. Its capabilities must be selectively reconciled and tested; do not copy its whole repository or merge by directory replacement.
- V1-07 Windows Handoff ownership guard is adopted from accepted upstream commit `20e5577406644e620d7673fe3ae58d749c64a66a` (upstream worktree SHA-256 `922a55a2909cd3f0d933570adf6c8759ffb7cddeb8c80607a2ae2c52a32ee14f`). The V1-08 portable variant keeps `$env:USERPROFILE` as the default instead of the upstream machine-specific path, while preserving SID-qualified Router/Tunnel listener proof, uncertain-state fail-closed behavior and Headless service exclusion. Native mocked listener ownership was verified on Windows (15/15), not a real signed SYSTEM boot/login cutover.
- V1-00 retains sole ownership of canonical Main integration. V1-08 owns release metadata, immutable packaging, updater qualification and staged host migration.

## Integration contract

One canonical repository and one release manifest; native Windows and Linux payloads selected by host capability; shared capability and authorization contracts; reusable upstream browser, GUI, workflow, AI/provider, plugin and installer components where their source/provenance and security contracts pass. Each module owner supplies an accepted source delta and tests; V1-00 coordinates one-writer integration; V1-08 packages the exact frozen tree. Preserve OS-specific adapters and the distinction between STANDARD, FULL_POWER and operational FULL_ACCESS.

## Update policy

The existing updater mechanisms remain version-aware and rollback-capable, but this candidate does not authorize automatic installation. Keep auto-update approval false until signed/provenance-verified artifacts, opt-in channel semantics, host compatibility, protected negative/positive authorization, rollback and owner-approved canary are proven. Do not switch the public GitHub Latest channel to a prerelease. No background self-update or service restart is implied by this metadata.

## Acceptance status

`INTEGRATION_CANDIDATE_NOT_FINAL`; all release acceptance flags remain false. Previously recorded tests apply only to their exact source/test scope. Remaining owner gates include source reconciliation for V1-01 through V1-10, Commander 2 capability integration, exact Windows/Linux package parity, real OAuth/JWKS/client identity, native J01, signed same-chat ACK/grant/revocation, protected V2 listener, original-host boot/login, publisher provenance/signing, and controlled canary/rollback.

## Migration and retirement

Do not delete historical branches, release directories, tags or installed versions while they are active, referenced, dirty, or needed for rollback. Retire only after exact target version/hash is installed, health and permissions verified, rollback proven, and no process or route depends on the old source. Offline hosts remain pending; do not force-disconnect or overwrite them.

## Machine authority

See [release-train-0.12.json](release-train-0.12.json). It is the sole 0.12 release manifest. Update it semantically in place as owner gates close; do not create revision-suffixed competing manifests.


## V1-08 direct-installer version 12 defaults — 2026-11-08

The four direct desktop/server installers for Windows and Linux and their existing installer regression assertions have been changed on this 0.12 development candidate from pinned `v0.10.24` to the intended immutable `v0.12.0` Git ref. There is **no published `v0.12.0` tag** yet: an unqualified default direct install must reject/fail closed rather than silently install an older version. Explicit exact-commit source selection remains available for controlled QA and recovery. No installed fleet profile, GUI input permission, rollback evidence, public release or automatic update was changed.

Scope: 5 files, 11 additions / 11 removals; source bytes/readback verified, no unrelated changes. Linux `test/installer-check.mjs`, `bash -n` for both Linux scripts, `git diff --check`, release train + SemVer tests 6/6 PASS, and updater monotonic 1 PASS/7 Windows-only SKIP. Separate Windows QA on the same pre-edit file hashes demonstrated native installer contract PASS, Windows PowerShell parsing and Windows updater monotonic 8/8 PASS. These are scoped contracts, not 0.12 native installed product acceptance.

Verification snapshot for commit `2dc5cf6f`: Linux updater/installer contract 50 tests (46 PASS, 4 platform SKIP), capability/GUI tests 129/129 PASS, release-distribution/security 9/9 PASS; all were source-level/fixture acceptance, not live Windows/Server/fleet installation. `docs/release-train-0.12.json` remains `INTEGRATION_CANDIDATE_NOT_FINAL` with publication, autoupdate and installed promotion false; public `v0.12.0` tag absent on 2026-11-08. Operational FULL_ACCESS / mouse and keyboard per-user consent remains OPEN.

**Windows direct-compiler fail-closed repair:** `installer/RemoteCommander.iss` now errors at preprocessing if exact package version, source commit, or source ref are not provided by the build script; previously, direct ISCC invocations silently fell back to 0.10.18 development metadata. `installer/build-setup.ps1` rejects `-VersionOverride` that differs from `package.json`, preventing a newer build from being labeled as an older release. The historical 0.10.26 identity regression now checks version-scoped installer defaults without changing the historical unsigned-Preview policy. Focused Linux source QA: 24/24 unified-installer tests PASS and 6 PASS/1 Windows-only SKIP on historical release identity. No native Windows ISCC compile, signed package, installed fleet, or public 0.12 acceptance is claimed.

Next: integrate this exact-source candidate with V1-00 accepted owner deltas, qualify a fresh 0.12 installer on real Windows/Linux/server hosts with user-session mouse/keyboard grant and revocation checks, release immutable version/hash, then stage user-local profile updates with health/rollback readback. Full Power does not supersede OS Administrator/root, SID/UID session bindings or owner consent.
