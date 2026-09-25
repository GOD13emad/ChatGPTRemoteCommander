# Current project state

Updated: 2026-09-25. Scope: public product/release status, not a live machine inventory.

## Release baseline

- [v0.8.41](RELEASE_0.8.41.md) is the latest immutable **published GitHub Release** verified at this checkpoint.
- [v0.8.42](RELEASE_0.8.42.md) is merged on `main` as a pre-publication live-compatibility hotfix. It preserves historical configured provider timeouts while keeping effective planner execution bounded to 30 seconds.
- [v0.9.0](RELEASE_0.9.0.md) is the current capability-parity qualification target and is based on the full v0.8.42 code/evidence baseline.
- v0.8.38, v0.8.39 and v0.8.40 remain historical unpublished tags and are intentionally not moved.
- v0.8.42 exact persisted-profile candidate startup passed on Windows for both existing profiles without route mutation.

## CURRENT / open release gates

CURRENT: v0.9.0 capability-parity qualification after rebase onto v0.8.42.

The earlier pre-rebase v0.9.0 tree passed focused parity tests and full local Windows check/test/audit, but those results are not promoted to the rebased commit. Open gates are exact rebased local qualification, remote PR/hosted Windows+Linux CI, exact-tag installer/release-asset acceptance, immutable GitHub publication, candidate-first rollout to the two directly managed Emad targets, and custom-app **Scan Tools** refresh wherever the ChatGPT connector inventory is stale.

## Remaining roadmap

Broader provider integrations, monetary accounting and equal-model/equal-budget comparative benchmarks remain open. Universal superiority is **UNPROVEN**. A configured and authenticated provider plus explicit project enrollment are required for model-driven execution. Installation, service health, provider authentication, app tool-scan freshness and task acceptance are separate checks.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.9.0 qualification target](RELEASE_0.9.0.md), [v0.8.42 compatibility hotfix](RELEASE_0.8.42.md), [v0.8.41 published/deployment-superseded](RELEASE_0.8.41.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md).

Historical checkpoints remain append-only archives. Account bindings, machine paths, process inventories and operational receipts belong in private deployment handoffs rather than this public status page.
