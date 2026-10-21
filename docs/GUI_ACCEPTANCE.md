# GUI acceptance gates — v0.8.21

The v0.8.21 release adds the first Linux GNOME/Wayland native GUI backend. Linux source acceptance requires helper compile/self-test, extension packaging/contract checks, install/update registration with no forced logout/reboot, and fail-closed gui_status while the extension is not active. GNOME 46 does not hot-load a newly introduced local extension into the current Wayland session, so real Linux screenshot/input acceptance remains a post-session-load gate and must not be inferred from source tests. The zero-interference invariant remains global: observe-only by default; takeover only from an explicit current user request; durable/background workflows cannot acquire takeover.

The v0.8.15 release changes only local router test transport and version metadata; GUI code and authorization behavior are unchanged. The v0.8.14 release changes updater validation/cleanup only and retains native GUI input behavior unchanged. Unattended updates do not call the shared interactive `gui_status` helper; they use the native no-input self-test plus candidate `system_status` GUI backend/policy fields, so GUI validation remains non-interactive and zero-interference. The v0.8.13 release retains the v0.8.10-v0.8.12 GUI authority and native-input behavior unchanged; its new work is supervisor/router continuity. The v0.8.12 release changes updater version monotonicity only and retains all v0.8.11/v0.8.10 GUI behavior. The v0.8.11 release retains the v0.8.10 explicit takeover boundary unchanged. The v0.8.11 code delta is in stable-router response-drain accounting, not native GUI input behavior. The v0.8.10 release adds an explicit takeover boundary on top of the v0.8.9 non-intrusive updater design. `gui_session_begin` defaults to observe-only; screenshot/window/cursor reads may proceed under that lease, but mouse/keyboard/scroll/focus mutations fail before native input unless the session was opened as `mode="takeover"` with an `explicitUserAuthorization` basis grounded in an explicit current user request. Full Power is capability authority, not implicit foreground-desktop permission. Durable workflow calls are not a valid interactive authorization channel: they may observe when permitted, but takeover acquisition and GUI mutation are direct-session-only.

The v0.8.9 release retains the v0.8.7 bounded Windows GUI lease/frame safety model and persistent helper plus v0.8.8 router source-activation verification. It also separates unattended update verification from interactive desktop E2E so scheduled updates never need to steal focus. On the validated Windows target, warm status reads measured 16.09 ms median, window-list reads 36.76 ms through the controller, and 1000 px JPEG screenshots 87.40 ms through the controller, while the real native E2E still passed capture, exact-window focus, click, Farsi/Japanese Unicode typing, button activation, screenshot verification, cursor restore and foreground restore (GUI_NATIVE_E2E_PASS). GUI authorization remains an explicit capability that can be persistently opted out while the rest of Full Power stays enabled.

These measured Windows results do not waive the remaining release gates below for installer/update/tunnel/ChatGPT integration, Linux regression, multi-monitor/DPI coverage, locked/Secure Desktop behavior, anti-cheat/protected input, or real-time gameplay.

## Background-first web interaction candidate

For web tasks, shared-desktop GUI is no longer the first automation path. Use the owned background browser first when available. It operates headlessly in a Commander-only browser profile and does not move the user's pointer, type into their foreground window, or focus their current browser. If the background path reports a genuine foreground boundary, use `browser_foreground_requirement`; if current-task approval is already present, do not ask again. `browser_foreground_begin` must relaunch the same owned profile visibly before any approved GUI step, and `browser_foreground_end` must return that same profile to headless mode afterward.

A current user request that explicitly says to use the mouse/keyboard, take control of the page, or act like a human is sufficient authorization for that task's temporary takeover; do not ask for the same permission twice. After the minimum foreground step, verify it and end the GUI lease immediately.

The background browser never extracts saved passwords or opens the user's password store. It does not reuse the user's normal browser profile. If a credential exists only in the user's normal browser, the approved fallback is not to copy it: the user or authorized GUI interaction signs in through the visible Commander-owned profile once, after which its own session cookies can persist for future background work.

## Gate A: no-input verification

Run the Node behavioral suite and `test/gui-native.ps1` on an extracted, pinned candidate copy. The native test parses the helper, compiles its C# types, checks INPUT layout (40 bytes in a 64-bit process, 28 in a 32-bit process), and exercises pure key-name validation. It must not capture the screen, move input, connect a tunnel, overwrite local policy, enroll credentials or restart services. Save stdout/stderr, exit codes, platform and artifact hashes.

PASS here means parser/layout readiness only, not working GUI control.

This no-input native self-test is also the GUI gate used by unattended Windows candidate updates. Candidate hardware validation separately requires `gui_status` from the candidate MCP process. The interactive Gate B remains a release-validation gate and is intentionally not run by the scheduled updater, because Windows may deny background foreground activation while the user is working.

## Gate B: disposable interactive desktop

Use a test Windows user/VM and a disposable editor window. **Proportional release rule:** Gate B must be rerun on the exact release candidate whenever native input code, coordinate/focus behavior, helper transport, or post-dispatch verification changes. A controller-only authorization change may reuse the immediately prior exact native E2E baseline only when (a) native helper files are byte-identical/Git-identical to that baseline, (b) the current candidate passes native no-input self-test, (c) focused regression proves authorized takeover reaches dispatch while observe-only cannot, and (d) the release record explicitly says interactive native E2E was inherited rather than rerun. This exception must not be used for native behavior changes.

Use a test Windows user/VM and a disposable editor window. Confirm which computer and user session the MCP is attached to. Close private content before any screen capture. Explicitly authorize the bounded input tests below; do not run them on unrelated applications.

First prove the observe-only default: `gui_status → gui_session_begin → gui_screenshot`, then attempt a mutation and require `GUI_TAKEOVER_NOT_AUTHORIZED` with no native input call. For disposable interactive Gate B only, explicitly authorize the test and run `gui_session_begin(mode="takeover", explicitUserAuthorization=...) → gui_screenshot → one action with lease+frame → gui_screenshot → gui_session_end`. Require a rendered actual image and visible post-action evidence, not text that merely says the action was submitted. A lease is shared-desktop coordination, not authenticated user isolation.

