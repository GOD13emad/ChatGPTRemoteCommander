# v0.9.0 qualification

Status: CANDIDATE, 2026-09-25.

v0.9.0 is the capability-parity milestone after the published immutable v0.8.41 transport/retry hardening release. Its single main mutation objective is to make explicitly authorized Full Power installations converge on the same bounded Project Engine runner behavior created through Saeed's ChatGPT Work account on the accessible Emad Windows PC, while preserving Standard authority, explicit opt-outs and fail-closed behavior. No live state from Saeed's own physical computer is used as release evidence.

## Confirmed pre-change evidence

- Both accessible Emad deployments were still executing v0.8.37 commit `09fcc485fd7ade82f7d8be25efc4f77ebc17e640` at the 2026-09-25 audit checkpoint.
- The Windows Full Power runtime had `durableWorkflows.runner.enabled=true`, `autoTick=true`, Codex CLI 0.156.1, bounded builder/reviewer proposal workers, adaptive extensions, durable artifacts and automatic enrolled-project execution.
- The Linux Full Power runtime had the same Codex CLI 0.156.1 binary installed under the private Commander state root but no runner configuration, so workflow recovery/readiness worked while automatic project execution remained disabled.
- Published v0.8.41 exists as an immutable GitHub Release with 13 assets and successful hosted Windows/Ubuntu CI. Its retry/deadline/response-envelope controls are retained.

## v0.9.0 design

- Full Power + explicit authority + durable workflows + qualified local provider => auto-configure the bounded Project Engine runner.
- Standard authority or explicit `workflow.project_engine` opt-out => runner disabled/fail-closed.
- Missing qualified provider => durable recovery remains enabled, but no autonomous execution is granted.
- Existing qualified runner configuration is preserved, except inherited provider timeout is clamped to the 30-second synchronous transport budget introduced in v0.8.41.
- Provider discovery is cross-platform and pinned to the qualified Codex CLI 0.156.1 layout already present on both audited Emad systems.
- Project Engine does not auto-enroll arbitrary projects. Automatic execution applies only to explicitly enrolled project runs under the existing one-writer, budget, evidence and reconciliation controls.

## Gates

| Gate | Status |
| --- | --- |
| Focused parity/unit regression | PASS — 7/7 initial runner tests; 27/27 combined runner + capability tests |
| Windows full `npm run check` | PENDING |
| Windows full `npm test` | PENDING |
| Repository security audit | PENDING |
| Independent Linux exact-commit check/test/audit | PENDING |
| Candidate config on actual Linux provider/state root reports runner AUTO_CONFIGURED | PENDING |
| Hosted Windows + Ubuntu CI | PENDING |
| Exact-tag installer/updater acceptance on Emad PC + Emad laptop | PENDING |
| Reproducible release bundle / immutable GitHub publication | PENDING |
| Post-rollout runtime/tunnel/operation canaries | PENDING |

Method benchmark: MCP 2026-07-28 Tasks defines durable/pollable/cancellable task handles for long-running work. ChatGPT Plugin negotiation/support remains separately qualified; v0.9.0 therefore retains the proven `operation_*` compatibility layer rather than removing it speculatively.
