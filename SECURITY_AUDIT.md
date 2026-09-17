# Security Audit

Audit date: 2026-09-17

## Result

PASS for the published repository content and reachable Git history checked locally.

The audit found no committed OpenAI-style API secret key, GitHub token, tunnel identifier, private-key block, bearer-token literal, tracked `config.local.json`, or developer-specific absolute Windows path. GitHub code search also returned no results for `tunnel_` or `sk-` on the default branch at audit time.

## Controls verified

- `config.local.json` is ignored and is not tracked.
- `.env`, audit logs, temporary test files, backups, and bundled tunnel-client binaries are ignored.
- Public `config.json` keeps Power Mode disabled by default.
- Full-control settings remain local-only in `config.local.json`.
- Runtime API keys are entered interactively and are not stored in the repository.
- The MCP server listens on loopback by default; Secure MCP Tunnel provides outbound connectivity without public inbound exposure.
- Permanent deletion remains disabled by default in Power Mode.
- Shutdown, restart, and logoff shell patterns remain blocked.
## Privacy note

Published branch/tag history was rewritten on 2026-09-17 to replace the author/committer email with the GitHub noreply address. Current reachable local and remote history contains only `94546844+GOD13emad@users.noreply.github.com`. A pre-rewrite mirror backup is retained locally outside the published repository for rollback. Git hosting providers may retain unreachable objects/caches temporarily after a force-push; the old address is no longer referenced by the published branch or release tags.

## Re-run the audit

```powershell
npm run audit
```

A clean run ends with `SECURITY_AUDIT_PASS`.

## Official references

- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- Developer mode and MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- Platform tunnel settings: https://platform.openai.com/settings/organization/tunnels
- ChatGPT Plugins: https://chatgpt.com/plugins

Security status is point-in-time. Re-run the audit before every public release and after any credential, tunnel, authentication, or Power Mode change.
