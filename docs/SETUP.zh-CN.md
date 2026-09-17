# ChatGPT Remote Commander — 逐步点击安装指南

> GitHub 仓库公开并不代表任何人都能连接作者的电脑。必须具备已授权的 Tunnel、对应 Workspace/Plugin 权限，并且目标电脑上正在运行 `tunnel-client`。

## 1. 在 Windows 上安装

1. 打开仓库：https://github.com/GOD13emad/ChatGPTRemoteCommander
2. 点击 **Code** → **Download ZIP**，或使用 Git 克隆。
3. 解压并打开项目目录。
4. 如有需要，安装 Node.js 22+ 和 PowerShell 7。
5. 在项目目录中打开 PowerShell 7。
6. 执行：

```powershell
npm run check
npm test
npm start
```

7. 打开 http://127.0.0.1:47831/health，并确认 `ok: true`。

## 2. 创建 Secure MCP Tunnel

1. 登录 OpenAI Platform。
2. 打开：https://platform.openai.com/settings/organization/tunnels
3. 点击 **Create tunnel**。
4. 输入名称，例如 `ChatGPT Remote Commander`。
5. 关联拥有该 Tunnel 的 Platform organization。
6. 关联需要查看/使用该 Tunnel 的 ChatGPT workspace。
7. 保存并复制 `tunnel_id`。
8. 创建/编辑 Tunnel 需要 **Tunnels Read + Manage**；运行/选择 Tunnel 需要 **Tunnels Read + Use**。
## 3. 创建 Runtime API Key 并启动 Tunnel

1. 打开：https://platform.openai.com/api-keys
2. 创建受限的 Runtime API Key，只授予所需的 Tunnel 权限。
3. 不要把密钥粘贴到聊天、GitHub、截图或项目文件中。
4. 如有需要，下载最新 tunnel-client：https://github.com/openai/tunnel-client/releases/latest
5. 保持 MCP Server 运行，打开第二个 PowerShell 7 窗口并执行：

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. 按提示输入 `tunnel_id`，然后输入 API Key；密钥输入是隐藏的。
7. 保持窗口开启；ChatGPT 使用时 Tunnel 必须保持 healthy/ready。

## 4. 在 ChatGPT 中创建 Plugin/App

1. 打开：https://chatgpt.com/plugins
2. 点击 **+**。
3. 输入名称，例如 `ChatGPT Remote Commander`。
4. 在 **Connection** 中选择 **Tunnel**。
5. 选择已创建的 Tunnel，或粘贴有效的 tunnel ID。
6. 本服务器请选择 **None / No authentication**，不要选择 Mixed/OAuth。
7. 检查风险提示和权限。
8. 如果界面提供 Scan/Refresh Tools，请执行后点击 **Create**。
9. 新建聊天，选择该 App 或用 `@mention` 调用。
10. 测试：`Run system_status and report the active capabilities.`

## 5. Power Mode 与第二个账号

公开的 `config.json` 默认是安全配置。Full Control 只应在本地的 `config.local.json` 中启用；该文件被 Git 忽略。建议保持永久删除关闭；shutdown/restart/logoff 仍然被阻止。

给朋友或第二个账号使用时，应在对方账号/Workspace 中创建独立 Tunnel，并在同一目标电脑上运行对应 tunnel-client。不要共享自己的 Runtime API Key。根据 OpenAI 当前文档，Pro 的 custom MCP 支持 read/fetch；完整 write/modify 目前面向 Business 和 Enterprise/Edu。

## 故障排除

- 看不到 Tunnel：检查目标 ChatGPT workspace 关联以及 **Tunnels Read + Use** 权限。
- OAuth discovery 错误：将 Authentication 设为 **None**。
- `FORBIDDEN: This conversation does not support developer MCPs`：新建聊天，即使在同一 Project 中也可以，并尽早调用该 App。
- 升级后仍看到旧工具：Refresh 或重新创建 custom app，让 ChatGPT 重新扫描工具 schema。

官方文档：https://developers.openai.com/api/docs/guides/secure-mcp-tunnels 和 https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
