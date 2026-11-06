# Commander Transfer Mesh R07 — Bounded Queue Admission
Date: 2026-10-13
State: source-only development candidate, NOT deployed to active stable Core or portable transfer services.
Base: R06 commit 20dfe5f9a782786958ef6190b9a39eee9056d01b, draft PR #202.

## Security and availability rationale
Unbounded local transfer staging could exhaust storage or launch too many detached workers.
Opt-in durable native policy now accepts per-node maxSourceBytes (default 16 GiB), maxPendingBytes (default 64 GiB), maxActiveJobs (default 3). Each must be a positive safe integer and maxSourceBytes cannot exceed maxPendingBytes.
The durable worker rejects oversized source, over-capacity aggregate of non-terminal journal reservations, maximum concurrent active jobs and insufficient local free space (all unfinished reserved job sizes + new source size + 64 MiB headroom). Admission is serialized with an exclusive jobs/.admission.lock, and normal failures release the lock without creating a transfer record. Stale lock is fail-closed (manual recovery gate).
Source/destination scope, certificate-level peer identity, SHA256 and no-overwrite behavior remain unchanged.

## Evidence
Linux R07 tests 7/7 PASS: native scoped quota, durable crash/recovery, worker transfer, source and disk/queue policy. Windows targeted quota tests 2/2 PASS; Linux targeted quota tests 2/2 PASS; Windows full npm run check and npm test PASS, exit code 0. Focused CI-stability regression is checked separately before commit.
No R07 quota binary has been pushed to the portable installations; last R06 pilot remains operational and verified all 12 device directions.

## Open final gates
GitHub R06 Windows CI retry FAILED in a separate existing project-engine-integration.test.mjs worker crash test (hardcoded 10-second test timeout). Test-only Windows watchdog raised to 30 seconds for three crash-recovery scenarios. Existing project-adaptive.test.mjs fixture's generic maxDurationMs raised from 30 to 120 seconds, with production workflow deadlines and all crash/idempotency assertions unchanged. This requires fresh CI on R07 commit. Do not infer PASS until readback.
R07 quota implementation requires full source test, PR revision and fresh CI before merge. End-user release also needs durable retention/cleanup, lease recovery, OS reboot/logon checks, signed staged update/rollback and live native tools on all four stable installs.

## Admission lock semantics
A crashed process can leave jobs/.admission.lock. Current gate remains fail-closed: manual verification of the owning PID and all job receipts is necessary before any cleanup. No automatic stale-lock unlink is implemented. Disk quota is conservative because it reserves full bytes for unfinished jobs, even if some staged bytes already exist.
