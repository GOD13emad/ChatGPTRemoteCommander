# Coucou Bridge — optional display-only Commander extension

## Identity and scope
- Purpose: show accepted Commander workflow lifecycle/operation events as a Coucou floating session pill.
- Owner scope: Emad Windows, Saeid Windows and Emad Linux only. **DO NOT INSTALL ON MMZ**; MMZ gets Commander+Browser only.
- Coucou is third-party desktop software, not bundled here. Its code is MIT but branding, Mochi, icons and sounds are separately protected.
- This extension grants NO additional Core execution, filesystem, GUI control, approval, STOP, or ChatGPT conversation authority.

## Safe activation — not automatic
1. Install the official Coucou desktop separately with owner consent and verify its upstream release SHA. On Windows, the upstream installer is currently unsigned; never auto-bypass SmartScreen.
2. Confirm Coucou's real local hook binary at %LOCALAPPDATA%\Coucou\bin\coucou-hook.exe (Windows) or ~/.local/share/coucou/bin/coucou-hook (Linux).
3. In a versioned, reviewed Commander config revision, set coucouBridge.enabled = true and coucouBridge.hookPath to that exact absolute executable path. Preserve the previous accepted config and journal; do not blindly restart or promote.
4. Verify system_status.coucouBridge.ready=true and run a private synthetic workflow event; inspect real Coucou UI before claiming visual acceptance.
5. Disable by setting enabled=false in a controlled future configuration revision. No removal of the user's existing Coucou hooks or accounts.

## Privacy and behavior
- Only fixed safe labels and opaque per-process session ID. No tool arguments, file paths, prompts, user profile, browser cookies, credentials, project text, errors or arbitrary command output is transmitted.
- User-local hook executable is invoked without shell, with a small allowlisted environment, one child at a time and a 750 ms termination budget.
- The Core remains fully usable if Coucou is absent, closes or fails. Hook exit code zero is not GUI display acknowledgment and not authenticated ChatGPT message delivery.
- No PermissionRequest or approvals to Coucou custom agents; Coucou is observer only. STOP remains in Commander/Control Center.

## Verification and open gates
- Core unit: node --test test/coucou-bridge.test.mjs
- Cross-OS hosted: npm run check, npm test, and separate native Coucou hook IPC test after Coucou is available.
- Native GUI and actual Coucou installation are NOT VERIFIED in this R1 candidate.
- Upstream event schema: https://github.com/Louis-CFM/coucou/blob/main/docs/AGENTS.md
- Upstream license of names/art: https://github.com/Louis-CFM/coucou/blob/main/LICENSE-ASSETS.md
