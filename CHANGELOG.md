# Changelog

## 0.3.0 — 2026-09-17

Cross-platform, multi-topology and zero-reentry startup release.

- Added Windows + Linux core runtime support and Linux amd64/arm64 installer paths.
- Added one account -> many computers and many accounts -> one computer deployment support.
- Added concurrent-chat stress coverage and path-scoped mutation locking.
- Added automatic tunnel health-port selection for additional accounts.
- Added Windows logon supervisor with DPAPI-protected per-profile Runtime API keys.
- Added Linux supervisor with systemd-user/crontab registration and user-only credential files.
- Added automatic MCP/tunnel restart supervision after login or transient process failure.
- Added portable direct executable execution for safe-mode project commands.
- Added Windows + Ubuntu CI matrix configuration and cross-platform security audit.
- Validated real Ubuntu/WSL Standard and Power Mode installs, including official OpenAI tunnel-client SHA-256 verification.

## 0.2.1 — 2026-09-17

- Added repeatable repository security audit (`npm run audit`) covering current tracked files and Git history.
- Added `SECURITY_AUDIT.md` with verified findings and privacy notes.
- Added click-by-click setup guides in 10 languages: English, Persian, Arabic, Turkish, Spanish, French, German, Russian, Simplified Chinese, and Japanese.
- CI now checks full Git history and runs the security audit after syntax and smoke tests.
- Added a tested one-command Windows installer with optional prerequisite installation, official tunnel-client checksum verification, Standard/Power Mode selection, local validation, and optional server startup.
- Added one-command install instructions to all 10 language guides.

## 0.2.0 — 2026-09-17

Power Mode release.

- Added explicit Power Mode with local-only `config.local.json` preference.
- Added full-filesystem file I/O, metadata, copy/move/delete, recursive search, direct PowerShell, process controls, and persistent terminal sessions.
- Public configuration remains safe-by-default with Power Mode disabled.
- Local policy can keep permanent delete disabled and blocks shutdown/restart/logoff patterns.
- Added `POWER_SMOKE_PASS` regression coverage and live v0.2 MCP E2E validation.

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
