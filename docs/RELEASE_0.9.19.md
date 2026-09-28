# ChatGPT Remote Commander v0.9.19

Date: 2026-09-28

## Objective

Harden automatic Agent Extension selection after v0.9.18 introduced read-only task routing and Skill retrieval.

v0.9.18 is the immutable published baseline at merge commit `b277c30ee9c1ecceb9e68638cf413fe4f7b75d4c`. It is live on the audited Windows, Linux, and HPC Windows targets. Its release has 15 assets, 14 verified checksum entries, and immutable publication enabled.

## Change set

Two routing rules are tightened without adding execution authority:

1. **Explicit trigger dominance.** If any installed extension matches a declared trigger, weak lexical-only candidates are suppressed. This prevents a COMSOL-specific request from also returning ANSYS merely because both descriptions contain generic words such as modeling/condensation.
2. **Separated multiword trigger matching.** A multiword trigger may match when all meaningful trigger tokens are present in the task even when separated by other words. This lets project-method extensions such as `project-execution-brain` layer with a domain extension for requests such as “audit and continue this ANSYS Fluent project”.

The Commander Skill now explicitly permits bounded compatible layering (for example domain Skill + Project Execution Brain) and still requires direct trigger/domain evidence. Extension content remains subordinate to system/user/Commander policy.

## External extension boundary

Domain extensions remain independently installed under `~/.agents/extensions`; they are not bundled into the Commander installer or release assets.

Official project extension set currently accepted:
- `ansys-modeling` v1.1.1
- `comsol-modeling` v1.1.1
- `project-execution-brain` current installed project version
- `final-thesis-report` v1.0.0

The owner-private `video-trend` extension is excluded from the official rollout/catalog.

## Focused acceptance

- Agent Extension test suite: 13/13 PASS.
- Cross-domain suppression regression: PASS.
- Domain + project-method layering regression: PASS.
- Installer check: PASS.
- Onboarding/plugin check: PASS.
- Release-asset contract: PASS.

## Post-release acceptance

- Candidate SHA `9d7949222a0c42cd0503ab6d43fdab78f0a2cf48` passed exact-tree Windows and clean Linux gates.
- Hosted Windows and Ubuntu CI passed on the exact candidate; merge commit `e04cff5a4985f905afe08a6b4a791baadc54bc46` was tree-equivalent to that candidate.
- Immutable GitHub Release v0.9.19 published successfully with 15 assets and 14 verified payload checksum entries.
- Stable latest `plugin-template.zip` download matched the published digest.
- Windows, Linux, and HPC Windows live routes all serve v0.9.19 at the exact merge/tag commit.
- Official Skill hashes match across all three targets.
- Live routing canaries PASS on all three targets for COMSOL-only routing, ANSYS + Project Brain layering, and final-thesis routing.
- Windows background/headless launch regression is enforced and PASS.

**Release status: ACCEPTED/FINAL for the bounded v0.9.19 product scope.**

A fresh disposable Windows Server prerequisite-install canary remains EXTERNAL/DEFERRED because no clean Windows Server VM is available on the audited hosts. A supplementary Windows 11 Sandbox probe confirmed Administrator context and HTTP 200 reachability to the prerequisite endpoints, but two full bootstrap attempts stalled at the first PowerShell MSI GET; the Sandbox was terminated and the result is classified ENVIRONMENT-BLOCKED rather than product FAIL. No claim of universal agent superiority or control over ChatGPT host-side stream failures is made.
