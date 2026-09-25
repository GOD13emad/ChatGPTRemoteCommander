# v0.9.2 qualification

Status: CANDIDATE, 2026-09-25.

v0.9.2 is the installer-cleanup hotfix that supersedes the tagged but unpublished v0.9.1 hardening candidate. It preserves all v0.9.0 Project Engine parity behavior and all v0.9.1 acceptance hardening.

## Triggering live evidence

During the Windows candidate-first rollout of immutable v0.9.0, both configured profiles were successfully validated and switched to healthy v0.9.0 backends. The updater emitted `SAFE_UPDATE_PASS`, but the outer `install.ps1` later returned exit code 1 from its `finally` cleanup when the temporary updater tree had already disappeared. This was a false wrapper failure after a successful cutover, not a backend or route failure.

## v0.9.2 fix

- Temporary updater cleanup is idempotent: if the tree is already absent, cleanup succeeds.
- Cleanup remains fail-closed for real residual failures: if removal throws and the tree still exists, the error is rethrown.
- The candidate-first updater, route switch, Project Engine authority, browser behavior and retry/transport controls are unchanged.
- v0.9.1 Linux `--skip-tunnel-client` parity and browser-process test-race hardening are retained.

## Inherited capability behavior

- Canonical explicitly authorized Full Power installs/updates use the pinned private Codex CLI 0.156.1 provider and the bounded Project Engine runner.
- Standard authority, explicit `workflow.project_engine` opt-out and custom/no-start isolation remain fail-closed.
- Historical provider timeout values remain loadable while effective planner execution remains capped at 30000 ms.
- Automatic Project Engine execution applies only to explicitly enrolled project runs under the existing one-writer, budget, evidence and reconciliation controls.
- No live-state claim about Saeed's physical computer is used as release evidence; the parity requirement comes from the Work-created configuration observed on the accessible Emad Windows PC.

## Gates

| Gate | Status |
| --- | --- |
| Cleanup regression / installer contract | PENDING |
| Focused parity + recovery + v0.8.42 compatibility | PENDING |
| Windows full `npm run check` / `npm test` / `npm run audit` | PENDING |
| Linux full `npm run check` / `npm test` / `npm run audit` | PENDING |
| Hosted Windows + Ubuntu CI | PENDING |
| Exact-tag fresh + repeated installer acceptance | PENDING |
| Reproducible 13-asset release bundle | PENDING |
| Immutable GitHub publication | PENDING |
| Windows + Linux candidate-first live rollout and canaries | PENDING |

v0.9.0 remains an immutable published release. v0.9.1 remains a historical tagged candidate and is intentionally not moved.
