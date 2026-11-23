# Unified Commander — source-pinned engineering pilot

Builds **one native installer per OS** from a single pinned Git commit: electron-builder NSIS (Windows, per-user) or DEB (Linux). Electron embeds its own Node.js, while `extraResources/core` carries the unchanged Commander source. A compact per-user preview copy is the only mutable runtime tree; no system-wide Node/.NET SDK is required to launch this package.

## Universal native transaction engine (one installation structure, two OS adapters)

The cross-host installation authority is **not a list of Emad/MMZ/server
special-case scripts**. The native transaction engine consumes one declarative
schema and runs the same machine-global state machine across upcoming 0.13 and
1.0 releases; native version checks enforce monotonically increasing SemVer:

```text
Manifest → native package identity + SHA-256 → installed baseline
→ exact rollback source → runtime fingerprint → owner approval
→ exclusive on-host lock + durable journal → native package effect
→ independent installed-version and runtime verification → commit
                                         ↘ failure: observe, reconcile,
                                           verify old-package rollback or STOP
```

The shared implementation is
`tools/universal-install/native-transaction.mjs`, with a persistent exclusive
`native-journal.mjs`. Only `native-os-adapters.mjs` knows whether to use
**NSIS/PowerShell** on Windows or **dpkg/polkit** on Linux. There is **one**
registered product/app family per operating system, irrespective of how many
profiles or ChatGPT accounts exist. It does not create a second Tunnel, rename
an account profile, copy a credential, issue a J01/Worker grant or replace the
running Core. Native installer service behavior is rechecked using the old
runtime fingerprint; a mismatch is **not** an accepted deployment.

The same local commands work on either operating system with the appropriate
`.exe` or `.deb` files; no machine name appears in the manifest schema:

```text
node tools/universal-install/native-manifest.mjs --candidate ABS_NEW_PACKAGE --previous ABS_ROLLBACK_PACKAGE --expected-head EXACT_GIT_SHA --output ABS_NATIVE_MANIFEST.json
node tools/universal-install/native-cli.mjs --plan --manifest ABS_NATIVE_MANIFEST.json
# On a truly EMPTY host add --fresh and OMIT --previous ABS_ROLLBACK_PACKAGE.
# The native CLI and transaction remain identical across Windows/Linux.
```

Manifest creation verifies file names/families, calculates actual SHA-256
digests, and refuses existing output and version-order drift. It is **not**
independent release trust: a digest calculated from the download itself is
self-asserted. For a **package-only** `--apply`, the preferred signed mode on Linux and Windows is
`node tools/universal-install/native-cli.mjs --apply --manifest ABS_NATIVE_MANIFEST.json --attested-gui-approval`.
It verifies the actual candidate using GitHub/Sigstore attestation pinned to the
exact source HEAD and workflow signer. A clean first install can derive the local
manifest digest from that verification. For an upgrade, the trusted release
configuration supplies the independently approved manifest digest and source HEAD
through the variables below. Once these checks pass, approval uses the native
owner dialog.
The alternative unsigned/legacy route still requires separately accepted
release-manifest SHA-256 and Git HEAD through
`RC012_OWNER_PINNED_NATIVE_MANIFEST_SHA256` and
`RC012_OWNER_PINNED_SOURCE_HEAD` and explicit owner authentication.
The manifest's `provenanceManifestPath` must reference the local release
provenance receipt in either case. Signed candidate proof is not signed rollback
proof; historical `dev.9` rollback acceptance remains separate. The existing `verifyOwnerPinnedNativeRelease` verifies candidate
and exact old rollback for upgrade (schema 1); `verifyOwnerPinnedFreshNativeRelease`
checks only the candidate for a genuine fresh host (schema 2) using the
same tamper-resistant file fingerprint. The **legacy terminal option** asks the owner to type the exact transaction
ID; the signed one-click mode uses an explicit Windows WinForms or Linux Zenity
consent instead, and an owner-visible operating-system privilege prompt still
applies when required; Linux independently uses polkit for system-package
effects, and the Windows adapter rejects SYSTEM/anonymous contexts while preserving
per-user HKCU NSIS ownership; it never requests elevation and verifies no
machine-wide duplicate. Administrator account membership alone must not
block a user-local install. A remote noninteractive command cannot silently
approve installation. Neither package
approval nor a successful version change is an OS J01 consent or signed Worker
grant.

