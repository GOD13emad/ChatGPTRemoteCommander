# ChatGPT Remote Commander

Windows-first MCP server for controlled project access from ChatGPT through OpenAI Secure MCP Tunnel.

**Setup guides in 10 languages:** [English](docs/SETUP.en.md) · [فارسی](docs/SETUP.fa.md) · [العربية](docs/SETUP.ar.md) · [Türkçe](docs/SETUP.tr.md) · [Español](docs/SETUP.es.md) · [Français](docs/SETUP.fr.md) · [Deutsch](docs/SETUP.de.md) · [Русский](docs/SETUP.ru.md) · [简体中文](docs/SETUP.zh-CN.md) · [日本語](docs/SETUP.ja.md)

[All setup guides](docs/README.md)
## One-command Windows install

Paste this into **PowerShell** for a standard safe-by-default install (it installs missing Git/Node.js/PowerShell 7 with `winget`, downloads and verifies the official OpenAI tunnel client, runs tests/audit, and starts the local MCP server):

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -StartServer
```

For trusted machines that need full filesystem/shell/process control, add `-PowerMode`:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

The installer never embeds your OpenAI Runtime API key. After local installation, create your own Secure MCP Tunnel and run `connect-chatgpt.ps1` interactively.

## Features

- Loopback-only MCP server by default (`127.0.0.1:47831`)
- Configurable allowed filesystem roots
- Directory listing and UTF-8 text reads
- Text writes with automatic backup and optional SHA-256 precondition
- Allowlisted project command execution through `pwsh.exe`
- JSONL audit log
- OpenAI Secure MCP Tunnel workflow
- Tested end-to-end from ChatGPT UI

## Requirements

- Windows 10/11
- PowerShell 7 (`pwsh.exe`)
- Node.js 22+
- Git for the Git command examples
- OpenAI Secure MCP Tunnel client and a configured ChatGPT custom plugin/app

## Quick start

1. Clone the repository.
2. Review `config.json`; `%USERPROFILE%` is expanded at runtime.
3. Run `npm run check`.
4. Run `npm test`; expected result: `SMOKE_PASS`.
5. Start the MCP server with `npm start`.
6. Verify `http://127.0.0.1:47831/health`.

The MCP endpoint is `http://127.0.0.1:47831/mcp`.
## Connect ChatGPT

Create an OpenAI Secure MCP Tunnel and Runtime API key, then keep the local MCP server running and launch:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

The script validates local health, configures a `sample_mcp_remote_no_auth` tunnel profile, runs `tunnel-client doctor`, and starts the foreground tunnel. The Runtime API key is entered as a hidden SecureString and is not written into the repository.

In ChatGPT, create a custom plugin/app with Connection = Tunnel, select the tunnel, use no authentication for this server, review permissions, and create the plugin.

## Tools

Legacy-safe tools: `system_status`, `list_directory`, `read_text`, `write_text`, `run_project_command`. Power Mode adds `power_status`, `file_info`, `read_file`, `write_file`, `create_directory`, `copy_path`, `move_path`, `delete_path`, `search_files`, `run_shell`, `system_info`, `list_processes`, `kill_process`, and persistent terminal tools (`start_terminal`, `read_terminal`, `send_terminal`, `stop_terminal`).

## Security

Filesystem containment is enforced, but command execution is **not an OS sandbox**. An allowlisted executable or project script may itself access resources beyond the configured roots. Treat command execution as privileged. See [SECURITY.md](SECURITY.md) and the point-in-time [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Validation

v0.2.1 passed syntax checks, legacy smoke tests, Power Mode smoke tests, live MCP discovery with 22 tools, full-filesystem write/read testing, direct shell testing, recoverable-delete testing, and Secure MCP Tunnel readiness. Run `pwsh.exe -NoProfile -File .\\test\\security-audit.ps1` before public releases.

## License

MIT — see [LICENSE](LICENSE).

## Power Mode (v0.2)

v0.2 adds an explicit Full-Control mode for trusted machines. The runtime automatically prefers `config.local.json` when present; this file is gitignored. The public `config.json` remains safe-by-default with Power Mode disabled.

On this machine, Power Mode can enable full filesystem access, direct PowerShell execution, process control, binary file I/O, recursive search, recoverable delete, and persistent terminal sessions. Existing files are backed up before Power Mode overwrite/move/delete operations. Permanent delete is separately gated and disabled in the provided local policy.

The local policy blocks automatic shutdown, restart and logoff command patterns. Power Mode is intentionally privileged and is not an OS sandbox. Use ChatGPT action permissions and only expose a tunnel to trusted accounts.

`FORBIDDEN: This conversation does not support developer MCPs` is a ChatGPT conversation-surface gate that occurs before requests reach this server; server code cannot bypass it. Use a fresh MCP-capable chat when that platform gate appears.

### Local private configuration

Copy the public configuration to `config.local.json`, enable only the Power Mode capabilities you want, and keep that file private. `config.local.json`, audit logs, backups, Runtime API keys, and tunnel credentials must never be committed.

## Multiple ChatGPT accounts on one PC

One MCP server can serve multiple authorized ChatGPT accounts. Keep the MCP server on `127.0.0.1:47831`, but run one Secure MCP Tunnel process per account with a unique tunnel profile and health port.

Example: keep the owner's existing tunnel on health port `47832`, then connect a second account with:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt-account.ps1 -Profile friend-pro -HealthPort 47833
```

The script prompts for that account's own `tunnel_id` and Runtime API key. Do not reuse/share Runtime API keys between accounts. A third account can use another profile and port, for example `-Profile account-3 -HealthPort 47834`.
