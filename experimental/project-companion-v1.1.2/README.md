# Finite Project Companion 1.1.2 — public source only

This version adds read-only scheduling admission to the exact finite project runner. `inspectProjectState({stateRoot, grant})` validates the original grant, directory identities and hash-chained journal without creating a lock, enrolling a project, invoking a model or replaying an effect. A live or abandoned owner lock blocks automatic admission. Pending intents report reconciliation; final, paused, cancelled, blocked and budget-stopped projects do not become new execution authority.

The original BigInt/uint64 identity schema, finite original deadlines, create-only outputs, immutable catalogs, durable intent/receipt budgets and no-blind-retry rules remain. The source/test files are byte-identical to the corresponding privately qualified 1.1.2 modules. No legacy journal migration or stale-lock deletion is provided.

Use Node.js 24+: `npm test`. Exactly 94 synthetic tests run: the 88 prior contracts and six new read-only scheduling regressions. The source-only checker validates pins before and after, preserves logs and does not retry failed phases. These tests invoke no real model, host, native adapter, installer, GUI or browser.

Separate private Windows acceptance on the owner's authorized machine established: core 0.10.8 installed; companion 1.1.2 installed; 118 combined code tests; source and same-installed-module native two-step clean reopen; and an enabled hidden Windows scheduled task completing a fresh explicitly registered two-step project across two processes about 65 seconds apart. Each project used two bounded existing-model proposals and two actions. These machine-specific receipts, account identifiers, grants, native executors, local adapters, launcher, service registry and installers are intentionally NOT published here.

The private activation wrapper reported a post-registration literal-name-versus-SID verification failure. The original failure was preserved. Read-only reconciliation matched the exact actual SID, actions, triggers and payload pins without registering or replaying the task. Installation is not inferred from a public release or from FULL_POWER.

The public package is NOT the private operational installation and cannot autonomously run projects by itself. Integration ports remain trusted separately qualified application code, not model-generated authority. The literal owner/model identifiers in the portable protocol are compatibility constraints, not OS authentication. Non-keyed hashes do not defend against an actor with permission to rewrite all state. Path checks are not an OS sandbox.

`FINAL_ACCEPTED` applies only to one admitted grant and its exact output checks. Arbitrary-project autonomy, sustained long runs, abrupt-crash/OS reboot recovery, browser acknowledgements and repair of ChatGPT's retry/stream-recovery UI remain UNPROVEN. No new API, model, credentials, private-chat reading, game/video activation or canceled heartbeat is included. No core code or active deployment is changed by publishing this folder.

## فارسی

۱٫۱٫۲ نسخهٔ «همراه» است؛ ۰٫۱۰٫۸ نسخهٔ هستهٔ Commander. این پوشه فقط سورس عمومی کتابخانه و ۹۴ آزمون مصنوعی است، نه نصب‌کننده یا عامل نامحدود. قابلیت جدید، خواندن امن وضعیت پروژه برای تصمیم دربارهٔ ادامهٔ زمان‌بندی‌شده است؛ بررسی وضعیت هیچ مدل یا عملیات تازه‌ای اجرا نمی‌کند. کار تمام‌شده، متوقف‌شده یا نامطمئن خودکار تکرار نمی‌شود و بودجهٔ قبلی از نو شروع نمی‌شود.

نصب و اجرای محدود واقعی ویندوز جداگانه بررسی شده، اما تنظیمات خصوصی و مجوز پروژه‌ها اینجا منتشر نشده‌اند. سرویس خصوصی فقط پروژه‌های صریحاً ثبت‌شده با گام‌ها، سقف‌ها و خروجی ثابت را اجرا می‌کند؛ پس از اتمام منتظر کار تازه می‌ماند. روشن‌بودن آن به معنی راه‌اندازی پروژه‌های قدیمی، رفع retry چت، پذیرش اجرای نامحدود یا قبولی ری‌استارت نیست.
