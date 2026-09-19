# START HERE — ChatGPT Remote Commander

> **Single source of truth for assisted installation.** If a user gives you this GitHub repository and asks for setup, follow this file from top to bottom. Do not mix in legacy foreground-tunnel or manual clone/npm flows unless troubleshooting requires them.

Repository: https://github.com/GOD13emad/ChatGPTRemoteCommander

## Rules for the assisting ChatGPT

1. Work one checkpoint at a time and wait for the user's output before declaring a checkpoint PASS.
2. Never ask the user to paste a Runtime API key, Tunnel credential, bearer token, or private key into chat. Tell them to enter secrets only into the local hidden prompt.
3. Use the **latest Release installer asset**, not `raw/main`, for installation and updates.
4. Do not change DNS, firewall, VPN, proxy, adapters, or other network settings just to make this project work. Diagnose first.
5. Do not claim FINAL PASS until local MCP health, tunnel readiness, ChatGPT app tool discovery, and at least one real tool call have all passed.
6. Prefer Standard Mode for general use. Offer Full/Power Mode only for a trusted personal or managed computer and explain its scope before enabling it.
7. OpenAI product availability changes. For plan, Developer Mode, Apps, Plugins, and Secure MCP Tunnel UI details, verify current official OpenAI documentation if the UI differs from this guide.

## 0. Preflight

Ask only what is necessary:
- Windows 10/11 or Linux?
- Is this the user's own/trusted computer?
- Do they want **Standard Mode** or **Full/Power Mode**?
- Which ChatGPT plan/workspace are they using, and do they have permission to create a custom MCP app?

### Standard Mode

Standard Mode is the default. It limits filesystem access to configured roots and does not enable arbitrary shell or process control.

Use it when the user mainly needs controlled project-file access and safer defaults.

### Full / Power Mode

Full/Power Mode enables the local server's privileged tools: full filesystem access, shell execution, process control, binary file operations, recursive search, backups for destructive mutations, and persistent terminal sessions.

Benefits:
- ChatGPT can build, test, debug, and edit projects without the user repeatedly copying terminal output.
- It can manage project processes and long-running terminals.
- It can inspect files outside a single repository when the local policy allows it.
- Multiple chats can use the same machine; same-path mutations are serialized to reduce write races.
- The tunnel remains private: no inbound firewall port or public MCP server is required.

Important boundaries:
- Power Mode is **not an OS sandbox**. A permitted shell command can affect the machine.
- Use it only on a trusted computer and only with trusted ChatGPT accounts/workspaces.
- Permanent delete is OFF in the provided policy.
- Automatic shutdown, restart, and logoff command patterns remain blocked.
- Full MCP write/modify support in ChatGPT is currently for Business and Enterprise/Edu. Pro custom MCP access is currently read/fetch only.

### Windows GUI Control

On Windows, v0.5 can expose its own graphical-control MCP tools. This is an explicit opt-in on top of Power Mode. Enable it only on a trusted interactive desktop:

```powershell
.\install.ps1 -PowerMode -GuiControl -StartServer -SkipTunnelClient
```

When enabled and the ChatGPT app is re-scanned, the tool set includes an exclusive desktop lease, live screenshots, cursor position, absolute/relative mouse movement, click/drag/scroll, Unicode typing, validated key combinations, visible-window listing, and exact/unique window focus.

Required workflow:
1. call `gui_status` and require an available interactive desktop;
2. acquire `gui_session_begin`;
3. call `gui_screenshot` with the lease;
4. inspect the image and keep the returned single-use `frame`;
5. perform exactly one GUI mutation with both `lease` and `frame`;
6. capture again and verify the visible result;
7. renew the lease only while actively working and always end with `gui_session_end`.

Do not queue stale GUI work across chats. The owner can stop GUI input locally with physical Escape or the `var\GUI_STOP` file; the assistant must not clear that stop remotely.



For release/maintainer validation on a trusted interactive Windows desktop, run:

```powershell
npm run test:gui-native
```

This opens only the repository's disposable WinForms test window and verifies the full screenshot → focus → click → multilingual typing → click → visual verification workflow. It restores the cursor and attempts to restore the previously focused window before exiting. This native test is intentionally separate from the normal headless test suite because it interacts with the desktop.

