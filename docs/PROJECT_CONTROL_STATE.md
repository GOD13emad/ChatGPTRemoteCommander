# Current project state

Updated: 2026-09-26. Scope: public product/release status, not a live machine inventory.

## Release baseline

- v0.9.4 live candidate `bc8f7baedfae4053ffb200f2a2a8f988fab951f0` is the current qualified runtime baseline after cross-platform candidate-first rollout; this does **not** by itself make v0.9.4 an immutable published GitHub Release.
- [v0.9.1](RELEASE_0.9.1.md) is the latest immutable **published GitHub Release** at this checkpoint, with 13 assets. v0.9.0 is also an immutable published release.
- [v0.9.3](RELEASE_0.9.3.md) is the current Linux-completeness release target. It carries the v0.9.2 installer cleanup fix and adds terminal-preserving Linux cutover plus a safe Firefox WebDriver background-browser backend without widening foreground authority.
- v0.8.38, v0.8.39 and v0.8.40 remain historical unpublished tags and are intentionally not moved.
- Later live audit on 2026-09-25 confirmed Emad PC on v0.9.1 with Full Power Project Engine automatic execution and all 27 current capabilities granted. Emad laptop successfully validated v0.9.1 Full Power candidates, but promotion was safely deferred because the old routed backend owned persistent terminal sessions. v0.9.3 closes that Linux retention gap without killing those terminals.
- The Windows Full Power configuration created through Saeed's ChatGPT Work account on the accessible Emad PC supplied the parity requirements for Project Engine runner + automatic execution. No live state from Saeed's own physical computer is used as release authority. Linux Project Engine candidate parity is now proven; the remaining release work is exact v0.9.3 qualification/publication/rollout.

## CURRENT / open release gates

CURRENT: post-v0.9.4 live hardening — CSDC-038 hot-update tool-schema continuity.

Exact v0.9.4 commit `bc8f7baedfae4053ffb200f2a2a8f988fab951f0` passed candidate-first Windows/Linux qualification and is active on the qualified Windows profiles and Linux canonical route. Linux retained pre-update terminal sessions without killing them or leaving the old backend in the canonical route. The next release-critical blocker is CSDC-038: an already-open host can retain a stale tool schema across a hot update that introduces a new mutation contract. Stable publication remains gated by the open P0 completion register, hosted CI/release acceptance, and the final release gate.

## Remaining roadmap

Broader blocker escalation, monetary accounting, additional providers/integrations and equal-model/equal-budget project benchmarks remain open. The complete ambition of a universally superior project agent is **UNPROVEN**. A configured provider and explicit project enrollment are required for model-driven execution. Installation, service health, account authentication and task acceptance are separate checks. The release does not establish an OS sandbox or new autonomous browser authority.

## Where to continue

- Installation: [START_HERE](../START_HERE.md) and [Work/Codex setup](../WORK_SETUP.md).
- Behavior: [project engine](PROJECT_ENGINE.md), [adaptive planning](PROJECT_ENGINE_ADAPTIVE.md), [project questions](PROJECT_ENGINE_DECISIONS.md), [background browser](BACKGROUND_BROWSER.md).
- Validation: [v0.9.3 candidate](RELEASE_0.9.3.md), [v0.9.1 published baseline](RELEASE_0.9.1.md), [v0.9.2 historical candidate](RELEASE_0.9.2.md), [v0.9.0 published](RELEASE_0.9.0.md), [v0.8.42 historical published baseline](RELEASE_0.8.42.md), [v0.8.40 historical candidate](RELEASE_0.8.40.md), [v0.8.39 historical candidate](RELEASE_0.8.39.md), [qualification history](PROJECT_ENGINE_VALIDATION.md), [GUI acceptance](GUI_ACCEPTANCE.md).
- Knowledge: [engineering decisions and evidence](PROJECT_KNOWLEDGE_EVIDENCE.md).

Historical checkpoints are preserved in the [archived project state](history/PROJECT_CONTROL_STATE_20260924.md). Their former “current”, “final” and “next action” labels are historical. Account bindings, machine paths, process inventories and operational receipts belong in private deployment handoffs rather than this public status page.
