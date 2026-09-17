# Changelog

## 0.2.0 — 2026-09-17

Power Mode release.

- Added explicit Full-Control Power Mode with safe public defaults and private `config.local.json` override.
- Added full-filesystem file info/read/write/create/copy/move/delete/search tools.
- Added direct bounded PowerShell execution with blocked shutdown/restart/logoff patterns.
- Added process listing/control with protected Windows process names.
- Added persistent PowerShell terminal sessions with read/send/stop actions.
- Added binary file base64 I/O and larger configurable bounds.
- Added pre-mutation backups and soft-delete backups; permanent delete separately gated and disabled locally.
- Added Power Mode smoke regression and local MCP E2E validation.
- Runtime now exposes 22 MCP tools in v0.2.

## 0.1.0 — 2026-09-17

Initial public release.

- Local Windows MCP server on loopback
- OpenAI Secure MCP Tunnel workflow
- `system_status`, `list_directory`, `read_text`, `write_text`, and `run_project_command`
- realpath filesystem containment
- write backup + SHA-256 precondition support
- executable allowlist and selected eval blocking
- JSONL audit logging
- legacy and modern MCP protocol support used by ChatGPT tunnel sessions
- end-to-end validation from ChatGPT UI for list/read/write/command paths
