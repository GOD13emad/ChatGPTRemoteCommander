# Commander — one universal native installer authority (v0.12; NoPromote)

**Accepted architectural authority:** ONE native installation contract and
ONE shared transaction coordinator across all Commander owner hosts and future
releases. Native packages still come from `packaging/unified`: shared Electron
frontend, Windows user-local NSIS, Linux composed DEB. The single native
effects entrypoint is `tools/universal-install/native-cli.mjs`, implemented by
`native-transaction.mjs`, `native-journal.mjs`, `native-manifest.mjs` and
`native-os-adapters.mjs`. `tools/universal-install/engine.mjs` stays as a
disposable source-only QA verifier, not an alternate native effects controller.
The packager validates the authority and includes all five engine modules in
the exact source-pinned embedded Core manifest. Technical ChatGPT account and
exclusive Tunnel identities cannot change through installation.

**Scope:** adoption of code and architecture, not owner-host promotion,
accepted Full Access/J01 Worker authority or five-host replacement.

## Evidence standard / DoD

- Common package: one immutable Git commit and exact sorted, hashed, complete
  file inventory. A Git archive must force core.autocrlf=false and core.eol=lf for Windows/Linux byte identity; this is child-process-local and does not change the user's Git config.
- Common lifecycle: install, upgrade with previous-version retention,
  verification and rollback are implemented by the same source file and
  exercised on both OSes; dangerous roots, aliases and tampering are rejected.
- Common feature declaration: JSON lists Core/Browser/Control Center/Transfer/
  Workflow/Local AI/GUI/Access components and required source files. The suite
  verification proves source-file presence only, not functional parity.
- Actual unified native candidate: packaging/unified/prepare.mjs now checks
  the same contract and required embedded Core inventory; its existing
  Electron/NSIS/DEB pipeline remains the sole public-install candidate.
- Still open: accepted native cutover, full GUI
  visual/interaction parity, Browser, J01 owner grant, authenticated ChatGPT
  account tunnel, real installed canary/cutover, exact rollback and provenance.

## Same development invocation on Windows and Linux

    node tools/universal-install/engine.mjs --contract
    node tools/universal-install/engine.mjs --package --source ABS_REPO_ROOT --output ABS_NEW_BUNDLE_DIR --expected-commit EXACT40
    node tools/universal-install/engine.mjs --verify-suite --bundle ABS_BUNDLE_DIR --expected-commit EXACT40
    node tools/universal-install/engine.mjs --qa-install --bundle ABS_BUNDLE_DIR --target ABS_OWNER_HOME/rc-universal-qa-TEST --expected-commit EXACT40
    node tools/universal-install/engine.mjs --qa-verify --target ABS_OWNER_HOME/rc-universal-qa-TEST
    node tools/universal-install/engine.mjs --qa-upgrade --bundle ABS_NEW_BUNDLE --target ABS_OWNER_HOME/rc-universal-qa-TEST --expected-commit EXACT40
    node tools/universal-install/engine.mjs --qa-rollback --target ABS_OWNER_HOME/rc-universal-qa-TEST

The mandatory npm test runner now begins with test:universal-install on both OSes.

QA ONLY until approved! The engine copies complete source into immutable
owner-local QA releases and atomically swaps owner-local active metadata.
It never replaces installed Commander Core/Browser/UI, starts native service,
alters live routing, grants Full Power, or publishes a release. Test success
is not live installation, feature parity or visual parity proof.

v0.12.0-dev.10 remains INTEGRATION_CANDIDATE_NOT_FINAL; the existing
tools/verify-v012-publish-readiness.mjs explicitly rejects unapproved
stable promotion. Historical tools/one-install in other branches is design
provenance, not a competing active installer. The new shared transaction
and declarative manifest are code-tested across both OSes; OS-native
installation still requires independent owner approval. Next gate:
disposable native effect/rollback with this coordinator, followed by
owner-controlled release provenance, J01, verified protected Worker ingress,
single-Tunnel Core cutover, login/reboot and fleet recovery. Until these
conditions actually pass, all existing operational services are preserved.


## One host-independent native lifecycle is the installation standard

