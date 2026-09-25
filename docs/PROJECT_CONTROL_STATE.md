# Current project state

Updated: 2026-09-25. Scope: public product/release status, not a live machine inventory.

## Release baseline

- [v0.9.0](RELEASE_0.9.0.md) is the latest immutable **published GitHub Release**. Its Windows live cutover reached healthy v0.9.0 backends for both configured profiles, but the outer installer returned a false nonzero status during post-success temporary-tree cleanup.
- [v0.9.2](RELEASE_0.9.2.md) is the current release target. It inherits the tagged-but-unpublished v0.9.1 acceptance hardening and fixes the live Windows post-success cleanup race without widening runtime authority.
- v0.8.38, v0.8.39 and v0.8.40 remain historical unpublished tags and are intentionally not moved.
- Live deployment audit on 2026-09-25 found both Emad PC and Emad laptop still executing v0.8.37 commit `09fcc485fd7ade82f7d8be25efc4f77ebc17e640` at the audit checkpoint. The Windows updater had already staged the published v0.8.41 release and passed local check/test/audit/GUI gates; Linux had not yet begun its post-publication v0.8.41 cycle.
- The Windows Full Power configuration created through Saeed's ChatGPT Work account on the accessible Emad PC includes Project Engine runner + automatic execution using qualified Codex CLI 0.156.1 and a bounded builder/reviewer proposal team. No live state from Saeed's own physical computer is used as release authority. The Linux Full Power configuration has the same qualified Codex CLI installed but no runner block, so automatic project execution is disabled. This parity gap is the primary v0.9.0 mutation objective.

## CURRENT / open release gates

CURRENT: v0.9.2 installer-cleanup hotfix and final qualification.

Local code gates are complete on the same candidate line: focused parity/recovery regressions, full Windows check/test/audit, full Linux check/test/audit, real candidate config parity, and Linux custom/no-start isolation all PASS. Remaining gates are hosted PR CI, exact-tag installer/update acceptance, reproducible release assets, immutable GitHub publication, candidate-first rollout, and post-rollout runtime/tunnel canaries.

## Remaining roadmap

Broader blocker escalation, monetary accounting, additional providers/integrations and equal-model/equal-budget project benchmarks remain open. The complete ambition of a universally superior project agent is **UNPROVEN**. A configured provider and explicit project enrollment are required for model-driven execution. Installation, service health, account authentication and task acceptance are separate checks. The release does not establish an OS sandbox or new autonomous browser authority.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.9.2 candidate](RELEASE_0.9.2.md), [v0.9.0 published baseline](RELEASE_0.9.0.md), [v0.9.1 historical candidate](RELEASE_0.9.1.md), [v0.8.42 historical published baseline](RELEASE_0.8.42.md), [v0.8.40 historical candidate](RELEASE_0.8.40.md), [v0.8.39 historical candidate](RELEASE_0.8.39.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md).

Historical checkpoints are preserved in the [archived project state](history/PROJECT_CONTROL_STATE_20260924.md). Their former “current”, “final” and “next action” labels are historical. Account bindings, machine paths, process inventories and operational receipts belong in private deployment handoffs rather than this public status page.
