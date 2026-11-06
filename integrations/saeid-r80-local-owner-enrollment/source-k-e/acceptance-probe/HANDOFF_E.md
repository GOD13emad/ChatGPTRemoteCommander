# R80 Probe E — current first-error/lifetime candidate

**PASS_PROBE_E_NATIVE_FIRST_ERROR_LIFECYCLE_PURE_PRIVACY_ONLY.** Current executable `G:/CodexWork/RC1R80FinalizeK/probe-e/native/CommanderOwnerAcceptance.exe`, SHA256 `8ad5986453bc5fda30a7aeaac96be06a87b11ff623c666dfafa3f780135baa92`, 4,179,968 bytes; NativeAOT CLR0/load2048/asInvoker. Authoritative receipt `qa-e/RECEIPT.json`; source admission `SOURCE_INPUT_MANIFEST_E.json`.

D is preserved. Parent source review identified that awaiting process exit before observing bounded readers could leave a writer blocked and turn the original output-bound error into a timeout. E observes stdin, stdout, stderr and process exit concurrently, propagates the completed operation's error immediately, cancels the shared deadline, reaps only the captured original child, and observes remaining tasks with a finite two-second drain. Cleanup uncertainty remains separate and cannot replace the primary error. The same D root/context factory and exact frozen I/C image/policy/crypto/role contracts remain unchanged; production CLI gains no fixture or arbitrary execution mode.

The [Microsoft WhenAll contract](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.whenall?view=net-10.0) requires all supplied tasks to finish. [WhenAny](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.whenany?view=net-10.0) identifies a completed task whose result/fault must then be observed; [WaitAsync](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.waitasync?view=net-10.0) bounds waiting but is not itself cleanup. E explicitly cancels its I/O and performs original-only cleanup rather than treating a canceled wait as termination.

Twenty-three pure crypto/privacy cases passed. Three real fresh ordinary NativeAOT own-child cases passed without any protected proxy/consent/task/key call:

| Case | Original PID / creation FILETIME | Observed primary / elapsed |
|---|---|---|
| Timeout | 31024 / 134384312860208446 | PROBE_OWN_CHILD_TIMEOUT_OUTCOME_UNKNOWN_NO_RETRY /1205ms |
| Output limit while input is blocked | 32160 /134384312872259657 | PROBE_CHILD_OUTPUT_BOUND /31ms |
| Normal stdin EOF completion | 34612 /134384312872574680 | COMPLETE /30ms |

All three captured held original identity, reconciled original exit, and completed readers. No foreign PID, process tree, SYSTEM issuer or project was stopped. Fixture input/output were synthetic bytes; no real token, key, private assertion or PKCE data was persisted/printed.

D's exact NativeSystemDrive/ChildStart function bytes are unchanged, so its two actual native known-folder controls remain applicable. E's conditional source-only fixture does not broaden the real CLI. Original C source, I consent/proxy hashes, policies, no-project scope, private-data paths, durable one-use marker semantics and ordinary/UAC separation remain unchanged.

Use E rather than D for the eventual actual probe, with the exact new self SHA. Production mode contract remains PROBE_CONTRACT_C.json: ordinary prepare, actual same-owner UAC approve-compose, ordinary verify; each real step once with no retry after uncertain effect. No real mode, UAC, protected authority read, key, client/host call or runtime OwnerProbe directory was performed/created by this child. Installed Commander and jobs remain unchanged. Parent owns review, K/probe execution, real owner acceptance, control, Return and publication.
