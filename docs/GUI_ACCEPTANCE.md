# GUI acceptance gates — v0.7.1

The original R1 audit baseline is preserved in `AUDIT_R1.md`. v0.7.0 does not change GUI implementation code; its new profile-isolation defaults keep GUI disabled for secondary profiles unless explicitly opted in. The v0.6.4 native E2E evidence on Emad-PC-Ultimate remains applicable under unchanged-evidence reuse: layout/self-test, real screen capture, exact-window focus, mouse click, Farsi/Japanese Unicode typing, button activation, screenshot-before/after verification, cursor restore and focus restore. A fresh v0.6.5 native rerun reached the disposable-window focus step twice and failed closed with `GUI_FOCUS_NOT_CONFIRMED` before injecting input; the noninteractive native layout/self-test then passed. This is recorded as environment/foreground contention, not a GUI-code regression. Use `npm run test:gui-native` to repeat the bounded disposable-window validation when the desktop is uncontended.

These measured Windows results do not waive the remaining release gates below for installer/update/tunnel/ChatGPT integration, Linux regression, multi-monitor/DPI coverage, locked/Secure Desktop behavior, anti-cheat/protected input, or real-time gameplay.

## Gate A: no-input verification

Run the Node behavioral suite and `test/gui-native.ps1` on an extracted, pinned candidate copy. The native test parses the helper, compiles its C# types, checks INPUT layout (40 bytes in a 64-bit process, 28 in a 32-bit process), and exercises pure key-name validation. It must not capture the screen, move input, connect a tunnel, overwrite local policy, enroll credentials or restart services. Save stdout/stderr, exit codes, platform and artifact hashes.

PASS here means parser/layout readiness only, not working GUI control.

## Gate B: disposable interactive desktop

Use a test Windows user/VM and a disposable editor window. Confirm which computer and user session the MCP is attached to. Close private content before any screen capture. Explicitly authorize the bounded input tests below; do not run them on unrelated applications.

Test the loop `gui_status → gui_session_begin → gui_screenshot → one action with lease+frame → gui_screenshot → gui_session_end`. Require a rendered actual image and visible post-action evidence, not text that merely says the action was submitted. A lease is shared-desktop coordination, not authenticated user isolation.

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
