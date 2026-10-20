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


## Pending-native-effect observe-only continuity (2026-10-19 QA)

**Source branch:** fix/gui-uncertain-observe-only-20261019, pinned to
main commit 5cd6ec545b37dca32d63dc31c462bbe6d1399f3f.
Scope is only controller logic and tests: while a *valid* legacy
PENDING_NATIVE_EFFECT record exists, gui_status may probe the native
read-only backend and return readOnlyAvailable separately from
inputAvailable:false; a new GUI lease can be observe only and can
read screenshots, cursor and window list. Any mouse/keyboard/focus/scroll
takeover still fails GUI_INCIDENT_REVIEW_REQUIRED. An existing takeover
lease is revoked when the controller detects another profile's pending
record. Corrupt/unreadable incident storage, a local emergency STOP,
or an unavailable native backend remain fail-closed; no action is replayed,
and no incident file is modified. The old generic
GUI_OUTCOME_UNCERTAIN_RESTART_REQUIRED response is replaced for
non-mutating observation on this source candidate only, not for an
unauthorized input attempt. This is neither an owner reconciliation
nor an input-safety bypass.

**Evidence:** focused J01/controller/mutex test suites passed with
18/18 tests (no failure, no skipped cases); full npm run check,
npm test and npm run audit passed at the exact local QA tree, including
SECURITY_AUDIT_PASS. Hosted CI acceptance remains a separate gate
and must be checked on the exact GitHub PR SHA.

**Immediate installed-fleet continuity, separately scoped:** Saeid
Windows 0.10.24 and Emad PC Windows 0.10.24 retained their original
active GUI source SHA-256
A6A453333E1F6018A00207D59C75DD679392C88F4DD17946348F86FC55BE2E64.
An owner-local GUI-Safe-Observer.ps1 support script (SHA-256
15C9A82AEEACC4216EA4114F3CA831847F1CF51C655FAA135EC8D2E5E5093EE3)
performed actual read-only screen capture in each active Windows
console session, saved one PNG into a private ACL-restricted local
folder, and did not call native input. The exact incident SHA-256
before and after stayed identical on Saeid
C0E8EE65EDE1BE9DDE630C4FD9263E89596C3B0AEAD8D2298E229DD4153A710E
and Emad PC
38E11C4D5A5BB740D6A0B01C132A5D6874E6CBBCDFAC25F4FD1DBC5B4718E16E.
Both received the owner-facing Commander GUI Recovery Center Start Menu
entry with a Safe screenshot command. This does not install the
unmerged source patch, change stable version, reconcile a historical
incident, or enable GUI input; direct legacy gui_session_begin may still
return the old error until an independently accepted update is deployed.

**Next release gates:** qualified native/backend safety and old-version
compatibility; protected per-owner incident reconciliation, post-crash
cross-profile quiescence, signed/revocable grants, zero-interference
private desktop workers on Windows and Linux, Windows observed-image
acceptance on exact candidate, NoPromote updater acceptance and
guarded rollback. Detached/offline hosts must not be claimed fixed
without exact host execution/readback.


## Scoped GUI native-operation continuity candidate — 2026-10-19

**Status: isolated source QA; NOT deployed or stable-promoted.** On branch
fix/gui-scoped-uncertainty-no-global-lock-20261019 the default running
GUI controller uses src/gui-scoped-operation-journal.mjs for new native
operations; no legacy incident is deleted, replayed or misclassified as
known-not-applied. Existing read-only J01 controller behavior remains
testable as an explicit legacy compatibility mode.

**Product decision:** A historical user-account-scoped
PENDING_NATIVE_EFFECT is *diagnostic evidence*, not a permanent device-wide
lock. A fresh explicit takeover lease with a new screenshot/frame may
perform a genuinely new GUI step. Before each mutation the scoped journal
writes its own exclusive private durable intent file (operation GUID, type,
UTC time; no typed text, coordinates or screen pixels) and syncs it;
on verified helper submission the matching file is removed. A new error
leaves only that operation's file unresolved. Next action requires a newly
admitted lease and new screenshot; there is no background native replay.
gui_status differentiates an available backend and scopedUnresolvedCount
from historicalNativeOutcomeUncertain. The previous pending record is
preserved byte-for-byte for owner review. App permissions, GUI_STOP,
one-time frames, current-task takeover consent, Windows native helper
mutex and OS privileges are not bypassed.

**Known limits:** File-backed per-action records are not authenticated
cross-process identities. The existing shared foreground Windows desktop
cannot safely give each chat a simultaneous cursor; distinct VM/RDS
desktop sessions are still required for real parallel native GUI.
A native helper timeout leaves the specific action effect unknown and
requires re-observation before any next step; the system cannot infer
whether a save/submit already took effect. Emergency read-only support
remains available independently of Core. Windows NTFS directory
durability, forced power loss and cross-session migration need separate
acceptance; do not promote a source-only candidate to all devices without
the supported updater, per-profile compatibility and rollback.

**V&V:** new scoped-journal/controller tests cover an existing legacy
pending record, explicit new action, unknown action then independent next
action, two simultaneous operation IDs, intact historical evidence,
tampered records, and GUI_STOP. Existing legacy tests retain the old
fail-closed compatibility expectations. 107/107 focused tests passed
on MMZ Linux for the initial candidate. Full suite, Windows native
disposable E2E and hosted CI are separate acceptance gates.
