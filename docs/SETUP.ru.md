# ChatGPT Remote Commander — актуальная настройка

> Единый источник истины: [START_HERE.md](../START_HERE.md). ИИ-помощник должен сначала прочитать этот файл и не смешивать старые способы настройки.

Standard — более безопасный режим. Full/Power Mode предназначен только для доверенного компьютера и включает полный доступ к файлам, Shell и процессам.

**Windows Standard**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

**Windows Power**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

**Linux**

```bash
curl -fsSL --connect-timeout 15 --max-time 180 https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

Затем создайте Secure MCP Tunnel и Runtime API Key. Никогда не вставляйте ключ в чат; вводите его только в скрытый локальный prompt. Создайте Custom App в ChatGPT: Connection = Tunnel, Authentication = None, затем Scan Tools.

Иконка: [plugin-icon.png](../assets/plugin-icon.png). Plugin: [PLUGIN_SETUP.md](PLUGIN_SETUP.md).

FINAL PASS — только после MCP health, Tunnel ready, Scan Tools и реального вызова `system_status`.