# Finite Project Companion 1.1.1 — source candidate / کاندید سورس

This is a self-contained JavaScript library candidate, not an installed service, unrestricted agent, or browser recovery product. **1.1.1 is the Companion source package version**, not the Remote Commander core version. Publishing these files does not install or upgrade a running Commander. `private: true` prevents accidental npm publication; GitHub review is separate. The three runtime/test files are byte-identical to the frozen R8 candidate.

این بسته کتابخانهٔ مستقل سورس است، نه سرویس نصب‌شده یا عامل نامحدود. **۱٫۱٫۱ شمارهٔ همراه است**، نه هستهٔ Commander. انتشار فایل‌ها به معنی نصب، فعال‌کردن یا ارتقای برنامهٔ فعال نیست. نصب‌کننده، اتصال خصوصی، مجوز واقعی مالک و رسید دستگاه در این بسته نیستند.

## Important upgrade boundary / مرز مهم ارتقا

**Companion 1.1.0 is superseded: `DO_NOT_ACTIVATE — NTFS64_UNSAFE`.** A private installed-package acceptance attempt failed **before the first model call or project action** when an NTFS file identity exceeded JavaScript's safe integer range. Earlier scratch-folder acceptance did not establish correctness of the installed target's identity handling. The failed attempt and older public source remain historical evidence, not an operational release to retry.

R8 reads security-sensitive filesystem identities directly from original BigInt stats and persists `dev` and `ino` as **canonical unsigned 64-bit decimal strings**, including values above 2^53. It never attempts to recover lost low bits from a JavaScript Number. IDs, links, nanosecond timestamps, size bounds, paths, held descriptors and named-file identity are checked without weakening existing guards. Windows test fixtures start from `fs.realpathSync.native(os.tmpdir())`; only fixtures are canonicalized, not an untrusted production alias.

This is a **fresh-project/fresh-state schema only**. Numeric legacy identities are rejected with `CATALOG_LEGACY_NUMERIC_IDENTITY`; malformed or out-of-range strings are also rejected. There is **no migration, numeric-to-string repair, journal rewrite, budget reset, lock deletion or action replay**. Preserve old journals and uncertain receipts for independent reconciliation. Do not point the new runner at a 1.1.0 enrollment or activate the old package to bypass this boundary. Operational installation/activation requires a separately qualified adapter, new explicit grant and documented rollback.

**همراه ۱٫۱٫۰ کنار گذاشته شده و نباید فعال شود.** آزمون بستهٔ نصب‌شده، پیش از اولین فراخوانی مدل و عملیات پروژه، به‌علت شناسهٔ بزرگ فایل در NTFS شکست خورد. آزمون قبلی در پوشهٔ موقت این مشکلِ مسیر نصب را پوشش نداده بود. نسخهٔ ۱٫۱٫۱ شناسه را مستقیماً با دقت کامل می‌خواند و به شکل رشتهٔ ده‌دهیِ دقیق ذخیره می‌کند. تاریخچهٔ عددی قدیمی متوقف می‌شود؛ تبدیل خودکار، تعمیر تاریخچه و تکرار عملیات وجود ندارد. این نسخه فقط برای پروژه و وضعیت تازه با مجوز صریح تازه است؛ اطلاعات و شکست قبلی را حفظ کنید.

## What it does / چه کاری انجام می‌دهد

- An immutable explicit grant fixes the project root, input/source hashes, exact ordered action catalog, budgets and acceptance checks before execution. The model can only return `CONTINUE_STEP` or `STOP` for the next catalog step; it cannot invent tools or expand permission.
- Four catalog kinds are admitted: `read_text`, `search_files`, `write_text` and `run_project_command`. Search is a bounded substring search **inside one registered pinned text file**, not a disk crawler. Writes create new owned outputs with exact bytes; existing files are not overwritten. Commands require an exact image hash, argv, cwd, registered source pins and finite limits.
- Local `HISTORY.jsonl` stores enrollment, intents, receipts, controls, checkpoints, reconciliation and outbox acknowledgements in a sequential SHA-256 chain. Model/action counts and the original deadline survive supported clean reopen; reopening does not grant fresh budget.
- Intent is durable before an external call/effect. Confirmed receipts can resume without repeating the confirmed decision. Uncertainty becomes `RECONCILIATION_REQUIRED`; there is no blind retry or automatic replay.
- `pause`, `resume`, `cancel`, `STOP`, budget exhaustion, identity drift and input/output drift are durable boundaries. Polling a stopped or uncertain task does not restart it.

مجوز ثابت، پوشه و هش‌ها و فهرست گام‌ها و بودجه را تعیین می‌کند. مدل فقط دربارهٔ اجرای همان گام بعدی یا توقف تصمیم می‌گیرد. حافظهٔ هارد قصد اجرا، رسیدها و تاریخچهٔ زنجیره‌هش را حفظ می‌کند. نتیجهٔ نامطمئن برای تطبیق مستقل متوقف می‌شود؛ بازکردن دوبارهٔ پروژه بودجه یا زمان را از نو شروع نمی‌کند. نوشتن فقط ایجاد فایل تازه است، نه بازنویسی فایل موجود.

## Integration and authority / اتصال و اختیار واقعی

The frozen protocol currently accepts literal grant owner `saeed` and model-receipt identifier `gpt-6.1-sol`. These are **compatibility restrictions**, not detection of the OS user, SID authorization, a multi-owner policy or proof of a real model call. No model starts on import. Tests supply synthetic replies and native/file ports.

