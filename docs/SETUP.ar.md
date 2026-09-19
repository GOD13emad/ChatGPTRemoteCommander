# ChatGPT Remote Commander — الإعداد الحالي

> المرجع الوحيد هو [START_HERE.md](../START_HERE.md). يجب على أي مساعد AI قراءة هذا الملف أولاً وعدم خلط المسارات القديمة مع الإعداد الحالي.

لـ Windows استخدم أحدث Release asset. الوضع القياسي أكثر أماناً، وPower Mode مخصص فقط لجهاز موثوق لأنه يتيح نظام الملفات وShell والتحكم بالعمليات.

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

بعد التثبيت أنشئ Secure MCP Tunnel وRuntime API key. لا تلصق المفتاح في الدردشة؛ أدخله فقط في prompt المحلي المخفي. أنشئ Custom App في ChatGPT باستخدام Connection = Tunnel وAuthentication = None ثم Scan Tools.

الأيقونة: [plugin-icon.png](../assets/plugin-icon.png). إعداد Plugin: [PLUGIN_SETUP.md](PLUGIN_SETUP.md).

لا تعتبر الإعداد مكتملاً حتى ينجح MCP health وTunnel ready وScan Tools واستدعاء حقيقي لـ `system_status`.