# Per-profile MCP isolation R1

## Purpose

A tunnel profile identifies an OpenAI account connection, but a tunnel by itself is not a local authorization boundary. If two tunnel profiles forward to the same local MCP URL, both receive the same tool catalog, configuration, Power Mode policy, audit log and durable-memory store.

R1 adds a local isolation boundary by giving an additional tunnel profile its own loopback MCP port, configuration, runtime marker, audit log and workflow database. The existing tunnel ID and DPAPI Runtime API credential are reused; secrets are never copied into instance configuration.

## Default policy

The primary profile `chatgpt-remote-commander` remains on port 47831.

An isolated additional profile defaults to:

- a distinct MCP port selected from 47834..47931;
- Power Mode disabled;
- command execution disabled (`allowedPrograms=[]` and no default workflow `run_project_command`);
- full-filesystem access disabled;
- shell/process control disabled;
- GUI control disabled;
- permanent delete disabled;
- project roots inherited from the base configuration unless explicitly narrowed;
- durable workflows enabled in a private local state directory;
- a distinct audit log and runtime ownership marker.

Power Mode or GUI control for an isolated profile must be explicitly requested. This is still the same Windows user and is not an OS security boundary. A profile granted full Power Mode can reach whatever that OS user can reach. Use separate Windows users/VMs when principals require OS-level trust separation.

## Files and state

Per-profile private state is under:

`%LOCALAPPDATA%\ChatGPTRemoteCommander\instances\<profile>\`

It contains the generated config, instance record, runtime marker, audit log and workflow database. Runtime API keys remain separately protected by Windows DPAPI under the existing credentials directory.

The tunnel YAML remains under the tunnel-client profile directory. Migration changes only that profile's `main` MCP URL after the candidate MCP and tunnel-client doctor both pass.

## Migration

Existing enrolled profile:

```powershell
.\configure-profile-instance.ps1 -Profile "saeed-emad"
```

Dry validation without changing the live tunnel:

```powershell
.\configure-profile-instance.ps1 -Profile "saeed-emad" -McpPort 47834 -PrepareOnly
```

New/reenrolled account can request isolation through:

```powershell
.\connect-chatgpt-account.ps1 -Profile "saeed-emad" -HealthPort 47833 -Isolate
```

Optional isolated Power Mode is explicit:

```powershell
.\connect-chatgpt-account.ps1 -Profile "trusted-profile" -Isolate -IsolatedPowerMode
```

GUI requires isolated Power Mode and should only be given to principals trusted to drive the shared desktop. Explicit Full Power profiles can configure shell, deletion, process and terminal tools in their durable execution set. The workflow adapter independently rejects GUI takeover and input mutations; these require a direct current-user session. The opt-in project runner uses a narrower execution policy and must be configured separately.

### Reconfigure an existing isolated profile

Use the supported transaction instead of editing `config.json` or `instance.json` manually:

```powershell
.\reconfigure-profile-instance.ps1 -Profile "saeed-emad" -PowerMode -GuiControl
```

The current MCP port and private workflow store are preserved. Config/record files are backed up and rewritten atomically. The supervisor recycles only a marker-proven owned instance. If the new config does not become healthy within the bounded wait, the wrapper restores the backed-up config/record and verifies rollback. Tunnel ID and DPAPI Runtime API credential are unchanged.

## Transaction and rollback

Migration performs these gates in order:

1. Validate the existing profile and DPAPI credential.
2. Generate a separate config/instance record.
3. Start the candidate MCP and verify its profile/config hash.
4. Build a temporary tunnel profile targeting that MCP.
5. Decrypt the existing Runtime API key only in process memory and run `tunnel-client doctor`.
6. Back up the real tunnel profile byte-for-byte and verify the backup hash.
7. Commit the instance record and atomically update only the profile's MCP URL.
8. Stop only the exact old tunnel process for that profile.
9. Require the same tunnel health port to return `ready` and the isolated MCP to remain healthy.

Failure before completion restores the backed-up profile, removes the instance record and stops only the validated candidate MCP.

## Durable memory boundary

Each isolated profile receives its own SQLite workflow store. Project evidence/actions are still limited to configured workflow roots. The workflow DB itself is private local state and is not stored in a project checkout.

Memory is project data, not authority. Stored notes/web content never grant permissions, and uncertain external effects are never replayed automatically.

## Evidence

Regression gates cover:

- isolated config generation and validation;
- conservative default permissions;
- separate runtime marker and workflow DB;
- unchanged primary runtime marker during isolated-server execution;
- Power tools failing closed in a Standard isolated instance;
- Windows script parser/contracts;
- real PrepareOnly validation against an enrolled secondary profile without changing its live YAML/tunnel.