**First installation uses the same engine:** the explicit fresh mode only
admits an OS-verified empty native installation. Existing account state, legacy
registry registrations or orphaned executables are denial conditions, never
auto-repaired machine-by-machine. If installation fails AFTER the candidate
becomes installed, the same coordinator invokes the OS-owned package
uninstaller and demands independent readback of native absence and unchanged
active runtime. For a genuine clean first installation only the candidate
package plus independent owner-pinned release manifest schema 2 is required.
No historical native package is needed or fabricated. Native OS uninstall
and independently checked package absence constitute its recovery target.
Upgrades still require separate owner-pinned candidate AND old native
package hashes (schema 1). The fresh path has isolated tests, NOT accepted
real clean-host install/uninstall or owner-host Cutover; not Stable.

Machine-global journal states are `INTENT_COMMITTED`,
`NATIVE_EFFECT_STARTED`, `VERIFIED`, `ROLLBACK_STARTED`,
`ROLLBACK_VERIFIED`, and `NEEDS_MANUAL_RECONCILIATION`. An uncertain native
effect is never blindly retried; its lock is retained for owner reconciliation.
If the candidate is positively installed but fails postcheck, the engine
tries the **exact previously verified** rollback package once, and only declares
rollback after independent readback. Tests inject malformed hashes, missing
approval, concurrent lock, unknown installer outcome, and runtime drift.

**Measured acceptance scope (not Stable):** the identical read-only Manifest
Generator + native CLI were executed against genuine local `dev.8/dev.9`
Windows NSIS and Linux DEB artifacts and the actual native package database,
returning `ALREADY_INSTALLED` with no live effects. The full shared state
machine and both OS-command adapters have isolated positive and negative
tests in the mandatory Linux/Windows CI matrix. Existing hosted native lifecycle
tests separately perform actual package upgrade and rollback in disposable
Windows/Linux runners. An owner-host `--apply` through this new Coordinator,
clean-machine native fresh install/uninstall acceptance, full Fleet Cutover, and J01/Worker-enabled Stable **remain separate, unaccepted
gates**; never infer these from the source or read-only tests.

## One cross-OS native lifecycle command (hosted proof)

The accepted product has **one contract and a single source-pinned builder**,
not a per-host installer. The installed artifact is a Windows NSIS `.exe` or
a Debian `.deb`, as required by each operating system. Both use the same Core
Git SHA, release train and `packaging/unified` source. Native package installation
is delegated to the OS mechanisms, not replaced with a custom package manager.

From an exact source checkout, use the same read-only command on Windows or Linux:

```text
node tools/universal-install/native-smoke.mjs --plan --expected-commit EXACT_40_CHAR_GIT_SHA
```

The GitHub-hosted Windows/Linux installer matrix uses **the same entrypoint**
with `--run` after building its OS-specific artifact. That dispatches the
already existing, separately tested native lifecycle: legacy baseline → one
installed candidate → health/GUI/source checks → verified rollback. Source
version and installer filename must match the single canonical v0.12 release
train. The CLI refuses mutation on ordinary owner hosts; even in hosted CI,
successful disposable installation is **not** J01 consent, signed Worker/Full
Access, owner-host cutover or Stable approval. Live owner installation requires
the separately authorized native installer and cutover admission checks.

## Build (not a Stable promotion)

From the repository root: `node packaging/unified/prepare.mjs`. From this directory: `npm ci` and `npm run build:linux` on Linux, or `npm run build:win` on Windows. Build manifests pin the exact `git HEAD` and tree. Uncommitted changes to the embedded Core/tool paths cause failure. Artifacts go to `dist/unified/`.

**One candidate-version authority:** Linux Core packaging, Electron GUI and hosted native upgrade testing derive the `.deb` filename and prerelease version from the root and unified `package.json` identities and require exact equality with `docs/release-train-0.12.json`. A later `0.12.0-dev.N` must advance those sources (including the unified lockfile and applicable runtime/version tests) together; never patch only a DEB control field, product filename, host-local install, or source manifest to conceal a downgrade. The actual owner-host dpkg version comparison still refuses downgrade, same-version or unverifiable candidates, regardless of QA success. Updating the candidate source version does not approve publication, Full Access or cutover.

