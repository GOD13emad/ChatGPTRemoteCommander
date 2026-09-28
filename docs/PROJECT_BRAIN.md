# Project Brain — ChatGPT Remote Commander

Status: CURRENT — SCOPED FINAL / ACCEPTED
Updated: 2026-09-28
Authority: immutable release/tag -> exact live route records -> exact-SHA CI/canary evidence -> project control/evidence records.

## Final objective

Maintain a cross-platform Remote Commander that safely executes substantial work in the background, survives interruption/update, preserves one-writer/evidence semantics, supports explicit owner-authorized GUI/Codex paths without hidden delegation, and routes relevant separately installed domain Skills without bundling them into Commander Core.

## Accepted current baseline

**v0.9.20 — SCOPED FINAL / ACCEPTED**

Release/tag commit: `cbbc6dc19f63a87e651a8f1af9f429aa7b6a5063`.
Qualified candidate tree: `674990c743fc996d84d0b0c4e008f0255078e44c` with no file diff against the merge commit.

Accepted evidence:
- local Windows exact-SHA full gate PASS;
- local Linux exact-SHA full gate PASS;
- hosted Windows/Ubuntu CI PASS on run `36445899951`;
- disposable Windows Server + clean Ubuntu Server canary PASS on run `36445899940`;
- immutable release verification PASS with 15 assets and 14 verified payload checksums;
- candidate-first live rollout complete on primary Windows, Windows `saeed-emad`, Linux, and HPC Windows;
- all accepted route records point to exact v0.9.20 commit with `previous=null`;
- live Skill routing canaries PASS on Windows/Linux/HPC.

Official separately installed Agent Extensions:
- ansys-modeling v1.1.1
- comsol-modeling v1.1.1
- project-execution-brain v1.0.0
- final-thesis-report v1.0.0

The owner-private video-trend extension remains intentionally outside the official catalog. Domain extensions remain lifecycle-independent from Commander Core and are not bundled by the Commander installer/release.

## Locked decisions

- Background/headless execution is default. Console/terminal windows are not a progress UI.
- Actual task UI or an explicit official progress UI may be foregrounded.
- Domain Agent Extensions are separately installed; Commander owns validation/routing/policy intersection only.
- Explicit trigger evidence dominates weak lexical routing; compatible project-method and domain Skills may layer.
- Hidden/background project runners remain No-Codex. Local Codex launch is only the explicitly authorized owner path defined by policy.
- Immutable releases remain enabled.
- Windows Server bootstrap remains verification/allowlist based; it does not disable Defender/EDR or create AV exclusions.
- Fresh-server qualification is a permanent release gate: Windows Server bootstrap and clean Ubuntu bootstrap.
- Do not mass-cancel durable workflows belonging to unrelated user projects merely to make release dashboards empty.
- No blind rerun after meaningful failure; repeated failure families require root-cause audit and prevention.

## v0.9.20 closure

Root causes closed:
1. fresh Linux bootstrap omitted Python 3 although qualification requires it;
2. headless Linux server qualification incorrectly required native GNOME/PyGObject integration;
3. inherited-stdio async regression mixed hosted scheduling latency with the intended post-ready drain invariant.

Prevention now retained in code/tests:
- Python 3 is installed/required by supported Linux fresh-server paths;
- headless server validation keeps static GUI checks but skips only the native GNOME probe;
- normal Linux GUI qualification still exercises native GNOME integration;
- permanent disposable Windows/Linux server canary;
- async fixture ready-handshake and bounded post-ready assertion window.

A single local Windows full-gate attempt on the final candidate observed one clean fixture-server exit in the HTTP conversation test while several qualification workloads were concurrent. The same exact test then passed 10/10 in isolation, hosted Windows passed, and a clean full Windows exact-SHA rerun passed. Root cause of that one local occurrence is therefore UNVERIFIED; no product patch was made from it.

## Deferred / external — not v0.9.20 blockers

- ChatGPT host/UI stream errors such as Resume stream unavailable are outside Commander transport authority; Commander reduces exposure through durable/background execution but cannot guarantee the host UI stream.
- Historical/other-project durable workflow records are retained when they belong to unrelated projects. Integrity is checked; they are not mass-cancelled for cosmetic cleanup.
- Broader provider expansion, monetary accounting, additional integrations, and equal-model/equal-budget competitive benchmarks are future roadmap items.
- Claims that Commander is universally superior to every external agent/work product remain UNPROVEN without comparable benchmark evidence.
- Dependency-update PRs and legacy historical branches are maintenance/history, not release acceptance evidence.

## Post-release repository closure

Main closure commit: `f0157ccff98da9e42c25e5ea0bd55bc9ee7de0ab`.

Exact closure-head evidence:
- focused Windows fixture-startup stress: 36/36 PASS;
- hosted CI run `36451298406`: Windows PASS, Ubuntu PASS;
- Server Install Canary run `36451298534`: Windows Server PASS, clean Ubuntu PASS;
- Actions pins refreshed to checkout v7.0.1 / setup-node v7.0.0;
- stale/superseded PRs #43, #3, #4 and legacy draft #30 closed without deleting Git history.

