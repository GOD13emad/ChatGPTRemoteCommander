# R80 protected local-owner bootstrap source gate

Source/native-negative qualification passed. No enrollment or installation
occurred. Installed Commander, settings, active jobs, GUI incidents and prior
owner acknowledgements were not changed/replayed. Parent alone owns live
acceptance, the cumulative Return, GitHub and project control.

Final scoped receipt: qa/i/RECEIPT.json, including exact final sourceFiles.
Its component evidence reuses unchanged host/consent builds from A/C, journal
boundary D, cleaned-policy/manifests E and corrected bootstrap I. Failed
aggregates remain failed; successful components are explicitly referenced.

| Final role | Actual build path | SHA256 |
|---|---|---|
| Derived I issuer, 4,131,328 bytes | G:\CodexWork\RC1R80Bootstrap\host-i\CommanderNativeIssuer.exe | 310e0a3f13a4b7dadc71f16df9683915641392d34a15d93d4c3ebd4ec29cbd26 |
| Derived I consent, 3,566,080 bytes | G:\CodexWork\RC1R80Bootstrap\consent-i\CommanderOwnerConsent.exe | b5ff1b8fdc5aea05e338b2a2ff4ec71146136c22b66728e5bf25b108016c4020 |
| Final I bootstrap, 3,874,304 bytes | G:\CodexWork\RC1R80Bootstrap\bootstrap-native-i\CommanderOwnerBootstrap.exe | 318f5c2d05aa841908368be99433d7e3e95235a2e25e8e20422230e511195212 |

All three are actual NativeAOT x64, CLR directory zero, load flags0x800 and
extracted asInvoker/uiAccess=false manifests. Ordinary host/consent/apply/
rollback deny before authority IO. Bootstrap29, partial-rollback selection15 and journal/file-boundary21
cases pass. A newly created harmless QA WindowsPowerShell child was reaped
through its held original handle/creation FILETIME/image only. No task,
issuer, game, project worker or unknown process was stopped.

## Corrected production file lifecycle

R80 auth derives frozen StoreB/ExchangeC by routing only fixed journal reads
to ProtectedJournal. The production reader retains fixed root/role/max-size,
reparse/ACL/held-file checks. Zero bytes require bound initialized marker,
matching enrollment and initial head sequence0/hash0. Missing/truncated/
noninitial-empty/inconsistent inputs fail closed. Global OpenProtected still
requires nonempty policy/key/receipt bytes. No rows/heads/approvals fabricated.

Derived NativeAotOwnerConsent changes only event-intent and receipt creators
to explicit protected BA/SYSTEM-only DACL/owner, CreateNew, exclusive share,
WriteThrough and fsync. Frozen J inherited file ACLs its consumer rejected.
Pending, marker/head/lock and atomic-replacement creators already protected.
R78/R79 were not mutated. Initial R79 e7b86... and J1ae194... MUST NOT be
installed as corrected artifacts. R78 standalone late-expiry limitation
remains; ExchangeC outer deadline composition still qualifies issuance.

Boundary fixtures execute the exact held-file/length/tail/anchor core but
compile-only bypass actual protected ACL/fixed-root authority. Production
ordinary-root denial is separate. Actual fixture file DACL protection and
sharing are exercised; the protected reader correctly rejects its ordinary
owner. Real BA/SYSTEM ACL-positive acceptance remains UNPROVEN until UAC.
Fixture signing keys remained in memory; public bytes and private file/anchor
fixtures persist only in admitted QA folders. They are not production keys.

## Concrete apply and rollback

Diagnose inspects only the actual kernel token. Preflight arguments are:
--preflight bundleDirectory BUNDLE_SHA256 ownerSID
Apply uses the same three arguments with --apply. It requires actual
elevated same-owner split token/high integrity/enabled administrators and the
original owner session before target/key/task IO. No runas launcher exists.
Only parent may launch reviewed native UAC; only owner approves.

Fixed proposed targets:

* ProgramFiles/ChatGPTRemoteCommander/owner-auth
* ProgramData/ChatGPTRemoteCommander/owner-auth
* root task \ChatGPTRemoteCommanderOwnerIssuerV1

Existing targets/unknown ownership/reparse/delete routes/changed task stop;
there is no overwrite, automatic repair or re-enrollment. Partial protected
state survives failure and requires reconciliation; apply must not rerun.
Fresh files/directories have explicit protected BA/SYSTEM ACLs. Public
images/policy additionally allow enrolled owner read/execute. Three separate
P-256 PKCS8 private keys are BA/SYSTEM-only: consent-key.pk8,
oauth-sign-key.pk8, selftest-client-key.pk8. Apply alone generates them after
real UAC; temporary export buffers are zeroed after protected writes.

Fixed embedded TaskOwner.ps1 is protected, reread/pinned and held through
fixed trusted System32 WindowsPowerShell execution. OS tool owner/ACL/
ancestor guard trusts SY/BA/TrustedInstaller and holds read share only.
System32 CWD, explicit clean environment, official module path, NoProfile;
no ExecutionPolicy override. Effective policy is checked before writes;
current cleaned ordinary query returned RemoteSigned. No policy changed.

