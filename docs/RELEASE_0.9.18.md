# ChatGPT Remote Commander v0.9.18

Date: 2026-09-28

## Objective

Close three bounded post-v0.9.17 operational gaps without weakening Commander authority boundaries:

1. do not convert a successful candidate-first Windows update into installer failure merely because the temporary updater checkout disappeared or could not be removed during final cleanup;
2. enforce background/headless PowerShell launches in Windows qualification/runtime helper paths so project work does not surface console windows;
3. complete the external Agent Extension contract with relevance routing and bounded skill retrieval, while keeping domain Skills outside the Commander core package and installer.

## Change set A — installer cleanup outcome integrity

The existing Windows wrapper could print `SAFE_UPDATE_PASS` and then return exit code 1 from its `finally` cleanup if the temporary updater directory was already absent/raced during removal. Cleanup is now best-effort after the update outcome is known and emits `UPDATER_TEMP_CLEANUP_DEFER` instead of overriding a successful update result.

## Change set B — headless execution invariant

Commander runtime process launches already use `windowsHide:true`, `CreateNoWindow=true`, or `WindowStyle Hidden` in the main execution paths. The remaining gap was Windows test/qualification helpers that directly spawned `pwsh.exe` without `windowsHide:true`. Those helpers are hardened and a regression gate checks the audited PowerShell child-launch paths.

Foreground UI remains permitted only when the actual task application requires it or the user explicitly requests it. Console/terminal windows are not an allowed progress surface.

## Change set C — external Skill-aware Agent Extensions

Agent Extension packages remain external under `~/.agents/extensions` (or another explicitly configured external directory) and are not bundled in the Commander installer/release assets.

Two new read-only tools complete the routing flow:

- `agent_extension_route(task)`: ranks installed extensions using declared triggers and domain metadata.
- `agent_extension_skill(id)`: returns the bounded validated Skill content and SHA-256 for the selected extension.

The core Remote Commander Skill now routes non-trivial domain work through these tools when a relevant installed extension exists. Extension instructions remain subordinate to system/user/Commander policy and cannot grant execution authority.

## Local external extension set used for acceptance

Owner-selected project Skills installed separately from Commander core:
- `ansys-modeling`
- `project-execution-brain`
- `final-thesis-report`

The owner-private `video-trend` / film-making extension is explicitly excluded from this rollout. A standalone COMSOL Skill was not found in the authoritative local Skill catalog during this change set and remains MISSING/UNVERIFIED.

## Acceptance gates

1. focused installer/headless/extension tests;
2. external extension list/route/skill read-only acceptance;
3. full Windows check/test/audit;
4. clean Linux exact-tree check/test/audit and release-asset build;
5. hosted Windows + Ubuntu CI on exact candidate SHA;
6. immutable release publication with verified assets/checksums;
7. candidate-first rollout and live version/status checks.

FINAL remains UNPROVEN until these gates complete.
