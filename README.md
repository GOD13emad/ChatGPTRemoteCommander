# Commander V2 2.1.50 — UNSIGNED QA PRE-RELEASE (2026-11-05)

**Pre-release only. Not a stable, production-ready, full-access or auto-migration release.** The owner explicitly authorized distribution without code signing. Do not treat the Windows security warning or Linux package trust warning as evidence that the binary is trusted. Verify SHA-256 against the checksums shipped with this release before running.

## Payloads
- `Commander-V2-Windows-x64.exe` — Windows x64 NSIS installer, unsigned
- `Commander-V2-Linux-x64.deb` — Linux amd64 DEB, unsigned
- `Commander-V2-Linux-x64.AppImage` — Linux x64 AppImage, unsigned
- `SHA256SUMS.txt` — pinned hashes for all three binaries

## QA scope
Electron application branded Commander V2, derived from Chat On Steroids 2.1.50, with a bundled isolated V1 Core development runtime. The internal QA MCP runtime has an ephemeral per-process bearer and rejects absent/wrong bearer, untrusted Host and Origin; the embedded runtime is **disabled by default** and requires explicitly gated isolated QA activation. This is **not ChatGPT OAuth sign-in**, permission to use arbitrary saved browser sessions, Administrator/Root, a certified full-power workstation agent, or verified cross-platform GUI/worker automation.

Tests previously passed on pinned QA artifacts: isolated Windows/Linux packaged authentication negative tests and ten supervisor tests. Native Windows same-user IPC and Linux SO_PEERCRED probes exist separately as source QA checks; **they are not integrated into this installer**. Native per-host migration inventory is read-only; no live profile/tunnel migration or rollback has been accepted.

**Known limitations:** unsigned binaries; no approved publisher signature; no verified stable OAuth owner authentication; no complete one-install migration of old V1/Browser/Workspace entries; no production-safe high-privilege GUI/Browser/Worker acceptance; no signed reproducible release provenance. Existing V1 installations and user profiles should be preserved. **Do not uninstall or overwrite working V1 services to install this QA build.**

## Source-code disclaimer
The auto-generated GitHub source archives for this pre-release tag contain only its *release metadata/manifest*, **not** the complete vendor application source or a reproducible build tree. The binary QA build derives from separately maintained upstream Chat On Steroids 2.1.50 and Commander V1 development components; the release metadata tag must not be misrepresented as the full source for these binaries. Use the exact hashes and the QA notes for asset identification.

This release does not change the Stable channel, the default branch, installed V1 services, user profiles or saved sessions.