## Read-only fleet migration preflight

Run `node packaging/unified/migration-preflight.mjs --read-only` from the repository root on each **reachable** host. It detects the exact legacy Inno uninstall registration on Windows, or the owned Debian package and user systemd unit mappings on Linux. The output reports only status counts and named blockers, never owner config values, key material, login tokens or raw command lines. An exit code of `2` means **NO_PROMOTE**; it is a deliberate safe result, not a request to bypass a guard. The probe can never approve or execute an install, rollback, privilege grant or promotion. Its six focused cross-platform tests are executed by the standalone unified CI and were run in real read-only mode on one current Windows and one current Linux host. This preflight is one acceptance input for later signed, owner-authorized transactional cutover, not a substitute for an independently verified G1/J01 owner grant.

**Current Linux recovery Preflight:** The original migration probe only recognized an older optional YAML-only receipt and could report `PROFILE_BACKUP_NOT_VERIFIED` after the actual per-owner six-file encrypted capsule had passed native `Verify`/`TestRestore`. The canonical preflight now inspects the existing owner-scoped capsule, checks the current six-file source digests, sealed receipt, owner file permissions and same-host decryptability through the existing bounded recovery script. Its temporary private restore is removed; no operational profile, Tunnel or service is changed. This receipt proves only scope-limited profile recoverability, not full Core rollback, owner J01 consent, installed source acceptance or a live protected route.

## Bounded owner-profile recovery capsule (QA)

`packaging/unified/profile-recovery-capsule.mjs` supplies a cross-platform, **explicit-file-list, user-local** recovery capsule for small JSON/config and systemd unit files. It never scans the owner's disk automatically, copies large projects, contacts a cloud provider, handles OS credential-store secrets or changes an active service. It creates one protected, hash-verified recovery snapshot (4 MiB total cap, 1 MiB/file, symlink and traversal rejection), and refuses changed/duplicate inventory. The rollback facility is intentionally a **no-write hash-checked plan**; it does not yet restore live configuration or certify signed production rollback. Five focused isolated tests PASS independently on both Windows and Linux. A real owner profile backup/restore must be enrolled into the native signed transaction only with owner approval and independent recovery verification.

## Single-install migration contract

The Linux DEB now retains the existing `chatgpt-remote-commander` package identity. Production-like QA uses **one composed native DEB** rather than installing the small Electron GUI DEB directly: first `bash tools/build-native-linux-package.sh` builds the source-pinned native Core/Node/Tunnel package, `npm run build:linux` builds the Electron GUI, then `bash packaging/unified/merge-native-deb.sh` validates both source manifests and repacks them into **one dpkg identity**. Its native tunnel binaries, per-profile systemd user service template and original core paths remain included. The combined DEB is independently validated with a real **old package → combined package → old package** upgrade/downgrade cycle on disposable hosted Ubuntu, including the sandboxed GUI and SHA equality for the native tunnel/runtime. This is a QA-only rollback test and does not replace owner profile backup, native authorization or boot/service canary. An `apt-get -s install` probe on the reference Linux host showed one **upgrade**, zero **new** packages and zero removals; this is an install-simulation receipt, not native rollback or running-service acceptance.

The Windows NSIS package belongs to a different installer family from the historical Inno `RemoteCommander` application. Its `legacy-inno-guard.nsh` checks the old uninstall registration in user and machine registry hives and refuses to create a second install. The same guard is exercised on a disposable GitHub Windows runner with an isolated simulated legacy uninstall key. It **does not** uninstall the old application, migrate profiles, elevate privileges or claim a full cutover.

