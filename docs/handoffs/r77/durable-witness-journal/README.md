# R77 durable host-only native witness evidence

**PASS: scoped source, strict journal readback, and one real owned Windows Job across two natural-exit processes. NOT installed, NOT production-wired, NOT recovered release authority, NOT whole-product FINAL.**

This source slice extends the [reviewed R76 host-only cessation handoff](https://github.com/GOD13emad/ChatGPTRemoteCommander/tree/saeid/r76-native-cessation-handoff-20261105/docs/handoffs/r76/native-cessation), commit `760e4f6460627d3bbbd6cbce23132890d40a8915`. It does not change an installed Commander, register an MCP tool, adopt an old orphan, or retry a job.

## Contract and authority boundary

The host optionally injects `createOwnedWitnessJournal(...)` into `createOwnedNativeCessationOracle(...)`. The journal requires a dedicated private local directory, exact dependency/policy fingerprints, producer PID plus creation FILETIME, and a trusted constructor-side private-storage check. The provided Windows test helper creates only a new empty QA directory, applies a protected current-user/SYSTEM DACL, and checks it. That DACL is privacy against other principals, **not isolation from the same FULL_POWER user**. Hash chains, same-user DPAPI, file checksums and host-provided pin descriptors do not authenticate a public caller or a native producer.

Before execution, an exact workflow/step/operation/root/store/lease binding and producer generation are appended as LAUNCH. Only the trusted runner's own closed, assigned-before-resume, empty-Job result can produce the terminal WITNESS. Only selected native cleanup fields, identities and digests are retained; args, stdin and stdout/stderr bodies are excluded. Every pending intent reserves a bounded terminal row and byte allowance before another effect may start. Capacity refusal occurs before append/dispatch.

Writes use Buffer bytes, an exclusive writer, one complete append and `fsyncSync`; acknowledgement requires a full write and a strict readback. Partial writes/initialization, invalid UTF-8, duplicate JSON keys, unknown fields/files, wrong order/generation, altered pins, conflicting operations, modified lock identity, reparse/link aliases and corrupt chains fail closed. No automatic tail repair, stale-lock removal, journal compaction or replay is provided. Live parsing/storage failure poisons that instance; restoring the file does not revive its in-memory authority. In-memory head/count pins detect same-process valid-prefix truncation.

On deliberate close/reopen, attempted operation IDs and the original sanitized record are recovered. **The private fresh-process Map is empty: `verifyNativeCessation()` returns `NATIVE_CESSATION_AUTHORITY_NOT_RESTORABLE`.** `recoveredEvidence()` explicitly reports `authorityRestored:false`. There is no restore-provider hook or invented broker. The workflow store's verifier remains null by default and its exact CAS, separate post-state verification, and no-replay rules are unchanged. Original completion timestamps are never refreshed; the existing 30-second fresh-Map/store verification window remains.

Cold valid-prefix rollback cannot be detected from a hash chain alone without an independent external anchor. Same-principal rewriting is outside this evidence-integrity guarantee; cold authority remains false. A natural process exit/reopen plus flush/readback is not proof against OS crash, power failure or storage-controller loss. Power-loss durability remains UNPROVEN. An abrupt owner exit can leave a writer lock that requires independent review; it is never silently reclaimed.

## Qualified evidence

- Exact public source/test copies: **21 tests, 21 PASS, 0 FAIL, 0 SKIP**. These include serialized tamper/partial/duplicate/order/pin drift, consumed intent, exclusive writer, failed flush, same-process Map invalidation, capacity refusal without dispatch/file change, a fully reserved last pair, raw-payload exclusion, unchanged age, and default-null verifier denial. Counter/mock cases are not native or authentication evidence.
- A separate real Windows Job fixture wrote one owned effect once. Its producer closed and exited; a different process recovered the identical sanitized record with executor PID/creation FILETIME and empty-Job cleanup evidence. Native dispatch counts were 1 then 0, effect count remained 1, the uncertain lease remained held, public/default-null claims and replay were refused, and raw/hex input/output sentinels were absent. Cold release authority was false. See sanitized `QUALIFICATION.json`.
- Failed A was before native dispatch: a string SID selected the account-name overload. The fix uses a typed SecurityIdentifier. Failed B and ACL-only C exposed an inherited PowerShell7 module path through an intermediate Node process, causing Windows PowerShell5 Security-module autoload failure. Child-only canonical module-path pinning passed a new ACL-only D gate before the fresh native C gate. Failed scopes were retained; no failed intent was rerun. No global environment, registry, owner privilege, old fixture or live installation was changed.

## Dependencies and reproduction

Do not replace the workflow store with an unrelated version. Supply these unchanged R76 dependencies in `src/` when running the tests:

- `workflow-store.mjs`: `ac0d844cdf17a0afcbfccfc2b56376195321885fb24f3c99473d02fbb9838a13`
- `workflow-autonomy.mjs`: `81bb99a61932dc23f1cb2f8fbd6af99ebc37beeac87e2e911a4e9a729cedea28`

The oracle preimage is `d6b2660947d0a1845440d2ab739e8f547207479eee5a430dfae339f0a76c39b5`; current code/test hashes are in `MANIFEST.json`. The new oracle is opt-in and the unchanged store defaults to no trusted verifier. Reproduction requires Node24 with built-in SQLite. In a newly admitted isolated QA copy with the two exact dependencies, run only:

`node --test --test-concurrency=1 test/oracle-durable-boundary.test.mjs test/journal-capacity.test.mjs test/independent/independent-journal.test.mjs`

The recorded real native QA additionally pinned Windows native runner `643ad9a2534041066943bafa322bfb2ecc38670e789f86374a150e23c9f765a6`, model contract `6298f5be3acaf072a0c0eaf81d228640931d670c9be9d8077d0fa1d0b7b8b902`, and Job helper `c8021a570a8b6bcfacbb1ce769a4f6a2e9de44bc41e52ec446a90b458a7f386a`. No binary, dependency runtime, raw fixture or private filesystem path is included. The private native harness is referenced by evidence hash, not exported with owner paths.

## Remaining gates

Authenticated caller/owner grants, an independently enforced provenance boundary for restored authority, production executor wiring, external/service-effect fencing, durable external anchors, long lease renewals, power-loss acceptance, installed migration, OS login/reboot, signing and whole-product acceptance remain open. A local Job Object does not fence work submitted to an already-running service or remote system. Do not release a real orphan from readable evidence, weaken guards, or restart/retry work to reproduce this source qualification.

Primary references: [Node fsyncSync](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsfsyncsyncfd), [Microsoft buffered-I/O flushing](https://learn.microsoft.com/en-us/windows/win32/fileio/flushing-system-buffered-i-o-data-to-disk), [DPAPI user scope](https://learn.microsoft.com/en-us/windows/win32/seccrypto/example-c-program-using-cryptprotectdata), [FileSystemAccessRule constructors](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemaccessrule.-ctor), and [PowerShell module-path inheritance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath).
