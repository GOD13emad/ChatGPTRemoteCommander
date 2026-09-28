# ChatGPT Remote Commander v0.9.15

Date: 2026-09-28

## Objective

Make explicit owner authorization effective without weakening default safety.

This release fixes two concrete authorization mismatches:
1. an already-open ChatGPT connector may retain an older GUI tool schema that cannot transmit the newer `mode=takeover` and `explicitUserAuthorization` fields even though the live Commander supports them;
2. Codex launch was hard-blocked in Commander even when the owner explicitly authorized it.

## Previous accepted state

v0.9.14 is the standards-compliance baseline after the MCP Tasks unknown-task fix.

## GUI authorization change

Default behavior remains observe-only.

A persisted compatibility opt-in:
`powerMode.guiControl.ownerAuthorizedTakeover=true`

is honored only when:
- capability profile tier is `FULL_POWER`;
- `explicitlyAuthorized=true`;
- GUI capability itself is enabled.

When those conditions hold and a stale client omits `mode`, `gui_session_begin` may create a takeover lease and reports authorization provenance as `owner-persisted`.

Modern clients that can send `mode=takeover` continue to use per-call explicit authorization.

Standard or non-explicit profiles remain observe-only.

## Codex authorization change

The former absolute `CODEX_DELEGATION_FORBIDDEN` policy becomes default-deny with a narrow owner opt-in:

`powerMode.codexControl.allowLaunch=true`

This is effective only when:
- Power Mode is enabled;
- capability profile tier is `FULL_POWER`;
- `explicitlyAuthorized=true`.

Without all conditions, Codex remains blocked exactly as before.

The default reasoning path remains the current ChatGPT conversation. The opt-in permits local Codex launch when explicitly requested; it does not create automatic model delegation or silently replace ChatGPT with Codex.

## TinyFish benchmark

TinyFish currently provides:
- web search;
- browser-rendered content fetch/extraction;
- hosted browser automation runs;
- browser context profiles;
- optional credential vault use;
- stealth browser mode;
- proxy geography;
- webhook callbacks;
- structured outputs;
- screenshots/snapshots/recordings/HTML capture.

Remote Commander overlaps on browser navigation/input/screenshots and durable long-running execution, and additionally controls:
- local filesystem;
- shell/processes;
- persistent terminals;
- desktop GUI;
- local apps;
- durable workflows and checkpoints;
- project state/Brain;
- update/recovery infrastructure.

TinyFish's hosted search, proxy, vault and anti-detection services are complementary service capabilities, not missing local Commander primitives. They are not copied into Commander because doing so would add a separate hosted-service/security architecture without evidence that it improves the local-machine objective.

## Failure record

First focused v0.9.15 authorization run failed 103/104 because the new stale-schema GUI fallback correctly selected takeover but `gui_session_begin` did not return the authorization provenance field expected by the regression.

Root cause:
- internal session stored authorization provenance;
- response omitted it.

Fix:
- return `authorization: session.authorization` from `gui_session_begin`.

Regression:
- second focused authorization suite PASS 104/104.

## Acceptance gates

1. focused authorization regression PASS;
2. full Windows `npm run check`, `npm test`, `npm run audit`;
3. hosted Windows/Ubuntu CI on exact commit;
4. immutable Git integration/tag;
5. exact-tag installer/update acceptance;
6. candidate-first rollout;
7. live verification that:
   - Full-Power owner GUI fallback works for stale schemas;
   - Standard/default GUI stays observe-only;
   - Codex launch is allowed only under explicit owner opt-in;
   - all other profiles remain default-deny;
   - existing durable workflow/retry/recovery behavior is unchanged.

FINAL remains UNPROVEN until all gates complete.


## Hosted Windows qualification race

The first PR #36 hosted run passed Ubuntu but failed one Windows async durability regression after the operation had reached terminal state while its detached worker process was still completing exit/cleanup. The test then deliberately corrupted projection/receipt files and raced that tail cleanup.

The test guard now waits for the exact terminal state's `workerPid` to exit before deliberate corruption. This is test-only synchronization; production async/delivery semantics are unchanged. Ten consecutive Windows async-suite runs passed **140/140** after the fix.

Post-fix exact-tree Windows full gate then passed `npm run check`, `npm test`, and `npm run audit` with final exit 0 and `SECURITY_AUDIT_PASS`.
