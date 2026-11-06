# Commander One R80 — cumulative failure and prevention delta

Read this with the R78/R79 handoffs, current native registry and exact role manifests before continuing. This delta concerns Commander only. OCR, games, real-project contents and credentials are excluded. Source/fixture qualification is never owner/SYSTEM/runtime acceptance.

## Current authority and boundaries

Active Commander remains Saeed R75, 0.11.0-dev.23, commit51848ade674c7a6e3975fa28f88f882ee53058f0, backend48935 / canonical47831, FULL_POWER; Companion1.1.2 and SafeRecovery1.0 retained. Config SHAe07119d6589ac770cac161be078c86ebc3b4319b42e758b147a28cd18ffbaa09 and routing SHA2f66ccc1b152d19ae2f8f62ebd354b2cf3e07d84b7331b175ec5890943d7f636 remain anchors. Old GUI outcome stays UNKNOWN_NO_REPLAY.

R80 I created a separate protected no-project auth component under fixed ProgramFiles/ProgramData paths. Its SYSTEM task was absent at reconciliation, public client policy unpublished, whole product NOT_FINAL. H and I apply intents are consumed; neither may be rerun. Existing keys/journals/old prepared records must not be replaced, repaired or deleted to make a new install pass.

## Failure history

| ID / boundary | Confirmed cause and evidence | Prevention / regression / recovery |
| --- | --- | --- |
| F80-JOURNAL / source before install | Honest initial empty journals were rejected by the generic nonempty protected-file reader. Frozen fixtures did not exercise that complete file lifecycle. | Dedicated protected journal reader retains ACL/reparse/held-file/max-size checks; empty allowed only with exact initial marker/head/hash. Missing, truncated, noninitial-empty still fail.21 scoped cases; actual protected positive remains separate. |
| F80-RECEIPT-ACL / source before install | Native consent created receipt/event files with inherited ACL although consumer requires protected DACL. | Explicit BA/SYSTEM-only protected CreateNew + WriteThrough/fsync. No global ACL weakening. Frozen J is preserved/superseded. |
| F80-PARTIAL-ROLLBACK / source before install | Completed-enrollment-only inventory could not retire a partially registered task. | H introduced protected unique intent/preparation before Register; missing task is deactivated, only exact owned idle task may retire, active/unknown/changed stops.15 production-selector AST cases are source evidence, not actual Task Scheduler rollback. |
| F80-H-ANCESTOR / actual H exit2 before new roots | Literal ancestor guard rejects Windows TrustedInstaller DELETE_CHILD on existing ProgramFiles. Shared frozen WindowsGuard would also reject that OS ancestor in every role. Original H stderr was not captured, so its exact original inner code is UNOBSERVED; the deterministic source incompatibility is confirmed by actual read-only ACL inspection. | I/C share guard6ffd5e017ac734572d564ddf4268d02abbee9adecc4e0527081b0b5d0cc331e9. Exact TI is admitted only on existing exact OS ancestor paths; private object owner/write/confidential-read remain SY/BA. Actual OS ACL checks and hostile/private TI negatives pass. All five roles rebuilt/repinned and reviewed; no OS ACL changed. H no-root/no-task reconciliation a39409034242f9d99ed6fe07b75db977f1c2a659beadf5336be60d8857f692f4. |
| F80-H-REPORT-HIDDEN / own transaction UI | Start-Process Hidden startup state also hid the WinForms report. Own PID30932/form592228 was observed invisible. | Fresh I shows only its own form with SW_SHOW then checks native visibility before timer/preflight/UAC. Return value of ShowWindow is previous visibility, not success. I logged UI_VISIBLE and owner supplied screenshots. No GUI input acceptance is inferred. Completed hidden H report process alone was reaped after exact original handle/time/image/command checks. |
| F80-CLEANUP-TIME-TYPE / before any cleanup intent | PowerShell7 JSON converted ISO time to DateTime; formatted string comparison falsely reported changed process generation. | Read-only normalized UTC ticks matched639295448414857155; fresh cleanup B compared ticks. A stopped before intent/kill. B reaped only the completed own report; no task, issuer, project or descendant stop. |
| F80-I-TASK-XML / actual I partial stage | Native outcome reports TaskRegistration / TASK_HELPER_FAILED_RECONCILE_NO_RETRY. Source XML used ServiceAccount, an API enum value5, as an invalid XML LogonType. Exact original helper HRESULT is unobserved. Actual in-memory COM rejected the production-expression fixture with0x80041318; omitting the node was accepted and native Principal.LogonType stayed5/SYSTEM. | Preserve I state; no Apply retry. Use the actual COM/schema contract in preflight and test actual principal properties. Fresh staged-finalization must have new create-only intent/definition identity, exact I source/policy/image bindings, typed primary error, safe owned rollback and no key/journal regeneration. Evidence eeb4c17c9bb1f925c3c91b07664c45461a09163ad9b825e5462b2ddefd9de40f. |

## Recurrence and research hinge

These are distinct root causes, but share a broader coverage pattern: a fixture/source PASS does not cover the native protected lifecycle. Repetition requires primary/history research before another mutation. The finite audit reviewed old journal/receipt/rollback proofs and actual Windows ACLs, Microsoft WRP, Task Scheduler XSD and COM logon/registration semantics, plus ShowWindow startup behavior. Continue only with same-source native preflight and a phase-bound primary diagnostic; do not patch by repeatedly running the installer.

Primary sources:

- [Windows Resource Protection](https://learn.microsoft.com/en-us/windows/win32/wfp/about-windows-file-protection)
- [Task Scheduler schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema)
- [ITaskFolder RegisterTask](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-itaskfolder-registertask)
- [ShowWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow)

## Ready-path rule

Evidence → exact blocked phase → source-bound correction → native read-only regression → independent review → new explicit intent → owner UAC only if required → readback → actual no-project owner E2E. Then authenticated product execution/delivery, non-disruptive migration, same-source final installer, owner GUI/browser/endurance. No completed/uncertain operation is replayed. No source/package result closes these runtime gates automatically.
