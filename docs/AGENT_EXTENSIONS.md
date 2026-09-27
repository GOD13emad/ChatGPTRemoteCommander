# Remote Commander-Agent Extensions

Status: Agent Extension Contract v1

Remote Commander-Agent Extensions are declarative capability packs. They make reusable domain agents discoverable without granting them new execution authority. The Core remains responsible for filesystem, command, browser, GUI, workflow, idempotency, recovery, audit, and Project Engine policy.

## Contract

Each extension is one directory containing an `agent.json` manifest. It may also contain a `SKILL.md`, references, scripts, or schemas.

Default discovery roots:
- `<Remote Commander checkout>/agent-extensions`
- `~/.agents/extensions`

An administrator may override them with `agentExtensions.directories` in the local config. Set `agentExtensions.enabled=false` to disable discovery.

## Required manifest fields

- `schemaVersion: 1`
- `id`: lowercase stable extension id
- `version`: semantic version
- `displayName`
- `description`
- `capabilities`: unique declarative capability ids

Optional fields include triggers, a contained skill path, a project root, router metadata, runtime/model/tool dependencies, hardware requirements, safety gates, and expected artifacts.

## Security boundary

The registry is read-only. A manifest cannot execute code, expand Commander authority, enable GUI takeover, bypass project roots, or bypass workflow checks. It only describes a capability. Execution must still use an authorized Commander tool, durable workflow, Project Engine run, or another explicitly permitted surface.

Invalid manifests are excluded and reported as diagnostics. Duplicate extension ids fail closed rather than selecting one by path order. Skill paths must remain inside the extension directory. Manifests must be regular single-link bounded files.

## Tools

- `agent_extension_list`: list validated extensions and discovery diagnostics.
- `agent_extension_get`: return one validated manifest.
- `agent_extension_match`: find extensions declaring all requested capabilities.

`system_status` reports Agent Extension schema/count/diagnostics.

## Development flow

1. Keep the production Remote Commander checkout immutable while developing.
2. Build an extension in a separate project/worktree.
3. Install the declarative pack under `~/.agents/extensions/<id>`.
4. Validate the manifest and relevant skill.
5. Run a representative short job before long/high-cost work.
6. Promote only after domain-specific evidence gates pass.

## Video Trend reference extension

The first acceptance extension is `video-trend`. It routes between reference-preserving edits, motion transfer, lip-sync, full generation, enhancement and social export while reusing the shared ComfyUI/model inventory. Real-person identity editing remains gated by explicit permission/authority and source/reference rights review.
