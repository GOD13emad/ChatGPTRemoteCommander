# Current project state

Updated: 2026-09-25. Scope: public product/release status, not a live machine inventory.

## Release baseline

- [v0.8.41](RELEASE_0.8.41.md) is the latest immutable **published GitHub Release**, but its first candidate-first Windows production rollout was rejected before cutover because a persisted 120000 ms Project Engine provider timeout was no longer accepted. Production remained on v0.8.37.
- [v0.8.42](RELEASE_0.8.42.md) is the current hotfix release candidate. It preserves the 30 s effective planner bound while accepting historical configured timeout values.
- v0.8.38, v0.8.39 and v0.8.40 remain historical unpublished tags and are intentionally not moved.
- v0.8.41 package/CI/reproducible-asset qualification passed, but live compatibility validation found the provider-timeout migration defect and the updater failed closed with `CANDIDATE_HEALTH_TIMEOUT` before any route switch.
- v0.8.42 focused planner regression passes **27/27**, including legacy `120000 ms -> accepted / 30000 ms effective` behavior. Full Windows `npm run check` passes **156/4/0**, full `npm test` passes **378/5/0**, GUI **75/75**, integrity tails PASS, and repository security audit PASS. The exact persisted-profile `NoPromote` candidate-startup gate is PASS on commit `1d2308fb3873870e7bd47e394c8d96cffe74c28d` for both default and saeed-emad; both retain the historical 120000 ms provider timeout while v0.8.42 starts healthy. Production routes remained byte-identical to prestate and candidate listeners were cleaned.
- Focused durability evidence includes ten consecutive async runs (**80/80 PASS**), a later five-run set after stdio hardening (**45/45 PASS**), and a direct 30-operation race diagnostic (**30/30 PASS**).
- Milestones 4A, 4B.1 and 4B.2 remain released. The new `operation_*` layer is direct-session command durability; it does not widen Project Engine tool authority.

## CURRENT / open release gates

CURRENT: v0.8.42 live-compatibility hotfix qualification.

Open gates are v0.8.42 remote PR/hosted CI, exact-tag fresh/repeated installer acceptance, reproducible release assets, immutable publication, and a successful candidate-first Windows/Linux rollout. Publication or deployment is not claimed until those gates produce evidence.

## Remaining roadmap

Broader blocker escalation, monetary accounting, additional providers/integrations and equal-model/equal-budget project benchmarks remain open. The complete ambition of a universally superior project agent is **UNPROVEN**. A configured provider and explicit project enrollment are required for model-driven execution. Installation, service health, account authentication and task acceptance are separate checks. The release does not establish an OS sandbox or new autonomous browser authority.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.8.42 candidate](RELEASE_0.8.42.md), [v0.8.41 published/deployment-superseded](RELEASE_0.8.41.md), [v0.8.40 historical candidate](RELEASE_0.8.40.md), [v0.8.39 historical candidate](RELEASE_0.8.39.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md).

Historical checkpoints are preserved in the [archived project state](history/PROJECT_CONTROL_STATE_20260924.md). Their former “current”, “final” and “next action” labels are historical. Account bindings, machine paths, process inventories and operational receipts belong in private deployment handoffs rather than this public status page.
