# Core Incident Reconciliation — constrained design decision

**Status:** design candidate / NOT DEPLOYED. On 2026-10-19, both historical Emad Windows/Linux `PENDING_NATIVE_EFFECT` records were reviewed and archived using incident-bound, OS-local, one-time procedures. Both GUI backends returned available afterward, with no original input replay. These historical host actions did not install, merge or accept the candidate recovery architecture. No general trusted owner reconciliation broker is shipped.

## Acceptance contract

1. **Identity and exact effect:** choose one existing incident by opaque ID, UTC time, tool and SHA-256 of the original *bytes*. An owner account's description is a witnessed observation; it must not overwrite native result `UNKNOWN` or become a native `NOT_APPLIED` acknowledgment.
2. **Owner proof:** the review endpoint is private to a product-owned OS-local broker, outside any remotely invocable Commander MCP tool, shell or shared-user file API. A terminal `isTTY`, plaintext phrase, mutable same-user public-key file, K093 generic Hello success, or K095 diagnostic signature is insufficient. A future Windows Hello/KeyCredential flow requires protected key enrollment and product-issued one-time challenge, independently validated freshness/nonce, and incident-specific consent. Additional OS principal isolation is required if the threat model includes a hostile process with the same Windows user rights.
3. **One writer for the desktop:** the existing Windows helper uses `Local\\ChatGPTRemoteCommander.GuiInput`, which is scoped to one Windows session, while J01 persistence is scoped to the OS account. That mutex alone **cannot** coordinate two RDP/console sessions. A product-owned coordinator must select and protect a stable user/desktop scope (for example an ACL-restricted `Global\\` named kernel mutex, or a single trusted broker), make **every compatible profile** participate from pre-dispatch journal check through native acknowledgment and persistence, and grant administrative review only after all input is quiescent. A `Global\\` name with default DACL is not sufficient authorization. On Linux use a compatible OS-account/desktop coordination primitive such as an appropriately protected advisory `flock`, whose limits require all clients to cooperate. Migration must deny stale binaries that do not honor the protocol. Neither cross-process fixture success nor a post-crash reacquired mutex proves a historical native effect.
4. **Durable, crash-safe transitions:** `PENDING_NATIVE_EFFECT` -> `REVIEW_PREPARED` -> `REVIEWED_WITH_UNKNOWN_NATIVE_OUTCOME`; corrupt or interrupted state -> `RECOVERY_REQUIRED`. Write private bounded receipt and fsync before moving original; retain exact original bytes, integrity hash and trusted broker context; use exclusive archive names, same-volume rename and readback. Do **not** call the sequence globally atomic on Windows just because one rename is atomic. Test crashes before/after each durable step; never interpret a missing pending file alone as permission.
5. **Controller readback:** a fresh controller must check pending/transition journal plus native worker quiescence under the same authority. Release input only for a terminal, authenticated reviewed state and no in-flight input. Manual rollback never replays the original command and never removes an unverified record.
6. **Scoped tests:** cross-process race (two chat profiles; helper in-flight during review), power-cut/crash windows, forged proof and same-user file edits, stale SHA, corrupt/symlink/hardlink, candidate updater NoPromote, actual owner-local UI under target session, live post-deploy observation while preserving existing other-chat leases.

## Existing assets and decision

- Keep K088 native incident preservation and diagnostics. K089/K094 fixture cases contribute negative tests and crash scenarios; they do not themselves establish native desktop coordination.
- Do not enroll another K095 diagnostic key or merge its experimental RSA attestation into the product. A valid signature under an independently untrusted public key proves no owner identity.
- Preserve PR #249's read-only observation behavior after security hardening; remove its direct `store.review()` and insecure `--review` path before any merge. A future reviewed transition requires a separate, acceptance-gated native broker + coordinator.
- Keep existing PRs, live GUI incident, profile processes and installed version untouched during this evaluation. This design is not production acceptance.
- **New native coordination candidate, unaccepted:** `tools/gui-control.ps1` now obtains an account-SID-scoped `Global\\ChatGPTRemoteCommander.GuiInput.User.<SID>` mutex **only for native mutations**, using `.NET 10 MutexAcl.Create` with an explicit one-user DACL and validating owner/rules again on preexisting mutexes. It retains the old `Local\\ChatGPTRemoteCommander.GuiInput` lock as a same-session migration bridge. The Windows helper reports an exact *three-field* pre-dispatch `GUI_NATIVE_BUSY` or `GUI_COORDINATOR_UNAVAILABLE` receipt before any native action. The controller can now safely resolve a newly-created J01 pending record for every GUI input family on this *exact* native no-dispatch evidence, without retry; an abandoned mutex / ambiguous helper failure continues to fail closed. `-CoordinatorSelfTest` creates a random ACL-restricted `Global\\...QA` object and checks it without touching the desktop or production mutex. This is still **not** an OS-owner-authenticated administrative review, a cross-session acceptance test, or a compatible deployment. It presumes Windows PowerShell 7.6/.NET 10 APIs are available; mixed-version helpers in other sessions may ignore this new Global lock. An independent owner/security review and a full fleet compatibility gate are mandatory before rollout.

