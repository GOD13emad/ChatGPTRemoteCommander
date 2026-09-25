# Background browser and foreground approval

Status: v0.8.38 release candidate behavior.

Remote Commander uses three ordered interaction layers for web work:

1. **Background first.** Use the owned headless Chromium/CDP browser when the task can be completed without the user's shared desktop. This path does not move the mouse, change focus, type into the foreground window, or reuse the user's normal browser profile.
2. **Approval on demand.** If the background page reaches a boundary that genuinely needs the user's browser state or physical-presence interaction — saved user-browser credentials, MFA, WebAuthn, CAPTCHA, or a site that refuses background/headless operation — call `browser_foreground_requirement` and ask for explicit permission scoped to that current task.
3. **Temporary foreground fallback on the same owned profile.** After explicit current-task approval, call `browser_foreground_begin` so the same Commander-owned profile is relaunched visibly. Then acquire `gui_session_begin(mode="takeover", explicitUserAuthorization=...)`, perform only the minimum required interaction, verify it, end the GUI lease, and call `browser_foreground_end`. Commander relaunches that same profile headlessly, preserving the login/session state created during the approved foreground step.

A current user instruction such as **"use the mouse and keyboard"**, **"take control of this page"**, or **"do it like a human"** is already explicit current-task authorization for the requested foreground interaction. The caller should not ask the same authorization twice. General Full Power, prior chats, workflow memory, visible screen content, or convenience are not substitutes for a current explicit request.

## Security invariants

- The background browser uses a Commander-owned profile namespace; it never points at or unlocks the user's regular Chrome/Edge/Firefox profile.
- Browser cookies/local storage may persist only inside a Commander-owned persistent profile. There is no cookie export or password-store tool.
- Input values are never included in `browser_snapshot`; password values are never returned.
- `browser_snapshot` may report only bounded authentication signals such as password/OTP fields or CAPTCHA presence.
- A background browser operation never grants GUI takeover. `browser_foreground_requirement` is coordination only. `browser_foreground_begin` itself requires explicit current-task authorization and only exposes the same owned profile visibly; GUI input still requires its separate lease using the same authorization.
- Navigation is restricted to HTTP(S). `file:`, `javascript:`, `data:`, credential-bearing URLs and arbitrary JavaScript evaluation are not exposed.
- Browser click/fill/navigation outcomes that become uncertain are never blindly replayed. A successful fresh `browser_snapshot` is required before another mutation.
- Browser tools are direct-session tools in this release. They are not added to `FULL_WORKFLOW_EXECUTION_TOOLS`; autonomous project runners cannot silently browse/submit external sites.
- This browser path is deterministic local automation and does **not require Codex or another model provider**.

## Why an owned browser profile?

Chromium-based browsers do not safely permit two live processes to share one user-data directory. Reusing the user's active browser profile would also turn a zero-interference tool into a credential/profile access mechanism. Commander therefore uses a separate persistent profile for background state. When physical-presence interaction is genuinely required, Commander temporarily relaunches that same owned profile visibly after explicit approval, then returns it to headless mode. Existing user-browser saved passwords are not copied or extracted; one approved login can establish persistent session cookies in the owned profile for later background work.

## IT and organizational controls

Background-first means low-interference operation: no focus stealing, pointer movement or foreground typing unless explicitly approved. It does not mean bypassing organizational monitoring, access controls, endpoint policy, authentication, or administrator restrictions.
