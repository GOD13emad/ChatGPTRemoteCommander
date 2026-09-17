# إعداد ChatGPT Remote Commander خطوة بخطوة

> نشر الكود على GitHub لا يعني أن أي شخص يستطيع الاتصال بجهاز المؤلف. يلزم Tunnel مصرح به، وصلاحية Workspace/Plugin، وتشغيل `tunnel-client` على الجهاز الهدف.

## التثبيت المباشر بأمر واحد

ألصق أحد الأمرين في PowerShell. الوضع Standard آمن افتراضياً، وPower Mode يفعّل التحكم الكامل بالملفات وShell والعمليات على جهاز موثوق.

**Standard:**

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -StartServer
```

**Power Mode:**

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/GOD13emad/ChatGPTRemoteCommander/main/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

## 1. التثبيت على Windows

1. افتح المستودع: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. اضغط **Code** ثم **Download ZIP** أو استخدم Git clone.
3. فك الضغط وافتح مجلد المشروع.
4. ثبّت Node.js 22+ وPowerShell 7 عند الحاجة.
5. افتح PowerShell 7 داخل مجلد المشروع.
6. نفّذ:

```powershell
npm run check
npm test
npm start
```

7. افتح http://127.0.0.1:47831/health وتأكد من ظهور `ok: true`.

## 2. إنشاء Secure MCP Tunnel

1. سجّل الدخول إلى OpenAI Platform.
2. افتح: https://platform.openai.com/settings/organization/tunnels
3. اضغط **Create tunnel**.
4. اختر اسماً مثل `ChatGPT Remote Commander`.
5. اربط Platform organization المالكة للـ Tunnel.
6. اربط ChatGPT workspace الذي يجب أن يرى الـ Tunnel ويستخدمه.
7. احفظ وانسخ `tunnel_id`.
8. إنشاء/تعديل Tunnel يحتاج **Tunnels Read + Manage**، وتشغيله/اختياره يحتاج **Tunnels Read + Use**.
## 3. إنشاء Runtime API Key وتشغيل Tunnel

1. افتح: https://platform.openai.com/api-keys
2. أنشئ مفتاح Runtime محدود الصلاحيات للـ Tunnel فقط.
3. لا تضع المفتاح أبداً في المحادثة أو GitHub أو لقطات الشاشة أو ملفات المشروع.
4. عند الحاجة نزّل أحدث tunnel-client: https://github.com/openai/tunnel-client/releases/latest
5. مع استمرار MCP Server، افتح نافذة PowerShell 7 ثانية ونفّذ:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. أدخل `tunnel_id` ثم API Key عند الطلب؛ إدخال المفتاح مخفي.
7. اترك النافذة مفتوحة؛ يجب أن يبقى Tunnel healthy/ready أثناء استخدام ChatGPT.

## 4. إنشاء Plugin/App في ChatGPT

1. افتح: https://chatgpt.com/plugins
2. اضغط زر **+**.
3. أدخل اسماً مثل `ChatGPT Remote Commander`.
4. في **Connection** اختر **Tunnel**.
5. اختر الـ Tunnel أو أدخل tunnel ID صالحاً.
6. لهذا الخادم اختر **None / No authentication** وليس Mixed/OAuth.
7. راجع تحذير المخاطر والصلاحيات.
8. نفّذ Scan/Refresh Tools إن ظهر ثم اضغط **Create**.
9. افتح محادثة جديدة واختر التطبيق أو استخدم `@mention`.
10. اختبر: `Run system_status and report the active capabilities.`

## 5. Power Mode ومشاركة الوصول

`config.json` العام آمن افتراضياً. فعّل Full Control فقط في `config.local.json` المحلي، وهو ملف gitignored. اترك الحذف الدائم معطلاً، وتظل أوامر shutdown/restart/logoff محظورة.

لحساب صديق أو حساب ثانٍ، أنشئ Tunnel منفصلاً داخل حسابه/Workspace الخاص به وشغّل tunnel-client على نفس الجهاز الهدف. لا تشارك Runtime API Key الخاص بك. وفق توثيق OpenAI الحالي، Pro يدعم custom MCP للقراءة/fetch، بينما write/modify الكامل متاح حالياً لـ Business وEnterprise/Edu.

## حل المشاكل

- الـ Tunnel غير ظاهر: تحقق من ربط ChatGPT workspace ومن صلاحية **Tunnels Read + Use**.
- خطأ OAuth discovery: اجعل Authentication = **None**.
- `FORBIDDEN: This conversation does not support developer MCPs`: افتح محادثة جديدة، حتى داخل نفس Project، واستدعِ التطبيق مبكراً.
- أدوات الإصدار الجديد غير ظاهرة: Refresh أو أعد إنشاء التطبيق حتى يعاد فحص schema الأدوات.

المراجع الرسمية: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels و https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
