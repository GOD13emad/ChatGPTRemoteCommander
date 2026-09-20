# Changelog

## 0.8.0 — 2026-09-20

- Capability Profile v2: explicit Full Power enables every known capability by default and automatically adopts new capabilities on later upgrades; only persistent explicit opt-outs keep individual capabilities disabled.
- Full Power durable orchestration now covers the complete filesystem, shell, process, persistent-terminal and GUI surface while preserving intent-before-effect journaling, operation classification, reconciliation and no blind mutation replay.
- Durable Workflows R2 adds scheduler state, operation receipts, idempotency keys, one-writer project-root leases, crash recovery, retry/root-cause budgets, user revision overrides, execution-profile persistence, Project Brain synchronization and evidence-backed FINAL completion.
- Candidate validation uses a consistent shadow workflow database; live schema finalization occurs only after verified cutover, preserving rollback compatibility before the commit point.
- Candidate-first automatic updates on Windows and Linux stage releases side-by-side, run repository/security/hardware diagnostics before promotion, and leave the active installation untouched when validation fails.
- Stable loopback routing provides generation-guarded atomic cutover, drains in-flight work on the previous backend, and removes superseded backends/releases after successful drain.
- Post-commit maintenance recovery and supervisor recycle keep the promoted runtime authoritative without requiring logout or reboot.
- Stable-channel automatic update checks are enabled by default. Full Power includes automatic and zero-downtime lifecycle capabilities unless explicitly opted out.
- Linux receives parity for candidate-first install/update, shadow workflow validation, hardware self-test, route recovery and scheduled automatic update checks.
- Cross-platform release contracts now cover all-on Full Power, persistent opt-outs, router safety, workflow crash/reconcile behavior, Linux shell parsing and native Windows GUI E2E.

## 0.7.3 — 2026-09-19

- Sanitize `REMOTE_COMMANDER_CONFIG` at Windows supervisor startup. A supervisor launched from an isolated MCP context can no longer inherit that profile config into primary MCP startup.
- Keep isolated MCP launch explicit through `ProcessStartInfo.Environment[REMOTE_COMMANDER_CONFIG]`; primary and per-profile configuration selection are now unambiguous.
- Add regression coverage to the profile-reconfiguration contract after reproducing the live primary-port timeout caused by inherited environment state.
- When an isolated profile explicitly enables Power + GUI, durable workflows can journal the bounded power/file and GUI tool subset (including fresh-frame GUI actions) while shell, delete, process-kill and terminal control remain excluded from durable replay.


## 0.7.2 — 2026-09-19

- Add transactional reconfiguration for existing isolated profiles without changing Tunnel ID, DPAPI credential, MCP port, runtime marker path, or durable workflow store.
- Add ownership-proven isolated MCP recycle: supervisor may stop a mismatched listener only when runtime marker PID/port/profile/projectDir prove it owns that exact process; unknown listeners remain fail-closed.
- Add a Windows reconfiguration wrapper with bounded health verification and backup rollback when the new instance does not come healthy.
- Keep permanent delete disabled; Power Mode and GUI remain explicit opt-ins per isolated profile.


## 0.7.1 — 2026-09-19

- Security hardening for isolated Standard profiles: command execution allowlist is empty by default, so general-purpose interpreters/compilers cannot escape project-path policy.
- Remove `run_project_command` from the default durable workflow execution set for Standard isolated profiles. Explicit isolated Power Mode may opt back into the base command allowlist.
- Keep per-profile memory, runtime markers and tunnel routing unchanged; no credential or Tunnel ID rotation is required.


## 0.7.0 — 2026-09-19

- Add opt-in durable project workflows with crash-safe intent/receipt journaling, checkpoint evidence hashes, resume/reconcile semantics and logical export.
- Add per-profile local MCP isolation so additional ChatGPT accounts can use distinct ports, configs, audit logs, runtime markers and private workflow databases.
- Add transactional Windows profile migration that reuses the existing tunnel ID and DPAPI Runtime API credential, validates a candidate MCP with tunnel-client doctor, and rolls back the profile on failure.
- Keep isolated secondary profiles conservative by default: Standard Mode, no shell/process/GUI/full-filesystem access unless explicitly opted in.
- Integrate workflow/profile recovery tests into standard release gates.


## 0.6.5 — 2026-09-19

- Fail closed when `expectedSha256` is malformed or targets a missing file; no parent/file creation occurs on a failed precondition.
- Preserve the complete promoted destination and recovery metadata when a move source deletion partially fails; never delete the last complete copy to restore an overwritten target.
- Add focused recovery regressions for Standard and Power Mode writes/moves.


## 0.6.4 — 2026-09-19

