# v0.9.7 qualification

Status: CANDIDATE — locally qualified Agent Extension milestone; live route promotion requires exact-commit candidate-first rollout.

v0.9.7 introduces Remote Commander-Agent Extension Contract v1. The new layer is deliberately declarative: extensions advertise reusable domain capabilities, dependencies, hardware requirements, safety gates and artifacts, while all execution authority remains in the existing Commander tool/workflow/Project Engine policy.

## Included

- New bounded `agent.json` manifest contract and registry.
- Default local discovery from the repository `agent-extensions` directory and `~/.agents/extensions`, with config override/disable.
- Read-only MCP tools:
  - `agent_extension_list`
  - `agent_extension_get`
  - `agent_extension_match`
- `system_status` reports Agent Extension schema, configured discovery directories, validated count and diagnostics.
- Fail-closed manifest validation: path traversal, non-regular/hard-linked manifests, invalid fields and duplicate IDs are excluded.
- Multi-way duplicate-ID prevention: once an ID conflicts it cannot re-enter the catalog through a later directory.
- Remote Commander skill guidance to prefer reusable extensions over one-off duplicated runtimes.
- `video-trend` installed locally as the first reference extension, backed by the existing shared ComfyUI runtime and a separate project router.

## Authority and safety invariants

- An extension manifest does not execute code and grants no filesystem, shell, browser, GUI, workflow, model or Project Engine authority.
- Extension selection never bypasses Commander policy, one-writer rules, mutation idempotency or durable recovery.
- Runtime/model declarations are metadata, not evidence of runtime health.
- Invalid or ambiguous extension identity fails closed instead of guessing by path order.
- Real-person video identity work is declared with explicit permission/rights gates in the reference video extension.

## Evidence

Before version promotion:
- Agent Extension unit + HTTP integration: 9/9 focused tests PASS after the three-way duplicate and realpath-containment regressions were added.
- Full `npm run check`: PASS after one fixture-only dependency drift was root-caused and fixed.
- Full `npm test`: 466 tests / 460 pass / 6 skip / 0 fail; GUI contract 75/75 PASS; concurrency, filesystem, Windows runtime and source-integrity gates PASS.
- `npm run audit`: SECURITY_AUDIT_PASS; no secret-key, tunnel-id, private-key, bearer-token, GitHub-token, tracked local-config or developer-path finding.

## First acceptance extension

`video-trend` is the first installed Agent Extension. Its first end-to-end domain acceptance job is the Hotel Lobby adaptation. That media job is not part of the Core v0.9.7 qualification and remains independently evidence-gated.