Task has no triggers/autostart/restart, one fixed protected issuer action
--serve-once, SYSTEM principal, System32 CWD, IgnoreNew, bounded runtime and
no hard termination. COM syntax validation then TASK_CREATE flags18; flag16
prevents implicit principal ACE. Stored XML/action/principal/settings and
canonical SDDL read back. Task owner/group BA; SY/BA full; owner GR/GX only.
Apply never starts it. Client policy publishes only after attestation.
Proxy may start that one fixed task once, then authenticates actual peer.

Rollback arguments: --rollback ownerSID. Requires actual elevated owner;
checks immutable image/policy/key/anchor pins plus exact attested idle task,
then removes ONLY that task. No active task/process is stopped. Every key,
mutable journal/head, receipt, pending request, program and audit is preserved.
Mutable state is neither compared with initial SHA nor restored. Existing
Commander was never switched. Incomplete/uncertain task creation without
attestation requires explicit reconciliation; never invent a receipt/retry.

Every newly created PowerShell helper is held by original handle/generation/
image. Timeout may reap only that helper; task outcome remains UNKNOWN/no
retry. Cleanup failure adds ownedHelperCleanupUncertain metadata and retains
the original timeout/IO error instead of replacing it.
Low-risk diagnostic limitation: cleanup-only failure emits authoritative
OWN_HELPER_CLEANUP_UNCERTAIN_NO_RETRY but the boolean currently prints false
when no earlier exception Data existed. It never permits replay or success.

## Shared bundle/public client contract

Strict BUNDLE.json fields: schema RC_OWNER_BOOTSTRAP_BUNDLE_V1, ownerSid,
ownerSessionId, bootstrapSha256, images, hostSourceRevision and scope.
images contains exactly CommanderNativeIssuer.exe, CommanderOwnerConsent.exe,
CommanderOwnerProxy.exe, CommanderOwnerAdmin.exe. Compiled host/helper pins
are above; parent supplies exact final proxy/admin and bootstrap self hashes.
hostSourceRevision=r80-protected-empty-journal-fix;
scope=no-project-selftest-only. Source manifests, not requests, bind builds.

Protected public ProgramFiles client-policy.json schema:
RC_NATIVE_ISSUER_CLIENT_V1; ownerSid,ownerSessionId,hostSha256,proxySha256,
adminSha256,nativePolicySha256,oauthPolicySha256,hostPolicySha256,clientId,
redirectUri,resource,grantPolicyIds,taskName. Peers are proxy/oauth-proxy and
admin/owner-admin. Elevated OAuth proxy remains intentionally denied.

Initial test-only namespace: client commander-owner-selftest; redirect
https://commander.invalid/local-callback; issuer
https://commander.invalid/owner; explicit token endpoint identifier
https://commander.invalid/owner/token; resource
https://commander.invalid/selftest. No HTTP endpoint is installed/advertised.
Catalog selftest grants profile=selftest/root=no-project/action=selftest/
scope=selftest ONLY. No project/shell/GUI executor, real OpenAI ingress,
refresh token, external IdP or paid API is admitted.

Separately reviewed acceptance-probe may later perform ordinary begin,
real elevated owner consent/fixed selftest assertion, then ordinary complete/
exchange/state verification. No private key may enter chat, and an elevated
proxy cannot substitute for ordinary-client execution.

## Preserved failures and prevention

Parent cause: fixture bypasses concealed production file-size/ACL boundaries.
The concrete file lifecycle was audited once; source/core and real protected
token acceptance are now separate gates. A's native negatives passed, but
rollback mutable-inventory bug supersedes its bootstrap. B failed precompile
because a glob included compiler bin directory. C corrected file-only copying
and compiled production binaries but new QA had nullable warning. D corrected
QA and passed21 cases; its SDK inherited PowerShell7 module paths broke the
policy probe. E exact production-clean module path passed without source or
machine policy change. F closed helper orphaning; G preserves primary error
if cleanup also fails. All original failures/logs/snapshots are preserved;
A-I runners are consumed DO NOT RUN. No blind retry or fabricated PASS.

## Next exact action / open gates

Parent reconciles independent review and client/probe source gates, admits
one BUNDLE with actual owner SID/session and exact final images, then performs
preflight. Only afterward may parent request native UAC for this exact binary.
Owner performs real consent click. Capture protected task XML/SDDL, first
journal/receipt/token/state and idle rollback evidence before live integration.

Real protected enrollment, SYSTEM task start, positive kernel pipe identity,
owner UI, key use, rollback, account login and installed integration remain
UNPROVEN. Whole Commander is NOT FINAL. No automatic promotion.

Builds reused previously admitted official Microsoft10.0.14 packages in
G:\CodexWork\RC1R78AuthAot\packages. Do not copy cache, QA fixtures, nested
R78 archives or bin/obj to Return. External source paths require explicit
reconstruction/rebinding from dependency manifest on another machine.
Parent registers one compact delta and binary roles.