No runtime/release bytes changed after immutable v0.9.20 publication.

## Exact next action

No action is required for the accepted v0.9.20 scope. For new work, start from v0.9.20 as the production baseline and open one bounded change set only when a new requirement, reproducible defect, security issue, or evidence-backed improvement is identified.

## History pointers

Detailed append-only evidence: `docs/PROJECT_KNOWLEDGE_EVIDENCE.md`.
Current/release roadmap: `docs/PROJECT_CONTROL_STATE.md`.
Historical snapshots: `docs/history/`.


## Milestone — 2026-09-28 — v0.9.21 owner-authorized runner closure

**Previous accepted state:** GitHub main at 4a93d5475447f751e81ceaa87495b8c684fd1e87, release 0.9.20. Live FULL_POWER Windows configuration explicitly requested a local Codex Project Engine runner, but runtime reported runnerConfigured=false / automaticExecution=false.

**Current delta:** repaired the policy/configuration mismatch so an explicitly configured local Codex runner is preserved only when FULL_POWER, explicit owner authorization, powerMode.codexControl.allowLaunch=true, exact provider kind=codex, and a real Codex executable are all present. All other Codex paths remain default-deny. Planner remains proposal-only under the existing restricted launch contract. Release/version/install/plugin metadata are aligned to 0.9.21.

**Evidence / V&V:** local final gate PASS at 2026-09-28T21:50:18.6502700+03:30. Project Engine 222 pass / 0 fail / 1 environment skip; comprehensive check and test suites completed with zero failures; SECURITY_AUDIT_PASS; source-integrity/runtime/installer/plugin/release-asset gates passed; git diff --check passed. Gate log SHA-256: 406a95addaff1ccc343969c2d4097bf401eac2145b36e5ad18431429108bb569.

**Authority:** the single writer is the clean canonical writer clone on the primary Windows host, on branch finalize/v0.9.21. The legacy dirty checkout remains non-authoritative and untouched.

**Open gates / critical path:** GitHub promotion/CI and live runtime deployment/readback. Native ChatGPT host wake/push remains external. Long-soak qualification is UNPROVEN until elapsed evidence exists.

**Exact next action:** commit and push the clean branch, open/validate GitHub PR, merge only after available CI/status gates, then deploy the immutable promoted revision and verify live Windows/Linux status.


## Milestone delta — 2026-09-28 — Windows hosted qualification correction

Hosted Linux gates on the amended v0.9.21 candidate passed. Two Windows-only qualification failures were isolated to browser lifecycle tests: an 80 ms setup-sensitive timeout and a raw-PID liveness predicate for a profile-owned process. Production browser cleanup remains unchanged. The candidate now uses the fixture-default 1000 ms timeout for the intended timeout-cleanup test and verifies profile-owned descendants by exact browser profile identity rather than numeric PID existence. Promotion remains open pending targeted stress, full local gate, and fresh hosted Windows gates.


## Milestone delta — 2026-09-28 — Local requalification complete

The Windows qualification correction is locally requalified. Browser-process tests are 7/7 PASS and the two previously failing hosted-Windows scenarios passed 20/20 repeated targeted runs. The complete release gate then passed: Project Engine 222 pass / 0 fail / 1 environment skip, full suite 481 pass / 0 fail / 6 environment skips, security audit PASS, and diff-check PASS. Gate-log SHA-256 is 107D33026CD9294B07ED8B7AAB79B0A6B63B5EE325E634A663E184C505FD80DB. Promotion remains open until fresh hosted CI and both server canaries pass on the amended commit.


## Milestone delta — 2026-09-28 — Hosted Windows spawn/PID fixture race

A third meaningful hosted-Windows browser qualification occurrence triggered stop-patching review. The new failure was not cleanup: the fixture marker contained an invalid PID because it serialized child.pid immediately after asynchronous spawn. Primary Node documentation confirms the spawn event as the successful-creation boundary and that pid can be undefined. The fixture now awaits spawn before recording PID on both child-process paths. Production browser lifecycle code is unchanged. Promotion remains blocked pending targeted regression, one final local gate, and fresh hosted gates.


## Milestone delta — 2026-09-28 — Final local candidate requalified

The spawn/PID fixture guard passed targeted validation (browser-process 7/7; affected child-spawn stress 10/10) and the complete release gate then passed. Project Engine: 222 pass / 0 fail / 1 environment skip. Full suite: 481 pass / 0 fail / 6 environment skips. GUI contract: 77/77. Security audit and diff check passed. Final gate marker: 2026-09-28T23:06:39.5908545+03:30; gate-log SHA-256: 0DC03CE86CF73A2847B68ECC566D7CDF916F91F7B3E0D69DB33A51DF8DA5F817. The source candidate is locally accepted but not yet promoted; fresh hosted CI and server canaries remain mandatory.