This removes the previous dependency on a separate Computer Use tool for ordinary supported Windows GUI workflows. It does **not** bypass Windows Secure Desktop/UAC, lock-screen boundaries, anti-cheat/protected-input systems, or the latency limits of real-time gameplay.

### Optional ChatGPT-side Full permission

Local Power Mode controls what the MCP server can do. ChatGPT App permissions separately control when ChatGPT asks before using those actions. On an eligible account/workspace and only for a trusted personal/managed machine, the user may choose the app-specific **Allow all actions** permission to reduce repeated approval prompts. OpenAI marks this as elevated risk. It does not override workspace role access, enabled/disabled actions, provider authorization, or safety protections. If the option is unavailable, use **Allow low-risk actions** or the workspace default and approve higher-impact actions normally.

## 1. Install or update

### Windows — Standard

Open PowerShell 7 and run:

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

### Windows — Full / Power Mode

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```


### Windows — Power Mode + GUI Control

For a v0.5 source checkout, run `.\install.ps1 -PowerMode -GuiControl -StartServer -SkipTunnelClient`, then refresh/re-scan the ChatGPT app tools. For a published v0.5 Release, the same `-GuiControl` switch applies to the Release installer. GUI Control is Windows-only in v0.5.

### Linux — Standard

```bash
curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

### Linux — Full / Power Mode

```bash
curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --power-mode --start-server
```

The same command is the update command. Do not delete the credential/state directory before an update.

Expected Windows gate output includes:
- `INSTALLER_CHECK_PASS`
- `SMOKE_V03_PASS`
- `POWER_SMOKE_V03_PASS`
- `CONCURRENCY_SMOKE_PASS`
- `SECURITY_AUDIT_PASS`
- `INSTALL_PASS`

Verify local MCP health:

```powershell
irm http://127.0.0.1:47831/health
```

Expected: `ok = true` and the current release version.

## 2. Create the OpenAI Secure MCP Tunnel

Use OpenAI Platform Tunnel settings:
https://platform.openai.com/settings/organization/tunnels

The user needs:
- a `tunnel_id`;
- a Runtime API key for `tunnel-client`;
- the tunnel associated with the intended Platform organization and ChatGPT workspace;
- Tunnel **Read + Manage** to create/edit a tunnel;
- Tunnel **Read + Use** to run `tunnel-client` or select the tunnel while creating the ChatGPT app.

The local MCP target is:
`http://127.0.0.1:47831/mcp`

Do not expose port 47831 to the public internet. Secure MCP Tunnel is outbound-only and is intended to keep the MCP server private.

## 3. One-time persistent enrollment

### Windows

After the installer, use the exact path printed by the installer. For a new default install it is normally:

```powershell
& "$env:LOCALAPPDATA\ChatGPTRemoteCommander\app\connect-chatgpt.ps1"
```

For an existing/custom install, run the `connect-chatgpt.ps1` from that active install directory.

The script prompts locally for the Tunnel ID when needed and asks for the Runtime API key with hidden input. **Enter the key only in that local prompt. Never paste it into ChatGPT.**

Expected:
- `AUTOSTART_ENROLL_PASS`
- `CONNECT_PASS ... mode=persistent-autostart`

Windows stores the Runtime API key using current-user DPAPI outside the Git repository. The background supervisor owns the MCP server and tunnel processes.

### Linux

From the installed directory run once:

```bash
./enable-autostart-linux.sh --profile chatgpt-remote-commander
```

Linux registers a user-level systemd service when available, otherwise a crontab fallback. Its credential fallback is a user-only local file outside the repository.

After enrollment, later logins do not require re-entering the Tunnel ID, MCP address, health port, or Runtime API key.

## 4. Create the ChatGPT custom MCP app

This app is the connection ChatGPT uses to reach the tunnel.

