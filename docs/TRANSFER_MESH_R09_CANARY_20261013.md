# Commander Transfer Mesh — R09 cold-start compatibility and four-host handoff
Date: 2026-10-13
Status: isolated development candidate, no stable Core promotion.

## R08 authoritative finished checks
GitHub commit 3a9fb59c137944ca772aed6866b0933daa4df683, PR #202 (Draft).
CI Windows + Ubuntu: SUCCESS; Release Sync: SUCCESS; Server Install Canary: SUCCESS; Windows NoPromote updater: SUCCESS.
A Windows installer artifact named remote-commander-windows-setup (170,713,250 compressed bytes) is attached to the R08 Release Sync workflow. Installer signing of the final generated executable was not verified; do not claim a signed production release.

## R08 server canary — real source-distribution case
Direct git clone on EmadServer and Amirreza was unresponsive. Both Git operations stopped safely; empty temporary QA roots and launchers cleaned.
From Emad PC committed source, git archive HEAD src tools/commander-transfer-mesh package.json yielded 216,783 byte ZIP with SHA256:
37E4394C3ED62017A7DBB82CD3E47E412992C85719B93DE3E460CD7A7906848D.
Portable Transfer Mesh successfully queued/transferred this bundle from PC separately to EmadServer and Amirreza. Each receiver returned RECEIVED_HASH_VERIFIED and DELIVERED_HASH_VERIFIED with matching archive hash.
Both servers staged isolated native Core v0.10.21 source from the archive with a version-matched portable backend (contractVersion 2), using separate loopback listeners 47994/47995 and user-private pilot QA folders, NOT the live Syncthing pilot.
Both advertised exactly 8 native transfer_mesh_* tools.
Both rejected a 4 KiB synthetic file under a 1 KiB configured quota; neither recorded a rejected job.
Both queued a 512-byte synthetic source and reached local PUBLISHED with SHA256 matching original.
One Amirreza cold startup initially failed with TRANSFER_DURABLE_BACKEND_INCOMPATIBLE even though a direct backend capabilities command immediately afterward was successful. Re-running the identical source without changes succeeded. Suspected Node/AV cold-start timeout from the former 3500 ms single-attempt execFileSync check.
Both QA servers and listeners then stopped; the isolated QA roots and temporary launchers were cleaned after path/identity checks. The synthetic ZIP and prior transfer receipts remain in user pilot data; no user project data or original installation was overwritten.

## R09 change
src/transfer-tools.mjs now runs up to two bounded capability probes, 5000 ms each, only for transient command launch/non-JSON errors. A well-formed explicitly incompatible capabilities document still fails immediately with TRANSFER_DURABLE_BACKEND_INCOMPATIBLE; no data is queued and only already-enabled R05 tools may work without durableEnabled.
Added deterministic native unit test in test/transfer-mesh-durable-native.test.mjs: simulated first capability subprocess failure followed by valid second response; Windows and Linux focused tests 6/6 PASS per host. Full npm check/test and fresh R09 GitHub CI require readback after execution.

## Runtime/persistence observations
All four stable Commander Core servers remained 0.10.20. Syncthing v2.1.6 pilots all healthy with 3 connected peers, 3 pair-only folders, broadcast paused.
Emad PC had one direct TCP and two public relay connections; Linux had direct TCP and QUIC. The official Syncthing relaying docs say relays are end-to-end encrypted but generally slower; tuning NAT/TCP/QUIC requires controlled network measurements and rollback.
Server Amirreza has no CommanderTransferMeshPilot scheduled task but has a valid Windows Startup shortcut targeting the correct user-scoped Syncthing binary and state. Avoid adding a duplicate scheduled task.

## STILL OPEN before product FINAL
No version-matched native R09 Core + pilot stable atomic upgrade and rollback on all four; no OS reboot/logon recovery evidence; signature/provenance checks for Windows installer incomplete; Linux installer/update receipts incomplete; precise remote progress, archival retention and privacy approval remain open.
R09 PR stays Draft; preserve all existing pilot and stable runtime user state.
