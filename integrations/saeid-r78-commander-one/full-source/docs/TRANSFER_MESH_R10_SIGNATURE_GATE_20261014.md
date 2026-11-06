# Commander Transfer Mesh R10 — Windows Release Signature Gate

Date: 2026-10-14. Branch: feature/commander-transfer-mesh-r05. Parent R09 commit: eea7835f2171f3de853ecd6e84ee9a69582253aa. PR #202 DRAFT.

## Verified existing release evidence
- R09 GitHub Actions workflows all completed successfully: CI, Server Install Canary, Release Sync, Windows isolated updater NoPromote R157.
- Release Sync R09 Windows setup builder log reported SHA256 4c692ea24823c21d5e4fc8e7bbcdf23a61567ebebc1d1c1619093b1ddb270e8d for Remote-Commander-Setup-v0.10.21.exe and `signatureStatus: NotSigned`.
- The verified Inno Setup compiler and the bundled browser dependency may each be signed/pinned, but their signatures DO NOT sign the final Windows setup.
- Stable live installed Core on Emad PC, Emad Linux laptop, EmadServer and AmirrezaServer remains v0.10.20. Syncthing user-scoped portable pilot v2.1.6 is healthy on all four devices. No stable runtime promotion is approved by this change.

## R10 gate
- Windows setup build job records Authenticode status from the FINAL generated setup using `Get-AuthenticodeSignature`; only `Status=Valid` with non-null signer certificate produces the job output `installer_signed=true`.
- Tagged immutable publication on the Ubuntu publish job is blocked immediately after annotated-tag/asset identity checks and BEFORE Sigstore attestation or `gh release create` unless `installer_signed=true`.
- PRs continue to build unsigned test artifacts. Hash and Sigstore provenance alone do not satisfy Authenticode code-signing policy.
- Existing immutable-tag, fixed 20-asset manifest and signed attestation guards remain intact.
- `test/release-assets-contract.test.mjs` checks signature guard presence and ordering. This prevents accidental removal of the required production-only check.

## What this does NOT do
This does not issue, purchase or import a code-signing certificate or sign the installer. A valid authorized certificate and secure CI signing service must be configured by the repository owner to make the production publication gate PASS. Do not place private keys or PFX content in commits, logs or chat.

## Open product gates
1. Green CI for R10 exact commit.
2. Authenticode-sign final Windows setup with authorized identity, then verify status and publisher.
3. Verified signed Linux / Windows installers and live rollback rehearsal with an immutable pre-upgrade backup.
4. Atomic version-matched Core and durable-send.mjs deployment on each host with allowedRoot and hashes; native tool listing/readback across four stable devices.
5. OS reboot/login recovery, staged/mixed-version compatibility, retention and cancellation concurrent stress.
6. Relay privacy and measurable direct-versus-relay bandwidth improvement; no firewall or UPnP automation without owner-reviewed networking changes.

## Handoff
R09 native canary on Emad PC from the exact GitHub commit exposed 8 native transfer tools, rejected a 4KiB synthetic source at 1KiB cap with no job, queued/published a 512B permitted synthetic source with equal SHA256. Loopback 47996 canary stopped and its dedicated temporary root/launcher cleaned after identity/hash checks. Linux R09 isolated canary launcher creation was blocked by host safety checks, no bypass attempted; prior Linux R09 native unit tests 6/6 PASS. All Core stable nodes unchanged.

Official Syncthing docs:
- https://docs.syncthing.net/users/firewall.html
- https://docs.syncthing.net/users/syncing.html
