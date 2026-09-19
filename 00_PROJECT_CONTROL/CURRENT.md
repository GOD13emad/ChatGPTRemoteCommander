# Current Authority

- Project: ChatGPT Remote Commander
- Owner/client: repository owner `GOD13emad`; target operators are Emad and Saeed.
- Baseline: `v0.7.3` / `70e297194614b7cfd35825ba4cd9609d41e06a0c`.
- Current revision: `v0.8.0` blue/green R1 release candidate.
- Source authority: **PENDING / UNPROVEN** until the final staged tree passes every source gate, is committed once, and tag `v0.8.0` peels to that exact commit. After tagging, resolve it with `git rev-parse v0.8.0^{commit}` and compare it with `release-authority.json`.
- Runtime authority: `%LOCALAPPDATA%\ChatGPTRemoteCommander\control\managed.json`, per-profile router pointer, runtime marker, exact release record, and live health evidence.
- Deployment order: Emad canary first, then the same exact commit on Saeed.
- Stateful terminal zero downtime: **UNPROVEN and not claimed**. Any owned running terminal blocks promotion.
- Power-loss durability of the Windows pointer rename: **UNPROVEN**. Corrupt or missing pointer state fails closed.
- `FINAL / PUBLISHED / LIVE`: permitted only after both computers and every expected profile converge on the same tagged commit and real Secure MCP Tunnel E2E passes.

## Current blocker rule

One effective blocker at a time. Any unknown listener, identity mismatch, unresolved workflow intent, GUI stop/lease, dirty tracked tree, manifest mismatch, rollback uncertainty, or unavailable required connector is a STOP—not an implicit PASS.

Current external gate: the available Emad connector is the isolated `saeed-emad` profile only. Emad primary can be inspected through local loopback but its real Secure MCP Tunnel E2E is unavailable and therefore `UNPROVEN`. Saeed C: free space was measured at only 5.630 GiB and requires a peak-space preflight before any staging.
