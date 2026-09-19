# Security Audit

Audit date: 2026-09-19

## Result

PASS for the current published repository content and reachable branch/tag history checked locally after remote-ref synchronization.

The audit found no committed OpenAI-style API secret key, GitHub token, tunnel identifier, private-key block, bearer-token literal, tracked `config.local.json`, or developer-specific absolute Windows path. On 2026-09-19 a stale local tracking ref first exposed an already-sanitized developer-path finding, and the obsolete public `release/v0.5.0-rc1` branch contained tunnel-shaped self-test fixtures inside the audit test itself. The RC1 tip was backed up locally as a Git bundle before that obsolete branch was removed; after `git fetch --prune`, the unchanged audit returned `SECURITY_AUDIT_PASS`. No real Runtime API key or tunnel identifier was recovered from those findings.

## Controls verified

- v0.8.0 keeps tunnel-facing MCP ports on a loopback-only stable router and places release backends on private loopback ports. Router pointers use a generation precondition, exact canonical backend identity, bounded request/response handling, and atomic temp-file replacement. A dispatched POST is never retried or failed over; timeout/disconnect is reported as an uncertain effect.
- v0.8.0 requires exact commit/clean-tree authority, builds runtime releases from `git archive`, records an exact file/byte/SHA-256 manifest, and refuses missing, extra, linked, or modified release files. Public installer assets pin both Windows and Linux defaults to that release commit and ship a closed `SHA256SUMS.txt` set plus `release-authority.json`.
- v0.8.0 preserves the raw per-profile configuration bytes and SHA-256, keeps workflow stores/configs separate, leaves permanent deletion off, and moves `GUI_STOP` to stable control state. Candidate promotion is blocked by active mutations/locks, owned terminals, GUI coordination, or uncertain/running workflow intent.
- v0.8.0 stops processes only after marker/PID/port/profile/project identity matches. Legacy untracked and ignored files are copied outside the retired tree and re-verified by byte count and SHA-256 before the legacy application can be removed. Unknown listeners and control-revision drift fail closed.
- Durability is deliberately bounded: the implementation fsyncs the new pointer temp file before rename and attempts a directory sync after rename, but does not claim Windows power-loss durability equivalent to `MOVEFILE_WRITE_THROUGH`. Missing/corrupt pointer state fails closed and requires evidence-based recovery.
- Windows control receipts and transaction journals are written through a same-directory temporary file with write-through plus `Flush(true)` before rename. Directory-entry persistence across sudden power loss is still **UNPROVEN**; malformed or inconsistent recovery state is a STOP, never an inferred PASS.
- v0.7.3 clears inherited `REMOTE_COMMANDER_CONFIG` at supervisor startup so a supervisor launched from an isolated MCP context cannot accidentally start the primary server with the isolated profile configuration.
- v0.7.2 allows explicit Standard ↔ Power/GUI reconfiguration of an already-isolated profile while preserving its port/store identity; supervisor recycle is permitted only after runtime marker/PID/port/profile/project ownership is proven.
- v0.7.1 removes general-purpose command execution from Standard isolated profiles. Their `allowedPrograms` list is empty and default durable workflow execution excludes `run_project_command`; explicit isolated Power Mode is required to inherit the base command allowlist.

- v0.7.0 isolates optional durable-memory stores and local MCP runtime markers per tunnel profile. Additional isolated profiles default to Standard Mode; Power/GUI are explicit opt-ins. Runtime API credentials stay in the existing DPAPI store and are not copied into instance configs.
- v0.7.0 migration validates the candidate local MCP and a temporary tunnel profile before switching the live profile URL, backs up the profile with a hash check, and restores it on failure.

- `config.local.json` is ignored and is not tracked.
- `.env`, audit logs, temporary test files, backups, local connection files, and bundled tunnel-client binaries are ignored.
- Public `config.json` keeps Power Mode disabled by default.
- Full-control settings remain local-only in `config.local.json`.
- Runtime API keys are never stored in the repository. Windows persistent enrollment stores a DPAPI-protected value in the current user's LocalAppData; Linux persistent enrollment stores a user-only `chmod 600` credential file outside the repository.
- The MCP server listens on loopback by default; Secure MCP Tunnel provides outbound connectivity without public inbound exposure.
- Permanent deletion remains disabled by default in Power Mode.
- Shutdown, restart, and logoff shell patterns remain blocked.
- v0.3 path-scoped mutation locking passed concurrent same-path append testing on Windows and Linux.
- Windows and Linux installer/parser/test gates passed locally before the v0.3 release candidate was staged.
- v0.5.1 Windows release gates re-ran successfully on 2026-09-19: `npm run check`, `npm test`, `npm run audit`, and native GUI E2E. The concurrency test now restores the pre-existing runtime ownership marker.
- v0.5.2 restores legacy five-tool full-filesystem behavior only when explicit Power Mode is enabled with `fullFilesystem=true`; Standard Mode root containment remains unchanged. Executable allowlisting and eval/print blocks remain enforced for `run_project_command`.
- v0.6.0 adds centralized MCP input-schema validation and correct known-tool `isError` semantics, rejects unsupported/mismatched modern protocol routing, conservatively corrects destructive/open-world tool annotations, and bounds persistent audit-log growth. A scan of the live audit/autostart logs found no OpenAI-style secret, tunnel identifier, GitHub token, bearer token, PEM private key, or Runtime API key assignment pattern.
- v0.6.1 hardens release-source integrity: annotated tags are peeled to commits before exact identity comparison, Linux gains the same expected-commit gate, and failed fresh installs cannot leave a half-initialized checkout that later masquerades as an installed product.
- v0.6.2 binds Windows tunnel-client invocations to the explicitly managed profile directory and permits upgrade handoff only when a local `tunnel-client.exe` process for the same profile is actually ready on the profile's configured health port. DPAPI credentials remain in the existing per-user credential store and are not migrated or exposed.
- v0.6.3 removes live runtime-marker save/restore behavior from the concurrency gate by running its server from a disposable application copy, and adds a loopback-only read-only doctor command that rejects remote hosts, URL credentials, query strings, and redirects.
- v0.6.5 enforces SHA-256 write preconditions before mutation and preserves the only complete copy during partial move-deletion recovery.
- v0.6.4 bounds Linux external downloads and local health probes with explicit connect/total deadlines, preventing indefinite installer/plugin stalls on partial network failure.

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
