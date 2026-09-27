# v0.9.10 qualification

Status: CANDIDATE — Receipt-backed corrupt-projection recovery release.

## Objective

Close the remaining durable-delivery reconciliation churn without deleting history or replaying any external effect.

## Observed production evidence

On the Windows default profile, 22 historical operation `state.json` files were unreadable because every byte was NUL. This was not inferred from missing status: all 22 files were byte-audited. For each of the 22 operations:
- a valid terminal `result.json` receipt exists;
- the request reservation exists;
- operation ID matches;
- receipt inputHash exactly matches the reservation;
- a valid correlation identity exists.

The origin of the NUL overwrite itself remains UNVERIFIED. The software defect addressed here is narrower and confirmed: reconciliation caught the unreadable state and re-added the operation forever, producing repeated periodic work.

## Recovery rule

Recovery is allowed only when durable evidence is exact:
1. operation ID is valid and identical across directory, reservation and receipt;
2. request/correlation IDs pass the existing bounded identity grammar;
3. receipt status is terminal;
4. receipt inputHash exactly equals reservation inputHash;
5. receipt tool metadata is present.

Before repair, the original unreadable state bytes are stored in the same operation directory as a content-addressed `state.corrupt-<sha256>.bin` file. A conflicting backup fails closed. The terminal projection is then atomically reconstructed from reservation + receipt. No command, filesystem mutation or other external effect is executed during recovery.

## Validation already completed

- Focused async/HTTP/correlation suite: 16/16 PASS, including exact recovery and mismatch fail-closed regressions.
- Read-only-copy validation using the 22 real Windows corrupt states plus their real reservations/receipts: copied=22, repaired=22, backups=22, invalid=0, tracked=0, events=22.
- v0.9.9 direct synchronous run_shell guard was live-tested: timeoutMs=16000 was rejected before effect and the marker file remained absent.

## Release gates

- Full Windows check/test/audit on the exact candidate.
- Exact-commit Linux check/test/audit.
- Commit, tag and immutable release authority alignment.
- Candidate-first live promotion on Windows default + saeed-emad and Linux default.
- Post-promotion verification that Windows historical tracked set drains to zero without rerunning effects.

FINAL-LIVE is forbidden until these gates pass.
