# Commander Transfer Mesh R06 — Durable Multi-GiB Staging Candidate

Date: 2026-10-13
Branch: feature/commander-transfer-mesh-r05 (PR #202); base upstream Core 0.10.21.
Status: SOURCE-CANDIDATE / NOT DEPLOYED TO STABLE COMMANDERS.

## Reason for R06
R05's native transfer_mesh_send delegates to a synchronous local CLI process with a strict 14-second bound, unsuitable for huge files. Syncthing transfers bytes between devices asynchronously, but staging into its per-peer folder still needed a durable, interruptible background worker.

## Code
- tools/commander-transfer-mesh/durable-send.mjs: exclusive durable job receipt in owner-private jobs/<peer>/<id>.json; detached worker; bounded-memory chunk copy into private staging outside the synced folders; checkpoint progress and resume from existing part file; double SHA256 source and staged output verification; exclusive destination publication with minimal manifest; no overwrites; supports job-status, resume and cancellation.
- src/transfer-tools.mjs: four ADDITIONAL tools behind transferMesh.durableEnabled=true (which also requires transferMesh.enabled and Power Mode):
  - transfer_mesh_enqueue — returns local QUEUED durable receipt, not remote delivery
  - transfer_mesh_job_status — local copiedBytes/status/percent
  - transfer_mesh_job_resume — explicitly resumes FAILED/INTERRUPTED jobs, rechecks CURRENT sourceRoots and source identity
  - transfer_mesh_job_cancel — cancellation request before publication
- Existing R05 info/send/status/receive remain compatible; not exposed by default if feature disabled.
- tool commands use execFile with arrays (no shell interpolations), canonical realpath source/destination allowlists, supported mutation requestIds.

## Evidence from synthetic fixture tests
- Windows native+durable adapter+HTTP and worker suite PASS in focused runs; HTTP test verifies eight opt-in tools and queue through real MCP HTTP, and source denial/idempotency from previous tests.
- Linux full native + portable+durable unit fixtures 13/13 PASS.
- Portable worker in controlled synthetic fixture stages 24 MiB and verifies SHA256.
- Interrupted synthetic 1 MiB partial staged file resumes using existing bytes and passes final SHA256.
- Crash boundary when payload is already published but manifest was not created: resume reconstructs missing metadata only after proving source and payload SHA256 match.
- Real process crash test: 512 MiB synthetic sparse source, terminate worker during partial copy, observe INTERRUPTED, resume, verify 512 MiB payload size and manifest hash: PASS.
- Duplicate transfer IDs, invalid sourceRoot, invalid peers, symlink source, corrupt payload, overwrite: fail-closed checks inherited or extended.

## What these statuses mean
QUEUE: job metadata recorded and detached worker launched; not proof of local or remote transfer completion.
COPYING: private local staging, copiedBytes tracks LOCAL bytes only.
VERIFYING: local SHA256 comparison of source and staging.
PUBLISHED: pair-specific Syncthing watched directory has valid payload and manifest; NOT remote delivery.
RECEIVED_HASH_VERIFIED: receiver has checked exact payload size and SHA256.
DELIVERED_HASH_VERIFIED: receiver copied to explicitly allowed destination without overwriting and verified SHA256 again.

## Open gates
- Full npm run check PASS exit 0 and npm test PASS exit 0 after bounded Windows rename retry. Fresh GitHub CI for R06 is pending push and subsequent completion.
- Audit all concurrency/race cases around cancellation, stale process PID reuse, job retention disk quota, cleanup and concurrent multi-GiB transfers. An unattended disk-spanning queue must have quotas and retention.
- More severe failure: OS reboot/power loss during native work and Windows autostart must be tested in controlled window; abrupt process death was tested, but machine restart was not.
- Full restore when source changes during staging; current worker refuses changed source mtime/inode and fails closed.
- Native tools must be installed on a separately staged, version-matched canary with exact source/destination allowlists and local durable-send.mjs installed alongside pilot transfer.mjs.
- Test all four live nodes via native tools after canary/full rollout, not just portable CLI.
- Release must be signed, tested with rollback and be compatible with users' existing data, no delete/reinstall.
- Public relay data classification policy and opt-in approval for sensitive datasets remains outstanding.
- Current Syncthing 2.1.6 four-node pilot is live and previously verified 12/12 direction SHA256; DO NOT replace until gates pass.

## Reference
Syncthing verifies file blocks with hashes, stages remote files and can resume transmission:
https://docs.syncthing.net/users/syncing.html
MCP Tasks are intended for durable long-running operations, but this R06 local job receipt is internal application state, not yet a negotiated MCP Task handle:
https://modelcontextprotocol.github.io/ext-tasks/specification/2026-07-28/tasks.html

## Rollback
No live stable installations changed. Revert feature commit or disable transferMesh.durableEnabled; existing R05 tools remain available if separately enabled. Retain user transfer state. No system-wide permissions, SSH, VPN, firewall or reboot changes.
