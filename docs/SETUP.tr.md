# ChatGPT Remote Commander — Tıklama tıklama kurulum

> GitHub deposunun herkese açık olması, herkesin geliştiricinin bilgisayarına bağlanabileceği anlamına gelmez. Yetkili bir Tunnel, Workspace/Plugin erişimi ve hedef bilgisayarda çalışan `tunnel-client` gerekir.

## Tek komutla doğrudan kurulum

Aşağıdaki komutlardan birini PowerShell içine yapıştırın. Standard güvenli varsayılandır; Power Mode güvenilen bir bilgisayarda tam dosya/Shell/process kontrolünü açar.

**Standard:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

**Power Mode:**

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

## 1. Windows bilgisayara kurulum

1. Depoyu açın: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. **Code** → **Download ZIP** seçin veya Git ile klonlayın.
3. Proje klasörünü çıkarın/açın.
4. Gerekirse Node.js 22+ ve PowerShell 7 kurun.
5. Proje klasöründe PowerShell 7 açın.
6. Çalıştırın:

```powershell
npm run check
npm test
npm start
```

7. http://127.0.0.1:47831/health adresini açın ve `ok: true` doğrulayın.

## 2. Secure MCP Tunnel oluşturma

1. OpenAI Platform'a giriş yapın.
2. Açın: https://platform.openai.com/settings/organization/tunnels
3. **Create tunnel** seçeneğine tıklayın.
4. Örneğin `ChatGPT Remote Commander` adını verin.
5. Tunnel sahibi Platform organization'ı ilişkilendirin.
6. Tunnel'ı görmesi/kullanması gereken ChatGPT workspace'i ilişkilendirin.
7. Kaydedin ve `tunnel_id` değerini alın.
8. Oluşturma/düzenleme için **Tunnels Read + Manage**, çalıştırma/seçme için **Tunnels Read + Use** gerekir.
## 3. Runtime API Key oluşturma ve Tunnel'ı çalıştırma

1. Açın: https://platform.openai.com/api-keys
2. Yalnızca gerekli Tunnel izinlerine sahip kısıtlı bir Runtime API Key oluşturun.
3. Anahtarı asla sohbet, GitHub, ekran görüntüsü veya proje dosyalarına koymayın.
4. Gerekirse en güncel tunnel-client'ı indirin: https://github.com/openai/tunnel-client/releases/latest
5. MCP Server çalışırken ikinci bir PowerShell 7 penceresi açın ve çalıştırın:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. İstendiğinde `tunnel_id` ve ardından API Key'i girin; anahtar girişi gizlidir.
7. Pencereyi açık tutun; ChatGPT kullanırken Tunnel healthy/ready kalmalıdır.

## 4. ChatGPT Plugin/App oluşturma

1. Açın: https://chatgpt.com/plugins
2. **+** düğmesine tıklayın.
3. `ChatGPT Remote Commander` gibi bir ad yazın.
4. **Connection** altında **Tunnel** seçin.
5. Oluşturduğunuz Tunnel'ı seçin veya geçerli tunnel ID girin.
6. Bu sunucu için **None / No authentication** seçin; Mixed/OAuth seçmeyin.
7. Risk uyarısını ve izinleri inceleyin.
8. Varsa Scan/Refresh Tools çalıştırın ve **Create** tıklayın.
9. Yeni sohbet açın ve uygulamayı seçin veya `@mention` kullanın.
10. Test: `Run system_status and report the active capabilities.`

## 5. Power Mode ve ikinci hesap

Herkese açık `config.json` güvenli varsayılanlarla gelir. Full Control yalnızca gitignore'daki yerel `config.local.json` içinde açılmalıdır. Kalıcı silmeyi kapalı tutun; shutdown/restart/logoff engellenmeye devam eder.

Bir arkadaş veya ikinci hesap için o hesap/Workspace içinde ayrı bir Tunnel oluşturun ve tunnel-client'ı aynı hedef PC'de çalıştırın. Runtime API Key'inizi paylaşmayın. Güncel OpenAI belgelerine göre Pro custom MCP için read/fetch destekler; tam write/modify şu anda Business ve Enterprise/Edu içindir.

## Sorun giderme

- Tunnel görünmüyor: hedef ChatGPT workspace ilişkilendirmesini ve **Tunnels Read + Use** iznini kontrol edin.
- OAuth discovery hatası: Authentication = **None** yapın.
- `FORBIDDEN: This conversation does not support developer MCPs`: aynı Project içinde bile yeni sohbet açın ve uygulamayı erken çağırın.
- Yeni araçlar görünmüyor: özel uygulamayı Refresh edin veya yeniden oluşturun.

Resmî belgeler: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels ve https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

## v0.3: birden çok bilgisayar, birden çok hesap, eşzamanlı sohbetler ve tekrar tünel bilgisi girmeden çalışma

- Tek bir ChatGPT hesabı birden çok bilgisayarı kontrol edebilir: her bilgisayara kurun ve her cihaz için ayrı bir Secure MCP Tunnel oluşturun.
- Birden çok ChatGPT hesabı aynı bilgisayarı kullanabilir: her hesabı farklı bir Tunnel Profile ile kaydedin; sağlık portu otomatik seçilir.
- Birden çok sohbet aynı MCP'yi eşzamanlı kullanabilir; aynı yol üzerindeki değişiklikler yazma çakışmalarını azaltmak için sıraya alınır.

Windows'ta tek seferlik kayıt ve otomatik başlatma:

```powershell
.\enable-autostart.ps1 -Profile chatgpt-remote-commander
```

Linux'ta tek seferlik kayıt ve otomatik başlatma:

```bash
./enable-autostart-linux.sh --profile "$(hostname)"
```

Bundan sonra yerel supervisor MCP'yi ve kayıtlı tünelleri oturum açıldığında otomatik başlatır; Tunnel ID, yerel adres/port veya Runtime API Key'i yeniden girmeniz gerekmez.
