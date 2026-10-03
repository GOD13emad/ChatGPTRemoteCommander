# Finite Project Companion 1.1.0 — source candidate / کاندید سورس

This is a self-contained JavaScript library candidate, not an installed service, unrestricted agent, or browser recovery product. Its version is the **Companion source package version**, not the Remote Commander core version. Publishing these files does not install or upgrade a running Commander. `private: true` prevents accidental npm publication; GitHub review is separate.

این بسته کتابخانهٔ مستقلِ سورس است، نه سرویس نصب‌شده، عامل نامحدود یا محصول رفع خطای مرورگر. شمارهٔ **۱٫۱٫۰ مربوط به همراه** است، نه هستهٔ Commander. انتشار فایل‌ها به معنی نصب یا ارتقای برنامهٔ فعال نیست. نصب‌کننده، اطلاعات مالکیت ویندوز و اتصال عملیاتیِ خصوصی در این بسته نیستند.

## What it does / چه کاری انجام می‌دهد

- An immutable, explicit grant fixes the project root, input/source hashes, exact action catalog, budgets and acceptance checks before execution. The next action is selected from that catalog in order; the model can only return `CONTINUE_STEP` or `STOP`, not invent tools or expand permission.
- Only four catalog kinds are accepted: `read_text`, `search_files`, `write_text` and `run_project_command`. `search_files` is a bounded substring search **inside one registered, pinned text file**, not a disk crawler. Writes are exact-byte, create-only owned outputs; existing files are not overwritten. Commands require exact image hash, argv, cwd, registered source pins and finite limits.
- A local `HISTORY.jsonl` stores enrollment, intent, model/action receipts, controls, checkpoints, reconciliation and outbox acknowledgements in a sequential SHA-256 hash chain. Model/action counts and the original deadline survive supported clean reopen; reopening does not grant fresh budget.
- Intent is persisted before an external call or effect. Confirmed receipts can resume without repeating the confirmed model decision. An uncertain call/effect becomes `RECONCILIATION_REQUIRED`; there is no blind retry or automatic replay.
- `pause`, `resume`, `cancel`, `STOP`, budget exhaustion and input/output drift are durable boundaries. A stopped or uncertain task must not be restarted merely by polling it.

مجوزِ صریح و ثابت، پوشهٔ پروژه، هش ورودی و سورس، فهرست عملیات، بودجه و معیار پذیرش را از ابتدا تعیین می‌کند. مدل فقط دربارهٔ اجرای **همان گام بعدی** یا توقف تصمیم می‌گیرد؛ نمی‌تواند دسترسی تازه یا دستور دلخواه بسازد. خواندن متن، جست‌وجوی محدود در یک فایل ثبت‌شده، ایجاد فایل جدید با محتوای دقیق و اجرای برنامهٔ دقیقاً تثبیت‌شده تنها انواع مجاز هستند. حافظهٔ هارد شامل تاریخچهٔ زنجیره‌هش، قصد اجرا و رسیدهاست. نتیجهٔ نامطمئن متوقف می‌شود تا با شواهد مستقل تطبیق داده شود؛ تکرار کور و اجرای خودکارِ دوباره وجود ندارد.

## Compatibility and real authority / سازگاری و اختیار واقعی

The frozen protocol currently accepts the literal grant owner `saeed` and model receipts with model identifier `gpt-6.1-sol`. These are explicit **compatibility restrictions**, not discovery of the logged-in Windows user, a SID authorization check, a portable multi-owner policy, or proof that this model was called. No model is started by importing this library. The published tests use synthetic replies and synthetic native/file ports.

پروتکل ثابت فعلی فقط مقدار `saeed` برای مالکِ مجوز و `gpt-6.1-sol` برای شناسهٔ رسید مدل می‌پذیرد. این‌ها محدودیت سازگاری‌اند؛ هویت واقعی کاربر ویندوز، بررسی SID یا سند فراخوانی واقعی مدل نیستند. عمومی‌کردن مالک‌ها یا مدل‌ها نیازمند نسخه و ممیزی تازه است. سورس ثابت برای ساخت بسته تغییر داده نشده است.

`createProjectRunner({ stateRoot, grant, modelPort, nativePort, filePort, reconcilePort, now })` is the exported integration API. `modelPort.plan` is required. The optional ports are **trusted integration code supplied by the application**, never model-provided functions or permission data. A command needs a qualified native executor. Native handle/SID proof, command-process ownership, hard resource enforcement, truthful model receipts and independent reconciliation must be established in those adapters before operational acceptance.

The library supplies no live model transport, Commander-host connector, operational Windows file broker, scheduler, autostart, installer, credentials, authorization grants, process supervisor or browser/chat recovery adapter. Source path checks are not an OS sandbox. The authorization hash is not a signature. A non-keyed hash chain detects corruption and unexpected changes but is not authentication against an actor who can rewrite the files and recompute hashes. Never publish real enrollment journals, model directories, grant files, locks, trace logs or installation receipts: they can contain private paths and project data.

رابط‌های واقعی مدل، اجرای پردازه، فایل و تطبیق نتیجه باید جداگانه و با اختیار معتبر ساخته و پذیرفته شوند. بررسی مسیر داخل این کتابخانه جایگزین محدودسازی ویندوز نیست. هشِ مجوز امضای دیجیتال نیست؛ زنجیره‌هش هم مانع دستکاری توسط کسی که اختیار بازنویسی همهٔ فایل‌ها را دارد نمی‌شود. تاریخچه و رسید واقعیِ پروژه را عمومی منتشر نکنید؛ ممکن است مسیر و اطلاعات خصوصی داشته باشند.

