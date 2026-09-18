# Changelog

## 0.5.0 — 2026-09-18

- Added opt-in Windows GUI Control for trusted Power Mode machines with MCP image screenshots, mouse move/delta/click/drag/scroll, Unicode typing, bounded key combinations, window discovery/focus, and a local emergency stop.
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