Required cases:
- Basic move, single/double click, scroll, drag, exact-window focus and safe key combinations.
- Literal Farsi, Japanese, emoji, punctuation, tabs and newlines; compare the editor's text to the expected string independently of an API success flag.
- Display scale 100/125/150/200 percent, second monitor and negative desktop origin; resized screenshot coordinates must map back to the same observed native monitor.
- Change foreground/monitor geometry after capture; old frame must be refused. Reuse or expire a frame; no input may occur.
- Two clients: second lease refused while the first is active; no alternating keyboard events; expired lease cannot regain authority.
- Physical Escape or a locally created `var/GUI_STOP` during a bounded hold/drag; input release and GUI refusal must be observed. Do not remove the owner's stop remotely.
- Denied focus/UIPI, locked/disconnected/session-zero desktop and invalid key; report unavailability/error, never success. Do not disable Windows security to make a test pass.
- Force helper failure only in the disposable environment; verify uncertain-outcome latch and locally inspect input state before deliberately restarting.

## Gate C: product integration

Run the full unmocked repository suites on Windows and Linux, then the actual tunnel path. Verify the new Host/Origin admission policy against the real tunnel forwarding behavior. Do not widen host/origin policy blindly. Confirm real MCP image rendering and tool discovery in ChatGPT; a Codex Plugin install is not this test.

Check independent accounts/tunnels reach the correct device, preserve credentials, do not overlap desktop control, and recover without a repeated key prompt. Confirm screenshots and typed text are not written into audit/error logs.

## Gate D: controlled release

Resolve all Critical/High OPEN findings in AUDIT_R1.md or document a reviewed scope restriction that actually removes the affected feature. Pin exact source/artifact hashes; test fresh install/update/rollback/stop/start with no secret loss. Synchronize documentation and Plugin assets. Review authoritative versus superseded branches explicitly. Promote only after review; no forced merge, automatic release, reboot or network reset.

Native Linux GUI, high-speed gameplay, anti-cheat bypass, Secure Desktop control and unattended logon are not implied by Windows source availability.


## Native X11 private-workspace QA pilot — 2026-10-19

**Scope: source-only opt-in Linux QA, not Core deployment, release or production
acceptance.** The executable test fixture is
test/gui-private-x11-isolation-qa.py on the feat/gui-private-x11-worker-qa
candidate. Set RC_QA_XVFB_BIN to an absolute trusted Xvfb binary and invoke
python3 -B test/gui-private-x11-isolation-qa.py only in an approved QA context.
The optional Xvfb binary was obtained as a user-local extraction of the
Ubuntu xvfb package, not by root installation or alteration of an existing
desktop. At the tested MMZ Linux host the package was
2:21.1.22-1ubuntu1.2, SHA-256
fac5e03c7a40668d475178efb85dc63b4b391b020e0e9f499a729d2b62466fe8.

**Observed QA result:** two actual independent Xvfb processes on :1700
and :1701 accepted unique synthetic keyboard input through two Tk test
windows, with separate matching receipts and no cross-worker effect. Wrong
Xauthority was refused, and read-only XWD snapshots came only from these
private servers. Each workspace uses an owner-private temp root, its own
Xauthority cookie, a distinct X socket, and -nolisten tcp; the test never
invokes input on the person's Wayland display. Normal teardown closed both
owned Tk and Xvfb processes. A separate controlled os._exit fixture
tested PR_SET_PDEATHSIG: when its parent exited abruptly, both the private
Tk process and Xvfb exited and the display socket disappeared. The re-read
of QA slots showed no surviving server/socket. This validates the tested
same-host failure path, **not** power-loss recovery or SIGKILL against Xvfb.

**Not accepted:** production Core routing to native private displays; an
OS-authenticated chat/workspace owner or human supervisor; protected observer
and control handoff; same-OS-user hostile process isolation; simultaneous
Linux Wayland/GNOME Remote Login; an independently provisioned Windows VM/RDS
worker; installed-version compatibility and native GUI input-mutation
authorization; resource/soak testing; public API or stable promotion.
Private X11 process/profile separation is functional: other processes
running as the same OS account are not treated as mutually untrusted.

**Dependency chain:** (1) review native workspace identity and owner isolation
across Commander profiles and crashes; (2) bind lifecycle to a trusted
per-workspace broker/owner grant, default-deny external control and preserve
other workspaces; (3) verify protected observer and time-bounded operator
handoff, with mandatory agent re-observation; (4) test low-memory bounds,
disconnect, same-user attacks, multiple host OSs and rollback; (5) independent
review, guarded canary and release criteria. Do not merge or promote the
feature solely from this QA evidence.


## Native X11 coordination layer (candidate)

This is a stacked, unmerged follow-up to PR #270. The source-only module
src/native-workspace-coordinator.mjs does not register public MCP/Core tools,
start OS sessions by default, take desktop focus or reconcile historical J01
incidents. Its default identity resolver, launcher, observer authorizer and
human control-handoff authorizer ALL fail closed.

**Identity and scope:** Each lease is tied to an independently authenticated,
conversation-bound identity from a future trusted Core adapter. An OS username,
profile label, client-supplied chat ID and bearer token do not alone prove
identity. Current tests use explicitly synthetic identities. Different chats
under the same OS profile cannot use each other's leases in the tests.

**Controller invariants:** Startup reserves capacity before the asynchronous
native launch. OS target/display and server PID collisions fail closed; a
duplicate handle never closes another owner's live server. A cleanup error is
quarantined rather than treated as a reusable slot. Observer tokens expire,
authorize one pre-captured bounded image only, and cannot trigger screenshots
or input. Operator control handoff is default DENY and scopes action to a
single independent worker, while unrelated workers continue. Expired/revoked
handoff requires a fresh owner observation; each input is revision-checked.
Native input with an ambiguous result is latched UNKNOWN without replay in the
current in-memory process. Caller-provided DISPLAY, executable, shell command
or environment is not an accepted native action.

**Live source-QA (MMZ Linux):** On two actual disposable Xvfb/X11 servers,
a synthetic supervisor captured only private frames, then entered a bounded
synthetic string into workspace A while the separate agent continued working
on B. Xauthority from B was rejected on A. The observer did not cause another
native capture; after input its prior frame was stale. Both synthetic input
receipts matched their own workers, and all test-owned processes/sockets were
cleaned after the run. The optional integration test
test/native-workspace-coordinator-xvfb.test.mjs is SKIPPED unless
RC_QA_XVFB_BIN names an explicit approved Xvfb binary; the synthetic identity
adapter is **not** authenticated ChatGPT identity. The separate original
Python pilot proved PR_SET_PDEATHSIG only for its own child processes, NOT for
the Node test or power failure.

**Open before release:** trusted conversation identity; protected native
per-workspace launcher; durable crash-safe native-effect/uncertainty journal
across restarts; real authenticated supervisor UI and revocable time-bound
owner consent; measured resource limits and disconnected/abnormal shutdown
recovery; Linux GNOME and Windows VM/RDS acceptance; independent security
review. CI on the exact hosted head is an additional gate. No installation,
stable promotion or operating desktop takeover is authorized by this QA.


