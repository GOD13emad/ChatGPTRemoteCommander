# Commander Transfer Mesh — R06 Real-Host Canary and Failure Analysis
Date: 2026-10-13
Scope: synthetic payloads only, four user-scoped Commander Transfer Pilot roots; stable Core 0.10.20 unchanged.

## Canary receipts
1. Emad PC -> Linux (64 MiB): ctmesh-r06-realnet-pc-linux-64m; local durable job QUEUED -> PUBLISHED and receiver RECEIVED_HASH_VERIFIED -> DELIVERED_HASH_VERIFIED.
   SHA256 557CEEC543DB04917BF57484D8C440203041A18EEA6B2AAAA8911905054D4D93.
2. EmadServer -> PC (16 MiB): ctmesh-r06-emadserver-pc-16m; source durable PUBLISHED and destination DELIVERED_HASH_VERIFIED.
   SHA256 BF7AE0C9ECCAAF8B82026EABA7F63310215CD3CAFC36280AFB4D22B5A8CC8C5E.
3. Amirreza -> PC (16 MiB): ctmesh-r06-amirreza-pc-16m; source durable PUBLISHED and destination DELIVERED_HASH_VERIFIED.
   SHA256 B7144CB6DE3067ED6178E956CF8BC306DA0CC0DD04B1028A739DA9C9B56447C5.

All source and destination receipts were machine-produced; no actual user project datasets handled. The R06 standalone script was added to all four user-scope pilot roots after SHA256 check. No runtime Commander install, registry service, firewall, VPN or running Syncthing config changed.

## Crash and stress evidence
- A 512 MiB sparse synthetic test source was transferred in a private fixture; the detached copy worker was forcibly terminated after partial copy, status recovered as INTERRUPTED, resumed from staged bytes and published with manifest SHA256 matching the source. PASS.
- Initial full Windows npm test failed on transient EPERM rename in the crash regression. Root cause: Windows file handle release/rename denial immediately after forced termination under parallel load. Added bounded retries ONLY for EPERM/EBUSY/EACCES on atomic job checkpoint and staging promotion rename, never for unrelated error classes.
- Five subsequent consecutive 512 MiB process-kill/resume tests all exited 0.
- Linux native+durable focused suite 13/13 PASS with real symlink source denial.
- R06 native HTTP MCP integration asserts eight opt-in native tools, 12 MiB background job completion, path policy, and requestId behavior.
- Full Windows npm run check + npm test rerun after bounded retry PASSED, both exit code 0. Five consecutive Windows 512 MiB real process kill/resume tests PASS; Linux real 512 MiB process kill/resume PASS.

## Important safety and limits
PUBLISHED indicates local file made available to Syncthing, not end-recipient delivery; only DELIVERED_HASH_VERIFIED is end-to-end.
Native tools are still hidden from stable installed Commander v0.10.20; the root-local durable CLI was exercised only through Remote Commander run_shell tools.
The queue remains an isolated opt-in candidate, not fully production qualified. Remaining: control plane progress and cancellation stress across four hosts, concurrency/quotas/cleanup and retention, Windows OS-reboot startup, cross-device native tool startup after core upgrade, publisher signing/rollback.
Avoid automatic syncing of arbitrary project roots; use explicit absolute allowlists per host.

## Evidence status
OPERATING_CANARY_PASS / PRODUCT_FINAL_BLOCKED.

## R06 all-device 12/12 directed real network matrix
Four synthetic source files, each 1 MiB, three pair-specific recipients per source.
All twelve jobs: QUEUED -> PUBLISHED at source, RECEIVED_HASH_VERIFIED -> DELIVERED_HASH_VERIFIED at exact target node.
Every machine received three files with the corresponding SHA256 below:
PC: 21C15B4E059A3809A290763E1B411943400385B14FCC0321BD1BFE75BCD9E31E
Linux: A34DF5CD7E423DF2E0DF129971DDB67BC0938DEF910AABAEC1884BB234808D19
EmadServer: 3B5BEBC82406B6A9E49CA32E5704797C06D0BE4E61A453952D0D0950F9625F02
Amirreza: F3B148DE80D01C6F1E5D6BCFA7CA792D71A2C57123E842F67BFE1AD064A668DD
Twelve independent machine-produced DELIVERED_HASH_VERIFIED receipts obtained using existing stable Commander shell access; no native new MCP tool deployment yet.
