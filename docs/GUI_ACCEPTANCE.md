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