## Native per-workspace input Intent journal (QA candidate)

This source-only, stacked follow-up adds
src/native-workspace-journal.mjs and binds it into
src/native-workspace-coordinator.mjs through an explicit trusted
durableJournalFactory. The installed Core, public MCP tools and historical
J01 native incident records are **unchanged**. The default factory returns
no journal and **native mutation is refused**; a testing identity/provider
is not actual ChatGPT account or conversation authentication.

The Linux QA journal accepts only a pre-existing, private, canonical root
chosen by the trusted host adapter. Each new workspace reference gets its
own exclusive directory (failure on reuse, symlink or ambiguous state).
Before any native dispatch it creates an exclusive intent receipt with
open wx, an fsync of receipt and parent directory, and exact readback.
The receipt includes only hashed operation/workspace identifiers, the
action kind, revision and timestamp: no typed text, coordinates, GUI pixel
data, credentials, session cookies or original action arguments.

Only the original in-memory receipt handle can append an ACK after the
native helper returns submitted:true. The ACK records
NATIVE_SUBMITTED_UNVERIFIED; it does **not** claim observed UI effect.
On native ambiguity or ACK failure, the selected workspace becomes
uncertain and further input is denied without retry. A repeated stable
operation ID cannot dispatch again, including after re-observation.
A new process never treats even matching, same-user-writable intent/ACK
files as trusted owner consent or automatic clearance. The old workspace
is quarantined for independent recovery, while a distinct workspace
reference can continue with its own journal. The journal is bounded at
128 actions per workspace and never silently deletes evidence on expiry,
shutdown or normal close.

**Actual scope of verified tests:** dedicated Node durable journal tests
cover directory owner/mode, exclusive creation, readback, forged handles,
tampered/symlink receipts, same-workspace contention, ACKed old-run denial,
and real abrupt child process exits both before the ACK and after a
**synthetic** native effect. Live Linux two-Xvfb QA uses the journal
binding with per-workspace synthetic input actions. Additional
coordinator tests cover no journal/no native dispatch, duplicate action
denial, failed Intent preflight and post-native ACK failure, with an
unaffected second workspace. Run exact-head Linux and Windows CI before
accepting any new remote candidate.

**Limits / explicit OPEN gates:** This is not a protected owner broker,
cross-process coordinator, secure identity provider, trusted Windows
transaction primitive, crash-durable Core instance recovery or
physical-power-loss guarantee. fsync gives bounded local-process-exit
evidence on the tested Linux filesystem, not immunity to untrusted
same-UID processes, hostile storage, filesystem corruption, forced kernel
shutdown or OS/platform differences. Portable Windows durability and
trusted root ACLs require separate acceptance. No automatic restart of a
historical/native uncertain GUI action is authorized; real native cleanup
and owner review remain out of scope. Launch/session attestation,
authenticated supervisor control, native resource/soak gates and
independent security acceptance must precede any operational rollout.

Primary Node filesystem contract: https://nodejs.org/api/fs.html
(wx exclusive create and FileHandle.sync for persistent receipt writes).


## Signed scoped observer and controller approvals (source-only QA)

Scope: this **stacked experimental extension** builds on the private X11
workspace/coordination/journal QA. No operating-system owner identity,
protected local Broker, privileged GUI path or real ChatGPT conversation
binding is installed. There is no Core server import, new MCP endpoint,
local private signing key file or default permission to control a GUI.
Without a configured trusted Ed25519 public key the new verifier denies all
requests. The Core coordinator's default observer and handoff callbacks
continue to deny all access.

The internal verification module is src/native-workspace-approval.mjs.
An injected authorizer may consume a short-lived Ed25519 approval carrying:
issuer, audience/resource, host, process-instance nonce/challenge, intended
permission scope (observe OR control), exact workspace reference, native
backend display/process fingerprint, verified owner principal reference,
verified viewer/operator principal reference, one-time 256-bit nonce and
issued/expiry times. Strict ordered signed bytes, exact field schema,
base64url canonicalization and Ed25519 verification reject malformed or
cross-scope requests. A bounded synchronous consumed-nonce map blocks
re-use within the current process; process-instance binding rejects a
prior-process grant after restart. TTL is at most 180 seconds for view and
120 seconds for control, with shorter actual duration determined by the
workspace/hand-off lease.

A valid signature does NOT create trusted owner consent, authenticate a
ChatGPT account/chat or establish OS-level isolation. It only verifies the
origin and scope **if** the signer's public key was pinned from an
independently protected, authenticated source. The test fixture generates
a throwaway test-only Ed25519 keypair in memory, and synthetic identities
are passed to the coordinator only inside explicitly named QA files.
Do not treat readable same-user filesystem keys, caller-provided labels,
client-supplied conversation metadata or a mutable approved-receipt JSON
as a protected identity broker or private-key custody. The verifier
rejects private-key PEM and private KeyObject inputs, accepting only an
Ed25519 public KeyObject or public SPKI PEM supplied by a trusted adapter.
The code never signs grants outside QA test fixtures.

Native real-X11 QA on MMZ now rejects missing approval, rejects reuse of
a successful observation approval, and requires an exact signed control
approval for a single selected private Xvfb worker. The separate other
worker remains functional; the original owner must reobserve after human
input. Default-deny behavior and the earlier on-disk native input Intent
journal remain independent requirements. Run the named scoped CI on both
Linux and Windows and real Xvfb QA on a disposable test environment,
then inspect its exact SHA. A green test is not a production-owner grant.

Open before deployment:
(1) an independently protected signer with verified OS principal/secure
consent path and key rotation/revocation, not running under the same
untrusted account context;
(2) real ChatGPT conversation identity returned by an authenticated
server-side integration, explicitly separate from MCP transport IDs;
(3) authenticated broker-to-Core IPC and authoritative OS display/process
ownership, with cross-process concurrency, replay and crash handling;
(4) Windows VM/RDS, Linux protected Native Worker, supervisor UI, resource
limits, stress and canary acceptance. The signed grant verifier is necessary
but not sufficient. No existing historical J01 incident is cleared.

Primary source references:
- Node.js Crypto API, Ed25519 sign/verify: https://nodejs.org/api/crypto.html
- Linux Unix peer credentials, SO_PEERCRED: https://man7.org/linux/man-pages/man7/unix.7.html
- MCP protected resource authorization guidance: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization


## Linux native workspace broker IPC transport QA (2026-10-19)

