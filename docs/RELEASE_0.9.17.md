# ChatGPT Remote Commander v0.9.17

Date: 2026-09-28

## Objective

Repair immutable-release packaging without changing v0.9.16 runtime policy or execution semantics.

v0.9.16 qualified and rolled out successfully, but its GitHub Release was published before install/plugin assets were attached. Because the repository uses immutable releases, the published release cannot accept those assets afterward. This breaks the documented `releases/latest/download/plugin-template.zip` installation path.

## Root cause

The Release Sync workflow called `gh release create` with notes only, then a later manual upload attempt was rejected by immutable-release protection.

GitHub's documented immutable-release workflow is to attach assets while the release is still a draft and publish only afterward. GitHub CLI implements that when asset files are passed directly to `gh release create`.

## Change

- Add a deterministic release-asset builder.
- Restore stable and versioned `plugin-template.zip` assets.
- Restore the installer bundle and direct installer/document/icon assets.
- Add Windows Server and Linux Server bootstrap scripts to the release asset set.
- Generate and verify `SHA256SUMS.txt` before publication.
- Publish all assets in the same `gh release create` command.
- Keep immutable releases enabled; no security setting is weakened.

## Runtime delta

Runtime behavior is unchanged from v0.9.16 except for the version identifier. Owner-authorized Codex environment cleanup, stale-schema GUI authorization, default-deny controls, hidden-runner No-Codex behavior, zero-downtime update, durable workflows, and server bootstrap logic are unchanged.

## Acceptance gates

1. release-asset contract and deterministic Linux asset build;
2. full Windows check/test/audit;
3. clean Linux exact-tree check/test/audit plus asset build/checksum verification;
4. hosted Windows + Ubuntu CI on the exact candidate SHA;
5. immutable tag/release publication with 15 assets;
6. download and checksum verification from the published release;
7. `releases/latest/download/plugin-template.zip` availability;
8. candidate-first Windows/Linux/HPC rollout and live version checks.

FINAL remains UNPROVEN until all gates complete.
