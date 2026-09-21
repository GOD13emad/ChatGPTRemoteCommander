# GUI acceptance gates — v0.8.12

The v0.8.12 release changes updater version monotonicity only and retains all v0.8.11/v0.8.10 GUI behavior. The v0.8.11 release retains the v0.8.10 explicit takeover boundary unchanged. The v0.8.11 code delta is in stable-router response-drain accounting, not native GUI input behavior. The v0.8.10 release adds an explicit takeover boundary on top of the v0.8.9 non-intrusive updater design. `gui_session_begin` defaults to observe-only; screenshot/window/cursor reads may proceed under that lease, but mouse/keyboard/scroll/focus mutations fail before native input unless the session was opened as `mode="takeover"` with an `explicitUserAuthorization` basis grounded in an explicit current user request. Full Power is capability authority, not implicit foreground-desktop permission. Durable workflow calls are not a valid interactive authorization channel: they may observe when permitted, but takeover acquisition and GUI mutation are direct-session-only.

The v0.8.9 release retains the v0.8.7 bounded Windows GUI lease/frame safety model and persistent helper plus v0.8.8 router source-activation verification. It also separates unattended update verification from interactive desktop E2E so scheduled updates never need to steal focus. On the validated Windows target, warm status reads measured 16.09 ms median, window-list reads 36.76 ms through the controller, and 1000 px JPEG screenshots 87.40 ms through the controller, while the real native E2E still passed capture, exact-window focus, click, Farsi/Japanese Unicode typing, button activation, screenshot verification, cursor restore and foreground restore (GUI_NATIVE_E2E_PASS). GUI authorization remains an explicit capability that can be persistently opted out while the rest of Full Power stays enabled.

These measured Windows results do not waive the remaining release gates below for installer/update/tunnel/ChatGPT integration, Linux regression, multi-monitor/DPI coverage, locked/Secure Desktop behavior, anti-cheat/protected input, or real-time gameplay.

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
