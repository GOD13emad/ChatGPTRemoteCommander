# ChatGPT Remote Commander

Cross-platform Windows + Linux MCP server for controlled remote project and machine access from ChatGPT through OpenAI Secure MCP Tunnel.

**Setup guides in 10 languages:** [English](docs/SETUP.en.md) · [فارسی](docs/SETUP.fa.md) · [العربية](docs/SETUP.ar.md) · [Türkçe](docs/SETUP.tr.md) · [Español](docs/SETUP.es.md) · [Français](docs/SETUP.fr.md) · [Deutsch](docs/SETUP.de.md) · [Русский](docs/SETUP.ru.md) · [简体中文](docs/SETUP.zh-CN.md) · [日本語](docs/SETUP.ja.md)

[All setup guides](docs/README.md)
## v0.3 topology and zero-reentry startup

v0.3 supports all three deployment patterns: **one ChatGPT account -> multiple computers**, **multiple ChatGPT accounts -> one computer**, and **multiple concurrent chats -> the same computer**. Each computer runs its own MCP server; each account uses its own Secure MCP Tunnel profile; concurrent chat mutations on the same path are serialized to reduce write races.

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
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -StartServer
```

For trusted machines that need full filesystem/shell/process control, add `-PowerMode`:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

The same command is also the update command. On Windows v0.3.3+, the installer first detects an already-active installation from the registered supervisor and updates that Git checkout in place. Otherwise, new source code is installed under `%LOCALAPPDATA%\\ChatGPTRemoteCommander\\app`, while persistent state such as `credentials/` and `downloads/` stays one level above. `-StartServer` upgrades a running v0.3 MCP to the newly installed version when needed. The installer never embeds your OpenAI Runtime API key. After creating a Secure MCP Tunnel, run `enable-autostart.ps1` once to enroll the account and enable zero-reentry startup.

## One-command Linux install

```bash
curl -fsSL https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.sh | bash -s -- --install-prerequisites --start-server
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

## Requirements

- Windows 10/11 with PowerShell 7, or a modern Linux distribution
- Node.js 22+
- Git
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

On Windows v0.3.2+, `connect-chatgpt.ps1` is a compatibility entry point for persistent mode: it delegates to the idempotent autostart enrollment flow, reuses an existing DPAPI-protected credential when available, and does not start a duplicate foreground tunnel. The background supervisor remains the single owner of managed tunnel profiles.

In ChatGPT, create a custom plugin/app with Connection = Tunnel, select the tunnel, use no authentication for this server, review permissions, and create the plugin.

## Tools

Legacy-safe tools: `system_status`, `list_directory`, `read_text`, `write_text`, `run_project_command`. Power Mode adds `power_status`, `file_info`, `read_file`, `write_file`, `create_directory`, `copy_path`, `move_path`, `delete_path`, `search_files`, `run_shell`, `system_info`, `list_processes`, `kill_process`, and persistent terminal tools (`start_terminal`, `read_terminal`, `send_terminal`, `stop_terminal`).

## Security

Filesystem containment is enforced, but command execution is **not an OS sandbox**. An allowlisted executable or project script may itself access resources beyond the configured roots. Treat command execution as privileged. See [SECURITY.md](SECURITY.md) and the point-in-time [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Validation

v0.3.3 includes the v0.3 cross-platform gates plus persistent-enrollment, installer/update-path, and runtime-upgrade validation. Windows and Linux syntax/install checks, safe and Power Mode smoke tests, concurrency tests, and secret scanning remain part of the release gate. Use `npm run check`, `npm test`, and `npm run audit` before releases.

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
