# ChatGPT Remote Commander v0.9.16

Date: 2026-09-28

## Objective

Close the remaining end-to-end gap in explicit owner authorization without weakening the default-deny model.

v0.9.15 correctly fixed stale-schema GUI takeover and changed local Codex launch from an absolute block to a narrow explicit-owner opt-in. Live rollout then exposed one inherited-environment defect: an authorized Codex launch could still inherit Commander's old no-Codex `CODEX_HOME` sentinel from a parent process created before authorization became active.

This release also makes the current plugin/tool guidance consistent with the live policy.

## Previous accepted state

v0.9.15 is integrated and tagged at `538c1dee6a0723f91ff1bd8f68585fbc60b6f8a2`.

Windows live acceptance already confirmed for both `default` and `saeed-emad`:
- `FULL_POWER` and `explicitlyAuthorized=true`;
- `powerMode.guiControl.ownerAuthorizedTakeover=true`;
- `powerMode.codexControl.allowLaunch=true`;
- stale ChatGPT schema calling `gui_session_begin` without `mode` returns `mode=takeover` and `authorization=owner-persisted`;
- delegation status reports `owner-authorized-local-launch`.

## Codex environment defect

Live `codex --version` through the authorized Commander path exited 0 and reported `codex-cli 0.146.0`, proving the former hard block was removed. It also warned that `CODEX_HOME` still pointed to a generated path under `chatgpt-remote-commander-no-codex`.

Root cause:
- denied Commander child processes intentionally receive a private no-Codex `CODEX_HOME`;
- a later authorized process can inherit that generated sentinel through a parent;
- v0.9.15 removed `REMOTE_COMMANDER_NO_CODEX` for authorized launches but preserved every inherited `CODEX_HOME`, including its own stale sentinel.

Fix:
- when local Codex is authorized, remove `REMOTE_COMMANDER_NO_CODEX`;
- remove `CODEX_HOME` only when it resolves inside Commander's generated no-Codex sentinel root;
- preserve a legitimate user-supplied `CODEX_HOME` such as a real Codex home directory.

## Instruction consistency

Current operational guidance now distinguishes three paths:

1. Current ChatGPT + Commander remains the default reasoning/execution path.
2. Local Codex launch is default-deny and is permitted only for an explicitly authorized `FULL_POWER` owner profile with `powerMode.codexControl.allowLaunch=true` and a current request that explicitly asks for Codex.
3. External Work/Codex handoff is a separate choice and still requires an explicit current-chat selection.

The hidden/background project runner remains No-Codex and cannot silently become a reasoning agent.

## Async CI gate stabilization

A docs-only follow-up exposed a second platform-specific async-lifecycle test timing failure on Ubuntu. Node.js documents that child `exit` may precede stdio closure and that `close` occurs after shared streams close. The test fixture previously depended on natural event-loop exit of a detached grandchild with inherited stdio, which was platform-sensitive.

The fixture now explicitly exits the direct child after flushing its own output, while the detached grandchild keeps inherited descriptors open. Production worker behavior is unchanged.

## Acceptance gates

1. focused no-Codex/authorization regression;
2. focused async-operation regression;
3. Windows full `npm run check`, `npm test`, `npm run audit`;
4. hosted Windows + Ubuntu CI on the exact candidate SHA;
5. immutable merge/tag;
6. candidate-first rollout;
7. live canaries:
   - stale-schema GUI takeover remains `owner-persisted`;
   - authorized `codex --version` succeeds without the Commander no-Codex `CODEX_HOME` warning;
   - a legitimate owner `CODEX_HOME` remains preserved;
   - Standard/non-authorized profiles remain default-deny;
   - hidden project runner remains No-Codex.

FINAL remains UNPROVEN until all gates complete.
