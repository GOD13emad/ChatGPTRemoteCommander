# Remote Commander v0.10.1

Date: 2026-09-29

## Scope

Maintenance hardening on top of the accepted v0.10.0 runtime. This release does not widen runtime authority, change tunnel/routing policy, enable new automatic execution, relax GUI/browser takeover rules, or modify Plugin permission boundaries.

The change set closes three product-finalization issues:
1. Windows BootRecovery diagnostics must preserve the exact self-test failure instead of collapsing an early failure into a generic timeout.
2. Durable workflow status must distinguish persisted nonterminal records from evidence of a live execution queue.
3. The inherited-stdio async-operation regression must prove the intended process-lifecycle property directly rather than depend on an arbitrary short CI timing window.

## Windows BootRecovery diagnostic hardening

During v0.10.0 SYSTEM-task activation, one initial BootRecovery probe produced no result within the existing bounded wait. Later production-equivalent SYSTEM probes passed, including LocalMachine credential readiness, and the official BootRecovery/UserSessionHandoff installation succeeded. The precise cause of the initial missing result was therefore not proven and is not asserted as a product root cause.

The diagnostic gap is real: if a self-test throws before writing SelfTestOutput, the installer can only report that no result appeared.

v0.10.1 improves that boundary without auto-repair:
- autostart-windows.ps1 -SelfTest catches profile/integrity exceptions and writes a structured result when SelfTestOutput is requested;
- failed structured self-tests keep ok=false and include the exact error text;
- enable-boot-recovery.ps1 reports BOOT_RECOVERY_SYSTEM_PROBE_FAIL error=<reason> for structured failures;
- when no result file appears, the installer reports task state and Task Scheduler LastTaskResult;
- integrity checks remain fail-closed and no profile/config mutation is introduced by diagnostics.

A Windows regression intentionally constructs a mismatched isolated-profile record/config hash and proves that the exact integrity failure is persisted instead of disappearing behind a timeout.

## Durable-state status semantics

Historical durable workflow records can remain in nonterminal lifecycle states even when no workflow root lease is active. Deleting or rewriting those records automatically would risk destroying project evidence.

v0.10.1 therefore makes the status surface explicit without mutating history:
- pending remains backward-compatible;
- persistedNonterminal is an explicit alias for the persisted enabled nonterminal count;
- pendingMeaning is PERSISTED_NONTERMINAL_RECORDS_NOT_LIVE_QUEUE;
- hasActiveLease reports whether the workflow scheduler currently owns at least one non-expired root lease.

This is an observability clarification, not a cleanup policy. Reconciliation/archive of historical records remains a separate evidence-preserving maintenance task.

## Async-operation CI determinism

The regression for a direct child exiting while a detached grandchild keeps inherited stdout/stderr open previously used a fixed 8-second completion window versus a 20-second holder lifetime. Hosted runner starvation produced intermittent false failures on docs-only branches.

v0.10.1 changes the test to assert the actual invariant:
- the fixture exposes the inherited-stdio holder PID;
- the holder remains alive for 60 seconds;
- the operation must reach SUCCEEDED while that holder PID is still alive;
- outputComplete must remain false and the direct-child stdout must be preserved;
- the test then terminates the holder explicitly.

This preserves the runtime requirement while removing dependence on an arbitrary short scheduling window. Production operation timeout semantics are unchanged.

## Acceptance

Required before publication:
- focused BootRecovery, workflow-store and async-operation regressions;
- repeated async inherited-stdio stress;
- complete npm run check;
- complete npm test;
- npm run audit;
- git diff --check;
- clean Linux exact-tree qualification;
- hosted Windows and Ubuntu CI;
- Windows/Linux server-install canaries;
- deterministic release-asset build/checksum verification;
- immutable tag/release publication;
- candidate-first live Windows/Linux rollout and exact version/commit/readiness readback.

## Boundaries

- Real Windows AtStartup behavior after an actual reboot/power-return remains a separate validation event; this release does not reboot the machine.
- Linux automatic project execution remains policy-disabled/unconfigured on the audited Linux host; v0.10.1 does not silently change that authority decision.
- Historical durable workflow/delivery records are not bulk-deleted in this release.
- Linux native browser dependency provisioning, fleet view, sandboxing, macOS and enterprise RBAC remain roadmap items rather than v0.10.1 blockers.
