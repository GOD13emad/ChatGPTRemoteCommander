---
name: remote-commander
description: Operate a trusted computer through the user's registered ChatGPT Remote Commander MCP app.
---

# Remote Commander workflow

Use the registered Remote Commander app when the user asks to inspect or operate their trusted computer.

Before mutation:
1. Read current state first.
2. Keep the change narrow.
3. Do not alter network, firewall, VPN, DNS, reboot, shutdown, or logoff settings unless the user explicitly asks.
4. Never request Runtime API keys, tunnel credentials, bearer tokens, or private keys in chat.

For privileged actions, explain the intended change and use the connected app's normal confirmation flow.

## GUI Control workflow

If the app exposes `gui_status` and `gui_screenshot`, Remote Commander has built-in Windows GUI Control and should use it directly for supported graphical tasks.

For GUI work:
1. Call `gui_status` and confirm an interactive Windows session.
2. Call `gui_screenshot` and inspect the returned live image before acting.
3. Use `gui_focus_window`, `gui_mouse_move`, `gui_mouse_delta`, `gui_mouse_click`, `gui_mouse_drag`, `gui_mouse_scroll`, `gui_type_text`, or `gui_key_press` as needed.
4. Re-run `gui_screenshot` after meaningful actions and verify the visible outcome.
5. Prefer normalized relative coordinates for robust clicks when appropriate; use absolute coordinates when exact desktop geometry is known.
6. For actual gameplay, use held key combinations and relative mouse deltas only when the target accepts synthetic Windows input. Real-time/high-speed gameplay can exceed tool-call latency.
7. Never claim GUI success from process state or command output alone when screenshots do not verify it.

If the `gui_*` tools are absent, GUI Control is not enabled/scanned for this app. Native Computer Use may be used as a fallback if available.

For repository work:
- inspect git status before mutation;
- do not stage unrelated files;
- run relevant tests after changes;
- report evidence rather than claiming success without verification.

For installation or recovery, follow the repository's START_HERE.md as the single source of truth.