- Bounded Linux external downloads with explicit connect and total timeouts so unavailable TLS/network paths fail deterministically instead of hanging indefinitely.
- Applied the same bounded-download policy to the Linux Work Plugin template fetch and bounded the Linux account connector's local MCP health probe.
- Added regression contracts so release checks fail if the timeout controls are removed.
- Reproduced the original failure on WSL2: DNS resolved `nodejs.org` but TLS connection attempts timed out while the old installer waited without a deadline.
- Retains v0.6.3 read-only doctor diagnostics and isolated concurrency testing, plus all v0.6.2 runtime/tunnel/GUI hardening.

## 0.6.3 — 2026-09-19

- Isolated the concurrency smoke server inside a disposable application copy so tests never write, restore, or race with the live `var/mcp-runtime.json` ownership marker.
- Added a hard regression asserting the live ownership-marker SHA-256 is unchanged by the concurrency gate.
- Added a loopback-only read-only `npm run doctor` diagnostic for health, active server version/device, core tool discovery, optional config SHA-256 comparison, and drift detection.
- Added doctor regression coverage for healthy state, version drift, missing core tools, URL-secret rejection, remote-host rejection, and timeout/argument validation.
- Re-ran the full Windows release gate including MCP conformance, audit rotation, filesystem safety, 67/67 GUI contract tests, security audit, and native Windows screenshot/input/focus E2E.

## 0.6.2 — 2026-09-19

- Fixed Windows tunnel profile path ambiguity by passing the repository-managed profile directory explicitly to tunnel-client init, doctor, and run.
- Windows enrollment now recognizes an already-ready tunnel-client process for the same profile during an installation handoff, even when that process belongs to the previous installation path.
- Preserves the existing `%APPDATA%\\tunnel-client` profile store; no profile migration or secret rewrite is required.
- Prevents false doctor failures during in-place production promotion when the previous healthy tunnel already owns the profile health port.
- Added Windows runtime-contract gates for explicit profile-dir binding and upgrade-ready profile detection.

## 0.6.1 — 2026-09-19

- Fixed exact release identity checks for annotated Git tags by peeling fetched refs to their commit before ExpectedCommit comparison.
- Added Linux parity for exact expected-commit verification through `--expected-commit` / `REMOTE_COMMANDER_EXPECTED_COMMIT`.
- Made fresh source acquisition transactional: failed Windows installs remove incomplete fresh checkouts; Linux stages into a temporary checkout and only moves it into place after fetch, peel, expected-commit verification, and checkout succeed.
- Detects existing incomplete Git installations with no HEAD instead of treating them as valid update targets.
- Added a regression using a real annotated Git tag to prove raw `FETCH_HEAD` differs from the release commit while `FETCH_HEAD^{commit}` resolves exactly to it.
- Reproduced and closed the v0.6.0 clean-production installer failure; positive clean install and negative wrong-ExpectedCommit cleanup both PASS.

## 0.6.0 — 2026-09-19

- Completed real dual-era MCP conformance for legacy 2025 clients and MCP `2026-07-28` stateless clients.
- Added required modern `tools/list` cache hints, strict modern header/body version classification, `Mcp-Method`/`Mcp-Name` routing validation, and modern rejection of the removed `notifications/initialized` lifecycle.
- Added centralized closed-schema tool-input validation. Known-tool validation/handler failures now return normal MCP tool results with `isError: true`; unknown tools remain JSON-RPC protocol errors.
- Hardened tool risk annotations so potentially overwriting/destructive file/process/shell operations are conservatively marked destructive/open-world where applicable.
- Added a dependency-free MCP conformance gate and independently validated the candidate with the official `@modelcontextprotocol/client@2.0.0` in legacy, modern-auto, and modern-pinned modes.
- Added serialized bounded audit logging with an 8 MiB default segment limit and three retained rotated generations; concurrent-rotation regression verifies parseable, non-duplicated JSONL.
- Revalidated the existing Power Mode full-filesystem compatibility, concurrency, filesystem safety, runtime ownership, HTTP admission, secret scan, Windows GUI contract, and native screenshot/input/screenshot E2E.
- Kept OpenAI `tunnel-client v0.0.14` pinned after current-release verification; it remains the published rollout target for MCP 2026-07-28/sessionless tunnel traffic.

## 0.5.2 — 2026-09-19

