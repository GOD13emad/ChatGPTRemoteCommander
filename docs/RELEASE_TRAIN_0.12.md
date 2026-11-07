# Release Train 0.12 — `0.12.0-dev.1` (NoPromote)

## Purpose

Create one unified development line for the cross-platform Remote Commander suite. This identity supersedes the local-only `0.11.0-dev.105` preview as the current development candidate; it does not erase or rewrite historical releases, branches, tags, or Commander 2 lineage.

## Source authority

- Exact recovered base commit: `40256873627780cc7b62359935e43bac5ef856b3` from the owner-local immutable `0.11.0-dev.23` release checkout.
- Current candidate worktree: `integration/v108-dev105-dev23-20261107`; it contains the accepted V1-05 integration and V1-08 candidate-version updater fix, alongside uncommitted V1-08 release-train edits. It is a private QA worktree, not a clean signed release commit.
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
