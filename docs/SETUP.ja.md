# ChatGPT Remote Commander — クリックごとのセットアップ手順

> GitHub リポジトリが公開されていても、誰でも作者の PC に接続できるわけではありません。承認済み Tunnel、Workspace/Plugin の権限、対象 PC 上で動作する `tunnel-client` が必要です。

## 1コマンドで直接インストール

次のいずれかを PowerShell に貼り付けます。Standard は安全な既定値で、Power Mode は信頼済みPCでファイル・Shell・プロセスの完全制御を有効にします。

**Standard:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

**Power Mode:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

## 1. Windows PC にインストール

1. リポジトリを開く: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. **Code** → **Download ZIP** をクリックするか、Git で clone します。
3. プロジェクトフォルダを展開して開きます。
4. 必要なら Node.js 22+ と PowerShell 7 をインストールします。
5. プロジェクトフォルダで PowerShell 7 を開きます。
6. 実行します:

```powershell
npm run check
npm test
npm start
```

7. http://127.0.0.1:47831/health を開き、`ok: true` を確認します。

## 2. Secure MCP Tunnel を作成

1. OpenAI Platform にサインインします。
2. https://platform.openai.com/settings/organization/tunnels を開きます。
3. **Create tunnel** をクリックします。
4. 例として `ChatGPT Remote Commander` という名前を設定します。
5. Tunnel を所有する Platform organization を関連付けます。
6. Tunnel を表示・利用する ChatGPT workspace を関連付けます。
7. 保存し、`tunnel_id` をコピーします。
8. 作成/編集には **Tunnels Read + Manage**、実行/選択には **Tunnels Read + Use** が必要です。
## 3. Runtime API Key を作成して Tunnel を起動

1. https://platform.openai.com/api-keys を開きます。
2. 必要な Tunnel 権限だけを持つ制限付き Runtime API Key を作成します。
3. キーをチャット、GitHub、スクリーンショット、プロジェクトファイルに貼り付けないでください。
4. 必要なら最新の tunnel-client を取得します: https://github.com/openai/tunnel-client/releases/latest
5. MCP Server を動かしたまま、2つ目の PowerShell 7 を開いて実行します:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. `tunnel_id`、続いて API Key を入力します。キー入力は非表示です。
7. このウィンドウを開いたままにします。ChatGPT 利用中は Tunnel が healthy/ready である必要があります。

## 4. ChatGPT で Plugin/App を作成

1. https://chatgpt.com/plugins を開きます。
2. **+** をクリックします。
3. `ChatGPT Remote Commander` などの名前を入力します。
4. **Connection** で **Tunnel** を選びます。
5. 作成した Tunnel を選択するか、有効な tunnel ID を入力します。
6. このサーバーでは **None / No authentication** を選び、Mixed/OAuth は選びません。
7. リスク警告と権限を確認します。
8. Scan/Refresh Tools が表示される場合は実行し、**Create** をクリックします。
9. 新しいチャットを開き、App を選択するか `@mention` します。
10. テスト: `Run system_status and report the active capabilities.`

## 5. Power Mode と別アカウント

公開 `config.json` は安全な既定値です。Full Control は Git に追跡されないローカル `config.local.json` だけで有効にしてください。永久削除は無効のままを推奨し、shutdown/restart/logoff は引き続きブロックされます。

友人や2つ目のアカウントには、そのアカウント/Workspace で別の Tunnel を作り、同じ対象 PC 上でその tunnel-client を実行します。自分の Runtime API Key は共有しないでください。現在の OpenAI 文書では Pro の custom MCP は read/fetch、完全な write/modify は Business と Enterprise/Edu 向けです。

## トラブルシューティング

- Tunnel が見えない: 対象 ChatGPT workspace の関連付けと **Tunnels Read + Use** を確認します。
- OAuth discovery エラー: Authentication を **None** にします。
- `FORBIDDEN: This conversation does not support developer MCPs`: 同じ Project 内でも新しいチャットを作り、早い段階で App を呼び出します。
- 更新後も古い Tool が表示される: Custom App を Refresh または再作成して schema を再スキャンします。

公式ドキュメント: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels および https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

## v0.3：複数PC、複数アカウント、同時チャット、トンネル情報の再入力不要

- 1つのChatGPTアカウントから複数のPCを操作できます。各PCにインストールし、デバイスごとに別の Secure MCP Tunnel を作成します。
- 複数のChatGPTアカウントから1台のPCを利用できます。各アカウントを別の Tunnel Profile で登録し、ヘルスポートは自動選択されます。
- 複数のチャットから同じMCPを同時に利用できます。同じパスへの変更は書き込み競合を減らすため直列化されます。

Windowsで一度だけ登録して自動起動を有効化：

```powershell
.\enable-autostart.ps1 -Profile chatgpt-remote-commander
```

Linuxで一度だけ登録して自動起動を有効化：

```bash
./enable-autostart-linux.sh --profile "$(hostname)"
```

登録後は、ローカル supervisor がログイン時にMCPと登録済みトンネルを自動起動します。以後、Tunnel ID、ローカルアドレス/ポート、Runtime API Keyを毎回入力する必要はありません。
