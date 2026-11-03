# ChatGPT Remote Commander v0.9.21

Release objective: close the Project Engine runner authorization mismatch found on the live FULL_POWER Windows profile without weakening default-deny behavior.

## Current delta

- Preserve explicit local Codex runner configuration only when the active profile is FULL_POWER, explicitly owner-authorized, powerMode.codexControl.allowLaunch is true, provider kind is exactly codex, and the executable is a real Codex executable.
- Keep automatic Codex provider discovery forbidden.
- Keep Standard, unauthorized, disguised-command and missing-executable Codex paths fail-closed.
- Pass owner authorization into the planner boundary. Codex remains proposal-only and uses the existing read-only, ephemeral, approval-never, web-disabled and action-feature-disabled launch contract.
- Retain one-writer-per-root, durable receipts, independent verification and Project Brain requirements.

## Root cause

v0.9.20 had two conflicting contracts. no-codex-policy.mjs already supported explicit owner-authorized local Codex launch, while project-runner-config.mjs and project-planner.mjs still rejected every Codex runner. The live config therefore showed runner.enabled=true and autoTick=true while system_status reported runnerConfigured=false and automaticExecution=false.

## Verification required for promotion

Focused runner/policy/planner tests, Project Engine regressions, npm run check, npm test, npm run audit, git diff --check, GitHub CI, and live post-deploy status readback must all pass before this release is treated as accepted.

Native ChatGPT host wake/push remains outside Commander authority. Long-soak qualification remains evidence-dependent and is not implied by this release.
