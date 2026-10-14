# Mohammad Linux R170 — verified isolated real promotion and rollback

**Date:** 2026-10-14. **Result:** `PASS_LINUX_REAL_PROMOTION_AND_ROLLBACK_IN_ISOLATED_HOST`. **Host:** fresh Ubuntu GitHub-hosted runner, **NOT Mohammad's connected Linux workstation**. **Production v0.10.20 remains unchanged; project NOT FINAL.**

## Previous authority → accepted delta

- Linux-only Draft PR #204 source code commit `1ad6ce5bdee54d79eebf7efaf9f045d35c2fd146`, tree `1adff978d84395f4c3303e98a92de0e26d7abc9c`. Narrow safety guard requires `GITHUB_ACTIONS=true`, `RUNNER_OS=Linux`, `RUNNER_ENVIRONMENT=github-hosted` before side effects. Three local negative guards exit 60; `check:qualification` and `audit` PASS. Source https://docs.github.com/en/actions/reference/workflows-and-actions/variables .
- Dedicated GitHub Actions workflow `Core real promotion and rollback R170 (isolated Linux)`, run **38552182614**, job **115812535065**, completed **SUCCESS** with all steps successful including `Real version promotion then rollback in fresh isolated runner` and artifact upload.
- Run URL: https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/38552182614
- Full uploaded R170 artifact ID **11887566825**, name `r170-linux-promotion-rollback-evidence`. Owner-private durable archive `~/.local/share/rc-local-ai/evidence/r170_linux_1ad6ce5_20261014.zip` mode 0600, SHA256 **25e83d68788105b67755c0f5030068d996c6d0f5fe482738245b4d9911218109**. Archive content inspected and SHA recomputed independently; GitHub artifact expiration was seven days at creation and the private copy is the long-term raw provenance.

## Raw independent receipt verification

| Exact evidence file | SHA-256 |
|---|---|
| `START_R170.txt` | `40e1c09d56d94f7d1f0a66e52dba42b62b89be9bf7a603c216f8342986a7e841` |
| `PROMOTE_R170.log` | `8168c2baa2383ed3b6aa6026db32e8c10d2660021266384c7ed25d3c4793e9ef` |
| `ROLLBACK_R170.log` | `241cf055432cc7eec56dcfffae7f326a623200c139eff231d7dfefa540de1bdc` |
| `ROUTE_AFTER_PROMOTE.json` | `b6f148807d7a95cb34cab4a4adaab93495abdc25c4fd2fe39e05986adad05d1e` |
| `ROUTE_AFTER_ROLLBACK.json` | `2f738770cd38d7d0208658dc050045107c217b50ffdde1f90b14273990db33be` |
| `RETURN_R170.json` | `4c79b617b93e9dbb8c053cf7c1d7dd879dae7aa513c27a442d8d8cf7069680cf` |
| `CLEANUP_R172.json` | `4f97364390edda455677cdcb623fcbb251f22f35db05b6416434537a27f64eb7` |

Receipt `RETURN_R170.json` states `schema=1`, `revision=R170`, `isolatedHost=true`, `userHostMutation=false`, **`status=PASS_LINUX_REAL_PROMOTION_AND_ROLLBACK_IN_ISOLATED_HOST`**, candidate head `1ad6ce5bdee54d79eebf7efaf9f045d35c2fd146`, rollback baseline head `362375c464948be3001b307650c13fc3353ed05b` (published `v0.10.20` tag).

Promote log explicitly includes `CUTOVER_COMMIT version=0.10.21 commit=1ad6ce5bdee54d79eebf7efaf9f045d35c2fd146` and `AUTO_UPDATE_PASS version=0.10.21`. Rollback log explicitly includes `SCHEMA_CONTINUITY_GATE_PASS profile=default`, `CUTOVER_COMMIT version=0.10.20 commit=362375c464948be3001b307650c13fc3353ed05b` and `AUTO_UPDATE_PASS version=0.10.20`. The receipt hashes matched independently calculated ZIP contents.

`CLEANUP_R172.json` reports `status=PASS_ZERO_OWNED_NODE_AFTER_ROLLBACK`, `ownedBefore=[10723,17810]`, **`ownedAfter=[]`**, `cleanupUsed=true`, `externalNodeProcessesTouched=false`. Its SHA exactly equals the internal `cleanupSha256` recorded in `RETURN_R170.json`.

## Evidence boundaries / decision

**Accepted/closed:** actual tagged v0.10.20 → exact v0.10.21 Git commit → tagged v0.10.20, with router cutover, schema gate on rollback, rollback receipt and no owned Node process leaks **on a fresh isolated GitHub Ubuntu runner**. Previously local Linux 22 targeted tests, 19 router logic tests, independent Full Power 97/97 tool-catalog/schema comparison and source security audit passed.

**Not proven / remaining critical path:** no immutable official `v0.10.21` tag/release at checked time; PR #204 remains Draft/unmerged; no active Linux workstation promotion or true user-session/browser credential/durable-workflow persistence under cutover. Its live Router generation 116 still had `previous=null`; this is normal without a pending cutover but cannot itself serve as a validated live rollback route. Packaging/signing/native UI acceptance remains OPEN as explicitly marked in R170 receipt.

**Decision:** do not auto-create release tags from a Draft PR or switch the connected user-host service. Require explicit release authority and an in-place reversible production change plan protecting active v0.10.20, routing/config SHA, profile/login, workflow SQLite and exact session. Keep current installed stable v0.10.20 and runner/autoTick disabled. **Verification ≠ Validation:** isolated upgrade/rollback PASS does not prove real-session continuity. Project Brain milestone CURRENT; overall product PARTIAL_NOT_FINAL.