Current OpenAI flow:
1. Enable Developer Mode if your plan/workspace permits it.
2. Open **Settings / Workspace settings → Apps → Create**.
3. Create a custom app named **ChatGPT Remote Commander**.
4. For **Connection**, choose **Tunnel**.
5. Select the tunnel you created, or provide its valid `tunnel_id` if the UI requests it.
6. Use **No authentication / None** for this server. The Remote Commander MCP does not advertise OAuth.
7. If the UI requests an icon/logo, use `assets/plugin-icon.png` or `assets/plugin-logo.png` from this repository.
8. Select **Scan Tools** and wait for the scan to finish.
9. Review the detected tools and permissions.
10. Select **Create**.
11. In a managed workspace, publish/enable the app for the intended roles if required by workspace policy.

Plan note: Full MCP write/modify actions are currently rolling out for Business and Enterprise/Edu. Pro users can currently connect custom MCPs for read/fetch in Developer Mode, but not full write/modify.

## 5. Test from ChatGPT

Open a fresh supported ChatGPT chat, select or @mention **ChatGPT Remote Commander**, then ask:

`Run system_status and report the active mode, version, platform, shell, and concurrency state.`

PASS requires a real tool response from the target computer.

If using Power Mode, also ask:

`Run power_status. Do not modify anything; only report the enabled Power Mode capabilities.`

For an end-to-end non-destructive write test, explicitly choose a disposable test file inside a test/project directory, write a known marker, read it back, then delete it only after the user approves deletion.

## 6. FINAL PASS checklist

Do not call setup complete until all applicable checks are true:
- latest installer completed with `INSTALL_PASS`;
- MCP health returns `ok: true`;
- the tunnel client is ready;
- persistent enrollment passed;
- the ChatGPT custom app scanned tools successfully;
- a fresh chat can call `system_status`;
- requested Standard or Power Mode matches `system_status` / `power_status`;
- no Runtime API key or Tunnel secret was pasted into chat or committed to Git;
- autostart is enabled if the user wants zero-reentry startup.

## 7. Start, stop, and update

### Update

Re-run the same latest-release installer command used for installation. Credentials and tunnel profiles are preserved.

### Stop on Windows

This disables logon autostart and stops the Remote Commander supervisor, its managed tunnels, and the MCP server while keeping credentials by default:

```powershell
& "<INSTALL_DIR>\disable-autostart.ps1"
```

To also remove one saved credential:

```powershell
& "<INSTALL_DIR>\disable-autostart.ps1" -Profile "chatgpt-remote-commander" -RemoveCredential
```

### Start again on Windows

```powershell
& "<INSTALL_DIR>\connect-chatgpt.ps1"
```

It reuses the saved DPAPI credential when present.

### Stop/start on Linux

```bash
./disable-autostart-linux.sh
./enable-autostart-linux.sh --profile chatgpt-remote-commander
```

## 8. ChatGPT Work and Plugin installation

If the user wants ChatGPT Work to package and install the Plugin after the MCP app is registered, continue with [WORK_SETUP.md](WORK_SETUP.md). That guide covers the current `@plugin-creator` flow, personal/local marketplace installation, managed-workspace GitHub marketplace import, explicit install approval, and a real `system_status` test from a fresh Work task.

Work must not confuse its own cloud computer with the user's target computer. Until the Remote Commander MCP app is connected, local target-machine commands must run through an authorized local surface or be executed by the user.

## 9. App vs Plugin

A **custom MCP app** is the actual ChatGPT connection to this private MCP server through the Secure MCP Tunnel.

A **Plugin** packages workflows, skills, metadata, icons, and optionally a reference to an already-registered app. This repository includes a ready plugin template under `plugin-template/`.

For a private/workspace plugin:
1. Create the custom MCP app first.
2. Obtain either its real App ID (`asdk_app_...`, `connector_...`, or `templated_apps_...`) or the ChatGPT technical identifier such as `plugin_asdk_app_...` from that exact Custom App. Verify its scanned tools include this project's `system_status`; do not bind a similarly named Directory app.
3. Prefer the public one-command binder/installer. Windows: `& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install-work-plugin.ps1'))) -AppId "plugin_asdk_app_..."`. Linux: `curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install-work-plugin.sh | bash -s -- "plugin_asdk_app_..."`.
4. The installer strips the `plugin_` wrapper when needed, creates a private app-bound Plugin copy, downloads the stable latest-Release `plugin-template.zip` automatically when no local template exists, adds a personal marketplace, installs/enables it through Codex, and verifies `.app.json`.
5. For manual packaging or `@plugin-creator`, follow `WORK_SETUP.md` and `docs/PLUGIN_SETUP.md`.

