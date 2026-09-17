# ChatGPT Remote Commander — Click-by-click setup

> Public GitHub code does **not** connect anyone to the author's PC. A user needs an authorized tunnel, workspace/app access, and a running `tunnel-client` on the target PC.

## One-command direct install

Paste one of these commands into PowerShell. Standard is safe-by-default; Power Mode enables full filesystem/Shell/process control on a trusted PC.

**Standard:**

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -StartServer
```

**Power Mode:**

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

## 1. Install on the Windows PC

1. Open the repository: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. Click **Code** → **Download ZIP**, or clone it with Git.
3. Extract/open the project folder.
4. Install Node.js 22+ and PowerShell 7 if needed.
5. Open PowerShell 7 in the project folder.
6. Run:

```powershell
npm run check
npm test
npm start
```

7. Open http://127.0.0.1:47831/health and confirm `ok: true`.

## 2. Create the Secure MCP Tunnel

1. Sign in to OpenAI Platform.
2. Open https://platform.openai.com/settings/organization/tunnels
3. Click **Create tunnel**.
4. Name it, for example `ChatGPT Remote Commander`.
5. Associate the Platform organization that owns the tunnel.
6. Associate the ChatGPT workspace that must see/use the tunnel.
7. Save it and copy the `tunnel_id`.
8. Creating/editing tunnels requires **Tunnels Read + Manage**; running/selecting a tunnel requires **Tunnels Read + Use**.
## 3. Create the runtime API key and start the tunnel

1. Open https://platform.openai.com/api-keys
2. Create a restricted runtime key with only the tunnel permissions you need.
3. Never paste that key into chat, GitHub, screenshots, or project files.
4. Download the latest tunnel client if needed: https://github.com/openai/tunnel-client/releases/latest
5. With the MCP server still running, open a second PowerShell 7 window and run:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. Enter the `tunnel_id` and then the API key when prompted. The key input is hidden.
7. Keep this window open. The tunnel must stay healthy/ready while ChatGPT uses it.

## 4. Create the ChatGPT plugin/app

1. Open https://chatgpt.com/plugins
2. Click the **+** button.
3. Enter a name such as `ChatGPT Remote Commander`.
4. Under **Connection**, choose **Tunnel**.
5. Select the tunnel you created, or paste its valid tunnel ID.
6. For this server choose **No authentication / None**, not Mixed/OAuth.
7. Review the risk notice and permissions.
8. Scan/refresh tools when the UI offers it, then click **Create**.
9. Open a new chat and select or `@mention` the app.
10. Test: `Run system_status and report the active capabilities.`

## 5. Power Mode and account sharing

Public `config.json` is safe-by-default. Full control must be enabled only in local `config.local.json`, which is gitignored. Keep permanent delete off unless you have a specific reason. Shutdown/restart/logoff remain blocked.

For a friend or second account, create a separate tunnel in that account/workspace and run that tunnel client on the same target PC. Do not share your Runtime API key. Current OpenAI documentation says Pro custom MCP access is read/fetch; full write/modify MCP is currently for Business and Enterprise/Edu.

## Troubleshooting

- `Tunnel not visible`: verify the target ChatGPT workspace association and **Tunnels Read + Use**.
- OAuth discovery error: recreate/edit the app with authentication set to **None**.
- `FORBIDDEN: This conversation does not support developer MCPs`: start a fresh chat, including inside the same Project, and invoke the app early.
- Tool list looks old after a server upgrade: refresh/recreate the custom app so ChatGPT scans the current tool schema.

Official docs: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels and https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