**Status: source-only, deny-by-default transport proof; NOT an authenticated
owner Broker, not installed and not an authorization to control a GUI.**
The opt-in Python standard-library module
tools/native-workspace-peer-broker-qa.py creates a disposable Linux AF_UNIX
stream socket under an existing owner-private canonical temporary directory.
No daemon, service, port, MCP tool, browser access, signing key, screenshot
or GUI command is installed or exposed. The module has no CLI auto-start.

SO_PEERCRED supplies the kernel's connection-time pid/uid/gid. A strict
one-line, bounded, duplicate-key-rejecting JSON frame accepts only a
non-mutating peer_status probe. The initial policy DENIES all peers. An
explicit QA callback may allow the sanitized TRANSPORT_ONLY response, which
ALWAYS reports nativeInputAuthorized:false, trustedConversationIdentity:false
and ownerConsentVerified:false. Client-supplied UID/role/PID fields, unknown
operations (including click/control), oversized messages, symlink/untrusted
roots and duplicate live sockets fail closed.

The socket uses private owner-only permissions, and shutdown unlinks only
the exact test-owned socket inode. A deliberate process crash leaves its
stale socket name quarantined; startup never deletes/reclaims an unknown
name automatically. Invalid or stalled clients cannot permanently hang
other test clients. This is only a same-UID, user-local prototype. Another
program under the same Linux user can connect to its socket and may modify
owner-writable data: the process PID/UID/GID is not ChatGPT identity or an
independently protected grant. Testing that a UID matches does not authorize
native input, owner consent, or screenshot disclosure.

**Evidence:** 12/12 scoped real Unix socket/peer-credential tests
PASS independently on MMZ Linux (mmz-LOQ-15IRX9) and Emad Laptop Linux
(aliemad-Labtop), both Python 3.14.4, both Exit 0 with no skipped cases.
Cross-host tests used the exact same source SHA-256
ad7dcb470b0af753a887364c4595e0e437b9327127e7f0275b3be21fddd0afef
and test SHA-256
eddb79559f28b885acdd4b22e422b1c0ca8105ed7e6c9c3a257eced3569964d3.
They covered actual child PID matching, kernel peer credentials, default denial,
malformed claims, stalled clients and crash-stale endpoint behavior. Hosted
NoPromote Ubuntu CI must be checked on the exact amended PR HEAD. This work
does NOT change the signed Ed25519 verifier, durable input journal, previous
PR base, installed Commander Core, or the users' desktops.

**Open for real owner Broker:** a separately protected service principal
and private signer/OS key custody, authenticated chat/user subject binding,
owner-present authorization, protected IPC to native-worker allocator,
peer identity and session attestation, revocation/rotation, cross-process
same-session arbitration, Linux Wayland/private X11 and Windows VM/RDS
acceptance. systemd --user services under the same user do NOT establish
a distinct OS principal by themselves. Provisioning an independent OS
principal or protected system service, if eventually required, must be
reviewed and approved through native operating-system authorization. Until
then observer and controller grants remain disabled operationally.

Primary sources:
- Linux SO_PEERCRED unix(7): https://man7.org/linux/man-pages/man7/unix.7.html
- systemd service User= limitations: https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml


## Generic native application GUI worker (source QA)

**User goal:** operate native GUI-only applications through their own
visual workspace, pointer and keyboard when an API, backend, console or
usable accessibility/UIA route is unavailable. The worker must not be
limited to web browsers and must not take over a user's physical display.

**Implemented Linux X11 pilot:** src/native-private-x11-app-worker.mjs
uses a trusted host-pinned application catalog (absolute executable,
fixed argv and window title). The chat cannot supply an arbitrary binary,
shell command, DISPLAY or XAUTHORITY. The launcher allocates a distinct
owner-private high-numbered Xvfb display for each workspace, with a
separate Xauthority cookie, private HOME/cache/config and no TCP listener.
It starts a **native desktop app**, captures actual screen pixels through
ffmpeg x11grab and sends XTEST pointer/keyboard actions using xdotool.
This is not Chrome CDP, browser DOM interaction or a website API.

The existing native-workspace-coordinator.mjs and
native-workspace-journal.mjs now include mouse move, bounded drag,
single/double click, text, key and scroll. Native actions require fresh
observation and a persisted per-workspace intent, without blind replay
of ambiguous results. Optional tools/native-qa-parent-death-exec.py sets
Linux PR_SET_PDEATHSIG for each owned native child; this is test-only
child lifecycle protection, not a cross-user security boundary.

**Real MMZ Linux QA — 2026-10-19:** An actual Zenity GTK form and an
unrelated XClock application ran concurrently on two isolated Xvfb X
servers. Each produced a distinct valid PNG screenshot. In the clock
workspace, pointer movement, drag, double-click, right-click and scroll
succeeded; in the GTK form, keyboard input followed by Enter caused
the native process to
exit with the expected SHA-256 of synthetic text output. A foreign chat
could not access the other workspace. Both on-disk journal receipts
remained scope-specific. Normal close shut down exact owned processes
and sockets. An additional controlled abrupt Node-parent-exit test
proved the owned application and Xvfb both stopped and released the
test socket. No owner's display, browser, mouse or keyboard was used.

**Not yet accepted:** This does not demonstrate every GUI app (some
reject synthetic X11 events or require real GPU, Wayland input or secure
desktop). Same-Linux-UID processes are not mutually untrusted principals.
No actual ChatGPT conversation identity/owner authorization, protected
native broker, real supervisor, production launcher or resource quota is
installed. Parent-death coverage is limited to tested children, not a
full app process tree or power loss.

**Windows/server dependency:** Do not drive somebody else's foreground
WinSta0 desktop or interactive Session 0. Provide an independently
provisioned and attested VM/RDP desktop/session under a protected owner
principal, then connect this same view-input-reobserve interface through
the authorized supervisor broker. Headless Chrome handles web apps only;
it is not a Windows desktop worker. Owner consent, session authentication,
key/approval protection, durable no-replay, resource/soak and Windows
visual acceptance are required. No stable merge, rollout, old Windows GUI
incident reset or production input enablement follows from this pilot.

Primary references:
- X.Org Xvfb: https://www.x.org/docs/man/man.pdf
- xdotool/XTEST: https://man.archlinux.org/man/xdotool.1.en
- Linux parent-death guard: https://man7.org/linux/man-pages/man2/PR_SET_PDEATHSIG.2const.html
- Windows interactive service boundary:
  https://learn.microsoft.com/en-us/windows/win32/services/interactive-services


## 2026-10-20 — Windows SQLite private journal QA (NoPromote)

- Scope: Dedicated Emad Server QA worktree **qa/saeed-win-journal-sqlite-20261020**;
  independent QA mirror on Amirreza Server. Production Core/router/plugin,
  shared GUI and pre-existing dirty worktrees were not changed.