- The additional **test-only** `test/gui-incident-review-crash-fixture.test.mjs` exercises a synthetic journal on unique temporary roots: durable PREPARED evidence and exit before archival; exit immediately after same-directory rename; concurrent `wx` review attempts; tampering, corrupt archive, missing files, hardlink and (where permitted) symlink rejection. A read-only fixture inspector **never grants native input authorization** from a prepared or archived record, even when the bytes and hash match. This is process-exit fault injection and structural recovery validation, **not a physical power-cut durability test, trusted owner authentication, a production incident archive implementation, or proof of cross-session coordination**. No real J01 path is opened.
- QA-only assets `test/gui-incident-cross-process.test.mjs` and `test/fixtures/gui-reconciliation-mutex-qa.ps1` exercise two independent Node workers contending over one disposable pending file, a forged cross-process `resolve`, durable no-replay after worker exit, and a **random Global namespace QA mutex** surviving a synthetic worker crash. The test never uses the live `Local\\ChatGPTRemoteCommander.GuiInput`, any production pending path, an owner window or a real GUI action. Its `Global\\` result tests only **same-session subprocesses** and cannot establish inter-session ACL correctness, service identity, or real dispatcher serialization; the synthetic journal is unchanged even when the mutex becomes available. These are preliminary coordination/Crash evidence, not a working release transaction.

## Native helper mixed-version handshake (isolated candidate)

- The Windows native persistent helper's startup frame now advertises `nativeInputCoordinator:1` in addition to its existing protocol version. This is a **compatibility assertion by pinned project code**, not an OS signature or independent identity proof. Linux remains on its existing native protocol.
- `createGuiProcessClient` records this exact numeric value on **each** helper process startup and resets on close, error and respawn. When the caller enables `requireNativeInputCoordinator`, mutation dispatch is refused before writing stdin if the helper is old or mis-versioned. Read-only observation remains available for legacy helpers.
- The Windows GUI Controller performs this compatibility preflight **before** `incidentStore.begin()`; consequently an old helper's refusal cannot strand a fresh `PENDING_NATIVE_EFFECT` record. If the process unexpectedly dies between preflight and dispatch, the subsequent failure remains UNKNOWN/fail-closed as before; no blind retry is introduced.
- Tests use independent old/new fixture processes: old status works and attempted click is never written; new helper admits input once; controller's preflight failure creates no journal; real QA-only native Server startup advertises the capability without desktop input. These are **not** proof that all installed old Core processes have upgraded: a legacy Core/Helper in a different Windows Session can still ignore the Global mutex.
- Do not deploy mixed versions without a fleet-wide check that all native input-capable profiles have been stopped or upgraded. This handshake limits **new Core paired with old Helper**; it cannot enforce cooperation on an old Core that bypasses the updated dispatch architecture. It also cannot authenticate an owner's choice to review a historical UNKNOWN incident.

## Interrupted-review detection (isolated local candidate, not deployed)

Core's incident store now reserves **three adjacent transaction-artifact names** derived from the original pending filename: `.review-prepared-v1.json`, `.review-archive-v1.json`, and `.review-terminal-v1.json`. The original filename remains unchanged. If *any* artifact exists, even when the pending file is absent, `pending()`, `begin()`, `resolve()`, and `inspect()` fail closed. In particular, neither an archive nor a purported terminal receipt unlocks GUI input. The controller's existing observe-only path remains available; CLI `--status` and `--plan` report `BLOCKED_UNRECONCILED_REVIEW_ARTIFACT` with exit code 4 and `releaseAuthorized:false`.

