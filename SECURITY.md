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

Never commit Runtime API keys, OpenAI credentials, tunnel profiles containing secrets, `.env` files, credential stores, or audit logs. Interactive connector scripts keep Runtime API keys out of the repository. For persistent startup, Windows stores each enrolled Runtime API key as a DPAPI-protected value under the current user's LocalAppData; Linux stores it outside the repository in a user-only `chmod 600` credential file. These local stores are machine/user secrets and must not be copied into Git or shared.

## Reporting

If you find a security issue, report it privately to the repository owner before publishing exploit details.

## Power Mode v0.2

Power Mode is an explicit privileged configuration for trusted machines. It can expose the full filesystem, direct PowerShell execution, process control, binary file I/O, recursive search, and persistent terminal sessions.

The public `config.json` ships with Power Mode disabled. Put trusted-machine overrides in gitignored `config.local.json`. On mutation, Power Mode backs up existing targets when practical; permanent delete is separately gated and disabled by default.

The local policy blocks direct shutdown/restart/logoff command patterns and protects critical Windows process names from `kill_process`. These are guardrails, not a security boundary: arbitrary shell/code execution is inherently privileged and can potentially bypass application-level containment. Keep ChatGPT action permissions enabled and expose tunnels only to trusted accounts/workspaces.

## v0.3 concurrency and multi-account notes

v0.3 allows several chats and several authorized tunnel profiles to reach the same local MCP. Mutating operations use path-scoped in-process locks to reduce same-path write races. This is a consistency control, not an authorization boundary: all accounts connected to the same privileged MCP instance inherit that instance's configured capabilities. Use separate restricted MCP instances when different users require different filesystem or shell privileges.

## Release audit

Run `npm run audit` before publishing. The repeatable audit checks tracked files and Git history for credential-like material and verifies that local-only control files remain ignored. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the latest point-in-time result.
