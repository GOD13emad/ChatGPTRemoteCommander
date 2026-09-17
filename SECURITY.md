# Security

ChatGPT Remote Commander is intentionally local-first. The MCP server binds to loopback by default and restricts filesystem operations to configured roots.

## Security controls

- realpath-based filesystem containment
- bounded text reads/writes
- SHA-256 optimistic write preconditions
- automatic backup before overwrite
- executable allowlist
- blocking of `node -e/--eval` and Python `-c`
- JSONL audit log
- OpenAI Secure MCP Tunnel for remote ChatGPT connectivity

## Important limitation

Command execution is not an operating-system sandbox. An allowlisted executable or a project script can itself access resources outside the configured filesystem roots. Treat `run_project_command` as privileged and keep ChatGPT action permissions enabled.

## Secrets

Never commit Runtime API keys, OpenAI credentials, tunnel profiles containing secrets, `.env` files, or audit logs. `connect-chatgpt.ps1` reads the Runtime API key as a hidden SecureString and exports it only to the current process environment.

## Reporting

If you find a security issue, report it privately to the repository owner before publishing exploit details.
