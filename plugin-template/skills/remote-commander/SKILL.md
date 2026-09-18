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

For repository work:
- inspect git status before mutation;
- do not stage unrelated files;
- run relevant tests after changes;
- report evidence rather than claiming success without verification.

For installation or recovery, follow the repository's START_HERE.md as the single source of truth.