- Implementation: **src/native-workspace-journal-win-sqlite-qa.mjs** invokes
  **tools/native-workspace-journal-win-sqlite-helper-qa.mjs** through the local
  Node executable for each pre-dispatch PREPARED and post-effect ACKED
  SQLite transaction. The short-lived helper releases Windows SQLite handles
  upon process exit; SQLite uses journal_mode=DELETE, synchronous=FULL,
  BEGIN IMMEDIATE, bound SQL parameters and unique operation IDs.
  No GUI keystrokes, coordinates or raw input bodies are stored in receipts.
- Verified runtime evidence (Windows, Node 22.23.3, 2026-10-20):
  - Emad Server: Node native-workspace-journal-win-sqlite-qa.test.mjs:
    **8 PASS / 0 FAIL / 0 SKIP / exit 0**.
  - Amirreza Server: three-file private mirror with SHA-256 matching
    originals on Emad Server: **8 PASS / 0 FAIL / 0 SKIP / exit 0**,
    without requiring Python.
  - Coverage: intent-before-effect, replay denial across re-open,
    per-workspace isolation after uncertain effect, actual child-process
    termination after intent, and two independent competing processes.
  - Negative tests first reproduced two failure paths: a missing SQLite file
    was silently recreated on inspect or dispatch. The QA helper now requires
    explicit one-time provision; prepare/ack fail closed when SQLite history
    is absent, inspect cannot create a database, and repeated provision
    cannot replace an existing database. Three new regression tests pass on
    both Windows hosts.
- Not production-qualified: authenticated ChatGPT conversation identity,
  protected OS/session principal and Windows ACL/reparse-point security,
  trusted owner-only provisioning and rollback-resistant history against
  malicious same-SID tampering,
  native Windows GUI worker or physical desktop non-interference, abnormal
  power-loss validation, signed installation, hosted CI and soak/recovery
  verification. Node 22 built-in SQLite is experimental. This QA module
  is NOT imported by Core and is NOT a native GUI input grant.
  No merge, remote push, plugin modification or live promotion.


## 2026-10-20 — Epoch-bound Windows Journal and Session Broker QA (NoPromote)

- Scope: Emad Server isolated QA branch and Amirreza Server read-only functional mirror;
  no change to installed Core, any live Windows desktop, router, plugin or main branch.
- Database-history integrity: a random per-root generation is written in a
  separate exclusively created, fsynced QA marker and bound to the SQLite
  metadata table. A missing DB with marker remaining refuses provisioning,
  a missing marker refuses inspection and dispatch, and a swapped DB with a
  different generation is refused before dispatch. An interrupted provisioning
  attempt is NOT auto-repaired or retried. These are fail-closed QA properties,
  not protection against intentional same-SID removal of BOTH files or a
  malicious same-SID process forging metadata.
- Windows Session Broker QA: untrusted caller/profile claims cannot issue a
  control lease; a trusted-adapter attestation callback supplies principal and
  allowed-workspace scopes. Observation receipts come only from the injected
  native observer. Leases are process-local WeakMap capabilities, one-shot,
  revision/age/TTL bounded and tied to one workspace. A supervisor takeover
  invalidates existing control and requires another observation. In-flight
  operations cannot be taken over; uncertain effects block only the affected
  workspace. The broker exposes NO journal provisioning method.
- Verification on both Emad Server and Amirreza Server (Windows Node 22.23.3):
  - Epoch-bound SQLite Journal: **11 pass / 0 fail / 0 skip** per host.
  - Broker QA: **11 pass / 0 fail / 0 skip** per host, including a real SQLite
    journal with a simulated native dispatch and two concurrent mock workers.
  - All cross-host mirrored source/test files were verified using SHA-256.
- Critical boundary: this is an IN-PROCESS CONTRACT TEST, not proof of a
  trusted ChatGPT conversation, Windows OS session identity, signed owner
  approval, same-SID isolation, Windows VM/RDP per-Agent desktops, physical
  keyboard/mouse separation, crash-consistent power-loss semantics, secure
  ACLs or sustained soak. No native mouse/keyboard commands were executed,
  and no production broker or worker was installed. A trusted, protected
  owner/transport attestor and genuinely isolated Windows worker remain
  release blockers.


## 2026-10-20 — Session-bound lease and pre-dispatch attestation QA

- Found and reproduced two missing checks in the QA Broker:
  a different authenticated context with the same principal ID but a
  different session could acquire a proof, and access revoked while an
  asynchronous observation was pending could still produce a usable proof.
- Changed QA contract: the trusted adapter must provide a non-empty,
  validated principalId, sessionId, role and allowedWorkspaces. Observation,
  acquisition, release and execution bind and revalidate principal, session,
  role and workspace. A lease is not transferable merely because its
  in-process object reference is shared with another caller. This is a QA
  attestor interface, NOT actual ChatGPT account or conversation proof.
- The Broker now revalidates authority and TTL at the exact native callback
  boundary, even after an awaited journal PREPARED transaction. It refuses
  a repeated effect callback for the same intent. Any failure leaves
  outcome evaluation to the protected Journal; there is no silent replay.
- Negative tests: stolen/forwarded lease, account revocation before execute,
  revocation during a pending observation, revocation or expiry between
  prepare and dispatch, repeated journal callback. All are fail closed in QA.
- Independent verification on Emad Server and Amirreza Server:
  **27/27 PASS, 0 FAIL, 0 SKIP, exit 0 on each host**, combining 11 SQLite
  Journal tests with 16 Session Broker tests. Sources mirrored to Amirreza
  were read back and SHA-256 verified. Emad Server had one earlier
  UNCERTAIN test runner receipt without conclusive result; no test process
  remained, and a subsequent fresh bounded run passed.
- No changes to installed Core, Router, owner credentials, plugins, live
  desktop sessions, or shared GitHub branches. No native mouse/keyboard
  commands were executed. Release still requires genuine platform identity,
  protected OS broker, Windows desktop isolation/ACL validation, real
  native worker acceptance, hosted CI, soak and power-loss tests.


## 2026-10-20 — Per-workspace subprocess IPC Worker QA (NoPromote)

- Scope: private Emad Server QA branch and independently executed Amirreza
  Server exact-source mirror. No installed Core, router, published plugin,
  user's desktop or shared GitHub branch was changed.
