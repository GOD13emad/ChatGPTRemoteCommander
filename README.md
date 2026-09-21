# ChatGPT Remote Commander

![ChatGPT Remote Commander icon](assets/plugin-icon.png)

Cross-platform Windows + Linux MCP server for controlled remote project and machine access from ChatGPT through OpenAI Secure MCP Tunnel.

> **Giving this repository to ChatGPT for installation? Start with [START_HERE.md](START_HERE.md).** It is the single current source of truth for Standard/Full mode selection, install/update, Secure MCP Tunnel, persistent enrollment, ChatGPT custom app creation, Plugin packaging/install, icon use, real tool testing, autostart, stop/start, and FINAL PASS. For ChatGPT Work/Codex orchestration, also use [WORK_SETUP.md](WORK_SETUP.md).

**Setup guides in 10 languages:** [English](docs/SETUP.en.md) · [فارسی](docs/SETUP.fa.md) · [العربية](docs/SETUP.ar.md) · [Türkçe](docs/SETUP.tr.md) · [Español](docs/SETUP.es.md) · [Français](docs/SETUP.fr.md) · [Deutsch](docs/SETUP.de.md) · [Русский](docs/SETUP.ru.md) · [简体中文](docs/SETUP.zh-CN.md) · [日本語](docs/SETUP.ja.md)

[All setup guides](docs/README.md)
## v0.5 controlled desktop automation, hardened runtime ownership, and zero-reentry startup

v0.5 preserves all three deployment patterns: **one ChatGPT account -> multiple computers**, **multiple ChatGPT accounts -> one computer**, and **multiple concurrent chats -> the same computer**. Each computer runs its own MCP server; each account uses its own Secure MCP Tunnel profile; concurrent chat mutations on the same path are serialized to reduce write races.

After the one-time tunnel enrollment, you do **not** need to re-enter the Tunnel ID, local MCP address, health port, or Runtime API key after each login.

### Windows persistent startup

```powershell
.\enable-autostart.ps1 -Profile chatgpt-remote-commander
```

For an existing profile, this only asks for the Runtime API key once. It is stored with Windows DPAPI for the current user. An HKCU logon supervisor then starts/restarts the MCP server and every enrolled tunnel profile automatically.

### Linux persistent startup

```bash
./enable-autostart-linux.sh --profile "$(hostname)"
```

The Linux helper registers a systemd user service when available, otherwise falls back to `crontab`. Runtime keys are stored outside the repository in a user-only `chmod 600` credential file.

## One-command Windows install

Paste this into **PowerShell** for a standard safe-by-default install (it installs missing Git/Node.js/PowerShell 7 with `winget`, downloads and verifies the official OpenAI tunnel client, runs tests/audit, and starts the local MCP server):

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

For trusted machines that need full filesystem/shell/process control, add `-PowerMode`:

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

The same command is also the update command. On Windows v0.3.4+, the installer first detects an already-active installation from the registered supervisor and updates that Git checkout in place. Otherwise, new source code is installed under `%LOCALAPPDATA%\\ChatGPTRemoteCommander\\app`, while persistent state such as `credentials/` and `downloads/` stays one level above. `-StartServer` upgrades a running v0.3 MCP to the newly installed version when needed. The installer never embeds your OpenAI Runtime API key. After creating a Secure MCP Tunnel, run `enable-autostart.ps1` once to enroll the account and enable zero-reentry startup.

## One-command Linux install

