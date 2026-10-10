# Remote Commander — Coucou Bridge R1 (draft)

State: development/verification candidate. OFF by default. Not merged or released. Coucou itself is not installed by this code.

## Goal and added features
- Read-only floating Coucou pill for Commander workflow and operation lifecycle on Windows/Linux.
- Labels for accepted creation, run start, checkpoint, progress, wait-for-review, resolution, and failure.
- No Commander native Browser replacement, no authentication or permission delegations, and no true ChatGPT reply receipt.
- Status appears in Commander system_status.coucouBridge; relayProcessExitedZero only reports a local relay subprocess outcome.

## Protocol and privacy
Protocol: official Coucou local CLI hook with --agent remote-commander and newline-delimited JSON; Windows user-local named pipe or Linux user-local Unix socket handled by the official hook.
Allowlisted events only: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, PostToolUseFailure, StopFailure.
Every JSON event contains only hook_event_name, coucou_agent, opaque session_id and a fixed tool_name label; never sends raw tool arguments, file paths, prompts, API keys, hostnames, session credentials or browser content.
No custom PermissionRequest; third-party agent approvals remain in their originating tool. No clipboard or GUI input.
Bridge child is nonblocking best-effort: direct hook executable without shell, 750ms child timeout, one in flight, secret-free environment, no blind resend.

## Configuration — owner opt-in required
Default: coucouBridge absent or enabled=false -> 0 processes and 0 IPC.
After official Coucou local install and verified SHA, add a controlled Core config fragment:
  coucouBridge: { enabled: true, hookPath: "<ABSOLUTE VERIFIED coucou-hook EXECUTABLE>" }
Expected Windows relay path after Coucou startup: %LOCALAPPDATA%\Coucou\bin\coucou-hook.exe.
Expected Linux relay path after Coucou startup: ~/.local/share/coucou/bin/coucou-hook.
Do not patch live config without preserving baseline, router/journal continuity, rollback and static/dynamic tests. Explicit opt-in only.

## Deployment scope and release gates
Allowed: Emad PC Windows, Saeid PC Windows, Emad laptop Linux. Disallowed: MMZ Ubuntu Linux; only Commander+Browser for MMZ.
1. Unit tests plus npm run check/test and hosted Windows/Linux CI.
2. Verify Coucou official binary hashes and install program with owner approval, never bundle protected Coucou/Mochi art or third-party credentials.
3. Enable via controlled canary; test actual hook/pipe socket and Coucou native UI; assert session/account and GUI uncertainty latches remain unchanged.
4. Owner-authenticated Control Center opt-in toggle and uninstall procedure, independent rollback, release and Project Brain handoff.

Source contract: https://github.com/Louis-CFM/coucou/blob/main/docs/AGENTS.md
Separate Coucou asset licensing: https://github.com/Louis-CFM/coucou/blob/main/LICENSE-ASSETS.md
Open gate: Coucou not yet installed on allowed hosts; GitHub PR and real GUI acceptance pending.
