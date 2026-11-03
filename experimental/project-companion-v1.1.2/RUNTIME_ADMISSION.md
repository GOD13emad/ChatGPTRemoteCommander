# Portable runtime admission — R2 development candidate

This is a Commander component, not another product or installed agent. It does not alter the frozen 1.1.2 finite-runner source or its 94-test acceptance contract.

## Defect and boundary

A separately installed private worker still required core 0.10.8 while its pinned registry had advanced to 0.10.15. A successful idle dispatcher does not enter that worker. Merely replacing the literal with any caller-provided version would remove the compatibility boundary.

`src/runtime-admission.mjs` instead accepts a separately trusted compatibility policy and an independently pinned deployment record. It requires an explicit exact-version allowlist and preserves companion version, host/OS/user, profile/isolation, backend port, configuration/route digests and core paths. The same frozen core version is supplied to pre- and post-execution readback. Hostname and product deviceName are intentionally separate: they need not be identical on Windows.

## API and trust

`createRuntimeAdmission({policy, pin})` provides `checkRequest`, `checkStatus` and `run`. Policy and pin must come from verified deployment authority, NEVER model output, webpage data or an untrusted descriptor. Data must be strictly parsed upstream. Snapshotting rejects accessors, cycles, oversized/deep input and non-data objects; the callback receives the immutable admitted request, not the caller's mutable object.

`run({descriptor, identity, maxTicks, readStatus, execute})` calls the read-only status callback before and after one trusted execution callback. It rejects overlapping use, never internally retries, preserves a primary worker error when postcheck also fails, and reports post-action drift rather than returning success. Any failure after callback entry latches this admission object for reconciliation.

**This is not an OS authentication boundary, private-file verifier, process sandbox, durable lock, scheduler, grant or persistent retry journal.** Native owner/SID/UID, ACL, canonical file identity, source/executable/config/route hashes, project-root confinement, finite budgets and original intent/receipt journal must still be enforced by trusted platform adapters. Creating a fresh admission object or process is not reconciliation and never authorizes replay. A success result is only runtime-contract acceptance, not whole-project FINAL.

## Verification performed

The 63 new synthetic cases cover Windows/Linux, default/isolated profiles, version and tuple drift, immutable authority, pre/post failures and non-replay. They passed on Emad Windows (Node 26.7.0) and Emad Linux (isolated Node 24.19.0). The original 94 frozen finite-runner tests also passed separately on both hosts with unchanged source pins. Earlier 60-case Linux Node 22 checks are historical, not the final expanded test count. Hosted Node 22/24 on Windows/Linux is a separate required gate.

The private worker and production services are NOT modified, installed or activated by this change. Native adapter integration, real authenticated chat/ACK/retry, UI acceptance, sustained recovery and rollout remain OPEN. The separate blocked Browser Brain commit is unrelated and is not retried by this revision.

## Run

    node --test --test-reporter=tap --test-concurrency=1 test/runtime-admission.test.mjs

The existing `node ci-source.mjs` requires Node 24+ and continues to enforce exactly 94 original tests. No real model calls, user chat reads or installed scheduler changes are needed for either suite.
