# Browser native GUI_STOP integration — unreleased candidate

This candidate extends the existing GUI safety latch, not the existing MCP tool list or command admission policy.

The native Browser chrome can create a private owner-only file named GUI_STOP inside the existing browser-companion directory after two explicit local button presses. Core observes the same path in its ordinary GUI stop guard on Windows and Linux. All screenshot and input tools continue to fail shut when the stop signal exists.

The browser-control change grants no arbitrary command execution, no resume, no remote input authority, and no capability to browser page JavaScript. The existing Core emergency stop in the release var directory and Linux user-state global stop remain supported.

Do not release or install this Core candidate until its plugin/onboarding version contract and the exact Browser release dependency pass a hosted Windows/Ubuntu CI gate. Do not publish Browser control ahead of this Core backend.