These QA packages must **not** be installed over operational Commander until the **selected connection mode** and owner acceptance are proven: for the normal private account/device Plugin plus its unique Secure MCP Tunnel, verify per-pair binding, locally protected credential ownership, loopback-only ingress **and a separately implemented, positively authenticated owner-bound privileged MCP ingress** (the existing 0.12 STANDARD QA worker reports `V2_G1_INGRESS_NOT_WIRED`, denies privileged legacy HTTP and cannot be swapped into a FULL_ACCESS production route); for optional managed/public OAuth mode, verify the existing strict G1 issuer/JWKS/mTLS contract. Both modes still require native J01 owner consent for sensitive GUI/Full Access actions, a verified in-place owner-managed PowerShell-to-NSIS (or genuine legacy Inno-to-NSIS) transaction, profile/credential and tool-catalog parity, signed or otherwise independently trusted release provenance, boot/login reactivation, independent revocation, and native rollback. The read-only preflight never approves promotion. **A healthy private HTTP loopback tunnel is not an OAuth failure**, but it also is not an authenticated owner grant. The fail-closed Windows guard must be replaced with a real transactional cutover only after those applicable steps are implemented and tested.

## Validation and security scope

`node --test test/unified-packaging.test.mjs` on the repository root runs a real isolated Core health check and tests hash fail-closed behavior. The launcher permits only three fixed IPC calls from a sandboxed renderer. Its preview binds loopback, enables no privileged tools, does not connect to a ChatGPT account, and neither stops nor replaces the existing 0.11 runtime. Only one app window instance is permitted per account.

**No Stable claim:** Code signing, authenticated G1/J01 owner enrollment, MeshCentral managed-device adapter, Playwright browser adapter, automatic signed updates, reboot/login persistence, artifact provenance signing, migration/rollback and all-host singleton cutover are not yet implemented or accepted in this pilot. The existing active installations must remain in place until those gates succeed. `npm run build` alone is not an install acceptance or authorization grant.


**Continuous signed updates (source-stage):**
`node tools/universal-install/managed-updates.mjs --check` discovers eligible
stable releases, and `--stage` automatically downloads and verifies the
approved signed asset. A signed package is eligible only when its tagged
source's release-train record explicitly sets `autoupdateApproved`,
`publishApproved` and `installedPromotionApproved` to true. Without those
independent release gates, the updater returns `NO_APPROVED_NEW_RELEASE`;
no QA run is auto-promoted and no OS install occurs. Installing a staged
update still needs the shared native owner approval and rollback checks.

### Owner-pinned unsigned native release provenance

A commercial Authenticode/publisher signature is **not required** for an owner-approved initial private release. The replacement must still have independently established provenance: the owner/release authority pins the full SHA-256 of a separate manifest and the exact Git source HEAD *before* reading the candidate package. The manifest declares the platform and distinct candidate/rollback file hashes and sizes.
`verifyOwnerPinnedNativeRelease` in `owner-pinned-provenance.mjs` reads both native artifacts without executing them, verifies actual bytes and refuses changed, aliased or mismatched inputs; it never supplies release authorization or installation. The owner-pinned digest must not simply be copied from the same untrusted download. Only independently accepted evidence from this verifier may populate `ownerPinnedNativeReleaseVerified` and `ownerPinnedRollbackVerified` in `assessMigration`.
Signed publisher provenance remains an alternative; missing both paths still returns `NO_PROMOTE`. Native owner J01, real private mTLS ingress, healthy replacement and demonstrated reversible cutover remain independent requirements. The historical installer stays untouched while those are staged and verified.

### Private-pair mTLS transport staging on one tunnel

`tunnel-client v0.0.15` supports outbound MCP mTLS using its own `mcp.client_cert`/`mcp.client_key` and an additive `ca_bundle`. These settings are distinct from optional control-plane mTLS (`control_plane.client_cert`/`client_key`). Preserve the existing exclusive Tunnel ID and existing API-key reference, and do not start a second tunnel with the same ID. A candidate uses its **same** `main` channel with `https://127.0.0.1:<protected-core-port>/mcp`, the owner-local client cert/key and the owner-local CA bundle. The fixed plaintext `stable-router` cannot terminate mTLS.

