# R80 bootstrap/auth G independent review

**PASS_SCOPED_SOURCE_REVIEW — ready for the parent's concrete bundle/preflight and actual owner UAC acceptance.** This is not an installation, protected-ACL positive, real SYSTEM-peer login or final-product PASS. No authority action or test was executed by reviewer; installed Commander and existing jobs remain unchanged.

Accepted exact native artifacts:

| Role | Bytes | SHA256 |
| --- | ---: | --- |
| Derived issuer host |4,129,280|`f4bf84f09cabae3a128d577cc5f4f07f8708a2b5fdf6d67432eccc6bdbdb58f9`|
| Derived consent helper |3,564,544|`599847485c8650740bd59228a4f7629534acf0d85ca84593b81faf38ac990a13`|
| Bootstrap G |3,849,216|`2f38a41423b36e387685062bca824b01d72e2576d0109cde99116290413b4771`|

All are exact NativeAOT AMD64/PE32+ with CLR directory0, System32 dependent-load flags2048 and extracted asInvoker manifests. The source bundle verifies native images and manifest hashes through held input handles, same owner/session and explicit actual UAC token. It performs exclusive creation, never overwrites unknown existing targets, does not elevate itself, and restricts the initial catalog to no-project selftest only. The original R79/J binaries are not accepted substitutes for these derived fixes.

The holistic source audit in `FILE_LIFECYCLE_AUDIT_A.md` now maps to corrected concrete production paths:

- The dedicated journal reader accepts zero bytes only for exact journal role/max/fixed root and matching initial enrollment/marker/head0/zero hash. ACL/reparse/held-file checks remain; global policy/key/receipt nonempty guard is unchanged. Noninitial empty, missing, truncated or mismatched state still denies.
- Native intent and receipt creation now uses explicit BA-owned protected SY/BA DACL, CreateNew, no overwrite, WriteThrough/fsync. Bootstrap's helper pin matches the new599847 artifact. No inherited-DACL receipt is being passed off as corrected.
- Rollback's immutable hash inventory excludes mutable journals/heads. Fixed images, policy, keys and anchors remain pinned; mutable auth state is preserved without reading/restoring/deleting it. Task-only rollback verifies the exact attested XML/SDDL and refuses active/changed/unknown task state. Partial enrollment remains explicit reconcile-required, not automatic re-enrollment.
- Fixed task setup requests SYSTEM service account, no triggers/restarts, one fixed host/action/working directory, ignore-new policy and no hard termination; readback verifies critical XML fields and exact stored SDDL. Task descriptor owner/BA/SYSTEM retain modification authority, ordinary owner receives GR/GX only. Client policy is published only after task attestation; task registration itself does not start it.
- Fixed trusted WindowsPowerShell is ACL/ancestor/reparse checked and held, with clean environment, official module path, NoProfile and no execution-policy override. Effective policy readiness is checked before target mutation; actual clean ordinary query reported RemoteSigned. No policy was changed or silently bypassed.
- Only a newly created original helper process handle/FILETIME/image may be reaped on a deadline. No SYSTEM task/issuer/service/project process is enumerated or stopped. A timeout leaves the task outcome unknown/no-retry. G preserves an earlier timeout/IO exception when cleanup is uncertain and carries sanitized cleanup metadata.

One narrow diagnostic limitation is **accepted by the parent, not hidden**: a cleanup-only failure emits `OWN_HELPER_CLEANUP_UNCERTAIN_NO_RETRY` but its auxiliary `ownedHelperCleanupUncertain` boolean can befalse because no primary exception received attached metadata. The code is authoritative. The parent treats every nonzero apply result as no-retry/reconciliation-required and must never infer cleanup confirmation from that boolean. This does not relax an authority check or authorize a retry; no extra build was required solely for this edge.

Evidence reconciliation: `bootstrap/qa/g/RECEIPT.json` SHA `d445584d93e5d6936af4b61d643abd7c82b73ac8f0ee097b72cecb91c4e733b8` records17 bootstrap cases and real ordinary apply/rollback denial before authority. G also exercises actual clean policy readiness and an actual harmless freshly created helper's bounded reap, plus primary-error preservation.21 journal/descriptor/file-sharing cases are retained from the exact unchanged D reader/helper source; D's unrelated policy-query failure remains a FAIL history record. C's accepted native host/helper prefix is retained while its later test-only compiler warning remains failed history; E reconciles the clean effective-policy query. No whole failed receipt is relabeled successful, no historical counts are added to G17, and no943-suite repeat occurred.

The causal reader/descriptor fixture shares production length/anchor/creation code but bypasses only actual protected-root/ACL admission. It includes real private-file protected-DACL/sharing checks and ordinary production-root denial; **real admin-owned protected storage positive remains UNPROVEN until owner UAC**. Sealed R78/R79 sources stayed unchanged.

Proceed only with these exact reviewed artifacts and a concrete hash-bound bundle. Actual protected task XML/SDDL, ordinary fixed-task invocation, real kernel SYSTEM-peer/token permissions, local native owner approval, scoped exchange/state/revoke and rollback acceptance still require their bounded receipts. The separate acceptance probe and client B cannot inherit success from this source review. No real ChatGPT/project authority is admitted by the selftest policy.