- Restored full-filesystem compatibility for the five legacy MCP tools when explicit Power Mode has `fullFilesystem=true`. `list_directory`, `read_text`, `write_text`, and `run_project_command` can now use absolute paths outside configured `allowedRoots` subject to OS permissions and the existing policy.
- Kept command hardening intact: `run_project_command` remains executable-allowlisted, while `python -c` and Node eval/print modes remain blocked.
- Power-mode legacy writes outside configured roots now use the configured Power Mode backup root instead of creating repository-style backup directories beside the target.
- Added explicit effective-access signaling to `system_status`: `allowedRootsEnforced`, `effectiveAccess.filesystem`, and `legacyFiveToolCompatibility`.
- Updated MCP tool descriptions and server instructions so clients do not misinterpret configured roots as an active boundary while full-filesystem Power Mode is enabled.
- Added regression coverage for legacy read/write/list/command access outside configured roots plus HTTP/MCP metadata/instruction consistency.

## 0.5.1 — 2026-09-19

- Fixed concurrency-test isolation so `npm test` preserves the live `var/mcp-runtime.json` ownership marker instead of leaving the temporary port-47931 test server identity behind.
- Verified the fix against a live supervised v0.5.x runtime: the runtime-state SHA-256 was identical before and after the full test suite, then controlled MCP recycle restored a self-written marker for the actual port-47831 process.
- Re-ran `npm run check`, `npm test`, `npm run audit`, and the native Windows GUI E2E gate successfully after the fix.
- Removed the obsolete public `release/v0.5.0-rc1` branch after creating a local rollback bundle; this removed stale audit-only test fixtures from reachable public branch history and restored `SECURITY_AUDIT_PASS`.
- Keeps the v0.5.0 GUI/runtime feature set and security boundaries unchanged; this is a maintenance and release-integrity patch.

## 0.5.0 — 2026-09-18

- Added opt-in Windows GUI Control for trusted Power Mode machines with MCP image screenshots, mouse move/delta/click/drag/scroll, Unicode typing, bounded key combinations, window discovery/focus, and a local emergency stop.
- Added a repeatable native Windows GUI E2E gate using a disposable WinForms target. It verifies real screenshot capture, exact-window focus, mouse click, Farsi/Japanese Unicode typing, button activation, post-action screenshot change, cursor restore, and best-effort focus restore.
- Fixed redirected PowerShell stdin/stdout to explicit UTF-8 so multilingual GUI typing is not corrupted by the host console code page; hardened focus with verified thread-input attachment and safe detach.
- Pinned release installers to `v0.5.0` by default while keeping explicit source-ref/commit overrides for controlled validation and recovery.
- Added an exclusive expiring desktop lease and short-lived single-use frame tokens. Every GUI mutation must be based on a fresh screenshot; concurrent chats cannot independently drive the same desktop.
- Added strict runtime GUI schemas, fixed native dispatch, sanitized helper errors, bounded subprocess/image output, corrected Win32 INPUT layout, DPI/foreground/desktop checks, and an uncertain-outcome latch instead of blind retries.
- Hardened loopback HTTP admission against untrusted Host/Origin/content-type requests while preserving Secure MCP Tunnel architecture.
- Hardened Power Mode containment against canonical path/symlink escapes, same/ancestor/descendant copy/move hazards, and parent/child lock races. Copy/move overwrite now stages and rolls back instead of deleting the destination first.
- Made Windows installer mode transitions real and config-aware: local policy is merged/backed up, Standard disables an existing Power policy, health exposes config identity, and same-version config changes restart the owned MCP.
- Pinned tunnel-client executable identity with recorded SHA-256, strict profile names, exact TunnelId/HealthPort reuse, post-validation credential persistence, readiness checks, and ownership-safe stop/start.
- Converted the legacy multi-account foreground connector to the persistent supervisor path.
- Public configuration remains Power/GUI disabled by default. Secure Desktop/UAC, lock screen, anti-cheat/protected input and high-speed real-time gameplay remain explicit platform limits.

## 0.4.4 — 2026-09-18

- Fixed the public Bash one-line Work Plugin installer when executed via `curl | bash -s`: `BASH_SOURCE[0]` is now expanded safely under `set -u`, eliminating the harmless but confusing unbound-variable warning.
- Kept the v0.4.3 app-identity guardrail, self-contained Release template download, private-path fixes, and exact-app verification unchanged.


## 0.4.3 — 2026-09-18

- Added an explicit app-identity guardrail for Work/Plugin binding: bind only the exact Custom App created for this project's Secure MCP Tunnel and verify its scanned tools include `system_status`.
- Documented that fuzzy Plugin Directory search results or similarly named remote-control apps must never be substituted for the intended ChatGPT Remote Commander app.
- Kept the self-contained latest-Release Work Plugin installer flow from v0.4.2 and verified its public one-line Windows path end-to-end with an isolated synthetic app identifier.
- Clarified that the optional `tunnel-client` Codex Plugin is separate from this project's Plugin and is not a FINAL PASS requirement.
- Fixed relative `-TemplateSource` and `-InstallRoot` resolution in the Windows Work Plugin installer so controlled offline/private paths resolve from the caller's current PowerShell location rather than the host process directory.


