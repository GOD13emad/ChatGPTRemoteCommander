# ChatGPT Remote Commander — Current setup

> Canonical workflow: [START_HERE.md](../START_HERE.md). If you are an AI assistant, read that file first and do not mix legacy setup paths into the current flow.

## Choose a mode

**Standard Mode** is the safer default for controlled project access.

**Full / Power Mode** is for a trusted computer. It enables full filesystem access, shell commands, process control, binary operations, backups, and persistent terminals. Permanent delete remains off and automatic shutdown/restart/logoff patterns remain blocked.

Full MCP write/modify support in ChatGPT is currently for Business and Enterprise/Edu. Pro custom MCP access is currently read/fetch only.

## Windows install or update

Standard:

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

Full / Power Mode:

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

The same command updates an existing install.

## Linux install or update

Standard:

```bash
curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

Power:

```bash
curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --power-mode --start-server
```

## Secure MCP Tunnel and persistent enrollment

Create a tunnel at https://platform.openai.com/settings/organization/tunnels and create a Runtime API key.

Never paste the Runtime API key into chat. Enter it only into the local hidden prompt.

Windows: run the `connect-chatgpt.ps1` path printed by the installer. A new default install is normally:

```powershell
& "$env:LOCALAPPDATA\ChatGPTRemoteCommander\app\connect-chatgpt.ps1"
```

Linux:

```bash
./enable-autostart-linux.sh --profile chatgpt-remote-commander
```

After one-time enrollment, the background supervisor starts/restarts MCP and enrolled tunnels automatically.

## Create the ChatGPT custom app

Enable Developer Mode if your plan/workspace permits it. Open Settings or Workspace settings → Apps → Create, choose **Tunnel**, select the tunnel, use **None / No authentication**, then **Scan Tools** and **Create**.

Use [plugin-icon.png](../assets/plugin-icon.png) or [plugin-logo.png](../assets/plugin-logo.png) if the UI requests artwork.

Open a fresh chat, select or @mention the app, and run:

`Run system_status and report the active mode, version, platform, shell, and concurrency state.`

For Full/Power Mode also run read-only `power_status`.

## Plugin packaging

The private custom MCP app is the actual tunnel connection. A Plugin can package that app with skills, prompts, and visual assets.

See [PLUGIN_SETUP.md](PLUGIN_SETUP.md) and the ready template in [plugin-template](../plugin-template/).

Secure MCP Tunnel is for private connectivity/testing; a public MCP-backed Plugin Directory submission currently requires a stable public HTTPS MCP endpoint.

## Final acceptance

Do not call setup complete until `INSTALL_PASS`, MCP health, tunnel ready state, tool scan, and a real `system_status` call have all passed.

For update/start/stop/troubleshooting, use [START_HERE.md](../START_HERE.md).
