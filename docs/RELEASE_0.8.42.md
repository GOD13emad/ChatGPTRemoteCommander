# v0.8.42 qualification

Status: CANDIDATE, 2026-09-25.

v0.8.42 is the live-compatibility hotfix for immutable v0.8.41. It retains the v0.8.41 retry/connection controls: direct synchronous command paths remain bounded, large duplicate MCP rendering remains suppressed, final response size remains transport-bounded, and durable `operation_*` work remains the path for long commands.

The hotfix separates **configuration compatibility** from **effective execution time**. Project Engine provider timeout values that were valid in earlier releases (up to 600000 ms) remain loadable. Regardless of a larger persisted value, the effective planner process timeout is clamped to 30000 ms. This fixes the exact v0.8.41 live failure where a persisted `runner.provider.timeoutMs=120000` caused `PLANNER_INVALID_CONFIG` during candidate startup.

v0.8.41 failed safely: all repository gates passed, candidate health did not, no route was promoted, and both Windows production profiles remained on v0.8.37.

| Gate | Status |
| --- | --- |
| Focused planner compatibility suite | PASS — 27/27; legacy 120000 ms accepted, effective timeout 30000 ms |
| Full Windows `npm run check` | PASS — 156 PASS / 4 SKIP / 0 FAIL; GUI 75/75; integrity tails PASS |
| Full Windows `npm test` | PASS — 378 PASS / 5 SKIP / 0 FAIL; GUI 75/75; FS/runtime/source-integrity tails PASS |
| Repository security audit | PASS — SECURITY_AUDIT_PASS |
| Persisted-profile candidate startup / `NoPromote` | PENDING |
| Hosted Windows + Ubuntu CI | PENDING |
| Exact-tag Windows/Linux fresh + repeated acceptance | PENDING |
| Reproducible release assets | PENDING |
| Immutable GitHub publication | PENDING |
| Candidate-first live rollout + retry canary | PENDING |

Acceptance requires the same persisted Full Power runner profile that rejected v0.8.41 to produce a healthy v0.8.42 candidate before any live route promotion.
