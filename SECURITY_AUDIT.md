# Security Audit

Audit date: 2026-09-21

## Result

PASS for the current v0.8.11 release candidate content and reachable branch/tag history checked locally after remote-ref synchronization.

The audit found no committed OpenAI-style API secret key, GitHub token, lowercase `tunnel_` identifier, private-key block, bearer-token literal, tracked `config.local.json`, or developer-specific absolute Windows path. On 2026-09-19 a stale local tracking ref first exposed an already-sanitized developer-path finding, and the obsolete public `release/v0.5.0-rc1` branch contained tunnel-shaped self-test fixtures inside the audit test itself. On 2026-09-20 the reachable `feature/blue-green-v0.8.0` history exposed an uppercase fail-closed status symbol that the former case-insensitive tunnel regex misclassified as a credential. The detector now follows the canonical lowercase `tunnel_` prefix used by OpenAI Secure MCP Tunnel examples and includes a regression proving lowercase tunnel-shaped values match while uppercase status/error symbols do not. The unchanged broader history scan then returned `SECURITY_AUDIT_PASS`. No real Runtime API key or tunnel identifier was recovered from these findings.

## Controls verified

- v0.8.11 closes a zero-downtime drain-accounting failure found during live v0.8.10 promotion. A disconnected downstream client no longer strands a completed upstream request in router inflight state. The fix drains the backend response without cancelling or replaying the request, preserving uncertain-side-effect safety. The new regression failed on the pre-fix router (`1 !== 0`) and passes after the fix.
- v0.8.10 makes GUI control non-intrusive by default: an ordinary GUI lease is observe-only, and mouse/keyboard/scroll/focus mutation is rejected before native input unless the caller opened a takeover session with an explicit-current-user authorization basis. Full Power capability does not itself authorize foreground takeover. Durable workflows cannot acquire takeover or dispatch GUI mutation.
- v0.8.10 does not modify `tools/gui-control.ps1` or `tools/gui-native.cs` (Git blobs `410441b32e11a5a4d12850caf632da8460c2a5b1` and `7bfc23435390c81de0d4175805a57bdbc4322517`). The candidate passed the native no-input layout self-test and focused controller regressions. Interactive native E2E is inherited from the exact v0.8.9 native baseline rather than rerun on the user's active desktop; this reuse is scoped only to the controller-authorization change and is not evidence for changed native behavior.
- v0.8.9 separates unattended candidate GUI verification from interactive desktop E2E: automatic updates run the native no-input self-test plus candidate MCP `gui_status`, while the full focus/click/type E2E remains a release gate on the exact clean commit. This prevents scheduled updates from stealing focus or failing solely because Windows denies background foreground activation.
- v0.8.8 binds each running stable router to the SHA-256 of its loaded router source and makes Windows/Linux supervisors recycle only ownership-proven routers whose loaded source does not match the promoted control checkout. Unknown canonical listeners remain fail-closed.
- v0.8.7 reuses a persistent bounded GUI helper instead of recompiling `gui-native.cs` for every read; timeout/crash/output-bound failures remain fail-closed and mutation uncertainty is never replayed.
- v0.8.7 makes post-cutover drain timeouts non-destructive: known cancellable long-lived transport requests may be cancelled after the drain budget, while unknown/mutating work is deferred and later maintenance completes automatically without rolling back a committed route.
- v0.8.6 synchronizes workflow checkpoint lifecycle into the scheduler projection inside the same database transaction, adds regression coverage for consistent WAITING queue state, pins GitHub Actions to full commit SHAs, and declares read-only contents permission for CI.
- v0.8.5 makes profile-instance release-gate fixtures platform-native while leaving production local-path validation fail-closed on each operating system.
- v0.8.5 makes clean-checkout GUI release validation self-contained and makes no-promote candidate cleanup ownership-proven, preventing diagnostic backend leakage.
- v0.8.2 adds Git-tracked dependency integrity checks for the automatic-update/runtime helper set, closing the gap between a dirty developer working tree and a clean release checkout.
- v0.8.1 fixes Windows candidate-gate invocation so every staged npm gate receives its intended arguments; empty gate arguments fail closed before any cutover.
- v0.8.0 Capability Profile v2 persists explicit authority separately from release defaults. Full Power automatically adopts new capabilities across updates; only a persistent disabledCapabilities entry suppresses a capability.
- v0.8.0 automatic updates are candidate-first: source is staged side-by-side, repository/security/hardware gates run before cutover, workflow state is tested through a consistent shadow copy, and live schema finalization occurs only after canonical MCP and tunnel verification.
- v0.8.0 stable routing uses loopback-only generation-guarded state and drains old in-flight operations before deleting the prior backend. Post-commit failures stay on the promoted runtime and enter maintenance recovery instead of rolling back to a schema-incompatible old runtime.
- Full Power v0.8.0 intentionally enables permanent deletion and unrestricted shell/process/terminal capability unless explicitly opted out. This is a trusted-machine authority class, not a safety sandbox; OS permissions, protected-process checks, durable operation journaling and no-blind-replay rules still apply.

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
- Public config.json remains Standard/safe-by-default. When a user explicitly authorizes Full Power, permanent deletion and unrestricted shell execution are enabled unless explicitly disabled in the persisted capability profile.
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

Published branch/tag history was rewritten on 2026-09-17 to remove the prior personal author/committer address. The current reachable history contains the GitHub noreply address plus the non-personal placeholder `local-audit@localhost` on a small number of historical audit commits; no personal email address was observed in the synchronized reachable refs. A pre-rewrite mirror backup is retained locally outside the published repository for rollback. Git hosting providers may retain unreachable objects/caches temporarily after a force-push.

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
