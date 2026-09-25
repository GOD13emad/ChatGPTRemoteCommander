# Current project state

Updated: 2026-09-25. Scope: public product/release status, not a live machine inventory.

## Release baseline

- [v0.8.37](RELEASE_0.8.37.md) remains the latest immutable **published GitHub Release** at this checkpoint.
- [v0.8.41](RELEASE_0.8.41.md) is the current release candidate. It supersedes the unpublished v0.8.40 tag and adds response-deadline/size hardening on top of durable background commands.
- v0.8.38, v0.8.39 and v0.8.40 remain historical unpublished tags and are intentionally not moved.
- Current v0.8.41 Windows qualification passed full `npm test` (**377 PASS / 5 SKIP / 0 FAIL**) with all browser/concurrency/GUI/filesystem/runtime/source-integrity tails PASS, and full `npm run check` (**156 PASS / 4 SKIP / 0 FAIL**) with GUI **75/75** and integrity tails PASS.
- Focused retry evidence passes direct >30s pre-effect rejection, 5 MiB non-duplicated success, 9 MiB compact oversize failure, and durable operation idempotency/cancel/recovery regressions.
- v0.8.40 exact Windows/Ubuntu hosted CI had already passed before it was superseded; its historical tag is retained.
- Focused durability evidence includes ten consecutive async runs (**80/80 PASS**), a later five-run set after stdio hardening (**45/45 PASS**), and a direct 30-operation race diagnostic (**30/30 PASS**).
- Milestones 4A, 4B.1 and 4B.2 remain released. The new `operation_*` layer is direct-session command durability; it does not widen Project Engine tool authority.

## CURRENT / open release gates

CURRENT: v0.8.41 retry-hardening release-candidate closeout.

Open gates are v0.8.41 remote PR/hosted CI, exact-tag fresh/repeated installer acceptance, reproducible release assets, immutable GitHub publication, and safe candidate-first rollout. Publication or deployment is not claimed until those gates produce evidence.

## Remaining roadmap

Broader blocker escalation, monetary accounting, additional providers/integrations and equal-model/equal-budget project benchmarks remain open. The complete ambition of a universally superior project agent is **UNPROVEN**. A configured provider and explicit project enrollment are required for model-driven execution. Installation, service health, account authentication and task acceptance are separate checks. The release does not establish an OS sandbox or new autonomous browser authority.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.8.41 candidate](RELEASE_0.8.41.md), [v0.8.40 historical candidate](RELEASE_0.8.40.md), [v0.8.39 historical candidate](RELEASE_0.8.39.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md).

Historical checkpoints are preserved in the [archived project state](history/PROJECT_CONTROL_STATE_20260924.md). Their former “current”, “final” and “next action” labels are historical. Account bindings, machine paths, process inventories and operational receipts belong in private deployment handoffs rather than this public status page.