- Added src/native-workspace-worker-pool-win-qa.mjs and
  tools/native-workspace-worker-child-win-qa.mjs. Each opaque workspace
  launches its own Node child process with a dedicated IPC channel, a
  workspace-bound mock observer and mock input callback, and an independent
  operation counter. The worker receives a minimized process environment.
  No native Windows mouse, keyboard, screenshot, WinSta or RDP APIs are used.
- The pool refuses unallocated workspaces, duplicate allocation, invalid
  operation kinds and duplicate mock operation IDs. A child exit or response
  timeout rejects pending requests, marks that worker unavailable and does
  not automatically replay or restart a possibly completed action.
- End-to-end QA integrates the existing trusted-adapter simulation, the
  session-bound Broker, the Windows SQLite intent journal and real Windows
  child processes. A deliberate crash after PREPARED leaves only that
  workspace uncertain; a different worker can still complete and ACK.
  Separate child PIDs, independent frame digests and counters were observed.
- Verified on Windows Node 22.23.3:
  - Emad Server: combined Journal + Broker + Worker:
    **31/31 PASS, 0 FAIL, 0 SKIP, exit 0**.
  - Amirreza Server: exact 3-file QA mirror verified by SHA-256,
    combined suite **31/31 PASS, 0 FAIL, 0 SKIP, exit 0**.
  - After each run, process search found **zero** leftover mock-worker
    child processes on either host.
- Limitations / open release gates: Windows child-process separation under
  the same account is not an OS security boundary or a separately isolated
  interactive Windows desktop. The frame is a deterministic mock hash, not a
  screenshot. The effect counter is not real input injection. Verified
  ChatGPT conversation identity and protected owner/worker process tokens,
  Windows per-Agent interactive desktops (VM/RDP/WinSta isolation), ACL and
  hostile reparse-point audits, suspended/aborted process recovery, actual
  Windows GUI worker integration, power-loss and hosted CI must still pass
  before production promotion. Nothing here grants native desktop control.


## 2026-10-20 — Windows Desktop Object Host and hidden Win32 windows (NoPromote)

- Scope: Dedicated Emad Server Windows QA worktree, exact-source mirror
  on Amirreza Server; installed Core, Router, plugin, Windows desktop
  activation and production branches were not changed.
- Grounding: Both hosts have Windows 10 Enterprise 19045, Node 22.23.3,
  Windows Station WinSta0 and disconnected Administrator RDP session 2.
  Windows desktop objects within a single WinSta0 have window/message
  separation, but only one is the active input desktop at a time.
- Added tools/native-desktop-object-probe-win-qa.ps1:
  read-only Win32 Window Station, thread desktop and session inspection;
  separate optional test created two temporary desktop objects with
  CreateDesktopW, validated their names and CloseDesktop returned true.
- Added tools/native-desktop-host-two-children-win-qa.ps1 and
  tools/native-desktop-child-read-win-qa.ps1:
  two actual PowerShell child processes are started concurrently on two
  different temporary Win32 Desktop objects using STARTUPINFO.lpDesktop.
  The children independently attest their WinSta0 desktop name, PID and
  session ID. Each creates and then destroys a real but NOT SHOWN
  Win32 STATIC window using CreateWindowExW and DestroyWindow.
  Each HWND's owner process ID matches its child PID. All desktop handles
  were closed and the disposable QA observation files removed.
  No SwitchDesktop, SetThreadDesktop, ShowWindow, SendInput, mouse,
  keyboard, screenshot, real application interaction or RDP reconnect
  was performed.
- Added test/native-desktop-host-win-qa.test.mjs:
  requires both different desktop names/PIDs, both real windows
  created/destroyed, matching window-owner PIDs, child exit codes 0
  and CloseDesktop success, without changing the active desktop.
- Both Emad Server and Amirreza Server independently reported:
  **32/32 PASS, 0 FAIL, 0 SKIP, exit 0**, including the 11 Journal tests,
  16 Broker tests, 4 IPC Worker tests and the real Desktop Host/window test.
  The four new QA source/test files were compared across hosts by SHA-256.
  No leftover desktop host output directories or long-lived child workers
  were observed after test completion.
- Not yet accepted for production: Win32 Desktop objects are NOT
  independent Windows user sessions or isolated credentials. Both child
  processes run under the same Administrator token, and the test window
  was hidden; no independent framebuffer capture or real mouse/keyboard
  injection has been demonstrated. Windows input-desktop limitations,
  source-of-truth authenticated ChatGPT session attestation, protected
  host tokens/ACLs, actual app GUI observation, and genuine VM/RDP
  isolation remain critical release gates. No production promotion.


## 2026-10-20 — Cross-process scoped Desktop window observation (NoPromote)

- Starting state: clean QA branch at 96186780; two actual isolated desktop
  objects and two hidden STATIC windows previously qualified on each host.
- New observation: while each child keeps its own hidden Win32 STATIC window
  alive for a bounded interval, the host invokes EnumDesktopWindows on
  the explicit HDESK returned from CreateDesktopW for THAT private Desktop.
  It reads window owner PID and exact QA window title. Enumeration is
  restricted to the two new private QA desktops, never WinSta0\Default.
- Both Emad and Amirreza independently observed exactly one matching QA
  HWND owner PID on each desktop, matching its own child PID and NOT the
  other desktop's PID. Real CreateWindowExW + DestroyWindow, child desktop
  identity, and successful CloseDesktop were all reverified. This proves
  cross-process read-only enumerability, not full-frame screen capture.
- Windows 10 Enterprise 19045, session 2, WinSta0; the user-facing Default
  desktop remains unmodified. No mouse/keyboard injection, window display,
  SwitchDesktop, SetThreadDesktop, focus changes or RDP reconnect.
- Source files copied to Amirreza and read-back SHA-256 matched the Emad
  Server worktree. Combined Journal (11), Broker (16), Worker IPC (4) and
  Desktop Host observer (1) suite: **32/32 PASS, zero failures, zero skips,
  exit code 0 on EACH server**. The original per-workspace mock worker
  and the Win32 Desktop Host remain separate QA implementations.
- Release blockers unchanged: authenticated source-of-truth conversation
  identities, process/OS trust isolation against same-SID peers, protected
  provisioning and durable journal, joining Broker to the actual Desktop
  Host, reliable per-desktop pixels and input mechanisms, crash/power-loss
  behavior, concurrent human input isolation and hosted CI. This does not
  prove a full independent GUI operator.


## 2026-10-20 — Broker-linked ephemeral Desktop observations (NoPromote)

- Scope: isolated Emad Server QA branch, exactly mirrored and independently
  executed on Amirreza Server. No shared repository, production plugin,
  installed Core, active desktop, real mouse or keyboard was modified.
