# Setup Guides — 10 Languages

Choose your language:

- [English](SETUP.en.md)
- [فارسی / Persian](SETUP.fa.md)
- [العربية / Arabic](SETUP.ar.md)
- [Türkçe / Turkish](SETUP.tr.md)
- [Español / Spanish](SETUP.es.md)
- [Français / French](SETUP.fr.md)
- [Deutsch / German](SETUP.de.md)
- [Русский / Russian](SETUP.ru.md)
- [简体中文 / Simplified Chinese](SETUP.zh-CN.md)
- [日本語 / Japanese](SETUP.ja.md)

Each guide covers installation, Secure MCP Tunnel creation, ChatGPT plugin creation, first tests, Power Mode, friend/second-account access, and troubleshooting.

Official OpenAI references:

- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- https://platform.openai.com/settings/organization/tunnels
- https://chatgpt.com/plugins

## One-command install

Standard:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -StartServer
```

Power Mode on a trusted PC:

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

## v0.3 cross-platform and persistent startup

All guides now also cover Windows + Linux, one account on multiple computers, multiple accounts on one computer, concurrent chats, automatic health-port selection, and zero-reentry startup.

Windows one-time persistent enrollment:

```powershell
.\enable-autostart.ps1 -Profile chatgpt-remote-commander
```

Linux install and one-time persistent enrollment:

```bash
curl -fsSL https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.sh | bash -s -- --install-prerequisites --start-server
./enable-autostart-linux.sh --profile "$(hostname)"
```

After enrollment, later logins do not require re-entering the Tunnel ID, MCP address, health port, or Runtime API key.

## Updating

Re-run the same one-command installer you originally used. On Windows v0.3.3+, an active registered installation is detected and updated in place; otherwise new installs keep application source under `%LOCALAPPDATA%\\ChatGPTRemoteCommander\\app` and persistent state in the parent directory. With `-StartServer`, a running v0.3 MCP is upgraded to the installed version without requiring sign-out or reboot.
