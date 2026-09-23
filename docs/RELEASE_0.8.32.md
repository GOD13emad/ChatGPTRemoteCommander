# v0.8.32 release qualification

Status: UNPUBLISHED / SUPERSEDED by v0.8.33, 2026-09-23. The tag and draft assets are retained as validation evidence; no public stable v0.8.32 release was published.

Exact candidate `f4f4546fa8cac0e87b0f75b4604208a3f3b378ef` passed Windows/Ubuntu CI run 35827442768, real-platform suites, candidate-only validation and fresh Windows/Linux installer checks. Windows custom no-start repeat installation preserved production state. All 13 draft asset digests matched downloaded bytes.

Publication was stopped when a duplicate Windows CI run exceeded the adaptive crash test's 12-second scenario budget, and Linux repeat-install review found that a custom existing no-start install unconditionally entered service promotion. v0.8.33 corrects both before publication. See [the current release record](RELEASE_0.8.33.md). The table below is the historical candidate gate plan, not current release authority.

The user authorized Windows/Linux finalization and GitHub publication. This release delivers roadmap milestones 2–4A: explicit project enrollment, durable planner/executor/verifier runs, adaptive prerequisites and bounded proposal teams. Milestone 4B (isolated executing workers, blocker escalation and currency accounting), additional qualified providers/integrations and comparative benchmarks remain planned.

## Boundaries

- Existing live projects are not enrolled automatically. The runner is disabled until explicitly configured; existing capabilities and credentials are preserved by the candidate-first updater.
- Native Windows/Linux GUI implementation is unchanged from v0.8.31. No desktop takeover is part of this release qualification. Record inherited interactive evidence separately from current no-input checks.
- Planner configuration is trusted operator configuration. Application-level controls and filesystem guards are not an OS sandbox.
- Acceptance checks support bounded file hashes, text inclusion and JSON values; they do not prove arbitrary project correctness.
- Earlier live Codex qualification covered the single-planner artifact flow. Parallel/adaptive fixture coverage does not by itself qualify every model or long-running project.

## Release gates

| Gate | Current evidence/status |
| --- | --- |
| Development baseline | Clean commit 1f98f0357a9d24e001b970b4d2b9a169e0061fe8; PR #5 |
| Windows Node 22 and 26 development | test/check/audit PASS; 292 core PASS + 1 privilege skip, 75 GUI contracts PASS |
| Final pinned candidate Windows | PENDING |
| Final pinned candidate Linux | PENDING |
| Native no-input / unchanged GUI identity | PENDING |
| Isolated installer / artifact manifests | PENDING |
| Candidate-only live validation | PENDING |
| Published immutable release and digests | PENDING |
| Windows profiles and Linux promotion, health, updater CURRENT | PENDING |

Hosted CI previously could not start because of an account billing lock; that is infrastructure status, not a code test result. Current run status must be recorded independently.

Live validation preserves terminal-bearing superseded backends and all active workloads. Any deferred cleanup is reported explicitly rather than forced. Source tests, running version, public assets and connector discovery are distinct evidence surfaces.
