# v0.9.1 qualification

Status: CANDIDATE, 2026-09-25.

v0.9.1 is a release-hardening follow-up to the unpublished v0.9.0 candidate. It preserves the v0.9.0 Full Power Project Engine parity design and adds two acceptance fixes discovered only during exact-tag fresh/repeated qualification:
- Linux now supports `--skip-tunnel-client`, matching Windows semantics: reuse an existing pinned client when present, otherwise skip the network download explicitly.
- The Windows browser-process forced-shutdown regression attaches its rejection handler immediately, eliminating a test-only unhandled-rejection race under heavy installer validation load without changing runtime timeout behavior.

v0.9.1 is the capability-parity milestone after the published immutable v0.8.42 live-compatibility release, which carries the v0.8.41 transport/retry hardening. Its single main mutation objective is to make explicitly authorized Full Power installations converge on the same bounded Project Engine runner behavior created through Saeed's ChatGPT Work account on the accessible Emad Windows PC, while preserving Standard authority, explicit opt-outs and fail-closed behavior. No live state from Saeed's own physical computer is used as release evidence.

## Inherited parity evidence

- Both accessible Emad deployments were still executing v0.8.37 commit `09fcc485fd7ade82f7d8be25efc4f77ebc17e640` at the 2026-09-25 audit checkpoint.
- The Windows Full Power runtime had `durableWorkflows.runner.enabled=true`, `autoTick=true`, Codex CLI 0.156.1, bounded builder/reviewer proposal workers, adaptive extensions, durable artifacts and automatic enrolled-project execution.
- The Linux Full Power runtime had the same Codex CLI 0.156.1 binary installed under the private Commander state root but no runner configuration, so workflow recovery/readiness worked while automatic project execution remained disabled.
- Published v0.8.42 is the immutable live-compatibility baseline. It carries the v0.8.41 retry/deadline/response-envelope controls and restores acceptance of historical provider timeout configuration while keeping effective execution at 30 seconds.

## v0.9.1 design

- Canonical Full Power + explicit authority + durable workflows => ensure the pinned private Codex CLI 0.156.1 provider exists, then auto-configure the bounded Project Engine runner.
- Standard authority or explicit `workflow.project_engine` opt-out => runner disabled/fail-closed.
- Provider bootstrap or qualification failure fails closed before Project Engine activation; durable recovery remains available where already configured.
- Existing qualified runner configuration is preserved, except inherited provider timeout is clamped to the 30-second synchronous transport budget introduced in v0.8.41.
- Provider discovery is cross-platform and pinned to the qualified Codex CLI 0.156.1 layout already present on both audited Emad systems.
- Project Engine does not auto-enroll arbitrary projects. Automatic execution applies only to explicitly enrolled project runs under the existing one-writer, budget, evidence and reconciliation controls.

## Gates

| Gate | Status |
| --- | --- |
| Focused parity/unit regression | PASS — 7/7 initial runner tests; 27/27 combined runner + capability tests |
| Windows full `npm run check` | PASS — core 164/168 with 4 expected skips; GUI 75/75; filesystem/runtime/source-integrity tails PASS |
| Windows full `npm test` | PASS — core 385/390 with 5 expected skips; GUI 75/75; filesystem/runtime/source-integrity tails PASS |
| Repository security audit | PASS on both Windows and Linux candidate trees |
| Independent Linux exact-commit check/test/audit | PASS on the converged candidate line — check core 167/168 with 1 expected skip; test core 389/390 with 1 expected skip; GUI 75/75 |
| Candidate config on actual Windows and Linux provider/state roots | PASS — Full Power, `workflow.project_engine`, runner/autoTick=true, Codex 0.156.1, effective timeout 30000 ms |
| Hosted Windows + Ubuntu CI | PENDING for v0.9.1 |
| Exact-tag installer/updater acceptance on Emad PC + Emad laptop | PENDING for v0.9.1; v0.9.0 fresh Windows passed, repeat exposed a test race; Linux fresh exposed mandatory tunnel download timeout |
| Reproducible release bundle / immutable GitHub publication | PENDING for v0.9.1 |
| Post-rollout runtime/tunnel/operation canaries | PENDING for v0.9.1 |

Method benchmark: MCP 2026-07-28 Tasks defines durable/pollable/cancellable task handles for long-running work. ChatGPT Plugin negotiation/support remains separately qualified; v0.9.1 therefore retains the proven `operation_*` compatibility layer rather than removing it speculatively.
