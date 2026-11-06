# R80 staged finalization J — variant B

Current result: **PASS_SCOPED_SOURCE_NATIVE_AND_MEMORY_COM_ONLY**. This is a finite new finalization implementation for the already-created, exact I no-project enrollment. It is not installation acceptance, actual Task Scheduler registration, a real owner login, an operational project grant, or whole-product final acceptance.

## Current artifact and qualification

- Current executable: `G:/CodexWork/RC1R80FinalizeJ/native-b/CommanderOwnerFinalizeJ.exe`.
- SHA256: `17adf7dad322a21d315bca6941c034b257cacae94205a3e843cc749d1bace574`; 4,116,992 bytes; NativeAOT CLR directory zero, dependent-load flags 0x800, asInvoker/uiAccess=false.
- Authoritative source qualification: `qa-b/RECEIPT.json`. Nineteen native cases and twenty actual in-memory COM / partial rollback cases passed. Ordinary finalize and rollback modes refused before protected stage access.
- Two actual newly-created, ordinary fixed WindowsPowerShell helper fixtures proved finite timeout/output-bound behavior and original-only cleanup. Timeout PID 19448 / creation FILETIME 134384280223101762 completed in 1213 ms; output-bound PID 24996 / FILETIME 134384280235246659 completed in 184 ms. Both had captured held identity, original reaped, readers completed, cleanup uncertainty false. No task, key, installed state or other job was accessed by those fixtures.
- The corrected XML was assigned only to a new in-memory `Schedule.Service.NewTask(0)` object. Native SYSTEM identity and LogonType 5 were observed. The historical invalid ServiceAccount XML was independently rejected with HRESULT 0x80041318; this does not recover the original I inner error.
- Qualification verified 687 existing shared compiler-package files; no new dependencies downloaded or full source/cache copies made.

## Exact next-action contract (parent only)

`CommanderOwnerFinalizeJ.exe --finalize-staged <ownerSid> <expectedJExeSha256>`

`CommanderOwnerFinalizeJ.exe --rollback-finalized <ownerSid> <expectedJExeSha256>`

Exactly three arguments; no runtime path, task-name, command, key, policy, scope, image, duration, or executable-selection option. Parent must hold and pin the exact executable before its separate reviewed owner UAC action. The ordinary `--diagnose` mode opens only its own token, never protected authority inputs. This child did not execute either privileged mode.

New finalizer result: protected state-root `finalization-j.outcome.json`, schema `RC_OWNER_J_OUTCOME_V1`, status COMPLETE or FAILED_NO_RETRY, with fixed code, phase, signed/hex HRESULT, sanitized exception type, cleanup uncertainty and no-retry flag. Parent must require **exit 0 plus matching new COMPLETE outcome and completion receipt**, then independently reconcile task and client policy. Missing outcome is UNKNOWN_RECONCILE, never success. An elevated failure that cannot persist an owned new outcome presents a fixed Persian native message box containing only code/phase/HRESULT; ordinary denial does not open a dialog.

Rollback uses separate `finalization-j.rollback.complete.json` / `finalization-j.rollback.outcome.json`. It removes only the exact J task after matching protected J ownership evidence, task definition, native SYSTEM/logon5 and exact canonical binary SDDL, with idle/disabled selector and zero instances rechecked immediately before deletion. A task whose XML settings no longer match the admitted enabled definition remains rejected even if its numeric state is disabled. Absent task is already deactivated. Active, queued, changed or uncertain task is STOP; there is no stop/disable/restart action and no process-tree search.

## Immutable inputs and one-use order

Only exact existing I protected **public** inputs and five native images are read/held and hash revalidated. I bundle SHA is `9fd7df9632ce75d4bb6ec873f97b0c37dafb11f05724f58baa62f0f3ecf593ec`; native host I is 310e...cbd26, consent I b5ff...c4020, client C 166d...47905, bootstrap I 318f...195212, with full hashes in source/contracts. Original I outcome SHA 2b7f...5103 and original old script/prepared/registration bindings are exact. Old task-preparation bytes are reconstructed using the preserved historical generator and checked, never rewritten. Existing enrollment epoch and public key policy bindings are preserved. Private `.pk8` files and mutable journals/heads are never opened, reset, regenerated or copied.

Finalization order is: actual same-owner high token -> held exact reviewed J image -> held exact I public state/images -> absent own J targets/client policy -> new create-only J intent and protected fixed script -> read-only task-absence inspection -> new prepared and registration intent -> create-only task flags18 -> actual task/native/SDDL/readback and zero instances -> new attestation -> publish fixed selftest client-policy -> new completion/outcome. All privileged writes target fixed protected ProgramFiles/ProgramData paths. No elevated output is written to G.

Created J names: `finalization-j.intent.json`, `finalization-j.ps1`, `task-j.prepared.json`, `task-j.registration.intent.json`, `task-j.attested.json`, `finalization-j.complete.json`, `finalization-j.outcome.json`. Recovery may create only its separate fixed `finalization-j-rollback-helper.ps1` plus rollback receipts. All creation is exclusive, protected BA/SYSTEM-write + owner-read; no overwrite repair. Failure after any create is consumed and requires reconciliation; never replay the finalizer.

Task action remains the pinned protected I issuer `--serve-once`, SYSTEM, on-demand, no triggers, IgnoreNew, no scheduler hard termination/restart. J never starts the task. Public client policy remains exactly **no-project selftest only**, not full access or project login.

## Failure learning and preserved baselines

I failed after separate protected staging because the task XML generator used an invalid `ServiceAccount` XML value. J omits that XML node and verifies the native COM enum5 instead. I error, keys, policies, images, zero journal files, and installed R75 Commander remain preserved. H/I apply actions are consumed: DO NOT RUN.

Variant A passed its initial bounded tests, but parent source review identified a material lifecycle defect: canceled process-exit waiting under `WhenAll` could still await uncancelled pipe readers indefinitely. A is preserved in `frozen-a`, original `qa`, and `G:/CodexWork/RC1R80FinalizeJ/native`; it is **SUPERSEDED — DO NOT USE FOR UAC**. B cancels both reads, observes the first completion/fault with a finite orchestration deadline, preserves the primary code/HRESULT, reaps only the captured original helper, and bounds canceled-reader observation. Real harmless own-child regression now covers both timeout and output bound. No original I/J action was retried.

## Remaining gates

Source/native qualification B -> **parent independent review ← here** -> one fresh reviewed J owner UAC finalization -> real task/client-policy reconciliation -> ordinary prepare + actual owner consent + ordinary complete/exchange/state probe -> product local-login adapter and separately admitted operational profile -> rollback-ready integrated install and final acceptance.

Actual protected write ACL-positive execution, task SDDL readback/OS normalization, actual registration permission and real login E2E remain UNPROVEN. SDDL comparison is deliberately exact canonical binary equality; no new generic-access-mask normalization or authority relaxation was admitted. A different actual readback must be reconciled as a typed failure before any revision.

No installed Commander config, core, active project job, original command, browser profile, model, private chat, support case, GitHub state or old protected record was modified by this child. Parent owns delivery/Return ZIP/publication and any actual owner UAC.
