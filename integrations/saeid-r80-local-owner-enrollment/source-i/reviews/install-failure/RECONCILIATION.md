# Consumed H UAC failure — bounded reconciliation

Parent observed one H apply child30456 at06:54:04.245UTC, exit2 within0.65s.
Both proposed owner-auth trees and their application parents remained absent;
fixed task absent, installed config/route unchanged. No apply/UAC/task retried.
The elevated child's stdout/stderr was not retained by ShellExecute.
Its actual primary code is therefore UNOBSERVED, not retrospectively asserted.

Read-only actual OS ACL checks reproduce a deterministic precreation blocker:
C:\Program Files grants non-inherit-only FullControl (including DeleteChild)
to the exact Windows TrustedInstaller service SID
S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464.
H ProtectedInstall.Ancestors accepts only SYSTEM/Administrators for that bit.
Consequently Parent→NewDirectory→Ancestors would reject this actual OS ACL
before CreateDirectory, even with a correct elevated same-owner token.
H's separate ProtectSystemTool already recognizes that trusted OS service.

CONFIRMED: deterministic causal blocked path and actual ACL; no root mutation.
PROBABLE: this was the consumed child's failing path, consistent with absence
of all created roots. NOT CONFIRMED: the child's lost code/token/phase.
Current ordinary SID/session is not substituted for the exited elevated token.

Parent authorized source-only I remedy, no deployment:
admit exact TrustedInstaller SID only on known existing OS ancestor paths,
never on private application/key ACLs; run the same ancestor preflight read-only
before UAC; reject any ordinary/untrusted writer unchanged.
Before another apply, add fixed phase/code diagnostics: protected owner-readable
outcome only in a directory this transaction actually created; a short native
Persian code/phase alert for pre-root failures after real elevated-owner check.
No elevated G output path, arbitrary diagnostics path, secret or raw exception.

H is consumed DO NOT RUN. Preserve H source/native/metadata/review pins and
the failure receipt. Fresh I requires native rebuild, ordinary negative tests,
actual read-only OS ancestor acceptance, untrusted SID negatives and independent
review before parent may consider a new UAC plan.
