# Finite Commander Companion 1.0.0 — source-review snapshot

This is a separate companion component, **not Commander core 1.0.0**, not a public installer, and not general project autonomy. The repository's production core remains **0.10.8**. The recorded private installed companion acceptance used an unchanged **0.10.6** core; compatibility with 0.10.8 has **not** been accepted.

## What is included

- Eight byte-identical accepted library modules: finite planner admission, strict model/result contracts, Windows process-envelope validation, read-only status transport, core workflow adapter, and deterministic acceptance.
- The accepted Windows x64 Job guard's C++ source and CMake build definition. This manages the directly owned process tree; it is not an OS sandbox or a guarantee about externally brokered processes.
- Seven public test suites. Private core paths were replaced by a vendored **test-only** 0.10.6 fixture, exactly matching upstream commit `3546256e8e7c494d140bc9c33259ddbf345639d3`. The historical private model transcript was replaced by an explicitly synthetic fixture. These changes are tracked separately from the installed source.
- Redacted worker/deployment source under `review/`, stored as `.txt` for inspection only. **DO NOT RUN** these copies. They contain placeholders, not usable installation configuration, owner authority, or qualified manifests.
- Aggregate acceptance and source hashes, without raw account, machine, task, model-transcript, database, browser-profile or credential evidence.

## Recorded installed acceptance — limited scope

The installed companion took two real model proposals and executed two predeclared actions: read the enrolled host's status and write an exact proof file in a fresh owner-private root. It completed in 16.084 seconds. Independent readback checked seven workflow events, two operations and three SQLite databases. The same 226 distinct local regression tests passed before and after installation; ten real Windows native guard tests passed. A rollback canary disabled the superseded release before any model/host/file effect.

Those are **historical private acceptance results**, linked by receipt hashes in `ACCEPTANCE_SUMMARY.json`. They are not proof that this redacted public package is installable, or that arbitrary projects, reboot recovery, multi-hour execution, transient-window absence, or same-chat retry recovery work. The consumed qualification task is disabled. No recurring agent is enabled. Game/video execution remains paused. The whole project is **NOT_FINAL**.

## Safe, self-contained test command

Use Node 24 or later in this directory:

```text
npm test
```

No dependency installation, model invocation, account login, real Commander endpoint, active core import, task activation or desktop interaction is needed. Tests use synthetic model/native receipts, temporary test storage, a vendored workflow fixture and test-owned loopback HTTP servers. Database tests use fresh short test-owned temporary directories with a Windows path-length preflight; other artifacts stay under the ignored `test-artifacts/` directory. No registry or Windows long-path policy is changed. Passing this command proves the public test copy's contracts, **not real-agent or installed-runtime acceptance**.

## Native build — not installation

On Windows x64 with MSVC/Visual Studio 2022 Build Tools, Windows SDK and CMake 3.21 or later:

```text
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```

Building produces a new binary. Do not reuse the private accepted binary's hash for a new build. These commands do not enroll work, install a service, or start a model. Hosted native compilation is separate from the recorded ten native runtime tests.

## Continuation gates

Owner-scoped general action catalog → reconcile-safe resume → sustained/fault/reboot acceptance → supported real-browser integration → controlled installation with rollback → whole-product finalization. Every promotion needs its own source-bound evidence. Do not reactivate historical runners, grants, updater tasks or the cancelled heartbeat.

فارسی: این پوشه آخرین سورسِ قابل‌انتشارِ همراه نسخهٔ ۱٫۰٫۰ را حفظ می‌کند؛ هستهٔ رسمی را تغییر نمی‌دهد. کدهای نصب خصوصی عمداً به متنِ بازبینی‌شده تبدیل شده‌اند و قابل اجرا نیستند. آزمون‌ها از حساب، فایل‌ها و کارهای جاری شما استفاده نمی‌کنند. حافظه و اجرای محدود پذیرفته شده‌اند؛ ادامهٔ عمومی و بلندمدت و رفع retry همان چت هنوز اثبات نشده‌اند.

License: the repository's MIT license applies. The `fixtures/core-v0.10.6` code retains its upstream lineage and is test data, not an active runtime.