The read-only fingerprint validation is reused for dispatch gating, avoiding an independent looser interpretation of the original record. Tests inject disposable PREPARED, renamed-archive and forged-terminal artifacts and verify denial without native input or modifications to the original bytes. **No production transaction writer, trusted owner broker, release authority, or deployment is introduced by this candidate.** Actual reconciliation will require protected broker ownership of these records, cross-session lock and exact crash-safe durability checks; same-user marker files cannot authorize anything and may themselves cause deliberate fail-closed denial.

## Threat-model limit

A remote Full Power shell running as the same OS account can edit user-writable files and invoke same-user processes. JS-only UI gating is **not** an OS security boundary. Do not advertise cryptographic or hardware-backed owner authorization until a distinct OS trust boundary is independently verified. The named mutex is a coordination primitive, not an identity proof.
### Read-only recovery artifact inspection — local candidate (not deployed)

The prior fail-closed review marker guard is complemented by a production-code `inspectRecovery()` **read-only** forensic method and clearer `gui_status.incidentRecoveryRequired`. It reopens original and archive with stable `lstat/fstat` identity checks, rejects symlinks/hardlinks, validates canonical original bytes and returns bounded hashes and explicit state labels. Prepared and terminal markers are fingerprinted **only** and never interpreted as permission. CLI `--status`/`--plan` can report incomplete or corrupt recovery instead of treating a missing live pending file as success. No new public MCP method, broker endpoint, archive writer or release path exists.

The next code acceptance gate is a protected, incident-bound OS-local owner broker coupled to full native dispatcher quiescence and a durable writer. The forensic state labels do **not** satisfy those gates. Tests are structural/process-exit, not a real owner approval or a power-cut test.

### Active native dispatcher inventory — read-only candidate

The incident CLI now provides `--preflight`: a bounded cross-session process census of currently observed Commander Core and GUI Helper processes. The only returned native metadata is PID/session/role; raw command lines are never returned. Windows enumeration uses `Get-CimInstance Win32_Process`; Linux uses local `/proc`. Any failure is reported as unknown and always fail-closed. This work establishes **positive observed blockers**, not authoritative `allDispatchersQuiescent` and not a native Mutex lease. Mixed-version helpers, inaccessible processes, start/exit races, unknown sessions and future dispatch after enumeration still require a protected coordination cutover. No owner authorization, replay, native GUI input or live installed Core change is introduced.

### Linux participating native helper coordinator (isolated, not deployed)

The existing GNOME/Mutter helper now uses a **single account-UID native `fcntl.flock`** during mutating actions (including `focusWindow`) under `/run/user/<uid>/chatgpt-remote-commander-gui-input-v1.lock`. It checks runtime-directory owner/private permissions, the lock file's type/owner/link count/mode/inode and fails closed before native input when unavailable or busy. `status` and `screenshot` remain independent of this lock. A protocol-1 native helper advertises `nativeInputCoordinator:1`; new Core checks this on every startup/respawn before reserving J01. An old helper is observe-only for a new Core.

Exact native `NOT_SUBMITTED` receipts from a pinned Linux helper can resolve **only a newly created** J01 incident without retry. Crash after native dispatch, ambiguous helper failure, and historical `UNKNOWN` incidents stay blocked. Disposable multi-process/crash/linked-lock tests confirm the scoped coordination behavior; they do not prove a complete installed fleet, unrelated mount namespaces, an authenticated owner review, or power-loss durability.

**Migration gate:** quiesce or update every old Linux Core/Helper and every relevant session before enabling native input; advisory process census is not synchronization and legacy processes cannot be made cooperative by a new mutex.


## E35 isolated cryptographic owner-review transcript (NOT an OS broker)

