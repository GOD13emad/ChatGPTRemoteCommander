# Remote Commander v0.9.22

## Objective
Preserve a canonical, explicitly owner-authorized local Codex Project Engine runner across candidate-first Windows updates when the active routed runtime still carries the historical `NO_CODEX_VIA_COMMANDER` disabled runner produced before v0.9.21.

## Change
- Active routed config remains the baseline and source of runtime/store identity.
- The updater overlays only `durableWorkflows.runner` from canonical `config.local.json`, and only when the active runner is disabled specifically by historical `NO_CODEX_VIA_COMMANDER`, canonical config independently passes the v0.9.21 owner-authorized Codex contract, and the merged active authority passes the same contract.
- Standard, explicit opt-out, unsupported executable, missing executable, non-owner and unrelated disabled states are not overlaid.
- No automatic model-provider discovery is added.

## Root cause
The v0.8.0 candidate-first updater always preferred `route.active.configPath` over canonical `config.local.json`. That preserved live runtime identity, but it also hid a later explicit canonical owner policy. v0.9.21 fixed the runner authorization contract but its rollout still rebuilt from the historical disabled active config.

## Validation
Promotion requires focused runner-policy tests, updater contract/syntax tests, full check/test/audit gates, hosted CI, candidate-first live rollout, and live `system_status` readback showing `runnerConfigured=true` and `automaticExecution=true`.
