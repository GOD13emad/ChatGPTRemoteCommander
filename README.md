# ChatGPT Remote Commander

Windows-first MCP server for controlled project access from ChatGPT through OpenAI Secure MCP Tunnel.

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

`system_status`, `list_directory`, `read_text`, `write_text`, and `run_project_command`.

## Security

Filesystem containment is enforced, but command execution is **not an OS sandbox**. An allowlisted executable or project script may itself access resources beyond the configured roots. Treat command execution as privileged. See [SECURITY.md](SECURITY.md).

## Validation

The v0.1.0 release passed syntax checks, module smoke tests, direct MCP list/read/write/read-back/command regression, Secure MCP Tunnel doctor/readiness, and ChatGPT UI list/write/read/command calls.

## License

MIT — see [LICENSE](LICENSE).
