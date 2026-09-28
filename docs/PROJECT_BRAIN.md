# Project Brain — ChatGPT Remote Commander

Status: CURRENT
Updated: 2026-09-28
Authority: `origin/main`, immutable release tags, exact live route records, reproducible CI/canary evidence, then project control/evidence records.

## Final objective

Maintain a cross-platform Remote Commander that safely executes substantial work in the background, survives interruption/update, preserves one-writer/evidence semantics, supports explicit owner-authorized GUI/Codex paths without hidden delegation, and routes relevant separately installed domain Skills without bundling them into Commander Core.

## Accepted baseline

Current published/live baseline before the active patch: **v0.9.19**, merge/tag commit `e04cff5a4985f905afe08a6b4a791baadc54bc46`.

Confirmed live targets:
- Windows default: v0.9.19, exact release commit, previous=null.
- Windows `saeed-emad`: v0.9.19, exact release commit, previous=null.
- Linux: v0.9.19, exact release commit, previous=null.
- HPC Windows: v0.9.19, exact release commit, previous=null.

Official separately installed Agent Extensions:
- ansys-modeling v1.1.1
- comsol-modeling v1.1.1
- project-execution-brain v1.0.0
- final-thesis-report v1.0.0

The owner-private video-trend extension is deliberately outside the official catalog. Official Skill hashes match across Windows/Linux/HPC. Live routing canaries are accepted on all three host classes.

## Locked decisions

- Background/headless execution is default. Console/terminal windows are not a progress UI.
- Actual task UI or an explicit official progress UI may be foregrounded.
- Domain Agent Extensions are separately installed and lifecycle-independent from Commander Core.
- Commander owns Extension validation/routing/policy intersection; Extensions do not grant authority.
- Explicit trigger evidence dominates weak lexical routing; compatible project-method and domain Skills may layer.
- Hidden/background project runners remain No-Codex; local Codex launch is only the explicit owner-authorized Full-Power path already defined by release policy.
- Immutable releases stay enabled.
- Windows server installer does not disable Defender/EDR and does not create AV exclusions.
- Do not mass-cancel durable workflows from unrelated user projects merely to make a release dashboard look empty.

## Current change set

**v0.9.20 — fresh-Linux server prerequisite closure.**

Disposable v0.9.19 canary evidence:
- Windows Server with Node/Git removed from PATH: PASS.
- Clean Ubuntu 24.04: FAIL because Python 3 was not installed although release qualification requires it.

Implementation:
- add Python 3 to supported Linux prerequisite package sets;
- require `python3` before qualification;
- add static installer regression;
- add permanent disposable Windows/Linux server canary on relevant pull requests.

## Current open gate / exact next action

Qualify one immutable v0.9.20 candidate through focused tests, Windows/Linux exact-SHA full gates, disposable server canary, hosted CI, immutable publication, published-byte verification and candidate-first rollout. Then update closure evidence/control status to scoped FINAL/ACCEPTED.

## Deferred / external, not v0.9.20 blockers

- ChatGPT host/UI stream expiry is outside Commander transport authority.
- Legacy/other-project durable workflow records on Linux are retained; workflow DB integrity is OK, automaticExecution=false and currentLeases=0.
- Broader provider expansion, monetary accounting, and equal-model/equal-budget competitive benchmarks are future roadmap items.
- Dependabot Actions PRs are maintenance, not release blockers.
- Legacy PR #30 is historical/draft on a legacy branch and is not part of current release authority.

## History pointers

Detailed append-only evidence: `docs/PROJECT_KNOWLEDGE_EVIDENCE.md`.
Current/release roadmap: `docs/PROJECT_CONTROL_STATE.md`.
Historical snapshots: `docs/history/`.
