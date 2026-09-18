# ChatGPT Remote Commander — 当前安装流程

> 唯一权威流程是 [START_HERE.md](../START_HERE.md)。AI 助手应先读取该文件，不要混用旧版安装方法。

Standard Mode 是更安全的默认选择。Full/Power Mode 只应在可信计算机上使用，它会启用完整文件系统、Shell 和进程控制。

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
curl -fsSL https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

随后创建 Secure MCP Tunnel 和 Runtime API Key。不要把 API Key 粘贴到聊天中，只在本地隐藏提示中输入。然后在 ChatGPT 中创建 Custom App：Connection = Tunnel、Authentication = None，并执行 Scan Tools。

图标：[plugin-icon.png](../assets/plugin-icon.png)。Plugin 指南：[PLUGIN_SETUP.md](PLUGIN_SETUP.md)。

只有 MCP health、Tunnel ready、Scan Tools 和真实的 `system_status` 调用全部成功后，才算 FINAL PASS。
