# ChatGPT Remote Commander — 現行セットアップ

> 正式な手順は [START_HERE.md](../START_HERE.md) です。AI アシスタントは最初にこのファイルを読み、古い手順を混在させないでください。

Standard Mode が安全な既定値です。Full/Power Mode は信頼できる PC のみで使用し、ファイルシステム、Shell、プロセス制御を有効にします。

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

次に Secure MCP Tunnel と Runtime API Key を作成します。API Key をチャットに貼り付けず、ローカルの非表示入力だけに入力してください。ChatGPT で Connection = Tunnel、Authentication = None、Scan Tools を使って Custom App を作成します。

アイコン: [plugin-icon.png](../assets/plugin-icon.png)。Plugin 手順: [PLUGIN_SETUP.md](PLUGIN_SETUP.md)。

MCP health、Tunnel ready、Scan Tools、実際の `system_status` 呼び出しが成功してから FINAL PASS としてください。