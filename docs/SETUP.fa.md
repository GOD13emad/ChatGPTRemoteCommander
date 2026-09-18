# راه‌اندازی فعلی ChatGPT Remote Commander

> مسیر مرجع و نهایی: [START_HERE.md](../START_HERE.md). اگر این مخزن را به ChatGPT داده‌اید، ابتدا باید همان فایل را بخواند و روش‌های قدیمی را با مسیر فعلی ترکیب نکند.

## انتخاب حالت

**حالت استاندارد** انتخاب امن‌تر برای دسترسی کنترل‌شده به پروژه‌ها است.

**حالت کامل / Power Mode** برای رایانه مورداعتماد است و دسترسی کامل فایل‌ها، اجرای Shell، کنترل Process، فایل‌های باینری، پشتیبان‌گیری و Terminal پایدار را فعال می‌کند. حذف دائمی همچنان خاموش است و الگوهای خاموش‌کردن، راه‌اندازی مجدد و خروج خودکار مسدود می‌مانند.

مزیت حالت کامل این است که ChatGPT می‌تواند پروژه را واقعاً بررسی، ویرایش، Build، Test و Debug کند، Processها را مدیریت کند و بدون کپی‌کردن مداوم خروجی Terminal کارهای چندمرحله‌ای را انجام دهد.

این حالت sandbox سیستم‌عامل نیست؛ فقط روی رایانه و حساب مورداعتماد فعالش کنید.

در وضعیت فعلی محصول OpenAI، Full MCP با عملیات write/modify برای Business و Enterprise/Edu ارائه می‌شود. دسترسی custom MCP در Pro فعلاً read/fetch است.

## نصب یا به‌روزرسانی Windows

حالت استاندارد:

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -StartServer
```

حالت کامل:

```powershell
& ([scriptblock]::Create((irm 'https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.ps1'))) -InstallPrerequisites -PowerMode -StartServer
```

برای Update نیز همان دستور را دوباره اجرا کنید.

## نصب یا به‌روزرسانی Linux

استاندارد:

```bash
curl -fsSL https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --start-server
```

کامل:

```bash
curl -fsSL https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/latest/download/install.sh | bash -s -- --install-prerequisites --power-mode --start-server
```

## ساخت Secure MCP Tunnel و ثبت دائمی

در https://platform.openai.com/settings/organization/tunnels یک Tunnel بسازید و Runtime API Key ایجاد کنید.

Runtime API Key را **هرگز داخل چت Paste نکنید**. آن را فقط در Prompt مخفی روی رایانه خودتان وارد کنید.

در Windows، مسیر `connect-chatgpt.ps1` که Installer چاپ می‌کند اجرا شود. در نصب تازه معمولاً:

```powershell
& "$env:LOCALAPPDATA\ChatGPTRemoteCommander\app\connect-chatgpt.ps1"
```

در Linux:

```bash
./enable-autostart-linux.sh --profile chatgpt-remote-commander
```

بعد از ثبت یک‌باره، Supervisor پس‌زمینه MCP و Tunnel را خودکار بالا می‌آورد و در صورت Crash دوباره اجرا می‌کند. دیگر Tunnel ID، پورت یا Runtime API Key در هر بار ورود تکرار نمی‌شود.

## ساخت App سفارشی در ChatGPT

اگر Plan/Workspace اجازه می‌دهد Developer Mode را فعال کنید. سپس از Settings یا Workspace settings → Apps → Create:

1. نام را **ChatGPT Remote Commander** بگذارید.
2. Connection را **Tunnel** انتخاب کنید.
3. Tunnel ساخته‌شده را انتخاب کنید.
4. Authentication را **None / No authentication** بگذارید.
5. اگر آیکون خواست از [plugin-icon.png](../assets/plugin-icon.png) یا [plugin-logo.png](../assets/plugin-logo.png) استفاده کنید.
6. **Scan Tools** را اجرا کنید.
7. Permissionها را بررسی کنید.
8. **Create** را بزنید.
9. در Workspace مدیریت‌شده، در صورت نیاز App را برای Roleهای موردنظر Publish/Enable کنید.

بعد یک چت تازه باز کنید، App را انتخاب یا @mention کنید و بنویسید:

`system_status را اجرا کن و mode، version، platform، shell و concurrency را گزارش کن.`

در Power Mode همچنین `power_status` را فقط به‌صورت خواندنی اجرا کنید.

## ساخت Plugin

App سفارشی همان اتصال واقعی به Tunnel است. Plugin لایه بسته‌بندی برای Skill، Prompt، Metadata، آیکون و در صورت نیاز Reference به همان App است.

راهنمای کامل: [PLUGIN_SETUP.md](PLUGIN_SETUP.md)

Template آماده: [plugin-template](../plugin-template/)

برای Plugin خصوصی/Workspace می‌توان App ثبت‌شده را با `.app.json` به Template وصل کرد. Secure MCP Tunnel برای اتصال خصوصی است و برای انتشار عمومی MCP-backed Plugin در Directory باید MCP HTTPS عمومی و پایدار داشته باشید.

## معیار نهایی

نصب فقط وقتی نهایی است که همه این‌ها PASS باشند:
- `INSTALL_PASS`
- Health محلی MCP برابر `ok: true`
- Tunnel آماده باشد
- Scan Tools موفق باشد
- از یک چت تازه `system_status` واقعاً روی رایانه مقصد اجرا شود
- Mode فعال با انتخاب کاربر یکسان باشد
- هیچ Secret داخل Chat یا Git قرار نگرفته باشد

برای Update، Start، Stop و رفع خطا فقط [START_HERE.md](../START_HERE.md) را مبنا قرار دهید.