- New src/native-desktop-evidence-bridge-win-qa.mjs executes the local
  Windows private Desktop Host probe and validates two distinct ephemeral
  WinSta0 Desktop objects, each child session/PID, real Win32 hidden window
  creation/destruction, host-side scoped EnumDesktopWindows observation,
  matching PID and successful Desktop Handle closure. The bridge derives
  per-workspace SHA-256 fingerprints using a fresh local random nonce.
  These fingerprints are NON-PIXEL metadata, NOT authenticating signatures.
- The QA Broker's native observation contract is now observation-only by
  default. Acquisition of an input/action Lease from actual ephemeral
  Desktop evidence is denied with BROKER_OBSERVATION_NON_ACTIONABLE.
  The only explicitly action-capable QA observation mode is qa-simulated,
  used by existing simulated IPC Worker tests. There is no
  production native effect mode in this module.
- Added negative tests for swapped desktops, duplicate worker PIDs, wrong
  HWND owner PID, missing cleanup, reported window on the wrong Desktop,
  changed session/window station, and forged no-input reporting. Verified
  the Broker accepts scoped observation metadata for each authorized QA
  principal but refuses actionable leases and invokes neither Journal
  nor input dispatch for either Desktop.
- Emad Server AND Amirreza Server: combined SQLite Journal (11), QA Broker
  (16), IPC Worker (4), Desktop Host (1), Desktop evidence bridge (2):
  34/34 PASS, 0 FAIL, 0 SKIP, exit 0 per host. All five
  modified/new runtime and test files on the Amirreza mirror matched source
  SHA-256. The QA observer is a one-shot process: the Desktop Host closes
  its Desktops BEFORE the Broker sees evidence.
- Remaining high-priority gates: retain a real per-Workspace Desktop Host
  for the entire action lifecycle, bind a protected OS token and actual
  source-verified ChatGPT conversation/session identity, implement reliable
  per-desktop pixel capture, prove native input delivery and human
  non-interference, validate ACL/reparse defenses and durable crash
  recovery, hosted CI and rollback. This change deliberately DOES NOT
  claim that an ephemeral read-only snapshot can authorize native input.


## 2026-10-20 — Retained private Desktop lifecycle observations (NoPromote)

- Scope: private Emad Server QA worktree and exact-source, independently
  validated Amirreza Server QA mirror. No changes to installed Core,
  Windows live desktop, router, published plugin or shared GitHub branch.
- Added tools/native-desktop-lifecycle-host-win-qa.ps1, derived from
  the existing read-only Windows Desktop Host. It creates TWO uniquely
  named temporary WinSta0 Desktop objects and launches one PowerShell
  child on each via STARTUPINFO.lpDesktop. Each child holds a real but
  hidden Win32 STATIC window, which the host enumerates from the explicit
  desktop handle. This version performs THREE additional distinct,
  time-separated observations during each child's lifetime.
- Each round must observe exactly its own child's PID, never the other
  workspace. The Desktop handle and child remain the same across rounds.
  The child exits with code 0, its hidden HWND is destroyed, handles are
  closed and the dedicated two-file QA output directory is removed.
  No active-desktop switch, user input, focus, screen capture, RDP
  reconnect or production native effect occurs.
- Added test/native-desktop-lifecycle-win-qa.test.mjs: asserts
  two unique Desktop names and PIDs, three stable observation rounds,
  no cross-workspace PID leak, real window creation/destruction,
  no displayed windows, successful CloseDesktop, and clean exit.
- Windows 10 Enterprise 19045, Node 22.23.3, disconnected RDP session 2:
  Emad Server standalone 1/1 PASS; Amirreza Server standalone 1/1 PASS.
  Exact two-file copy verified with SHA-256 readback.
  Combined 6-suite regression: **35/35 PASS, 0 FAIL, 0 SKIP,
  exit 0 on EACH server**.
- Remaining blockers: this retained Desktop is alive only during a single
  bounded QA host invocation, not a durable service spanning requests.
  It remains same-token WinSta0 desktop-object separation, NOT a separate
  authenticated Windows user session. There is no pixel-level observation,
  native input delivery, independently authenticated ChatGPT conversation
  ownership, hardened OS broker, or human-input non-interference proof.
  No production promotion or deployment is authorized by these tests.


## 2026-10-20 — Bounded live private Desktop host IPC and Broker QA (NoPromote)

- Built a local observation-only Windows Desktop Host in
  tools/native-desktop-pipe-host-win-qa.cs and the QA launcher
  tools/native-desktop-pipe-host-win-qa.ps1. It holds TWO private WinSta0
  Desktop objects and real hidden STATIC windows across distinct operating
  system process requests (not just one script's in-memory observation
  loop). The child worker is tools/native-live-desktop-child-win-qa.ps1.
- A Windows named pipe with PipeOptions.CurrentUserOnly serves exactly
  status, observeA, observeB and shutdown. Native input, arbitrary commands,
  executable launches and access to WinSta0 Default are not available.
  This is a SAME-WINDOWS-SID transport boundary, not chat attestation
  or protection from malicious peers under the same Administrator token.
- Real cross-request qualification: on BOTH Emad and Amirreza servers, an
  independent detached host stayed alive while multiple separate Node
  client processes called status and both observations. Worker PID and
  private desktop name stayed constant across requests. A maliciously
  unsupported "click" request returned QA_COMMAND_DENIED. Explicit
  shutdown returned success; host process exited with code 0.
- Additional controls: server lifetime capped at 60,000 ms (QA only).
  Child window processes observe an owner stop event and parent death;
  children have a bounded maximum lifetime of 70 seconds. A new test
  deliberately omits shutdown and checks that timeout closes the host
  and both child processes, with no automatic desktop activation.
- Added src/native-desktop-live-evidence-bridge-win-qa.mjs. It validates
  the named Desktop/PID/window metadata and feeds non-actionable,
  per-workspace SHA-256 metadata observations to the existing Session
  Broker. An input/action lease from these observations is refused.
  The hash is NOT an OS attestation or image/screenshot digest. Separate
  tests reject forged workspace slot, PID, desktop, missing window and
  a falsely action-capable observation.
- Independent eight-suite combined regression:
  **39/39 PASS, 0 FAIL, 0 SKIP, exit 0 on EACH server** (Emad Server
  and Amirreza Server). Following the 60-second QA lifetime cap, the
  2-test persistent-pipe suite passed again on both hosts. All seven
  new source/test files were verified against the Amirreza QA mirror
  using SHA-256. Orphan process audit on both hosts reported zero live
  QA pipe host/child processes and zero Desktop Host temporary folders.