For public Plugin Directory publication, a Secure MCP Tunnel is not a public distribution endpoint. OpenAI currently requires a stable public HTTPS MCP endpoint for an MCP-backed public plugin submission. See `docs/PLUGIN_SETUP.md`.

## 10. If the user gives only the GitHub URL to ChatGPT

Use this prompt:

```text
Set up this repository on my computer from zero to FINAL PASS:
https://github.com/GOD13emad/ChatGPTRemoteCommander

Read START_HERE.md first and treat it as the single source of truth.
Guide me one checkpoint at a time. Never ask me to paste API keys or tunnel secrets into chat.
Explain Standard vs Full/Power Mode and let me choose.
Continue through install/update, Secure MCP Tunnel, persistent enrollment, ChatGPT custom app creation, Plugin installation when the current surface supports it, tool scan, real system_status test, autostart, update/start/stop, and final verification. If I am using ChatGPT Work or Codex, also read WORK_SETUP.md and install/enable the repository Plugin through its marketplace when possible.
```

## 11. Troubleshooting principles

- `InstallDir exists but is not a Git checkout`: use the latest Release installer asset; do not use an old cached `raw/main` installer.
- `tunnel-client run failed: -1`: do not start a duplicate foreground tunnel. Re-run `connect-chatgpt.ps1`; persistent mode keeps one managed tunnel.
- health-port bind conflict: if the matching tunnel is already ready, current enrollment treats it as healthy and does not start a duplicate.
- Tunnel not visible in ChatGPT: verify workspace association and Tunnel Read + Use permission.
- OAuth discovery error: this server uses **None / No authentication**, not Mixed/OAuth.
- `FORBIDDEN: This conversation does not support developer MCPs`: use a fresh MCP-capable chat; this gate occurs before requests reach the local server.
- Tools look stale after a server upgrade: use the app's Refresh/Scan Tools flow where available, or recreate the draft app if required by your plan/workspace.
- `CHECK codex_plugin SKIP` from `tunnel-client doctor` is optional and is not a Remote Commander FINAL PASS blocker. The project's own app-bound Plugin is installed through `install-work-plugin.ps1/.sh` or the repository marketplace. On the current Windows v0.0.14 tunnel-client release, the optional `tunnel-client codex plugin install` path can report `binary is not executable`; do not replace or expose the working tunnel just to satisfy that optional check.

## Official references

- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- Developer Mode and MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- Plugins: https://help.openai.com/en/articles/20001256/
- Plugin packaging: https://developers.openai.com/plugins/build/plugins


### GUI backend implementation note

Windows GUI Control uses bounded **synthetic input** in the current interactive user session for mouse and keyboard actions. A submitted input is not considered successful until a fresh screenshot confirms the visible result. It does not bypass Secure Desktop/UAC, the lock screen, protected-input/anti-cheat restrictions, or real-time latency limits.


## v0.7 durable workflows and multi-account isolation

For long-running project work, enable durable workflows only after deciding the account boundary. The primary profile can enable its private local store with:

```powershell
.\configure-durable-workflows.ps1
```

Additional ChatGPT accounts on the same PC should use a separate local MCP instance before durable memory is enabled:

```powershell
.\configure-profile-instance.ps1 -Profile "saeed-emad"
```

or during enrollment:

```powershell
.\connect-chatgpt-account.ps1 -Profile "saeed-emad" -HealthPort 47833 -Isolate
```

The isolated secondary profile gets a distinct loopback MCP port, runtime marker, audit log and workflow database. It defaults to Standard Mode with shell/process/GUI/full-filesystem access off. This is an application/configuration boundary, not an OS sandbox; use separate Windows users/VMs for principals with materially different OS-level trust.

Durable workflow state records project goal, acceptance criteria, steps, typed notes, checkpoint evidence hashes and an exact next action. It never automatically replays an uncertain external effect after interruption. Use `workflow_resume` and reconcile evidence deliberately.