`createProjectRunner({ stateRoot, grant, modelPort, nativePort, filePort, reconcilePort, now })` is the integration API. `modelPort.plan` is required. Optional ports are **trusted application integration code**, never model-provided functions or permission data. A real command requires a separately qualified native executor. Real handle/SID ownership, strict resource enforcement, truthful receipts and independent reconciliation must be established by the adapters.

There is no live model transport, Commander connector, operational Windows file broker, scheduler, autostart, installer, credentials, authorization grants, supervisor or browser/chat recovery adapter in this package. Path checks are not an OS sandbox. The authorization hash is not a signature. A non-keyed hash chain detects corruption but does not authenticate against an actor who can rewrite all files and recompute hashes. Never publish real grants, enrollment journals, model directories, locks, traces or installation receipts.

مقادیر ثابت مالک و مدل، محدودیت سازگاری هستند؛ هویت واقعی ویندوز یا سند اجرای مدل نیستند. رابط عملیاتی باید اختیار معتبر، مالکیت پردازه و فایل، محدودیت منابع و رسید درست را جداگانه ثابت کند. بررسی مسیر جایگزین محدودسازی سیستم‌عامل نیست. هش مجوز امضای دیجیتال نیست و زنجیره‌هش هم جلوی کسی را که اختیار بازنویسی همهٔ فایل‌ها دارد نمی‌گیرد. اطلاعات واقعی پروژه و مجوز و رسید خصوصی را عمومی منتشر نکنید.

## Finite bounds / سقف‌های قطعی

At most 64 model calls, 64 action attempts, a two-hour original wall deadline and 1 MiB action output are admitted. Each native action has a timeout of at most 180 seconds and declared memory of 64–1024 MiB; the trusted executor must actually enforce these bounds. Text writes are at most 64 KiB. Catalog actions and each input/source pin list are limited to 64; acceptance checks to 32. The journal is limited to 1 MiB and 1024 events with bounded records. This is **finite working memory**, not unlimited long-term storage. Model context exposes the original deadline, remaining budgets and immutable next-step scope, not new authority.

حداکثر پروتکل ۶۴ فراخوانی مدل، ۶۴ تلاش عملیات و مهلت اولیهٔ دو ساعت است. تاریخچه حداکثر ۱ مگابایت و ۱۰۲۴ رویداد دارد؛ نامحدود نیست. اجراکنندهٔ واقعی باید سقف زمان و حافظه را اعمال کند. توقف، لغو، پایان بودجه و عدم قطعیت را نمی‌توان با راه‌اندازی دوباره نادیده گرفت.

## Evidence boundary / مرز شواهد

The included **88 synthetic tests** cover finite catalog admission, durable budgets/controls/deadlines, intent/receipt ordering, clean reopen, uncertainty, hash-chain/schema rejection, aliases, create-only effects, acceptance and outbox behavior. Fourteen R8 regressions add exact high-ID persistence/drift, strict uint64 string schema, rejection of legacy numeric journals without rewriting bytes, BigInt-only security stats and unchanged link/path guards. Tests create and retain fresh task-owned temporary fixtures; they do not invoke a real model, native command, live host, operational file broker, browser or installer. A passed suite proves only this source scope.

`FINAL_ACCEPTED` means **one admitted grant and its exact file-hash checks**, not a product release or all-projects-final verdict. Real adapter integration of 1.1.1, installed-target acceptance, sustained general execution, OS reboot/power-loss recovery, crash-lock reconciliation, chat-closed continuation and ChatGPT retry/stream-recovery repair remain **UNPROVEN by this public package**. No automatic promotion/install, stale-lock deletion, game/video activation, GUI input or browser-message sending is included. The Commander core is not changed.

۸۸ آزمون این بسته مصنوعی‌اند؛ ۱۴ آزمون تازه به دقت شناسه‌های بزرگ و رد تاریخچهٔ عددی و حفظ محافظ‌ها مربوط‌اند. قبولی آن‌ها عامل عملیاتی، نصب موفق یا رفع retry را ثابت نمی‌کند. `FINAL_ACCEPTED` فقط پذیرش همان پروژه و خروجی‌های دقیقش است. اجرای بلندمدت عمومی، بازیابی خاموشی/ری‌استارت، ادامه بدون چت و تعمیر صفحهٔ ChatGPT هنوز با این بسته تأیید نمی‌شوند. بازی و ویدئو، نصب و راه‌اندازی خودکار و ارسال پیام مرورگر در بسته نیستند.

## Source-only checks / بررسی فقط سورس

Use Node.js 24 or newer. From this directory:

```text
npm test
```

`ci-source.mjs` pins all three frozen source/test hashes and exact byte lengths, checks syntax, runs exactly 88 synthetic tests with direct Node (no shell), and verifies hashes again. It creates one new bounded audit directory in canonical temporary storage, retains raw logs and its receipt, and never retries a failed phase. Dependencies and install hooks are absent. `npm run check` provides parser checks only. Windows source checks and Linux CI are separate evidence; a workflow definition alone proves no platform pass.

Preserve unexpected errors, raw logs, fixtures and hashes; stop and investigate. Do not repair an uncertain journal, reset a budget, delete a stale lock, rerun an external action or replace an active Commander to make a check green. Operational installation and public publication remain independent acceptance decisions.

بررسی سورس فقط نگارش و ۸۸ آزمون مصنوعی را اجرا می‌کند؛ هش سه فایل قبل و بعد کنترل می‌شود. شکست و لاگ حفظ می‌شوند و مرحلهٔ شکست‌خورده خودکار تکرار نمی‌شود. فایل‌های آزمون موقت حذف خودکار ندارند. تعریف CI به معنی قبولی ویندوز یا لینوکس نیست؛ هر محیط باید شواهد اجرای واقعی خودش را داشته باشد.
