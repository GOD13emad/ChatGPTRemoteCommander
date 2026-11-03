# Remote Commander v0.10.0

Date: 2026-09-29

## Objective

Turn the accepted v0.9.23 Windows/Linux runtime into a simpler installable product flow without adding a second privileged runtime layer.

v0.10.0 keeps the existing candidate-first installer, Secure MCP Tunnel, capability profiles, supervisor, durable work, routing, browser/GUI policy and release integrity. It adds a setup wizard and a device-specific Plugin packager around those accepted primitives.

## Design decision

The minimum sufficient control is a thin cross-platform setup layer, not an Electron/Tauri/MSI/deb rewrite. A second desktop framework would duplicate install/update/service authority and add signing/distribution dependencies without improving MCP correctness.

Current OpenAI Plugin packaging uses root plugin.json for portable identity, supports .codex-plugin/plugin.json for compatibility, and supports registered app mappings through .app.json. The native manifest points apps to ./.app.json. The mapping references an already-registered app; it does not create the app or grant permissions.

Official references:
- https://developers.openai.com/plugins/build/plugins
- https://help.openai.com/en/articles/20001256/
- https://help.openai.com/en/articles/20001504
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

## New product flow

Windows release asset: ChatGPT-Remote-Commander-Windows-Setup-v0.10.0.zip. Extract and double-click SETUP.cmd. Linux release asset: ChatGPT-Remote-Commander-Linux-Setup-v0.10.0.zip. Extract and run ./SETUP.sh.

The local wizard offers Standard, Full/Power, or Full/Power + guarded GUI; installs/updates Commander; starts MCP; runs persistent tunnel enrollment; and verifies local/tunnel health. Runtime API key entry remains a local hidden prompt.

## Device-specific Plugin ZIP

After ChatGPT creates and scans the custom MCP app for that tunnel, the user supplies only the registered App ID to the local wizard or builder.

The generated Plugin has a stable per-machine/per-profile name, human device display name, deterministic unique icon/logo, root plugin.json, .codex-plugin/plugin.json, .app.json bound to the exact app, the Remote Commander Skill and DEVICE_PLUGIN.json provenance. It contains no Runtime API key, Tunnel ID, bearer token or tunnel credential.

This lets one ChatGPT account/workspace install multiple Remote Commander Plugins for different computers without ambiguous identical names/icons.

Secure MCP Tunnel remains the private transport. Tunnel ID and Runtime API key alone cannot identify the registered ChatGPT app, so final app-bound packaging correctly waits for the App ID.

## Compatibility correction

The existing bind-app.ps1/.sh and Work Plugin install paths now bind and verify both the portable extensions.com.openai.apps path and native .codex-plugin/plugin.json apps path.

## Release packaging

The immutable Release asset set grows from 15 to 19 by adding Windows Setup ZIP and Linux Setup ZIP. The installer bundle also carries the wizard, device-plugin builders and dependency-free Node packager.

## Acceptance gates

Focused setup/plugin tests; real Windows ZIP smoke; full check/test/audit/diff gate; deterministic Linux asset build; clean Linux exact-tree qualification; hosted Windows/Ubuntu CI and server canaries; immutable tag/release with 19 assets; published checksum verification; candidate-first live Windows/Linux rollout and version/health readback.

The Windows SYSTEM BootRecovery task installation remains a separate machine-local owner/admin privilege gate; v0.10.0 does not bypass UAC.
