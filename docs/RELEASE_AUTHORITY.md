# Current release authority — 2026-10-11

This is the current **public release/roadmap pointer** for Remote Commander Core and its separately released Browser. It does **not** replace historic provenance, privately verified cumulative Project Brains, exact machine installation readbacks, or acceptance evidence.

## Immutable released baselines

| Product | Released baseline | Exact annotated-tag target | Boundary |
| --- | --- | --- | --- |
| Remote Commander Core | [v0.10.20](https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/tag/v0.10.20) | `362375c464948be3001b307650c13fc3353ed05b` | Published stable Core; not an integrated multi-product FINAL |
| Remote Commander Browser | [v0.8.1](https://github.com/Usefull-Skills/chatgpt-cef-linux/releases/tag/v0.8.1) | `39258bc8e143aa666465e0ad63c4f277b075fcf3` | Separate published Browser; later UI branches are not Stable |

Both cited releases were observed with `immutable=true`, `draft=false`, `prerelease=false` on 2026-10-11. Their release assets have per-asset SHA-256 metadata. A release/tag readback proves publication identity, not safety of every local installed executable.

The Core `main` head **observed** on 2026-10-11 was `fadb1e1201031d8ff5169851e0aef860ffb07f1a`. `main` is a moving source branch; never silently equate its head with immutable `v0.10.20` or a deployed binary.

## Current development and verification, not Stable

- [Core PR #174](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/174) at `c0c4d8dac264d7e1745df486492ceaac3584eecd` addresses native Windows Job Object containment. Exact-head hosted Windows/Ubuntu CI is green, and isolated local Windows focused and qualification check/test/security-audit results have independent scoped evidence. PR is still Draft; **real installed updater candidate-first E2E, rollback, and eventual release acceptance remain OPEN**.
- [Core PR #172](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/172) is a **fail-closed four-host UI release readiness checker**. CI proving that `BLOCKED` is correctly produced is not proof that signing, installation, owner UI validation, or rollback are complete. Do not enable Auto Update from a sample blocked manifest.
- Windows/Linux Control Center and monitoring have Draft UI feature and integration PRs, not a four-host accepted stable rollout. Native profile/task CRUD, desktop icons/window/RTL/HiDPI owner acceptance and authenticated control require separate validation.
- [Browser PR #89](https://github.com/Usefull-Skills/chatgpt-cef-linux/pull/89) at `5daa0d7762ed0a8f3afc3f7b5239122e338cf5ad` builds on the **Development-only** `v0.8.3-rc.2` line. Its isolated Emad Linux native CEF self-test had six expected markers and exit 0, but no native manual UI/login/profile-owner acceptance. It is **not** v0.8.1 Stable.
- Durable workflow engine and scheduler availability are distinct from a configured, authorized autonomous Runner and authenticated same-chat delivery. Neither can be inferred from a capability flag or queued record.

## Definition of final integrated product

FINAL requires separately verified Core/Browser identity; one approved stable and one controlled development release on the development hosts; no stale/unknown live authority; Windows/Linux UI parity, signed or explicitly approved artifact provenance, authenticated and profile-preserving CEF/GUI operations, STOP/Mutex no-replay, safe task/profile/monitoring control, bounded workflow execution with real same-chat ACK, interruption/power-return recovery, versioned canary/install/uninstall/rollback across enrolled hosts, then independently verified cumulative Project Brain and closure. No whole-project percentage is claimed.

Critical gates remain OPEN for native owner visual acceptance, native Windows updater E2E, STOP/Mutex, workflow Runner/ACK, trusted signing, all-host rollback, and real recovery/soak. Optional Game/Video/Local-AI extensions are separately gated and cannot be silently promoted into Core readiness.

## Authority, history and safe continuation

Older documents titled `PROJECT_BRAIN.md`, `PROJECT_CONTROL_STATE.md`, or `PROJECT_ENGINE_ROADMAP.md` contain dated historical "CURRENT" sections. **Their former CURRENT labels are historical, not instructions to run older scripts, revert the installed Core, or reset/clean development worktrees.** Preserve them as provenance. Private cumulative Brain archives, user browser state, tunnel credentials and raw machine traces intentionally remain outside public Git.

For present source changes: pin an exact PR commit and test it in an isolated development root; verify Windows/Linux hosted checks plus native host regressions; inspect release assets/signature/rollback and unchanged production route; require actual owner acceptance where relevant. No blind retry or uncertain GUI input replay. Never use `Win32_Product` inventory to audit Windows installations.

**Next public technical milestone:** close the exact PR #174 native Windows candidate-first updater E2E gate, then the independently tested Browser/Control Center UI and transactional four-host release pipeline. Maintain the immutable released baselines until qualified promotion.
