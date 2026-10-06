# Windows qualification output retention - R4

## Scope and authority

Base: `46655c5ae7d5504956959dfc7f2126fcc6824b6a` (v0.10.16).
This candidate changes only qualification diagnostic retention and its regression coverage. It does not alter the native Job Object runner, timeout, failure backoff, live routes, installer policy, immutable release, private Companion worker, or authentication boundaries.

## Observed failure

An unattended Windows qualification CHECK exited 1 on 2026-10-06. The lifecycle report survived, but gate stdout/stderr were not persisted. The exact failing assertion was therefore unavailable. A separately captured run against the unchanged release passed; the original failure's root cause remains unproven.

## Change

Run-Gate now assigns separate per-run stdout/stderr files before launching the existing owned runner, records their paths before execution, and records SHA-256 digests after completion. A nonzero exit still records qualification failure and throws, including the diagnostic paths. No result is converted into success and no retry is added.

## Verification

On native Windows, the corrected regression fixture first failed against the original gate and then passed against the patch: 4/4 focused checks. The complete updater contract suite passed 21 tests with 2 platform-specific skips, zero failures; these counts include the focused checks and are not additive. The repository security audit passed.

The first native fixture omitted owned-command-child.ps1. That fixture failure was preserved, the helper dependency was inspected and added, and diagnostic context was strengthened before the corrected before/after experiment. Production code was not relaxed to accommodate the test.

An earlier attempt was stopped before source mutation by the active-updater mutex. The subsequent attempt began after independent updater completion and mutex-release readback. Two live Windows profiles remained on v0.10.16 with unchanged route hashes throughout R4.

Private raw evidence archive SHA-256: `d843e1969fffb86009fe50564fdd00d28067a4c2a142b23b69d9068d40b01de8`.

## Open gates

Exact-head hosted CI and release/version integration remain required. This is focused source verification, not a new release or whole-product acceptance. Native Companion runtime integration, authenticated test-chat ACK/retry, visual acceptance, sustained recovery, and physical reboot/power-return are separate gates. Historical evidence and previously consumed runners must not be replayed.
