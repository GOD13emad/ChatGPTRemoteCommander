# v0.8.34 release qualification

Status: HISTORICAL RELEASE / superseded by [v0.8.35](RELEASE_0.8.35.md). Qualification below was recorded on 2026-09-24 (Asia/Tehran).

Immutable release: https://github.com/GOD13emad/ChatGPTRemoteCommander/releases/tag/v0.8.34
Runtime/tag commit: `86af9fe7e803bbba19fa2d3126d81389509bd176`.
PR #5 merged as `b2c976d9b63a508b4da6e256f716a73101477dd7`; its tree equals the tested tag. This documentation closeout does not change the released runtime.

This release delivers the opt-in durable project engine and milestone 4A adaptive prerequisites/proposal teams. The user authorized finalizing both Windows and Linux and publishing GitHub. Earlier v0.8.32 and v0.8.33 drafts remain unpublished and superseded. At this checkpoint, v0.8.34 was the public stable release and active on both qualified devices; this is not a current machine-state claim.

## Corrections from final qualification

- An early deadline timer must recheck the persisted deadline and reschedule before aborting. The forced early-wakeup regression preserves exhaustion classification, one reserved attempt and zero filesystem effects.
- A custom existing Linux install without an explicit start request must update its own checkout and local state without invoking service promotion. Canonical live installs and explicit start requests retain candidate-first promotion.
- An explicit Standard profile must stay Standard through preserve-mode migration. The prior authority flag alone incorrectly enabled Full Power; the shared migration must also require prior Full Power tier and retain Standard denials.
- Process-crash tests need distinct bounded child/scenario budgets on slower Windows CI. Exact receipt, deadline continuity, budget and no-replay assertions remain required.
- Hosted Linux tests require GdkPixbuf and the GNOME settings schema. CI installs those prerequisites before the existing native helper tests.

## Gates

| Gate | Status |
| --- | --- |
| Exact final Windows/Ubuntu hosted CI | PASS: runs 35931231097 and 35931226455; tag run 35931690735 also passed |
| Windows and Linux source/native no-input qualification | PASS on exact runtime commit; Windows core 302 PASS / 5 platform or privilege SKIP, GUI contracts 75 PASS |
| Fresh and repeated isolated installer acceptance | PASS on both systems, pinned tag/commit; production routes unchanged; Linux repeated config hash unchanged |
| Candidate-first update compatibility | PASS on both devices, including shadow and live store compatibility |
| 13 release assets, internal/external manifests and downloaded hashes | PASS: independent rebuild identical; API digests and downloaded SHA-256 match |
| Immutable public release, live profiles, health and updater CURRENT | PASS: release 395129107, published 2026-09-23T23:07:56Z, immutable=true, latest=v0.8.34 |

## Deployment closeout

- Windows default and second profile: canonical ports 47831/47834, active ports 48834/48835, exact release commit, doctor and hardware selftest PASS, database schema 2 / integrity ok. Both advertise 57 tools with the previously configured runner preserved.
- Linux default: canonical port 47831, active port 48832, exact release commit, doctor and hardware selftest PASS, database schema 2 / integrity ok. It advertises 54 tools, retaining runnerConfigured=false and recovery/readiness-only behavior.
- Both official updaters subsequently reported `AUTO_UPDATE_CURRENT version=0.8.34`. Cutover readiness verified the configured tunnels. Desktop input/capture was not exercised.
- Windows first reported PROMOTED_DRAIN_PENDING. A normal updater maintenance pass safely retained terminal-bearing older backends and retired the previous route, then reported CURRENT. All six terminals named in the promotion receipt and all three preflight LAMMPS PIDs were still alive afterward. No scientific work was restarted or terminated.
- Fresh live evidence superseded an older handoff: before this rollout, Windows was already on an independently configured v0.8.32 runtime with its runner enabled, while Linux remained v0.8.31 without a runner. This release preserved those choices; it did not enroll existing workflows.
- Installer ZIP SHA-256: `273744c10f47c022e403957b4707ee3acc47656d083122a949118c420209b579`. Public assets include the complete checksum manifest. Local qualification receipts and logs are retained in the release handoff.

## Scope and retained limits

The runner remains disabled until explicitly configured, and existing workflows are never automatically enrolled. It supports bounded Codex/trusted-command proposals, a single journaled effect path and immutable file/text/JSON acceptance predicates. General executing workers, monetary accounting, Claude execution and comparative benchmarks remain planned. Application controls are not an OS sandbox, and artifact checks do not prove arbitrary scientific or project correctness.

Native GUI files are unchanged from v0.8.31. Windows interactive evidence is inherited, not rerun: the historical disposable-window focus/click/multilingual-typing/screenshot/restore scenario is accepted only with current native no-input and authorization regressions. Exhaustive DPI/multi-monitor/locked-session/emergency-stop coverage remains unproven. Linux helper/backend/capability evidence is distinct from interactive screenshot/input E2E, which remains unproven. Background project execution cannot acquire desktop takeover.

No newly identified unresolved Critical/High code finding remains in the reviewed project-engine scope at the preceding review. This is not blanket closure of the superseded historical AUDIT_R1 table. Current failures must be resolved and the exact candidate requalified before promotion.

Active terminal workloads and their retained backends must survive updates. Candidate compatibility may open the existing durable store; route/config isolation must not be described as a byte-identical database guarantee.

## Crash-test timing evidence

The exact hosted slowdown was not reproduced organically on the local host. Both unchanged and corrected focused parallel suites passed 92/92 locally. A controlled nine-second child startup exceeded the old eight-second child watchdog; the corrected test passed every original recovery assertion. A deliberately stalled child still failed at the new 30-second watchdog with owned-process cleanup. The whole crash scenario is bounded at 90 seconds, and its fixture-only run deadline is 120 seconds; deadline continuity is still asserted. Node 22 adaptive tests passed 20/20. No production execution budget changed.