Primary contracts:
[Task registration](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-itaskfolder-registertask),
[creation flags](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/ne-taskschd-task_creation),
[task security](https://learn.microsoft.com/en-us/windows/win32/api/taskschd/nf-taskschd-iregisteredtask-setsecuritydescriptor),
[execution policies](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1).


## H required partial-enrollment rollback correction

G is retained as historical source/native-negative evidence, but was NOT
ready for UAC: its rollback required enrollment.complete.json and an attested
task, so a crash after Register or client-policy publication could leave
activation without a recovery path. Parent stopped before any UAC.

H writes a unique protected enrollmentId in enrollment.intent.json. Before
Register, it flushes task.prepared.json containing exact XML/SDDL and
bundle/enrollment/owner identity, and task.registration.intent.json pinning
those bytes. Unique bundle+enrollment description is verified alongside actual
safe action/principal/context/settings/no-triggers/SDDL; description alone
does not establish ownership. Native code holds and checks these files through
the fixed script execution. Completion/attestation files are not prerequisites
for partial rollback and are never fabricated.

Rollback now starts from the protected enrollment intent. If completion exists
its old immutable checks remain. If it does not, prepared/registration inputs
still determine only this transaction's known activation. A missing task is
read-only verified deactivated success, including a repeated inspection after
an earlier delete; no second delete is sent. An existing task without matching
registration intent, prepared bytes, actual unique definition/SDDL or known
idle/disabled state is STOP. A known exact idle task is freshly read/verified
again immediately before the sole DeleteTask. No process, task instance,
unknown task, private key, state file, journal or residual directory is stopped,
deleted or restored. Existing rollback receipt is checked rather than replaced.

If partial enrollment stopped before the program-script copy, rollback may
stage only the exact compiled task-inspection script at a new protected
state/rollback-helper.ps1 path. Existing helper bytes must match; no authority,
key, policy or completion record is repaired. Missing original enrollment
intent/unknown target ownership still STOP. This role is an audit helper,
not an enrollment retry. Rollback preserves every partial file and key.

PARTIAL_ROLLBACK_QA.ps1 imports only the AST of the actual production
Select-RollbackPlan function; the outer script/COM/task access never runs.
Fifteen cases cover intent/preparation/registration boundaries, Register-before-
attestation crash, client-policy-before-completion crash, completed/disabled
idle, already missing, unknown task, changed definition/SDDL and active/queued/
unknown state. Nineteen native bootstrap cases additionally prove unique
prepared binding/schema, ordinary denials, policy readiness and owned-helper
lifecycle. Real task deletion and protected UAC rollback are still UNPROVEN.


## I shared OS ancestor defect and retained apply diagnostics

H's one real UAC apply exited2 before creating any proposed root. Parent
observed task absent and config/route unchanged. The child's stdout/stderr was
lost, so its exact primary code remains UNOBSERVED. Actual read-only ACL
evidence and source flow prove a deterministic blocked path: Program Files
grants its trusted Windows servicing identity, TrustedInstaller, DeleteChild,
but H's creation guard AND shared WindowsGuard ancestor check trusted only
SY/BA. A bootstrap-only fix would still fail after creation or in host/helper/
client/probe. H is consumed DO NOT RUN, not a failed action to blindly replay.

I derives auth/src/WindowsGuard.cs from frozen R78, SHA
6ffd5e017ac734572d564ddf4268d02abbee9adecc4e0527081b0b5d0cc331e9.
Only the parent DeleteChild predicate changes: exact TrustedInstaller SID
is accepted only for existing exact ProgramFiles/CommonApplicationData/Windows/
system-drive-root ancestors. Private application/key owner/writer/confidential
checks remain byte-identical SY/BA-only. No Windows ACL is changed. Native
host/helper/bootstrap and their boundary QA all bind this same derived source;
client/probe source owner must independently bind and rebuild it too.

Ordinary --preflight now runs the same parent/ancestor predicate before UAC.
Actual read-only OS preflight passes; untrusted user/service SIDs and TI as
private owner stay denied. I records fixed allowlisted code/phase: owner-
readable bootstrap.outcome.json only in a protected state root this process
actually created; no arbitrary output path or elevated G write. Before such
a root exists, an actual elevated --apply failure can show a short native
Persian code/phase alert. Ordinary negative QA remains noninteractive. Raw
exception text, credentials, paths and tokens are never exposed.

I bootstrap29 and journal21 cases pass with actual native CLR0/load0x800/
asInvoker builds and guarded ordinary denials. Protected outcome creation,
elevated native alert and new real setup remain UNPROVEN until parent's
separately reviewed new UAC plan. H partial rollback and its actual production
selector15 are unchanged, not replaced. Distinct failure classes/history/
primary evidence are in reviews/install-failure/FAILURE_MATRIX_I.md.
The previously documented cleanup-only boolean edge is corrected while
constructing the new sanitized diagnostic payload; primary fault still wins.