- Still NOT production qualified: a 60-second QA process is not an
  always-on service or restart-safe broker, and the transport is
  same-SID only. The Desktop objects are not separate Windows user
  security sessions. Secure source-verified ChatGPT chat identity,
  protected OS principal/worker privilege boundaries, journal power-loss
  replay tests, pixel capture, real GUI input within retained desktops,
  independent human input, supervisor takeover, SOAK/hosted CI, and
  release rollback remain mandatory. No Core, plugin or live desktop
  changes or production promotion were made.


## 2026-10-21 — Unified native-workspace QA baseline (NoPromote)

- Integration branch `integration/native-qa-unified-20261021` combines the retained Windows Desktop/IPC + SQLite journal QA series (ending at `1b1aec0`) with the scoped native coordinator input/admission hardening from `e5bcd05` (cherry-picked as `2a0f2fa`). Neither live Core nor the host GUI control route is changed.
- A fresh exact-tree Windows run executed 12 native-workspace test files: 80 discovered, 70 PASS, 0 FAIL, 10 platform-specific SKIP, exit 0. Durable stdout SHA-256: `ab5376abeda6133eecdb53c1391e005d7012966774e4e4c7fc16765d9e5f4b26`. Includes real private WinSta0 Desktop observation and bounded IPC host tests, but NOT user-desktop takeover or production input.
- An independent existing Linux QA source branch passed 87/87 scoped contract tests, exit 0, durable stdout SHA-256 `48589c3ca7ea0032c22cceed00cdfe5d934cd2daf312df548c962fea5465e218`. It is a different source tree, so this is NOT exact-tree Linux native acceptance of the unified branch.
- Hosted QA now additionally checks Windows SQLite journal, simulated session broker, and isolated mock worker contracts. Hosted CI results remain unverified until the exact integration head has a real workflow receipt. WinSta0 interactive-session acceptance cannot be inferred from hosted headless Windows CI.
- Windows desktop objects on the same interactive window station have exactly one active input desktop (Microsoft Learn: `/en-us/windows/desktop/winstation/desktops`). Consequently, the currently read-only private Desktop object host cannot substitute for independent simultaneous hardware-like keyboard/mouse input. Production requires an OS-supported independently interactive session or VM/desktop transport, protected OS ownership, authenticated per-chat attestation, live pixel capture and target-verified input/no-replay acceptance.
- Linux host-local portable Xvfb binaries were prepared without administrator changes, but the native two-GUI input test was rejected by the current Commander host GUI/input execution policy; it was NOT retried by an alternate route and is NOT accepted. Existing J01 unknown-effect incidents remain unchanged.
- Release decision: **SOURCE_QA_ONLY / NO_PROMOTE**. Core install, plugin distribution, J01 disposition, GitHub stable release and any system-wide GUI permission alteration are not authorized by these QA results.


## 2026-10-21 — Private-Desktop scoped managed UIA (QA only)

- Tested UI Automation architecture without using the owner's visible WinSta0 Default desktop, mouse, keyboard, focus or Desktop switching. Official Microsoft source: https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading (the UIA client must use a separate MTA thread when inspecting its own UI); https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-clientsoverview.
- Negative decision experiment: from a DIFFERENT Desktop, `AutomationElement.FromHandle` against an enumerated test-owned hidden HWND returned `Unrecognized error` on Emad Windows 10 Enterprise. This did NOT authorize fallback to the owner's Desktop. Discarded the failed external observer prototype, retained the evidence.
- Positive same-Desktop correction: added `tools/native-uia-owned-host-win-qa.ps1`, `tools/native-uia-owned-child-win-qa.ps1`, and `test/native-uia-private-observer-win-qa.test.mjs`. The unchanged existing bounded Win32 QA Desktop host creates TWO private, nonactive Desktop objects and isolated child PIDs; each child uses managed `UIAutomationClient` on a non-UI task thread to identify exactly its OWN known hidden static test window, and writes a constrained per-PID receipt. Parent verifies two distinct worker PIDs/desktops and matching receipts. No ChatGPT auth, pixel capture, native input or actual arbitrary app integration was implemented.
- Emad Windows Server exact local test: **1 PASS / 0 FAIL / 0 SKIP**, exit 0, bounded stdout SHA-256 `d3379e5470d62e5f978bb276228db23d288a1166ce728c84d23ce0a663796e6b`. Amirreza Windows Server isolated QA mirror: five source/test files transferred with exact SHA-256 parity, **1 PASS / 0 FAIL / 0 SKIP**, exit 0, stdout SHA-256 `d51090e0ab797d1aecfcad13d9307403e7f5a1dae18fb0269adcce10c4bfd931`. Each run closes the test host and its two worker processes, and removes owned receipt files.
- Extended this same owned-Desktop fixture with a synthetic Win32 single-line `EDIT` whose `ValuePattern` is explicitly capability-tested, enabled and non-read-only. The child performs exactly one bounded `ValuePattern.SetValue` on its own PID-bound control from an MTA task, pumps only its **own** private window messages and confirms both UIA and `GetWindowTextW` readback of a generated nonsecret fixture string. No physical keyboard, mouse, active desktop switch, focus or caller-supplied user HWND. This follows Microsoft's https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue and https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-threading .
- Windows-specific root causes repaired in QA: the compiler required `UIAutomationTypes` in addition to `UIAutomationClient` (CS0012), source used task delay instead of an unavailable thread symbol, an intermediate edit introduced a PowerShell parse failure that was explicitly caught by AST parsing, and atomic receipt reads/cleanup required bounded retries for transient `EBUSY`/`ENOTEMPTY`. No FAIL was reclassified as SKIP.
- Final exact edited two-test suite: Emad Windows Server **2 PASS / 0 FAIL / 0 SKIP**, exit 0, stdout SHA-256 `727d20354e352b7645aafff3e424fc618e11881e93ca15afba6512f819dc11f0`; Amirreza Windows Server exact SHA-256 mirrored two edited files and **2 PASS / 0 FAIL / 0 SKIP**, exit 0, stdout SHA-256 `c362fbb2af33a4106a102f6c35b7bb2568bc3d1384b695a5ecb77cf3ef6af958`. Acceptance: **OWN_DESKTOP_VALUEPATTERN_QA_PASS** for owned Win32 EDIT only, not real third-party UI or production input authority.
- Acceptance bound: **OWN_DESKTOP_UIA_OBSERVATION_QA_PASS** for the exact test fixture and two Windows 10 Enterprise systems. It does not prove a production agent can control UIA patterns, separate OS principals, simultaneous hardware-like input, authenticated chat ownership, J01 recovery or production installation. Keep `NoPromote` and separate source review from currently green PR #313.
