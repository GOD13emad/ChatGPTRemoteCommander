# Remote Commander-Agent Extensions

Status: Agent Extension Contract v1

Remote Commander-Agent Extensions are declarative capability packs discovered and validated by Commander. Domain-agent implementation, assets, project evidence and product-specific pipelines live in their own project/repository; they are not part of the Remote Commander Core repository.

## Ownership boundary

Remote Commander Core owns discovery, manifest validation, capability matching, policy intersection, durable job/evidence integration hooks, lifecycle safety and shared-runtime metadata. A domain Agent owns its own code, prompts/skills, pipelines, assets, tests and domain acceptance.

Plugin/package distribution is separate from Agent identity. An Agent Extension may be invoked through ChatGPT, CLI, GUI or scheduler without moving its implementation into Core.

## Contract

Each installed extension is one external directory containing an `agent.json` manifest. It may also contain its own `SKILL.md`, references, scripts or schemas.

Default discovery root:
- `~/.agents/extensions`

Administrators may override discovery with `agentExtensions.directories` in local configuration. Relative configured paths resolve against the Commander checkout for compatibility, but product installations should use explicit external absolute paths. Set `agentExtensions.enabled=false` to disable discovery.

## Required manifest fields

- `schemaVersion: 1`
- `id`: lowercase stable extension id
- `version`: semantic version
- `displayName`
- `description`
- `capabilities`: unique declarative capability ids

Optional fields include triggers, a contained skill path, external project root, router metadata, runtime/model/tool dependencies, hardware requirements, safety gates and expected artifacts.

## Security boundary

The registry is read-only. A manifest cannot execute code, expand Commander authority, enable GUI takeover, bypass project-root leases, bypass workflow checks or grant itself permissions. It only describes a capability. Execution must still use an authorized Commander surface and the effective permission set is bounded by Commander policy.

Invalid manifests are excluded and reported as diagnostics. Duplicate extension ids fail closed rather than selecting by path order. Skill paths must remain inside the extension package. Manifests must be regular, single-link and bounded files.

## Tools

- `agent_extension_list`: list validated extensions and discovery diagnostics.
- `agent_extension_get`: return one validated manifest.
- `agent_extension_match`: find extensions declaring all requested capabilities.
- `agent_extension_route`: route a bounded natural-language task to relevant installed extensions using declared triggers and domain metadata. This is relevance discovery only; it executes nothing.
- `agent_extension_skill`: return the bounded validated `SKILL.md` for one selected extension together with its SHA-256. Skill instructions remain subordinate to system/user/Commander policy.

`system_status` reports the Agent Extension contract schema, discovery directories, valid count and diagnostics.

## Development and lifecycle

1. Keep Remote Commander Core immutable while developing domain Agents.
2. Build/test each Agent in its own project/repository.
3. Install or link its declarative package under `~/.agents/extensions/<id>` or an explicit configured external directory.
4. Validate the manifest and relevant skill/policy requirements.
5. Resolve declared shared runtimes without duplicating heavyweight dependencies when a compatible authoritative runtime already exists.
6. Run representative domain acceptance in the Agent project, not in the Core repository.
7. Commander release qualification uses generic fixtures only.


## Automatic Skill use

The Remote Commander ChatGPT/Codex Skill should route non-trivial domain work before execution:

1. call `agent_extension_route` with the current task;
2. when one installed extension has direct trigger/domain evidence, call `agent_extension_skill` for that exact id;
3. apply that Skill for domain reasoning while preserving Commander authority, safety, project-root and evidence rules;
4. do not infer availability for missing extensions and do not select an extension merely because it is installed.

Domain packages remain separately installed. The Commander installer and immutable release assets do not bundle owner/domain extensions.
