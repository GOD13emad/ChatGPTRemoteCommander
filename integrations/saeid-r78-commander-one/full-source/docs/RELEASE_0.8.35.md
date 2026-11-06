# v0.8.35 qualification

Status: RELEASED / DEPLOYED, 2026-09-24.

This release packages milestone 4B.1: durable missing-input questions and explicit bounded responses. Waiting runs preserve their questions across restart and yield to other enrolled projects. Exact response retries are idempotent; conflicting/stale answers, changed scope/policy, pause/cancel and exhausted budgets cannot grant continuation. Independent acceptance checks and original budgets remain binding.

The implementation was reviewed and merged in PR #7 after Windows/Ubuntu CI passed. Release PR #8 is merged. The [immutable release](https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/tag/v0.8.35) was published at 2026-09-24T19:17:43Z and pins runtime commit `d25117773ee6982661a27b1f2955888f7019edaf`.

| Gate | Status |
| --- | --- |
| Exact release Windows/Ubuntu CI | PASS — [push](https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/35995153599) and [PR](https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/35995159919) |
| Fresh/repeated pinned installers on both platforms | PASS — exact commit installed; existing configuration preserved |
| Candidate-first compatibility and no-input native checks | PASS — both platforms; active workloads retained during official promotion |
| Reproducible assets and downloaded hashes | PASS — 13 assets; repeated build, GitHub digests and downloaded hashes match |
| Public immutable release and discovered profile deployment checks | PASS — 2 devices / 3 profiles; correct runtime, healthy database, tunnel readiness, doctor and hardware self-test |

Repeated official updater runs report CURRENT on Windows and Linux. Registered connectors on both devices respond with v0.8.35. Local profile checks do not prove separate external account sessions: an additional profile was checked through its local endpoint and tunnel health. Provider authentication and configuration are separate from service installation; the Linux deployment retains its unconfigured runner.

The Git marketplace received a native `.codex-plugin/plugin.json` after publication to preserve version and skill discovery in current Codex installers. This metadata correction does not change the immutable tag, release assets or deployed backend. Refresh the Git marketplace and open a new task to load updated plugin skills.

Existing configured runners retain their settings; this release does not install/authenticate a missing model provider or enroll existing projects automatically. Native GUI implementation is unchanged from v0.8.34. Current no-input checks qualify helper readiness; inherited Windows interactive evidence and unproven Linux interactive input/DPI/session coverage remain explicitly separate. No foreground desktop takeover is needed for these changes.

General executing workers, external notification delivery, monetary accounting, Claude execution and comparative superiority remain outside this release. Local operational evidence belongs in the private handoff; this public record contains only release-level evidence.
