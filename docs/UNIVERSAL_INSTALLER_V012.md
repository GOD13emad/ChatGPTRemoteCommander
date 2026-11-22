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
privileged package operations. `--fresh` accepts only actual package absence
with no owner profile/legacy state. Upgrade uses exact previous native
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