## 0.4.2 — 2026-09-18

- Made the app-bound Work Plugin installers self-contained when executed directly from a Release asset or in-memory PowerShell.
- If no adjacent `plugin-template/` exists, the installers download the generic `plugin-template.zip` asset from the latest Release and clean up temporary files after installation.
- Added optional `TemplateSource` / `TEMPLATE_SOURCE` overrides for controlled offline/private deployments.
- Added public one-line Windows and Linux Work Plugin installation commands that need only the registered app technical ID.
- Release packaging now publishes both stable `plugin-template.zip` and versioned `plugin-template-v0.4.2.zip` assets.


## 0.4.1 — 2026-09-18

- Added one-command app-bound Work Plugin installers for Windows and Linux.
- The installers accept either a real app ID (`asdk_app_`, `connector_`, `templated_apps_`) or the corresponding ChatGPT technical `plugin_...` identifier and normalize it correctly.
- They create a private per-user Plugin copy, generate `.app.json`, add a personal marketplace, install/enable the Plugin through Codex, and verify the app binding.
- Added explicit current OpenAI guidance that `.app.json` uses the underlying app ID, not the `plugin_...` wrapper shown in Plugin URLs.
- Documented the optional tunnel-client Codex Plugin as non-blocking; the Remote Commander Plugin is the required project integration.


## 0.4.0 — 2026-09-18

- Added `START_HERE.md` as the single source of truth for AI-assisted installation from a GitHub link through FINAL PASS.
- Added explicit Standard versus Full/Power Mode guidance, including benefits, boundaries, plan availability, and safe secret handling.
- Added current ChatGPT custom MCP app creation steps: Developer Mode, Tunnel connection, no-auth selection, Scan Tools, creation, and real `system_status` verification.
- Added `docs/PLUGIN_SETUP.md`, `WORK_SETUP.md`, a portable Plugin template, repository marketplace, project-level Plugin enablement, app-binding helpers, workflow skill, privacy/terms documents, and ready PNG/SVG visual assets.
- Replaced outdated foreground-tunnel instructions across the 10 setup-language pages with the persistent supervisor flow and latest Release installer assets.
- Updated Windows and Linux disable scripts so stopping persistent mode also stops managed tunnel/MCP processes while preserving credentials unless explicitly removed.
- Updated Windows and Linux enrollment so Start is self-contained: when MCP is stopped, enrollment starts it automatically before restoring persistent supervision; no manual `npm start` is required.
- Bumped runtime/package version to 0.4.0.


## 0.3.4 — 2026-09-18

- Fixed Windows installer path resolution when `install.ps1` is executed from an in-memory `irm`/ScriptBlock rather than from a `.ps1` file.
- `Resolve-InstallDir` now returns the resolved path explicitly and the installer assigns it in the caller scope, avoiding PowerShell `$script:` scope differences.
- Added validation for the public one-line `irm` install/update execution path.


## 0.3.3 — 2026-09-18

- Fixed the Windows installer path collision between application source and persistent local state (`credentials` / `downloads`).
- New installs use `%LOCALAPPDATA%\\ChatGPTRemoteCommander\\app`; state remains under `%LOCALAPPDATA%\\ChatGPTRemoteCommander`.
- Existing active installations are auto-detected from the Windows logon supervisor and updated in place, preserving custom/source-repo installations.
- Legacy installs where the state root itself is a Git checkout remain supported.
- `-StartServer` now upgrades a running v0.3 MCP to the newly installed version when needed, so normal updates do not require sign-out or reboot.
- Added explicit Git ignore coverage for legacy local `credentials/` and `downloads/` directories.


## 0.3.2 — 2026-09-18

- Converted `connect-chatgpt.ps1` into a persistent-connection compatibility wrapper instead of starting a second foreground tunnel.
- Re-running the legacy connect command now delegates to the idempotent autostart enrollment flow, reuses the saved DPAPI credential, and leaves the background supervisor as the single tunnel owner.
- Prevents the common `tunnel-client run failed: -1` confusion caused by launching a duplicate tunnel for an already-managed profile.


## 0.3.1 — 2026-09-18

- Fixed Windows one-time autostart enrollment when the same tunnel profile is already running on its configured health port.
- Existing DPAPI credentials are reused on reruns, so a failed validation does not require entering the Runtime API key again.
- Enrollment now recognizes an already-ready matching tunnel and skips the conflicting `doctor` listener bind check.
- Verified persistent Windows startup registration, MCP auto-restart, and tunnel kill/restart using the DPAPI credential with no repeated Tunnel ID, port, or API-key entry.


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
