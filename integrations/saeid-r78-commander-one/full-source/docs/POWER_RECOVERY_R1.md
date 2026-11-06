# Windows power-loss recovery — v0.9.4

Status: CANDIDATE — implementation complete, exact-build qualification and real post-power boot evidence required.

## Objective

After mains power returns and firmware powers the PC back on, the Remote Commander headless core must recover without interactive Windows logon, reopen the existing durable state, restore tunnels/routes, and resume only evidence-safe work. GUI/foreground actions remain user-session scoped.

## Architecture

1. Firmware: operator sets **Restore after AC Power Loss** to **Last State** (or Power On if always-on behavior is desired). Firmware mutation/reboot is not automated by Commander.
2. Windows boot: Scheduled Task **ChatGPTRemoteCommander-BootRecovery** runs as **SYSTEM**, ServiceAccount logon, AtStartup.
3. The boot core uses the existing owner profile paths explicitly so workflow databases, instance records, tunnel profiles and route state are not duplicated.
4. Tunnel credentials are copied from the existing CurrentUser DPAPI blobs only during an elevated owner-authorized installation, re-protected with Windows DPAPI **LocalMachine**, and stored as `*.machine.dpapi`. File ACL inheritance is disabled; only SYSTEM and BUILTIN\Administrators receive FullControl. Plaintext is never persisted.
5. A temporary SYSTEM self-test task must prove that every managed machine credential decrypts and the existing profile/route metadata loads before permanent startup tasks are registered.
6. At interactive owner logon, **ChatGPTRemoteCommander-UserSessionHandoff** waits until active operations/root leases are zero, then retires only SYSTEM-owned Commander boot-core processes. The normal HKCU launcher restores the core/tunnels in the user's session so GUI/native desktop functions remain session-correct.
7. If handoff finds active work, it exits with a bounded defer code and Task Scheduler retries rather than interrupting work.
8. Rollback is provided by `disable-boot-recovery.ps1`; it unregisters only the two boot-recovery tasks and optionally removes machine-scoped credential copies while preserving current-user credentials.

## Why not AutoAdminLogon or S4U

AutoAdminLogon is not used because it would weaken the Windows login boundary and is unnecessary. Task Scheduler S4U was rejected for the tunnel core because Microsoft documents that S4U tasks do not have network access and cannot access encrypted files. The selected SYSTEM + machine-protected credential design keeps pre-login networking available without storing a Windows password.

## Durable project envelope

For any multi-step project, persistent mutation, unknown-duration execution, or task expected to survive reboot/power loss, the Remote Commander skill requires creation/resume of a durable workflow before the first meaningful mutation. Project Brain remains enabled and meaningful phase boundaries use checkpoints/evidence. A RAM-only process is never represented as power-loss resumable. After boot, uncertain effects are reconciled before continuation; blind mutation replay remains disabled.

## Acceptance

- Windows and Linux exact candidate gates PASS.
- SYSTEM probe proves machine credential and owner-path resolution.
- Boot and handoff tasks are installed with intended principals/triggers and AutoAdminLogon remains disabled.
- No plaintext credential or Windows password is persisted.
- Cold-start behavior is exercised without reboot by the SYSTEM probe/start-task path.
- The next genuine power restoration provides real AtStartup evidence; cumulative 24h online soak begins only after the exact final build is installed.
