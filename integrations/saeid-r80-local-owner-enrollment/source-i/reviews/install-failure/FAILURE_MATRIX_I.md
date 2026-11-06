# Bounded production-boundary history and I prevention

Three distinct root cases were found; none is falsely counted as three
repetitions of one cause. Their shared engineering pattern is fixture-only
success concealing a production file/security boundary, so one concrete
file/guard lifecycle audit was performed instead of blindly repeating UAC.

| Failure | Exact cause / evidence | Prevention / scoped regression |
|---|---|---|
| StoreB first empty journal | Initial writer creates a legitimate zero-byte journal; generic protected reader required nonempty. R80 auth derivation and boundary21 receipts preserve original pins. | Fixed-role protected journal reader, bound marker/head0/hash0; noninitial-empty/missing/truncated/changed state denied; global policy/key reader unchanged. |
| J consent event/receipt DACL | Default file creation inherits an ACL; consumer requires protected explicit ACL. Source lifecycle audit and derived consent source pins confirm. | Explicit BA/SYSTEM-only owner/DACL/CreateNew/WriteThrough/fsync. Ordinary fixture-file protection tested; actual BA/SYSTEM acceptance remains UAC gate. |
| H OS ancestor / TrustedInstaller | Actual Program Files ACL has non-inherit-only TI FullControl/DeleteChild. H ancestor guard trusted only BA/SY. Deterministic rejection before creation; exited child code lost/unobserved. | I recognizes exact TI SID ONLY on exact existing OS ancestor paths. Same read-only guard runs during ordinary preflight. Arbitrary user/service SID and private-app TI remain denied. No ACL changed. |
| H diagnostics transport | ShellExecute RunAs does not preserve child stdout/stderr in parent's previous mechanism. H actual code cannot be reconstructed from exit2 alone. | I fixed allowlisted phase/code payload; protected owner-readable outcome only after this process created its state root; native Persian alert only for actual elevated apply failure before root. No elevated G writes or arbitrary output path. |
| H partial rollback | Completion-required rollback could miss task activation after crash before complete/attestation. Parent audit stopped deployment. | Protected enrollment/prepared/registration intent before Register; exact production-selector15 cases; unknown/active deny, absent deactivated, exact idle retire only; all files/keys preserved. Retained unchanged by I. |

Microsoft Windows Resource Protection reserves protected resource modification
to TrustedInstaller. This supports recognizing its exact OS servicing identity;
it does not authorize granting it access to application private keys or changing
any Windows ACL. Microsoft FileSystemRights defines DeleteSubdirectoriesAndFiles
as deleting child files/directories. The I change affects trust classification
for an existing OS ancestor, not private file ownership/access policy.

Primary evidence fetched during I review:

* https://learn.microsoft.com/en-us/windows/win32/wfp/about-windows-file-protection
* https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.filesystemrights?view=net-10.0
* https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-inheritance-rules

H apply is consumed DO NOT RUN. I is source/QA only until parent separately
reconciles final source review, current baseline and one new exact UAC plan.
Actual elevated token, native error UI, protected outcome write, task COM and
owner consent remain separate runtime evidence; synthetic QA grants none.
