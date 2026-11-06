# ChatGPT Remote Commander — güncel kurulum

> Tek doğru kaynak: [START_HERE.md](../START_HERE.md). Bir AI asistanı önce bu dosyayı okumalı ve eski kurulum yollarını karıştırmamalıdır.

Standard daha güvenli varsayılandır. Full/Power Mode yalnızca güvenilir bir bilgisayarda kullanılmalı; tam dosya sistemi, Shell ve işlem kontrolünü etkinleştirir.

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

Sonra Secure MCP Tunnel ve Runtime API Key oluşturun. Anahtarı sohbete yapıştırmayın; yalnızca gizli yerel prompt'a girin. ChatGPT'de Connection = Tunnel, Authentication = None ve Scan Tools ile Custom App oluşturun.

İkon: [plugin-icon.png](../assets/plugin-icon.png). Plugin: [PLUGIN_SETUP.md](PLUGIN_SETUP.md).

FINAL PASS için MCP health, Tunnel ready, Scan Tools ve gerçek bir `system_status` çağrısı başarılı olmalıdır.
