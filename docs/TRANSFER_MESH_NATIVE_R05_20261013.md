# Commander Transfer Mesh — native MCP adapter R05 (candidate)
Status: **isolated source candidate**, not installed/released. Base repository: GOD13emad/ChatGPTRemoteCommander main 0.10.21, HEAD e3fe4e3e22679ebdae346612f6e20d9879661b36. Branch: feature/commander-transfer-mesh-r05.

## What is implemented
Opt-in four-tool MCP interface: transfer_mesh_info (read-only), transfer_mesh_send (mutating, returns QUEUED), transfer_mesh_status (read-only, verifies received staging file), transfer_mesh_receive (mutating, verifies SHA256, refuses overwrite).
The tools call a portable Node CLI via execFile, not shell. Source and destination are explicitly allowlisted and checked using realpath (including symlink handling). The process runs with existing account privileges; file bytes travel via private Syncthing authenticated peer folders, not via ChatGPT requests.

Native tool registration is hidden unless BOTH powerMode.enabled=true AND transferMesh.enabled=true. Registration reports transferMesh.enabled in system_status. This feature does not grant privileges or make existing full-filesystem policies weaker. Existing Commander tooling and GUI control are not changed by default.

## Example configuration
Add ONLY after validating approved paths on that specific device (these are illustrative paths, not a live configuration):
```json
{
  "transferMesh": {
    "enabled": true,
    "root": "C:\\Users\\Aa.Emad\\AppData\\Local\\CommanderTransferPilot",
    "sourceRoots": ["C:\\Users\\Aa.Emad\\Documents"],
    "destinationRoots": ["C:\\Users\\Aa.Emad\\Downloads"]
  }
}
```
Linux root: /home/aliemad/.local/share/commander-transfer-pilot, with Linux-appropriate sourceRoots and destinationRoots.
Do not configure a root that points at the entire filesystem unless separately approved; private or regulated data requires explicit transfer authorization. Per-device user, tool and path scopes are distinct from ChatGPT account membership.

## Tool workflow
1. transfer_mesh_send(peer, path, id, requestId): materializes source to a pair-specific Syncthing staging folder. Returns QUEUED, NOT delivery success.
2. transfer_mesh_status(peer, id) on destination: returns PENDING, or RECEIVED_HASH_VERIFIED after independent size and SHA256 verification.
3. transfer_mesh_receive(peer, id, dest, requestId) on destination: materializes the verified file using exclusive hardlink+rename safety and returns DELIVERED_HASH_VERIFIED.
4. Never retry a mutating command with a different requestId after UNCERTAIN effect; inspect status and filesystem first. Avoid sending to unauthorized devices or over regulated relay paths.
Tool timeout is bounded to 14 seconds; larger source staging needs a future durable job worker for production-grade multi-GiB sends. Syncthing background peer-to-peer transport is resumable; this does NOT guarantee a long local staging command completes under the RPC deadline.

## Quality gates
- New unit tests: test/transfer-mesh-native.test.mjs
- HTTP MCP integration + requestId behavior: test/transfer-mesh-http.test.mjs
- Cross-platform pilot CLI tests: tools/commander-transfer-mesh/pilot-cli.test.mjs
- Existing dual-era MCP conformance + mutation-idempotency + capability-profile unchanged.
- npm test and npm run check include the new tests/checks.

## Open before release
- Native tools must not be advertised on installed 0.10.20 until a separately approved 0.10.21+ candidate is verified and safely promoted; this branch is only a candidate.
- Production large-file queueing, durable cancellation/progress, retained transfer audit (without logging file contents), old transfer cleanup, symlink/hardlink races, and hard interruption/reboot tests remain open.
- Startup readbacks have been verified on four systems; Windows restart/login behavior not exercised.
- A release must pass complete project checks and staged install rollback, then promote one stable version on all target nodes without deleting prior user data. Do not merge unrelated changes from the dirty historical 0.10.6 working tree.
