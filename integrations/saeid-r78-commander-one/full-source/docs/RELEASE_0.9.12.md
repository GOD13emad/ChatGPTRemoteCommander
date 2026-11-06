# ChatGPT Remote Commander v0.9.12

Date: 2026-09-27

## Purpose

Hotfix v0.9.11's live schema-continuity blocker without weakening the ChatGPT-first / No-Codex invariant.

## Root cause

v0.9.11 correctly migrated the old Project Engine runner to disabled. However, `createWorkflowTools()` only advertised the four `workflow_run_*` Project Engine tools when a runner instance existed. v0.9.10 had those tools because its old runner was enabled. Disabling the runner therefore removed four tools from the live MCP catalog, which is a breaking schema change. The stable router correctly blocked Windows promotion with `SCHEMA_CONTINUITY_GATE_FAIL profile=default decision=LEGACY_HOST_SEEN`.

## Fix

- Always advertise the existing `workflow_run_start`, `workflow_run_status`, `workflow_run_resolve`, and `workflow_run_tick` definitions whenever durable workflows are enabled.
- When no runner/provider is configured, invocation remains fail-closed with the existing `WORKFLOW_RUNNER_DISABLED` error.
- No provider is auto-created.
- Codex remains forbidden in Commander.
- Work/Codex remains an external handoff requiring explicit current-chat user choice.

This makes the v0.9.10 -> v0.9.12 tool catalog backward-compatible while preserving the v0.9.11 execution policy.

## Acceptance

- Regression proves `workflow_run_*` definitions remain present with runner disabled and invocation fails `WORKFLOW_RUNNER_DISABLED`.
- Full Windows check/test/audit.
- Exact-tree Linux check/test/audit.
- Hosted Windows/Ubuntu CI.
- Live Windows default + saeed-emad and Linux default candidate-first promotion.
- Post-promotion status must show no automatic Codex provider/execution.