The shared lifecycle is
`manifest → inspect native package and installed baseline → independently
pinned release provenance → owner OS consent → exclusive journal lock →
native package effect → independent version, integrity and runtime checks →
commit / verified rollback or stop`. Windows uses the existing per-user
NSIS appId; Linux uses the same dpkg identity and polkit for owner-visible
privileged package operations. The Windows native adapter uses only the
built-in `System32/WindowsPowerShell/v1.0/powershell.exe` with PowerShell
5.1-compatible .NET SHA256 runtime fingerprints; no PowerShell 7/
`pwsh` prerequisite is required for installation. The same native
transaction, identity checks, owner approval and journal remain unchanged. `--fresh` accepts only actual package absence
with no owner profile/legacy state. An existing Windows legacy
`HKCU/Uninstall/RemoteCommander` (or conflicting HKLM family) returns
`UNIVERSAL_NATIVE_LEGACY_MIGRATION_REQUIRED` **before any package effect**;
this is a preserved migration baseline, never a fresh install, silent
uninstall or permission to delete historic backups. Upgrade uses exact previous native
binary; rollback from a clean install requires native absence. Unknown
effects are reconciled before retry; a failed check is never a release PASS.
For a clean initial installation, the manifest includes the single candidate
package and independent owner-pinned release provenance schema 2; the owner
does not need an older package. Upgrades still require the old native package
and independently pinned schema 1. Only real OS-native uninstall with
independent absence readback can prove first-install rollback. The packaged
Core must include the canonical provenance verifier at
`packaging/unified/owner-pinned-provenance.mjs`; source preparation refuses
an incomplete native engine or unshipped verifier.