For offline transport smoke only, `node tools/probe-owner-pair-mtls.mjs <absolute-owner-private-pair-directory> [<absolute-installed-tunnel-client-binary>]` binds an ephemeral local TLS 1.3 listener, accepts only a trusted client certificate, rejects anonymous clients and, if the binary is supplied, calls `tunnel-client doctor` with **synthetic** ID/API-key and a temporary YAML profile. A partial Doctor failure in OAuth/health on this synthetic fixture is not a production blocker; only `MCP_TLS_REACHABLE` is claimed. Nothing is copied into Git or installed over the active pair. The owner must independently verify the current pair identity, Native J01, Worker grants, profile and Rollback before changing the live Tunnel or Commander service.

### Single existing Tunnel: offline private HTTPS/mTLS plan (no cutover)

The per-(ChatGPT account, host) Tunnel ID, API-key reference and plugin stay exclusive and unchanged. Read-only planning (candidate YAML is never written or emitted):

- Windows with the existing `chatgpt-remote-commander` profile: `node tools/inspect-owner-private-tunnel-cutover.mjs --target-port=47999`
- Linux with the existing `Emad` profile: `node tools/inspect-owner-private-tunnel-cutover.mjs --profile-name=Emad --target-port=47999`

The target is illustrative only, **not** a claimed ready listener. `tools/plan-owner-private-tunnel-cutover.mjs` checks an exact existing plaintext `main` MCP binding and constructs a temporary `https://127.0.0.1:<port>/mcp` candidate with local `mcp.client_cert`, `mcp.client_key`, and top-level `ca_bundle`. `ca_bundle` extends TLS trust for **all** tunnel-client outbound connections, including the control-plane host: see [upstream tunnel-client configuration reference](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md). Only a strictly protected owner-generated local CA should be considered for actual deployment. The inspector checks owner-private profile/certificate files, emits hashes/ports and flags only, never raw YAML, key, Tunnel ID or client credentials. It does **not** edit the active profile, restart a process, create a Tunnel, grant J01/Worker Full Access, validate source release acceptance, or authorize migration.

A GitHub-hosted Windows runner does not necessarily have an interactive WTS seat. The real full-catalog protected Core test accepts only an *exact* native seat-absent bootstrap denial when a real native snapshot is unavailable; a live owner-seat machine must pass the positive TLS/Core test. That headless CI result is not native owner consent.

### Real owner-local protected Core canary (no live cutover)

Run `node tools/owner-pair-private-source-canary.mjs <absolute-owner-private-pair-cert-directory>` from the checked-out Core source with Node >=22.13. The test creates disposable owner-local Core configuration and ephemeral loopback ports, imports the real full Core catalog and native owner provider, and starts the existing protected mTLS composition with the already provisioned private certificate pair. It strictly denies tunnel identity and all J01/Worker grants, checks positive client mTLS admission, negative unauthenticated admission, and legacy privileged HTTP quarantine; it then kills the temporary child and deletes only its disposable files. It **does not modify** the installed Commander service, live Tunnel target, API key or owner profile, and **cannot prove** production grant/Full Access acceptance. The same behavior is covered with generated ephemeral certificates by `test/v2-private-tunnel-https-gateway.test.mjs` in CI. Actual native pair admission, externally pinned Worker registration, action-specific grant/revocation, machine-global lease, Native single-install transaction and Rollback are additional requirements.


### Owner DPAPI migration recovery capsule (Windows only)

Before a native Windows single-installer cutover, `packaging/unified/owner-dpapi-profile-recovery.ps1` backs up the **existing** owner-managed Tunnel profile and the local private mTLS client/server pair using the OS-bound DPAPI `CurrentUser` scope. Run `pwsh -NoProfile -File packaging/unified/owner-dpapi-profile-recovery.ps1 -Mode Stage` in the exact Windows owner session, followed by `-Mode Verify` and `-Mode TestRestore`. The last mode decrypts to a fresh owner-restricted *disposable* directory, verifies all six reconstructed file hashes, deletes the directory, and never alters the active profile. Both commands emit **only** file count and success/failure; no API key, PEM, Tunnel ID, decrypted bytes or YAML contents reach terminal output or Git. The capsule is in `%APPDATA%/ChatGPTRemoteCommander/owner-recovery/rc012-native-pair-dpapi` with a restricted current-owner ACL. It is atomic, bounded to six exact files/512 KiB, checks repeatable immu
