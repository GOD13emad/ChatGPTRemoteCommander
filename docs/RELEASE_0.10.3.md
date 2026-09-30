# Remote Commander v0.10.3

Date: 2026-09-30

## Scope

Qualification-only maintenance on top of v0.10.2. Production runtime behavior, tool schemas, authority, routing, browser/GUI policy, durable workflow semantics, server bootstrap behavior and operation timeouts are unchanged from v0.10.2.

## Failure evidence

During candidate-first Windows rollout of v0.10.2 on HPC-154-66, the authoritative FULL_POWER retry reached the full test gate and produced one failure out of 499 tests. The failing subtest was `isolated profile server owns separate marker, private memory and conservative catalog`.

The failure occurred at the health-readiness assertion after 12.59 seconds. The spawned isolated server emitted its normal listening banner, but the test harness had already exhausted a fixed 200-iteration polling loop with a nominal approximately 10-second scheduling window.

Independent evidence does not support a runtime defect:
- the exact v0.10.2 test passed 10/10 isolated repetitions on the same Windows host, with subtest durations about 0.46–0.59 seconds;
- the same hosted Windows CI test passed in both qualification phases at about 0.54–0.55 seconds;
- v0.10.2 hosted Windows/Ubuntu CI, Windows Server bootstrap and clean-Linux canary were already successful.

## Correction

The isolated-profile HTTP regression now uses the same bounded startup pattern already accepted for the transport-correlation HTTP regression:
- a 30-second elapsed startup deadline instead of a fixed iteration count;
- immediate failure with child exit diagnostics if the server exits before becoming healthy;
- bounded health requests and explicit final diagnostic if the deadline expires.

This changes only test-harness readiness handling. It does not change production server startup, HTTP timeouts, runtime behavior or safety gates.

## Additional hosted-runner fixture hardening

On PR #79 exact head `8e72bed5dd8f42964e4d140af98e02307c67034d`, Windows CI and the server-install canary passed, while two independent Ubuntu pull-request CI attempts failed the same inherited-stdio regression after about 20 seconds. The exact same unpatched regression passed 20/20 isolated repetitions on the live Linux validation host, so the failures did not establish a production async-operation worker defect.

The fixture still had an unnecessary dependency on a `process.stdout.write(..., callback)` callback before the direct child exited. The candidate fixture now writes the tiny `parent-done` marker synchronously to fd 1 and exits immediately. The detached holder still keeps inherited stdout/stderr open, so the regression continues to prove the intended invariant: the operation reaches terminal success from direct-child `exit` without waiting for descendant-held stdio `close`.

This is test-only determinism hardening. `src/async-operations.mjs`, `tools/operation-worker.mjs`, production operation deadlines and output-drain behavior are unchanged.

## Focused regression

Before release preparation:
- patched Windows isolated-profile test: 10/10 PASS;
- patched Linux isolated-profile test: 3/3 PASS;
- inherited-stdio exact-head prepatch isolated Linux stress: 20/20 PASS;
- inherited-stdio deterministic-fixture stress: Linux 30/30 PASS and Windows 10/10 PASS;
- patched Linux complete local gate: `npm run check` 262 tests / 260 pass / 0 fail / 2 skip, `npm test` 499 tests / 497 pass / 0 fail / 2 skip, and `SECURITY_AUDIT_PASS`.

## Acceptance

Required before publication:
- complete Windows qualification check/test/audit;
- complete Linux qualification check/test/audit;
- hosted Windows and Ubuntu CI on the exact release candidate;
- Windows Server bootstrap and clean Ubuntu server-install canaries on the exact release candidate;
- immutable release assets and checksum verification;
- immutable v0.10.3 tag/release;
- candidate-first live Linux and Windows rollout with exact version/commit/authority/readiness readback.

## Rollout note

The first two v0.10.2 Windows rollout attempts rolled back cleanly to v0.10.1 at that point in the rollout. Subsequent fully qualified v0.10.2 publication and deployment completed successfully: the current accepted Windows and Linux production baseline is v0.10.2 at exact release commit `bc126ddf6351e107785096c1eec659cdf2982c1d`. v0.10.3 must preserve the authoritative active-route FULL_POWER profile and must not treat the earlier point-in-time v0.10.1 rollback state as current authority.