```bash
curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

For Power Mode, add `--power-mode`. Linux amd64 and arm64 are supported by the installer when an official OpenAI tunnel-client artifact is available.

## Features

- Loopback-only MCP server by default (`127.0.0.1:47831`)
- Configurable allowed filesystem roots
- Directory listing and UTF-8 text reads
- Text writes with automatic backup and optional SHA-256 precondition
- Allowlisted direct executable execution without a shell wrapper
- Cross-platform Power Mode shell: PowerShell 7 on Windows, Bash-compatible shell on Linux
- JSONL audit log and recoverable file mutation backups
- Multi-account / multi-device Secure MCP Tunnel workflow
- Concurrent-chat path locking for mutating operations
- Windows and Linux persistent supervisors

## Windows GUI Control (v0.5)

Windows Power Mode can opt in to **built-in GUI Control**. The MCP itself returns live screenshots as image content and exposes bounded mouse, keyboard, window-focus and coordination tools, so ordinary supported desktop workflows do not require a separate Computer Use surface.

Safe visual-control loop:

```text
gui_status
→ gui_session_begin
→ gui_screenshot(lease)
→ one gui_* action(lease + single-use frame)
→ gui_screenshot(lease)
→ verify visible result
→ gui_session_end
```

A frame is short-lived and single-use. A second chat cannot take the active desktop lease. GUI actions are never considered successful merely because input was submitted; a fresh screenshot must verify the visible result.

Enable it on a trusted Windows checkout with:

```powershell
.\install.ps1 -PowerMode -GuiControl -StartServer -SkipTunnelClient
```

After enabling, refresh/re-scan the ChatGPT custom app tools. The owner can stop GUI input locally at any time by holding **Escape** or creating `var\GUI_STOP`; the assistant must not remove that stop file remotely.

Limits remain explicit: Windows Secure Desktop/UAC prompts, the lock screen, anti-cheat/protected-input paths, software that rejects synthetic input, and high-speed real-time gameplay are not bypassed. Different trust levels also require separate OS sessions/authorization; multiple tunnel profiles alone are not security isolation.

## Requirements

- Windows 10/11 with PowerShell 7, or a modern Linux distribution
- Node.js 22+
- Git
- OpenAI Secure MCP Tunnel client and a configured ChatGPT custom plugin/app

## Manual/developer start (optional)

Normal users should follow [START_HERE.md](START_HERE.md) and the latest Release installer. For source-level development only:

1. Clone the repository.
2. Review `config.json`; `%USERPROFILE%` is expanded at runtime.
3. Run `npm run check`.
4. Run `npm test`; expected result: `SMOKE_PASS`.
5. Start the MCP server with `npm start`.
6. Verify `http://127.0.0.1:47831/health`.

The MCP endpoint is `http://127.0.0.1:47831/mcp`.
## Connect ChatGPT

Follow [START_HERE.md](START_HERE.md) for the current end-to-end flow. Create an OpenAI Secure MCP Tunnel and Runtime API key, then run the persistent enrollment entry point:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

On Windows v0.5.0+, `connect-chatgpt.ps1` is the persistent enrollment entry point: it reuses an existing DPAPI-protected credential when available and leaves the background supervisor as the single owner of managed tunnel profiles.

In ChatGPT, create a custom MCP **app** with Connection = Tunnel, select the tunnel, use **None / No authentication** for this server, run **Scan Tools**, review permissions, and create the app. See [START_HERE.md](START_HERE.md) for the plan/workspace requirements and FINAL PASS checklist.

For Plugin packaging, icons, app binding, and private/workspace distribution, see [docs/PLUGIN_SETUP.md](docs/PLUGIN_SETUP.md) and [plugin-template](plugin-template/). For ChatGPT Work/Codex, [WORK_SETUP.md](WORK_SETUP.md) includes `@plugin-creator` plus self-contained latest-Release one-command app-bound installers for Windows/Linux. They accept either the underlying App ID or the `plugin_...` technical identifier shown by ChatGPT and automatically fetch the Release Plugin template when no checkout is present.

## Tools

Legacy-safe tools: `system_status`, `list_directory`, `read_text`, `write_text`, `run_project_command`. Power Mode adds `power_status`, `file_info`, `read_file`, `write_file`, `create_directory`, `copy_path`, `move_path`, `delete_path`, `search_files`, `run_shell`, `system_info`, `list_processes`, `kill_process`, and persistent terminal tools (`start_terminal`, `read_terminal`, `send_terminal`, `stop_terminal`).

## Security