## Finite bounds / محدودیت‌های قطعی

The grant allows at most 64 model calls, 64 action attempts, a two-hour original wall deadline and 1 MiB action output. Each native action has an independently bounded timeout of at most 180 seconds and declared memory of 64–1024 MiB; the trusted executor must enforce these limits, not merely echo them. Text writes are at most 64 KiB. There are at most 64 catalog actions, 64 pins per input/source list and 32 file-hash acceptance checks. The journal is bounded to 1 MiB, 1024 events and bounded individual records; this is **finite working memory**, not unlimited long-term storage. The model context reports executor time, original deadline, reserved call and remaining budgets, immutable next-action scope and preflight hash evidence; it conveys no new execution authority.

بودجهٔ نهاییِ پروتکل حداکثر ۶۴ فراخوانی مدل، ۶۴ تلاش عملیات و مهلت اولیهٔ دو ساعت است. حافظهٔ تاریخچه نیز سقف ۱ مگابایت و ۱۰۲۴ رویداد دارد؛ نامحدود نیست. سقف‌های پردازه باید توسط اجراکنندهٔ واقعی اعمال شوند. توقف، لغو، پایان بودجه، فایلِ موجود، تغییر هش و عدم قطعیت باید حفظ شوند؛ بازکردن دوبارهٔ برنامه بودجه را صفر نمی‌کند.

## Evidence boundary / مرز شواهد

The included suite exercises 74 synthetic tests for finite catalog admission, persisted controls/budgets/deadlines, intent/receipt ordering, clean reopen, uncertainty, hash-chain/schema rejection, root/path aliases, create-only effects, independent file-hash acceptance and outbox behavior. Tests create new task-owned temporary fixtures and preserve them; they do not run a real model, native command, Windows file broker, Commander host, browser or installation. A successful test run proves only this source test scope.

`FINAL_ACCEPTED` is the runner's state for **one admitted grant and its exact file-hash checks**, not a product-release, production, or all-projects-final verdict. Real adapter integration, sustained operation, recovery after OS reboot/power loss, lock ownership reconciliation after a crash, unattended operation while chat is closed, background continuation and the ChatGPT retry/stream-recovery defect remain **UNPROVEN by this package**. No auto-promotion, auto-install, automatic stale-lock deletion, game, video, GUI input or browser-message sending is included.

A separate private Saeed integration has accepted a bounded five-step workflow with five real Sol calls and five actions across two independent execution episodes, preserving receipts, the original deadline and budgets without replay. Its Companion 1.1.0 package was installed independently with the previous companion retained for rollback; the core remained 0.10.6. That acceptance is specific to the private adapters and that bounded workflow. Those adapters, installer, owner authorization, trace and machine receipts are deliberately not distributed here. It does not establish an activated general daemon, unlimited autonomy, reboot recovery or browser retry repair, and it is not reproduced by this package's synthetic tests.

۷۴ آزمون همراه، مصنوعی‌اند و پذیرش عامل عملیاتی محسوب نمی‌شوند. وضعیت `FINAL_ACCEPTED` فقط پذیرش یک مجوز و خروجی‌های مشخص همان پروژه است، نه نهایی‌شدن کل محصول. اجرای بلندمدت، بازیابی پس از خاموشی یا راه‌اندازی مجدد، رفع قفلِ باقی‌مانده با تأیید مالک، ادامهٔ بدون چت و رفع retry صفحهٔ ChatGPT با این بسته **تأیید نشده‌اند**. راه‌اندازی خودکار، نصب، بازی، ویدئو، ورودی رابط ویندوز و ارسال پیام به مرورگر در این بسته وجود ندارند.

پذیرش جداگانهٔ اتصال خصوصی سعید، پنج گام محدود با پنج فراخوانی واقعی Sol و پنج عملیات را در دو نوبت مستقل، بدون تکرار و بدون صفرشدن بودجه یا مهلت، تأیید کرده است. همراه ۱٫۱٫۰ جداگانه نصب شده و همراه قبلی برای بازگشت حفظ شده؛ هسته همچنان ۰٫۱۰٫۶ است. این نتیجه مخصوص همان اتصال و کار محدود است. رابط‌های خصوصی، نصب‌کننده، مجوز مالک و رسید دستگاه عمومی نمی‌شوند. فعال‌شدن عامل عمومی، استقلال نامحدود، بازیابی ری‌استارت یا رفع retry از این نتیجه به دست نمی‌آید.

## Source-only checks / بررسیِ فقط سورس

Use Node.js 24 or newer. The Windows source candidate is checked with Node 24.19.0; other platforms need their own CI/runtime evidence. Run from this package directory:

```text
npm run check
npm test
```

There are no dependencies or install hooks. These commands perform syntax checks and the synthetic tests only. An unexpected failure is evidence: preserve its log, fixture and source hashes, stop, and investigate. Do not repeatedly rerun an uncertain operational action, reset a budget, delete a stale lock without ownership evidence, repair a torn journal, or replace an active Commander to make the test appear green.

Node نسخهٔ ۲۴ یا بالاتر لازم است. این بررسی‌ها فقط نگارش و آزمون مصنوعی را پوشش می‌دهند. شکست را با لاگ و هش حفظ کنید؛ برای سبزشدن آزمون، نسخهٔ فعال، قفلِ ناشناخته، تاریخچه یا بودجه را دستکاری نکنید. نصب و انتشار عمومی پس از پذیرش مستقل همان سورس و آماده‌بودن بازگشت، تصمیمی جداگانه هستند.
