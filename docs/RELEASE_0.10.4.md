# Remote Commander v0.10.4

Date: 2026-10-01

## Scope

Maintenance and storage-hardening release on top of immutable v0.10.3. The release preserves the existing capability/authority model, routing model, durable workflow semantics, GUI/browser safety policy, mutation idempotency and candidate-first update/rollback behavior. No breaking MCP input-schema change is introduced.

## Repository audit hardening

A complete GitHub/source audit recovered two useful fixes that had not reached current main and closed historical branch debt:

- concurrency smoke now waits for the asynchronously-written runtime marker with an elapsed 30-second deadline, exact port/project identity and early child-exit diagnostics after HTTP health;
- the existing fail-closed explicit owner runner-policy overlay is applied consistently to named Windows profiles as well as the default profile, preserving active routed runtime authority while preventing explicit canonical owner runner intent from being lost during candidate migration;
- historical PRs #49, #74 and #75 were dispositioned with evidence instead of merged blindly;
- tracked source hygiene was normalized and fresh-clone behavior was audited.

## Power Mode backup amplification hardening

Issue #81 identified quadratic backup growth when repeatedly appending to a growing file because each append copied the entire prior file.

v0.10.4 changes append recovery to a compact, verified truncate-recovery journal containing the exact target, pre-append byte length/hash and appended byte length/hash. Rollback is deterministic: truncate to the recorded pre-append length and verify the recorded pre-append SHA-256.

Overwrite/file snapshots remain recoverable and are now bounded per target. The newest rollback point is created and verified before older file rollback containers for that target are pruned. The default retained snapshot count is 8 and the accepted configuration range is 2–64. Path locks, expectedSha256 preconditions, canonical/symlink guards and post-write verification remain active.

## Durable delivery storage compaction

Issue #82 adds identity-safe delivery artifact compaction without converting storage cleanup into acknowledgement.

Eligible completed artifacts may move from live content-addressed JSON storage to verified gzip archive storage. The archive is written privately, fsynced, decompressed and hash/size verified, atomically renamed, verified again, and only then may the plain artifact be removed.

Compaction never synthesizes acknowledgement and never changes correlation, attempt, receipt, state or delivery identity. Pending/dead-letter/non-completed records are excluded. Reads remain correlation-scoped and transparent across live/archive storage. Delivery status now exposes bounded storage metrics including database/artifact bytes, archive-candidate bytes and oldest-pending timestamp.

## Bounded tunnel log rotation without tunnel interruption

Issue #83 closes long-lived tunnel log growth without truncating a file held open by tunnel-client and without restarting a healthy tunnel solely for rotation.

Pinned tunnel-client v0.0.15 supports --log.file stdout. Commander now launches it through a Commander-owned rolling logger. The tunnel-client remains the real child process with unchanged profile/health semantics; the wrapper owns stdout/stderr persistence.

The logger keeps:
- current log capped at 8 MiB;
- up to three gzip archives;
- atomic machine-readable rotation status JSON;
- only a bounded recent diagnostic tail when migrating an oversized legacy current log.

Rotation never renames/truncates a file opened by tunnel-client. Regression tests force multiple live rotations under one child PID, reconstruct the complete stdout/stderr byte stream exactly, prove archive bounds, and cover oversized legacy migration. The wrapper removes control-plane/OpenAI credential variables from its own environment immediately after child spawn.

## Git canonicalization

Post-#87 validation found two PowerShell paths stored as CRLF bytes directly in Git blobs despite .gitattributes already defining text/CRLF checkout behavior. Fresh Linux clones therefore appeared dirty immediately after checkout.

v0.10.4 stores canonical LF Git blobs for those two files while leaving checkout policy to .gitattributes. The semantic PowerShell diff is zero. Fresh Linux and Windows candidate clones are clean.

## Qualification evidence before release preparation

Accepted local/hosted evidence accumulated on exact maintenance heads before version promotion includes:

- repository audit: 333 tracked files / approximately 46k lines; JS/MJS and shell syntax clean; JSON/YAML/UTF-8 clean; no tracked secret-pattern finding; no non-doc TODO/FIXME/HACK/XXX finding;
- storage #81 focused backup/recovery and filesystem-safety regressions PASS;
- storage #82 durable delivery compaction regressions and identity/state guards PASS;
- storage #83 live-rotation regressions, Windows runtime contract, Linux lifecycle and source-integrity gates PASS;
- exact post-normalization Linux check qualification: 265 tests / 263 pass / 0 fail / 2 skip;
- exact post-normalization Linux full test: 506 tests / 504 pass / 0 fail / 2 skip;
- exact post-normalization Windows full test: 506 tests / 500 pass / 0 fail / 6 platform skips;
- Linux and Windows security audits PASS;
- Linux and Windows doctor PASS;
- hosted Windows and Ubuntu CI PASS for the normalized candidate;
- PR #87 exact-head hosted CI and Server Install Canary PASS.

## Release acceptance

Publication requires all of the following on the exact v0.10.4 candidate:
- version projection and release-asset contract PASS;
- complete Linux qualification check/test/audit/doctor;
- complete Windows qualification check/test/audit/doctor;
- hosted Windows and Ubuntu CI;
- Windows Server and clean Linux server-install canaries;
- 19 release assets with SHA256SUMS verification;
- immutable annotated v0.10.4 tag pointing to the exact accepted release commit;
- immutable GitHub release;
- candidate-first live rollout and exact version/commit/readiness readback before production v0.10.4 is called accepted.

## Production authority before rollout

Until the rollout gate above is complete, the accepted live production authority remains immutable v0.10.3 at commit 37a57b72c25a793e32e0095f308f065afb1561a2. The v0.10.4 release candidate must not be treated as live production authority merely because source/CI qualification succeeds.
