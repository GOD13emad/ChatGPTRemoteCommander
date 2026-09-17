# راه‌اندازی کلیک‌به‌کلیک ChatGPT Remote Commander

> عمومی بودن GitHub به معنی اتصال دیگران به رایانه سازنده نیست. برای اتصال باید Tunnel مجاز، دسترسی Workspace/Plugin و `tunnel-client` فعال روی رایانه مقصد وجود داشته باشد.

## ۱. نصب روی ویندوز

1. مخزن را باز کنید: https://github.com/GOD13emad/ChatGPTRemoteCommander
2. روی **Code** و سپس **Download ZIP** بزنید یا با Git کلون کنید.
3. پوشه پروژه را استخراج/باز کنید.
4. در صورت نیاز Node.js 22+ و PowerShell 7 را نصب کنید.
5. PowerShell 7 را داخل پوشه پروژه باز کنید.
6. اجرا کنید:

```powershell
npm run check
npm test
npm start
```

7. این آدرس را باز کنید: http://127.0.0.1:47831/health و مطمئن شوید `ok: true` است.

## ۲. ساخت Secure MCP Tunnel

1. وارد OpenAI Platform شوید.
2. بروید به: https://platform.openai.com/settings/organization/tunnels
3. روی **Create tunnel** کلیک کنید.
4. یک نام مثل `ChatGPT Remote Commander` بدهید.
5. Platform organization مالک Tunnel را Associate کنید.
6. ChatGPT workspaceای را که باید Tunnel را ببیند/استفاده کند Associate کنید.
7. ذخیره کنید و `tunnel_id` را بردارید.
8. ساخت/ویرایش Tunnel به **Tunnels Read + Manage** و اجرا/انتخاب آن به **Tunnels Read + Use** نیاز دارد.
## ۳. ساخت Runtime API Key و اجرای Tunnel

1. بروید به: https://platform.openai.com/api-keys
2. یک Runtime API Key محدود بسازید و فقط مجوزهای لازم Tunnel را بدهید.
3. این کلید را هرگز در چت، GitHub، اسکرین‌شات یا فایل پروژه قرار ندهید.
4. در صورت نیاز آخرین tunnel-client را بگیرید: https://github.com/openai/tunnel-client/releases/latest
5. در حالی که MCP Server روشن است، یک PowerShell 7 دوم باز کنید و اجرا کنید:

```powershell
pwsh.exe -NoProfile -File .\connect-chatgpt.ps1
```

6. `tunnel_id` و سپس API Key را وارد کنید. ورود کلید مخفی است.
7. این پنجره را باز نگه دارید؛ هنگام استفاده ChatGPT، Tunnel باید healthy/ready باشد.

## ۴. ساخت Plugin/App در ChatGPT

1. باز کنید: https://chatgpt.com/plugins
2. روی **+** کلیک کنید.
3. نامی مثل `ChatGPT Remote Commander` وارد کنید.
4. در **Connection** گزینه **Tunnel** را انتخاب کنید.
5. Tunnel ساخته‌شده را انتخاب کنید یا tunnel ID معتبر را وارد کنید.
6. برای این سرور Authentication را روی **None / No authentication** بگذارید، نه Mixed/OAuth.
7. هشدار خطر و Permissionها را مرور کنید.
8. در صورت نمایش گزینه Scan/Refresh Tools آن را اجرا کنید و سپس **Create** را بزنید.
9. یک چت جدید باز کنید و App را انتخاب یا `@mention` کنید.
10. تست کنید: `system_status را اجرا کن و قابلیت‌های فعال را گزارش کن.`

## ۵. Power Mode و دادن دسترسی به حساب دیگر

`config.json` عمومی به‌صورت پیش‌فرض امن است. Full Control فقط باید در `config.local.json` محلی فعال شود؛ این فایل gitignored است. حذف دائمی را خاموش نگه دارید و shutdown/restart/logoff همچنان مسدود می‌ماند.

برای دوست یا حساب دوم، در حساب/Workspace او Tunnel جدا بسازید و همان tunnel-client را روی رایانه مقصد اجرا کنید. Runtime API Key خودتان را به دیگری ندهید. طبق مستندات فعلی OpenAI، Pro برای custom MCP دسترسی read/fetch دارد؛ write/modify کامل فعلاً برای Business و Enterprise/Edu است.

## رفع اشکال

- Tunnel دیده نمی‌شود: Workspace مقصد و مجوز **Tunnels Read + Use** را بررسی کنید.
- خطای OAuth discovery: Authentication را **None** بگذارید.
- خطای `FORBIDDEN: This conversation does not support developer MCPs`: یک چت تازه، حتی داخل همان Project، بسازید و App را از ابتدای چت فراخوانی کنید.
- ابزارهای نسخه جدید دیده نمی‌شوند: App سفارشی را Refresh یا دوباره Create کنید تا schema جدید اسکن شود.

مراجع رسمی: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels و https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
