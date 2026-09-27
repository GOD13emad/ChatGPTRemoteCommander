# v0.9.8 qualification

Status: CANDIDATE — Core-only reconciliation release.

v0.9.8 rebases the generic Remote Commander-Agent Extension Contract v1 onto the fully qualified v0.9.6 main line, preserving the final Windows retained-root fixes while keeping all domain-agent products outside the Core repository.

## Included

- Generic bounded `agent.json` manifest contract and registry.
- External-by-default discovery from `~/.agents/extensions`, with explicit config override/disable.
- Read-only MCP tools: `agent_extension_list`, `agent_extension_get`, `agent_extension_match`.
- `system_status` extension schema/count/diagnostics.
- Fail-closed validation for invalid fields, path traversal/realpath escape, non-regular or multiply-linked manifest files and duplicate IDs including multi-way conflicts.
- Existing v0.9.6 stream-closeout, durable delivery, power recovery, zero-downtime update and retained-work guards remain in ancestry.

## Explicit exclusions

- No concrete Agent implementation, Agent project, media/document/CAD/scientific pipeline, private Agent asset or domain-specific evidence is shipped in the Commander repository.
- Agent product acceptance is owned by each Agent project. Commander qualification verifies only the generic contract and integration boundary.

## Qualification gates

- Generic Agent Extension unit + HTTP integration.
- Full check/test/audit.
- Windows and Linux runtime contracts.
- Schema continuity and candidate-first updater qualification on both platforms.
- Fresh-install/update authority alignment before Stable publication.

Promotion is forbidden until all applicable gates pass on the exact release commit.