A reusable *pure, stateless* transcript binding helper is staged at
\`src/gui-owner-review-challenge.mjs\` (mandatory
\`test/gui-owner-review-challenge.test.mjs\`). It does **not** accept owner
consent, archive the original J01, open an input lease, communicate with OS
credential providers, or write any filesystem data.

- A proposal binds one exact original \`PENDING_NATIVE_EFFECT\` id/tool/start
  time, raw-byte SHA-256 and byte length, a broker-provided 256-bit nonce,
  and a canonical UTC issuance/expiry at most 120 seconds apart. The original
  native effect always remains \`UNKNOWN\`; the transcript domain is distinct
  from generic login, arbitrary text or tool arguments.
- RSA-2048+ PKCS#1 v1.5 SHA-256 diagnostic verification rejects malformed
  transcripts, forged ownership flags, mismatched J01 SHA, nonce replay,
  overlong signatures, invalid key format and expired requests.
- A caller may provide its **own** matching public/private key, so a
  cryptographically valid signature **CANNOT** establish owner identity.
  Therefore *every* result—including a valid signature—returns
  \`ownerAuthenticated:false\`, \`fleetQuiescenceProven:false\` and
  \`releaseAuthorized:false\`. A same-user file, local JSON proof, remote
  shell or chat confirmation must never be substituted for the missing
  privileged broker.
- A future broker must issue and persist a one-use challenge under its
  *separate protected principal*, enroll/store the owner-bound public key
  out of reach of MCP/same-user scripts, request incident-specific owner
  presence through the OS, verify freshness and key provenance, atomically
  consume challenge, acquire coordinated native input quiescence across
  **all** installed versions and sessions, then execute a separate
  crash-safe original-byte J01 archive. The current transcript helper
  implements **none** of those privileged effects or deployment gates.

For a potential Windows Hello enrollment/UI, see Microsoft's
[Windows Hello](https://learn.microsoft.com/en-us/windows/apps/develop/security/windows-hello)
API documentation. A separate Windows protected service and carefully ACLed
IPC boundary require independent review (see Microsoft's
[named pipe impersonation](https://learn.microsoft.com/en-us/windows/win32/ipc/impersonating-a-named-pipe-client)
documentation). Generic \`UserConsentVerifier\`, an unprotected same-user
public key, and default pipe ACLs are insufficient OS boundaries. Linux
polkit and a privileged broker would require a *separate* implementation.
Never claim the E35 protocol has restored GUI mouse/keyboard input or is
ready to deploy to Emad PC or Linux.

## E36 diagnostic nonce claim ledger (NO protected authority)

\`src/gui-owner-review-ledger.mjs\` is a *separate testable staging
building block* for a future OS-local broker; it MUST NOT be wired into
the Commander input dispatcher as a release grant. With an independently
provided absolute, preexisting private directory, a canonical incident
challenge is hashed to a deterministic claim filename, created with
\`O_CREAT|O_EXCL\` (and \`O_NOFOLLOW\` where supported), written and file-synced.
A duplicate or a crashed partial claim marker causes **fail-closed refusal**;
the marker is never deleted/reused. Concurrent same-host Node processes can
produce only one successful *diagnostic claim* for the same exact challenge.
No original J01 file or real desktop state is accessed.

The class ALWAYS returns \`releaseAuthorized:false\`,
\`ownerAuthenticated:false\`, \`fleetQuiescenceProven:false\` and
\`storageTrusted:false\`, even for a first/valid claim; the process owns no
OS principal or protected encryption key. Its path is *chosen by the caller*,
and on Windows it CANNOT attest NTFS DACLs, service identity or directory
metadata durability; even on POSIX it checks only a leaf directory and
does not prove parent-chain, mount namespace, or full crash durability.
A malicious same-account Commander shell could forge/delete a file or choose
a new directory. The broker must be separately protected and must own
anti-replay issuance, trusted identity, OS-owner presence, fleet quiescence
and crash-safe archival before any GUI input can be released.

\`test/gui-owner-review-ledger.test.mjs\` covers same-challenge serial
claims, 25-way in-process race, 4-process atomic create race, changed
nonce, corrupt partial claim, missing directory, forged transcript and
POSIX symlink denial. A skipped symlink case on Windows is not an
acceptance of Windows path security. The test is included in mandatory
\`package.json\` checks. E36 is not deployable or sufficient owner authority.


## E39 staged untrusted-evidence diagnostic admission (SOURCE ONLY / NO GUI RELEASE)

`src/gui-owner-recovery-admission.mjs` combines E35 incident-bound challenge syntax with E36 **diagnostic-only** signature/claim results and the existing read-only dispatcher census into one deterministic blocker list. The result ALWAYS has `releaseAuthorized:false`, `ownerAuthenticated:false`, `protectedNonceConsumed:false`, `fleetQuiescenceProven:false`, `archiveTrusted:false`, `nativeOutcome:'UNKNOWN'` and `noReplay:true`. Caller-controlled booleans claiming `SYSTEM`, signed review, protected storage, physical presence or quiescence are explicitly never promoted to authority. Matching metadata/empty process census is not original-J01-byte verification, all-version input quiescence, a trusted OS broker, secure archival or a real native desktop acceptance test.

Scope regression `test/gui-owner-recovery-admission.test.mjs` covers changed J01 SHA, wrong incident/tool/time/typed bytes, malformed challenge, forged authorization, missing/rejected diagnostic receipts, zero/positive/incomplete process census and hostile throwing input properties. Run by mandatory `npm run check`. Pure function only: no Windows service, pipe, mutex, browser access, filesystem writes, installed Commander patch or native input. It is not a claim that the protected owner broker has been built. PR #249 remains draft/security hold; broker enrollment, Windows protected pipe DACL + peer token and physical-owner presence, trusted one-use nonce issuance, globally coordinated legacy/current dispatcher cutover and original-byte archival remain separate acceptance gates.

Primary platform constraints: Windows [Named Pipe Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights), [Kernel Object Namespaces](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces) and [Windows Hello](https://learn.microsoft.com/en-us/windows/apps/develop/security/windows-hello). Default pipe ACLs, `Global\\` naming, an OS username string or a caller-supplied public key do not authenticate the owner or authorize GUI input.

## E40 isolated native Windows named-pipe peer and DACL test (NO owner authentication)

The separate Windows-only QA harness `test/gui-owner-native-pipe-qa.ps1` creates a random 128-bit-identified local named pipe with an explicitly non-inherited DACL restricted to its *own QA OS account*. It obtains the pipe's **applied** security descriptor from the OS handle and rejects any unexpected ACE. It then uses `NamedPipeServerStream.RunAsClient` to read the connected client's Windows access-token principal; claimed SID strings sent by the client are never used for OS identity. The pipe always responds with `ownerAuthenticated:false`, `releaseAuthorized:false`, `nativeOutcome:'UNKNOWN'`. `test/gui-owner-native-pipe-qa.test.mjs` exercises a real Windows server/client pair with forged SYSTEM/admin claims and a malformed pipe name. Windows test is in mandatory `check`; tests skip on non-Windows hosts. Unlike JS-only fixtures, this uses actual OS named-pipe and impersonation operations, but **only under the same Windows account**.

**Critical negative scope:** The current Windows Server session may be Administrator but does not have independent physical-owner presence or the distinct protected service identity required on the target Emad PC. A same-account script can access the same pipe or race its name; this test establishes neither a trustworthy product broker nor protection against same-user processes. No session logon SID, cross-user rejection, service lifecycle, protected enrollment or real owner-presence test has been accepted. No original J01 file, native dispatcher, GUI input or installed Commander service is touched. Microsoft `Named Pipe Security and Access Rights` explicitly warns about default ACLs and `FILE_CREATE_PIPE_INSTANCE` semantics; this QA demo intentionally does not promote its result to release permission. Next engineering acceptance requires a truly distinct OS principal with explicit server/client token and pipe-instance restrictions, service-owned trust anchor, nonce consumption and full native dispatcher quiescence; source-only code must remain fail-closed until those gates pass.


### E40 hosted NoPromote negative evidence and bounded process-startup regression

Exact original PR #312 head `0694664e8c707885b0a3ec95d206d4866710b94c` received hosted NoPromote [run 39513892135](https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/39513892135) **FAIL**, while E40 Windows IPC local and ordinary CI checks passed. The source-pinned R470 sanitized diagnostic identified one failed `project-engine-integration.test.mjs` case, `separate Node processes cannot claim the same project run concurrently`, with 30 passed/1 failed in the nested 31-test gate. The diagnostic did *not* include raw error detail, so root cause is not proven to be process startup vs contention. The old fixture killed the spawned child after 8 seconds **including OS process startup**, with 12-second total test cap. To avoid treating slow startup on a saturated shared Windows runner as failure of the actual cross-process lock, the regression now separately bounds startup at 20 seconds and bounds child lock execution from the actual `planning` handshake at 10 seconds, with 35-second overall cap, preserving the exact same competing-lock, one-writer and final-state assertions. The unchanged isolated Windows Server targeted test passed 5 consecutive repeats after patch; this is local bounded evidence, NOT a declaration that the hosted failure is solved. Do not merge/publish until a new exact source head's NoPromote job passes. The historical failure receipt remains immutable.

## E41 isolated Win32 first-instance and least-privilege DACL qualification — NO GUI RELEASE

Following E40 merged staged HEAD `f12d181e3237cda04fe56dcb03c1b96b697ad0f0`, E41 uses two *source-only* QA fixtures: `test/gui-owner-win32-first-instance-qa.ps1` invokes native `CreateNamedPipeW` with `FILE_FLAG_FIRST_PIPE_INSTANCE` and `PIPE_REJECT_REMOTE_CLIENTS`, an ephemeral 128-bit random pipe name, `maxInstances=2`, and a restrictive security descriptor. The OS-reported applied DACL is read back through `GetSecurityInfo`, checked for precisely two explicit allow ACEs: current isolated QA principal with server instance rights and a **synthetic nonexistent test client SID** with only granular `ReadData`, `WriteData`, `ReadAttributes`, `Synchronize` (no `CreateNewInstance`, delete, take-ownership, change-permissions). Attempting to create a second *first* instance is required to fail `ERROR_ACCESS_DENIED=5`; earlier `maxInstances=1` negative produced ERROR_PIPE_BUSY=231 and was correctly rejected as inconclusive before using maxInstances=2. No real different-user client has authenticated or connected, and the remote-rejection flag was supplied on creation but no remote traffic was tested. All output includes `releaseAuthorized:false`, `ownerAuthenticated:false`, `nativeOutcome:UNKNOWN`.

`test/gui-owner-win32-first-instance-qa.test.mjs` tests native OS descriptor and first-instance enforcement, rejects Everyone/Authenticated Users/Builtin Users/Anonymous SID, malformed SID, insecure FullControl rights and same OS owner/client SID. The QA creates no Windows account, service, registry item or permanent pipe; handle and unmanaged native security buffers are freed. Windows only; other platforms skip safely. Included in the mandatory package `check` test list. This is structural kernel/ACL qualification, not a broker capable of safely authorizing production input.

**Primary sources:** Microsoft Named Pipe Security and Access Rights https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights (generic write includes `FILE_CREATE_PIPE_INSTANCE`; explicit rights), Microsoft CreateNamedPipe https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea (first instance and reject remote flags), Microsoft named-pipe impersonation levels https://learn.microsoft.com/en-us/windows/win32/secauthz/impersonation-levels, Microsoft UserConsentVerifier https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier.requestverificationasync, Linux polkit Authority https://polkit.pages.freedesktop.org/polkit/PolkitAuthority.html (allow interaction only on actual user action).

**Remaining mandatory negative/positive gates:** separate real OS service identity and enrolled physical owner, independent untrusted-client principal denied instance-creation in a real cross-principal test, genuinely checked remote transport denial, OS-protected owner key/one-use nonce and crash-consistent original J01 custody, full legacy/current dispatcher quiescence and real native GUI input under owner control. No current proof for those conditions; PR249 remains security HOLD; this source cannot unblock it.

## E42 disposable original-J01 custody QA — source only, never installed

QA-only tools/gui-original-j01-custody-qa.mjs requires a qaRoot direct child of os.tmpdir() with rc-e42-j01-qa-* basename. Source and separate archive destination must be immediate children of that root. Installed Windows LOCALAPPDATA and Linux XDG_STATE_HOME J01 paths are outside the permitted fixture; accidental use fails closed. This helper NEVER moves, deletes, renames or replays the source and NEVER grants GUI input. It is NOT production archiving, registered owner consent, a protected service or a trusted ledger.

Source is examined with lstat/fstat, final symlinks and hardlinks are denied, original bytes and SHA-256 must match accepted expected values, archive is created exclusively using O_CREAT|O_EXCL (O_NOFOLLOW where supported), file contents are synced, and original/archive are reread. POSIX archive directory fsync occurs after creation. Windows directory durability is not proven. On failure an incomplete archive remains intact for incident reconciliation: no silent deletion, overwrite or automatic retry. Read-only inspection never grants authorization, regardless of archive integrity. Returned fields always include ownerAuthenticated=false, storageTrusted=false, releaseAuthorized=false, nativeOutcome=UNKNOWN, noReplay=true.

Unit tests cover exact bytes, duplicate writer race (one winner), EEXIST collision, changed size/hash, source and archive tampering, missing/partial archive, invalid/path-escaped QA root, symlink and hardlink, plus preservation of the source. Test included in mandatory check on both Windows/Linux.

Residual limitations: same-user writable QA storage is untrusted, Node O_NOFOLLOW is unavailable on Windows, reparse points in path components and network-filesystem O_EXCL behavior are not fully proven, file/directory flushes are not a physical power-cut test and original native effect remains UNKNOWN. A protected owner broker must use a distinct OS identity/ACL, physically initiated enrolled owner credential, incident-bound nonce and global dispatcher coordination. Do not infer these from any QA PASS.

Official evidence: https://nodejs.org/api/fs.html ; https://man7.org/linux/man-pages/man2/fsync.2.html ; https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers ; https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilea (REPLACEFILE_WRITE_THROUGH unsupported); https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata (CRYPTPROTECT_LOCAL_MACHINE allows any local user to decrypt); https://man7.org/linux/man-pages/man2/openat2.2.html (RESOLVE_BENEATH and RESOLVE_NO_SYMLINKS for protected Linux broker path confinement).


## E44 actual Linux openat2 syscall QA — kernel-level path containment only

The source-only `tools/gui-linux-openat2-kernel-qa.py` invokes the actual Linux `openat2` syscall with a directory file descriptor pinned to a disposable `rc-e44-openat2-qa-*` temporary fixture. It applies all four flags `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV` and checks first/duplicate `O_EXCL` creation, kernel-sourced symbolic-link, proc-magic-link, absolute-path and `..` traversal errors, hardlink count observation, and kernel validation of unsupported resolve flags and invalid mode. The test includes real synthetic-file and archive-directory `fsync`, and a two-thread kernel exclusive-create race with exactly one winner. No installed file path, user real J01, GUI, polkit or privileged process is used.

`test/gui-linux-openat2-kernel-qa.test.mjs` is mandatory in package `check` on Linux and skips on Windows. Linux architecture is restricted to verified syscall 437 (`x86_64`/`aarch64`), and a missing Python or unsupported syscall fails rather than falsely passing. All outputs report `ownerAuthenticated=false,storageTrusted=false,releaseAuthorized=false,nativeOutcome=UNKNOWN`; even a fully passing test does not establish independently trusted storage. `RESOLVE_NO_XDEV` is requested but cross-mount behavior is not tested; no physical power-cut durability is claimed. This is actual kernel QA to supplement, not replace, E42's synthetic original-byte custody test or the pending protected OS-broker/physical owner workflow.

Primary sources: Linux `openat2(2)` https://man7.org/linux/man-pages/man2/openat2.2.html explains fd-root confinement, `RESOLVE_NO_SYMLINKS` for *all* components versus `O_NOFOLLOW` only at final component, `RESOLVE_NO_MAGICLINKS` and `RESOLVE_NO_XDEV`; Linux `fsync(2)` https://man7.org/linux/man-pages/man2/fsync.2.html documents directory metadata durability. Windows equivalent confinement requires real native handle/DACL/reparse checks and remains a separate unpassed production security gate.


### E44 exact-head hosted Windows CI failure and bounded MCP health regression

Original E44 commit `444bd32fb6542fd361eca9d7566f8f443080447d` hosted CI [39582460367](https://github.com/GOD13emad/ChatGPTRemoteCommander/actions/runs/39582460367) completed FAILURE in Windows `Run qualification suite with bounded Windows file concurrency`. Exact nested failure: `test/mcp-conformance.test.mjs` line 108 asserted health READY after 400 attempts spaced 25ms, but observed `healthy=false` with only the Node SQLite experimental warning in captured stderr. This **does not prove** a server defect versus a saturated Windows runner; it demonstrates that the 10s health startup window could not establish READY. The unrelated new Linux openat2 kernel test passed on both local Linux and hosted Ubuntu CI. Do not relabel historical Windows failure PASS.

E44 corrective source delta replaces the 400 short polls with a **bounded 30s wall-clock health check**, each fetch capped at 1200ms, and exits early if the spawned isolated server terminates. The readiness invariant remains the same: `response.ok===true` on `/health`, otherwise the test fails. Windows Server targeted test PASS after correction; this does not prove new hosted Windows acceptance. A **new exact GitHub SHA** must pass Windows/Ubuntu CI, Canary and NoPromote before staged-only integration. No production dispatcher or original J01 mutation.