Filesystem containment is enforced, but command execution is **not an OS sandbox**. An allowlisted executable or project script may itself access resources beyond the configured roots. Treat command execution as privileged. See [SECURITY.md](SECURITY.md) and the point-in-time [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Validation

v0.8.8 keeps the v0.8.7 persistent bounded GUI performance and deferred-drain safety work, and closes the router source-activation gap found during independent post-promotion audit. Every stable router now reports the SHA-256 of the exact router source loaded by its process; Windows and Linux supervisors require that loaded hash to match the authoritative promoted source and recycle only ownership-proven stale routers. This ensures router fixes actually become active after updates instead of waiting for a reboot. Explicit Full Power remains an all-on authority class, durable workflows remain crash/restart/update-resumable, and unknown or mutating old work is still never blindly replayed or force-killed.

 Each isolated account can use a distinct loopback MCP port, config, audit log, runtime marker and private workflow database; secondary profiles default to Standard Mode with GUI/shell/full-filesystem disabled. Workflow actions use intent-before-effect journaling, evidence checkpoints and explicit uncertain-outcome reconciliation with no automatic replay. Use `configure-durable-workflows.ps1` for the primary profile and `configure-profile-instance.ps1 -Profile <name>` (or `connect-chatgpt-account.ps1 -Profile <name> -Isolate`) for additional accounts. This is a local application boundary, not an OS sandbox: use separate Windows users/VMs for principals with different OS-level trust. See `docs/DURABLE_WORKFLOWS_R1.md` and `docs/PROFILE_ISOLATION_R1.md`.

v0.6.5 is an integrity hotfix over v0.6.4: SHA-256 write preconditions now fail closed when the target is missing or malformed, and interrupted moves preserve the only complete promoted copy plus explicit recovery evidence instead of risking data loss. v0.6.4 retained the v0.6.3 diagnostics/test-isolation and v0.6.2 Power Mode/GUI/runtime hardening, and added bounded Linux network operations so external-download failures cannot hang indefinitely. Legacy 2025 clients remain supported, while MCP `2026-07-28` clients receive stateless discovery/routing, required `tools/list` cache hints, strict protocol-header validation, closed-schema tool inputs, and tool-level `isError` failures for known-tool validation/runtime errors. The release gate includes a dependency-free real-server conformance test and was additionally exercised against the official `@modelcontextprotocol/client@2.0.0` in legacy, modern-auto, and modern-pinned modes. Linux installer and Plugin downloads use explicit connection/total deadlines; failures return nonzero instead of waiting without a bound. Persistent audit logs are serialized and bounded/rotated by default. `npm run doctor -- --expected-device <name>` performs a loopback-only read-only health/version/device/tool-catalog drift check against the active server. Use `npm run check`, `npm test`, `npm run audit`, and on Windows `npm run test:gui-native` before releases.

## License

MIT — see [LICENSE](LICENSE).

## Power Mode security model

Power Mode is an explicit Full-Control mode for trusted machines. The runtime automatically prefers `config.local.json` when present; this file is gitignored. The public `config.json` remains safe-by-default with Power Mode disabled.

On this machine, Power Mode can enable full filesystem access, direct PowerShell execution, process control, binary file I/O, recursive search, recoverable delete, and persistent terminal sessions. Existing files are backed up before Power Mode overwrite/move/delete operations. In explicit Full Power, permanent delete is enabled unless filesystem.permanent_delete is explicitly disabled in the persisted capability profile.

Explicit Full Power does not retain a hidden Commander shell-pattern denylist: shell capability is unrestricted unless shell.unrestricted or shell.execute is explicitly opted out. Runtime ownership checks, protected-process checks, operation journaling and OS permissions still apply. Full Power is intentionally privileged and is not an OS sandbox; expose it only to trusted accounts.

`FORBIDDEN: This conversation does not support developer MCPs` is a ChatGPT conversation-surface gate that occurs before requests reach this server; server code cannot bypass it. Use a fresh MCP-capable chat when that platform gate appears.

### Local private configuration

Copy the public configuration to `config.local.json`, enable only the Power Mode capabilities you want, and keep that file private. `config.local.json`, audit logs, backups, Runtime API keys, and tunnel credentials must never be committed.

## Multiple ChatGPT accounts on one PC

One MCP server can serve multiple authorized ChatGPT accounts. Each account gets its own Secure MCP Tunnel profile. Health ports are auto-selected; no manual IP/port management is required.

Enroll another Windows account once:

```powershell
.\enable-autostart.ps1 -Profile friend-pro
```

Enroll another Linux account once:

```bash
./enable-autostart-linux.sh --profile friend-pro
```

Each account must use its own tunnel and Runtime API key. The supervisor automatically starts every enrolled profile that points to this local MCP. For one account controlling multiple computers, repeat the installation/enrollment on each computer with a distinct tunnel so each device appears separately in ChatGPT.
