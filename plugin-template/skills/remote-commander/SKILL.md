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

## GUI / Computer Use boundary

Remote Commander is for filesystem, shell, process, project, and other backend operations exposed by its MCP tools. It does not itself provide interactive visual desktop control.

If a task requires seeing and reacting to the live GUI, including actually playing a game:
1. Check whether Computer Use / graphical desktop control is available in the current ChatGPT conversation or Work task.
2. If available, use Computer Use for live visual interaction (screen, mouse/clicks, keyboard or controller-style input) and use Remote Commander for filesystem/shell/process/backend operations.
3. If unavailable, explicitly state that live GUI control is unavailable in the current surface.
4. Do not simulate or claim GUI/gameplay success from process status, logs, screenshots, shell output, or application launch alone.
5. You may still launch the application, inspect files/logs/processes, change supported configuration, and prepare/debug the environment.

For repository work:
- inspect git status before mutation;
- do not stage unrelated files;
- run relevant tests after changes;
- report evidence rather than claiming success without verification.

For installation or recovery, follow the repository's START_HERE.md as the single source of truth.