The one active authority is `installer/universal-install-contract.json`
and native effects coordinator `tools/universal-install/native-cli.mjs`.
`packaging/unified/prepare.mjs` enforces the complete shared engine inventory.
`native-smoke.mjs` still qualifies disposable hosted native OS scripts; its
QA PASS alone does NOT prove the new coordinator performed a real
owner-machine effect. See [PR #521](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/521).

**Measured read-only fleet baseline (2026-11-22):** Emad Laptop Linux and
Emad PC Windows dev.9; MMZ Laptop Linux, Emad Server and Amirreza Server
dev.8. One unified NSIS registration per Windows Commander installation;
Remote Commander Browser registrations are a *different* application,
not a duplicate Core. A stale a982 Windows preflight incorrectly reported
no NSIS; the exact dba0 source correctly identifies installed unified NSIS.
Linux and Windows preflight still say `NO_PROMOTE`: authenticated
private pair ingress, real native J01 signed Worker grant/revocation,
full operational rollback and fleet cutover are unaccepted. No other
chat's active migration branch is modified by this design adoption.

## Disposable native effect acceptance through the shared coordinator

The hosted source-pinned Windows/Linux installer matrix now has a separate,
runner-only native-effects step BEFORE the older OS-specific lifecycle
smoke. It executes the exact native-transaction coordinator using a
single fresh native package, verifies registered installation, invokes the
native OS uninstaller and checks absence with the same shared policy and
journal. On the temporary Linux runner alone, polkit is substituted by
the runner's existing noninteractive sudo dpkg permission; no live user
sudo/polkit bypass or new production adapter permission is added. The test
refuses non-hosted owner machines. It proves OS package effects only after
the matching exact SHA GitHub workflow completes successfully, not owner
J01 consent, signed Worker admission, boot persistence or operational
fleet rollback.

## Exact cross-OS native Core artifact parity (automated)

The same native packaging/unified workflow now uploads its independently
prepared, source-commit-pinned source-manifest.json from each Windows and
Linux matrix build. A dependent exact-source-parity job checks every
embedded Core path and SHA-256 against the exact PR HEAD and Git tree.
A single mismatch fails the PR gate. It does NOT claim identical rendered
font pixels, identical native permissions or activated Full Power; these are
separate acceptance gates. The job does not install or promote on owner hosts.


### Shared Windows/Linux signed one-click owner package consent

The same shared CLI supports the **opt-in** `--attested-gui-approval`
for `--apply`, on **Windows and Linux**. It calls the official GitHub CLI
`gh attestation verify` against the *actual local package bytes*, pinned
repository `GOD13emad/ChatGPTRemoteCommander`, source commit from the
declarative manifest and the fixed signed
`.github/workflows/unified-installer-pilot.yml` workflow identity.
Self-hosted runners are rejected. Only after successful independent Sigstore
verification may it derive the local provenance-manifest SHA and pass it
into the existing common byte-verifying native provenance validator.
No developer-entered `OWNER-APPROVED` placeholder or manually typed SHA
is a valid shortcut.

Native owner package approval is separate and remains explicit: Linux uses
`zenity`, Windows uses an actual current-owner-session WinForms Yes/No
dialog via system Windows PowerShell. On Windows, the MessageBox is owned by an
invisible topmost Form so it stays visible above another active browser window;
No is the default and only an explicit Yes can approve. This is a visibility
fix, not an input takeover or automatic authorization. No GUI session,
denial, timeout, absent `gh`, failed attestation, changed manifest or source,
or invalid manifest identity are all fail-closed. The old `--gui-approval`
mode still requires an independently owner-pinned manifest SHA and HEAD;
the existing exact-transaction-ID TTY mode is also retained for legacy
owner-controlled operations.

After attested candidate and current owner baseline have been vetted,
one universal command on either OS is:

```text
node tools/universal-install/native-cli.mjs --apply --manifest ABSOLUTE_NATIVE_MANIFEST_PATH --attested-gui-approval
```

This mode is **package only / NoPromote**, does not change the active 0.11
Core or Tunnel, does not enroll accounts, bind chats or grant J01 Worker
rights. Signed candidate proof is **not** proof that the previous rollback
installer was signed: on the present dev.9 Windows and Linux owner hosts
the exact rollback asset has no matching GitHub attestation. Accordingly
`--attested-gui-approval` is not an unrestricted signed rollback command;
rollback continues to require the independent owner-pinned route and its
separate native authorization. Release and deployment acceptance still need
the applicable historical baseline and reversible install/rollback gates.
For Linux system DEB operations, polkit may ask separately for native OS
authorization. Windows per-user NSIS does not imply UAC elevation.

Validation status 2026-11-23: real GitHub Sigstore checks for the *older*
Windows source `258ca0dc6128ff3d263bd514c41e692dd020e2b8` and Linux
source `be6d48a0ebdeeb69e9e842f18064c9120c16a8b2` PASS.
These checks do **not** attest the new code. Linux isolated Xvfb GUI Yes/Cancel
PASS; Windows native dialog code and signed-release policy must run on
Windows CI and an owner-visible session before Windows canary acceptance.
No installed package has been promoted by this code path.

### Universal automatic update staging across Windows/Linux

**Source-stage implementation**: `tools/universal-install/managed-updates.mjs`
and `managed-update-scheduler.mjs` are the *same code on both OSes*.
The `--check` path queries the public GitHub REST API over HTTPS **without
GitHub account sign-in or `gh api`**, resolves tags to immutable SHA-1 commit
identities and only accepts the train from that exact commit. A missing or
unavailable release-train never counts as approval. Public discovery is
not itself cryptographic attestation or permission to install. On `--stage`,
the updater downloads only the exact release asset over GitHub HTTPS, confirms
its SHA256 and byte count, downloads Sigstore bundles from GitHub's PUBLIC
repository-attestations REST endpoint by SHA256, and verifies them with the
**official GitHub CLI offline `--bundle` verifier** against this fixed
repository, immutable source HEAD, trusted workflow signer and public Sigstore
root. There is **NO GitHub login, token or manually entered SHA256**; however,
the official `gh` executable is still needed locally for cryptographic
verification. Its absence, an unavailable bundle, bad identity, missing signed
rollback baseline, or owner refusal all FAIL CLOSED and cannot auto-install.
This is a shared dependency, not an OS-specific signature-verification patch.
On Windows the official GitHub CLI can be installed **without elevation** from
Microsoft WinGet's verified user-scope portable package:
`winget install --id GitHub.cli --exact --source winget --scope user --silent --accept-source-agreements --accept-package-agreements --disable-interactivity`.
The shared verifier recognizes the default user-local
`%LOCALAPPDATA%/Microsoft/WinGet/Links/gh.exe` alias even in a fresh Task
Scheduler session whose PATH has not yet refreshed. This adds a vetted
verification tool, NOT a GitHub account binding or package permission.
On two Windows server hosts, the official WinGet v2.105.0 package was
user-scope installed with WinGet SHA256 validation and returned an executable;
both live Commander native dev.8 installations remained unchanged.
The verifier also pins the immutable GitHub repository ID `1374266155`
and owner ID `94546844`, in addition to exact source HEAD, workflow,
Sigstore issuer and GitHub-hosted runner. Public API JSON alone never establishes
authenticity. The `--attested-gui-approval` native CLI now uses the same
public-bundle verification path before presenting a real owner Yes/Cancel dialog.
Observed real proof on Linux: GitHub PUBLIC attestation for immutable
`77831c3d` dev.10 DEB, anonymous `gh attestation verify --bundle`,
`signedCandidateVerified:true`, `rollbackSignatureVerified:false` and
`liveCoreChanged:false`; this is candidate acceptance only, not an
automatic or unsigned rollback grant. If the native package is **absent**
(as on the Saeid Windows owner account in the measured inventory), discovery
returns `NATIVE_FIRST_INSTALL_REQUIRED` instead of treating missing native
version as a broken updater. It must use the separately verified first-install
native manifest and explicit owner consent, not an update or automatic grant.
No login or privilege bypass is attempted.
The owner-local scheduler runs `--stage` every 6 hours through systemd user
timer (Linux) or a least-privilege Task Scheduler task (Windows). For each new
**published stable release**, the update manager checks the source-tagged
`docs/release-train-MAJOR.MINOR.json` and requires **all** of
`publishApproved:true`, `autoupdateApproved:true`,
`installedPromotionApproved:true`, `isStable:true`, `channel:stable`,
a matching exact release tag and sourceVersion, and a newer version than
the native installed package. It selects **only one uploaded artifact whose filename encodes the exact
approved stable release version, platform and supported architecture**;
a release containing only an older/dev package or a duplicate is rejected.
It also verifies the local package against the GitHub asset digest and
independent GitHub/Sigstore attestation pinned to the fixed repository,
exact source commit and fixed workflow signer. Successful staging returns
`candidatePath` for the later owner-approved native package transaction.
It never treats a PR or NoPromote workflow artifact as an auto-promoted release.

```text
node tools/universal-install/managed-updates.mjs --check
node tools/universal-install/managed-updates.mjs --stage
node tools/universal-install/managed-update-scheduler.mjs --enable
# For a later reviewed source revision, on an existing owner seat:
node tools/universal-install/managed-update-scheduler.mjs --refresh-source
```

The scheduler deploys only small user-local manager code from the **reviewed
source**, never starts an installer or claims a J01/Worker authorization.
`--refresh-source` is an owner-local, rerunnable atomic replacement of those
same two reviewed source files. It refuses alien/symlinked or group-writable
Linux installs, retains one `*.previous` recovery copy, and does not alter the
installed native package, Timer/Task Scheduler definitions, or privileged grants.
This replaces the old per-machine manual updater-source patches; source origin
must first be verified in the common GitHub branch/signed release.
The result `SIGNED_UPDATE_STAGED_AWAITING_OWNER` means installation must
still use the common owner-visible `--attested-gui-approval` path with a
reversible native manifest, baseline and OS privileges where applicable.
The current dev.10 train has `autoupdateApproved:false` and
`publishApproved:false` and **NO qualified stable release**: expected live
check output is `NO_APPROVED_NEW_RELEASE`. Its explicit owner-authorized
signed canary remains separate. Production 0.11 Tunnel never auto-switches.
Future stable-channel auto-install without a new owner click would require a
separately accepted publisher/OS policy and audited rollback; it is **not**
implemented by this staging scheduler.

**Legacy-entrypoint migration**: do not launch typed-hash scripts or request
`OWNER-APPROVED`/64-hex manifest values from the manager. The deprecated
`/home/aliemad/.cache/rc012-be6d-native-artifact-stage-20261122/owner-tty-canary-20261123.sh`
on Emad Linux is now a compatibility shim to the shared signed GUI command.
For any staged owner manifest the canonical operation is:
`node tools/universal-install/native-cli.mjs --apply --manifest ABS_NATIVE_MANIFEST.json --attested-gui-approval`.
Linux GUI automatically discovers the *same owner's* KDE/X11 or Wayland
seat from the user systemd manager if the remote command lacks DISPLAY;
strict checks require a local display, owner-private Xauthority (or owner
Wayland socket), and exact `/run/user/UID`. Missing, foreign or permissive
credentials fail closed. No per-host DISPLAY patch or password input is needed.
System package installation still requires separate polkit authorization. Other chats
must reuse the GitHub source/PR and this one contract, not create divergent
per-host verification prompts.

## Native owner-pair J01 validation without a signed Worker grant

The Linux owner-enrolled mTLS bootstrap now derives the canonical account-host
pair session handle from the owner-pinned Tunnel and OS-owner hash using the same
function as the protected runtime. Only that exact handle can reach the native
desktop-seat/current-owner J01 consent. A pair handle does not prove the
individual identity of any ChatGPT conversation; the owner prompt says so.

The no-effect Core/broker canary retains signed Worker, tool-route, lease and
dispatcher callbacks in permanent DENY mode. When the owner is present,
an explicit RC012_QA_J01_OWNER_BIND=1 on the existing
tools/qa-v012-protected-broker-run-linux.sh command requests a single real
native J01 consent over pinned mTLS. The prompt is never shown by default.
Denial or timeout does not pass. Even an approved binding is rechecked by a
denied Core tool call. No live Tunnel, service, OS privilege, credential or
installed Core is replaced by this diagnostic.

**Real three-profile owner-native admission evidence (2026-11-22):** On the
existing Emad Laptop, the SAME source-pinned no-grant canary invoked the
native J01 owner-visible consent separately for (Core profile, owner Tunnel):
(`default`, `chatgpt-remote-commander`, 48965), (`MMZ`,
`mmz-emad-laptop`, 48966) and (`saeed-emad`, `saeed-emad-laptop`,
48967). All three signed owner-pair admissions returned HTTP 200 over
client-authenticated TLS 1.3; anonymous clients were denied, and
`tools/call` without a Worker grant continued to fail 503
`PRIVATE_OWNER_ADMISSION_UNAVAILABLE`. Each source QA script confirmed
the preexisting service MainPID unchanged, and all temporary broker/Core
units were collected. The installed 0.11 Core and all active Tunnels were
not replaced. These are three actual, **ephemeral J01 consent
events for isolated canaries**, not three persistent production grants.

This proves only the native owner-pair binding seam, not a signed Worker,
live privileged tool effect, full Core restoration, or production cutover.


## Native owner-first Signed Worker binding contract

The source-pinned protected Core now supports the existing explicit
Worker callbacks OR exactly one synchronous
security.bindWorkerToNativeOwner({ownerStack, identity}) callback.
The factory is called after Native J01 creates its live owner-session bindings
and durable V2GrantRegistry, allowing the SAME owner and epoch to be
referenced during full Worker enrollment. Supplying both factory and direct
worker/lease callbacks, or an incomplete result, fails closed. Existing
owner-enrolled NO_GRANT canaries retain their denial behavior. This is only
an integration dependency repair: it does not itself create an Ed25519
credential, enroll a Worker, approve access, grant a tool, or prove live
cutover. A real owner-controlled key provider, exact action policy, signed
Worker registry and machine-global lease remain mandatory to activate it. This exact protected Core source path is included in the Unified Installer Pilot PR filters; every subsequent change requires fresh source-pinned Windows/Linux builds.


## Owner-pair local Signed Worker grant adapter (source stage)

The owner-local src/v012-private-native-worker-adapter.mjs allows the
existing WorkerIdentityAuthority to reuse the same native one-Tunnel J01
owner epoch and V2GrantRegistry without adding OAuth or impersonating a
specific ChatGPT chat. It validates the current pinned owner/Tunnel, same
native operation route, exact registered Worker/key/policy binding, active
grant revision and per-tool permission before AND after native argument
authorization. The adapter exposes no network listener, no new Tunnel and
no default Worker enrollment. The owner-provisioned callback selects the
actual operation, not any MCP-supplied route. Its real Ed25519 signatures
and WorkflowStore durable identity journal are exercised only with explicit
synthetic test identity, mock admin approvals and disposable data; production
requires live owner-key credential provisioning, native approval, machine
lease and actual protected Core tool verification. The canonical source QA
runner includes the fixture exactly once and the native package PR filter
includes the new module.


## Real owner-local encrypted Worker key stage (Linux, explicit consent)

An independently verified host-UID-v2 Linux native owner and the already
enrolled existing per-account Tunnel are mandatory. The one generic
tools/provision-owner-worker-key-linux.mjs supports:
- --preflight PROFILE: read-only current native owner seat and exact pinned
  Tunnel proof; all three Emad Laptop owner profiles PASS.
- --enroll PROFILE: deliberate, visible native OS owner consent, exact
  current owner/Tunnel epoch recheck, host/user systemd-creds encryption
  of a fresh 32-byte Ed25519 seed, atomic publication of ONLY an encrypted
  blob and its bounded owner-local public key ID/hash receipt. The seed is
  never written to an unencrypted file or emitted. Existing validated keys
  are reused and never overwritten. Wrong owner/profile, tampering, symlinks,
  weak permissions, and partial capsules are rejected.

The existing owner-private pair security directory is reused, not a second
Tunnel/Core installation. This stage issues no Worker identity registration,
no exact action grant and no OS elevation. Production activation requires a
real owner consent, durable signed-worker registry, native exact grants,
machine-global lease and genuine protected Core tool admission.
The new source paths are pinned into the single native installer QA.
