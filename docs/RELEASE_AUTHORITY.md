# Current release authority — 2026-10-13

This is the current **public release/roadmap pointer** for Remote Commander Core and its separately released Browser. It does **not** replace historic provenance, privately verified cumulative Project Brains, exact machine installation readbacks, or acceptance evidence.

## Immutable released baselines

| Product | Released baseline | Exact annotated-tag target | Boundary |
| --- | --- | --- | --- |
| Remote Commander Core | [v0.10.20](https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/tag/v0.10.20) | `362375c464948be3001b307650c13fc3353ed05b` | Published stable Core; not an integrated multi-product FINAL |
| Remote Commander Browser | [v0.8.1](https://github.com/Usefull-Skills/chatgpt-cef-linux/releases/tag/v0.8.1) | `39258bc8e143aa666465e0ad63c4f277b075fcf3` | Separate published Browser; later UI branches are not Stable |

Both cited releases were rechecked with `immutable=true`, `draft=false`, `prerelease=false` on 2026-10-13. Their release assets have per-asset SHA-256 metadata. A release/tag readback proves publication identity, not safety of every local installed executable.

The Core `main` head observed on **2026-10-13** is `8570b3a1b37e2ff7a2d2fd08d0924f52b37bb88d`, with `package.json` reporting development `0.10.21`. The prior 2026-10-11 observation `fadb1e1201031d8ff5169851e0aef860ffb07f1a` is historic. `main` is moving source authority, **not** the released v0.10.20 binary or permission to promote a development build.

## Current development and verification, not Stable

- [Core PR #174](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/174) was **merged on 2026-10-11** (merge commit `19546c525eff9c603ea2f7a7e43ac096591a2bc9`), so repeating its old Draft-PR merge gate is **SUPERSEDED—DO NOT RUN**. Windows Job Object containment is in development `main`. **Exact-version v0.10.21 hosted qualification, native installed updater candidate-first E2E, rollback and release acceptance remain OPEN.**
- [Core PR #192](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/192) was **merged on 2026-10-12** as `8570b3a1b37e2ff7a2d2fd08d0924f52b37bb88d`; it aligns the Windows native Control Center UI version with Core `0.10.21`. Core CI and Release Sync for that exact push are `success`; this **does not establish a v0.10.21 release or four-host native UI acceptance**.
- [Core PR #172](https://github.com/GOD13emad/ChatGPTRemoteCommander/pull/172) is a **fail-closed four-host UI release readiness checker**. CI proving that `BLOCKED` is correctly produced is not proof that signing, installation, owner UI validation, or rollback are complete. Do not enable Auto Update from a sample blocked manifest.
- Windows/Linux Control Center and monitoring have Draft UI feature and integration PRs, not a four-host accepted stable rollout. Native profile/task CRUD, desktop icons/window/RTL/HiDPI owner acceptance and authenticated control require separate validation.
- [Browser PR #89](https://github.com/Usefull-Skills/chatgpt-cef-linux/pull/89) **merged 2026-10-12**, as did [Browser UI PR #81](https://github.com/Usefull-Skills/chatgpt-cef-linux/pull/81). Browser `main` was observed at `d04ae5b5b0129b7c2b199ee99a22bda6709edf66` on 2026-10-13. These are **development source** changes only; Browser v0.8.1 remains the latest immutable public stable release. Native visual/login/profile-owner acceptance and transactional multi-host rollback are NOT yet evidenced.
- Durable workflow engine and scheduler availability are distinct from a configured, authorized autonomous Runner and authenticated same-chat delivery. Neither can be inferred from a capability flag or queued record.

## Definition of final integrated product

FINAL requires separately verified Core/Browser identity; one approved stable and one controlled development release on the development hosts; no stale/unknown live authority; Windows/Linux UI parity, signed or explicitly approved artifact provenance, authenticated and profile-preserving CEF/GUI operations, STOP/Mutex no-replay, safe task/profile/monitoring control, bounded workflow execution with real same-chat ACK, interruption/power-return recovery, versioned canary/install/uninstall/rollback across enrolled hosts, then independently verified cumulative Project Brain and closure. No whole-project percentage is claimed.

Critical gates remain OPEN for native owner visual acceptance, native Windows updater E2E, STOP/Mutex, workflow Runner/ACK, trusted signing, all-host rollback, and real recovery/soak. Optional Game/Video/Local-AI extensions are separately gated and cannot be silently promoted into Core readiness.

## Authority, history and safe continuation

Older documents titled `PROJECT_BRAIN.md`, `PROJECT_CONTROL_STATE.md`, or `PROJECT_ENGINE_ROADMAP.md` contain dated historical "CURRENT" sections. **Their former CURRENT labels are historical, not instructions to run older scripts, revert the installed Core, or reset/clean development worktrees.** Preserve them as provenance. Private cumulative Brain archives, user browser state, tunnel credentials and raw machine traces intentionally remain outside public Git.

For present source changes: pin an exact PR commit and test it in an isolated development root; verify Windows/Linux hosted checks plus native host regressions; inspect release assets/signature/rollback and unchanged production route; require actual owner acceptance where relevant. No blind retry or uncertain GUI input replay. Never use `Win32_Product` inventory to audit Windows installations.

**Next public technical milestone:** independently qualify the current Core v0.10.21 exact source/tree on Windows and Linux, prove native installed updater candidate-first E2E and rollback without changing v0.10.20 stable routes, then qualify the Browser/Control Center native UI and transactionally guarded four-host release pipeline. Do not promote because a historical PR was merged or because hosted CI is green. Maintain immutable released baselines until promotion gates pass.
