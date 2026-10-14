# Commander Transfer Mesh R05 — Release gates and handoff
Date: 2026-10-13
Product status: **NATIVE_SOURCE_CANDIDATE / STABLE_NOT_UPDATED**
Owner requirement: fast direct/relay transfers between four linked Commander devices, without routing large bytes through ChatGPT. This feature does NOT include any university VPN/RDP integration.

## Authoritative baselines
Upstream fetched branch main: GOD13emad/ChatGPTRemoteCommander, commit e3fe4e3e22679ebdae346612f6e20d9879661b36, version 0.10.21.
Isolated checkout: C:\Users\Aa.Emad\source\repos\RC_TRANSFER_MESH_INTEGRATION_20261013 on feature/commander-transfer-mesh-r05.
Running Commander on all four devices: 0.10.20. Do not claim those devices expose native transfer_mesh_* MCP tools until separately verified after staged promotion.
Older development tree 0.10.6 contains unrelated dirty work and has not been modified by R05 integration.
Data plane remains independent Syncthing v2.1.6 Portable, installed and running for four devices.

## Done with evidence
1. Four portable peers, 6 pair-only folders, 12/12 directed synthetic transfers SHA256 verified (prior R04 evidence), relay/direct path working.
2. 32 MiB tested on LAN and paused relay receiver resumed, final SHA256 matched. Actual abrupt process death while bytes are in-flight is not tested.
3. Read-only doctor.mjs installed on all four user pilot roots; each returned ok:true, activePairCount:3, connectedPeers:3, legacyBroadcastPaused:true, staleMisconfiguredActive:0, version syncthing v2.1.6.
4. New native MCP module transfer-tools.mjs and four opt-in tools implemented; defaults hidden when power/feature not explicitly enabled. Source and destination realpaths restricted to per-device allowlists. ExecFile bypasses shell, fixed timeout. RequestId enforced by existing mutation idempotency engine.
5. Native module Windows 4 tests pass; portable CLI 4 tests pass + Windows symlink creation privilege SKIP; Linux combination 9/9 pass with real symlink regression.
6. Real HTTP MCP integration test passed: add tool exposure when opted in, invalid source denied, valid send staged, replay idempotent, conflicting mutation rejected. Base 23 regression tests pass. Agent-extension HTTP fixture previously failed due static import, repaired by opt-in dynamic import; affected 3-test focused suite subsequently PASS.
7. npm run check completed with exit 0 after dynamic fix (log under current pilot local application data; do not upload unfiltered logs externally).
8. All Windows scheduled tasks and Linux user service registered in R04; Windows reboot/login still unverified.

## Gates remaining before stable FINAL
- npm test R05 full suite PASS (exit 0); npm run check PASS (exit 0) after opt-in dynamic import compatibility fix. Final new suite 9 PASS, 0 FAIL, 1 Windows Symlink creation permission SKIP. doctor.mjs passed node --check separately.
- Review and land R05 feature in current upstream safely, preserving unrelated changes and release policy.
- Staged upgrade to signed/stable version on development host, canary and then remaining three; no destructive reinstall, preserve transfer state and all other Commander profiles.
- Enable per-host transferMesh policy with explicit sourceRoots and destinationRoots, then read back native tools/list for each of four *running* installations.
- End-to-end calls initiated through new native tools on all four devices, not just direct CLI; validate auth + idempotency + sha256 receipts.
- Hard crash/resume of partial in-flight multi-GiB transfer, future retry behavior, retention/cleanup, concurrency and performance budgets.
- Windows task execution after logoff/logon or reboot; Linux service after reboot (no reboot was performed, controlled handoff tested instead).
- User-facing progress and status/pause/cancel tooling for large data transfers; current native tool status verifies arrival, but does not yet provide accurate per-file progress percentage.
- CI/CD build and release artifacts, multi-platform install/update/rollback receipts before final.

## Security and rollback
Syncthing GUI is loopback-only; API key never sent in chat. Syncthing peer identities are pinned TLS device certificates, not inherited from ChatGPT account.
No project data auto-synced; historical broad 4-way synthetic folder paused everywhere. Invalid or unexpectedly large/unbounded operations must not circumvent source/destination scopes.
Default config feature disabled; rollback for new native tools is to disable transferMesh config, retaining old pilot data and transfer history. No system firewall, VPN or OS privilege changes.
Never claim source COMMITTED, PUSHED or deployed until git/connector readback confirms.

## Useful paths
- src/transfer-tools.mjs
- tools/commander-transfer-mesh/pilot-cli.mjs
- tools/commander-transfer-mesh/doctor.mjs
- test/transfer-mesh-native.test.mjs
- test/transfer-mesh-http.test.mjs
- tools/commander-transfer-mesh/pilot-cli.test.mjs
- docs/TRANSFER_MESH_NATIVE_R05_20261013.md

## Official standards
https://docs.syncthing.net/dev/rest.html
https://github.com/syncthing/syncthing/blob/main/man/syncthing-security.7
https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx

## Candidate handoff closure (source gate)
Native source candidate verified by full Windows tests and Linux native 9/9 PASS. Four live pilot doctor checks each returned ok=true, activePairCount=3, connectedPeers=3, legacy broadcast paused. This does NOT authorize blind stable promotion, project folder auto-sync or OS reboot. Stage canary with explicit config before deploying native tools.
