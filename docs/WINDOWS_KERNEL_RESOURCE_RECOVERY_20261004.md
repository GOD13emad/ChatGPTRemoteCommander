# Windows kernel-resource recovery gate — 2026-10-04

Status: **CURRENT / OWNER-HOST GATE**

## Purpose

This runbook recovers Emad-PC from a kernel-resource state that makes Commander release qualification unreliable. It does not assume that wcifs is conclusively proven as the local root cause.

## Pre-recovery accepted evidence

- Commander live version: 0.10.8.
- v0.10.9 candidate-first promotion: blocked before cutover by qualification.
- System PID 4: ~3.326M handles; ~3.315M are File handles.
- Paged pool: ~23.1 GB; nonpaged pool: ~15.2 GB.
- wcifs: RUNNING, attached on C: and D:.
- Unattended Commander auto-update: PAUSED by `%LOCALAPPDATA%\ChatGPTRemoteCommander\maintenance\auto-update-paused.json`.
- No System handles were manually closed and wcifs was not unloaded.

## Recovery gate

1. **Owner action only:** perform a normal Windows restart when convenient. Commander must not auto-reboot/shutdown/logoff.
2. After login, before broad project/file scans, collect a fresh baseline:
   - System PID 4 handle count and handle-type summary.
   - paged/nonpaged pool bytes.
   - wcifs filter/service state.
   - OS build and wcifs.sys version.
3. Compare to this machine's fresh post-boot baseline. Do **not** use an invented universal handle-count threshold.
4. Confirm Commander v0.10.8 route, workflow DB, capability profile and tunnel health remain intact.
5. Keep unattended auto-update paused.
6. Run one exact candidate-first v0.10.9-or-newer qualification on the recovered host.
7. Promotion is allowed only if the exact candidate gates pass and route/config/workflow readback is healthy.
8. Remove `auto-update-paused.json` only after successful post-recovery qualification and live promotion/readback.
9. Keep `autoUpdate.sourceRef` absent for production stable-channel operation.

## STOP conditions

- System/File handle or kernel-pool counts immediately resume abnormal growth.
- process creation becomes intermittent.
- qualification reports inconsistent process-lifecycle failures.
- wcifs attribution remains under investigation and a proposed workaround requires unloading filters, closing System handles, disabling security/isolation features, or other system-wide destructive changes.

Any STOP condition returns the project to evidence collection; no blind rerun or auto-promotion.

## External evidence references

- Microsoft Sysinternals Handle: https://learn.microsoft.com/sysinternals/downloads/handle
- Microsoft Windows Containers issue #646: https://github.com/microsoft/Windows-Containers/issues/646
- Microsoft Windows Sandbox issue #126: https://github.com/microsoft/Windows-Sandbox/issues/126
