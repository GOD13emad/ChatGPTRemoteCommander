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

## Focused regression

Before release preparation:
- patched Windows isolated-profile test: 10/10 PASS;
- patched Linux isolated-profile test: 3/3 PASS.

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

The first v0.10.2 Windows rollout attempt used stale base `config.local.json` authority and correctly failed schema continuity because the active routed runtime was actually FULL_POWER. The second attempt corrected authority to FULL_POWER; it then exposed the isolated-profile test startup flake described above. Both attempts rolled back cleanly to the live v0.10.1 Windows route. v0.10.3 must preserve the authoritative active-route FULL_POWER profile during Windows rollout.
