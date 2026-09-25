# v0.8.33 release qualification

Status: UNPUBLISHED / SUPERSEDED by v0.8.34. Windows/Linux CI and source tests passed, but repeated Linux installation exposed early deadline timer wakeup incorrectly producing BLOCKED. The release was not published. v0.8.34 rechecks the persisted deadline before aborting; see RELEASE_0.8.34.md.

This release delivers the opt-in durable project engine and milestone 4A adaptive prerequisites/proposal teams. The user authorized finalizing both Windows and Linux and publishing GitHub. The paragraphs below preserve the historical candidate plan; v0.8.33 was never published. Current release authority is [v0.8.35](RELEASE_0.8.35.md).

## Corrections from final qualification

- A custom existing Linux install without an explicit start request must update its own checkout and local state without invoking service promotion. Canonical live installs and explicit start requests retain candidate-first promotion.
- An explicit Standard profile must stay Standard through preserve-mode migration. The prior authority flag alone incorrectly enabled Full Power; the shared migration must also require prior Full Power tier and retain Standard denials.
- Process-crash tests need distinct bounded child/scenario budgets on slower Windows CI. Exact receipt, deadline continuity, budget and no-replay assertions remain required.
- Hosted Linux tests require GdkPixbuf and the GNOME settings schema. CI installs those prerequisites before the existing native helper tests.

## Gates

| Gate | Status |
| --- | --- |
| Exact final Windows/Ubuntu hosted CI | PENDING |
| Windows and Linux source/native no-input qualification | PENDING on final candidate |
| Fresh and repeated isolated installer acceptance | PENDING on final candidate |
| Candidate-first update compatibility | PENDING on final candidate |
| 13 release assets, internal/external manifests and downloaded hashes | PENDING |
| Immutable public release, live profiles, health and updater CURRENT | PENDING |

## Scope and retained limits

The runner remains disabled until explicitly configured, and existing workflows are never automatically enrolled. It supports bounded Codex/trusted-command proposals, a single journaled effect path and immutable file/text/JSON acceptance predicates. General executing workers, monetary accounting, Claude execution and comparative benchmarks remain planned. Application controls are not an OS sandbox, and artifact checks do not prove arbitrary scientific or project correctness.

Native GUI files are unchanged from v0.8.31. Windows interactive evidence is inherited, not rerun: the historical disposable-window focus/click/multilingual-typing/screenshot/restore scenario is accepted only with current native no-input and authorization regressions. Exhaustive DPI/multi-monitor/locked-session/emergency-stop coverage remains unproven. Linux helper/backend/capability evidence is distinct from interactive screenshot/input E2E, which remains unproven. Background project execution cannot acquire desktop takeover.

No newly identified unresolved Critical/High code finding remains in the reviewed project-engine scope at the preceding review. This is not blanket closure of the superseded historical AUDIT_R1 table. Current failures must be resolved and the exact candidate requalified before promotion.

Active terminal workloads and their retained backends must survive updates. Candidate compatibility may open the existing durable store; route/config isolation must not be described as a byte-identical database guarantee.

## Crash-test timing evidence

The exact hosted slowdown was not reproduced organically on the local host. Both unchanged and corrected focused parallel suites passed 92/92 locally. A controlled nine-second child startup exceeded the old eight-second child watchdog; the corrected test passed every original recovery assertion. A deliberately stalled child still failed at the new 30-second watchdog with owned-process cleanup. The whole crash scenario is bounded at 90 seconds, and its fixture-only run deadline is 120 seconds; deadline continuity is still asserted. Node 22 adaptive tests passed 20/20. No production execution budget changed.
